/**
 * ONE canonical Mini-Rugby Group display resolver (Section 15/16/36 of the
 * Mini-Rugby / Team Administration brief) -- every surface that shows a
 * scheduling_groups row to a user (Calendar lanes/filters, Agenda, Fixture
 * Management, Fixture Detail, Pitch Allocation, Team Administration,
 * fixture requests) must call this, never hand-build "{tag} Shared" or
 * "{tag} Shared Calendar"/"Shared Team" inline. display_tag is the
 * server-derived structural age coverage ("U7/U8"); alias is the club's
 * optional cosmetic suffix ("Falcons") -- alias never replaces or hides
 * the structural tag (Section 16: "alias does not define identity").
 */
export function miniRugbyGroupLabel(g: { displayTag: string; alias: string | null }): string {
  return g.alias ? `${g.displayTag} ${g.alias}` : `${g.displayTag} Tags`
}
