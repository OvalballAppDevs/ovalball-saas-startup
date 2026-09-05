# Ovalball Capability Model

Status: living document, first drafted during the Master Architecture Pass "Club Settings
Consolidation + Central Mutation Capabilities" (2026-09-03). This is the audit required by that
pass's §8/§9/§23-25 -- what roles and capabilities actually exist today, where grants live, whether
they're wired into real enforcement, and the one distinction (§12) every future permission decision
must respect. It complements, and never duplicates, `docs/architecture/security-safeguarding-standard.md`
(the invariants) and `docs/architecture/settings-ownership-map.md` (per-setting ownership).

## 1. The real enforcement path today

Every write in Ovalball is ultimately authorized by **Postgres RLS policies**, most of which call one
of a small set of `STABLE SECURITY DEFINER` helper functions in the `internal` schema:

- `internal.is_site_admin()` -- has an active `site_admins` row.
- `internal.is_club_admin(club_id)` -- has an active `club_memberships` row for that club with
  `role = 'CLUB_ADMIN'`.
- `internal.can_manage_club_fixtures(club_id)` -- Club Admin OR `FIXTURE_SECRETARY` for that club.
- `internal.can_manage_team(team_id)` -- Site Admin, OR Club Admin of the team's club, OR holds a
  `team_permissions` row for that team with `permission IN ('team_admin','coach','manager')`.
- `internal.can_manage_global_lookups()` -- `site_admins.manage_global_lookups = true`.
- Sibling functions (`can_manage_player`, `is_active_player_guardian`, ...) for the Player/Guardian
  graph, following the identical pattern.

These functions read directly from three tables:

| Table | What it grants | Grain |
|---|---|---|
| `club_memberships.role` | `BASIC_USER` / `CLUB_ADMIN` / `FIXTURE_SECRETARY` | one row per (user, club) |
| `team_permissions.permission` | `view_only` / `coach` / `manager` / `team_admin` | one row per (membership, team) |
| `site_admins` | `admin_role` (`full`/`fixture_ops`/`club_data`/`user_access`/`message_moderator`/`read_only`) + 5 per-person boolean flags (`diagnostic_club_access`, `manage_team_catalogue`, `manage_competitions`, `manage_fixture_support`, `manage_global_lookups`) | one row per user, global scope |

**This is the actual, live authorization contract.** Every RLS policy, and every `internal.can_*`
function, is keyed directly off these three tables -- never off `permission_groups` or `capabilities`
(below). Anything not expressed as a role/permission/flag in one of these three tables grants nothing,
regardless of what the documentation layer says.

## 2. The `permission_groups` / `capabilities` layer -- documentation, not enforcement

A second set of tables exists: `capabilities` (a flat catalogue of named actions like
`club.edit_profile`, `team.manage`, `fixture.create` -- 7 categories, ~20 keys), `permission_groups`
(7 seeded rows: Club Admin, Fixtures Admin, Member, Coach, Manager, Team Admin, View Only), and
`permission_group_capabilities` (which capabilities each group bundles -- 60 rows).

**This layer is deliberately a documentation/taxonomy layer over the real enforcement above, not a
second enforcement path.** Confirmed by inspection, not assumption:

- Every `permission_groups` row has a `maps_to_role` or `maps_to_team_permission` column with a CHECK
  constraint (`permission_groups_scope_mapping`) forcing it to resolve to exactly one of the seven
  real `club_memberships.role` / `team_permissions.permission` values. A group cannot exist that
  doesn't already correspond to a real, already-implemented access level.
- `app/(app)/admin/permissions/page.tsx`'s own doc-comment states it plainly: *"Groups are a
  configuration/documentation layer over the real, already-implemented `club_memberships.role` /
  `team_permissions.permission` enforcement."*
- No RLS policy, and no `internal.can_*` function, references `permission_groups` or
  `permission_group_capabilities` anywhere in the schema.

Practical effect: Site Admin's "Permission management" page lets someone name and describe *bundles*
of the capabilities a `CLUB_ADMIN`/`FIXTURE_SECRETARY`/`team_admin`/`coach`/`manager`/`view_only`
already has -- it cannot grant a capability that role doesn't already carry, and it cannot grant a
subset of a role's capabilities to someone without giving them the whole role. It is real and useful
(self-documenting "what does a Coach do here?"), but it is not a capability *grant* mechanism.

## 3. What genuinely IS a granular, enforced, per-person grant/revoke today

Exactly one mechanism grants and revokes real authorization at per-person, sub-role granularity:
`site_admins`' five boolean columns. Each is read live by an `internal.can_*` function or a session
context field and gates real UI and real RLS, confirmed by grep (each flag is consumed in 3-8 separate
files: `admin/lookups`, `admin/team-directory`, `admin/competitions`, `admin/fixtures`,
`admin/site-admins`, plus `club/venues/venues-section.tsx` for the parent-view case). Live-verified
this pass (§10 below): granting `manage_global_lookups` to a `read_only` Site Admin immediately
changed `internal.can_manage_global_lookups()` from `false` to `true` for their session, and the
`/admin/lookups` page's own conditional notice ("adding, editing, or deactivating requires the Lookups
capability") correctly disappeared on the very next server render -- no cache, no stale state,
independently confirmed at both the SQL/authorization-function layer and the live UI layer. Revoking
it reversed both, immediately, on a fresh page load.

**This mechanism is scoped entirely to the Site Admin / global domain.** There is currently no
equivalent per-club or per-team granular capability grant -- a Club Admin either holds the whole
`CLUB_ADMIN` role at a club or doesn't; a team collaborator holds one of the four whole
`team_permissions.permission` values or doesn't. Picking individual capabilities within a role, for
one specific club or team assignment, is not possible today without a schema change.

## 4. Answering §23's question directly

> Determine whether the existing permission architecture can support CAPABILITY + SCOPE + ASSIGNEE +
> GRANT/REVOKE + AUDIT.

**Partially, unevenly, by domain:**

| Domain | Capability granularity | Scope | Assignee | Grant/Revoke | Audit |
|---|---|---|---|---|---|
| Site Admin (global) | Real, per-flag (5 flags + `admin_role` enum) | Global only | Any user | Yes -- `UPDATE site_admins`, live-verified this pass | `audit_row_change` trigger on `site_admins` |
| Club (per-club) | Coarse -- whole `CLUB_ADMIN`/`FIXTURE_SECRETARY` role only | `club_id` | Any user via `club_memberships` | Yes, at role grain (site-admin-only insert; club-admin can only update within their own club) | `audit_row_change` trigger on `club_memberships` |
| Team (per-team) | Coarse -- whole `view_only`/`coach`/`manager`/`team_admin` permission only | `club_id` + `team_id` | Any club member via `team_permissions` | Yes, at permission grain | `audit_row_change` trigger on `team_permissions` |
| Documentation taxonomy | Real capability *names* exist (`capabilities` table) and are bundled into named groups (`permission_groups`) | Labelled per-group as `club`/`team`/`global` | N/A -- not an assignment mechanism | Editing a group's bundled capabilities doesn't change anyone's real authority | `audit_row_change` trigger on both tables (the edit itself is audited, even though it has no authorization effect) |

The pieces this project would need for true fine-grained per-club/per-team capability grants already
exist as *names* (the `capabilities` table) and the audit infrastructure is already universal
(`internal.audit_row_change()` is attached to every relevant table). What's missing is the *join*: a
table shaped like `club_capability_grants(club_id, user_id, capability_key)` or
`team_capability_grants(team_id, membership_id, capability_key)`, with RLS policies and `internal.can_*`
functions rewritten to check it instead of (or in addition to) the coarse role/permission columns.
**Building that is a real schema change and a real product decision** (which capabilities become
independently grantable, whether they compose with or replace the existing roles, what UI Site Admin
gets to manage it) -- explicitly out of scope for this pass, which only audits and documents the
foundation Access & Teams will eventually build on.

## 5. Section 12: managed capability vs. system invariant

This is the one distinction every future permission decision in Ovalball must keep straight, and the
reason "Site Admin can grant/revoke capabilities" (§10 of the originating pass) is safe:

- **A managed capability** is a yes/no question about *what a specific, already-authenticated,
  already-scoped actor may do to a specific resource they have some relationship to*: "may this user
  manage Burnley's venues?" Grantable, revocable, and (today) expressed via `club_memberships.role` /
  `team_permissions.permission` / `site_admins`' flags. Changing the answer changes what that person
  can do -- it never changes the shape of the boundary itself.
- **A system invariant** is a question with a fixed, non-configurable answer regardless of any
  capability grant: "may a Burnley user mutate Rossendale by submitting its id instead?" Always no,
  unless that same actor independently, genuinely holds authority at Rossendale too -- and even then,
  only because they hold it there directly, never because Burnley's grant "reaches across." No
  `site_admins` flag, no `permission_groups` edit, and no future capability-grant UI is allowed to
  carry an option that weakens this. §11 of the Security & Safeguarding Standard names the exact list
  (cross-club isolation, cross-team isolation, RLS enforcement, Guardian/Player privacy, deny-by-
  default, ...) -- this document doesn't repeat that list, it explains *why* it's a different kind of
  thing from the capabilities above: capabilities decide who gets a key; invariants decide which doors
  exist.

Live proof of the boundary between the two, produced this pass (`supabase/tests/club_settings_capability_
security.sql`, test 9): a genuinely multi-club Club Admin (granted `CLUB_ADMIN` at a second club,
inside a single rolled-back transaction, purely for the test) could legitimately write to *both* clubs
they now administer -- that's the managed-capability side working correctly, the RLS ceiling is "any
club you really administer." Tests 2-5, 7, and 10 in the same file prove the invariant side: an actor
who administers Club A cannot touch Club B's `clubs`/`teams`/`venues`/`club_pitches`/
`club_memberships`/`team_permissions` rows merely by substituting Club B's ids, no matter how the
capability check is phrased. One genuinely new finding tightened this boundary during this pass -- see
§6.

## 6. Finding and fix: `team_permissions` didn't check both ends

The direct-tampering test suite for this pass (test 10) found that `team_permissions_insert_scoped` /
`update_scoped` / `delete_scoped` (RLS policies, since `20260830143512_rls_policies_and_triggers.sql`)
only ever verified that the actor administers the club owning the referenced `membership_id` -- never
that the target `team_id` belonged to that *same* club. A Club Admin at Club A could pair their own
(legitimate) `membership_id` with an arbitrary `team_id` at Club B and insert a `team_permissions` row
granting themselves `team_admin`/`coach`/`manager` there. `internal.can_manage_team()` trusts
`team_permissions.team_id` without cross-checking the referenced membership's club, so this genuinely
granted real cross-club team-management authority -- live-confirmed: after such an insert,
`can_manage_team(<other club's team>)` returned `true` for the attacking actor, and the app's own
`assignTeamMember()` server action (`app/(app)/teams/[teamId]/actions.ts`) takes both `teamId` and
`membershipId` as ordinary parameters with no independent same-club check of its own, so this was
reachable through the real app surface, not only through raw SQL.

Fixed in `supabase/migrations/20260921000000_team_permissions_cross_club_scope_fix.sql`: all three
policies now also require `club_memberships.club_id (for membership_id) = teams.club_id (for team_id)`.
Applied locally; the legitimate same-club path (`assignTeamMember` assigning a club's own member to
that club's own team) is unaffected and was re-verified after the fix. Full regression suite (12/12)
and the pre-existing Player/Guardian suite (12/12) both re-run clean after the change -- no regression.

## 7. The Canonical Scoped Capability Engine (built this pass)

Following the audit above, the engine described as a gap in §4 now exists, in
`supabase/migrations/20260922000000_scoped_capability_engine.sql` and
`20260922100000_has_capability_rpc_wrapper.sql`. It answers exactly the
question this pass set out to answer -- "can this actor perform this
capability on this resource in this scope?" -- through one primitive,
`internal.has_capability(capability_key, scope_type, club_id, team_id)`
(exposed to TypeScript via the thin `public.has_capability` RPC wrapper and
`lib/permissions/has-capability.ts`'s `hasCapability()`), consulted by both
RLS policies directly and server-side page/action code.

**Precedence (deterministic, Section 10):**

1. An active **DENY** override for this exact `(user, capability, scope)` → `false`, full stop -- nothing below can re-grant it.
2. Site Admin master bypass for `club`/`team` scope (existing, documented KEEP -- see §8 below).
3. An active **GRANT** override for this exact `(user, capability, scope)` → `true`.
4. The **role-derived default bundle** for this scope (`internal.has_club_role_capability` / `has_team_role_capability` / `has_site_role_capability` -- hardcoded and audited against real RLS behavior, never sourced from `permission_group_capabilities`).

Scope match is exact -- a club-scope override never cascades to a team-scope
check for a team inside that club, and vice versa. This is deliberate:
implicit cascading is exactly the "silently re-granted by another broad
path" Section 10 forbade.

**Storage: `capability_overrides`.** One append-only table (`user_id`,
`capability_key`, `scope_type`, `club_id`, `team_id`, `effect`
grant/deny, `granted_by`/`granted_at`, `revoked_by`/`revoked_at`,
`status`). Revoking supersedes rather than deletes, so the table doubles as
its own audit trail alongside the standard `audit_row_change` trigger.
Deliberately no direct INSERT/UPDATE/DELETE policy at all -- every write
goes through `public.set_capability_override()` /
`public.revoke_capability_override()`, which enforce, in order: the caller
holds `internal.can_manage_permissions()`; the target is never the caller
themselves (self-escalation, Section 13); the scope shape is well-formed;
a team-scoped grant's team genuinely belongs to the named club (Section
14 -- checked here AND again by a table trigger, AND again inside
`has_capability()` itself at read time -- three independent layers,
matching this codebase's belt-and-braces convention); and the target
already has *some* real relationship at that scope (a capability override
narrows or extends existing authority, it never invents a relationship
from nothing).

**Club Settings integration (Section 19):** `clubs`, `teams`,
`venues`, `club_pitches`, `team_permissions` (insert/update/delete), and
the `club-logos` storage bucket's three write policies were all rewired
to call `has_capability()` instead of their previous inline
`is_club_admin()`/`can_manage_club_fixtures()` checks. Each rewrite was
constructed to produce identical results to the policy it replaced for
every existing role assignment, and this was verified, not assumed --
the full pre-existing regression suite (`player_guardian_security.sql`,
`club_settings_capability_security.sql`) passed unchanged after the
rewire. `app/(app)/club/settings/page.tsx`, `club/page.tsx`,
`club/venues/page.tsx`, and `teams/page.tsx` now compute their section
visibility (and the shared `ClubSettingsNav` tab strip) via three
*independent* `hasCapability()` calls (`club.edit_profile`,
`club.venues.manage`, `club.pitches.manage`) rather than one combined
role flag -- an earlier draft that used one combined flag was caught by
live-testing a deny override (Section 30's own required test) showing
the Lookup Administration card even after `club.venues.manage` was
denied, since it was gated on `club.edit_profile` instead. Fixed before
this pass closed.

## 8. Site Admin bypass audit (Section 18)

Every `is_site_admin()` use relevant to Club Settings/capability domains,
classified:

| Use | Classification | Reasoning |
|---|---|---|
| `has_capability()`'s club/team-scope master bypass | **KEEP** | Matches the pre-existing, unconditional `is_site_admin()` branch already present in `is_club_admin`/`can_manage_team`/`can_manage_club_fixtures` before this pass -- changing it would be a real authority reduction for every existing Site Admin, out of scope here. |
| `permission_groups`/`permission_group_capabilities` writes | **REPLACED** | Was blanket `is_site_admin()` (any active Site Admin, including `read_only`, could edit permission documentation) -- now requires the new `internal.can_manage_permissions()` capability (Section 12), matching every other narrow Site Admin grant in this codebase. |
| `capability_overrides` writes (grant/deny/revoke) | **N/A -- new, built narrow from the start** | Never blanket `is_site_admin()` -- always `can_manage_permissions()`. |
| Every other existing Site Admin domain (Team Catalogue, Competitions, Fixture Support, Global Lookups, Diagnostic Access) | **KEEP, unchanged** | Already narrow, per-person flags from prior passes; out of scope for this one, not touched. |

`internal.can_manage_permissions()` (Section 12's "if a suitable capability
does not exist, introduce one deliberately"): a new `site_admins.
manage_permissions` boolean, off by default even for Full, mirroring
`manage_global_lookups` exactly, with its own `set_site_admin_
permissions_capability()` RPC (Full Site Admin only to grant/revoke, same
convention as every sibling flag).

## 9. Recommendation for Access & Teams (still not built this pass)

The foundation §7 describes is now built -- `has_capability()`, `capability_overrides`, and the
role-default bundle functions are the "proper `club_id`/`team_id`-scoped capability-grant table,
actually consulted by RLS" this section originally called for. When Access & Teams is eventually
scoped, it will need genuinely new capability keys (invite person, approve access request,
assign/revoke role, link Player, link Guardian) but should NOT need a new grant/deny mechanism --
it consumes `capability_overrides` and `has_capability()` exactly as Club Settings does. Two things
this pass deliberately left unbuilt and ready for that work:

- `team.roster.manage` already exists in the capability catalogue and `has_team_role_capability()`
  already resolves it for Club Admin -- but it is granted to NO ONE by default (not Team Admin, not
  Coach), preserving the standing "no new Team Admin write capability" decision. Access & Teams'
  own product decision about whether/how Team Admin self-manages a roster can flip this on for
  specific people via `capability_overrides` without any schema change, or extend the default
  bundle in `has_team_role_capability()` if the decision is to grant it broadly.
- `site.permissions.manage` gates capability administration itself -- Access & Teams' own
  "invite/approve" UI, when built, should call `hasCapability(supabase, 'club.people.invite', ...)`
  (a capability key not yet added -- add it to the catalogue when that feature is scoped, following
  the exact `club.*` naming already established) rather than inventing a fresh authorization check.

Every new capability introduced this way gets a stable string key (`capabilities.key`, following the
existing `club.*`/`team.*`/`fixture.*`/`site.*` naming already in use), a resource scope (`club_id`
alone, or `club_id` + `team_id`), and must be re-derived server-side from the actor + resource on
every write via `has_capability()` -- never inferred from active context, route visibility, or a
role held at a different resource.
