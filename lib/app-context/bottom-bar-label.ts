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
}

/** The bar's label for a destination: its own where that stands alone, a shorter one where it does not. */
export function bottomBarLabel(item: { href: string; label: string }): string {
  return BAR_LABEL[item.href] ?? item.label
}

