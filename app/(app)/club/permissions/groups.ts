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
    title: "Calendar and Events",
    blurb: "What appears on the club's calendar.",
    items: [
      { key: "calendar.event.view", label: "View Calendar", description: "See the club's calendar." },
      { key: "calendar.event.manage", label: "Manage Calendar", description: "Create and change club events." },
    ],
  },
]
