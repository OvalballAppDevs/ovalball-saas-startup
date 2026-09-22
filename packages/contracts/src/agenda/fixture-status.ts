/**
 * WHAT STATE A FIXTURE IS IN, AND WHAT MATCH CENTRE CALLS IT.
 *
 * TWO LAYERS, AND THE DISTINCTION IS REAL. `fixtures.status` is the canonical
 * column -- Planned, Booked, To Be Determined, Annual Holiday, Festival,
 * Lancashire Cup, Cancelled, Completed -- and it is what the database stores.
 * What Match Centre shows is DERIVED from that column plus two others
 * (`cancelled_at` and `kickoff_amendment_proposed_at`), because a fixture whose
 * kick-off change is waiting on the other club is in a state the status column
 * alone cannot express.
 *
 * WHY IT IS HERE. The derivation and the six words lived inside
 * `lib/app-context/match-centre-data.ts`, which carries `import "server-only"`
 * and is unreachable from React Native. The native Match Centre would have had
 * to re-derive them, and the moment it did, one client would say "Booked" where
 * the other said "Confirmed" about the same fixture -- which is precisely the
 * drift the shared-product rule exists to prevent.
 *
 * "CONFIRMED", NOT "BOOKED". The database's word is an operational one: a
 * fixture secretary has booked it. What a parent needs to know is whether it is
 * happening, and the answer to that is confirmed. The word belongs to the
 * presentation layer, which is why it is here and not in a CHECK constraint.
 *
 * COLOUR IS NEVER THE CARRIER. Every state has a WORD and an ICON as well, and a
 * cancelled fixture additionally changes the appearance of the whole card. This
 * module names the icon rather than importing one, because the two clients draw
 * Lucide from two different packages.
 */

export type MatchCentreStatus =
  | "PLANNED"
  | "AWAITING_OPPOSITION"
  | "ACCEPTED"
  | "AMENDMENT_PENDING"
  | "CANCELLED"
  | "COMPLETED"

export type MatchStatusIcon = "circle-check" | "circle-dashed" | "circle-alert"

export interface MatchStatusPresentation {
  key: MatchCentreStatus
  label: string
  icon: MatchStatusIcon
  /** Semantic tone, named rather than painted -- each client supplies its own values. */
  tone: "positive" | "caution" | "negative" | "neutral"
}

const PRESENTATION: Record<MatchCentreStatus, MatchStatusPresentation> = {
  PLANNED: { key: "PLANNED", label: "Planned", icon: "circle-dashed", tone: "neutral" },
  AWAITING_OPPOSITION: { key: "AWAITING_OPPOSITION", label: "Awaiting opposition", icon: "circle-dashed", tone: "caution" },
  ACCEPTED: { key: "ACCEPTED", label: "Confirmed", icon: "circle-check", tone: "positive" },
  AMENDMENT_PENDING: { key: "AMENDMENT_PENDING", label: "Amendment pending", icon: "circle-alert", tone: "caution" },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", icon: "circle-alert", tone: "negative" },
  COMPLETED: { key: "COMPLETED", label: "Completed", icon: "circle-check", tone: "neutral" },
}

/**
 * THE DERIVATION, in the order the checks have to happen.
 *
 * Cancellation first, because a cancelled fixture is cancelled whatever else is
 * true of it. Then a pending kick-off amendment, because a fixture waiting on
 * the other club is not simply "booked" -- an interface that said so would be
 * reporting an agreed time that has not been agreed.
 */
export function matchCentreStatus(fixture: {
  status: string | null
  cancelled_at: string | null
  kickoff_amendment_proposed_at?: string | null
  opponent_team_id?: string | null
  opponent_directory_id?: string | null
}): MatchCentreStatus {
  if (fixture.cancelled_at || fixture.status === "Cancelled") return "CANCELLED"
  if (fixture.kickoff_amendment_proposed_at) return "AMENDMENT_PENDING"
  if (fixture.status === "Completed") return "COMPLETED"
  if (fixture.status === "To Be Determined" || (!fixture.opponent_team_id && !fixture.opponent_directory_id)) {
    return "AWAITING_OPPOSITION"
  }
  if (fixture.status === "Booked") return "ACCEPTED"
  return "PLANNED"
}

export function matchStatusPresentation(status: MatchCentreStatus): MatchStatusPresentation {
  return PRESENTATION[status]
}
