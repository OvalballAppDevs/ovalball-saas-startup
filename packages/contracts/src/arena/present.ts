/**
 * ARENA, PRESENTED -- pure functions from the server's projection to what a screen says.
 *
 * Nothing here decides whether a pitch is free or a placement clashes: the server's one engine has
 * already said so in `occupancy` and `conflicts`. These only arrange, label and count what it said --
 * so the phone, a test and (later) the website say the same words about the same day.
 */
import { compactTeamLabel } from "../teams/compact-label"
import type {
  AllocationPreview,
  ArenaActivity,
  ArenaChange,
  ArenaConflict,
  ArenaDay,
  ArenaEvent,
  ArenaFixture,
  ArenaNeed,
  ArenaOccupancy,
  ArenaRangeDay,
  ArenaHub,
  ArenaReadiness,
  ArenaTeam,
  ArenaTraining,
  PreviewItem,
} from "./types"

// ------------------------------------------------------------------ time

/** "HH:MM" (or "HH:MM:SS") as minutes of the day; 24:00 is the end of the day. */
export function toMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null
  const [h, m] = clock.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export function clock(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)))
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"]

function minuteWords(m: number): string {
  if (m === 0) return ""
  if (m < 10) return ` oh ${NUMBER_WORDS[m]}`
  if (m < 20) return ` ${NUMBER_WORDS[m]}`
  const tens = TENS[Math.floor(m / 10)]
  return m % 10 === 0 ? ` ${tens}` : ` ${tens} ${NUMBER_WORDS[m % 10]}`
}

/** A clock time as VoiceOver should say it: "10:30" -> "ten thirty AM", "12:40" -> "twelve forty PM", "09:00" -> "nine AM". */
export function spokenTime(time: string | null | undefined): string {
  const total = toMinutes(time)
  if (total === null) return "no time yet"
  if (total >= 1440) return "midnight"
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${NUMBER_WORDS[h12]}${minuteWords(m)} ${h24 < 12 ? "AM" : "PM"}`
}

// ------------------------------------------------------------------ naming

/** A team's compact form for dense surfaces ("U12", "Girls U14", "Men's 1st"); its display name elsewhere. */
export function teamShort(team: ArenaTeam | null, fallback = "Team"): string {
  if (!team) return fallback
  return compactTeamLabel({
    category: team.category ?? "youth",
    ageGroup: team.ageGroup,
    gender: team.gender,
    squadDesignation: team.squadDesignation,
    rugbyCode: team.rugbyCode as "union" | "league" | null,
    alias: team.alias,
  })
}

/** An opposition club's name without its ", RFC" style suffix noise: "Bolton RFC" stays; nothing is invented. */
export function opponentShort(name: string): string {
  return name.trim()
}

/** What an activity is called on a timeline block or a row: "U9 v Bolton RFC", "U12 Training", the event's name. */
export function activityLabel(a: ArenaActivity): string {
  switch (a.kind) {
    case "FIXTURE":
      return a.home ? `${teamShort(a.team)} v ${opponentShort(a.opponentName)}` : `${teamShort(a.team)} at ${opponentShort(a.opponentName)}`
    case "TRAINING":
      return `${a.team ? teamShort(a.team) : a.groupLabel ?? "Team"} Training`
    default:
      return a.title
  }
}

/**
 * AN ACTIVITY'S TITLE where it is named on its own -- a detail sheet, an Allocate sheet, a confirmation:
 * the team's canonical display name ("Under 13 Boys v Kendal RFC", "Under 12 Boys Training"). The compact
 * label above is for dense rows and the timeline only.
 */
export function activityTitle(a: ArenaActivity): string {
  switch (a.kind) {
    case "FIXTURE": {
      const team = a.team?.displayName || teamShort(a.team)
      return a.home ? `${team} v ${a.opponentName}` : `${team} at ${a.opponentName}`
    }
    case "TRAINING":
      return `${a.team?.displayName || a.groupLabel || "Team"} Training`
    default:
      return a.title
  }
}

/** The word a person reads for what kind of thing it is -- never colour alone. */
export function kindWord(a: ArenaActivity): string {
  if (a.kind === "FIXTURE") return a.home ? "Home" : "Away"
  if (a.kind === "TRAINING") return "Training"
  if (a.kind === "TOURNAMENT") return "Tournament"
  return "Event"
}

// ------------------------------------------------------------------ when

/** When an activity starts and ends, in minutes, for sorting and lists (a fixture's match, not its warm-up). */
export function activitySpan(a: ArenaActivity): { start: number | null; end: number | null } {
  if (a.kind === "FIXTURE") {
    const start = toMinutes(a.kickoff)
    return { start, end: start === null ? null : start + a.playMinutes }
  }
  if (a.kind === "TRAINING") return { start: toMinutes(a.start), end: toMinutes(a.end) }
  if (a.kind === "TOURNAMENT") return { start: toMinutes(a.start), end: toMinutes(a.end) }
  return { start: a.allDay ? 0 : toMinutes(a.start), end: a.allDay ? 1440 : toMinutes(a.end) }
}

/** "11:00–12:20", "From 18:30", "All day", or "Time to be confirmed". */
export function timeRange(a: ArenaActivity): string {
  if (a.kind === "EVENT" && a.allDay) return "All day"
  const { start, end } = activitySpan(a)
  if (start === null) return "Time to be confirmed"
  if (end === null) return `From ${clock(start)}`
  return `${clock(start)}–${clock(end)}`
}

export function sortActivities(list: ArenaActivity[]): ArenaActivity[] {
  return [...list].sort((a, b) => {
    const sa = activitySpan(a).start ?? 1441
    const sb = activitySpan(b).start ?? 1441
    if (sa !== sb) return sa - sb
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// ------------------------------------------------------------------ where

function pitchName(day: Pick<ArenaDay, "pitches">, id: string | null): string | null {
  return id ? day.pitches.find((p) => p.id === id)?.name ?? null : null
}

function roomName(day: Pick<ArenaDay, "rooms">, id: string | null): string | null {
  return id ? day.rooms.find((r) => r.id === id)?.name ?? null : null
}

/** Two rooms read as one phrase where they share a word: "Rooms 1 & 2"; otherwise both names. */
export function roomsPhrase(home: string | null, away: string | null): string | null {
  if (home && away) {
    const a = home.match(/^(.*?)(\d+)$/)
    const b = away.match(/^(.*?)(\d+)$/)
    if (a && b && a[1] === b[1]) return `${a[1].trim()}s ${a[2]} & ${b[2]}`.replace(/ss /, "s ")
    return `${home} & ${away}`
  }
  return home ?? away
}

/**
 * WHERE AN ACTIVITY IS, in a line: "Pitch 1 · Rooms 1 & 2", "Pitch not allocated", "Clubhouse",
 * "Away · Bury RFC". Unallocated parts are named as such -- never left blank.
 */
export function placeLine(day: Pick<ArenaDay, "pitches" | "rooms">, a: ArenaActivity): string {
  if (a.kind === "FIXTURE") {
    // The place alone: the kind ("Away") is said once, by whoever shows it beside this.
    if (!a.home) return a.venueName ?? a.opponentName
    const pitch = pitchName(day, a.pitchId) ?? a.pitchName
    const rooms = a.noChangingRooms ? "No changing rooms" : roomsPhrase(roomName(day, a.homeRoomId), roomName(day, a.awayRoomId))
    return [pitch ?? "Pitch not allocated", a.needs.includes("ROOMS") ? "Rooms not allocated" : rooms].filter(Boolean).join(" · ")
  }
  if (a.kind === "TRAINING") {
    const pitch = pitchName(day, a.pitchId) ?? a.pitchName ?? "Pitch not allocated"
    if (!a.needsRoom && !a.roomId) return pitch
    return [pitch, roomName(day, a.roomId) ?? (a.needs.includes("ROOMS") ? "Room not allocated" : null)].filter(Boolean).join(" · ")
  }
  if (a.kind === "TOURNAMENT") {
    const names = a.reservations.map((r) => pitchName(day, r.pitchId)).filter((n): n is string => Boolean(n))
    return names.length === 0 ? "No pitches reserved" : `${names.length === 1 ? "" : `${names.length} pitches · `}${[...new Set(names)].join(", ")}`
  }
  const pitches = a.pitchIds.map((id) => pitchName(day, id)).filter((n): n is string => Boolean(n))
  if (pitches.length > 0) return pitches.join(", ")
  if (a.locationKind === "ONLINE") return "Online"
  if (a.locationKind === "EXTERNAL") return a.externalName ?? "Away from the club"
  return a.locationDetail ?? a.venueName ?? "At the club"
}

// ------------------------------------------------------------------ what is missing, what clashes

/** "Pitch", "Rooms", "Kick-off" ... -- each unallocated part of an activity, in words. */
export function needWords(need: ArenaNeed): string {
  switch (need) {
    case "KICKOFF": return "Kick-off"
    case "VENUE": return "Ground"
    case "PITCH": return "Pitch"
    case "ROOMS": return "Rooms"
    case "TIME": return "Time"
  }
}

/** The lines a Needs Allocation card shows: "Pitch — Not allocated", "Away room — Not allocated". */
export function needLines(day: Pick<ArenaDay, "rooms">, a: ArenaFixture | ArenaTraining): string[] {
  const lines: string[] = []
  for (const need of a.needs) {
    if (need === "ROOMS" && a.kind === "FIXTURE") {
      if (!a.homeRoomId) lines.push("Home room — Not allocated")
      if (!a.awayRoomId) lines.push("Away room — Not allocated")
      continue
    }
    if (need === "ROOMS") {
      lines.push("Changing room — Not allocated")
      continue
    }
    lines.push(`${needWords(need)} — Not allocated`)
  }
  return lines.filter((l, i) => lines.indexOf(l) === i)
}

/** Everything still needing allocation, home fixtures and sessions, in time order. */
export function needsAllocation(activities: ArenaActivity[]): (ArenaFixture | ArenaTraining)[] {
  return sortActivities(activities).filter((a): a is ArenaFixture | ArenaTraining =>
    (a.kind === "FIXTURE" && a.home && a.needs.length > 0) || (a.kind === "TRAINING" && a.needs.length > 0))
}

/** The clashes an activity is in, hard first. */
export function conflictsFor(conflicts: ArenaConflict[], activityId: string): ArenaConflict[] {
  return conflicts.filter((c) => c.activityIds.includes(activityId)).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1))
}

// ------------------------------------------------------------------ filters

export type ArenaFilter = "ALL" | "GAMES" | "TRAINING" | "TOURNAMENTS" | "EVENTS" | "UNALLOCATED"

export const ARENA_FILTERS: { key: ArenaFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "GAMES", label: "Games" },
  { key: "TRAINING", label: "Training" },
  { key: "TOURNAMENTS", label: "Tournaments" },
  { key: "EVENTS", label: "Events" },
  { key: "UNALLOCATED", label: "Unallocated" },
]

function isUnallocated(a: ArenaActivity): boolean {
  return (a.kind === "FIXTURE" && a.home && a.needs.length > 0) || (a.kind === "TRAINING" && a.needs.length > 0)
}

/** Whether an activity is at one ground: its own ground, a pitch there, or a reservation there. */
export function atVenue(day: Pick<ArenaDay, "pitches">, a: ArenaActivity, venueId: string | null): boolean {
  if (!venueId) return true
  const pitchVenue = (id: string | null) => (id ? day.pitches.find((p) => p.id === id)?.venueId ?? null : null)
  if (a.kind === "FIXTURE") return a.home && (a.venueId === venueId || pitchVenue(a.pitchId) === venueId || (!a.venueId && !a.pitchId))
  if (a.kind === "TRAINING") return a.venueId === venueId || pitchVenue(a.pitchId) === venueId || (!a.venueId && !a.pitchId)
  if (a.kind === "TOURNAMENT") return a.venueId === venueId || a.reservations.some((r) => pitchVenue(r.pitchId) === venueId)
  return a.venueId === venueId || a.pitchIds.some((id) => pitchVenue(id) === venueId)
}

export function filterActivities(day: Pick<ArenaDay, "pitches" | "activities">, filter: ArenaFilter, venueId: string | null): ArenaActivity[] {
  return sortActivities(day.activities).filter((a) => {
    if (!atVenue(day, a, venueId)) return false
    switch (filter) {
      case "ALL": return true
      case "GAMES": return a.kind === "FIXTURE"
      case "TRAINING": return a.kind === "TRAINING"
      case "TOURNAMENTS": return a.kind === "TOURNAMENT"
      case "EVENTS": return a.kind === "EVENT"
      case "UNALLOCATED": return isUnallocated(a)
    }
  })
}

/**
 * What still needs allocating AT ONE GROUND -- `atVenue`'s rule, so the board's queue, the List's Needs
 * Allocation and its Unallocated chip can never disagree about the same venue; every ground when none is
 * chosen. Something with no ground yet belongs to every ground's view: it could go to any of them.
 */
export function needsAllocationAt(day: Pick<ArenaDay, "pitches" | "activities">, venueId: string | null): (ArenaFixture | ArenaTraining)[] {
  return needsAllocation(day.activities).filter((a) => atVenue(day, a, venueId))
}

export function filterCounts(day: Pick<ArenaDay, "pitches" | "activities">, venueId: string | null): Record<ArenaFilter, number> {
  const out = {} as Record<ArenaFilter, number>
  for (const f of ARENA_FILTERS) out[f.key] = filterActivities(day, f.key, venueId).length
  return out
}

// ------------------------------------------------------------------ readiness

/** "Ready", or the facts that need attention -- never a score. */
export function readinessHeadline(r: ArenaReadiness): string {
  return r.state === "READY" ? "Ready" : "Needs Attention"
}

export function readinessLines(r: ArenaReadiness): string[] {
  const lines: string[] = []
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  if (r.needsAllocation > 0) lines.push(n(r.needsAllocation, "needs allocation", "need allocation"))
  if (r.pitchConflicts > 0) lines.push(n(r.pitchConflicts, "pitch clash", "pitch clashes"))
  if (r.roomConflicts > 0) lines.push(n(r.roomConflicts, "changing-room clash", "changing-room clashes"))
  if (r.tournamentConflicts > 0) lines.push(n(r.tournamentConflicts, "tournament schedule clash", "tournament schedule clashes"))
  if (r.cateringIncomplete > 0) lines.push(n(r.cateringIncomplete, "catering total incomplete", "catering totals incomplete"))
  return lines
}

/** The day in counts: "12 activities · 5 home games · 3 training · 1 event". */
export function dayCountsLine(r: ArenaReadiness): string {
  const parts = [`${r.activities} ${r.activities === 1 ? "activity" : "activities"}`]
  if (r.homeGames > 0) parts.push(`${r.homeGames} home ${r.homeGames === 1 ? "game" : "games"}`)
  if (r.awayGames > 0) parts.push(`${r.awayGames} away`)
  if (r.training > 0) parts.push(`${r.training} training`)
  if (r.tournaments > 0) parts.push(`${r.tournaments} ${r.tournaments === 1 ? "tournament" : "tournaments"}`)
  if (r.events > 0) parts.push(`${r.events} ${r.events === 1 ? "event" : "events"}`)
  return parts.join(" · ")
}

// ------------------------------------------------------------------ catering

/**
 * A FIXTURE'S CATERING IN WORDS -- Match Centre's own count (players marked as Attending), and unknown is
 * never written as a number: a side Ovalball cannot count is named, not added as zero. "Catering · 14
 * attending so far · away attendance not available". Numbers only where the viewer may see them.
 */
export function fixtureCateringLine(f: ArenaFixture): string | null {
  const c = f.catering
  if (!c || !f.home) return null
  if (!c.required) return "Catering not required"
  if (!c.visible || c.total === undefined) return "Catering required"
  const missing = c.sidesNotCounted ?? []
  if (missing.length === 0) return `Catering · ${c.total} attending`
  const who = missing.length === 2 ? "attendance not available" : `${missing[0] === "away" ? "away" : "home"} attendance not available`
  return `Catering · ${c.total} attending so far · ${who}`
}

/** An event's catering: the people confirmed, or that nobody has confirmed yet -- never a bare "0 expected". */
export function eventCateringLine(e: ArenaEvent): string | null {
  const c = e.catering
  if (!c.required) return null
  if (!c.visible) return "Catering required"
  const total = c.counts?.total ?? c.expected ?? null
  if (total === null) return "Catering required"
  return total === 0 ? "Catering · nobody confirmed yet" : `Catering · ${total} expected`
}

/** Dietary counts as a short list: "8 vegetarian · 3 vegan · 4 other requirements". No names, ever. */
export function dietaryLine(e: ArenaEvent): string | null {
  const d = e.catering.counts?.dietary
  if (!d) return null
  const parts = Object.entries(d)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${n} ${k.replace(/_/g, " ").toLowerCase()}`)
  const notes = e.catering.counts?.otherNotes ?? 0
  if (notes > 0) parts.push(`${notes} with a note`)
  return parts.length > 0 ? parts.join(" · ") : null
}

export interface CateringRow {
  id: string
  label: string
  /** "12 home · 14 away", or "22 home · Away attendance not available", or "60 expected". */
  detail: string
  known: number | null
  incomplete: boolean
  dietary: string | null
}

/** CATERING TODAY: every fixture and event that needs it, with what is known, and the total known. */
export function cateringRows(day: Pick<ArenaDay, "activities">): { rows: CateringRow[]; totalKnown: number; incomplete: number } {
  const rows: CateringRow[] = []
  for (const a of sortActivities(day.activities)) {
    if (a.kind === "FIXTURE" && a.home && a.catering?.required) {
      const c = a.catering
      if (!c.visible || c.total === undefined) {
        rows.push({ id: a.id, label: activityLabel(a), detail: "Numbers are with the team's staff", known: null, incomplete: false, dietary: null })
        continue
      }
      const missing = new Set(c.sidesNotCounted ?? [])
      const part = (side: "home" | "away") =>
        missing.has(side) ? `${side === "home" ? "Home" : "Away"} attendance not available` : `${c.parts?.find((p) => p.side === side)?.attending ?? 0} ${side}`
      rows.push({ id: a.id, label: activityLabel(a), detail: `${part("home")} · ${part("away")}`, known: c.total, incomplete: missing.size > 0, dietary: null })
    }
    if (a.kind === "EVENT" && a.catering.required) {
      const total = a.catering.visible ? (a.catering.counts?.total ?? a.catering.expected ?? null) : null
      rows.push({
        id: a.id,
        label: a.title,
        detail: total === null ? "Numbers are with the event's organisers" : total === 0 ? "Nobody has confirmed yet" : `${total} expected`,
        known: total,
        incomplete: false,
        dietary: a.catering.visible ? dietaryLine(a) : null,
      })
    }
  }
  return {
    rows,
    totalKnown: rows.reduce((sum, r) => sum + (r.known ?? 0), 0),
    incomplete: rows.filter((r) => r.incomplete).length,
  }
}

// ------------------------------------------------------------------ the timeline

export type SegmentPhase = "WARM_UP" | "PLAY" | "CLEAR" | "RESERVED" | "IN_USE" | "TURNAROUND"

export interface TimelineBlock {
  activityId: string
  activityType: ArenaOccupancy["activityType"]
  label: string
  role: ArenaOccupancy["role"]
  from: number
  until: number
  /** The parts of the block: warm-up, play and clearing the pitch; or a room in use and turning round. */
  segments: { phase: SegmentPhase; from: number; until: number }[]
  locked: boolean
  conflict: boolean
}

export interface TimelineRow {
  resourceId: string
  name: string
  subtitle: string
  /** The ground it is at, so a view of every venue can say which pitch or room is where. */
  venueId: string
  venueName: string
  blocks: TimelineBlock[]
}

/** The home ground first, then the others by name: the order every venue-grouped view uses. */
function venueOrder(day: Pick<ArenaDay, "venues">): (venueId: string) => number {
  const ordered = [...day.venues].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  return (venueId) => {
    const i = ordered.findIndex((v) => v.id === venueId)
    return i === -1 ? ordered.length : i
  }
}

const venueNameOf = (day: Pick<ArenaDay, "venues">, venueId: string) => day.venues.find((v) => v.id === venueId)?.name ?? "Another venue"

/** A venue-grouped list of rows: the ground's name above its first row whenever the ground changes. */
export function timelineGroups(rows: TimelineRow[]): { venueId: string; venueName: string; rows: TimelineRow[] }[] {
  const groups: { venueId: string; venueName: string; rows: TimelineRow[] }[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.venueId === r.venueId) last.rows.push(r)
    else groups.push({ venueId: r.venueId, venueName: r.venueName, rows: [r] })
  }
  return groups
}

function blockFor(o: ArenaOccupancy, conflicts: Set<string>, label: string): TimelineBlock {
  const from = toMinutes(o.from) ?? 0
  const playFrom = toMinutes(o.playFrom) ?? from
  const playUntil = toMinutes(o.playUntil) ?? playFrom
  const until = toMinutes(o.until) ?? playUntil
  const turn = toMinutes(o.turnaroundUntil) ?? until
  const segments: TimelineBlock["segments"] = []
  if (o.resourceType === "ROOM") {
    segments.push({ phase: "IN_USE", from, until })
    if (turn > until) segments.push({ phase: "TURNAROUND", from: until, until: turn })
  } else if (o.activityType === "FIXTURE") {
    if (playFrom > from) segments.push({ phase: "WARM_UP", from, until: playFrom })
    segments.push({ phase: "PLAY", from: playFrom, until: playUntil })
    if (until > playUntil) segments.push({ phase: "CLEAR", from: playUntil, until })
  } else if (o.activityType === "TOURNAMENT" || o.activityType === "EVENT") {
    segments.push({ phase: "RESERVED", from, until })
  } else {
    segments.push({ phase: "PLAY", from: playFrom, until: playUntil })
  }
  return {
    activityId: o.activityId,
    activityType: o.activityType,
    label,
    role: o.role,
    from,
    until: o.resourceType === "ROOM" ? Math.max(until, turn) : until,
    segments,
    locked: o.locked,
    conflict: conflicts.has(o.activityId),
  }
}

function labelFor(day: Pick<ArenaDay, "activities">, o: ArenaOccupancy): string {
  const a = day.activities.find((x) => x.id === (o.activityType === "TOURNAMENT" || o.activityType === "TOURNAMENT_GAME" ? o.parentId : o.activityId))
  if (!a) return o.label
  const base = activityLabel(a)
  const side = o.role === "HOME" ? "Home" : o.role === "AWAY" ? "Away" : o.role === "OFFICIALS" ? "Officials" : null
  return side ? `${base} · ${side}` : base
}

/**
 * THE PITCH ROWS of the timeline: one per active pitch at the chosen ground, each block a claim on it
 * with its warm-up / play / clearing parts. A tournament shows its reservation as one block (its games
 * live in its own plan); training and events show as themselves.
 */
export function pitchRows(day: ArenaDay, venueId: string | null): TimelineRow[] {
  const clashing = new Set(day.conflicts.filter((c) => c.severity === "hard" && c.resourceType === "PITCH").flatMap((c) => c.activityIds))
  const order = venueOrder(day)
  return day.pitches
    .filter((p) => p.active && (!venueId || p.venueId === venueId))
    .sort((a, b) => order(a.venueId) - order(b.venueId) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((p) => ({
      resourceId: p.id,
      name: p.name,
      subtitle: pitchSubtitle(p, day),
      venueId: p.venueId,
      venueName: venueNameOf(day, p.venueId),
      blocks: day.occupancy
        .filter((o) => o.resourceType === "PITCH" && o.resourceId === p.id && o.activityType !== "TOURNAMENT_GAME")
        .map((o) => blockFor(o, clashing, labelFor(day, o)))
        .sort((a, b) => a.from - b.from),
    }))
}

function pitchSubtitle(p: ArenaDay["pitches"][number], day: ArenaDay): string {
  const size = p.size === "full" ? "Full size" : p.size === "three_quarter" ? "3/4 size" : p.size === "half" ? "Half size" : "Custom size"
  const reservation = day.occupancy.find((o) => o.resourceType === "PITCH" && o.resourceId === p.id && o.activityType === "TOURNAMENT" && (o.areas ?? 1) > 1)
  if (reservation) return `${size} · ${reservation.areas} at once (tournament)`
  return p.lanes > 1 ? `${size} · ${p.lanes} at once` : size
}

/** THE ROOM ROWS: one per active changing room at the chosen ground, each use with its turnaround. */
export function roomRows(day: ArenaDay, venueId: string | null): TimelineRow[] {
  const clashing = new Set(day.conflicts.filter((c) => c.resourceType === "ROOM").flatMap((c) => c.activityIds))
  const order = venueOrder(day)
  return day.rooms
    .filter((r) => r.active && (!venueId || r.venueId === venueId))
    .sort((a, b) => order(a.venueId) - order(b.venueId) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => ({
      resourceId: r.id,
      name: r.name,
      subtitle: r.roomType === "match_officials" ? "Officials" : r.roomType === "smaller" ? "Smaller room" : "Changing room",
      venueId: r.venueId,
      venueName: venueNameOf(day, r.venueId),
      blocks: day.occupancy
        .filter((o) => o.resourceType === "ROOM" && o.resourceId === r.id)
        .map((o) => blockFor(o, clashing, labelFor(day, o)))
        .sort((a, b) => a.from - b.from),
    }))
}

export type ResourceState = "FREE" | "IN_USE" | "TURNAROUND" | "UNAVAILABLE"

/** How a resource stands at a moment: free, in use, turning round, or unavailable (switched off). */
export function resourceStateAt(row: TimelineRow, minute: number, active = true): ResourceState {
  if (!active) return "UNAVAILABLE"
  for (const b of row.blocks) {
    for (const s of b.segments) {
      if (s.from <= minute && minute < s.until) return s.phase === "TURNAROUND" || s.phase === "CLEAR" ? "TURNAROUND" : "IN_USE"
    }
  }
  return "FREE"
}

/** The hours a day's timeline should show: from the earliest claim (or 08:00) to the latest (or 18:00). */
export function timelineHours(rows: TimelineRow[]): { from: number; until: number } {
  let from = 8 * 60
  let until = 18 * 60
  for (const r of rows) for (const b of r.blocks) {
    from = Math.min(from, Math.floor(b.from / 60) * 60)
    until = Math.max(until, Math.ceil(b.until / 60) * 60)
  }
  return { from: Math.max(0, from), until: Math.min(1440, until) }
}

// ------------------------------------------------------------------ accessibility

/**
 * WHAT VOICEOVER SAYS for an activity: "U9 versus Bolton RFC, home fixture, Pitch 1, occupancy ten
 * thirty AM to twelve forty PM." Kind, place and time in words, never colour.
 */
export function accessibilityLabel(day: Pick<ArenaDay, "pitches" | "rooms" | "conflicts">, a: ArenaActivity): string {
  const parts: string[] = []
  // Spoken, a team is its display name ("Under 13 Boys"): the compact "U13" is for the eye on a dense row.
  const spokenTeam = (team: ArenaTeam | null) => team?.displayName || teamShort(team)
  if (a.kind === "FIXTURE") {
    parts.push(`${spokenTeam(a.team)} versus ${a.opponentName}`)
    parts.push(a.home ? "home fixture" : "away fixture")
    if (a.home) {
      const pitch = day.pitches.find((p) => p.id === a.pitchId)?.name
      parts.push(pitch ?? "pitch not allocated")
      if (a.pitchWindow) parts.push(`occupancy ${spokenTime(a.pitchWindow.from)} to ${spokenTime(a.pitchWindow.until)}`)
      else parts.push(`kick-off ${spokenTime(a.kickoff)}`)
    } else {
      parts.push(`kick-off ${spokenTime(a.kickoff)}`)
    }
  } else if (a.kind === "TRAINING") {
    parts.push(`${a.team ? spokenTeam(a.team) : a.groupLabel ?? "Team"} training`)
    parts.push(day.pitches.find((p) => p.id === a.pitchId)?.name ?? "pitch not allocated")
    parts.push(`${spokenTime(a.start)} to ${spokenTime(a.end)}`)
  } else if (a.kind === "TOURNAMENT") {
    parts.push(`${a.title}, tournament`)
    parts.push(`${a.reservations.length} ${a.reservations.length === 1 ? "pitch" : "pitches"} reserved`)
    parts.push(`${spokenTime(a.start)} to ${spokenTime(a.end)}`)
  } else {
    parts.push(`${a.title}, event`)
    parts.push(a.allDay ? "all day" : `${spokenTime(a.start)}${a.end ? ` to ${spokenTime(a.end)}` : ""}`)
  }
  const clashes = day.conflicts.filter((c) => c.severity === "hard" && c.activityIds.includes(a.id)).length
  if (clashes > 0) parts.push(clashes === 1 ? "one clash" : `${clashes} clashes`)
  if ((a.kind === "FIXTURE" && a.home && a.needs.length > 0) || (a.kind === "TRAINING" && a.needs.length > 0)) parts.push("needs allocation")
  return `${parts.join(", ")}.`
}

// ------------------------------------------------------------------ the week and the hub

/** PLAN YOUR WEEK, one day in lines: "5 home fixtures", "1 unallocated", "Tournament · 4 pitches reserved". */
export function weekDayLines(d: ArenaRangeDay): string[] {
  const lines: string[] = []
  if (d.homeGames > 0) lines.push(`${d.homeGames} home ${d.homeGames === 1 ? "fixture" : "fixtures"}`)
  if (d.tournaments > 0) lines.push(d.pitchesReserved > 0 ? `${d.tournaments === 1 ? "Tournament" : `${d.tournaments} tournaments`} · ${d.pitchesReserved} ${d.pitchesReserved === 1 ? "pitch" : "pitches"} reserved` : d.tournaments === 1 ? "Tournament" : `${d.tournaments} tournaments`)
  if (d.training > 0) lines.push(`${d.training} training ${d.training === 1 ? "session" : "sessions"}`)
  if (d.events > 0) lines.push(`${d.events} ${d.events === 1 ? "event" : "events"}`)
  if (d.awayGames > 0) lines.push(`${d.awayGames} away`)
  if (d.needsAllocation > 0) lines.push(`${d.needsAllocation} unallocated`)
  if (d.conflicts > 0) lines.push(`${d.conflicts} ${d.conflicts === 1 ? "clash" : "clashes"}`)
  return lines
}

/**
 * A DAY OF THE WEEK STRIP, in the fewest useful words: its one activity by name and time ("U12 Training",
 * "18:00"), or what it holds ("4 Home", "Tournament", "6 Pitches") -- and, separately, what needs doing
 * ("1 Unallocated", "2 Clashes"). Quiet days say so.
 */
export function weekDayCard(d: ArenaRangeDay): { lines: string[]; attention: string[] } {
  const attention: string[] = []
  if (d.needsAllocation > 0) attention.push(`${d.needsAllocation} Unallocated`)
  if (d.conflicts > 0) attention.push(`${d.conflicts} ${d.conflicts === 1 ? "Clash" : "Clashes"}`)
  if (weekDayIsQuiet(d)) return { lines: ["Nothing booked"], attention }
  const one = d.single
  if (one) {
    switch (one.kind) {
      case "FIXTURE":
        return { lines: [`${teamShort(one.team)} ${one.home ? "v" : "at"} ${one.title ? opponentShort(one.title) : "TBC"}`, one.time ?? "Time TBC"], attention }
      case "TRAINING":
        return { lines: [`${one.team ? teamShort(one.team) : one.title ?? "Team"} Training`, one.time ?? "Time TBC"], attention }
      case "TOURNAMENT":
        return { lines: [one.title, one.pitches > 0 ? `${one.pitches} ${one.pitches === 1 ? "Pitch" : "Pitches"}` : one.time ?? "All day"], attention }
      case "EVENT":
        return { lines: [one.title, one.time ?? "All day"], attention }
    }
  }
  const lines: string[] = []
  if (d.homeGames > 0) lines.push(`${d.homeGames} Home`)
  if (d.tournaments > 0) lines.push(d.tournaments === 1 ? "Tournament" : `${d.tournaments} Tournaments`)
  if (d.pitchesReserved > 0) lines.push(`${d.pitchesReserved} ${d.pitchesReserved === 1 ? "Pitch" : "Pitches"}`)
  if (d.training > 0) lines.push(`${d.training} Training`)
  if (d.events > 0) lines.push(d.events === 1 ? "Event" : `${d.events} Events`)
  if (d.awayGames > 0) lines.push(`${d.awayGames} Away`)
  return { lines, attention }
}

/** "Sunday 11 October", from a club date -- never the device's idea of the day. */
export function longDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "Sunday". */
export function dayName(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** Whether an activity is AT THE CLUB -- a home fixture, a session, a tournament or an event; an away fixture is not. */
export function usesEstate(a: ArenaActivity): boolean {
  return a.kind !== "FIXTURE" || a.home
}

/**
 * WHAT ARENA HOME LEADS WITH: today when anything is on, otherwise the next day something is -- never "nothing
 * is using your facilities today" while Saturday needs planning.
 */
export function arenaFocus(hub: Pick<ArenaHub, "today" | "todayAtTheClub" | "next">): { date: string; isToday: boolean; day: ArenaHub["todayAtTheClub"] } | null {
  if (hub.todayAtTheClub.activities.some(usesEstate)) return { date: hub.today, isToday: true, day: hub.todayAtTheClub }
  if (hub.next) return { date: hub.next.date, isToday: false, day: hub.next }
  return null
}

/**
 * THE DAY'S OPERATIONAL STATE, as facts a Club Admin acts on: what still needs allocating, which changing
 * rooms are outstanding, what clashes, what needs catering -- or, when nothing does, that the day is planned.
 */
export function operationalState(day: Pick<ArenaDay, "activities" | "readiness">): { ready: boolean; facts: string[]; summary: string } {
  const r = day.readiness
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const needing = day.activities.filter((a) => (a.kind === "FIXTURE" && a.home && a.needs.some((x) => x !== "ROOMS")) || (a.kind === "TRAINING" && a.needs.some((x) => x !== "ROOMS")))
  const roomsOutstanding = day.activities.reduce((sum, a) =>
    a.kind === "FIXTURE" && a.home && a.needs.includes("ROOMS") ? sum + (a.homeRoomId ? 0 : 1) + (a.awayRoomId ? 0 : 1)
      : a.kind === "TRAINING" && a.needs.includes("ROOMS") ? sum + 1
        : sum, 0)
  const clashes = r.pitchConflicts + r.roomConflicts + r.tournamentConflicts
  const catering = day.activities.filter((a) => (a.kind === "FIXTURE" && a.home && a.catering?.required) || (a.kind === "EVENT" && a.catering.required)).length
  const facts: string[] = []
  if (needing.length > 0) facts.push(n(needing.length, "activity needs allocating", "activities need allocating"))
  if (roomsOutstanding > 0) facts.push(n(roomsOutstanding, "changing room outstanding", "changing rooms outstanding"))
  if (clashes > 0) facts.push(n(clashes, "clash to resolve", "clashes to resolve"))
  if (catering > 0) facts.push(n(catering, "catering requirement", "catering requirements"))
  const ready = needing.length === 0 && roomsOutstanding === 0 && clashes === 0
  const counts = [
    r.homeGames > 0 ? n(r.homeGames, "home fixture", "home fixtures") : null,
    r.tournaments > 0 ? n(r.tournaments, "tournament", "tournaments") : null,
    r.training > 0 ? n(r.training, "training session", "training sessions") : null,
    r.events > 0 ? n(r.events, "event", "events") : null,
    r.awayGames > 0 ? `${r.awayGames} away` : null,
  ].filter((x): x is string => !!x)
  return { ready, facts, summary: counts.join(" · ") }
}

export function weekDayIsQuiet(d: ArenaRangeDay): boolean {
  return d.homeGames + d.awayGames + d.training + d.tournaments + d.events === 0
}

export function weekDayNeedsAttention(d: ArenaRangeDay): boolean {
  return d.needsAllocation > 0 || d.conflicts > 0
}

/**
 * WHAT NEEDS SOMEBODY IN THE DAYS GIVEN -- the strip's own per-day rule (`weekDayNeedsAttention`: something to
 * allocate, or a clash, as the server counts them) added up rather than redefined: how many, of which kind,
 * and the first day it happens. Arena Home's fourth count says this whenever it is not nothing.
 */
export function weekAttention(days: readonly ArenaRangeDay[]): { count: number; needsAllocation: number; conflicts: number; firstDate: string | null } {
  const flagged = days.filter(weekDayNeedsAttention)
  const needsAllocation = flagged.reduce((n, d) => n + d.needsAllocation, 0)
  const conflicts = flagged.reduce((n, d) => n + d.conflicts, 0)
  return { count: needsAllocation + conflicts, needsAllocation, conflicts, firstDate: flagged[0]?.date ?? null }
}

// ------------------------------------------------------------------ automatic allocation

/** "8 first preferences · 3 alternatives · 1 unresolved" and "6 pitch changes · 4 room changes · 2 unchanged". */
export function previewSummaryLines(p: AllocationPreview): { outcomes: string; changes: string } {
  const s = p.summary
  const outcomes = [
    s.firstPreferences > 0 ? `${s.firstPreferences} first ${s.firstPreferences === 1 ? "preference" : "preferences"}` : null,
    s.alternatives > 0 ? `${s.alternatives} ${s.alternatives === 1 ? "alternative" : "alternatives"}` : null,
    s.noPreference > 0 ? `${s.noPreference} with no preference set` : null,
    s.unresolved > 0 ? `${s.unresolved} unresolved` : null,
  ].filter(Boolean).join(" · ")
  const changes = [
    `${s.pitchChanges} pitch ${s.pitchChanges === 1 ? "change" : "changes"}`,
    s.kickoffProposals > 0 ? `${s.kickoffProposals} kick-off ${s.kickoffProposals === 1 ? "time" : "times"} proposed` : null,
    `${s.roomChanges} room ${s.roomChanges === 1 ? "change" : "changes"}`,
    s.venueChanges > 0 ? `${s.venueChanges} ground ${s.venueChanges === 1 ? "change" : "changes"}` : null,
    s.unchanged > 0 ? `${s.unchanged} unchanged` : null,
  ].filter(Boolean).join(" · ")
  return { outcomes: outcomes || "Nothing to allocate", changes }
}

export function previewChanges(p: AllocationPreview, only?: (item: PreviewItem) => boolean): ArenaChange[] {
  return p.items
    .filter((i) => i.changes.length > 0 && (!only || only(i)))
    .map((i) => ({ kind: i.kind, id: i.id, expected: i.current, set: i.proposed }))
}

/** A person's own change to one activity: what it expects to find, and what to set. */
export function manualChange(
  a: ArenaFixture | ArenaTraining,
  set: ArenaChange["set"]
): ArenaChange {
  const expected =
    a.kind === "FIXTURE"
      ? { venueId: a.venueId, pitchId: a.pitchId, homeRoomId: a.homeRoomId, awayRoomId: a.awayRoomId, officialsRoomId: a.officialsRoomId }
      : { pitchId: a.pitchId }
  return { kind: a.kind, id: a.id, expected, set }
}
