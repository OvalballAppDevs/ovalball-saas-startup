# Convergence programme ledger

Findings that are real, reproducible, and **deliberately not fixed where they
were found**. Each one names the step that owns it, so that the next person
reaches it through the programme rather than by tripping over it.

A finding leaves this ledger only when the owning step closes it, or when the
product owner rules that it is not a defect.

| id | finding | found in | owner | status |
|---|---|---|---|---|
| L1 | `lib/email/recipients.ts` `club_invitation` branch reads the dead `public.invitations` table | Step 2 | **Step 3 — Invitations & Joining Product Closure** | open |
| L2 | A Safeguarding Officer nomination in `PENDING_CONFIRMATION` is described two contradictory ways and never as pending | Step 2 manual review preparation | awaiting product owner's ruling | open |
| L3 | The same club role is worded "Fixtures Secretary" in the role catalogue and "Fixture Secretary" everywhere else | Step 2 manual review preparation | awaiting product owner's ruling | open |
| L4 | The team page tells a Team Manager that only a Club Admin can assign people, directly beneath the assign control she may legitimately use | Step 2 manual review preparation | **Step 4 — Teams** (provisional) | open |
| L5 | `recipient_audience_engine.sql` picks its subject from whatever the database happens to contain, so an unrelated club appearing changes its verdict | Step 2 manual review preparation | test quality — awaiting product owner's ruling | open |

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

**Why it is not fixed here.** It was found while preparing the manual Chrome
review, after the Step 2 unit was banked, and the instruction for that gate was
to prepare and stop. It is a presentation decision about a statutory appointment
and belongs to the product owner, not to a tidy-up.

Reproduce: review walkthrough section **H**.

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

**Why it is not fixed here.** The label lives in a database table, so correcting
it is a migration, and Step 2 deliberately added none. Which spelling is right is
a product decision — "Fixture Secretary" is the majority usage and the one
`role-labels.ts` already settled on, but the catalogue is the older authority.

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

**Why it is not fixed here.** Changing a test to accommodate a fixture is how a
suite stops meaning anything, and the instruction for this gate was explicitly not
to weaken tests. The right correction is for the suite to seed its own club and
people the way every other suite in the set does, and that is its own small unit
of work for the product owner to schedule.

**Until then:** the suite passes on a database without the review club, and fails
while the review club is installed. Removing the review fixture restores it.
