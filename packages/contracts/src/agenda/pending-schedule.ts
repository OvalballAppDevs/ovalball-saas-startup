import type { TeamFixtureRequest } from "../team/requests"
import type { AgendaItem, AgendaSide } from "./load"

/**
 * PENDING FIXTURE REQUESTS AS SCHEDULE ITEMS (owner correction pass, Sections 7-14).
 *
 * A DELIBERATELY SEPARATE TYPE, not a widened `AgendaItem.kind` (tried first, reverted): `AgendaItem`
 * is shared with the website's own Agenda/Team/Calendar pages, several of which narrow `kind` to
 * exactly `"fixture" | "training"` in their own prop types -- widening the union there broke three real
 * web components and a shared availability type for no gain a mobile-only screen actually needs.
 * `PendingScheduleItem` instead mirrors `AgendaItem`'s OWN field names (so a caller can render both
 * with one shared row component, keyed on `"kind"`) without touching the type every existing consumer
 * of `AgendaItem` already relies on.
 *
 * WHAT COUNTS AS "PENDING" HERE: only `sent` and `counter_proposed` -- the two states that mean
 * "still waiting on somebody" (`readTeamFixtureRequests`'s own doc comment). `accepted` is deliberately
 * excluded: an accepted request's real, resulting Fixture is what `loadAgenda` already returns from the
 * `fixtures` table, and showing BOTH would be the exact duplicate this pass exists to prevent.
 * `declined`/`cancelled`/`expired` are excluded because they are no longer live scheduling intent at
 * all -- an ordinary team's upcoming schedule has no reason to keep showing them.
 *
 * A COUNTERED REQUEST'S CURRENT DATE is the countered one, never the original ask (Section 12) -- the
 * countered_* fields hold the LATEST standing proposal, which is what a schedule should show as "the
 * date this might actually happen."
 */
export interface PendingScheduleItem {
  key: string
  kind: "fixture_request"
  eventId: string
  date: string
  time: string | null
  us: AgendaSide
  them: AgendaSide
  homeAway: "Home" | "Away" | "TBD"
  gameType: string | null
  teamId: string
  /** Never Match Centre (there is no Fixture yet) -- the caller routes this to the request/negotiation
   * surface using `requestId` directly; this stays null so nothing can mistake it for a Fixture href. */
  href: null
  requestId: string
  requestStatus: "sent" | "counter_proposed"
  requestDirection: "incoming" | "outgoing"
  /** Authority-sensitive, plain-language status (Section 8): the sender is waiting, the recipient must
   * respond -- never inferred from merely being able to see the row; offering an actual Respond control
   * stays `fixture.request.respond`'s own job. */
  status: "Awaiting response" | "Response required"
}

export function pendingScheduleItemsForTeam(requests: readonly TeamFixtureRequest[], teamId: string, us: AgendaSide): PendingScheduleItem[] {
  return requests
    .filter((r): r is TeamFixtureRequest & { status: "sent" | "counter_proposed" } => r.status === "sent" || r.status === "counter_proposed")
    .map((r): PendingScheduleItem => {
      const isCountered = r.status === "counter_proposed"
      const date = (isCountered ? r.counteredDate : null) ?? r.proposedDate ?? ""
      const venue = (isCountered ? r.counteredVenuePreference : null) ?? r.venuePreference
      return {
        key: `request-${r.id}`,
        kind: "fixture_request",
        eventId: r.id,
        date,
        time: isCountered ? r.counteredKickoffTime : r.preferredKickoffTime,
        us,
        them: { directoryId: null, clubName: r.otherClub, teamName: r.otherTeam, compactName: null, rugbyCode: null, crestUrl: null, kit: null },
        homeAway: venue === "home" ? "Home" : venue === "away" ? "Away" : "TBD",
        gameType: r.gameType,
        teamId,
        href: null,
        requestId: r.id,
        requestStatus: r.status,
        requestDirection: r.direction,
        status: r.direction === "incoming" ? "Response required" : "Awaiting response",
      }
    })
}

/**
 * ONE MERGE, FOR EVERY SCREEN THAT SHOWS A SCHEDULE (Section 16): real fixtures/training from
 * `loadAgenda` plus pending requests from `pendingScheduleItemsForTeam`, deduplicated defensively (an
 * accepted request's own resulting Fixture already excludes it from the pending side by construction,
 * per the filter above -- this guard is a second, cheap safety net, never the only thing preventing a
 * duplicate) and sorted by date. Fixtures and Calendar both call this SAME function rather than each
 * writing their own merge/sort/dedupe logic that could quietly disagree. The result is a plain union
 * array; a screen discriminates on `.kind` to render either row shape.
 */
export function mergeScheduleWithPendingRequests(fixtureItems: readonly AgendaItem[], pendingItems: readonly PendingScheduleItem[]): (AgendaItem | PendingScheduleItem)[] {
  const bookedKeys = new Set(fixtureItems.filter((i) => i.kind === "fixture").map((i) => `${i.teamId}|${i.date}|${i.them?.clubName ?? ""}`))
  const dedupedPending = pendingItems.filter((p) => !bookedKeys.has(`${p.teamId}|${p.date}|${p.them.clubName}`))
  return [...fixtureItems, ...dedupedPending].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
