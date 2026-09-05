# Club Settings Permission Matrix

Status: living document, produced for the Master Architecture Pass "Club Settings Consolidation +
Central Mutation Capabilities" (2026-09-03), per that pass's §13. Every row below was read directly
from the live RLS policy definitions and server action code, not inferred -- exact `pg_policies`
output and file references are cited so this stays checkable against the schema as it evolves. See
`docs/architecture/capability-model.md` for the roles/capabilities these checks are built from, and
`docs/architecture/settings-ownership-map.md` for the broader settings-ownership table this document
narrows to Club Settings specifically.

**Mechanism update (Canonical Scoped Capability Engine pass, 2026-09-03):** every "Server
authorization function" cell below now names the capability key checked via
`internal.has_capability(capability_key, scope_type, club_id, team_id)` (the canonical primitive --
see `docs/architecture/capability-model.md` §7) rather than a bare `internal.is_club_admin(...)`/
`internal.can_manage_club_fixtures(...)` call. The underlying RLS policies were rewired to call it
directly; the **allowed/denied actor sets below are unchanged** -- this was a mechanism swap, not a
capability-boundary change, and was verified unchanged by the full regression suite before and after
the rewire. A capability cell can now additionally be narrowed (deny) or widened (grant) per person
via `capability_overrides`, which no bare role check ever supported.

All resource scoping below binds to `club_id` (and `team_id` where noted) resolved **server-side**
from the actor's real relationship to that specific resource -- never from the client-supplied active
context, a route param alone, or session-wide "administers a club somewhere" authority. See
`app/(app)/club/settings/page.tsx`, `app/(app)/club/page.tsx`, `app/(app)/teams/page.tsx`, and
`app/(app)/club/venues/page.tsx` for the identical pattern each Club Settings page's own server
component applies before rendering anything.

## Club Profile

| Field | Value |
|---|---|
| Canonical entity | `clubs` (`bio`, `website`, `facebook_url`, `address_display`) |
| Read capability | Open for any `status = 'active'` club (public club page); Site Admin or that club's Admin for an inactive club |
| Write capability | Site Admin, or that club's Club Admin |
| Resource scope | `club_id` |
| Allowed actors | Site Admin; Club Admin of THIS club |
| Denied actors | Fixture Secretary; Team Admin/Coach/Manager (any team); Parent/Player; Club Admin of a DIFFERENT club |
| Server authorization function | `internal.has_capability('club.edit_profile', 'club', club_id)` |
| RLS / RPC / action path | `clubs_update_admin` policy; `app/(app)/club/page.tsx` + `app/(app)/club/actions.ts` |
| Audit requirement | `audit_row_change` trigger on `clubs` (existing) |

## Club Logo

| Field | Value |
|---|---|
| Canonical entity | `clubs.logo_storage_path` + `club-logos` storage bucket object |
| Read capability | Public (`club_logos_select_public`, bucket-wide) |
| Write capability | Site Admin, or that club's Club Admin -- independently enforced at the STORAGE layer, not just the `clubs` row |
| Resource scope | `club_id`, derived from the object path's folder prefix (`storage.foldername(name)[1]`) |
| Allowed actors | Site Admin; Club Admin of THIS club |
| Denied actors | Team Admin (even of a team at this club); Parent/Player; Club Admin of a different club (their own folder-derived `club_id` won't match) |
| Server authorization function | `internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid)` |
| RLS / RPC / action path | `club_logos_insert_club_admin` / `_update_club_admin` / `_delete_club_admin` policies on `storage.objects`; `app/(app)/club/club-profile-form.tsx` upload action |
| Audit requirement | Storage object writes are not row-audited today (no `audit_row_change`-equivalent on `storage.objects`) -- a known gap, not unique to Club Logo, out of scope for this pass |

## Teams (list / create)

| Field | Value |
|---|---|
| Canonical entity | `teams` (list read), plus creation via the same table |
| Read capability | Public for `active = true` rows (`teams_select`); Site Admin or that club's Admin for inactive rows |
| Write capability (create/edit canonical fields) | Site Admin, or that club's Club Admin |
| Resource scope | `club_id` |
| Allowed actors | Site Admin; Club Admin of THIS club (create + edit); Fixture Secretary of THIS club (list view only -- see Team Field Authorization below) |
| Denied actors | Coach/Manager/Team Admin (of any team) -- confirmed zero write authority; Club Admin of a different club |
| Server authorization function | `internal.has_capability('club.teams.manage', 'club', club_id) OR internal.has_capability('club.team_lifecycle.manage', 'club', club_id)` (write); `hasCapability('club.edit_profile'\|'club.pitches.manage', ...)` for list-view entry (`app/(app)/teams/page.tsx`) |
| RLS / RPC / action path | `teams_select` / `teams_update_admin`; `app/(app)/teams/page.tsx` + `app/(app)/teams/actions.ts` |
| Audit requirement | `audit_row_change` trigger on `teams` (existing) |

## Team lifecycle (fold / reactivate / restore fixture)

| Field | Value |
|---|---|
| Canonical entity | `teams.active`, `teams.folded_at`, `teams.fold_reason`, plus cascading fixture cancellation |
| Read capability | Same as Teams above |
| Write capability | Site Admin, or that club's Club Admin ONLY -- Class B, deliberately never delegated |
| Resource scope | `club_id` |
| Allowed actors | Site Admin; Club Admin of THIS club |
| Denied actors | Team Admin/Coach/Manager of the team being folded (real cross-club-visible consequences -- cancels future fixtures, notifies real opponents -- not a single team's unilateral call) |
| Server authorization function | `internal.has_capability('club.team_lifecycle.manage', 'club', club_id)` |
| RLS / RPC / action path | `teams_update_admin`; `app/(app)/teams/[teamId]/actions.ts` (`foldTeam`/`reactivateTeam`) |
| Audit requirement | `audit_row_change` on `teams`; fixture cancellations audited via `audit_row_change` on `fixtures` |

## Team roster (`team_permissions` -- assign/remove people)

| Field | Value |
|---|---|
| Canonical entity | `team_permissions` |
| Read capability | Site Admin, that club's Club Admin, or the row's own subject (`user_id = auth.uid()`) |
| Write capability | Site Admin, or that club's Club Admin -- **and, as of this pass, ALSO requires the target `team_id` to belong to that same club** (see Finding below) |
| Resource scope | `club_id` AND `team_id` (both, jointly, since `20260921000000_team_permissions_cross_club_scope_fix.sql`) |
| Allowed actors | Site Admin; Club Admin of the team's OWN club |
| Denied actors | Coach/Manager/Team Admin (zero write authority, confirmed); Club Admin of a DIFFERENT club, even for their own `membership_id` paired with a foreign `team_id` -- see Finding |
| Server authorization function | `internal.has_capability('club.roster.manage', 'team', club_id, team_id)` AND explicit `club_memberships.club_id = teams.club_id` (kept as defense-in-depth on top of has_capability()'s own internal validation) |
| RLS / RPC / action path | `team_permissions_insert_scoped` / `update_scoped` / `delete_scoped`; `app/(app)/teams/[teamId]/actions.ts` (`assignTeamMember`/`removeTeamMember`) |
| Audit requirement | `audit_row_change` trigger on `team_permissions` (existing) |

**Finding fixed this pass:** the three write policies above previously checked only that the actor
administers the club owning `membership_id`, never that `team_id` belonged to that same club -- a
live-confirmed cross-club privilege-escalation gap (a Club Admin at Club A could grant themselves
`team_admin` over a Club B team by pairing their own `membership_id` with a foreign `team_id`; this
genuinely made `internal.can_manage_team()` return `true` for the foreign team). See
`docs/architecture/capability-model.md` §6 and `supabase/migrations/20260921000000_team_permissions_
cross_club_scope_fix.sql` for the full account and fix; `supabase/tests/club_settings_capability_
security.sql` test 10 is the permanent regression.

## Venues

| Field | Value |
|---|---|
| Canonical entity | `venues` |
| Read capability | Open (`venues_select`, `USING (true)`) |
| Write capability | Site Admin, or that club's Club Admin ONLY -- deliberately stricter than Pitches below |
| Resource scope | `club_id` |
| Allowed actors | Site Admin; Club Admin of THIS club |
| Denied actors | **Fixture Secretary of this same club** (confirmed live this pass -- `can_manage_club_fixtures` is NOT in the `venues_update` policy, unlike `club_pitches`); Coach/Manager/Team Admin; Club Admin of a different club |
| Server authorization function | `internal.has_capability('club.venues.manage', 'club', club_id)` |
| RLS / RPC / action path | `venues_insert` / `venues_update`; `app/(app)/club/venues/page.tsx` + `venues-section.tsx` |
| Audit requirement | `audit_row_change` trigger on `venues` (existing) |

## Pitches

| Field | Value |
|---|---|
| Canonical entity | `club_pitches` |
| Read capability | Open (`club_pitches_select`, `USING (true)`) |
| Write capability | Site Admin, that club's Club Admin, OR that club's Fixture Secretary, OR a Site Admin holding `manage_global_lookups` (parent-view editing) |
| Resource scope | `club_id` |
| Allowed actors | Site Admin; Club Admin of THIS club; **Fixture Secretary of THIS club** (broader than Venues -- confirmed live this pass, test 8a) |
| Denied actors | Coach/Manager/Team Admin; Club Admin/Fixture Secretary of a different club |
| Server authorization function | `internal.has_capability('site.lookups.manage', 'site') OR internal.has_capability('club.pitches.manage', 'club', club_id)` |
| RLS / RPC / action path | `club_pitches_insert` / `club_pitches_update`; `app/(app)/club/venues/venues-section.tsx`; parent view `app/(app)/admin/lookups/page.tsx` |
| Audit requirement | `audit_row_change` trigger on `club_pitches` (existing) |

## Lookup Administration (club-scoped index page)

| Field | Value |
|---|---|
| Canonical entity | No entity of its own -- pure navigation over Venues + Pitches above |
| Read capability | Same as Venues + Pitches (both open reads) |
| Write capability | N/A -- delegates entirely to the two tables above |
| Resource scope | `club_id`, resolved once by the page and passed to both sections |
| Allowed actors | Site Admin; Club Admin of THIS club (page-level entry gate matches the stricter of the two, Venues' Club-Admin-only bar, since the page shows both sections together) |
| Denied actors | Same as Venues (the binding constraint) |
| Server authorization function | `internal.has_capability('club.venues.manage', 'club', club_id)` (page entry) |
| RLS / RPC / action path | `app/(app)/club/venues/page.tsx` |
| Audit requirement | Inherited from Venues + Pitches |

## Club Settings hub itself

| Field | Value |
|---|---|
| Canonical entity | None -- pure navigation, holds no data of its own |
| Read capability | Renders only the sections the actor's real, context-scoped `club_memberships` role permits |
| Write capability | N/A |
| Resource scope | `club_id`, resolved via `activeClubId(ctx, activeContext)` -- never `ctx.clubMemberships[0]`, never session-wide `canManageClubFixturesAnywhere` |
| Allowed actors | Club Admin of the ACTIVE club (all 3 sections); Fixture Secretary of the ACTIVE club (Teams section only) |
| Denied actors | Anyone whose membership at the active club is `BASIC_USER` or absent, regardless of authority they hold at a DIFFERENT club |
| Server authorization function | Three independent `hasCapability()` calls (`club.edit_profile`, `club.venues.manage`, `club.pitches.manage`), mirrored identically by the tab strip (`club-settings-nav.tsx`) so the visible tabs/cards never promise a section the target page itself would reject |
| RLS / RPC / action path | `app/(app)/club/settings/page.tsx` |
| Audit requirement | N/A -- navigation only; every underlying mutation is audited at its own table |
