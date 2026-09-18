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
| L1 | `lib/email/recipients.ts` `club_invitation` branch reads the dead `public.invitations` table | Step 2 | **Step 3 — Invitations & Joining Product Closure** | open |
| L2 | A Safeguarding Officer nomination in `PENDING_CONFIRMATION` was described two contradictory ways and never as pending | Step 2 manual review preparation | Step 2 | **closed** — one appointment reader, one wording |
| L3 | The same club role is worded "Fixtures Secretary" in the role catalogue and "Fixture Secretary" everywhere else | Step 2 manual review preparation | presentation mapped in Step 2; **the catalogue key/label inconsistency stays open for its schema owner** | partly open |
| L4 | The team page told a Team Manager that only a Club Admin can assign people, directly beneath the assign control she may legitimately use | Step 2 manual review preparation | Step 2 | **closed** — the sentence asks the same flags the controls ask |
| L6 | `64-password-recovery-journey` S6B1-02 read a link's `href` immediately after revealing the panel it lives in, and failed under concurrent load | Step 2 persona-policy work | test reliability | **closed** — it waits for the product condition |
| L5 | `recipient_audience_engine.sql` picked its subject from whatever the database happened to contain, so an unrelated club appearing changed its verdict | Step 2 manual review preparation | test isolation | **closed** — the suite now names its subjects |

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
