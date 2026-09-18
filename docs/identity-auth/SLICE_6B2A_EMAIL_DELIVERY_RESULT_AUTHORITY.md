# Slice 6b.2a — a delivery result belongs to its claimant

**Migration `20270502000000_a_delivery_result_belongs_to_its_claimant.sql`.** A **separately discovered
authorisation defect**, found while reviewing the S6-9 session work, in a function that work touched.
It is recorded as its own defect rather than folded into S6-9, because S6-9 is about session liveness
and this is not.

---

## The defect, verified rather than accepted

The review reported it; it was re-derived from the schema and then **reproduced before anything was
changed**. On a database at production ledger 521, with a production-shaped fixture:

```
EMAIL | owner claims a delivery      | claimed
EMAIL | claim records a claimant     | NO
EMAIL | STRANGER records the result  | OK
EMAIL | ...and the row now reads     | sent/forged
```

A second, unrelated authenticated session — live, ACTIVE, nothing wrong with it — took a delivery id it
had no relationship to and wrote `status = 'sent'`, `provider = 'forged'`, `provider_reference =
'forged-ref'` onto somebody else's delivery.

### Root cause

`public.record_email_delivery_result` is `SECURITY DEFINER`, so RLS never runs for it. Its entire
authority was `if auth.uid() is null then raise`. It then updated `public.email_deliveries` **by primary
key** and nothing else. Being signed in was the whole test.

The 6b.2a contract migration had already given it a session gate, so a revoked or suspended caller was
refused. This is the question underneath that one: **a perfectly valid session had authority over
deliveries that were nothing to do with it.**

### What it costs

Nothing leaks and no email is redirected — the function writes result metadata, it does not read
recipients or send anything. What breaks is the **ledger**. `email_deliveries` is what Site Admin reads
to answer *"did that invitation go out, and what did the provider say"*. Write access to it means
making a failed delivery look sent, a sent one look failed, planting provider text in a field an
administrator reads, and inflating the attempt counter that retry reasoning rests on. A record any
signed-in person can edit is not a record.

## The authority that already existed

No role or capability was invented. `email_deliveries.initiated_by` is an `auth.users` foreign key, and
`public.claim_test_email_send` **has always set it from `auth.uid()`**. The architecture already said
what makes a caller legitimate:

> **THE CLAIM IS THE ESTABLISHING ACT, AND THE CLAIMANT OWNS THE DELIVERY.**

`lib/email/send.ts` does precisely that, in sequence: `claim_email_delivery` → attempt →
`record_email_delivery_result`. And `claim_email_delivery`'s unique `idempotency_key` with
`on conflict do nothing` is what makes one occurrence one delivery — and, as a consequence, what makes
a claim impossible to take off somebody.

Two gaps existed against that design, and only those two were closed:

1. the **ordinary** claim path never wrote the claimant (only the test-send path did);
2. the **result** path never read it.

The authority is entirely server-derived: `auth.uid()` against a column written by the database. There
is no argument for it and there must never be one.

## Why not solve it with EXECUTE privilege

The tempting answer is that this is server-side code and should not be browser-callable. It **is**
server-side code — `lib/email/send.ts` runs in Server Actions and route handlers — but it reaches the
database through **the requesting person's session client**, so PostgREST sees an ordinary
`authenticated` RPC and so does Postgres.

**Server location is not an authorisation boundary when an authenticated browser can invoke the same
RPC directly.** Revoking `EXECUTE` from `authenticated` would not harden the path; it would stop every
email Ovalball sends. So the boundary belongs in the database, bound to the claim — and the migration
asserts the grant is still intact, so a later "tidy-up" cannot quietly turn the fix into an outage.

## The pair, audited together

| Attack | Result |
|---|---|
| Record without claiming | refused — `EDA-05` |
| Record another user's claim | refused — `EDA-03`, and the row is byte-for-byte unmoved (`EDA-04`) |
| Steal or overwrite an existing claim | impossible — the unique `idempotency_key` returns no claim, and the original row's owner, recipient and subject are untouched (`EDA-16`, `EDA-17`) |
| Complete twice, as the claimant | **allowed, by design** — the attempt counter is what moves, and retry semantics are deliberately unchanged (`EDA-12`) |
| Change a terminal outcome as a stranger | refused — `EDA-11` |
| Forge a provider result | refused; provider, reference, error code and message are payload, never authority (`EDA-08`) |
| Race the legitimate claimant | refused before, between and after the legitimate completion (`EDA-19`, `EDA-20`, `EDA-21`) |
| Probe which delivery ids exist | impossible — a nonexistent id gets the identical refusal (`EDA-07`) |

`claim_disabled_email_suppression` also creates a delivery row, so it records a claimant too. That
makes *"every delivery row knows who created it"* an invariant rather than something true of two paths
out of three (`EDA-18`).

## Sibling semantics deliberately preserved

Retry behaviour, the attempt counter, provider-message normalisation and redaction, suppression
reasons, delivery history, security-event behaviour and every user-visible email flow are unchanged.
This is not an email architecture change.

## Compatibility, stated honestly

Rows claimed **before** the migration have a null `initiated_by`, and no result can be recorded against
them afterwards. They are historical entries whose results were recorded long ago, so this costs
nothing — **except in one window**: a delivery claimed in the seconds before the migration whose result
is recorded in the seconds after. That request leaves its row `queued` although the email did go out.
It is a single in-flight request at deploy time and it loses no email.

The alternative — accepting a null claimant as legitimate — would have left the defect open for every
row that already exists, which is most of them. **No backfill is possible or attempted**: who claimed
those rows was never recorded, and inventing an owner would be fabricating the exact fact this
migration exists to bind.

There is one other caller-visible change, and it is the fix working: calling
`record_email_delivery_result` with a delivery id that belongs to nobody (including one that does not
exist) used to succeed silently, updating zero rows. It is now refused. No real caller does this —
`lib/email/send.ts` only ever passes an id it has just received from its own claim.

## Migration topology — and why this is a second file

`20270501000000` is **unreleased**, so folding this into it was technically possible. It was not done,
for one reason: the two are different defects found at different times by different questions. One
closes S6-9; the other closes an authorisation gap that S6-9 does not cover and must not be seen to.
A reader of the history should be able to see both, in the order they were found, with their own
reasoning attached. Migration count is not the thing worth minimising.

Both are unreleased, so the release applies them in order: **521 → 522 → 523**.

## Evidence

| Gate | Result |
|---|---|
| `supabase/tests/email_delivery_result_authority.sql` (**new**, wired) | **24 / 24** — A–J, the sibling pair, three races, and the structural rule |
| The same suite before the fix | **11 failures**, including `EDA-03` reporting `(no refusal)` — the exploit, reproduced |
| `email_delivery_foundation.sql` | **27 / 27** unchanged |
| `notification_mandatory_and_preferences.sql` | **19 / 19** unchanged |
| Migration self-checks | 4 — result bound to claimant, both claim paths write one, the session gate survived the rewrite, the grant is intact |
| `pg_proc` metadata, 3 rewritten functions | **no drift** on any tracked attribute |
| Mutation campaign | **21 mutants, 0 survivors** (M17–M21 are this fix's) |
| Clean boot from empty | **523 migrations**, then **169 SQL suites / 4282 assertions / 0 failures** |
| Production-shaped rehearsal | ledger 521 → both migrations → exploit closed, claimant path unchanged |

### The mutants this fix added

- **M17** — remove the authority boundary entirely.
- **M18** — the subtle one: keep a check that still *mentions* `initiated_by` but accepts anybody signed
  in. A structural grep for the column would call this fixed.
- **M19** — stop the claim recording who claimed it, so the binding the result path reads is always null.
- **M20** — keep the guard, drop the binding from the `UPDATE`'s own `WHERE`, so check and write disagree.
- **M21** — derive authority from a caller-supplied value (`p_provider`) rather than from the row.

All killed.

## The full runner

**4933 assertions passed, 0 failed, across 235 suites.** That is the previous 4906 plus this fix's 24
and the perimeter guard's 3, which is the arithmetic saying nothing else moved.

Again not one process, and for the same reason. `scripts/run-platform-tests.sh` completed **every SQL
suite and every JS suite — 231 suites, 4850 assertions, 0 failures** — and was killed by the low-memory
guard at the transition into the Playwright half, before suite 63 started. This is now the fourth such
kill; it has never once been a test failing. Before this attempt the disposable clean-boot and
rehearsal databases were dropped, `next build` and the lint pass were run separately rather than
alongside Playwright, and nothing else was in flight. Docker's VM alone holds 1.3 GB on this machine.

The four browser suites were then run **one at a time**, in the same shell environment against the same
disk: **63 → 12/12, 64 → 34/34, 65 → 18/18, 66 → 19/19.**
