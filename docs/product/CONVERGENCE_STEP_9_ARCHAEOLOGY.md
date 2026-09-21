# Convergence Step 9 — archaeology

**Parent / Player / Family.**

Read before anything was designed, from the checked-in programme records and
the running system. Every claim says which.

---

## 1. What the programme already recorded

`docs/product/CONVERGENCE_STEP_0_MAP.md` is unusually specific about this
domain, and it is the origin of the "family bugs" the backlog refers to:

> **PARENT/GUARDIAN.** Per-child cards with club, team, next event and four
> actions each. The mobile drawer lists **All Children + each child by name** —
> the context switcher inline, which is exactly right. Known backlog defects
> (**Add Child inconsistency, child identity showing the wrong person,
> player-shown-as-Parent/Guardian, additional-parent workflow, child→adult
> handover**) are carried to Step 9 unresolved.

It also records the Parent/Guardian journey as *"the best journey in the
product"*, and the Player context as *"coherent, thin — no team page, no
availability surface of their own"*.

Step 0's ownership table assigns Step 9: *"Family/add-child/add-parent ·
child→adult · availability"*.

The identity programme's own register (`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md`)
carries four family rows, all **CLOSED**, which is the reason Step 9 is a
reconciliation rather than a build:

| id | finding | resolution |
|---|---|---|
| H-1 | Team staff bypass family/roster approval | no write policy on `player_team_memberships` |
| H-2 | Guardian invite links any child | canonical guardian state machine |
| H-3 | `team_people` exposes child/guardian pairs | object gone |
| H-4 | Guardians self-approve additional guardians | acceptance RPC required |

---

## 2. What exists — measured against the running system

### The canonical model, and it is not one table

| concept | canonical home | note |
|---|---|---|
| person / identity | `auth.users` + `public.profiles` | |
| player | `public.players` — `first_name, surname, date_of_birth, user_id, playing_pathway, avatar_storage_path` | `user_id` is the player's own account, and is **nullable**: most children have none |
| family relationship | `public.guardians` | 24 columns including `state`, `status`, `source`, `verification_state`, `confidential`, and a full revocation trail |
| club membership | `public.club_memberships` | separate, and separately suspendable |
| team placement | `public.player_team_memberships` | separate again |
| role | `public.role_assignments` | Step 8's |
| capability | the engine | Step 8's |

**Seven concepts, seven homes.** Nothing in Step 9 collapsed any of them.

### Relationship provenance is already canonical, and is not a boolean

`guardians_source_check` permits exactly eight origins:

```
GUARDIAN_INVITATION · LINK_REQUEST · ADDITIONAL_GUARDIAN_REQUEST ·
SELF_ADDED_CHILD · CLUB_CREATED · SITE_ADMIN_ASSIGNMENT ·
DUPLICATE_RESOLUTION · LEGACY_BACKFILL
```

Every relationship knows how it came to exist. Step 9 flattened none of it.

### The family surfaces on disk

`/parent/children` (add a child, invite a player account, request a child link,
add another guardian, avatars) · `/parent/players/[playerId]/access` ·
`/details` · `/subscription` · `/player/join` · `/guardian-requests` ·
`/club/settings/guardians` · `/guardian-invite/[token]` ·
`/player-invite/[token]` · `/dashboard` family panel · `/agenda` ·
`/calendar` · Match Centre.

### The additional-guardian workflow ALREADY EXISTS

`addAnotherGuardian` → `request_additional_guardian`, answered by
`respond_to_additional_guardian_request`. H-4 records that a guardian cannot
self-approve: acceptance by the intended recipient is required. The Step 0
backlog item is **built**; what it lacked was proof, which Step 9 supplies.

### The player-account link already exists and is bound

`invitePlayerAccount` → `issue_invitation(PLAYER_ACCOUNT, p_player_id, p_email)`
→ `/player-invite/[token]` → `accept_player_account_invitation`. The outcome
names the player record, which is the Phase 0 unbound-invitation vulnerability's
fix, and `public.player_account_invitations` carries the binding.

### AVAILABILITY — the whole model already existed

This is the largest finding, and it reversed the shape of the step.

`public.player_fixture_attendance` carries `fixture_id`, `training_session_id`
**and** `event_id`: **one canonical attendance record for fixtures, training and
club events.** §22's question is answered by the schema — training is already in
the canonical model, and inventing a second attendance system would have been
the mistake.

Three canonical writers exist and all three have UI callers:
`respond_to_attendance`, `respond_to_training_attendance`,
`respond_to_event_attendance`.

The canonical states are `ATTENDING`, `CANNOT_ATTEND`, `UNSURE`, and **no row at
all** for "not answered yet" — Step 7's rule that absence is never zero.

**Who may answer is decided in one place**,
`internal.resolve_attendance_response_source`, and it is complete:

| caller | outcome |
|---|---|
| an active guardian of the player | `guardian` |
| the player themselves, 18+ | `player` |
| the player themselves, 16 or 17 | `player`, **only** with `approve_own_attendance` recorded by a guardian |
| the player themselves, under 16 | refused |
| anybody else — including the team's own Coach | refused |

That staff cannot answer is a product decision, not an omission: availability is
the family's answer. Step 9 tests it rather than changing it.

---

## 3. Findings — what Step 9 actually had to do

### F1. The answer was always one navigation away

`/agenda` counted what was outstanding, said *"N activities need your
response"*, and then told the parent, in its own copy:

> **"Open a fixture to change whether you can make it."**

Every answer required leaving the list. For a parent with two children and four
things to answer on a Tuesday evening, that is four round trips through a
surface built for reading a match.

**This is the step's central product gap**, and it needed no new data, no new
state and no new authority — only the canonical action on the row.

### F2. A player was shown as a parent of themselves

`lib/app-context/active-context-rules.ts` turns every surviving
`team_permissions.view_only` row into a `kind: "parent"` context.
`view_only` is the Slice 2 compatibility path and was used for **both** parents
and players before the canonical relationships existed, and the loop deduped
against guardian relationships but **not** against the viewer's own linked
player teams.

So a linked player with a legacy `view_only` row on their own team was offered a
context captioned *"Parent / Player (view only)"* that framed their own rugby as
somebody else's child. **This is Step 0's recorded
"player-shown-as-Parent/Guardian" defect**, and this is where it comes from.

### F3. At eighteen, nothing happened — and the adult could do nothing about it

`internal.player_contact_eligibility` returns **every active guardian regardless
of the player's age**, and so does `resolve_attendance_response_source`. The
relationship stays active, every guardian keeps the access they had the day
before, nobody is told, and there is no state anybody can read.

Worse, the adult had no remedy: `remove_guardian_relationship` requires
`family.relationship.remove` **at the club**, which is a staff capability. The
one person whose data it is could not act on it.

**This is "child→adult handover", and it was not merely unbuilt — it was
unreachable.**

### F4. A nullable comparison in an authority check fails OPEN

Found by Step 9's own test suite, in Step 9's own new code, before it shipped.
`v_user = internal.actor()` where `v_user` is a player's nullable `user_id`
yields NULL, so `false or NULL or false` is NULL, and `if not (NULL)` does not
fire. Every unrelated caller would have been allowed to ask about a child with
no account. Recorded here because the shape is general and the guard against it
is now in the clean-boot proof.

---

## 4. What Step 9 owns, and what it does not

| owns | |
|---|---|
| the response experience on the surface a family already reads | F1 |
| a player not being a parent of themselves | F2 |
| the adult-transition **rule and state**, and the adult's own decision | F3 |
| proving who may answer, for whom, from where | §17 |
| proving the Step 7 count and the Step 9 answer are one record | §20 |

| does not own | owner |
|---|---|
| the proactive age-18 notification on the day | **no background-processing owner exists yet** — see the report's disposition |
| training recurrence splitting | Training Management (L23) |
| the broader Team product | Step 10 |
| community, rewards, polls, kudos | Step 11 |
| invitations themselves | Slice 5; Step 9 reuses them |
| the application-shell contrast debt | L22's owner |
