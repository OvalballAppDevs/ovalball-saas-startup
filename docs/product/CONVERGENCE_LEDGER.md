# Convergence programme ledger

## Standing policy — persistent local UAT personas

**Established during Convergence Step 2.**

**Canonical documentation:** `docs/product/STEP_2_MANUAL_REVIEW_WALKTHROUGH.md`
— the one place persona identities and local sign-in instructions are written
down. Every future manual-review document links to it instead of repeating it.

**Policy: REUSE AND EXTEND. DO NOT RECREATE PER STEP. DO NOT TEAR DOWN AS NORMAL
TEST CLEANUP.**

The point is continuity of judgement. Reviewing navigation, then permissions,
then fixtures, then Match Centre against **the same people in the same club** is
how the product owner can see whether Ovalball itself is converging; a fresh cast
per slice destroys that signal. So the people, the club, the teams and the roles
keep their names between steps, a later step that needs more **enriches this
world** through canonical product writes rather than standing up a parallel one,
and a genuinely new persistent identity is added to that same directory only when
no existing persona can legitimately represent the context.

Two boundaries that follow from it:

- **Permanent manual-review data and automated-test fixtures are separate
  concepts.** Every suite seeds and cleans its own; none may depend on ambient
  persistent data. Where the two collided, the *test* was corrected — see L5.
- **A walkthrough either restores what it changed through canonical transitions,
  or says plainly that the action changes the review world for good.** The
  canonical Club Admin is never left demoted, the only example of a role or state
  is never destroyed, and a fixture is never put back by bypassing a state
  machine.
- **Unexplained review-world state is REPORTED, never "fixed".** It may be the
  product owner's own manual Chrome work. State changes only when the owner asks
  for it, or when a walkthrough names a record as mutable and the owner performs
  the action. This rule exists because it was broken: four Coach assignments on
  the review club were removed as though they were drift from a stray test, and
  the timestamps later lined up with a real session in the review Club Admin's
  own account. `step2-review-club.mjs verify` therefore prints differences and
  fixes nothing.

---

Findings that are real, reproducible, and **deliberately not fixed where they
were found**. Each one names the step that owns it, so that the next person
reaches it through the programme rather than by tripping over it.

A finding leaves this ledger only when the owning step closes it, or when the
product owner rules that it is not a defect.

| id | finding | found in | owner | status |
|---|---|---|---|---|
| L1 | `lib/email/recipients.ts` `club_invitation` branch read the dead `public.invitations` table | Step 2 | Step 3 | **closed** — deleted as dead code, zero constructors proved |
| L7 | `accept_invitation` and `get_invitation_preview` are a second, granted role-grant path over the empty `public.invitations` | Step 3 | **the release after this one deploys** | open — contract half of expand→contract |
| L2 | A Safeguarding Officer nomination in `PENDING_CONFIRMATION` was described two contradictory ways and never as pending | Step 2 manual review preparation | Step 2 | **closed** — one appointment reader, one wording |
| L3 | The same club role is worded "Fixtures Secretary" in the role catalogue and "Fixture Secretary" everywhere else | Step 2 manual review preparation | presentation mapped in Step 2; **the catalogue key/label inconsistency stays open for its schema owner** | partly open |
| L4 | The team page told a Team Manager that only a Club Admin can assign people, directly beneath the assign control she may legitimately use | Step 2 manual review preparation | Step 2 | **closed** — the sentence asks the same flags the controls ask |
| L6 | `64-password-recovery-journey` S6B1-02 fails intermittently under full batch load | Step 2 persona-policy work | test reliability | **root cause found and fixed in Step 4** — visibility was the wrong readiness signal |
| L8 | An enforced nonce-bound CSP left the application un-hydrated | Step 4 (6b.2d) | Step 4 | **closed** — the cause was ours, not the framework's |
| L9 | A true clean boot needed `supabase db reset`, which would destroy the persistent review world | Step 4 | Step 4 | **closed** — `scripts/isolated-clean-boot.sh` |
| L12 | The "I've Saved Them" button at the end of TOTP enrolment did nothing | reported live during Stage 0.2 | Identity/Auth 6b | **closed** — with a browser regression that presses it |
| L10 | Stage 0 — production TOTP availability and enrolment | Step 5 recovery | product owner | **closed** — factor verified, codes issued, boundary proved locally |
| L11 | The `(app)` auth gate redirects to `/login` without a `next`, so a deep link into the application is lost at sign-in | Stage 0.2 navigation verification | **Step 4 family — Identity/Auth 6b** | open |
| L13 | A Site Admin could change a player's team placement without being able to read one | Step 5 (Slice 7e, building AB.1's Team Memberships tab) | Step 5 | **closed** — a narrow per-person definer read, and the roster RLS policy deliberately left alone |
| L14 | Seven of the sixteen master-control event types were displayed by no timeline at all | Step 5 (Slice 7e browser verification) | Step 5 | **closed** — the timelines discriminate on the scope column, and a fourth carries account decisions |
| L15 | `supabase/security/perimeter-manifest.json` declared consumer files that did not call the function, four of them deleted routes | Step 5 (Slice 7e) | Step 5 for its own rows; **each other slice for theirs** | partly open — Slice 7's are true and checked; fourteen remain in a shrink-only baseline |
| L16 | `internal.is_site_admin()` survived the Slice 4/7 retirement inside a view's `WHERE` clause, where the policy and function guards do not look | Step 5 (Slice 7e) | Step 5 | **closed** — `admin_club_overview` gates on `site.clubs.view`; the helper is dropped |
| L17 | Any signed-in account can read every club's `notes` and `official_email`; `anon` is column-restricted and `authenticated` is not | Step 5, measuring a declared perimeter bypass | Step 6 | **closed** — table grant revoked, capability-gated reads, 19 assertions |
| L18 | `62-site-admin-master-control` failed 5 assertions in one full batch and passed 18/18 alone, twice, immediately afterwards | Step 6 final gate | test reliability | open — **not root-caused**; diagnostics added, passed the next batch |

| L5 | `recipient_audience_engine.sql` picked its subject from whatever the database happened to contain, so an unrelated club appearing changed its verdict | Step 2 manual review preparation | test isolation | **closed** — the suite now names its subjects |

---

## Convergence Step 5 — what it closed, and where the record is

Step 5 is Identity/Auth **Slice 7e**: Site Admin master control reaching a
person. The authority model was built and verified in 7a–7d and almost none of it
reached a screen — seventeen of twenty-three master-control RPCs had no caller
anywhere in the product.

| | |
|---|---|
| Implementation and the four findings | `docs/identity-auth/SLICE_7E_IMPLEMENTATION_REPORT.md` |
| Release plan, including L7's contract half | `docs/identity-auth/SLICE_7E_RELEASE_PLAN.md` |
| Why 7e waited, kept as the record | `docs/identity-auth/SLICE_7E_REQUIREMENT_RECOVERY.md` (superseded) |

**Nothing was released.** Step 5 banks locally; S7-13 — a second Full Site Admin
in production — remains an owner action and is untouched.

---

## L1 — the dead legacy invitation email branch

`lib/email/recipients.ts` resolves an email's recipient from a `RecipientRef`.
One of its branches, `club_invitation`, reads:

```ts
supabase.from("invitations").select("id, invited_email, club_id").eq("id", ref.invitationId)
```

`public.invitations` has held **zero rows** since `issue_invitation` began
writing `public.access_invitations`. The branch therefore cannot resolve a
recipient, and would report "That invitation could not be found."

**Nothing is broken today.** It has no caller: `createInvitation` sends through
`recipient: { kind: "access_invitation", … }`, which reads `access_invitations`
correctly and was verified working in Step 2's browser gates. The `club_invitation`
string that appears elsewhere in the codebase is an **event key**, which is a
different field from the recipient kind and is not affected.

**Why it is not fixed here.** It is an email-architecture object, and broad email
work is explicitly out of Step 2's scope. Removing the branch touches the
`RecipientRef` union and the email catalogue, which is Step 3's territory.

**What Step 3 must do.** Archaeology across the whole invitation and email
delivery chain — issue, deliver, preview, redeem, revoke, resend — so that there
is one canonical invitation source end to end, and this branch either resolves
from `access_invitations` or ceases to exist. The hazard is not that it fails; it
is that it is the first thing somebody looking for "how do I email an invitation"
will find.

---

## L2 — a nomination that is never described as pending

The Safeguarding Officer appointment is a state machine on purpose: nomination →
`PENDING_CONFIRMATION` → Ovalball (AN‑6) confirmation → `ACTIVE`, and it grants
**zero** Safeguarding Officer authority before confirmation. That guarantee
holds, and Step 2 did not touch it.

What the product does with the middle state is the finding. With a real
nomination sitting in `PENDING_CONFIRMATION`:

- **`/club/permissions`** reads `role_assignments` where `state = 'ACTIVE'` and
  prints `role_definitions.label`. It does not look at `confirmation_state`, so
  the person is captioned plainly **"Safeguarding Officer"** — as though the
  appointment were settled.
- **`/club/settings/safeguarding`**, the page that owns the appointment, reads
  the officer register and reports **"No primary Safeguarding Officer — this club
  currently has no active primary Safeguarding Officer."** The nomination does
  not appear on it at all.

Both statements are defensible in isolation and they contradict each other, and
neither says *awaiting confirmation*. A club therefore cannot learn from the
product that it has nominated somebody and is waiting.

**Authority is not affected.** The nominated person resolves at 2 of 10
capabilities — the ordinary member figure, identical to every other member of the
review club. Nothing was granted.

### Closed — one appointment reader, one wording

The product owner ruled this a Step 2 defect. Fixed in presentation only; the
state machine and the authority behind it are untouched.

**The canonical appointment state is `public.role_assignments`** — `role_key =
'SAFEGUARDING_OFFICER'`, with `state` and `confirmation_state`. That is where
`internal.enter_safeguarding_nomination` writes and what
`confirm_safeguarding_officer` takes the id of.
`public.club_safeguarding_officers` is a **contact register**, written by the
invite-an-outsider path, and nominating an existing member writes no row in it —
which is exactly why the page reading only the register saw nothing.

- `lib/safeguarding/club-appointments.ts` is the one club-scope reader of the
  appointment. It resolves nothing and decides nothing; RLS decides who may see
  it and the state is reported as stored.
- `lib/permissions/role-presentation.ts` is the one place the state becomes
  words: **"Safeguarding Officer — Pending confirmation"**, with a single shared
  sentence explaining that the club has nominated somebody, Ovalball has not
  confirmed it, and they hold no Safeguarding Officer authority meanwhile.
- `/club/settings/safeguarding` now shows **Awaiting Confirmation** and
  **Confirmed Appointments** sections, and no longer offers to nominate somebody
  it is already showing as nominated.
- `/club/permissions` selects `confirmation_state` and takes its caption from the
  same authority, so `PENDING_CONFIRMATION` and `CONFIRMED` are distinguishable
  on sight.

Regression cover: `users_and_permissions_authority.sql` **E1–E6** (including E4,
which proves the guarantee by comparing the nominee's decision to an ordinary
member's capability by capability), four structural assertions in
`users_and_permissions_architecture.test.mts`, and **I1–I5** in browser suite 68.

Reproduce: review walkthrough section **G**.

---

## L3 — one role, two spellings

`role_definitions.label` for `FIXTURES_SECRETARY` is **"Fixtures Secretary"**.
`lib/permissions/role-labels.ts` — the canonical TypeScript wording, and the one
the people list, the person page and every other surface use — says **"Fixture
Secretary"** for `club_memberships.role = 'FIXTURE_SECRETARY'`.

So the same person reads "Fixture Secretary" on Users & Permissions and "Fixtures
Secretary" on Permissions and in the invite form's club-role menu. The role key
itself is spelled both ways too: `FIXTURES_SECRETARY` in `role_definitions`,
`FIXTURE_SECRETARY` in `role_capability_defaults` and `club_memberships`.

### Presentation mapped in Step 2 — the schema inconsistency stays open

The product owner ruled: use the established product term, add **no migration**,
and do not create a second role identity.

`lib/permissions/role-presentation.ts` maps **`FIXTURES_SECRETARY` →
"Fixture Secretary"** and nothing else; every role whose catalogue wording is not
in dispute keeps it, and an unknown key falls back to the key rather than to a
guess. Applied at the two places the catalogue label reached a person: the
permissions grid's role caption and `invitation_staff_role_options`, which feeds
the Invite Someone menu and the waiting-invitation descriptions. The key is
untouched and nothing authorises off the string.

**Still open for the schema/auth cleanup owner:** the key itself is
`FIXTURES_SECRETARY` in `public.role_definitions` and `FIXTURE_SECRETARY` in
`public.club_memberships` and `public.role_capability_defaults`. That is one role
with two identifiers, and presentation cannot fix it.

Reproduce: review walkthrough section **A** (Gordon Pike) then section **F**.

---

## L4 — a team page that contradicts itself

`app/(app)/teams/[teamId]/page.tsx` closes with:

> Only this club's Club Admin can edit team details or assign people.

It is gated on `!isClubAdminAnywhere(ctx) && !ctx.isSiteAdmin` — a **session-wide**
flag, of the same family the Step 0 audit already found being misused elsewhere.

Meanwhile the roster section on the same page is gated properly, on
`team.roster.manage` held at the team or club-wide. A Team Manager therefore sees
both at once: an "Assign an existing club member" control she is genuinely
entitled to use, and a sentence underneath telling her she is not.

Verified with the review fixture: Sian Lowry (Team Manager of Men's 1st Team, no
club-wide role) sees the assign control and the Coach/Manager choice on **her**
team, sees neither on Under 12 Boys, and sees the contradicting sentence on both.
The authority itself is correct throughout — only the sentence is wrong.

**Why it is not fixed here.** Step 2 owns the club-scoped Users & Permissions
concept. This is copy on the team surface, and Step 4 owns Teams; changing it now
would widen Step 2 into a step that has not been designed yet. It is recorded
rather than left, because it is the same class of defect the programme exists to
remove — one question, two answers.

Reproduce: review walkthrough section **I**.

---

## L5 — a suite whose verdict depends on what else is in the database

`supabase/tests/recipient_audience_engine.sql` does not seed its own people. It
picks them out of whatever the database happens to hold:

```sql
select cm.user_id, tp.team_id, t.club_id into v_team_only_admin, v_own_team_id, v_own_club_id
from public.team_permissions tp
join public.club_memberships cm on ...
where tp.permission in ('team_admin', 'coach', 'manager') and cm.role <> 'CLUB_ADMIN'
order by cm.user_id, tp.team_id
limit 1;
```

Installing the Step 2 review club changed which row that returns, and the suite
then failed:

> `FAIL 1 (A): a legitimate team staff member was refused their own team`

**It is not a product defect and not a Step 2 regression.** The proof is direct:

- the identical code passed this suite **0 failed** in the run immediately before
  the review club was installed;
- the selection query, run by hand afterwards, returns **Sian Lowry — Men's 1st
  Team — Step 2 Review RFC**, a review-club persona;
- re-running the suite inside a transaction that hides the review club's three
  `team_permissions` rows and rolls back selects the UAT club's team admin again
  and prints **`PASS 1 (A)`**.

The underlying reason is ordinary: the review club's Men's 1st Team has no
players, so `team_playing_group_summary` returns no playing group for it, and the
assertion reads that as a refusal.

There is a second fragility in the same block. Having selected a team-only admin
and recorded their club in `v_own_club_id`, the next statement **overwrites**
`v_own_club_id` with an arbitrary Club Admin's club:

```sql
select user_id, club_id into v_real_club_admin, v_own_club_id
from public.club_memberships where role = 'CLUB_ADMIN' and status = 'active' limit 1;
```

so `v_own_team_id` and `v_own_club_id` can afterwards describe two different clubs.

### Closed — the suite names its subjects

Fixed without weakening a single assertion and without removing or hiding the
review personas. Using the seeded UAT world was always the intent; choosing
*whoever sorted first in it* was not. Each subject is now resolved from the
seeded identity that was meant to play the part — `uat.team.manager@ovalball.test`
as the team-only staff member — and everything else hangs off that one anchor:

- the club is **that person's** club, and the Club Admin is **that club's** Club
  Admin. The old code overwrote `v_own_club_id` with whichever club the first
  Club Admin in the database belonged to, so sections B and C could be asking
  about a different club from section A's team;
- the sibling team is one at the same club the person **demonstrably does not
  manage**, instead of any other team — picking any other team was a coin toss
  that a person with roles at two teams would have lost while behaving correctly;
- the foreign club is one the Club Admin has no membership of, chosen by id;
- the ordinary guardian is the seeded `uat.guardian.one@ovalball.test`, not "any
  active guardian who is not an admin", which any other club's parent satisfied;
- the skip message now names **which** prerequisite is missing.

Result: **14/14 pass with the persistent review club installed**, selecting
exactly the same subject and team as the historical runs before that club
existed.

---

## L6 — an assertion that races the page it is reading

`scripts/browser-verification/64-password-recovery-journey.mjs`:

```js
const reveal = page.getByRole("button", { name: /sign in with email/i })
if (await reveal.isVisible().catch(() => false)) await reveal.click()
const link = page.getByRole("link", { name: /forgot|forgotten/i }).first()
record("S6B1-02 …", (await link.getAttribute("href").catch(() => null)) === "/forgot-password")
```

`getAttribute` on a locator that has not resolved returns null through the
`catch`, and null is not `/forgot-password`, so the assertion fails **silently as
a product defect** when it is really a timing loss. There is no wait for the
revealed panel.

Observed: the suite failed this one assertion (33 passed, 1 failed) inside a full
platform run while a second browser suite and a review session were sharing the
dev server, and passed **34/34** on an isolated re-run minutes later with no code
change in between. Nothing in the Step 2 or persona-policy work touches the login
page.

### Closed — it waits for the product condition, not for a duration

Two waits, both of which are allowed to fail so that the assertion still runs and
still reports the truth:

- the reveal button is waited for before it is clicked, because the login form is
  a client component and on `domcontentloaded` it does not exist yet — the old
  code's `isVisible()` returned false, the reveal was skipped, and the link was
  therefore never rendered at all;
- then the page is waited on until an anchor exists whose text matches
  *forgot* and whose `href` is `/forgot-password` — the exact condition the
  assertion is about.

No sleep, no global timeout change, no weakened assertion, no skip, and no
product change. Verified under the combined browser load that broke it.

---

## L7 — a second role-grant path, waiting for its contract step

`public.accept_invitation` and `public.get_invitation_preview` are the legacy
half of the invitation system. They read `public.invitations`, which has held
zero rows since `issue_invitation` began writing `access_invitations`, and
`accept_invitation` writes `club_memberships`, `invitation_teams`,
`access_review_items` and `notifications`. Both are still **granted** —
`get_invitation_preview` to `anon`.

Nothing can currently be granted through them because their table is empty. That
is a property of the data, not an authorisation boundary, which is why they are
recorded rather than left unremarked.

**Step 3 removed the application half** — `app/invite/[token]/`, the only caller
of either function, with no inbound link and no email template pointing at it.

**The database half is deliberately deferred by one release.** The currently
deployed application still contains that route; revoking EXECUTE or dropping the
functions in the same change would strand it between schema states, and the
programme rule is expand → deploy → contract. The contract step is:

```sql
revoke execute on function public.accept_invitation(text) from anon, authenticated;
revoke execute on function public.get_invitation_preview(text) from anon, authenticated;
drop function public.accept_invitation(text);
drop function public.get_invitation_preview(text);
```

to be applied **after this Step 3 release deploys**, not before.
`public.invitations` itself is retained: it holds no rows, dropping it is not
required to end its authority, and historical structures are not deleted merely
because the live path is obsolete.

---

## L6 — reopened, and a correction

**I reported this closed in Step 3. That was premature and I was wrong.**

The fix I made was real and is still in place: the assertion waits for the reveal
button to become visible and then for an anchor to exist with the expected
`href`, instead of reading the attribute the instant after a click. On that
evidence -- three standalone runs at 34/34 and one full platform run at 34/34 --
I called it deterministic.

It is not. Across the three full platform runs in Step 4 it failed twice
(33 passed, 1 failed) and passed once, while passing 34/34 every time it is run
alone, including immediately after each batch failure. So the waits removed one
race and something else load-sensitive remains.

**What it is not.** The enforcing CSP added in 6b.2d was the obvious suspect --
`next dev` does not nonce its own hot-reload scripts, so an enforcing policy
breaks hydration on the dev server that every browser gate runs against. That was
real, and it is why the policy is now enforced in production and report-only in
development. But the suite failed again after that change, so the CSP was not the
cause of this.

**What it costs.** One assertion, about whether `/login`'s forgotten-password
link carries `href="/forgot-password"`. The route exists and its own journey is
covered by the other 33 assertions in the same suite, so the security property is
not unevidenced -- but a gate that reports a product defect when the machine is
busy is a gate nobody will trust, which is the whole point of the ledger entry.

**Not fixed in Step 4**, because Step 4 is an authentication slice and tuning a
security suite's timing under load is its own piece of work with its own
evidence. Recorded honestly instead: **the last full platform run was 5180
passed, 1 failed, and this is the one.**

---

## L6 — root cause, and the correction to my correction

**Found.** The assertion needs `/login`'s forgotten-password link, which only
exists once React has hydrated *and* the form has been revealed -- `usePassword`
is client state that starts true, so the link is rendered by the component, not
by the server.

The wait I added in Step 3 waited for the reveal button to be **visible**. Next
server-renders that button, so it is on screen and looks clickable **before any
handler is attached**, and a click landing in that window does nothing at all.
Under a full batch the window is wide enough to hit. Visibility was the wrong
readiness signal: it proves the markup arrived, not that the application is
listening.

**Fixed** by waiting for what the reveal *produces* -- the password field -- and
re-issuing the click if it did not appear. That is not retrying until lucky: it
re-sends an interaction that provably had no effect, at most three times.

**Stress evidence:** 3/3 standalone at 34/34 after the fix, plus the full batch.
The two earlier Step 3 claims of closure were made on weaker evidence and were
wrong; this entry records that rather than quietly replacing it.

---

## L8 — an enforced CSP leaves the application dead

`script-src` bound to a per-request nonce with `'strict-dynamic'` is the right
policy and this Next version will not cooperate with it. Both documented routes
were implemented and tested against a **production build**:

- `x-nonce` on the forwarded request, which is how the framework's example passes
  the value to components;
- a `Content-Security-Policy` header on the **request**, which is the header the
  framework is documented to parse the nonce out of.

Neither produced nonced script tags. The result is un-nonced inline bootstrap
scripts, `'strict-dynamic'` then refusing the chunks they would have loaded, and
a production build that serves correct HTML and **never hydrates** -- verified by
`70-production-csp.mjs`, which asserts a real interaction rather than a status
code, and which failed exactly as designed.

**Shipped state:** the policy is sent `Content-Security-Policy-Report-Only` in
both environments, so violations stay visible and nothing can break. **The
transport headers are enforced** and always were safe --
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy`, `Permissions-Policy`, and HSTS in production.

**Why this is a decision and not a bug to grind out.** The three ways forward are
materially different security positions: allow inline script and lose the point
of the directive; enforce everything except `script-src`; or find this version's
actual noncing contract, which may mean a framework upgrade. The checked-in
design does not settle it, and taking that decision unattended is exactly what
§40 says not to do.

---

## L9 — clean boot versus the persistent review world

Slice 6b.2b adds a migration, so a clean empty rebuild is mandatory before it can
be called verified. The project's mechanism is `npx supabase db reset`, which
rebuilds the **working** local database -- the one holding the canonical review
world and the product owner's own review changes, which three standing
instructions say to preserve and not to repair.

A disposable database was attempted instead: `create database`, GoTrue's schema
dumped in, then the full chain. 338 of 524 migrations applied; the failures are
artefacts of the hand-built bootstrap (objects the dumped `auth`/`storage` schema
already contained) rather than of the chain, but that is a proof of my harness,
not of the migrations, and it is not good enough to call a clean boot.

**Needs the owner's call:** authorise a `db reset` once the review world has been
inspected, or stand up a second local Supabase stack for boot proofs. Until then
**6b.2b is implemented and tested but NOT clean-boot verified**, and Slice 6 is
therefore not complete.

---

## L8 — closed, and the cause was ours

Next 16.3.3 does support this. `app-render` reads the request's own
`content-security-policy` header and extracts the nonce from `script-src`
(`getScriptNonceFromHeader`), then stamps it onto the script tags it generates.
The proxy was already sending that header. Two things in **Ovalball** stopped it
working, and both are fixed.

**1. `/login` was statically prerendered.** A page generated at build time has no
request and therefore no nonce, so its bootstrap scripts shipped un-nonced;
`'strict-dynamic'` then refused the chunks they would have loaded, and the page
served correct HTML that never hydrated. It was the only static route in the
build, which is exactly why it was hard to see — every dynamic page around it was
fine. Proved by comparing the served HTML: `/`, `/join` and `/signup` all carried
`nonce="…"`, `/login` carried none. It is now `force-dynamic`, with the reason in
the file.

**2. The theme script had no nonce.** `next-themes` injects an inline
anti-flash script before paint, and it accepts a `nonce` prop that nothing was
passing. It was the single remaining refusal on every page. The root layout now
reads `x-nonce` and hands it over.

**Shipped:** the policy is **ENFORCED in production** —
`script-src 'self' 'nonce-…' 'strict-dynamic' https://challenges.cloudflare.com`,
no `'unsafe-inline'`, no `'unsafe-eval'`, no wildcard — and report-only in
development, where `next dev` injects hot-reload scripts the framework does not
nonce.

**Proof:** `70-production-csp.mjs`, **32/32** against a real production build.
Per-route nonce presence, zero violations on public and authenticated pages, the
application hydrating and responding to a real interaction under enforcement, and
no inline script served without the nonce that authorises it.

`style-src 'unsafe-inline'` remains, deliberately and separately: Tailwind and
React emit inline style *attributes* during hydration and there is no nonce path
for that form. Inline CSS is not script execution, script protection is
independent of it, and this is recorded as a hardening item for a later security
owner rather than an endpoint.

---

## L9 — closed, with a permanent harness

`scripts/isolated-clean-boot.sh` boots a **second Supabase project** through the
CLI's own path: a derived config with a different project id and every port
shifted, its own containers, the real `supabase/migrations` and the real seed.
`supabase start` on an empty project *is* the clean boot — the CLI creates the
database, installs the Supabase base schema, applies every migration in order and
seeds it.

The earlier hand-built attempt is exactly what this replaces: it invented a
bootstrap schema, 338 of 524 migrations applied, and every failure traced to the
harness rather than to Ovalball.

**The guard:** the script refuses to run if the derived project id has not
actually changed, and every command names the disposable project explicitly. The
canonical review world is never a target.

**Result:** migration chain from empty **PASS**; Step 4's objects verified for
existence, RLS, policy count, SECURITY DEFINER, pinned `search_path`, grants and
live behaviour; and the estate's own suites run against the fresh database —
`auth_flow_state_authority` 28/0, `definer_rpc_session_contract` 37/0,
`security_perimeter_guard` 6/0. The disposable project is destroyed afterwards
and the review world verified unchanged.

Steps 5–21 can now say **run isolated clean boot** without threatening it.

---

## L10 — Slice 7 is waiting on one setting, not on engineering

Step 5's requirement recovery is in
`docs/identity-auth/SLICE_7E_REQUIREMENT_RECOVERY.md`. The short version:

Every Q.3 master-control RPC passes through `internal.master_control_preamble`,
which calls `internal.require_recent_aal2(interval '10 minutes')`. Production has
**0 TOTP factors**, because TOTP enrolment has never been switched on in the
Supabase Auth settings. So those RPCs raise for everybody, including the Full
Site Admin — which is exactly what S7-4 already records as *present, unusable*.

The checked-in closure ledger makes **Stage 0 the prerequisite for Slice 7e**,
and Stage 0.1 is a dashboard change by the platform owner. Building 7e's user
interface first would ship thirteen tabs of controls nobody can operate, and
would make every test a denial-only test — which the programme does not count as
authority coverage.

**To unblock:** enable TOTP enrol/verify in production Auth settings (max factors
3), then enrol the existing Full Site Admin at `/account/security`. Verification
afterwards is read-only and can be done here.

---

## L10 update — Stage 0 verified, and it is not there yet

The owner reported Stage 0 complete. Read-only verification against the linked
production project says otherwise, and the authorisation is explicit that the
statement alone does not prove the boundary.

**Zero factor rows of any kind** — not one verified, not one unverified, and no
`security_events` row mentioning mfa, factor or totp. Enrolment writes the factor
row before verification confirms it, so even an abandoned enrolment leaves a
trace. Nothing did.

**Enforcement is still off** across all six groups, which is the important
safety fact: had it been switched on with zero factors, every privileged account
would have been locked out.

Full evidence and the unblock steps are in
`docs/identity-auth/STAGE_0_VERIFICATION.md`. Nothing was changed in production
and nothing was compensated for in code.

---

## L11 — a deep link into the application is dropped at sign-in

Found while verifying the route a Full Site Admin uses to enrol a TOTP factor.

Probed read-only against production:

```
/account/security  307 -> https://ovalball.co.uk/login
/security/enrol    307 -> https://ovalball.co.uk/login?next=/security/enrol
/account           307 -> https://ovalball.co.uk/login
/people            307 -> https://ovalball.co.uk/login
```

`/security/enrol` sits outside the authenticated layout and preserves where the
person was going. Everything behind the `(app)` layout does not: its gate sends
them to `/login` with no `next`, so after signing in they land on the dashboard
and have to navigate again. Step 4 made `safeNextPath` the single authority for
where a login finishes and proved that a legitimate continuation survives —
this is the other half, a gate that never offers one.

**Not a security defect.** Nothing is exposed and nothing is bypassed; Step 4's
rule that an unsafe or absent continuation falls back to the dashboard is exactly
what happens. It is a product-experience defect: every bookmark, every emailed
deep link and every shared URL into the application costs the recipient a second
navigation.

**Not fixed here**, because the instruction for this piece of work was to verify
and record without modifying anything. It belongs with the Identity/Auth 6b
family that owns the post-login destination.

**Practical consequence today:** somebody following a link straight to
`/account/security` while signed out should expect to arrive at the dashboard
after signing in. `/security/enrol` round-trips correctly.

---

## L12 — the button at the end of enrolment did nothing

Reported live, mid-enrolment: *"it won't let me click the 'I've saved them'
button it just doesn't click."*

```js
onClick={() => {
  router.push("/dashboard")
  router.refresh()          // <- cancels the push above
}}
```

`router.refresh()` re-renders the route the person is still on, and it ran on the
very next line, before the pushed navigation had landed. The push was discarded.
No navigation, no error, nothing to react to — which is exactly how it was
described.

**Nothing was at stake.** The factor is verified and the recovery codes are
issued and hashed **before** this screen is drawn; the button is the last step of
the journey and not part of it. Production confirmed it read-only at the time:
one `totp` factor `verified`, ten recovery codes issued and unused. The person
was already enrolled while looking at a button that appeared broken.

**Fixed** with a full navigation, `window.location.assign("/dashboard")`, which
is how the sibling flow in `account/security/security-manager.tsx` already moves
between these pages. It also happens to be what this moment needs: the session
has just gained a verified second factor, and the pages downstream should render
against that state rather than a client cache from before it existed — which is
what the `refresh()` was reaching for.

Worth keeping in mind: `push()` immediately followed by `refresh()` is a silent
footgun. This was the only occurrence in the authentication flows.

---

## L10 closed — Stage 0, and what the boundary actually is

Production now holds one **verified** TOTP factor and ten issued recovery codes,
confirmed read-only. Stage 0.1 and 0.2 are done.

Stage 0.3 — the part that matters — was proved **locally**, because proving it
means holding an AAL2 session and the owner's production session is not mine to
drive. `scripts/browser-verification/71-recent-aal2-authority.mjs`, **18/18**,
with a real factor enrolled, challenged and verified through GoTrue's own API
using a code computed from the secret it returns.

What it establishes, and the distinction is the whole point:

| | |
|---|---|
| AAL1 + full site authority | **refused** |
| A verified factor that exists but was not presented **on this session** | **still refused** |
| AAL2 | **succeeds**, with a real change to canonical state |
| The same AAL2 session, verification aged to 11 minutes | **refused** |
| …aged to 9 minutes | allowed — the window belongs to the verification, not the session |
| A fresh code | restores it |
| AAL2 **without** the capability | **refused** — MFA is not a substitute for authority |
| A revoked session whose JWT has not expired | **refused** |

Until a factor existed anywhere, this gate could only be observed from one side:
everything was refused, and a suite that only ever sees refusals cannot tell a
working boundary from a broken feature. That is why Stage 0 was worth waiting
for rather than working around.

The ten-minute boundary is exercised by ageing the `auth.mfa_amr_claims` row
GoTrue itself wrote — the record the predicate reads — rather than by sleeping or
by asserting an AAL2 that never happened. Secrets created by the harness are
destroyed with it.

---

## L13 — a Site Admin could change a roster placement they could not read

Found while building AB.1's Team Memberships tab, which needed both halves at
once for the first time.

`public.site_set_player_team_membership` lets a Site Admin add, end or move a
player's place on a team. `public.player_team_memberships` is readable only
through `team.roster.view` at **team** scope, `is_own_linked_player`, or
`is_active_player_guardian`. A Full Site Admin holds none of those for a club
they are not a member of — which is deliberate, and is the whole shape of Slice
7: Site Admin is a set of explicit site-scoped capabilities, never a blanket RLS
bypass.

The consequence is that "move this player to Under 14" was performable blind.
That is how somebody gets moved twice, or moved out of a team they were never in.

**The fix is not a wider policy**, and that distinction is the finding. Adding a
site clause to `player_team_memberships_select` would have handed every roster on
the platform to every administrator holding any site read capability, including
Support profiles that have no business with a child's team placement.
`20270505000000` adds one narrow per-person definer read instead, gated on
`site.users.view`, answering only about the subject's own linked player or a
child they actively guard. `S7E-21` and `S7E-22` assert the policy is *still*
narrow, so a later simplification cannot quietly widen it.

---

## L14 — the timelines could not see the events their own slice writes

Found by the browser suite, which added a club membership through the product and
then looked for it on the Membership History tab.

`site_add_club_membership` emits `site.membership_added`.
`site_membership_history` matched `membership.%`, `site.club_%` and `club.%`.
Neither matches the other, and nothing had ever read the output, because until
Slice 7e the timelines had no screen — the reconciliation's own words were that
they "answer a question no screen asks".

Across the master-control family, **seven of the sixteen event types were
displayed by nothing**: `site.membership_added`, `site.membership_transitioned`,
`site.role_revoked`, `account.password_reset_forced`, `account.setup_resent`,
`session.revoked_by_admin`, the four `site_admin.*` grant events and
`user.created`. "Why is this person no longer a Club Admin" and "who ended their
sessions on the 3rd" were unanswerable inside the product while the rows sat in
`security_events` the whole time.

`20270507000000` makes the membership and team timelines discriminate on the
**scope column** — an event carrying a `team_id` is team history, one without is
membership history — rather than on the shape of the event name. A name is a
label and drifts; `club_id`/`team_id`/`player_id` are what the event is about, so
a new event type is covered the day it is written. `site_account_history` is
added for what is none of those, and surfaces on Audit History.

The general lesson, and the reason this is in the ledger rather than only in the
slice report: **a read that nothing reads is not verified by anything.** Both
halves existed and passed their own tests for two slices.

---

## L15 — the perimeter manifest declared consumers that did not exist

`supabase/security/perimeter-manifest.json` records, for most browser-callable
functions, the application file that calls them. Nothing had ever checked those
declarations. Seventeen described the design's intent rather than the code's
state — `site_revoke_sessions` was recorded as consumed by
`app/(app)/admin/users/actions.ts`, which is the CSV export — and four named
files Convergence Step 3 had deleted.

A false declaration is worse than no declaration: a reviewer reading the manifest
would conclude the function had a caller and that the named file was where to
look.

Slice 7's declarations are now true, and
`supabase/tests/js/perimeter_manifest.test.mts` checks every one. The fourteen
that predate the check belong to other slices and are declared in
`supabase/security/manifest-consumer-baseline.json`, **which may only shrink** —
the same shape as the role-literal baseline. Weakening the check until the
existing estate passed would have left nothing checking anything.

---

## L16 — `is_site_admin` survived retirement inside a view

The perimeter manifest has carried this as a declared legacy bypass since Slice
1: *"internal.is_site_admin() in RLS and definer functions (Phase 1: 140
policies) — retire in Slice 7 with explicit site capabilities."*

Slices 4 and 7a–7d took policies to 0 and functions to 0, and every guard agreed.
One reference survived, in the **`WHERE` clause of `admin_club_overview`** — and
it survived precisely because the guards that drove the retirement count policies
and function bodies, and a view is neither.

It mattered rather than being tidy. `is_site_admin()` answers "is there an active
row in `site_admins`", which is true for a Read-Only Site Admin, a Message
Moderator and a Club Data Admin alike — the undifferentiated authority the seven
profiles exist to replace. The gate is now `site.clubs.view`.

With nothing left calling it, `20270506000000` **drops** the helper rather than
leaving it as a convenience, and `S7E-32` extends the retirement guard to view
definitions so the next helper cannot hide in the same place.

---

## L17 — the club directory is column-restricted for strangers and not for members

`supabase/security/perimeter-manifest.json` has carried this as a declared legacy
bypass since Slice 1: *"authenticated reads every `club_directory` column
(`notes`, `official_email`) because Site Admin pages select `*` — column-restrict
when Site Admin reads move to site-capability RPCs (Slice 7)."*

Slice 7e moved the **user** reads behind `site_search_users`, which is what made
it worth measuring the club half rather than leaving it as a sentence.

`anon` is already restricted to 17 public directory facts. `authenticated` holds
SELECT on **every column**, and `club_directory_select` admits any live session
to every active row. So any signed-in Ovalball account can read
`notes` for **1,385** clubs and `official_email` for **29**.

Severity is genuinely low: directory research provenance and a club's published
contact address, not personal data. It is recorded anyway, because the manifest
says this exposure should not exist and nothing had checked whether it still did.

**It is not fixed here.** Column-restricting `authenticated` means giving the
Site Admin club pages their own reads, and those pages — `app/(app)/admin/clubs/*`
— are the Site Admin **club** surface, which Convergence Step 6 owns. Fixing it
from Users & Access would be reaching into another step's territory to make a
number look better, which is exactly what this ledger exists to prevent.

---

## L18 — suite 62 failed a batch and could not be made to fail again

Recorded rather than quietly re-run, because this estate has been here before
(L6) and the rule learned there was that **a batch failure is the signal**.

On the first Step 6 confirming run, `62-site-admin-master-control` reported 7
passed and 5 failed. The five were consecutive from `S7-06` — the positive
control that Create User actually creates an identity — and everything
downstream of it, which is the shape of the preceding step having silently not
worked rather than five independent faults. `profiles=0`, so nothing was created.

**It has not been root-caused.** Against it:

- `71-recent-aal2-authority` (18) and `72-totp-enrolment-journey` (10) passed in
  the same batch, so the AAL2 boundary and the enrolment journey were both
  working;
- `73-users-access-detail-tabs` (41) passed in the same batch, and it performs
  the same authenticator enrolment on the same shared UAT administrator and
  creates identities through the same RPC;
- suite 62 then passed **18/18 standalone, twice**, and **18/18 in the next full
  batch**.

What was done: the failure was made diagnosable rather than papered over. The
assertion used to wait 20 seconds for "Account created" and, on timeout, print
the whole page body — which is the navigation shell, so the failure told you
nothing. It now races the success and refusal conditions, and its detail names
the route, the refusal text and whether the row actually landed. The timeout is
45 seconds because the work behind the button is a service-role auth identity, a
master-control RPC and an invitation issue — not to wait out a race, and the
assertion still requires the real outcome.

**This is open.** The next occurrence will say where it was and what it saw,
which is what the current evidence could not.
