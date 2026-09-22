/**
 * CONVERGENCE STEP 18 (UX-4) — the mobile bottom bar's labels.
 *
 * ITS OWN MODULE, deliberately dependency-free. `build-nav-items.ts` decides WHICH destinations the bar
 * carries, but it imports `session-context`, which is `server-only` — and the bar is a client component.
 * Importing the chooser there is what broke the build the first time this was written, so the one thing
 * the client genuinely needs lives here, with nothing behind it.
 */
/**
 * A short label for the bar, where the sidebar's own label only makes sense inside its section.
 *
 * FOUR ENTRIES, and each earns it. A sidebar row is wide and its label can be specific; a bar cell is
 * about 78px at 390px and truncates. This is NOT a second label system -- everything not named here uses
 * the label buildNavItems already produced, and the map is meant to stay this small. If it starts growing,
 * the sidebar labels are the problem, not this file.
 */
const BAR_LABEL: Record<string, string> = {
  // "Overview", because on the sidebar it sits under a Users & People heading.
  "/people": "People",
  // The Site Admin catalogue is written for a sidebar, where "Fixture Control Centre" is a useful,
  // specific name. In an 11px cell about 78px wide it becomes "Fixture Co…", which is worse than a short
  // word. The workspace is already named by the shell, so the cell does not need to repeat "Management".
  "/admin/clubs": "Clubs",
  "/admin/users": "Users",
  "/admin/fixtures": "Fixtures",
  // The sidebar's calendar label is sometimes a TEAM'S DISPLAY NAME: a view-only person with exactly one
  // team gets their team's name there, because in a sidebar that is more use than the word "Calendar".
  // A cell cannot carry club-entered data of any length, and the shell already says which context you are
  // in, so on the bar it is always the plain word.
  "/calendar": "Calendar",
  // The agenda's sidebar label is already "Fixtures" and already fits; naming it here is belt and
  // braces for the day somebody lengthens it, and it documents that the bar's Fixtures cell is the
  // shared overview rather than either of the two administrative surfaces beside it.
  "/agenda": "Fixtures",
  // "Fixture Control Centre" is a good sidebar name and 22 characters. In a cell it becomes
  // "Fixture Co…", which is worse than a short honest word.
  "/fixtures/management": "Fixture Admin",
  "/fixtures": "Requests",
}

/**
 * Destinations whose label is DATA rather than a catalogue string, matched by shape.
 *
 * A team's nav label is the team's own display name -- "Under 12 Boys", "Under 14 Girls B", "Men's 1st
 * Team". Measured in the Step 18 hardening pass, "Under 12 Boys" clips in a five-cell bar at 390px, and a
 * club may legitimately field a side with a longer name still, so no length of override list fixes this.
 *
 * "Team" is what the desktop sidebar already calls that group (`buildClubSections`), and in a team context
 * it is unambiguous -- there is one team being operated as, and the page it opens is headed with its name.
 */
const BAR_LABEL_BY_SHAPE: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/teams\/[^/]+$/, label: "Team" },
  // "People & Access" is 15 characters and clips; the governing workspace's own heading keeps the full
  // phrase, and the shell already says which organisation you are in.
  { pattern: /^\/governing\/[^/]+\/people$/, label: "People" },
]

/** The bar's label for a destination: its own where that stands alone, a shorter one where it does not. */
export function bottomBarLabel(item: { href: string; label: string }): string {
  const byShape = BAR_LABEL_BY_SHAPE.find((r) => r.pattern.test(item.href))
  if (byShape) return byShape.label
  return BAR_LABEL[item.href] ?? item.label
}

