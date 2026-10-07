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
 * (e.g. a page's own role-mapping hints) may still
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
 * THE ROLES A CLUB HANDS OUT, WHICH IS THE FULL LIST MINUS ONE.
 *
 * `view_only` is deliberately absent, and this is a FILTER of the canonical list
 * rather than a shorter copy of it, so a future role cannot appear in one and
 * not the other. What it excludes is what a parent or player holds at a team,
 * which arrives through guardianship and squad membership -- offering it beside
 * Coach and Manager invites an administrator to create a relationship by picking
 * its label. The team surface at /teams/[teamId] has always offered exactly
 * these for that reason; it kept its own copy of their wording, which is how it
 * could have drifted from the canonical labels without anything noticing.
 */
export type TeamStaffPermission = Exclude<TeamPermissionValue, "view_only">

export const TEAM_STAFF_PERMISSION_OPTIONS = TEAM_PERMISSION_OPTIONS.filter(
  (o): o is { value: TeamStaffPermission; label: string } => o.value !== "view_only"
)

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

/**
 * THE CANONICAL ROLE KEYS, AND WHAT EACH IS CALLED.
 *
 * `ClubRole` and `TeamPermissionValue` above are the LEGACY projection --
 * `club_memberships.role` and the `team_permissions` view, which between them
 * can express one club role and one team role per person. The authority model
 * outgrew that: `public.role_assignments` holds as many roles as somebody
 * actually does, and `public.role_definitions` names them.
 *
 * One person is very often several of these at once. A club's Safeguarding
 * Officer is usually also somebody's parent; a Fixtures Secretary is very often
 * a coach as well. The database has always allowed it -- `role_assignments`
 * is unique on (user, club, team, ROLE_KEY), so the roles stack -- and
 * `internal.grant_role` refuses none of these combinations. Only the
 * projection into `ClubRole` collapsed them, by taking Club Admin over
 * Fixtures Secretary over Member and dropping everything else.
 *
 * THE LABELS ARE `role_definitions.label`, VERBATIM. Not a second wording: the
 * database is where a role is named, and a client that phrased one differently
 * would be the seventh file to redeclare the same union with conflicting
 * copy -- which is the exact history CLUB_ROLE_LABEL above exists to end.
 */
export type CanonicalRoleKey =
  | "CLUB_ADMIN"
  | "FIXTURES_SECRETARY"
  | "SAFEGUARDING_OFFICER"
  | "VOLUNTEER"
  | "MEMBER"
  | "COACH"
  | "TEAM_MANAGER"
  | "TEAM_ADMINISTRATION"
  | "FIRST_AIDER"
  | "TEAM_SAFEGUARDING_LEAD"

export const CANONICAL_ROLE_LABEL: Record<CanonicalRoleKey, string> = {
  CLUB_ADMIN: "Club Admin",
  FIXTURES_SECRETARY: "Fixture Secretary",
  SAFEGUARDING_OFFICER: "Safeguarding Officer",
  VOLUNTEER: "Volunteer",
  MEMBER: "Member",
  COACH: "Coach",
  TEAM_MANAGER: "Team Manager",
  TEAM_ADMINISTRATION: "Team Admin",
  FIRST_AIDER: "First Aider",
  TEAM_SAFEGUARDING_LEAD: "Team Safeguarding Lead",
}

/**
 * THE CLUB-SCOPED ROLES THAT EARN THEIR OWN PLACE IN THE SWITCHER, in the order
 * they appear there.
 *
 * A role is here when holding it means being offered a genuinely different set
 * of destinations -- which is what the switcher is for. Club Admin runs the
 * club; a Fixtures Secretary arranges matches; a Safeguarding Officer handles
 * welfare and has their own screens; a Volunteer holds whichever narrow job
 * their preset describes.
 *
 * MEMBER is deliberately absent, and that is not an oversight. Being an ordinary
 * member of a club is not a job with its own workspace, and offering "Member" as
 * something to switch INTO would put an empty room in the list. It stays what it
 * has always been: the seat somebody holds when they hold nothing else.
 *
 * ORDER IS AUTHORITY-DESCENDING rather than alphabetical, so the list reads the
 * way a club is organised and the broadest context is the one a session falls
 * back to.
 */
export const SWITCHABLE_CLUB_ROLES: readonly CanonicalRoleKey[] = [
  "CLUB_ADMIN",
  "FIXTURES_SECRETARY",
  "SAFEGUARDING_OFFICER",
  "VOLUNTEER",
] as const

/**
 * The team-scoped roles, most-to-least authoritative.
 *
 * Unlike the club list, a team context is still ONE per team: Coach and Team
 * Manager of the same side are the same job seen from two angles and would offer
 * the same destinations, so two entries for one team would be two doors into one
 * room. The rank picks which name that single context carries.
 */
export const TEAM_ROLE_RANK: readonly CanonicalRoleKey[] = ["TEAM_ADMINISTRATION", "TEAM_MANAGER", "COACH"] as const

export function canonicalRoleLabel(roleKey: string): string {
  return CANONICAL_ROLE_LABEL[roleKey as CanonicalRoleKey] ?? roleKey
}

// ---------------------------------------------------------------------------------------------------
// THE ONE ROLE CATALOGUE, AS PEOPLE READ IT (People & Invitations, 2026-10-05)
// ---------------------------------------------------------------------------------------------------

/**
 * WHAT SOMEBODY CAN DO, AND WHAT SOMEBODY DOES, ARE DIFFERENT QUESTIONS.
 *
 * Before this, the same handful of roles was listed separately -- and differently -- by the
 * invitation form, the Team Staff sheet, the member editor and the web: one list had no First Aider,
 * another no Volunteer, a third called Team Admin "Team Administration". This is the one list every
 * People surface reads, and `people_roles.test.mts` holds it equal to `public.role_definitions`.
 *
 *   CLUB_ACCESS  what somebody can do across the whole club. Exactly one: Club Admin, Fixture
 *                Secretary or Member (the membership's seat, set by set_primary_club_role).
 *   APPOINTED    authority that is appointed, not given: the Safeguarding Officer, nominated through
 *                Safeguarding and confirmed by Ovalball. Shown beside club access, never edited here.
 *   CLUB_ROLE    what somebody does for the club: Volunteer (and the club title -- a description).
 *   TEAM_ROLE    what somebody does for a team: Coach, Team Manager, First Aider, Team Safeguarding Lead,
 *                Volunteer. A team role gives access to that team only.
 *   TEAM_ACCESS  Team Admin: management of one team's people and settings, added on top of a Coach or
 *                Team Manager role there.
 *
 * Descriptions say what the role is for, in a club's words. They are not a promise about every screen.
 */
export type RoleKind = "CLUB_ACCESS" | "APPOINTED" | "CLUB_ROLE" | "TEAM_ROLE" | "TEAM_ACCESS"

export interface CatalogueRole {
  key: CanonicalRoleKey
  label: string
  kind: RoleKind
  description: string
  /** May be held at a team (role_definitions.scope TEAM or CLUB_OR_TEAM). */
  atTeam: boolean
  /** May be held club-wide (scope CLUB or CLUB_OR_TEAM). */
  atClub: boolean
}

export const ROLE_CATALOGUE: readonly CatalogueRole[] = [
  { key: "CLUB_ADMIN", label: CANONICAL_ROLE_LABEL.CLUB_ADMIN, kind: "CLUB_ACCESS", description: "Full access to manage the club.", atTeam: false, atClub: true },
  { key: "FIXTURES_SECRETARY", label: CANONICAL_ROLE_LABEL.FIXTURES_SECRETARY, kind: "CLUB_ACCESS", description: "Manages fixtures, results and opposition.", atTeam: false, atClub: true },
  { key: "MEMBER", label: CANONICAL_ROLE_LABEL.MEMBER, kind: "CLUB_ACCESS", description: "Standard club member access.", atTeam: false, atClub: true },
  { key: "SAFEGUARDING_OFFICER", label: CANONICAL_ROLE_LABEL.SAFEGUARDING_OFFICER, kind: "APPOINTED", description: "The club's safeguarding contact. Appointed through Safeguarding and confirmed by Ovalball.", atTeam: false, atClub: true },
  { key: "VOLUNTEER", label: CANONICAL_ROLE_LABEL.VOLUNTEER, kind: "CLUB_ROLE", description: "Helps out. Sees what members see, plus pitch allocations.", atTeam: true, atClub: true },
  { key: "COACH", label: CANONICAL_ROLE_LABEL.COACH, kind: "TEAM_ROLE", description: "Leads or supports the team's coaching.", atTeam: true, atClub: false },
  { key: "TEAM_MANAGER", label: CANONICAL_ROLE_LABEL.TEAM_MANAGER, kind: "TEAM_ROLE", description: "Runs the team day to day.", atTeam: true, atClub: false },
  { key: "FIRST_AIDER", label: CANONICAL_ROLE_LABEL.FIRST_AIDER, kind: "TEAM_ROLE", description: "Provides first aid for the team.", atTeam: true, atClub: false },
  { key: "TEAM_SAFEGUARDING_LEAD", label: CANONICAL_ROLE_LABEL.TEAM_SAFEGUARDING_LEAD, kind: "TEAM_ROLE", description: "The team's safeguarding contact.", atTeam: true, atClub: false },
  { key: "TEAM_ADMINISTRATION", label: CANONICAL_ROLE_LABEL.TEAM_ADMINISTRATION, kind: "TEAM_ACCESS", description: "Manages the team's people, squad and settings. Added on top of Coach or Team Manager.", atTeam: true, atClub: false },
]

export function catalogueRole(key: string): CatalogueRole | null {
  return ROLE_CATALOGUE.find((r) => r.key === key) ?? null
}

/** The three levels of club access, broadest first -- the one seat every member holds. */
export type ClubAccessKey = "CLUB_ADMIN" | "FIXTURES_SECRETARY" | "MEMBER"
export const CLUB_ACCESS_KEYS: readonly ClubAccessKey[] = ["CLUB_ADMIN", "FIXTURES_SECRETARY", "MEMBER"] as const

/**
 * The seat in the legacy vocabulary `set_primary_club_role` still takes. One mapping, here, so no
 * screen spells BASIC_USER or FIXTURE_SECRETARY itself.
 */
export function clubAccessToLegacyRole(key: ClubAccessKey): ClubRole {
  return key === "FIXTURES_SECRETARY" ? "FIXTURE_SECRETARY" : key === "MEMBER" ? "BASIC_USER" : "CLUB_ADMIN"
}

/**
 * WHAT PEOPLE COMMONLY DO AT A CLUB, offered as club titles. A title is a description: it is stored
 * on the membership (`governance_title`) and grants nothing. The server refuses a title that is the
 * name of a role or of administration, so none of these can read as a privilege.
 */
export const COMMON_CLUB_TITLES: readonly string[] = [
  "Chair",
  "Vice-Chair",
  "President",
  "Secretary",
  "Treasurer",
  "Director of Rugby",
  "Rugby Manager",
  "Membership Secretary",
  "Social Secretary",
  "Youth Chair",
  "Minis Coordinator",
  "Grounds",
  "Communications",
] as const

/**
 * THE COMMON TEAM ROLES, each a governed role with an optional title.
 *
 * Head Coach and Assistant Coach are the Coach role's own two titles (stored as HEAD_COACH /
 * ASSISTANT_COACH). Physio and Kit Manager are Volunteers with a title: what a Volunteer may see is
 * what they may see, and the title only says what they do. A custom role is the same thing with a
 * title the club types -- descriptive, never a new authority.
 */
export interface CommonTeamRole {
  id: string
  label: string
  roleKey: CanonicalRoleKey
  title: string | null
  description: string
}

export const COMMON_TEAM_ROLES: readonly CommonTeamRole[] = [
  { id: "COACH", label: "Coach", roleKey: "COACH", title: null, description: "Leads or supports the team's coaching." },
  { id: "HEAD_COACH", label: "Head Coach", roleKey: "COACH", title: "HEAD_COACH", description: "Leads the team's coaching." },
  { id: "ASSISTANT_COACH", label: "Assistant Coach", roleKey: "COACH", title: "ASSISTANT_COACH", description: "Supports the head coach." },
  { id: "TEAM_MANAGER", label: "Team Manager", roleKey: "TEAM_MANAGER", title: null, description: "Runs the team day to day." },
  { id: "FIRST_AIDER", label: "First Aider", roleKey: "FIRST_AIDER", title: null, description: "Provides first aid for the team." },
  { id: "TEAM_SAFEGUARDING_LEAD", label: "Team Safeguarding Lead", roleKey: "TEAM_SAFEGUARDING_LEAD", title: null, description: "The team's safeguarding contact." },
  { id: "PHYSIO", label: "Physio", roleKey: "VOLUNTEER", title: "Physio", description: "Provides physiotherapy support." },
  { id: "KIT_MANAGER", label: "Kit Manager", roleKey: "VOLUNTEER", title: "Kit Manager", description: "Looks after the team's kit and equipment." },
  { id: "VOLUNTEER", label: "Volunteer", roleKey: "VOLUNTEER", title: null, description: "Helps the team." },
] as const

/**
 * THE TEAM ROLES A PERSON CAN BE GIVEN, by canonical key, for a select or a list (both clients). Additive:
 * giving one never takes another away -- the old `team_admin | coach | manager` seat list replaced a
 * person's other roles on the team, and could not express First Aider, Team Safeguarding Lead or Volunteer.
 * Team Admin is last: it is access added on top of a Coach or Team Manager role.
 */
export const TEAM_ROLE_OPTIONS: { value: CanonicalRoleKey; label: string }[] = (
  ["COACH", "TEAM_MANAGER", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD", "VOLUNTEER", "TEAM_ADMINISTRATION"] as CanonicalRoleKey[]
).map((key) => ({ value: key, label: CANONICAL_ROLE_LABEL[key] }))

/** The base role a custom team role rests on: a Volunteer, so a typed title can never carry more. */
export const CUSTOM_ROLE_BASE: CanonicalRoleKey = "VOLUNTEER"

const COACH_TITLE: Record<string, string> = { HEAD_COACH: "Head Coach", ASSISTANT_COACH: "Assistant Coach" }

/** A stored team title, as people read it: the Coach role's two codes in words, anything else as typed. */
export function teamTitleLabel(title: string | null | undefined): string | null {
  if (!title) return null
  return COACH_TITLE[title] ?? title
}

/** What to call somebody's role: its title where it has one ("Physio"), else the role ("First Aider"). */
export function roleDisplayLabel(roleKey: string, title?: string | null): string {
  return teamTitleLabel(title) ?? canonicalRoleLabel(roleKey)
}
