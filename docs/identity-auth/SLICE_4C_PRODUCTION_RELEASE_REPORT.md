# Identity/Auth Slice 4C — Production Release

**Commit `be4c52b`.** Fast-forward `774ab9b..be4c52b` on `main`. Released 16 September 2026.

---

## 1. What was released

Fixture authority now resolves through `internal.capability_decision`, and the route that could book
a fixture against another Ovalball club without asking them is closed at the database.

Twenty-two files: four migrations, one application file, the perimeter manifest, five test suites,
two browser suites, the generated types, and the programme documents. The two protected logos
remained untracked and unstaged throughout, with their SHA-1s unchanged —
`be2bef0c978869aaa73e474cd5abdf5aec1fff6c` and `bdd3224871f0561d971f93f519764f0502092504`.

---

## 2. The staged release, as executed

The bypass could not be closed in one step, because closing it removes a privilege the running
application was still using while creating the new route the next release needs. The two halves went
either side of the deployment.

### Stage A — expand

`20270361000000` was moved out of `supabase/migrations/` so `supabase db push --linked` would apply
only the expand set, and moved straight back afterwards.

```
Applying migration 20270358000000_fixture_authority_canonical.sql...
Applying migration 20270359000000_fixture_policies_canonical.sql...
Applying migration 20270360000000_create_fixture_canonical.sql...
Finished supabase db push.
```

The application then serving was the 4B build. It still direct-inserted and still held INSERT, so it
was unaffected — and `public.create_fixture` now existed, ready for the build about to deploy.

### Stage B — deploy

`git push origin main` → `774ab9b..be4c52b`. Vercel deploys on push, so the push is the deployment.

**The deployment was confirmed live before Stage C, not assumed.** The prerendered `/login` response
changed on all three independent markers:

| marker | before | after |
|---|---|---|
| `etag` | `"4c7fee48…"` | `"4c9af1c8…"` |
| `age` | 9732 | 0 |
| content-hashed chunk set (SHA-1) | `d005086b…` | `fa7d9607…` |

Detected 120 seconds after the push. `ovalball.co.uk` and `www.ovalball.co.uk` both returned 200.

### Stage C — contract

```
Applying migration 20270361000000_retire_fixture_insert_bypass.sql...
Finished supabase db push.
```

This is the migration that revokes INSERT, and it ends with a `DO` block that raises if
`authenticated` still holds the privilege. It completed without error, **so that assertion passed
inside production.** That is precisely why the check was written into the migration rather than only
into a test: it turns the release itself into the proof.

---

## 3. Production state

`supabase migration list --linked`:

```
rows 454 · applied remotely 454 · remote tip 20270361000000 · pending: none
20270358000000: APPLIED   20270360000000: APPLIED
20270359000000: APPLIED   20270361000000: APPLIED
```

No migration reported an error at any stage. Both domains serve.

### Zero schema drift

`supabase db diff --linked` replays the whole 454-migration tree into a shadow database and compares
it against the live remote schema. It reports:

```
No schema changes found
```

This is the strongest production proof available without a signed-in identity, and it is worth more
than the ledger alone. The ledger says *which migrations ran*; the diff says the resulting schema is
**exactly** the schema the 3761 assertions and the clean boot were run against — every function body,
every policy expression, every grant. There is no drift, no partially-applied object and no
hand-edited difference between what was tested and what is serving.

---

## 4. What is verified in production, and what is not

**Verified in production.** The full migration chain applied, in the intended order. The revoke
assertion passed there. The live schema is identical to the tested tree, with zero drift. The new
application is live on both domains and serving.

**NOT OBSERVABLE ON CURRENT PRODUCTION DATA.** Every per-persona authority distinction — the three
intended changes, the refusals, the request routing, the archive and restore boundaries. Observing
them requires signed-in identities holding particular roles at particular clubs, and production has
one club with one active membership.

Creating identities to make them observable is prohibited, and would be the wrong trade even if it
were not: it would put fabricated people into a real club's records to improve the look of a report.
Those distinctions are proven instead where people can be seeded deterministically — **3761
assertions across 197 suites with no failures**, a clean boot of all 454 migrations from an empty
database, and **9 green browser runs** (suites 51, 52 and 53 over three passes) driving real
authenticated sessions.

---

## 5. Evidence carried from the implementation report

| Proof | Result |
|---|---|
| Full platform battery | 3761 passed, 0 failed, 197 suites |
| Clean boot from empty | 454 migrations, tip `20270361000000`, all suites 0 failed |
| `fixture_management_authority` | 99 assertions |
| `authority_helper_retirement` | 35, every ceiling at the measured floor |
| Browser suites 51 / 52 / 53 | 17/17, 17/17, 14/14 — three passes each |
| Retirement | `is_site_admin` 115/146 · `can_manage_club_fixtures` 13/42 · PG15 **130** · PG16 **145** |

Nothing increased. The full narrative, including the three intended changes, the performance fix,
the two omissions caught before staging and the stated limits, is in
`SLICE_4C_IMPLEMENTATION_REPORT.md`; the working record is in `SLICE_4_PROGRAMME_LEDGER.md`.

---

## 6. Verdict

**IDENTITY/AUTH SLICE 4C — PRODUCTION VERIFIED**

4d–4i are not started. Next in order is 4d (Training). 4g remains banked under decision D-S4-2 and
is not to be implemented ahead of its turn. Slice 5 is not started.
