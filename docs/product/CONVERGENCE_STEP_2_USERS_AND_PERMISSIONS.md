# Convergence Step 2 — Users & Permissions

**Scope:** the Club-scoped Users & Permissions concept, plus the Team- and
Site-scoped variants of the same concept.
**Status:** built, tested, banked. **Not released.** Step 3 not started.

---

## 1. What Step 2 found before it built anything

The addendum's instruction was to establish how Ovalball handles every
people/access function today *before* designing anything. That produced a
complete inventory — 27 server actions across 6 surfaces, all of them calling a
canonical RPC — and four defects that only an inventory could surface.

### 1.1 Waiting invitations could never be seen, and revoking one was unreachable

`/people` listed pending invitations from **`public.invitations`**. Since Slice
5, `issue_invitation` — the authority the Invite Someone form on that very page
calls — has written **`public.access_invitations`**. `public.invitations` holds
zero rows and has held zero rows the whole time.

The consequences compounded:

- the Pending Invitations section could never render a row, so a club that had
  invited six people saw no evidence any of them existed;
- `revokeInvitation` wrote `status = 'revoked'` into that same empty table. The
  `UPDATE` matched nothing, returned no error, and the action reported success —
  but no row was ever drawn to press the button on, so nobody found out;
- there was therefore **no way at all** for a club to withdraw an invitation it
  had sent by mistake.

This was live, and it is the single most consequential thing Step 2 fixed.

### 1.2 Team roles could be read and not changed

A person's team roles appeared on `/people` as inert chips. `removeTeamAssignment`
existed and called `remove_team_access`, but the row data carried no
`team_permissions.id`, so the control it served could not be drawn.

### 1.3 A team role could only be given from the team's own page

`set_team_access` is fully built and properly authorised, and `assignTeamMember`
on `/teams/[teamId]` has called it since the team surface was built. What did not
exist was the **club-scope** way in: a Club Admin looking at one person could see
every team role they held and change none of them, and giving somebody a role at
three teams meant visiting three team pages.

*(An earlier draft of this document said `set_team_access` had no caller at all.
That was wrong — it had no caller at club scope.)*

### 1.4 A screen decided whether to let a stranger in, and printed a database value

The club join-request row read **“Says they are: BASIC_USER”**. Three of the four
role-label maps in the product were local copies of
`lib/permissions/role-labels.ts`, which is how that survived.

### 1.5 And the question nobody could answer

`public.explain_access` re-runs `internal.capability_decision` — the exact
resolver the enforcement path runs — and returns the decisive rule, a reason
code, the decisive source and the full trail. It has been granted to
`authenticated` since the capability engine landed and **had never appeared on a
screen**. A Club Admin could see *what* somebody held and never *why*.

---

## 2. What was built

One centre at `/people`, one page about one person, and nothing new underneath
either. Every control calls the RPC that already owned the change.

| Surface | What it is |
|---|---|
| `/people` | **Users & Permissions** — Waiting On You (4 queues), People, Invite Someone, Roles & Access |
| `/people/[membershipId]` | **One person's access** — club role, team roles (add/remove), and why each permission is allowed or not |
| `/club/permissions` | unchanged authority; rows now identify the person by email as well as name |
| `/club/join-requests`, `/club/settings/guardians`, `/club/settings/safeguarding`, `/guardian-requests` | unchanged; each now has a permanent door from the centre |

**Waiting On You** collects four decisions that were reachable from four
unrelated places: club join requests (here), player join requests (a sidebar
link), guardian requests (a bare link on this page) and pending invitations (a
section that could never render). Each still belongs to the authority that owns
it — the two with their own pages keep them.

**Roles & Access** names the three specialist authorities plus the guardian
queue. They were *not* merged in: a capability override grid, a guardianship
register and a statutory appointment with a two-person state machine are
genuinely separate things, and collapsing them would be merging concepts rather
than converging them. What was wrong was that from the page about access there
was no way to know they existed.

**No 184-capability wall.** The person page explains exactly the **ten**
capabilities `/club/permissions` already publishes, imported from
`app/(app)/club/permissions/groups.ts` rather than restated, so the two screens
cannot disagree about what this club decides. Its count agrees with the grid's
own count (verified live: *2 of 10 allowed* on both).

**No parallel permissions table.** Nothing was added to the schema. No
migration. No new predicate.

---

## 3. Zero functionality loss

Captured in a real browser against a deliberately busy club — one of every
waiting thing — before and after. Raw captures: `before.json` / `after.json`.

| Function (before) | Where it was | After | Evidence |
|---|---|---|---|
| Change a person's club role | `/people` row select | same control, same place | `G1`, 4 selects before → 4 after |
| Remove a person from the club | `/people` row, reason required | unchanged | `G2` |
| Invite someone | `/people` form | unchanged | `G3` |
| Per-team invitation roles | invite form, 7 team selects | unchanged, 7 selects | before/after capture identical |
| Club role options on the invite | None / Club Admin / Fixtures Secretary / Volunteer | unchanged | before/after capture identical |
| Approve a club join request | `/people` | same control, under **Waiting On You** | `G4` |
| Decline a club join request | `/people` | same | `G4` |
| Guardian requests link | `/people`, unconditional link | permanent door in **Roles & Access**, plus a counted queue when non-empty | `F` |
| Approve/decline a player join request | `/club/join-requests` | unchanged page; now also a counted entry point | `F`, `A2` |
| Guardians & Players | `/club/settings/guardians` | unchanged (13 links, 13 buttons before and after) | before/after capture identical |
| Safeguarding Officer | `/club/settings/safeguarding` | unchanged; nomination → PENDING_CONFIRMATION → AN‑6 confirmation state machine untouched | before/after capture identical |
| View Permissions | `/club/permissions` | unchanged grid; rows gained the person's email | `F`, capture |
| Team join-code administration | `/teams/[teamId]` | untouched | not in Step 2's blast radius |
| **View pending invitations** | `/people` — **never worked** | works | `B1`–`B3` |
| **Revoke an invitation** | `/people` — **unreachable** | works, recorded with who and why | `B4`, `B5`, `C5` |

**FUNCTIONS LOST: 0.**

**Functions gained: 4.** See a waiting invitation and what it will grant; revoke
one; give an existing member a team role from the page about that person; and be
told *why* somebody can or cannot do each thing.

One near-miss is worth recording because it is exactly the failure mode the
addendum was written against. Moving the guardian-requests link into **Waiting On
You** made it disappear whenever the queue was empty — a door removed, not a
queue tidied. It is now a permanent entry in Roles & Access, and `F` pins that.

---

## 4. Rules discovered rather than assumed

- **Self-assignment of a team role is allowed at club level.** `set_team_access`
  refuses it from SITE and TEAM_ADMIN callers only. A Club Admin already holds
  authority over every team, so putting their own name against the U14s records
  who is doing the job rather than widening what they may do. A first draft of
  the test asserted the opposite and failed; a first draft of the UI hid the
  control on your own record, which would have taken away something the club is
  entitled to do. Both were corrected and the real rule is pinned (`B3`).
- **Coach and Team Manager require an adult record.** The O.1 rule refuses a
  staff role to anybody whose profile does not show they are an adult. The centre
  does not pre-empt it; the refusal arrives from the authority, in its own words.
  The browser fixture has to seed dates of birth or the journey cannot run at all.
- **`view_only` is not a role a club hands out.** It is what a parent or player
  holds at a team, arriving through guardianship and squad membership.
  `TEAM_STAFF_PERMISSION_OPTIONS` is a *filter* of the canonical list, not a
  shorter copy, so a future role cannot appear in one and not the other.

---

## 5. Team and Site scope

Both variants of the concept already exist, and Step 2 deliberately did not
rebuild either.

- **Team scope** — `TeamPeople` on `/teams/[teamId]`: tabs for Coaches, Parents &
  Guardians, Players and Requests, with assignment through the same
  `set_team_access`. It kept its own copy of the three role labels; that copy is
  gone, and it now imports the canonical list.
- **Site scope** — `/admin/users` and `/admin/users/[userId]`: Account, Club
  Memberships, Family Relationships, Pending Requests and Audit. This is the same
  concept at platform scope and is in some respects ahead of the club one.

**One deliberate gap, stated rather than filled.** The site person page has no
“why can they do this” section. `explain_access` accepts a Site Admin caller, but
there is no site-scope capability catalogue equivalent to the club's ten, and
inventing one to have something to explain would be exactly the parallel
permissions table this programme forbids. That catalogue is a product decision,
not an implementation detail.

---

## 6. Volunteer

`Volunteer` appears in the invite form's club-role options (from
`invitation_staff_role_options`, the database's own catalogue) and produces no
club-wide role today. This is a **Slice 8 dependency**, recorded here rather than
worked around: no machinery was invented to make the word mean something, and
nothing was removed to make the screen tidy.

---

## 7. Documented risks not fixed in Step 2

- **`lib/email/recipients.ts` has a `club_invitation` recipient branch that reads
  the dead `public.invitations` table.** It has no caller — `createInvitation`
  uses the `access_invitation` branch, which reads `access_invitations`
  correctly — so nothing is broken today. It is the same dead-table hazard as
  §1.1 and the next person to need an invitation recipient may find it first.
  Not removed here because it is an email-architecture object and broad email
  work is explicitly out of scope.
- **Two members of the local UAT club have blank names**, so they render as
  “Unknown” / “Club member”. This is fixture data, not a product defect — the
  fallback is correct behaviour. The permissions grid now carries the email
  alongside, so such a row is still identifiable.

---

## 8. Evidence

| | |
|---|---|
| `supabase/tests/users_and_permissions_authority.sql` | 24 assertions — explain_access disclosure and agreement with enforcement, set_team_access refusals, revoke_invitation authority, admin-view secret safety |
| `supabase/tests/js/users_and_permissions_architecture.test.mts` | 11 assertions — canonical sources, no dead-table reads, no leaked reason codes |
| `scripts/browser-verification/68-users-and-permissions.mjs` | 29 assertions in a real browser against a busy club, self-cleaning |
| `scripts/run-platform-tests.sh` | **4949 passed, 0 failed across 237 suites** |
| Browser journeys re-run | `66` 19/19 · `67` 28/28 · `68` 29/29 |

The assertion that matters most is `A3`/`A4`: what the administrator is *shown*
is compared against what the member actually *meets*, taken from opposite ends —
`explain_access` in the admin's session, `internal.can` inside the member's own.
A screen that disagrees with the gate is worse than no screen, because it is
believed.

`H1`/`H2` pin that hiding is never the boundary: an ordinary member typing
another person's access URL is sent away by the server, not merely left without
a link.
