import type { AgendaItem } from "@/lib/agenda/load"

/**
 * WHEN A FAMILY IS ASKED TO ANSWER, IN THE AGENDA.
 *
 * Deliberately narrow, and deliberately NOT an authority decision: the server
 * owns that, and `internal.resolve_attendance_response_source` refuses anybody
 * it should refuse whether or not a control was drawn. This only decides
 * whether ASKING makes sense on this row.
 *
 * It asks three things, and invents no deadline of its own -- the canonical
 * rules carry none, and adding one here would be a product decision made in a
 * component:
 *
 *   - the row is about a specific player. A coach reading their squad's agenda
 *     is not being asked whether they can attend, and `playerId` is null for
 *     every staff, club and platform scope;
 *   - the rugby has not already happened. Answering a match played last month
 *     changes nothing and reads as though it might;
 *   - the rugby is still going ahead. A cancelled fixture has nothing to
 *     answer, and offering three buttons on one would be asking a parent to
 *     commit to something that is not happening.
 */
const NOT_GOING_AHEAD = new Set(["cancelled", "postponed", "abandoned"])

export function isAnswerable(item: AgendaItem, todayIso: string): boolean {
  if (!item.playerId) return false
  if (item.date < todayIso) return false
  if (item.status && NOT_GOING_AHEAD.has(item.status.toLowerCase())) return false
  return true
}
