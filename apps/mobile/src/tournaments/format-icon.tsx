import type { TournamentFormat } from "@ovalball/contracts/club/tournaments"

import { GitBranch, Layers, ListOrdered, Repeat, Trophy } from "../components/icons"

/**
 * ONE ICON PER COMPETITION SHAPE, in one place.
 *
 * Each means what it shows rather than decorating the row: a standings list for round robin, a
 * three-way rotation for tri-fixture, repeated rounds for Swiss, the single trophy a knockout ends in,
 * and stacked stages for groups-then-knockout. The previous version repeated this map in four files,
 * which is how a fifth shape ends up with an icon in three of them.
 */
export const FORMAT_ICON: Record<TournamentFormat, typeof ListOrdered> = {
  round_robin: ListOrdered,
  tri_fixture: GitBranch,
  swiss: Repeat,
  knockout: Trophy,
  hybrid: Layers,
}
