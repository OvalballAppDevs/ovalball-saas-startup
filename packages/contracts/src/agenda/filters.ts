import type { AgendaItem } from "./load"
import type { RangeMode, Direction } from "./window"

/**
 * FILTERS NARROW. THEY NEVER GRANT.
 *
 * This module is deliberately PURE and operates only on rows the server has
 * already returned. That is the structural guarantee: `applyAgendaFilters`
 * takes an array and returns a subset of it, so there is no expressible filter
 * value -- however crafted -- that can produce a row the scope resolver and
 * loader did not already authorise. Widening is not merely forbidden here, it
 * is not representable.
 *
 * The one filter that reaches the database is the DATE WINDOW, and it reaches
 * it as a bound (`gte`/`lte`) on a query whose team ids were fixed by the
 * scope. A hostile anchor can move a person to an empty week. It cannot move
 * them to somebody else's.
 *
 * WHAT LIVES IN THE URL, AND WHY
 *
 * Shareable and reload-safe: the date mode, the anchor, past/upcoming, the
 * opposition, home/away, and whether training is shown. Somebody sending "look
 * at our October" should land the recipient on October.
 *
 * WHAT IS DELIBERATELY NOT HERE: a view mode. Week/Month/Year are TIME-RANGE
 * controls over the chronological agenda, not a switch into a month grid.
 * Ovalball already has one calendar -- /calendar -- and a second month grid
 * over overlapping fixture data would be two products drifting apart, with the
 * next improvement landing on only one of them. Settled as a product decision,
 * not left as a comment defending itself.
 *
 * The CHILD filter also lives there, and that was a deliberate call rather
 * than an oversight. It carries an opaque player UUID, which confers nothing
 * -- the recipient's own scope decides what they see, so an unrelated person
 * opening the link gets their own agenda, not somebody's child. What a shared
 * URL does reveal is that the sender was looking at one particular child, and
 * that is information the sender is choosing to share about their own family.
 * The alternative -- keeping it out of the URL -- would break reload and the
 * back button on the filter a guardian uses most.
 */

export interface AgendaFilterState {
  mode: RangeMode
  /** YYYY-MM-DD. Meaningless in "upcoming" mode, which has no anchor. */
  anchor: string
  direction: Direction
  /** Canonical club_directory id of the opposition, or null for all. Never a display string. */
  opposition: string | null
  homeAway: "all" | "Home" | "Away"
  /** Show training alongside matches. Matches are never hidden -- this is the agenda's floor. */
  includeTraining: boolean
  /**
   * Show fixtures that are not going ahead.
   *
   * ON BY DEFAULT, and that is the important half. A cancelled match is
   * information a parent acts on -- it is the reason they do not drive to a
   * ground on a Sunday morning -- so hiding it by default would be the app
   * quietly deciding they no longer need to know. What this offers is the other
   * direction: a fixture secretary looking down a season at what is actually
   * being played can take the called-off ones out of the way.
   *
   * A cancelled fixture is never merely dimmed into illegibility either: it
   * keeps its struck-through name and its Cancelled badge, so it reads as
   * cancelled whether this is on or off.
   */
  includeCancelled: boolean
  /** Guardian scope only: the child to narrow to, or null for all children. */
  playerId: string | null
  /** Club/staff scope: one team out of the authorised set. */
  teamId: string | null
  /** Platform scope only: one club out of every club. */
  clubId: string | null
  /**
   * Only activities this viewer still owes an answer on, inside the response
   * horizon. A pure narrowing over rows the scope already authorised: it reads
   * item.attendance, which the loader populates ONLY for a personal (family)
   * scope from that viewer's own linked players. A coach has no attendance to
   * owe, so this can never widen anything for them -- it can only empty.
   */
  needsResponse: boolean
}

/**
 * How far ahead "needs a response" asks about.
 *
 * The COUNT and the FILTER use the same horizon deliberately. When they
 * differed, the callout said "2 responses needed" and the list it opened
 * showed three -- the one number a parent acts on disagreeing with the page it
 * took them to.
 */
export const RESPONSE_HORIZON_DAYS = 14

export function defaultFilterState(todayIso: string): AgendaFilterState {
  return {
    mode: "upcoming",
    anchor: todayIso,
    direction: "upcoming",
    opposition: null,
    homeAway: "all",
    // Training is part of a player's week, so it is on by default and
    // switchable off in one tap rather than hidden behind a filter panel.
    includeTraining: true,
    includeCancelled: true,
    playerId: null,
    teamId: null,
    clubId: null,
    needsResponse: false,
  }
}

type Params = Record<string, string | string[] | undefined>

function one(sp: Params, key: string): string | null {
  const v = sp[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

/**
 * Read the filter state out of the query string.
 *
 * Every value is validated against a closed set or a shape. An unrecognised
 * value falls back to the default rather than being passed through -- not for
 * safety (the purity above already provides that) but because a filter nobody
 * can see is a filter nobody can clear.
 */
export function parseFilterState(sp: Params, todayIso: string, parseAnchor: (v: string | null, fallback: string) => string): AgendaFilterState {
  const d = defaultFilterState(todayIso)
  const mode = one(sp, "mode")
  const homeAway = one(sp, "ha")
  const direction = one(sp, "dir")
  const show = one(sp, "show")

  return {
    mode: mode === "day" || mode === "week" || mode === "month" || mode === "year" ? mode : "upcoming",
    anchor: parseAnchor(one(sp, "on"), todayIso),
    direction: direction === "past" ? "past" : "upcoming",
    opposition: one(sp, "opp"),
    homeAway: homeAway === "Home" || homeAway === "Away" ? homeAway : "all",
    includeTraining: show === "matches" ? false : d.includeTraining,
    includeCancelled: one(sp, "cancelled") !== "0",
    playerId: one(sp, "child"),
    teamId: one(sp, "team"),
    clubId: one(sp, "club"),
    needsResponse: one(sp, "needs") === "1",
  }
}

/** The query string for a state, omitting everything at its default so a plain agenda URL stays clean. */
export function filterQuery(state: AgendaFilterState, todayIso: string): string {
  const p = new URLSearchParams()
  if (state.mode !== "upcoming") {
    p.set("mode", state.mode)
    if (state.anchor !== todayIso) p.set("on", state.anchor)
  } else if (state.direction === "past") {
    p.set("dir", "past")
  }
  if (state.opposition) p.set("opp", state.opposition)
  if (state.homeAway !== "all") p.set("ha", state.homeAway)
  if (!state.includeTraining) p.set("show", "matches")
  if (!state.includeCancelled) p.set("cancelled", "0")
  if (state.playerId) p.set("child", state.playerId)
  if (state.teamId) p.set("team", state.teamId)
  if (state.clubId) p.set("club", state.clubId)
  if (state.needsResponse) p.set("needs", "1")
  const q = p.toString()
  return q ? `/agenda?${q}` : "/agenda"
}

/** True when anything is narrowing the view, so the interface can offer to clear it. */
export function hasActiveFilters(state: AgendaFilterState): boolean {
  return (
    state.opposition !== null ||
    state.homeAway !== "all" ||
    !state.includeTraining ||
    !state.includeCancelled ||
    state.playerId !== null ||
    state.teamId !== null ||
    state.clubId !== null ||
    state.needsResponse
  )
}

/**
 * Does this activity still need an answer from this viewer?
 *
 * Unanswered, not in the past, and inside the horizon. `attendance` is null
 * both for "not answered" and for a scope that has no attendance at all, so
 * the caller must only apply this where a response is actually owed --
 * see isPersonalScope.
 */
export function needsResponse(item: AgendaItem, todayIso: string, horizonDays = RESPONSE_HORIZON_DAYS): boolean {
  if (item.attendance !== null) return false
  if (item.date < todayIso) return false
  const [y, m, d] = todayIso.split("-").map(Number)
  const limit = new Date(Date.UTC(y, m - 1, d + horizonDays)).toISOString().slice(0, 10)
  return item.date <= limit
}

/**
 * Narrow the authorised rows.
 *
 * Note what is NOT here: no scope, no session, no capability. This function
 * cannot widen anything because it has nothing to widen from -- it only ever
 * removes members of the array it was given.
 */
export function applyAgendaFilters(items: AgendaItem[], state: AgendaFilterState, todayIso?: string): AgendaItem[] {
  return items.filter((item) => {
    // Narrowing only: this removes answered and out-of-horizon rows. It never
    // reaches for a row the loader did not already return.
    if (state.needsResponse && todayIso && !needsResponse(item, todayIso)) return false
    if (!state.includeTraining && item.kind === "training") return false
    // The canonical status, never a guess from a struck-through label.
    if (!state.includeCancelled && item.status === "Cancelled") return false

    // Opposition is matched on the canonical directory id, never on a name.
    // Training has no opposition, so an opposition filter legitimately
    // excludes it -- somebody filtering to "matches against Rossendale" is
    // asking about matches.
    if (state.opposition) {
      if (item.kind !== "fixture") return false
      if (item.them?.directoryId !== state.opposition) return false
    }

    // Home/away comes from canonical fixture semantics. Training has neither,
    // so it drops out of a home-or-away question rather than being guessed at.
    if (state.homeAway !== "all") {
      if (item.kind !== "fixture") return false
      if (item.homeAway !== state.homeAway) return false
    }

    if (state.playerId && item.playerId !== state.playerId) return false
    if (state.teamId && item.teamId !== state.teamId) return false
    if (state.clubId && item.clubId !== state.clubId) return false

    return true
  })
}

export interface AgendaMonthGroup {
  /** YYYY-MM, stable and sortable. */
  key: string
  monthLabel: string
  year: string
  items: AgendaItem[]
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/**
 * Group into months, preserving the order the loader chose.
 *
 * Order is preserved rather than re-sorted so a backwards look stays newest-
 * first: re-sorting ascending here would silently undo the "past" direction.
 */
export function groupByMonth(items: AgendaItem[]): AgendaMonthGroup[] {
  const groups: AgendaMonthGroup[] = []
  const index = new Map<string, AgendaMonthGroup>()
  for (const item of items) {
    const key = item.date.slice(0, 7)
    let group = index.get(key)
    if (!group) {
      const [y, m] = key.split("-").map(Number)
      group = { key, monthLabel: MONTHS[m - 1], year: String(y), items: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** Every opposition actually present in the authorised rows -- so the filter can only ever offer real, reachable values. */
export function oppositionOptions(items: AgendaItem[]): { id: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== "fixture" || !item.them?.directoryId) continue
    byId.set(item.them.directoryId, item.them.clubName)
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Teams present in the authorised rows, for the club/staff team filter. */
export function teamOptions(items: AgendaItem[]): { id: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const item of items) {
    /*
      THE COMPACT FORM, because a filter chip is the dense surface the canonical
      naming rule names for it -- "U12", "Girls U14", "Men's 1st". A row of chips
      reading "Under 12 Boys", "Under 13 Boys", "Under 14 Boys" is three widths of
      the same four words with the distinguishing part last, which is the opposite
      of scannable.

      It falls back to the DISPLAY form rather than shortening one: a label built
      by trimming words off another label is a naming convention invented for a
      screen.
    */
    if (!byId.has(item.teamId)) byId.set(item.teamId, item.us.compactName ?? item.us.teamName ?? "Team")
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Clubs present in the authorised rows, for the Site Admin club filter. */
export function clubOptions(items: AgendaItem[]): { id: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const item of items) {
    if (item.clubId && !byId.has(item.clubId)) byId.set(item.clubId, item.us.clubName)
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Match types actually present in the authorised rows (owner correction pass, Section 13) -- the
 * canonical stored value itself, exactly as `matchTypeLabel` reads it, never a second vocabulary. A
 * fixture with nothing recorded contributes no option: "unset" is not a match type to filter by.
 */
export function gameTypeOptions(items: AgendaItem[]): { id: string; name: string }[] {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind === "fixture" && item.gameType) seen.add(item.gameType)
  }
  return Array.from(seen, (gameType) => ({ id: gameType, name: gameType })).sort((a, b) => a.name.localeCompare(b.name))
}
