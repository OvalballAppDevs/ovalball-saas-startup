/**
 * Real literal unions, matching the DB check constraints exactly
 * (`club_memberships_role_check` / `team_permissions_permission_check`) --
 * NOT re-exported from lib/app-context/session-context.ts's own `ClubRole`/
 * `TeamPermissionValue`, because those resolve to the generated
 * Database["public"]["Tables"][...]["Row"]["role"] type, which Supabase's
 * type generator emits as plain `string` (it only captures native Postgres
 * enum types, not CHECK constraints) -- using them here would have widened
 * every `value` field back to `string`, losing exactly the compile-time
 * narrowing the 7 files this replaces already relied on locally.
 */
export type ClubRole = "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY"
export type TeamPermissionValue = "team_admin" | "coach" | "manager" | "view_only"

/**
 * The one canonical wording for every `club_memberships.role` /
 * `team_permissions.permission` value in the whole app. Before this file
 * existed, 7 files each independently redeclared the same literal union
 * with genuinely conflicting wording for the SAME live value:
 * FIXTURE_SECRETARY read "Fixture Secretary" in 2 files and "Fixtures
 * Admin" in 2 others; BASIC_USER had 3 different phrasings ("Member (no
 * club-wide permission)", "Member (club-wide, no admin)", "View only
 * (club-wide)"); view_only had 4 ("View only" / "Parent/Player" /
 * "Parent / Player (view only)" / "Parents / Players").
 *
 * Picked the clearest existing wording per value rather than inventing new
 * copy: "Fixture Secretary" (matches the DB value's own name, and was
 * already the majority usage) over "Fixtures Admin"; "Member" (the common
 * thread across all three BASIC_USER phrasings) over a qualifying
 * parenthetical that belongs in page-specific hint text, not the shared
 * label itself; "Parent / Player (view only)" (the most descriptive of
 * the four view_only variants) over the bare "View only" or "Parent/Player"
 * alternatives.
 *
 * A page needing a plural form (e.g. teams/[teamId]/team-people.tsx's
 * "Coaches"/"Managers" group headers) or extra explanatory hint text
 * (e.g. admin/permissions/group-form.tsx's role-mapping hints) may still
 * add that ON TOP of these labels -- that's legitimate page-specific
 * framing, not a second source of truth for what the value itself is
 * CALLED.
 */
export const CLUB_ROLE_LABEL: Record<ClubRole, string> = {
  BASIC_USER: "Member",
  CLUB_ADMIN: "Club Admin",
  FIXTURE_SECRETARY: "Fixture Secretary",
}

export const CLUB_ROLE_OPTIONS: { value: ClubRole; label: string }[] = [
  { value: "CLUB_ADMIN", label: CLUB_ROLE_LABEL.CLUB_ADMIN },
  { value: "FIXTURE_SECRETARY", label: CLUB_ROLE_LABEL.FIXTURE_SECRETARY },
  { value: "BASIC_USER", label: CLUB_ROLE_LABEL.BASIC_USER },
]

export const TEAM_PERMISSION_LABEL: Record<TeamPermissionValue, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  manager: "Manager",
  view_only: "Parent / Player (view only)",
}

export const TEAM_PERMISSION_OPTIONS: { value: TeamPermissionValue; label: string }[] = [
  { value: "team_admin", label: TEAM_PERMISSION_LABEL.team_admin },
  { value: "coach", label: TEAM_PERMISSION_LABEL.coach },
  { value: "manager", label: TEAM_PERMISSION_LABEL.manager },
  { value: "view_only", label: TEAM_PERMISSION_LABEL.view_only },
]

/**
 * Safe lookups for a value read back from the database as a plain
 * `string` (every real caller's actual situation, per the note above) --
 * falls back to the raw value itself rather than throwing or rendering
 * "undefined", so an unexpected/future DB value still shows something
 * reasonable instead of breaking the page.
 */
export function clubRoleLabel(role: string): string {
  return CLUB_ROLE_LABEL[role as ClubRole] ?? role
}

export function teamPermissionLabel(permission: string): string {
  return TEAM_PERMISSION_LABEL[permission as TeamPermissionValue] ?? permission
}
