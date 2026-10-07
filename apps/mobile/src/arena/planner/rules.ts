import { activityLabel, clock, toMinutes, type ArenaDay, type ArenaFixture, type ArenaNeed, type ArenaPitch, type ArenaRoom, type ArenaTraining } from "@ovalball/contracts/arena"

import { plannedParts, type Allocatable, type Plan } from "./plan"

/**
 * THE SERVER'S RULES, READ ON THE PHONE -- so a drag can say "Pitch 1 is reserved for Bolton Festival" before
 * the finger lets go, and the Allocate sheet can recommend rooms that are free.
 *
 * This is a PREVIEW, never the authority. It mirrors `internal.arena_occupancy` (how long each activity holds
 * each pitch and room) and `internal.arena_conflicts` (what counts as a clash) over the day Arena already read,
 * with the plan laid over it; the server checks the whole plan again on Save and refuses it, in its own words,
 * if anything is wrong. Where the two could ever disagree, the server wins and the change stays staged.
 *
 * The rules, as the server has them: a tournament's reservation and an event's explicit reservation hold their
 * pitch against everything else; a fixture holds its pitch against training from warm-up to clearing the
 * pitch; fixtures share a pitch only up to its layout (games at once) and its size (quarter-pitch units); a
 * grade too big for a pitch is refused; training never clashes with training (any number of groups may share a
 * pitch -- the owner's rule); a changing room takes one use at a time and the time to turn it round, a training
 * group included (one team per room), and a session holds its room for the session itself.
 */

export interface Occupancy {
  activityType: "FIXTURE" | "TRAINING" | "TOURNAMENT" | "TOURNAMENT_GAME" | "EVENT"
  activityId: string
  parentId: string | null
  label: string
  resourceType: "PITCH" | "ROOM"
  resourceId: string
  role: "HOME" | "AWAY" | "OFFICIALS" | "TRAINING" | null
  from: number
  playFrom: number
  playUntil: number
  until: number
  turnaroundUntil: number
  footprint: "quarter" | "half" | "full" | null
  areas: number | null
  locked: boolean
}

export interface Clash {
  code: "PITCH_INACTIVE" | "PITCH_RESERVED" | "PITCH_EVENT" | "PITCH_IN_USE" | "PITCH_FULL" | "PITCH_TOO_SMALL" | "ROOM_IN_USE" | "ROOM_TURNAROUND" | "ROOM_INACTIVE"
    /** The phone's own two, said before a drop: a room at another venue, or the officials' room for a team. */
    | "ROOM_ELSEWHERE" | "ROOM_UNSUITED"
  severity: "hard" | "warning"
  /** One human sentence. Never the engine's code. */
  message: string
  /**
   * The same, short enough to sit beside a finger mid-drag or under a choice in a list: what is unavailable
   * ("Pitch 1 unavailable") and the one reason that matters ("In use until 14:15").
   */
  short: { title: string; reason: string }
}

type Policy = ArenaDay["policy"]
const DAY_END = 1440
const cap = (m: number) => Math.min(m, DAY_END)
const window = (from: number, until: number) => `${clock(from)}–${clock(until)}`

/** A fixture's hold on its pitch: warm-up, the match, clearing the pitch (and the gap automatic allocation keeps). */
export function fixturePitchWindow(kickoff: number, playMinutes: number, policy: Pick<Policy, "warmUp" | "packUp" | "turnaround">) {
  const playUntil = kickoff + playMinutes
  return { from: Math.max(kickoff - policy.warmUp, 0), playFrom: kickoff, playUntil, until: cap(playUntil + policy.packUp), turnaroundUntil: cap(playUntil + policy.packUp + policy.turnaround) }
}

/** A fixture's hold on one changing room: the home side from its meet time when that is earlier than access. */
export function fixtureRoomWindow(kickoff: number, playMinutes: number, meet: number | null, side: "HOME" | "AWAY" | "OFFICIALS", policy: Pick<Policy, "roomAccess" | "roomRelease" | "roomTurnaround">) {
  const access = kickoff - policy.roomAccess
  const from = Math.max(side === "HOME" && meet !== null ? Math.min(meet, access) : access, 0)
  const playUntil = kickoff + playMinutes
  return { from, playFrom: kickoff, playUntil, until: cap(playUntil + policy.roomRelease), turnaroundUntil: cap(playUntil + policy.roomRelease + policy.roomTurnaround) }
}

/** How long a session runs, in minutes: its own end, else an hour. */
export function trainingMinutes(t: Pick<ArenaTraining, "start" | "end">): number {
  const from = toMinutes(t.start)
  const end = toMinutes(t.end)
  return from !== null && end !== null && end > from ? end - from : 60
}

/** A training session holds its pitch for the session itself -- at its own start, or at `start` when a plan moves it. */
export function trainingWindow(t: Pick<ArenaTraining, "start" | "end">, start: number | null = null) {
  const from = start ?? toMinutes(t.start)
  if (from === null) return null
  const until = cap(from + trainingMinutes(t))
  return { from, playFrom: from, playUntil: until, until, turnaroundUntil: until }
}

/** ...and its changing room for the session itself, then the club's room turnaround (`internal.arena_occupancy`). */
export function trainingRoomWindow(t: Pick<ArenaTraining, "start" | "end">, start: number | null, policy: Pick<Policy, "roomTurnaround">) {
  const w = trainingWindow(t, start)
  return w ? { ...w, turnaroundUntil: cap(w.until + policy.roomTurnaround) } : null
}

/** The day's occupancy as the server sent it, in minutes. */
export function readOccupancy(day: Pick<ArenaDay, "occupancy">): Occupancy[] {
  return day.occupancy.map((o) => ({
    activityType: o.activityType,
    activityId: o.activityId,
    parentId: o.parentId,
    label: o.label,
    resourceType: o.resourceType,
    resourceId: o.resourceId,
    role: o.role,
    from: toMinutes(o.from) ?? 0,
    playFrom: toMinutes(o.playFrom) ?? 0,
    playUntil: toMinutes(o.playUntil) ?? 0,
    until: toMinutes(o.until) ?? 0,
    turnaroundUntil: toMinutes(o.turnaroundUntil) ?? 0,
    footprint: o.footprint,
    areas: o.areas,
    locked: o.locked,
  }))
}

/** Where one activity WOULD be, on the pitch and in the rooms its planned parts give it. */
export function occupancyFor(a: Allocatable, parts: { pitchId: string | null; kickoff: string | null; homeRoomId: string | null; awayRoomId: string | null; officialsRoomId: string | null }, policy: Policy): Occupancy[] {
  const base = { activityId: a.id, parentId: null, label: activityLabel(a), locked: false, areas: null }
  if (a.kind === "TRAINING") {
    const start = toMinutes(parts.kickoff)
    const w = trainingWindow(a, start)
    const room = trainingRoomWindow(a, start, policy)
    const rows: Occupancy[] = []
    if (w && parts.pitchId) rows.push({ ...base, activityType: "TRAINING", resourceType: "PITCH", resourceId: parts.pitchId, role: null, footprint: null, ...w })
    if (room && parts.homeRoomId) rows.push({ ...base, activityType: "TRAINING", resourceType: "ROOM", resourceId: parts.homeRoomId, role: "TRAINING", footprint: null, ...room })
    return rows
  }
  const ko = toMinutes(parts.kickoff)
  if (!a.home || ko === null) return []
  const rows: Occupancy[] = []
  if (parts.pitchId) rows.push({ ...base, activityType: "FIXTURE", resourceType: "PITCH", resourceId: parts.pitchId, role: null, footprint: a.fit.footprint, ...fixturePitchWindow(ko, a.playMinutes, policy) })
  const meet = toMinutes(a.meetTime)
  for (const [role, id] of [["HOME", parts.homeRoomId], ["AWAY", parts.awayRoomId], ["OFFICIALS", parts.officialsRoomId]] as const) {
    if (id) rows.push({ ...base, activityType: "FIXTURE", resourceType: "ROOM", resourceId: id, role, footprint: null, ...fixtureRoomWindow(ko, a.playMinutes, meet, role, policy) })
  }
  return rows
}

/** The day's occupancy with the plan laid over it: every staged activity moved to where the plan puts it. */
export function draftOccupancy(day: ArenaDay, plan: Plan): Occupancy[] {
  const rows = readOccupancy(day)
  if (plan.size === 0) return rows
  const moved = new Set<string>()
  const added: Occupancy[] = []
  for (const change of plan.values()) {
    const a = day.activities.find((x) => x.id === change.id && x.kind === change.kind) as Allocatable | undefined
    if (!a) continue
    moved.add(a.id)
    added.push(...occupancyFor(a, plannedParts(plan, a), day.policy))
  }
  return [...rows.filter((r) => !moved.has(r.activityId) || r.activityType === "TOURNAMENT" || r.activityType === "TOURNAMENT_GAME" || r.activityType === "EVENT"), ...added]
}

/** How much of a full-size pitch a pitch is, in quarter-pitch units -- the server's own count. */
export function pitchUnits(p: Pick<ArenaPitch, "size" | "customLengthM" | "customWidthM">): number {
  if (p.size === "full") return 4
  if (p.size === "three_quarter") return 3
  if (p.size === "half") return 2
  const area = p.customLengthM && p.customWidthM ? p.customLengthM * p.customWidthM : 7000
  return Math.max(1, Math.min(4, Math.round((area / 7000) * 4)))
}

export const footprintUnits = (f: Occupancy["footprint"]): number => (f === "quarter" ? 1 : f === "half" ? 2 : 4)

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const say = (n: number) => NUMBER_WORDS[n] ?? String(n)
const overlaps = (a: { from: number; until: number }, b: { from: number; until: number }) => a.from < b.until && b.from < a.until

/**
 * WHAT PUTTING THIS ACTIVITY ON THIS PITCH (AT THIS KICK-OFF) WOULD CLASH WITH, over the draft. The first
 * hard clash, in one sentence -- or null when the pitch is free for it.
 */
export function pitchClash(day: ArenaDay, draft: Occupancy[], a: Allocatable, pitchId: string, kickoff: number | null): Clash | null {
  const pitch = day.pitches.find((p) => p.id === pitchId)
  if (!pitch) return null
  const name = pitch.name
  if (!pitch.active) return { code: "PITCH_INACTIVE", severity: "hard", message: `${name} is switched off.`, short: { title: `${name} unavailable`, reason: "Switched off" } }
  const own = a.kind === "TRAINING"
    ? trainingWindow(a, kickoff)
    : kickoff === null ? null : fixturePitchWindow(kickoff, (a as ArenaFixture).playMinutes, day.policy)
  if (!own) return null
  const others = draft.filter((o) => o.resourceType === "PITCH" && o.resourceId === pitchId && o.activityId !== a.id)

  // A pitch too small for the grade is never right, whatever else is on it -- said first.
  if (a.kind === "FIXTURE" && a.fit.footprint !== null && footprintUnits(a.fit.footprint) > pitchUnits(pitch)) {
    const needs = a.fit.footprint === "full" ? "a full-size pitch" : a.fit.footprint === "half" ? "at least half a full-size pitch" : "a quarter of a full-size pitch"
    return { code: "PITCH_TOO_SMALL", severity: "hard", message: `${name} is too small for ${activityLabel(a)}: it needs ${needs}.`, short: { title: `${name} too small`, reason: `Needs ${needs}` } }
  }
  for (const t of others) {
    if (t.activityType === "TOURNAMENT" && overlaps(own, t)) return { code: "PITCH_RESERVED", severity: "hard", message: `${name} is reserved for ${t.label} ${window(t.from, t.until)}.`, short: { title: `${name} reserved`, reason: `${t.label} until ${clock(t.until)}` } }
  }
  for (const e of others) {
    if (e.activityType === "EVENT" && overlaps(own, e)) return { code: "PITCH_EVENT", severity: "hard", message: `${name} is reserved for ${e.label} ${window(e.from, e.until)}.`, short: { title: `${name} reserved`, reason: `${e.label} until ${clock(e.until)}` } }
  }
  if (a.kind === "TRAINING") {
    const f = others.find((o) => o.activityType === "FIXTURE" && overlaps(own, o))
    return f ? { code: "PITCH_IN_USE", severity: "hard", message: `${name} is in use by ${f.label} ${window(f.from, f.until)}, warm-up to clearing the pitch.`, short: { title: `${name} unavailable`, reason: `In use until ${clock(f.until)}` } } : null
  }

  const fixture = a as ArenaFixture
  const units = footprintUnits(fixture.fit.footprint)
  const capacity = pitchUnits(pitch)
  const training = others.find((o) => o.activityType === "TRAINING" && overlaps(own, o))
  if (training) {
    const message = training.until <= own.playFrom
      ? `${activityLabel(fixture)}'s warm-up needs ${name} from ${clock(own.from)}, and ${training.label} is on it until ${clock(training.until)}.`
      : training.from >= own.playUntil
        ? `${activityLabel(fixture)} needs ${name} until ${clock(own.until)} to clear the pitch, and ${training.label} starts at ${clock(training.from)}.`
        : `${name} has ${training.label} ${window(training.from, training.until)}.`
    return { code: "PITCH_IN_USE", severity: "hard", message, short: { title: `${name} unavailable`, reason: `${training.label} until ${clock(training.until)}` } }
  }
  // FIXTURES SHARING THE PITCH: at every moment one of them starts inside this one's hold, how many are on it
  // and how much of it they need -- against the layout (games at once) and the size.
  const fixtures = others.filter((o) => o.activityType === "FIXTURE")
  const lanes = Math.max(1, pitch.lanes)
  const moments = [own.from, ...fixtures.map((f) => f.from).filter((m) => m >= own.from && m < own.until)]
  for (const at of moments) {
    const there = fixtures.filter((f) => f.from <= at && at < f.until)
    if (there.length === 0) continue
    const n = there.length + 1
    const used = there.reduce((sum, f) => sum + footprintUnits(f.footprint), units)
    const busyUntil = clock(Math.max(...there.map((f) => f.until)))
    if (lanes <= 1) return { code: "PITCH_FULL", severity: "hard", message: `${name} is already in use at ${clock(at)}.`, short: { title: `${name} unavailable`, reason: `In use until ${busyUntil}` } }
    if (n > lanes) return { code: "PITCH_FULL", severity: "hard", message: `${name} takes ${say(lanes)} games at once, and this would make ${say(n)} at ${clock(at)}.`, short: { title: `${name} full`, reason: `${say(lanes).replace(/^./, (c) => c.toUpperCase())} games already on until ${busyUntil}` } }
    if (used > capacity) return { code: "PITCH_FULL", severity: "hard", message: `${name} has no space for another game at ${clock(at)}: together they need more of the pitch than it has.`, short: { title: `${name} full`, reason: `No space for another game until ${busyUntil}` } }
  }
  return null
}

/** Whether a changing room is free for a use, over the draft -- in use, or not yet turned round. */
export function roomClash(day: ArenaDay, draft: Occupancy[], activityId: string, roomId: string, use: { from: number; until: number; turnaroundUntil: number }): Clash | null {
  const room = day.rooms.find((r) => r.id === roomId)
  if (!room) return null
  if (!room.active) return { code: "ROOM_INACTIVE", severity: "hard", message: `${room.name} is switched off.`, short: { title: `${room.name} unavailable`, reason: "Switched off" } }
  for (const o of draft) {
    if (o.resourceType !== "ROOM" || o.resourceId !== roomId || o.activityId === activityId) continue
    if (use.from < o.turnaroundUntil && o.from < use.turnaroundUntil) {
      return overlaps(use, o)
        ? { code: "ROOM_IN_USE", severity: "hard", message: `${room.name} is in use by ${o.label} ${window(o.from, o.until)}.`, short: { title: `${room.name} unavailable`, reason: `In use until ${clock(o.until)}` } }
        : { code: "ROOM_TURNAROUND", severity: "hard", message: `${room.name} is being turned round after ${o.label} until ${clock(o.from >= use.from ? use.turnaroundUntil : o.turnaroundUntil)}.`, short: { title: `${room.name} unavailable`, reason: `Being turned round until ${clock(o.from >= use.from ? use.turnaroundUntil : o.turnaroundUntil)}` } }
    }
  }
  return null
}

export interface RoomRecommendation {
  homeRoomId: string | null
  awayRoomId: string | null
  /** What happened to the rooms, said plainly ("Home Changing Room and Visitors' Room"). */
  note: string | null
}

/**
 * ROOMS GO WITH THE PITCH: for a home fixture at a venue and a kick-off, the team's preferred changing rooms
 * (else the club's), else any room free for each side's time -- never the same room for both, and an away
 * room only where the venue has a second team room (the server's own "needs rooms" rule). The officials room
 * is left as it is: Arena only places one where the club has said which.
 */
export function recommendRooms(day: ArenaDay, draft: Occupancy[], fixture: ArenaFixture, venueId: string, kickoff: number, prefs: { home: string[]; away: string[] } = { home: [], away: [] }): RoomRecommendation {
  const venue = day.venues.find((v) => v.id === venueId)
  if (fixture.noChangingRooms || venue?.changingRoomsAvailable === false) return { homeRoomId: null, awayRoomId: null, note: null }
  const teamRooms = day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials")
  if (teamRooms.length === 0) return { homeRoomId: null, awayRoomId: null, note: `${venue?.name ?? "This venue"} has no changing rooms set up.` }
  const meet = toMinutes(fixture.meetTime)
  const rank = (list: string[], r: ArenaRoom) => {
    const i = list.indexOf(r.id)
    return i === -1 ? 100 + r.sortOrder : i
  }
  const free = (r: ArenaRoom, role: "HOME" | "AWAY") => roomClash(day, draft, fixture.id, r.id, fixtureRoomWindow(kickoff, fixture.playMinutes, meet, role, day.policy)) === null
  const home = [...teamRooms].sort((a, b) => rank(prefs.home, a) - rank(prefs.home, b)).find((r) => free(r, "HOME")) ?? null
  const away = teamRooms.length >= 2
    ? [...teamRooms].sort((a, b) => rank(prefs.away, a) - rank(prefs.away, b)).find((r) => r.id !== home?.id && free(r, "AWAY")) ?? null
    : null
  const named = [home?.name, away?.name].filter(Boolean)
  const note = !home
    ? `No changing room at ${venue?.name ?? "this venue"} is free then.`
    : teamRooms.length >= 2 && !away
      ? `${home.name} for the home side; no second room is free for the visitors.`
      : named.join(" and ")
  return { homeRoomId: home?.id ?? null, awayRoomId: away?.id ?? null, note }
}

/**
 * A ROOM FOR A TRAINING SESSION THAT ASKED FOR ONE, at its venue and (planned) start: the team's preferred room,
 * else the first free one in the club's order -- one team per room, never one somebody else holds then.
 */
export function recommendTrainingRoom(day: ArenaDay, draft: Occupancy[], session: ArenaTraining, venueId: string, start: number | null, prefs: string[] = []): { roomId: string | null; note: string | null } {
  const venue = day.venues.find((v) => v.id === venueId)
  if (venue?.changingRoomsAvailable === false) return { roomId: null, note: null }
  const rooms = day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials")
  if (rooms.length === 0) return { roomId: null, note: `${venue?.name ?? "This venue"} has no changing rooms set up.` }
  const use = trainingRoomWindow(session, start, day.policy)
  if (!use) return { roomId: null, note: null }
  const rank = (r: ArenaRoom) => {
    const i = prefs.indexOf(r.id)
    return i === -1 ? 100 + r.sortOrder : i
  }
  const room = [...rooms].sort((x, y) => rank(x) - rank(y)).find((r) => roomClash(day, draft, session.id, r.id, use) === null) ?? null
  return room ? { roomId: room.id, note: room.name } : { roomId: null, note: `Every suitable room at ${venue?.name ?? "this venue"} is taken ${window(use.from, use.until)}.` }
}

/**
 * WHAT AN ACTIVITY STILL NEEDS, with the plan laid over it -- the server's own rule (`arena_fixture_needs`): a
 * home fixture needs a kick-off, a venue, a pitch, and the changing rooms its venue can give (a home room
 * where it has one team room, an away room too where it has two; never an officials room); a training session
 * needs its time, a pitch, and a changing room only if its team asked for one. So something allocated in the
 * plan stops reading as unallocated before Save.
 */
export function plannedNeeds(day: ArenaDay, plan: Plan, a: Allocatable): ArenaNeed[] {
  const p = plannedParts(plan, a)
  if (a.kind === "TRAINING") {
    // A session needs a room only when its team asked for one, and only where its venue has rooms to give
    // (`internal.arena_training_needs`); a venue not yet known still counts the request.
    const venueId = p.venueId ?? (p.pitchId ? day.pitches.find((x) => x.id === p.pitchId)?.venueId ?? null : null)
    const venue = venueId ? day.venues.find((v) => v.id === venueId) : undefined
    const roomsThere = venueId ? day.rooms.some((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials") : true
    const wantsRoom = a.needsRoom && !p.homeRoomId && (!venueId || ((venue?.changingRoomsAvailable ?? true) && roomsThere))
    return [...(p.kickoff ? [] : ["TIME" as const]), ...(p.pitchId ? [] : ["PITCH" as const]), ...(wantsRoom ? ["ROOMS" as const] : [])]
  }
  if (!a.home) return []
  const venueId = p.venueId ?? (p.pitchId ? day.pitches.find((x) => x.id === p.pitchId)?.venueId ?? null : null)
  const venue = venueId ? day.venues.find((v) => v.id === venueId) : undefined
  const teamRooms = venueId ? day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials").length : 0
  const needs: ArenaNeed[] = []
  if (!p.kickoff) needs.push("KICKOFF")
  if (!venueId) needs.push("VENUE")
  if (!p.pitchId) needs.push("PITCH")
  if (venueId && !a.noChangingRooms && (venue?.changingRoomsAvailable ?? true) && ((!p.homeRoomId && teamRooms >= 1) || (!p.awayRoomId && teamRooms >= 2))) needs.push("ROOMS")
  return needs
}

/** Who a changing room is held for -- its SIDE: a match's home side, its visitors, its officials, or a training group. */
export type RoomRole = "HOME" | "AWAY" | "OFFICIALS" | "TRAINING"

const PART: Record<RoomRole, "homeRoomId" | "awayRoomId" | "officialsRoomId"> = { HOME: "homeRoomId", AWAY: "awayRoomId", OFFICIALS: "officialsRoomId", TRAINING: "homeRoomId" }
const LOCK: Record<RoomRole, "home_room" | "away_room" | "officials_room"> = { HOME: "home_room", AWAY: "away_room", OFFICIALS: "officials_room", TRAINING: "home_room" }
const SIDE_WORDS: Record<RoomRole, string> = { HOME: "home side", AWAY: "visitors", OFFICIALS: "officials", TRAINING: "training group" }

/** The plan part that holds a room for a side (a training group's room is its `homeRoomId`). */
export const roomPart = (side: RoomRole) => PART[side]
/** The lock that holds a room for a side. */
export const roomLock = (side: RoomRole) => LOCK[side]

/**
 * THE ROOMS AN ACTIVITY IS STILL WAITING FOR, with the plan laid over it -- the Changing Rooms demand tray:
 * a home fixture's home room (and away room where its venue has two team rooms), a training session's room
 * when its team asked for one. Never an officials room: Arena places one only where the club has said which.
 */
export function roomDemand(day: ArenaDay, plan: Plan, a: Allocatable): RoomRole[] {
  if (!plannedNeeds(day, plan, a).includes("ROOMS")) return []
  if (a.kind === "TRAINING") return ["TRAINING"]
  const p = plannedParts(plan, a)
  const venueId = p.venueId ?? (p.pitchId ? day.pitches.find((x) => x.id === p.pitchId)?.venueId ?? null : null)
  const teamRooms = venueId ? day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials").length : 0
  const roles: RoomRole[] = []
  if (!p.homeRoomId && teamRooms >= 1) roles.push("HOME")
  if (!p.awayRoomId && teamRooms >= 2) roles.push("AWAY")
  return roles
}

/** When an activity would hold a room in a role, at its planned time -- or null while it has no time. */
export function roomUse(day: ArenaDay, plan: Plan, a: Allocatable, side: RoomRole, start?: number | null) {
  const p = plannedParts(plan, a)
  const at = start ?? toMinutes(p.kickoff)
  if (a.kind === "TRAINING") return trainingRoomWindow(a, at, day.policy)
  if (at === null || !a.home) return null
  return fixtureRoomWindow(at, a.playMinutes, toMinutes(a.meetTime), side === "TRAINING" ? "HOME" : side, day.policy)
}

/**
 * WOULD THIS ROOM DO, for this activity in this role, over the draft: at the activity's own venue, a team
 * room for a team (the officials' room is for officials), switched on, and free -- in use and turnaround both.
 */
export function roomFit(day: ArenaDay, draft: Occupancy[], plan: Plan, a: Allocatable, side: RoomRole, roomId: string, start?: number | null): Clash | null {
  const room = day.rooms.find((r) => r.id === roomId)
  if (!room) return null
  const p = plannedParts(plan, a)
  const venueId = p.venueId ?? (p.pitchId ? day.pitches.find((x) => x.id === p.pitchId)?.venueId ?? null : null)
  if (venueId && room.venueId !== venueId) {
    const there = day.venues.find((v) => v.id === venueId)?.name ?? "another venue"
    return { code: "ROOM_ELSEWHERE", severity: "hard", message: `${room.name} is at another venue: ${activityLabel(a)} is at ${there}.`, short: { title: `${room.name} unavailable`, reason: `At another venue from ${there}` } }
  }
  if (side !== "OFFICIALS" && room.roomType === "match_officials") {
    return { code: "ROOM_UNSUITED", severity: "hard", message: `${room.name} is the officials' room.`, short: { title: `${room.name} is for officials`, reason: "Choose a team changing room" } }
  }
  // One team per room: a match's two sides are two teams.
  const other = draft.find((o) => o.resourceType === "ROOM" && o.resourceId === roomId && o.activityId === a.id && o.role !== side)
  if (other) {
    const held = SIDE_WORDS[(other.role ?? "HOME") as RoomRole]
    return { code: "ROOM_IN_USE", severity: "hard", message: `${room.name} already has ${activityLabel(a)}'s ${held}: one team per room.`, short: { title: `${room.name} unavailable`, reason: `Has the ${held}` } }
  }
  const use = roomUse(day, plan, a, side, start)
  if (!use) return null
  return roomClash(day, draft, a.id, roomId, use)
}
