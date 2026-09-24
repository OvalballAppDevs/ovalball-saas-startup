/**
 * The permissions a club decides on this screen, grouped the way the work is divided at a club. Canonical
 * capability keys (Identity/Auth Slice 3); shared by the server page (which asks the database for exactly
 * these) and the panel (which renders them).
 */
export const GROUPS: { title: string; blurb: string; items: { key: string; label: string; description: string }[] }[] = [
  {
    title: "Fixture Operations",
    blurb: "Arranging and maintaining the club's matches.",
    items: [
      { key: "fixture.fixture.view", label: "View Fixtures", description: "See the club's fixture list." },
      { key: "fixture.fixture.create", label: "Create Fixtures", description: "Arrange a new match." },
      { key: "fixture.fixture.edit", label: "Edit Fixtures", description: "Change a date, kick-off, venue or opposition." },
      { key: "fixture.fixture.cancel", label: "Cancel Fixtures", description: "Call a match off, with a reason." },
      { key: "fixture.request.respond", label: "Manage Fixture Requests", description: "Accept or decline requests from other clubs." },
      { key: "fixture.fixture.bulk_edit", label: "Bulk Edit Fixtures", description: "Change many fixtures in one action." },
      { key: "fixture.import.run", label: "Import Fixtures", description: "Upload a season's fixtures from a file." },
    ],
  },
  {
    title: "Training Operations",
    blurb: "Running the club's training sessions.",
    items: [
      { key: "training.plan.manage", label: "Manage Training", description: "Schedule and change training across the club." },
    ],
  },
  {
    title: "Pitch Allocation",
    blurb: "Deciding which team plays on which pitch, and when.",
    items: [
      { key: "venue.pitch_allocation.view", label: "View Pitch Allocation", description: "See how the club's pitches are arranged on a match day." },
      { key: "venue.pitch_allocation.manage", label: "Manage Pitch Allocation", description: "Arrange which team plays on which pitch." },
    ],
  },
  {
    title: "Calendar and Events",
    blurb: "What appears on the club's calendar.",
    items: [
      { key: "calendar.event.view", label: "View Calendar", description: "See the club's calendar." },
      { key: "calendar.event.manage", label: "Manage Calendar", description: "Create and change club events." },
    ],
  },
]

/**
 * THE SAME DECISIONS, FOR ONE TEAM.
 *
 * A Club Admin who wants a coach to run Under 12 Boys' fixtures should not have to make them fixture
 * staff for every side at the club. These are the capabilities the catalogue holds at TEAM scope, which
 * is why the club-wide powers are absent rather than hidden: `fixture.fixture.delete`,
 * `fixture.fixture.bulk_edit`, `fixture.import.run` and `fixture.planner.use` are club-scope
 * capabilities and cannot be granted on a team at all. The list is short because the architecture is,
 * not because this file decided so.
 *
 * The wording is the team's. "Arrange a match for this team" is the decision being taken; the
 * capability key is how the database writes it down.
 */
export const TEAM_GROUPS: typeof GROUPS = [
  {
    title: "Team Fixtures",
    blurb: "What this person may do with this team's matches.",
    items: [
      { key: "fixture.fixture.view", label: "View Fixtures", description: "See this team's fixture list." },
      { key: "fixture.fixture.create", label: "Add Fixtures", description: "Arrange a new match for this team." },
      { key: "fixture.fixture.edit", label: "Edit Fixtures", description: "Change the date, kick-off, venue or opposition of one of this team's matches." },
      { key: "fixture.fixture.cancel", label: "Cancel Fixtures", description: "Call one of this team's matches off, with a reason." },
      { key: "fixture.request.create", label: "Request Fixtures", description: "Ask another club for a match against this team." },
      { key: "fixture.request.respond", label: "Answer Fixture Requests", description: "Accept or decline requests aimed at this team." },
      { key: "fixture.result.record", label: "Record Results", description: "Enter the score after one of this team's matches." },
    ],
  },
]

/** Every capability the permission screens decide, at either scope -- the audited set, and no other. */
export const EDITOR_KEYS: string[] = [...new Set([...GROUPS, ...TEAM_GROUPS].flatMap((g) => g.items.map((i) => i.key)))]

/** The groups a screen renders for a scope: the club's jobs, or one team's. */
export function groupsForScope(scope: "club" | "team"): typeof GROUPS {
  return scope === "team" ? TEAM_GROUPS : GROUPS
}
