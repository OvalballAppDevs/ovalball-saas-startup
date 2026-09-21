# Convergence Step 10 — archaeology

**Team Experience.**

Read before anything was designed, from the checked-in programme records and
the running system.

---

## 1. What the programme already recorded

`CONVERGENCE_STEP_0_MAP.md` is blunt about this domain, and its findings are
this step's brief:

> **TEAM STAFF.** Nav is Dashboard, the team's Calendar, Fixtures, Player
> Requests, Messages. `/teams` (the list) is **club-authority-gated and refuses
> them**, while `/teams/<id>` renders — so **their own team page is reachable
> only by URL**.

> **PLAYER.** Fixed six-link nav. No team page, no availability surface of their
> own.

Step 0's ownership table assigns Step 10: *"Team experience and visual design;
availability counts"*.

## 2. What the Team page actually was

Measured by reading `app/(app)/teams/[teamId]/page.tsx` (260 lines) at
`8c2567f`. In order, it rendered:

1. a back link to `/teams`;
2. the team's display name, plus a **Folded** chip when inactive;
3. **Team settings** — the identity editor — for people who may manage it, or a
   single line of label text for everybody else;
4. `TeamPeople` — the roster and staff editor;
5. the join-code section;
6. a link to Team News;
7. the lifecycle section (fold / restore);
8. one explanatory sentence about what the viewer may not do.

**That is an administration screen.** Of the questions §0 says a team page must
answer — what is happening next, fixtures, results, training, availability,
calendar, where Match Centre belongs, who the staff are, what I am to this team
— it answered **none**. A parent opening it could not tell from the page that
they were a parent.

The authority resolution on it, by contrast, is exact and was left alone:
`canView`, `canManage`, `canAssignTeamAdmin`, `canManagePeople`,
`canManageJoinCodes` and `canPublishTeamNews` each ask a specific capability at
a specific scope, with comments recording why each is not one of the others.

## 3. What already existed to consume

| need | canonical source | new work required |
|---|---|---|
| fixtures, results, training in one list | `lib/agenda/load.ts`, the reader the Calendar and family agenda already use | none |
| the availability answer | Step 9's `AttendanceAnswer` + `respondFromAgenda` | none |
| home side named first, match presentation | Step 7's `lib/fixtures/presentation.ts` | none |
| Match Centre identity and return path | Step 7's `lib/fixtures/return-context.ts` | **one declared surface** |
| club crest and theme | Step 6's `lib/app-context/club-logo.ts` | none |
| roster and staff | `public.team_people` | none |
| capability decisions | Step 8's engine | none |
| media storage and upload | `club-news-media`, used by club article hero images | **one column** |

**Almost nothing needed building. Almost everything needed connecting.**

---

## 4. Findings

### F1. A guardian could not open their own child's team page

`canView` required `activeClubId(ctx, activeContext) === team.club_id` **and**
the capability. A guardian in All Children mode has **no active club by
design** — a family view is deliberately not scoped to one — so
`activeClub` was null and every parent was redirected to `/dashboard`.

The conjunct was the right instinct aimed at the wrong clause: the leak it was
written against was a **session-wide** one ("does this account hold club
authority anywhere"), and `team.team.view` is not that — the engine resolves it
at this team, inheriting from this team's club only. The club scoping belongs
on `canManage`, which is the club-wide authority, and that is where it stays.

Found by this step's own browser journey at B1, not by reading.

### F2. There was no way to ask what a person is to a team

Ovalball knows, in four canonical places, that somebody is a coach here, a
manager there, a player in the Men's 1st and the parent of two children in the
minis. No surface could ask *"what am I to THIS team"* without assembling that
itself — which is how four surfaces come to disagree about one person.

### F3. A team page was not a place a fixture could be returned to

`RETURN_SURFACES` is Step 7's deliberate allowlist, and `/teams/<id>` was not on
it — so a fixture opened from a team sent the person back to `/fixtures`.
Adding it needed the allowlist to admit **one** id-carrying path without
becoming a pattern: the pathname must be the declared path plus exactly one
segment, and that segment must be a uuid.

### F4. `PG` already holds `team.team.view`

Measured in `bundle_capabilities`: the Parent/Guardian bundle carries
`team.team.view` at team scope, as do Coach, Player and Team Manager. The
capability model was already right; only the page's gate was not. **No
capability was added or widened in Step 10.**

### F5. There is no public team surface, and this is not an omission

No route, view or projection presents a team publicly. `public_club_fixtures`
and `public_venues` are Step 7's deliberate public projections and neither
carries a roster, a relationship or an availability answer. Recorded as **NOT
APPLICABLE** rather than invented: a private youth roster is exactly what a
public team page would leak.

### F6. Team covers had no home, and did not need a new one

`teams` had no image column, and `club_articles.hero_image_path` +
`club-news-media` is the media architecture the product already uses for
identity imagery. One column reuses it; a second storage path, pipeline or
permission model would have been the defect.

---

## 5. L3's key half — the exact checked-in definition

Recovered rather than remembered, because the handoff and the ledger disagree.

The ledger says, verbatim:

> **Still open for the schema/auth cleanup owner:** the key itself is
> `FIXTURES_SECRETARY` in `public.role_definitions` and `FIXTURE_SECRETARY` in
> `public.club_memberships` and `public.role_capability_defaults`. That is one
> role with two identifiers, and presentation cannot fix it.

and assigns it to **Slice 10**, which is
`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` §R's **Identity/Auth Slice 10 —
Legacy retirement**:

> Drop compatibility columns and views (`account_status`,
> `club_memberships.role/status/authority_suspended*`, `team_permissions`,
> **`role_capability_defaults`** …). Acceptance: zero references in CI; full
> runner, clean boot and all browser suites green; **production usage telemetry
> zero for 30 days before each drop.**

**Identity/Auth Slice 10 is not Convergence Step 10.** They share a number and
nothing else. Measured today: `club_memberships.role` holds 23 rows,
`role_capability_defaults` holds 122, and 103 files still reference the
`FIXTURE_SECRETARY` spelling.

Its acceptance condition includes thirty days of zero **production** telemetry,
and Ovalball has released nothing. No code change in this step can satisfy it.
Disposition in §6 of the report.
