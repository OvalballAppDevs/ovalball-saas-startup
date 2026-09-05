# Ovalball Relationship Registry

Status: living document, first drafted during the Master Architecture Pass (2026-09-03).
This is the canonical map of "who is allowed to do what, to which resource" across Ovalball. Any
new feature that needs to know "does this user have authority over this club/team/resource" should
read this document first, then reuse the listed source/service — not invent a parallel check.

## How to read this document

For each relationship: **canonical source** (the real table/column), **stable IDs** (what a
consumer should key off, never a display name), **scope** (club-wide vs team-scoped vs global),
**grant/revoke path**, **authorization service** (the function/helper that turns the raw row into a
yes/no), **context effect** (how it shows up in the Context Switcher), and **known consumers**.

---

## 1. Session identity

| | |
|---|---|
| Canonical source | `auth.users` (Supabase Auth) + `profiles` (one row per user, `first_name`, `avatar_storage_path`) |
| Stable ID | `user_id` (== `auth.users.id`) |
| Scope | Global — one identity per human, spanning every club/team |
| Authorization service | N/A (identity, not authorization) |
| Consumers | Everywhere; `getSessionContext(supabase, user)` in `lib/app-context/session-context.ts` is the one place a page turns `user` into everything else on this page |

## 2. Club membership (club-wide authority)

| | |
|---|---|
| Canonical source | `club_memberships` (`user_id`, `club_id`, `role`, `status`) |
| Stable IDs | `club_id` |
| Roles | `BASIC_USER` (ambient access only — reads, no operate-as), `CLUB_ADMIN`, `FIXTURE_SECRETARY` |
| Scope | Club-wide — every team in that club |
| Grant path | `app/(app)/people/invite-form.tsx` → `invitations` table → accepted → `club_memberships` insert |
| Revoke path | `app/(app)/people/actions.ts` `revokeMembership` (sets `status`) |
| Authorization service | `internal.is_club_admin(club_id)`, `internal.can_manage_club_fixtures(club_id)` (CLUB_ADMIN OR FIXTURE_SECRETARY) at the DB/RLS layer; `lib/app-context/session-context.ts`'s `isClubAdminAnywhere()`/`canManageClubFixturesAnywhere()`/`manageableClubId()` at the read-convenience layer (all three are **session-wide** — "anywhere" is in the name on purpose; never use them alone to decide what a page acts on) |
| Context effect | `lib/app-context/active-context.ts`'s `listSwitchableContexts()` pushes one `kind: "club"` context per CLUB_ADMIN/FIXTURE_SECRETARY row |
| Known consumers | `/people`, `/club`, `/club/rollover`, `/club/venues`, `/fixtures/management`, `/fixtures/new`, `/messages/new`, `/partner-clubs`, `/documents` (write), Calendar's Schedule Training and lane "+" |
| Known risk (fixed this pass) | Every consumer listed above used to resolve its acting club via `activeManageableClubId(ctx, activeContext) ?? manageableClubId(ctx)` — the `??` silently fell back to *the first CLUB_ADMIN/FIXTURE_SECRETARY membership the session holds anywhere* whenever the active context wasn't itself that club. Fixed by dropping the fallback everywhere; the correct pattern is `activeManageableClubId(ctx, activeContext)` alone, which returns `null` (redirect) rather than guessing. See §9. |

## 3. Team permission (team-scoped authority, including Parent/Player)

| | |
|---|---|
| Canonical source | `team_permissions` (`membership_id` → `club_memberships`, `team_id`, `permission`) |
| Stable IDs | `team_id` (and, transitively via `membership_id`, `club_id`) |
| Permission values | `team_admin`, `coach`, `manager` (all real write authority), `view_only` (**historically the only way "Parent"/"Player" were represented — §11 now adds the canonical Guardian/Player model; unlinked `view_only` rows remain a supported legacy compatibility source, see §11.5**) |
| Scope | One specific team |
| Grant path | Same invitation flow as club membership, or `app/(app)/teams/[teamId]/team-people.tsx` assigning a permission to an existing club member |
| Revoke path | `app/(app)/teams/[teamId]/actions.ts` |
| Authorization service | `internal.can_manage_team(team_id)` (team_admin/coach/manager) at the DB layer; `lib/app-context/session-context.ts`'s `manageableTeams(ctx)` (session-wide, excludes view_only) at the read layer |
| Context effect | One `kind: "team"` context per non-view_only row, one `kind: "parent"` context per view_only row (`active-context.ts`) |
| Known consumers | Calendar lanes/Schedule Training, `/teams/[teamId]`, dashboard "This week" |
| Known risk (fixed this pass) | Same `??`-fallback bug class as club membership; also `getMyTeams(ctx)` (session-wide: unions every team from every club/team permission the account holds *anywhere*) was used where `getTeamsForActiveContext(supabase, ctx, activeContext)` (context-scoped) was needed — fixed in `/fixtures`, `/fixtures/new`, `/fixtures/management`. |

## 4. Site Admin capability

| | |
|---|---|
| Canonical source | `site_admins` (`user_id`, `status`, `admin_role`, plus five independent per-person boolean grants: `diagnostic_club_access`, `manage_team_catalogue`, `manage_competitions`, `manage_fixture_support`, `manage_global_lookups`) |
| Stable ID | `user_id` (global — not club/team-scoped) |
| Scope | Global admin console, deliberately never superimposed on the club/team operational surface (switching context is how a Site Admin moves between the two worlds — `build-nav-items.ts`'s `inSiteAdminContext` branch) |
| Grant/revoke path | `app/(app)/admin/site-admins/actions.ts` |
| Authorization service | `internal.is_site_admin()` is the coarse gate; each capability is checked independently at its own RPC/RLS boundary — a "Full" `admin_role` does **not** imply every boolean grant. This was a deliberate fix from an earlier security pass (narrow-Site-Admin), referenced again in this pass's §7/§17 warnings about blanket `is_site_admin()`. |
| Context effect | One `kind: "site_admin"` context, `id: null` |
| Known consumers | `/admin/*` |

## 5. Diagnostic club access (Site Admin viewing-as-club)

| | |
|---|---|
| Canonical source | `site_admin_diagnostic_sessions` (a short-lived cookie-backed grant, `lib/app-context/diagnostic-access.ts`) |
| Scope | One club, one Site Admin, time-boxed |
| Authorization service | `resolveDiagnosticClub()` — explicitly documented as overriding only the **dashboard body's** data, never the real `activeContext` used for nav/permissions |
| Known risk | None found this pass; this is the one place a deliberate, disclosed, narrow "view as" override already exists — worth reusing as the pattern if a future "Site Admin views a Parent channel for support" need arises (see §15's Support Conversation Eligibility row), rather than inventing a second override mechanism. |

## 6. Club Directory ↔ operational Club

| | |
|---|---|
| Canonical source | `club_directory` (every club Ovalball knows about, claimed or not) → `clubs` (one row per *operational*, claimed club, `directory_id` FK) |
| Stable IDs | `club_directory.id` (the stable, permanent identity — survives claim/unclaim) vs `clubs.id` (the operational identity, only exists once claimed) |
| Known risk (fixed this pass) | Logo resolution didn't consistently fall back from `clubs.logo_storage_path` to `club_directory.logo_storage_path` — see §10. |

## 7. Canonical Season / Rugby Code

Documented in full in `lib/seasons/validation.ts`'s own header comment and the earlier pass's report.
Summary: `seasons` (`rugby_code`, `season_year_start`, generated `season_year_end`, `starts_on`,
`ends_on`, `pre_season_starts_on`) is Managed Business Configuration (Site Admin edits it, server
validates via `validateSeasonDates()`), while `rugby_code` itself is a Controlled System Domain
(never user-editable). `internal.resolve_season_for_date(rugby_code, date)` is the one canonical
resolver — used correctly by the `fixtures` insert trigger; `lib/calendar/season-window.ts`'s
`resolveDefaultSeason()` is a separate, TS-side reimplementation for Calendar UI defaults only
(**flagged as duplicate logic, not yet consolidated — see §16**).

## 8. Partnership (club ↔ club)

| | |
|---|---|
| Canonical source | `club_partnerships` (`requesting_club_id`, `partner_club_id`, `status`) |
| Authorization service | `club_partnerships_insert_scoped` RLS policy = `internal.can_manage_club_fixtures(requesting_club_id)` |
| Known risk (fixed this pass) | `requestPartnership()`/`respondToPartnership()` resolved `clubId` via the same `??`-fallback bug — a partnership could be requested/responded-to *as* the wrong club. Fixed. |

---

## 9. The fallback-pattern bug class (found and fixed this pass)

**Root cause:** `activeManageableClubId(ctx, activeContext)` correctly returns `null` when the
active context isn't itself a club the caller genuinely administers. Fourteen call sites across
the app used to write `activeManageableClubId(ctx, activeContext) ?? manageableClubId(ctx)` (or the
`??  ctx.clubMemberships[0]?.clubId` / `?? ctx.teamPermissions.find(...)` variants) — the `??`
silently substituted *any* club-wide authority the session holds, regardless of which context is
actually active. For a genuinely multi-club account (this project's own `test.burnley.admin`, real
CLUB_ADMIN at both Burnley RUFC and League Test Club A) switched into Parent View on a Burnley
team, this meant: full read+write access to League Test Club A's People roster, Club Settings,
Season Rollover, Venues, and (most severely) entire Fixture Management CRUD surface — merely
because that authority exists *somewhere* in the session, not because Parent View has anything to
do with it.

**Fixed in:** `app/(app)/people/page.tsx`, `app/(app)/club/page.tsx`, `app/(app)/club/rollover/page.tsx`,
`app/(app)/club/venues/page.tsx`, `app/(app)/calendar/page.tsx` (lane create + Schedule Training),
`app/(app)/fixtures/page.tsx`, `app/(app)/fixtures/management/page.tsx`, `app/(app)/fixtures/new/page.tsx`,
`app/(app)/messages/page.tsx`, `app/(app)/messages/new/page.tsx`, `app/(app)/messages/[kind]/[id]/document-share.ts`,
`app/(app)/partner-clubs/page.tsx`, `app/(app)/partner-clubs/[clubId]/page.tsx`, `app/(app)/partner-clubs/actions.ts`,
`app/(app)/documents/page.tsx`, `app/(app)/documents/actions.ts`, `app/(app)/teams/page.tsx`,
`app/club/[slug]/page.tsx`, `app/(app)/admin/fixtures/[fixtureId]/page.tsx` (a related but distinct bug —
see the file's own comment: this one *denied* legitimate access to a multi-club admin rather than
leaking, since it only checked the *first* managed club against the fixture's two sides).

**Standing rule going forward:** never write `activeManageableClubId(...) ?? <anything session-wide>`.
If the active context doesn't authorize the action, the correct behavior is to say so (redirect /
return an error), never to guess a different, unrelated authority the account happens to also hold.

---

## 10. Club Logo / Personal Avatar

| | |
|---|---|
| Canonical rule | `lib/app-context/club-logo.ts`'s `resolveClubLogoPath()`/`resolveClubLogoUrl()`: the club's own uploaded `clubs.logo_storage_path` if set, else the Club Directory's seed `club_directory.logo_storage_path`, else none. **Exception:** the Club Settings *editor* page (`app/(app)/club/page.tsx`) deliberately does NOT apply the fallback for its own "Replace"/"Remove" affordances — those need the raw uploaded-or-not state, not a directory-seeded logo it has nothing to delete. |
| Personal avatar | `profiles.avatar_storage_path`, bucket `avatars` — completely independent of club logo, no shared code path, confirmed by live test (uploading a club crest did not touch the personal avatar shown on `/account`). |
| Migrated onto the shared resolver this pass | `lib/app-context/session-context.ts` (top-left identity, every page), `app/club/[slug]/page.tsx` (public club page), `lib/app-context/conversations.ts` (Messages — already had the right logic, now shares the function instead of a hand-rolled copy). |
| Live-proven propagation | Uploaded a real crest via Club Settings → top-left identity updated with no refresh → persisted after full reload → public club page shows the identical crest. |
| Not yet migrated (§16) | `app/(app)/admin/clubs/[directoryId]/*`, `app/(app)/partner-clubs/map-data.ts`, `app/(app)/admin/fixtures/query.ts` still have their own inline `clubs.logo_storage_path ?? club_directory.logo_storage_path` (or a subset of it) rather than calling the shared function — behaviorally correct today (same fallback order) but a duplicate implementation that could drift. |

---

## 11. Player / Guardian foundation — IMPLEMENTED this pass

The gap this section used to describe (Parent and Player both collapsing into
`team_permissions.permission = 'view_only'`, with no child/player entity at all) is now closed at
the schema level. `supabase/migrations/20260920000000_player_guardian_foundation.sql` adds three
new, purely additive tables — nothing existing was altered, dropped, or repurposed, and every
pre-existing `view_only` row remains exactly as it was (see §11.5 for how the two sources compose).

### 11.1 Canonical Player

**Terminology, by explicit product decision: there is no "Child" table.** The canonical sporting
entity is `players` — the same stable `player_id` persists as someone progresses from U6 through
Colts into senior rugby; whether they are *currently* a protected minor is a derived state (§11.4),
never a separate identity system or a second player record created at 18.

| | |
|---|---|
| Canonical source | `players` (`first_name`, `surname`, `date_of_birth` nullable, `user_id` nullable, `active`) |
| Stable ID | `player_id` |
| Login | Optional — `user_id` is nullable so a young player can exist purely as a Guardian-managed record; later linkable to their own account without ever becoming a second Player. At most one Player per `user_id` (`players_user_id_key`). |
| RLS | `players_select`/`players_write` — Site Admin, the player's own linked account, an active Guardian, or team staff/club admin of a team the player is actively on. Never open enumeration. |

### 11.2 Guardian relationship

| | |
|---|---|
| Canonical source | `guardians` (`guardian_user_id`, `player_id`, `relationship_type`, `status`) |
| Scope | **Guardian → Player, never Guardian → Team** (this was the one non-negotiable design constraint) — a Guardian's legitimate team contexts are always *derived* by following that player's active `player_team_memberships`, so a player's team change propagates to every guardian automatically instead of the Guardian relationship itself needing to be touched. |
| Grant/revoke path | Team staff/club admin of a team the player belongs to, or Site Admin — **never self-service** by the `guardian_user_id` (RLS-enforced, live-verified: a direct `insert` by the guardian themselves is rejected). |
| Multiplicity | A user may hold several active Guardian rows (multiple children — live-verified with 2 children on 2 different teams, both correctly resolved). A player may have several active Guardians (e.g. two separated parents) — not yet exercised in the live account but the schema and RLS already support it (no `UNIQUE (player_id)` constraint, only `UNIQUE (guardian_user_id, player_id)`). |

### 11.3 Player Team Membership

| | |
|---|---|
| Canonical source | `player_team_memberships` (`player_id`, `team_id`, `status`, `joined_at`, `ended_at`) |
| Scope | One row per (player, team); a player may hold more than one **active** row simultaneously (a genuinely dual-registered player — live-verified) and, over time, several **ended** rows as they progress between age grades. The `player_id` itself never changes across that history. |
| Grant/revoke path | Team staff/club admin of that team, or Site Admin. |
| Club ownership | Always **derived** through `team_id → teams.club_id`, never stored redundantly on the player or membership row. |

### 11.4 Minor/Youth state (derived, never stored as a flag)

`lib/players/age-state.ts`'s `resolvePlayerAgeState()` is the **one** canonical resolver — every
consumer calls it instead of comparing DOB or team names independently. Rule, in priority order:

1. A known, valid `date_of_birth` always wins: 18+ at the effective date → `"adult"`, otherwise `"minor"`.
2. Missing/invalid DOB → **safety fallback**: if the player holds an active membership on *any*
   youth team (U6–U17) or Junior Colts, treat as `"unknown_youth_protected"` regardless — a
   safeguarding default that deliberately errs toward protection when a player holds several teams
   of mixed category. Senior Colts and senior adult teams **never** infer minority from the team
   name — an unknown DOB there resolves to plain `"unknown"`, never assumed adult and never
   assumed minor from the team's name.
3. Effective-date aware (calendar-correct, not `currentYear - birthYear`) — verified: turning 18 on
   the effective date counts as adult, the day before does not.

Deliberately keyed off `canonical_team_types.category`/`age_group` (the controlled pathway metadata
every team already carries), never a team's free-text `display_name` — a team named something
unexpected can't accidentally misclassify a player.

**Automated proof:** `lib/players/age-state.verify.ts`, 12/12 PASS, covering the exact G/H/I
scenarios (Senior Colts minor-by-DOB, Senior Colts adult-by-DOB, U12/Junior-Colts unknown-DOB
fallback) plus DOB-overrides-team-category in both directions, dual-category fallback resolution,
and the effective-date boundary.

### 11.5 Composition with the legacy `view_only` source

`lib/app-context/active-context.ts`'s `listSwitchableContexts()` now derives a `"parent"` context
from **two** sources: the canonical `guardianRelationships` (preferred) and any `team_permissions`
`view_only` row that has **not** yet been linked to a Guardian relationship for the same team (kept
as a compatibility fallback per the explicit instruction not to silently discard or guess at
existing playground data). Deduplicated by `team_id` — the moment a real Guardian relationship
exists for a team, the legacy row for that same team is not also shown as a second, redundant
context. **Live-verified**: `test.burnley.admin`'s pre-existing Burnley U12 `view_only` row was left
untouched; a new Guardian relationship was added for the same (user, team) pair; the Context
Switcher now shows exactly one "U12" entry labeled "Parent/Guardian" (the canonical source winning
over the legacy `"Parent / Player (view only)"` label), with no duplicate.

A new `ActiveContextKind` value, `"player"`, was also added (`site_admin | club | team | parent |
player`) — sourced from `linkedPlayerTeams` (the current user's own linked Player's active team
memberships), fully independent of any Guardian relationship, exactly matching §15's "Alex can have
Parent View and Player View as independent contexts on one account." `"player"` context receives the
identical restriction as `"parent"` everywhere that mattered this pass (Dashboard/Calendar-only nav,
no fixture requests, no Schedule Training, no message negotiation threads) — both are read-only-by-
design contexts over one team.

### 11.6 Security — live-verified, not just designed

`supabase/tests/player_guardian_security.sql` (self-contained, fresh standalone clubs, never
touching Burnley/Rossendale) — 12/12 PASS: ordinary single-child parent sees exactly their own
player; multi-child parent resolves both children on their correct distinct teams; a dual-registered
player stays one player row with two visible memberships; a Parent+Player account sees exactly its
two distinct player records; a Club Admin's real club-wide authority and their own separate Guardian
relationship coexist without either implying the other; a cross-club user (Home parent + Away coach)
sees exactly their Home child and exactly their Away-coached player, with no bleed either direction;
a genuinely unrelated club member sees zero players; direct enumeration of another family's
`player_id`/`team_id` by supplying it manually is blocked by RLS in every case tried; and a guardian
cannot self-grant a Guardian row over an arbitrary player. One real bug was found and fixed during
this work: the first draft of the RLS policies caused genuine infinite recursion (`players` →
`player_team_memberships` → `players`) — resolved by introducing three `SECURITY DEFINER` helper
functions (`internal.is_own_linked_player`, `internal.is_active_player_guardian`,
`internal.can_manage_player`), matching the exact pattern `internal.can_manage_team()` already uses
elsewhere in this schema to break the same class of cycle.

---

## 12. Context Switcher (presentation layer, not an authorization boundary)

`lib/app-context/active-context.ts` — `ActiveContextKind = "site_admin" | "club" | "team" | "parent"`.
`listSwitchableContexts(ctx)` derives every legitimate context straight from the relationships
above (never hardcoded per-account). `resolveActiveContext()` reads the `ovalball_ctx` cookie only
to pick which of the session's *own real* contexts is highlighted — a tampered or stale cookie can
never grant a context the session doesn't actually have. This is repeated explicitly in the file's
own doc comments and is worth restating here because it's the one fact every consumer of this
registry must internalize: **the switcher changes navigation, default scope, and framing; it never
changes what any RLS policy or RPC actually allows.** Every leak fixed in §9 was a violation of this
principle at the *page* level (a page trusting "session has this authority somewhere" instead of
"session has this authority through the context actually active"), not at the RLS level — RLS was
already correctly scoped to real membership throughout.

---

## 13. Fixture Conversation / Club Conversation eligibility (existing)

| | |
|---|---|
| Canonical source | `fixture_messages` (one row per message; exactly one of `fixture_request_id` / `fixture_id` / `club_conversation_id` is set — enforced by `fixture_messages_check`), `club_conversations` (club ↔ club pending/accepted) |
| Authorization service | `internal.can_access_fixture_conversation(fixture_id, fixture_request_id)`, `internal.can_access_any_conversation(...)`, `internal.can_access_conversation(conversation_id)` — all DB-side, all resolve against real club/team membership on either side of the fixture/request, **never active context** (by the same principle as §12: RLS checks real authority, a UI context is a lens on top of it) |
| Scope | Per-fixture or per-club-pair — never team-scoped, never parent-facing |
| Known risk (fixed this pass) | `app/(app)/messages/page.tsx` listed these for *any* context including Parent View, and `canMessageClubs` (gating "New message") was session-wide. Both fixed: Parent View's conversation list and club-conversation summary are now skipped entirely (not fetched), and `canMessageClubs` is scoped to the active club. **Not yet closed:** `app/(app)/messages/[kind]/[id]/page.tsx`'s own read is still authorized by RLS alone (real club membership, any context) — a Parent-context session could still open a specific `/messages/club/<id>` URL for a conversation belonging to a club they administer under a *different* context. This is the same class as "Site Admin routes stay reachable regardless of active context" (a deliberate, disclosed pattern elsewhere), but hasn't been explicitly decided for messaging — flag for a decision, not yet fixed. |

---

## 14. Messaging security boundaries (recorded per the user's explicit directive — no new schema built this pass)

These are the required boundaries for the **future** Parent/Team messaging feature. Nothing in this
section has been implemented; it exists so the Central Relationship Source being finished now
supports it cleanly later, and so no one re-derives these rules from scratch mid-build.

### 14.1 Conversation scope must stay distinct

Today's schema only knows `FIXTURE` (fixture_id or fixture_request_id) and `CLUB_OPERATIONAL`
(club_conversation_id) — both authorized by "does this account manage one of the two clubs
involved," never by team or parent relationship. A future `TEAM_COMMUNITY` conversation type (see
§14.2) must be **structurally separate**, not a filtered view over the same rows, because its
authorization question is entirely different: "is this user a guardian of / staff on *this specific
team*," not "does this user manage one of the two clubs in *this specific fixture*." Concretely,
this likely means either a new nullable `team_id` column added to the same exactly-one-of
constraint on `fixture_messages` (extending `num_nonnulls(...) = 1` to four columns) or a wholly
separate `team_conversations`/`team_messages` pair — the existing `conversations.ts`
normalization-over-two-sources pattern (`app/(app)/messages/page.tsx`'s own comment: "no new fetch,
no new table" for combining `fixture`/`request`/`club`) shows the intended shape to extend, not
replace.

### 14.2 Team Community channel — eligibility must derive from the relationship graph, not a manual list

Eligibility for "Burnley U12 Parents & Team Staff" must be computed the same way `manageableTeams(ctx)`
and `listSwitchableContexts(ctx)` already are: read straight from `team_permissions` (staff
permissions) plus the now-implemented `guardians`/`player_team_memberships` graph (§11.2/§11.3) for
the parent side, scoped to that one `team_id`. **No membership should ever be copied into a
messaging-specific table** — a coach losing their `team_permissions` row must make them ineligible
for the channel automatically, the same "change once, propagate everywhere" requirement as every
other relationship in this document (§9's whole point). Club Admin participation (§10 of the user's
messaging directive) is an open product decision, not yet made: automatic (every CLUB_ADMIN on that
club is in every team channel) versus capability-gated (a CLUB_ADMIN needs an explicit
`can_participate_in_team_channels` grant, matching the per-person-capability pattern Site Admin
already uses for `manage_competitions`/`manage_global_lookups`/etc. in §4). Recommend the
capability-gated option for consistency with that existing pattern, but this needs an explicit
product decision recorded here before implementation, not an inferred default.

### 14.3 Direct messages must be relationship-scoped, never a global directory

If parent-to-parent or parent-to-staff direct messages are built, eligibility must be computed
server-side from "do these two users share a `team_permissions` row on the same `team_id`" (or the
future guardian table), never a general "search all Ovalball members" directory. No existing code
path currently exposes such a directory to a non-admin — this is a forward-looking constraint on
the feature, not a bug found this pass.

### 14.4 Canonical fixture fact vs. private operational discussion

Calendar/Fixture View already correctly exposes only canonical, derived fixture fields (opponent,
date, kickoff, venue, pitch, status — see `lib/app-context/dashboard-data.ts`'s `FixtureRow`) to a
Parent, never the negotiation thread that produced them. This separation already exists structurally
(the `fixtures` table vs. `fixture_messages`) and does not need new code — just discipline to never
let a future "notify parents of a kickoff change" feature reuse the fixture-negotiation thread
itself as the notification channel. It should post into the (future) Team Community channel or a
dedicated notification, referencing the fixture's canonical `id`, never quoting/copying the
negotiation message text.

### 14.5 Privacy minimization

A messaging service consuming this registry should ask for `user_id`, `team_id`, `club_id`,
relationship eligibility, and a display identity suitable for messaging — never a Player's raw
`date_of_birth` or full record (§11.1/§11.4: query the derived age *state* via
`resolvePlayerAgeState()`, never the stored DOB column itself, in any consumer outside the specific
authorized workflow that genuinely needs it).

---

## 15. Message eligibility summary table (for the future feature — see §14)

| Eligibility type | Canonical relationship source | Scope | Required capability | Data exposed | Revocation |
|---|---|---|---|---|---|
| Fixture Conversation | `team_permissions`/`club_memberships` on either side of the fixture/request | Per-fixture | `can_manage_club_fixtures(club_id)` or `can_manage_team(team_id)` | Negotiation messages, both clubs' staff identities | Membership/permission row removed → RLS re-evaluates on next access, no manual cleanup needed (already correct today) |
| Club Operational | `club_memberships` (CLUB_ADMIN/FIXTURE_SECRETARY) on either club | Per-club-pair | `can_manage_club_fixtures(club_id)` | General correspondence | Same as above |
| Team Community *(not built)* | `team_permissions` (all values) scoped to one `team_id`, + future guardian table | Per-team | View eligibility = any `team_permissions` row (incl. view_only) on that team; post eligibility TBD (staff + possibly guardians) | Team-scoped chat only — never another team's, never a fixture negotiation | Permission/guardian row removed → eligibility disappears automatically, same mechanism as club/team authority elsewhere |
| Direct Message *(not built)* | Shared `team_id` between two users' `team_permissions` (or future guardian table) | Per-pair, team-scoped | Both parties share the team | Direct text only, no directory browsing | Either party's team relationship removed → ineligible |
| Support/Site Admin *(not built for messaging; diagnostic-access.ts is the closest existing pattern)* | `site_admins` + explicit per-conversation addressing, never blanket | Per-conversation | `manage_fixture_support` (existing) or an equivalent future grant | Whatever the user explicitly brought to Support | N/A yet |

---

## 16. Remaining architectural debt identified this pass

- `resolveDefaultSeason()` (`lib/calendar/season-window.ts`) duplicates season-boundary comparison
  logic in TS rather than calling `internal.resolve_season_for_date()` — used for Calendar/Ovie UI
  defaults only, not for any stored `season_id`, so no correctness bug today, but a drift risk.
- Club logo: 3 remaining call sites (`admin/clubs/[directoryId]/*`, `partner-clubs/map-data.ts`,
  `admin/fixtures/query.ts`) not yet migrated onto `resolveClubLogoUrl()` (§10).
- `messages/[kind]/[id]/page.tsx`'s direct-URL reachability for a real-but-differently-contexted
  club conversation (§13) — a product decision, not yet made either way.
- Team Settings has no dedicated route (`/teams/[teamId]` serves the purpose but isn't labeled as
  distinct from Team *viewing*) — tracked, not yet addressed (Master Pass priority 5).
- §11's Player/Guardian foundation is now implemented, but the **backfill is deliberately narrow**:
  only the two real accounts this session could prove intent for (`test.burnley.admin`,
  `test.parent`) were linked to a new Player record, exactly per the "never guess ambiguous legacy
  data" instruction. Every other `view_only` row in the live playground (and any future real
  production data) remains legacy/unlinked until a real onboarding flow (Access & Teams, explicitly
  deferred) captures a genuine Guardian relationship — until then those rows keep working exactly as
  before via the compatibility fallback in §11.5, just without a linked Player record or DOB/age
  state.
- No UI surface yet displays the richer Player data (a player's name, an "of Alex" qualifier in the
  switcher, multiple-children navigation) — the context switcher's `label` still shows the team name
  for both `"parent"` and `"player"` contexts, identical to the pre-existing behavior. The
  *data model and eligibility* are the foundation this pass was scoped to; presentation richness is
  deliberately left for whichever future feature (Team Community messaging, Access & Teams) actually
  needs it, so as not to touch UI beyond what correctness required.
- `players_write`'s RLS `with check` clause is intentionally permissive (`is_site_admin() or true`)
  for UPDATE/DELETE on a row a caller already passed the `USING` (staff/admin) check for — tightened
  no further because no write UI exists yet to exercise it; worth revisiting once Access & Teams
  defines the real caller (parent-initiated request vs staff-direct-add) so the check can be as
  narrow as the actual write path requires, rather than guessed now.
- `players.date_of_birth` currently has no format/range validation beyond the column type itself
  (no server-side "must be a plausible age for the team category" check) — not exploited by anything
  built this pass, but worth a CHECK constraint before any real data-entry UI is built on top of it.
