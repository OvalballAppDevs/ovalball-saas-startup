import {
  activityLabel,
  clock,
  toMinutes,
  type ActivityTime,
  type AllocationPreview,
  type ArenaConflict,
  type ArenaDay,
  type ArenaEvent,
  type ArenaFixture,
  type ArenaOccupancy,
  type ArenaPitch,
  type ArenaRoom,
  type ArenaTeam,
  type ArenaTournament,
  type ArenaTraining,
  type ArenaVenue,
  type PreviewItem,
} from "@ovalball/contracts/arena"

import { EMPTY_PLAN, type Allocatable } from "./plan"
import { fixturePitchWindow, fixtureRoomWindow, pitchClash, plannedNeeds, readOccupancy, recommendRooms, recommendTrainingRoom, trainingRoomWindow, trainingWindow, type Occupancy } from "./rules"

/**
 * DEVELOPMENT ONLY -- PLANNING DAYS MADE UP IN MEMORY, to prove the planner against the days a club really has
 * without touching a single real allocation.
 *
 * Each scenario is built from the real day's club, policy and -- where it fits -- its real venues, pitches and
 * changing rooms (so the board is the club's own estate), with the day's activities made up: a busy Thursday
 * training night, a quiet day, a normal training night, a match day, a tournament day, an event day, and a large
 * club with two venues, twelve pitches and eight rooms. Arena Planning opens one only in a development build, as
 * `?scenario=<key>`; Auto Allocate then shows a sample proposal worked out on the phone with the board's own rules
 * (clearly a sample: the real one is the server's), and Save refuses. Nothing here reads or writes a row.
 */

export type ScenarioKey = "thursday" | "quiet" | "training" | "matchday" | "tournament" | "event" | "large"
export const SCENARIOS: { key: ScenarioKey; title: string }[] = [
  { key: "thursday", title: "Busy Thursday training night" },
  { key: "quiet", title: "Quiet day" },
  { key: "training", title: "Normal training night" },
  { key: "matchday", title: "Match day" },
  { key: "tournament", title: "Tournament day" },
  { key: "event", title: "Event day" },
  { key: "large", title: "Large club" },
]
export const isScenario = (v: unknown): v is ScenarioKey => typeof v === "string" && SCENARIOS.some((s) => s.key === v)

const id = (s: string) => `sample-${s}`
const team = (key: string, displayName: string, category: "youth" | "senior", ageGroup: string | null, gender: string, squad: string | null = null): ArenaTeam =>
  ({ id: id(`team-${key}`), displayName, category, ageGroup, gender, squadDesignation: squad, rugbyCode: "union", alias: null })

const T = {
  m1: team("m1", "Men's 1st Team", "senior", null, "mens", "1st"),
  m2: team("m2", "Men's 2nd Team", "senior", null, "mens", "2nd"),
  w1: team("w1", "Women's 1st Team", "senior", null, "womens", "1st"),
  u9: team("u9", "Under 9 Mixed", "youth", "U9", "mixed"),
  u10: team("u10", "Under 10 Mixed", "youth", "U10", "mixed"),
  u12: team("u12", "Under 12 Boys", "youth", "U12", "boys"),
  u13: team("u13", "Under 13 Boys", "youth", "U13", "boys"),
  u14g: team("u14g", "Under 14 Girls", "youth", "U14", "girls"),
  u14: team("u14", "Under 14 Boys", "youth", "U14", "boys"),
  u15: team("u15", "Under 15 Boys", "youth", "U15", "boys"),
  u16: team("u16", "Under 16 Boys", "youth", "U16", "boys"),
  u16g: team("u16g", "Under 16 Girls", "youth", "U16", "girls"),
  u8: team("u8", "Under 8 Mixed", "youth", "U8", "mixed"),
  u7: team("u7", "Under 7 Mixed", "youth", "U7", "mixed"),
}

/** A fixture to make up: kick-off, length, footprint, and (by name) where it is. */
interface FSpec { key: string; team: ArenaTeam; opponent: string; kickoff: string | null; play: number; footprint: "quarter" | "half" | "full"; pitch?: string; home?: string; away?: string; officials?: string; locks?: ArenaFixture["locks"]; noRooms?: boolean; competition?: boolean; venue?: string }
/** A session to make up: when, where, and whether its team asked for a room ("plan" or "session"). */
interface TSpec { key: string; team: ArenaTeam; start: string; end: string; pitch?: string; venue?: string; room?: string; request?: "PLAN" | "SESSION"; locks?: ArenaTraining["locks"] }
/** A reservation: a tournament holding pitches, or an event holding a pitch. */
interface HSpec { key: string; kind: "TOURNAMENT" | "EVENT"; title: string; from: string; until: string; pitches: string[]; areas?: number }
interface Spec { estate: "real" | "large"; off?: string[]; fixtures: FSpec[]; training: TSpec[]; holds: HSpec[] }

const EDITABLE: ActivityTime = { owner: "FIXTURE", editable: true, reason: null }
const COMPETITION: ActivityTime = { owner: "COMPETITION", editable: false, reason: "Kick-off is set by the competition." }
const TRAINING_TIME: ActivityTime = { owner: "TRAINING", editable: true, reason: null }

// ------------------------------------------------------------------ the scenarios

const SPECS: Record<Exclude<ScenarioKey, "large">, Spec> = {
  // THE OWNER'S THURSDAY: five groups at 18:00 -- three sharing Pitch 2, one on Pitch 3, one still needing a pitch --
  // the minis on Smith Field before the evening match's warm-up, the room requests that come with them, a room
  // switched off, an evening league match with home, away and officials rooms, the senior sides after (one booked
  // into the visitors' room the match needs: a clash to resolve), a maintenance hold on another pitch, and locks.
  thursday: {
    estate: "real",
    off: ["Changing Room 4"],
    fixtures: [
      { key: "f-u16", team: T.u16, opponent: "Burnley RUFC", kickoff: "19:15", play: 70, footprint: "full", pitch: "Smith Field", home: "Home Dressing Room", away: "Visitors Room", officials: "Officials Room", locks: ["pitch"], competition: true },
    ],
    training: [
      { key: "t-u12", team: T.u12, start: "18:00", end: "19:00", pitch: "Pitch 2" },
      { key: "t-u13", team: T.u13, start: "18:00", end: "19:00", pitch: "Pitch 2", room: "Changing Room 3", request: "PLAN", locks: ["home_room"] },
      { key: "t-u14g", team: T.u14g, start: "18:00", end: "19:00", pitch: "Pitch 2", room: "Changing Room 5", request: "SESSION" },
      { key: "t-u16g", team: T.u16g, start: "18:00", end: "19:00", pitch: "Pitch 3", request: "PLAN" },
      { key: "t-u10", team: T.u10, start: "17:00", end: "18:00", pitch: "Smith Field" },
      { key: "t-u15", team: T.u15, start: "18:00", end: "19:00", request: "PLAN", venue: "primary" },
      { key: "t-u9", team: T.u9, start: "17:30", end: "18:30", pitch: "Main Pitch" },
      { key: "t-m1", team: T.m1, start: "19:30", end: "21:00", pitch: "Pitch 1", room: "Visitors Room", request: "PLAN" },
      { key: "t-w1", team: T.w1, start: "19:30", end: "21:00", pitch: "Pitch 3", request: "SESSION" },
    ],
    holds: [{ key: "h-maint", kind: "EVENT", title: "Floodlight Maintenance", from: "17:00", until: "22:00", pitches: ["Wilson Playing Field"] }],
  },
  quiet: {
    estate: "real",
    fixtures: [],
    training: [{ key: "t-u10", team: T.u10, start: "18:00", end: "19:00", pitch: "Pitch 1" }],
    holds: [],
  },
  training: {
    estate: "real",
    fixtures: [],
    training: [
      { key: "t-u12", team: T.u12, start: "18:00", end: "19:15", pitch: "Pitch 2" },
      { key: "t-u14g", team: T.u14g, start: "18:00", end: "19:15", pitch: "Pitch 3", room: "Changing Room 5", request: "PLAN" },
      { key: "t-m1", team: T.m1, start: "19:30", end: "21:00", pitch: "Pitch 1", room: "Home Dressing Room", request: "PLAN" },
    ],
    holds: [],
  },
  matchday: {
    estate: "real",
    fixtures: [
      { key: "f-m1", team: T.m1, opponent: "Preston Grasshoppers RFC", kickoff: "15:00", play: 80, footprint: "full", pitch: "Pitch 1", home: "Home Dressing Room", away: "Visitors Room", officials: "Officials Room", locks: ["pitch", "home_room"], competition: true },
      { key: "f-w1", team: T.w1, opponent: "Sedgley Park RUFC", kickoff: "13:00", play: 80, footprint: "full", pitch: "Pitch 3", home: "Changing Room 3", away: "Changing Room 4", competition: true },
      { key: "f-u14", team: T.u14, opponent: "Burnley RUFC", kickoff: "14:30", play: 60, footprint: "full", pitch: "Smith Field", home: "Changing Room 5" },
      { key: "f-u12", team: T.u12, opponent: "Fylde Rugby Club", kickoff: "10:30", play: 50, footprint: "half", pitch: "Pitch 2", home: "Changing Room 3", away: "Changing Room 4" },
      { key: "f-u13", team: T.u13, opponent: "Kendal RFC", kickoff: "11:00", play: 60, footprint: "full" },
    ],
    training: [],
    holds: [],
  },
  tournament: {
    estate: "real",
    fixtures: [{ key: "f-m1", team: T.m1, opponent: "Kendal RFC", kickoff: "15:00", play: 80, footprint: "full", pitch: "Pitch 1", home: "Home Dressing Room", away: "Visitors Room" }],
    training: [],
    holds: [{ key: "h-fest", kind: "TOURNAMENT", title: "Junior Sevens Festival", from: "09:00", until: "13:00", pitches: ["Pitch 2", "Pitch 3", "Smith Field"], areas: 2 }],
  },
  event: {
    estate: "real",
    fixtures: [{ key: "f-u14", team: T.u14, opponent: "Burnley RUFC", kickoff: "11:00", play: 60, footprint: "full", pitch: "Pitch 3", home: "Changing Room 3", away: "Changing Room 5" }],
    training: [{ key: "t-u9", team: T.u9, start: "10:00", end: "11:00", pitch: "Pitch 2" }],
    holds: [{ key: "h-open", kind: "EVENT", title: "Club Open Day", from: "12:00", until: "17:00", pitches: ["Pitch 1", "Smith Field"] }],
  },
}

// The large club: its own made-up estate (two venues, twelve pitches, eight rooms) and twenty activities.
const LARGE_VENUES: ArenaVenue[] = [
  { id: id("v-main"), name: "Northfield Road", isDefault: true, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: true },
  { id: id("v-wilson"), name: "Wilson Memorial Playing Fields", isDefault: false, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: false },
]
const largePitch = (key: string, venue: string, name: string, size: ArenaPitch["size"], lanes: number, sortOrder: number): ArenaPitch => ({
  id: id(`p-${key}`), venueId: id(venue), name, active: true, size, layout: lanes >= 4 ? "four_quarters" : lanes === 2 ? "two_halves" : "full_only", lanes,
  customLengthM: null, customWidthM: null, areaM2: null, sortOrder, coverImagePath: null, coverStockKey: null,
})
const LARGE_PITCHES: ArenaPitch[] = [
  largePitch("1", "v-main", "Pitch 1", "full", 1, 1), largePitch("2", "v-main", "Pitch 2", "full", 2, 2), largePitch("3", "v-main", "Pitch 3", "full", 1, 3),
  largePitch("4", "v-main", "Pitch 4", "full", 1, 4), largePitch("5", "v-main", "Pitch 5", "three_quarter", 1, 5), largePitch("3g", "v-main", "3G Floodlit", "full", 2, 6),
  largePitch("ma", "v-main", "Mini Pitch A", "half", 4, 7), largePitch("mb", "v-main", "Mini Pitch B", "half", 4, 8),
  largePitch("wf", "v-wilson", "Wilson Playing Field", "full", 1, 1), largePitch("top", "v-wilson", "Top Field", "full", 1, 2),
  largePitch("bottom", "v-wilson", "Bottom Field", "three_quarter", 1, 3), largePitch("junior", "v-wilson", "Junior Pitch", "half", 2, 4),
]
const largeRoom = (key: string, venue: string, name: string, roomType: ArenaRoom["roomType"], sortOrder: number): ArenaRoom =>
  ({ id: id(`r-${key}`), venueId: id(venue), name, roomType, active: true, sortOrder, coverImagePath: null, coverStockKey: null })
const LARGE_ROOMS: ArenaRoom[] = [
  largeRoom("home", "v-main", "Home Dressing Room", "full_size", 1), largeRoom("visitors", "v-main", "Visitors Room", "full_size", 2),
  largeRoom("cr3", "v-main", "Changing Room 3", "full_size", 3), largeRoom("cr4", "v-main", "Changing Room 4", "smaller", 4),
  largeRoom("cr5", "v-main", "Changing Room 5", "smaller", 5), largeRoom("officials", "v-main", "Officials Room", "match_officials", 6),
  largeRoom("pav-h", "v-wilson", "Pavilion Home", "full_size", 1), largeRoom("pav-a", "v-wilson", "Pavilion Away", "full_size", 2),
]
const LARGE: Spec = {
  estate: "large",
  fixtures: [
    { key: "f1", team: T.m1, opponent: "Preston Grasshoppers RFC", kickoff: "15:30", play: 80, footprint: "full", pitch: "Pitch 1", home: "Home Dressing Room", away: "Visitors Room", officials: "Officials Room", locks: ["pitch", "home_room"], competition: true },
    { key: "f2", team: T.m2, opponent: "Kendal RFC", kickoff: "13:00", play: 80, footprint: "full", pitch: "Pitch 3", home: "Home Dressing Room", away: "Visitors Room" },
    { key: "f3", team: T.w1, opponent: "Sedgley Park RUFC", kickoff: "16:00", play: 80, footprint: "full", pitch: "Wilson Playing Field", home: "Pavilion Home", away: "Pavilion Away", locks: ["away_room"] },
    { key: "f4", team: T.u16, opponent: "Rossendale RUFC", kickoff: "12:30", play: 70, footprint: "full", pitch: "Pitch 4", home: "Changing Room 3", away: "Changing Room 4" },
    { key: "f5", team: T.u14, opponent: "Fylde Rugby Club", kickoff: "10:00", play: 60, footprint: "full", pitch: "3G Floodlit", home: "Changing Room 3", away: "Changing Room 4", locks: ["pitch"] },
    { key: "f6", team: T.u13, opponent: "Wigan RUFC", kickoff: "10:30", play: 60, footprint: "full", pitch: "Pitch 2", home: "Home Dressing Room", away: "Visitors Room" },
    { key: "f7", team: T.u12, opponent: "Vale of Lune RUFC", kickoff: "11:00", play: 50, footprint: "half", pitch: "Junior Pitch", home: "Pavilion Home", away: "Pavilion Away" },
    { key: "f11", team: team("m3", "Men's 3rd Team", "senior", null, "mens", "3rd"), opponent: "Manchester Rugby Club", kickoff: "13:00", play: 80, footprint: "full", pitch: "Top Field" },
    { key: "f8", team: T.u15, opponent: "Orrell RUFC", kickoff: "17:30", play: 70, footprint: "full", venue: "primary" },
    { key: "f9", team: team("u18g", "Under 18 Girls", "youth", "U18", "girls"), opponent: "Waterloo FC", kickoff: "15:00", play: 70, footprint: "full", venue: "primary" },
    { key: "f10", team: team("u11", "Under 11 Mixed", "youth", "U11", "mixed"), opponent: "Broughton Park FC", kickoff: "10:30", play: 40, footprint: "quarter", noRooms: true, venue: "primary" },
    { key: "f12", team: team("u17", "Under 17 Boys", "youth", "U17", "boys"), opponent: "Sale FC Rugby Club", kickoff: "16:30", play: 70, footprint: "full", venue: "primary" },
  ],
  training: [
    { key: "t1", team: T.u9, start: "09:00", end: "10:00", pitch: "Mini Pitch A" },
    { key: "t2", team: T.u10, start: "09:00", end: "10:00", pitch: "Mini Pitch A" },
    { key: "t3", team: T.u8, start: "09:15", end: "10:15", pitch: "Mini Pitch B" },
    { key: "t5", team: T.u7, start: "09:00", end: "10:00", pitch: "Mini Pitch B" },
    { key: "t4", team: team("w2", "Women's 2nd Team", "senior", null, "womens", "2nd"), start: "17:30", end: "19:00", pitch: "3G Floodlit", request: "PLAN" },
    { key: "t6", team: T.u16g, start: "18:00", end: "19:15", pitch: "Top Field", room: "Pavilion Home", request: "PLAN" },
  ],
  holds: [
    { key: "h-fest", kind: "TOURNAMENT", title: "Junior Sevens Festival", from: "08:30", until: "11:00", pitches: ["Pitch 4", "Pitch 5"], areas: 2 },
    { key: "h-open", kind: "EVENT", title: "Club Open Day", from: "15:00", until: "18:00", pitches: ["Bottom Field"] },
  ],
}

// ------------------------------------------------------------------ building a day

/** One scenario's day: the real day's club, date and policy; its estate (or the large club's); made-up activities. */
export function scenarioDay(real: ArenaDay, key: ScenarioKey): ArenaDay {
  const spec = key === "large" ? LARGE : SPECS[key]
  const venues = spec.estate === "large" ? LARGE_VENUES : real.venues
  const pitches = spec.estate === "large" ? LARGE_PITCHES : real.pitches.map((p) => ({ ...p }))
  const rooms = spec.estate === "large" ? LARGE_ROOMS : real.rooms.map((r) => ({ ...r, active: r.active && !(spec.off ?? []).includes(r.name) }))
  const primary = venues.find((v) => v.isDefault) ?? venues[0]
  const pitchNamed = (name?: string) => (name ? pitches.find((p) => p.name === name) ?? null : null)
  const roomNamed = (name?: string) => (name ? rooms.find((r) => r.name === name) ?? null : null)
  const policy = real.policy
  const occupancy: ArenaOccupancy[] = []
  const occ = (o: Omit<ArenaOccupancy, "from" | "playFrom" | "playUntil" | "until" | "turnaroundUntil">, w: { from: number; playFrom: number; playUntil: number; until: number; turnaroundUntil: number }) =>
    occupancy.push({ ...o, from: clock(w.from), playFrom: clock(w.playFrom), playUntil: clock(w.playUntil), until: clock(w.until), turnaroundUntil: clock(w.turnaroundUntil) })
  const at = (hhmm: string) => toMinutes(hhmm) ?? 0

  const fixtures: ArenaFixture[] = spec.fixtures.map((f) => {
    const pitch = pitchNamed(f.pitch)
    const venueId = pitch?.venueId ?? (f.venue === "primary" ? primary?.id ?? null : null)
    const home = roomNamed(f.home); const away = roomNamed(f.away); const officials = roomNamed(f.officials)
    const label = `${f.team.displayName} v ${f.opponent}`
    const a: ArenaFixture = {
      kind: "FIXTURE", id: id(f.key), home: true, title: label, team: f.team, opponentName: f.opponent, date: real.date, kickoff: f.kickoff, playMinutes: f.play,
      status: "Booked", meetTime: null, kickoffProposed: false, requiresOpponentAgreement: false, venueId, venueName: venues.find((v) => v.id === venueId)?.name ?? null,
      pitchId: pitch?.id ?? null, pitchName: pitch?.name ?? null, homeRoomId: home?.id ?? null, awayRoomId: away?.id ?? null, officialsRoomId: officials?.id ?? null,
      noChangingRooms: !!f.noRooms, pitchWindow: null, roomWindow: null, fit: { footprint: f.footprint, areaM2: null, basis: "CATEGORY", source: "" },
      locks: f.locks ?? [], autoAllocated: [], needs: [], catering: null, time: f.competition ? COMPETITION : EDITABLE,
    }
    const ko = f.kickoff ? at(f.kickoff) : null
    if (ko !== null && pitch) occ({ activityType: "FIXTURE", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "PITCH", resourceId: pitch.id, role: null, footprint: f.footprint, areas: null, locked: a.locks.includes("pitch") }, fixturePitchWindow(ko, f.play, policy))
    for (const [role, room, part] of [["HOME", home, "home_room"], ["AWAY", away, "away_room"], ["OFFICIALS", officials, "officials_room"]] as const) {
      if (ko !== null && room) occ({ activityType: "FIXTURE", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "ROOM", resourceId: room.id, role, footprint: null, areas: null, locked: a.locks.includes(part) }, fixtureRoomWindow(ko, f.play, null, role, policy))
    }
    return a
  })

  const training: ArenaTraining[] = spec.training.map((t) => {
    const pitch = pitchNamed(t.pitch)
    const venueId = pitch?.venueId ?? (t.venue === "primary" ? primary?.id ?? null : null)
    const room = roomNamed(t.room)
    const a: ArenaTraining = {
      kind: "TRAINING", id: id(t.key), title: `${t.team.displayName} training`, team: t.team, groupLabel: null, date: real.date, start: t.start, end: t.end,
      venueId, venueName: venues.find((v) => v.id === venueId)?.name ?? null, pitchId: pitch?.id ?? null, pitchName: pitch?.name ?? null,
      roomId: room?.id ?? null, needsRoom: !!t.request, roomRequest: t.request ?? null, locks: t.locks ?? [], autoAllocated: [], source: "AUTOMATIC_PLAN", needs: [], time: TRAINING_TIME,
    }
    const w = trainingWindow(a)
    if (w && pitch) occ({ activityType: "TRAINING", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "PITCH", resourceId: pitch.id, role: null, footprint: null, areas: null, locked: a.locks.includes("pitch") }, w)
    const rw = trainingRoomWindow(a, null, policy)
    if (rw && room) occ({ activityType: "TRAINING", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "ROOM", resourceId: room.id, role: "TRAINING", footprint: null, areas: null, locked: a.locks.includes("home_room") }, rw)
    return a
  })

  const holds: (ArenaTournament | ArenaEvent)[] = spec.holds.map((h) => {
    const held = h.pitches.map((n) => pitchNamed(n)).filter((p): p is ArenaPitch => !!p)
    const w = { from: at(h.from), playFrom: at(h.from), playUntil: at(h.until), until: at(h.until), turnaroundUntil: at(h.until) }
    if (h.kind === "TOURNAMENT") {
      for (const p of held) occ({ activityType: "TOURNAMENT", activityId: id(`${h.key}-${p.id}`), parentId: id(h.key), label: h.title, resourceType: "PITCH", resourceId: p.id, role: null, footprint: null, areas: h.areas ?? 1, locked: true }, w)
      return {
        kind: "TOURNAMENT", id: id(h.key), title: h.title, status: "PUBLISHED", start: h.from, end: h.until, venueId: held[0]?.venueId ?? null, coverImagePath: null, coverStockKey: null,
        reservations: held.map((p) => ({ id: id(`${h.key}-${p.id}`), pitchId: p.id, from: h.from, until: h.until, areas: h.areas ?? 1, markedByOrganiser: true })),
        gameCount: 12, hasPublishedPlan: true, conflicts: [], time: { owner: "TOURNAMENT", editable: false, reason: "Times are set in the tournament." },
      } satisfies ArenaTournament
    }
    for (const p of held) occ({ activityType: "EVENT", activityId: id(h.key), parentId: null, label: h.title, resourceType: "PITCH", resourceId: p.id, role: null, footprint: null, areas: null, locked: true }, w)
    return {
      kind: "EVENT", id: id(h.key), title: h.title, status: "PUBLISHED", eventType: "OTHER", start: h.from, end: h.until, allDay: false, multiDay: false, locationKind: "VENUE",
      venueId: held[0]?.venueId ?? primary?.id ?? null, venueName: venues.find((v) => v.id === (held[0]?.venueId ?? primary?.id))?.name ?? null, externalName: null, locationDetail: null,
      pitchIds: held.map((p) => p.id), coverImagePath: null, coverStockKey: null, catering: { required: false, visible: true }, time: { owner: "EVENT", editable: false, reason: "Times are set in the event." },
    } satisfies ArenaEvent
  })

  const base: ArenaDay = { ...real, canManage: true, venues, pitches, rooms, activities: [...fixtures, ...training, ...holds], occupancy, conflicts: [], readiness: real.readiness }
  // What each still needs, by the planner's own rule; the clashes, by the board's own engine; the counts from both.
  for (const a of base.activities) if (a.kind === "FIXTURE" || a.kind === "TRAINING") (a as Allocatable).needs = plannedNeeds(base, EMPTY_PLAN, a as Allocatable)
  base.conflicts = sampleConflicts(base)
  const needing = base.activities.filter((a) => (a.kind === "FIXTURE" || a.kind === "TRAINING") && a.needs.length > 0).length
  base.readiness = {
    ...real.readiness,
    state: needing + base.conflicts.length > 0 ? "NEEDS_ATTENTION" : "READY",
    activities: base.activities.length, homeGames: fixtures.length, awayGames: 0, training: training.length,
    tournaments: holds.filter((h) => h.kind === "TOURNAMENT").length, events: holds.filter((h) => h.kind === "EVENT").length,
    needsAllocation: needing,
    pitchConflicts: base.conflicts.filter((c) => c.resourceType === "PITCH").length,
    roomConflicts: base.conflicts.filter((c) => c.resourceType === "ROOM").length,
    tournamentConflicts: 0, warnings: 0,
  }
  return base
}

/** The made-up day's clashes, by the board's own rules: two uses of one room, or a match and training on one pitch. */
function sampleConflicts(day: ArenaDay): ArenaConflict[] {
  const rows = readOccupancy(day)
  const out: ArenaConflict[] = []
  const name = (rid: string) => day.rooms.find((r) => r.id === rid)?.name ?? day.pitches.find((p) => p.id === rid)?.name ?? "It"
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i]; const b = rows[j]
    if (a.resourceId !== b.resourceId || a.activityId === b.activityId) continue
    if (a.resourceType === "ROOM" && a.from < b.turnaroundUntil && b.from < a.turnaroundUntil) {
      const [x, y] = a.from <= b.from ? [a, b] : [b, a]
      out.push({ key: `ROOM_IN_USE:${a.resourceId}:${[a.activityId, b.activityId].sort().join(",")}`, code: "ROOM_IN_USE", severity: "hard", resourceType: "ROOM", resourceId: a.resourceId, at: clock(y.from), activityIds: [x.activityId, y.activityId],
        message: `${name(a.resourceId)} is in use by ${x.label}${x.role && x.role !== "TRAINING" ? ` (${x.role.toLowerCase()})` : ""} ${clock(x.from)}–${clock(x.until)}, and ${y.label} needs it from ${clock(y.from)}.` })
    }
    if (a.resourceType === "PITCH" && ((a.activityType === "FIXTURE" && b.activityType === "TRAINING") || (a.activityType === "TRAINING" && b.activityType === "FIXTURE")) && a.from < b.until && b.from < a.until) {
      out.push({ key: `PITCH_IN_USE:${a.resourceId}:${[a.activityId, b.activityId].sort().join(",")}`, code: "PITCH_IN_USE", severity: "hard", resourceType: "PITCH", resourceId: a.resourceId, at: clock(Math.max(a.from, b.from)), activityIds: [a.activityId, b.activityId],
        message: `${name(a.resourceId)} has ${a.label} and ${b.label} at the same time.` })
    }
  }
  return out
}

/**
 * A SAMPLE OF AUTO ALLOCATE FOR A MADE-UP DAY, worked out on the phone with the board's own rules, in time order:
 * a pitch for whatever needs one (the first free pitch at its venue), then the rooms that follow it -- a home
 * fixture's home and away rooms, a session's room when its team asked -- each placement taken before the next is
 * judged, and anything left unplaced said in the server's own words. The real proposal is always the server's;
 * this exists only so a development build can show a proposal on a day that does not exist.
 */
export function sampleAutoAllocate(day: ArenaDay): AllocationPreview {
  const work: Occupancy[] = readOccupancy(day)
  const items: PreviewItem[] = []
  const list = day.activities
    .filter((a): a is Allocatable => (a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING")
    .filter((a) => a.needs.length > 0)
    .sort((x, y) => (toMinutes(x.kind === "FIXTURE" ? x.kickoff : x.start) ?? 9999) - (toMinutes(y.kind === "FIXTURE" ? y.kickoff : y.start) ?? 9999))
  for (const a of list) {
    const current = { venueId: a.venueId, pitchId: a.pitchId, homeRoomId: a.kind === "FIXTURE" ? a.homeRoomId : a.roomId, awayRoomId: a.kind === "FIXTURE" ? a.awayRoomId : null, officialsRoomId: a.kind === "FIXTURE" ? a.officialsRoomId : null }
    const proposed = { ...current }
    const explanation: string[] = []
    let leftOver = false
    const start = toMinutes(a.kind === "FIXTURE" ? a.kickoff : a.start)
    const who = a.team?.displayName ?? (a.kind === "TRAINING" ? a.groupLabel ?? "Team" : "Team")
    if (!proposed.pitchId && start !== null) {
      const candidates = day.pitches.filter((p) => p.active && (!proposed.venueId || p.venueId === proposed.venueId)).sort((x, y) => x.sortOrder - y.sortOrder)
      const pitch = candidates.find((p) => pitchClash(day, work, a, p.id, start) === null) ?? null
      if (pitch) {
        proposed.pitchId = pitch.id
        proposed.venueId = pitch.venueId
        explanation.push(`${pitch.name} (no pitch preference set).`)
        if (a.kind === "TRAINING") { const w = trainingWindow(a); if (w) work.push({ activityType: "TRAINING", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "PITCH", resourceId: pitch.id, role: null, footprint: null, areas: null, locked: false, ...w }) }
        else work.push({ activityType: "FIXTURE", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "PITCH", resourceId: pitch.id, role: null, footprint: a.fit.footprint, areas: null, locked: false, ...fixturePitchWindow(start, a.playMinutes, day.policy) })
      } else {
        leftOver = true
        explanation.push(`No pitch is free then. ${who} still needs one.`)
      }
    }
    const venueId = proposed.venueId
    if (venueId && start !== null) {
      if (a.kind === "TRAINING" && a.needsRoom && !proposed.homeRoomId) {
        const rec = recommendTrainingRoom(day, work, a, venueId, start, [])
        if (rec.roomId) {
          proposed.homeRoomId = rec.roomId
          explanation.push(`${rec.note} for the team's changing room.`)
          const rw = trainingRoomWindow(a, start, day.policy)
          if (rw) work.push({ activityType: "TRAINING", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "ROOM", resourceId: rec.roomId, role: "TRAINING", footprint: null, areas: null, locked: false, ...rw })
        } else if (rec.note) {
          leftOver = true
          explanation.push(`${who} needs a changing room. ${rec.note}`)
        }
      }
      if (a.kind === "FIXTURE" && !a.noChangingRooms && (!proposed.homeRoomId || !proposed.awayRoomId)) {
        const rec = recommendRooms(day, work, a, venueId, start)
        if (!proposed.homeRoomId && rec.homeRoomId) proposed.homeRoomId = rec.homeRoomId
        if (!proposed.awayRoomId && rec.awayRoomId && rec.awayRoomId !== proposed.homeRoomId) proposed.awayRoomId = rec.awayRoomId
        const teamRooms = day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials").length
        if (!proposed.homeRoomId || (teamRooms >= 2 && !proposed.awayRoomId)) {
          leftOver = true
          const w = fixtureRoomWindow(start, a.playMinutes, null, proposed.homeRoomId ? "AWAY" : "HOME", day.policy)
          explanation.push(`${who} needs ${proposed.homeRoomId ? "an away changing room" : "a home changing room"}. Every suitable room at ${day.venues.find((v) => v.id === venueId)?.name ?? "the venue"} is taken from ${clock(w.from)} to ${clock(w.until)}.`)
        } else explanation.push(`${rec.note ?? "Changing rooms"}.`)
        for (const [side, rid, was] of [["HOME", proposed.homeRoomId, current.homeRoomId], ["AWAY", proposed.awayRoomId, current.awayRoomId]] as const) {
          if (rid && rid !== was) work.push({ activityType: "FIXTURE", activityId: a.id, parentId: null, label: activityLabel(a), resourceType: "ROOM", resourceId: rid, role: side, footprint: null, areas: null, locked: false, ...fixtureRoomWindow(start, a.playMinutes, null, side, day.policy) })
        }
      }
    }
    const changes = new Set<PreviewItem["changes"][number]>()
    if (proposed.venueId !== current.venueId) changes.add("VENUE")
    if (proposed.pitchId !== current.pitchId) changes.add("PITCH")
    if (proposed.homeRoomId !== current.homeRoomId || proposed.awayRoomId !== current.awayRoomId) changes.add("ROOMS")
    items.push({
      kind: a.kind, id: a.id, title: a.kind === "TRAINING" ? `${who} Training` : a.title, teamId: a.team?.id ?? null, window: start === null ? "No time yet" : clock(start),
      current, proposed, changes: [...changes], pitchOutcome: leftOver && !proposed.pitchId ? "UNRESOLVED" : changes.has("PITCH") ? "AVAILABLE" : "KEPT",
      roomsOutcome: changes.has("ROOMS") ? (leftOver ? "UNRESOLVED" : "AVAILABLE") : leftOver ? "UNRESOLVED" : null,
      outcome: leftOver ? "UNRESOLVED" : changes.size === 0 ? "UNCHANGED" : "NO_PREFERENCE", explanation,
    })
  }
  const count = (o: PreviewItem["outcome"]) => items.filter((i) => i.outcome === o).length
  return {
    date: day.date, venueId: null, rerun: false, items,
    summary: {
      firstPreferences: count("FIRST_PREFERENCE"), alternatives: count("ALTERNATIVE"), noPreference: count("NO_PREFERENCE"), unresolved: count("UNRESOLVED"), unchanged: count("UNCHANGED"),
      pitchChanges: items.filter((i) => i.changes.includes("PITCH")).length, kickoffProposals: 0,
      roomChanges: items.filter((i) => i.changes.includes("ROOMS")).length, venueChanges: items.filter((i) => i.changes.includes("VENUE")).length,
    },
  }
}
