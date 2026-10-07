/**
 * ARENA -- the club's physical operations view, as the server projects it.
 *
 * Every shape here is exactly what the Arena reads return (20270738000000): the server builds the day --
 * activities, each claim on a pitch or room with its warm-up, play and clearing times, every clash in
 * words, readiness, catering counts -- and the client renders it. Nothing in this package decides when a
 * pitch is busy or whether a placement clashes; that is the one engine on the server.
 */

/** What an Arena activity is. A tournament's game is part of its tournament, never an activity of its own. */
export type ArenaKind = "FIXTURE" | "TRAINING" | "TOURNAMENT" | "EVENT"

/** What a home fixture or a session still needs before the day is ready. */
export type ArenaNeed = "KICKOFF" | "VENUE" | "PITCH" | "ROOMS" | "TIME"

/**
 * The parts of an allocation that can be locked, or that automatic allocation made. A training session has a
 * pitch and one changing room -- its team's own, so its room is its `home_room`.
 */
export type AllocationPart = "pitch" | "home_room" | "away_room" | "officials_room"

/**
 * WHO OWNS AN ACTIVITY'S TIME, for this viewer (`internal.arena_time_owner`): whether Arena may move it, and if
 * not, where it is changed. Arena moves a time only through that owner's own writer -- a kick-off through the
 * fixture's schedule writer (proposed to an opposition on Ovalball), a session's start through the Training
 * Centre's -- and never a competition's kick-off, a tournament's reservation or an event's hours.
 */
export interface ActivityTime {
  owner: "FIXTURE" | "COMPETITION" | "TRAINING" | "TOURNAMENT" | "EVENT"
  editable: boolean
  /** Why it cannot be moved here, in one sentence ("Kick-off is managed in the fixture."). */
  reason: string | null
}

/** A team as Arena presents it: the canonical display name and the identity its compact form comes from. */
export interface ArenaTeam {
  id: string
  displayName: string
  category: string | null
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  rugbyCode: string | null
  alias: string | null
}

export interface ArenaVenue {
  id: string
  name: string
  isDefault: boolean
  address: string | null
  postcode: string | null
  coverImagePath: string | null
  coverStockKey: string | null
  changingRoomsAvailable: boolean | null
  cateringAvailable: boolean | null
}

export interface ArenaPitch {
  id: string
  venueId: string
  name: string
  active: boolean
  size: "full" | "three_quarter" | "half" | "custom"
  layout: "full_only" | "two_halves" | "four_quarters"
  lanes: number
  customLengthM: number | null
  customWidthM: number | null
  areaM2: number | null
  sortOrder: number
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface ArenaRoom {
  id: string
  venueId: string
  name: string
  roomType: "full_size" | "smaller" | "match_officials"
  active: boolean
  sortOrder: number
  coverImagePath: string | null
  coverStockKey: string | null
}

/** When a home fixture holds its pitch: from warm-up, through the match, until the pitch is clear. */
export interface PitchWindow {
  from: string
  playFrom: string
  playUntil: string
  until: string
}

/** When a home fixture holds its changing rooms: the home side from its meet time or access, the visitors from access. */
export interface RoomWindow {
  from: string
  awayFrom: string
  until: string
  turnaroundUntil: string
}

/**
 * A FIXTURE'S CATERING -- the Match Centre's own count (internal.fixture_catering). `visible` says whether
 * this viewer may see the numbers at all; a side Ovalball cannot count is listed in `sidesNotCounted`,
 * never counted as zero.
 */
export interface FixtureCatering {
  required: boolean
  visible: boolean
  total?: number
  parts?: { side: "home" | "away"; attending: number }[]
  sidesNotCounted?: ("home" | "away")[]
  basis?: string
}

export interface ArenaFixture {
  kind: "FIXTURE"
  id: string
  /** False for an away fixture: listed so the day is whole, using none of the club's facilities. */
  home: boolean
  title: string
  team: ArenaTeam | null
  opponentName: string
  date: string
  kickoff: string | null
  playMinutes: number
  status: string
  meetTime: string | null
  kickoffProposed: boolean
  requiresOpponentAgreement: boolean
  venueId: string | null
  venueName: string | null
  pitchId: string | null
  pitchName: string | null
  homeRoomId: string | null
  awayRoomId: string | null
  officialsRoomId: string | null
  noChangingRooms: boolean
  pitchWindow: PitchWindow | null
  roomWindow: RoomWindow | null
  fit: { footprint: "quarter" | "half" | "full" | null; areaM2: number | null; basis: "REGULATION" | "CATEGORY" | "UNKNOWN"; source: string }
  locks: AllocationPart[]
  autoAllocated: AllocationPart[]
  needs: ArenaNeed[]
  catering: FixtureCatering | null
  time: ActivityTime
}

export interface ArenaTraining {
  kind: "TRAINING"
  id: string
  title: string
  team: ArenaTeam | null
  groupLabel: string | null
  date: string
  start: string | null
  end: string | null
  venueId: string | null
  venueName: string | null
  pitchId: string | null
  pitchName: string | null
  /** The changing room Arena gave the session (at its venue), or null. */
  roomId: string | null
  /** Whether the team asked for a changing room for this session -- its own answer, else its training plan's. */
  needsRoom: boolean
  /** Where that answer was given: this session, its training plan, or nowhere (a one-off session that asked nothing). */
  roomRequest: "SESSION" | "PLAN" | null
  locks: AllocationPart[]
  autoAllocated: AllocationPart[]
  source: "MANUAL" | "AUTOMATIC_PLAN"
  needs: ArenaNeed[]
  time: ActivityTime
}

/** A tournament's hold on a pitch, marked out as its organiser said (`areas`), or the club's layout. */
export interface ArenaReservation {
  id: string
  pitchId: string
  from: string
  until: string
  areas: number
  markedByOrganiser: boolean
}

export interface ArenaTournament {
  kind: "TOURNAMENT"
  id: string
  title: string
  status: string
  start: string | null
  end: string | null
  venueId: string | null
  coverImagePath: string | null
  coverStockKey: string | null
  reservations: ArenaReservation[]
  gameCount: number
  hasPublishedPlan: boolean
  /** The tournament's own clashes, in its own engine's words. Arena shows them; the plan owns them. */
  conflicts: { code: string; pitchId: string | null; at: string; message: string }[]
  time: ActivityTime
}

/** An event's catering, counts only, for the people the Event Centre shows them to. */
export interface EventCatering {
  required: boolean
  visible: boolean
  expected?: number | null
  counts?: {
    players: number
    staff: number
    members: number
    familyAndGuests: number
    externalGuests: number
    total: number
    dietary: Record<string, number>
    otherNotes: number
  } | null
}

export interface ArenaEvent {
  kind: "EVENT"
  id: string
  title: string
  status: string
  eventType: string | null
  start: string | null
  end: string | null
  allDay: boolean
  multiDay: boolean
  locationKind: "VENUE" | "EXTERNAL" | "ONLINE"
  venueId: string | null
  venueName: string | null
  externalName: string | null
  locationDetail: string | null
  /** The pitches the event EXPLICITLY reserves. An event at the clubhouse reserves none. */
  pitchIds: string[]
  coverImagePath: string | null
  coverStockKey: string | null
  catering: EventCatering
  time: ActivityTime
}

export type ArenaActivity = ArenaFixture | ArenaTraining | ArenaTournament | ArenaEvent

/** One claim on one resource, in clock times. Rooms carry the role they are held for (a session's own room: TRAINING). */
export interface ArenaOccupancy {
  activityType: "FIXTURE" | "TRAINING" | "TOURNAMENT" | "TOURNAMENT_GAME" | "EVENT"
  activityId: string
  parentId: string | null
  label: string
  resourceType: "PITCH" | "ROOM"
  resourceId: string
  role: "HOME" | "AWAY" | "OFFICIALS" | "TRAINING" | null
  from: string
  playFrom: string
  playUntil: string
  until: string
  turnaroundUntil: string
  footprint: "quarter" | "half" | "full" | null
  areas: number | null
  locked: boolean
}

/** A clash, in the engine's words. `hard` clashes are refused when made; a `warning` is only said. */
export interface ArenaConflict {
  key: string
  code: string
  severity: "hard" | "warning"
  resourceType: "PITCH" | "ROOM"
  resourceId: string
  at: string
  activityIds: string[]
  message: string
}

export interface ArenaReadiness {
  state: "READY" | "NEEDS_ATTENTION"
  activities: number
  homeGames: number
  awayGames: number
  training: number
  tournaments: number
  events: number
  needsAllocation: number
  pitchConflicts: number
  roomConflicts: number
  tournamentConflicts: number
  warnings: number
  cateringKnown: number
  cateringIncomplete: number
}

export interface ArenaPolicy {
  warmUp: number
  packUp: number
  turnaround: number
  roomAccess: number
  roomRelease: number
  roomTurnaround: number
  bufferSource: "club" | "platform"
  roomSource: "club" | "platform"
  /** The club's own setting: offer automatic allocation as soon as a day with something unallocated opens. */
  autoAllocateHomeFixtures: boolean
}

export interface ArenaDay {
  club: { id: string; name: string; rugbyCode: string; logoPath: string | null; timezone: string }
  date: string
  canManage: boolean
  policy: ArenaPolicy
  venues: ArenaVenue[]
  pitches: ArenaPitch[]
  rooms: ArenaRoom[]
  activities: ArenaActivity[]
  occupancy: ArenaOccupancy[]
  conflicts: ArenaConflict[]
  readiness: ArenaReadiness
}

export interface ArenaRangeDay {
  date: string
  homeGames: number
  awayGames: number
  training: number
  tournaments: number
  pitchesReserved: number
  events: number
  needsAllocation: number
  conflicts: number
  /** The day's one activity, when it has exactly one: what to say instead of "1 training session". */
  single?: ArenaRangeSingle | null
}

export type ArenaRangeSingle =
  | { kind: "FIXTURE"; home: boolean; team: ArenaTeam | null; title: string | null; time: string | null }
  | { kind: "TRAINING"; team: ArenaTeam | null; title: string | null; time: string | null }
  | { kind: "TOURNAMENT"; title: string; time: string | null; pitches: number }
  | { kind: "EVENT"; title: string; time: string | null }

export interface ArenaRange {
  from: string
  until: string
  canManage: boolean
  days: ArenaRangeDay[]
}

export interface ArenaHubVenue {
  id: string
  name: string
  isDefault: boolean
  address: string | null
  postcode: string | null
  coverImagePath: string | null
  coverStockKey: string | null
  pitches: number
  rooms: number
  pitchesInUseNow: number
  pitchesInUseToday: number
}

export interface ArenaHub {
  club: { id: string; name: string; logoPath: string | null; coverPath: string | null }
  today: string
  now: string
  canManage: boolean
  estate: { venues: number; pitches: number; rooms: number; upcoming: number; upcomingDays: number }
  venues: ArenaHubVenue[]
  todayAtTheClub: { activities: ArenaActivity[]; readiness: ArenaReadiness; conflicts: ArenaConflict[]; pitches: ArenaPitch[]; rooms: ArenaRoom[] }
  week: ArenaRangeDay[]
  /** The next day after today with anything on (up to four weeks ahead), as a whole day -- or null. */
  next: ({ date: string } & ArenaHub["todayAtTheClub"]) | null
}

/** How one resource stands for one activity in the Allocate sheet. */
export type OptionState = "PREFERRED" | "AVAILABLE" | "OCCUPIED" | "UNSUITABLE" | "CURRENT"

export interface ResourceOption {
  rank: number | null
  current: boolean
  state: OptionState
  reason: string | null
}

export interface AllocationOptions {
  kind: "FIXTURE" | "TRAINING"
  id: string
  title: string
  date: string
  kickoff: string | null
  canManage: boolean
  window: PitchWindow
  roomWindow: { homeFrom: string; awayFrom: string; until: string; turnaroundUntil: string } | null
  footprint: "quarter" | "half" | "full" | null
  current: { venueId: string | null; pitchId: string | null; homeRoomId: string | null; awayRoomId: string | null; officialsRoomId: string | null; noChangingRooms: boolean }
  locks: AllocationPart[]
  autoAllocated: AllocationPart[]
  preferences: { venue: string[]; pitch: string[]; homeRoom: string[]; awayRoom: string[]; officialsRoom: string[] }
  venues: { id: string; name: string; current: boolean; rank: number | null; teamRoomsNeeded: number }[]
  pitches: ({ id: string; venueId: string; name: string; size: ArenaPitch["size"]; lanes: number } & ResourceOption)[]
  rooms: { id: string; venueId: string; name: string; roomType: ArenaRoom["roomType"]; home: ResourceOption; away: ResourceOption; officials: ResourceOption }[]
}

/** Where an activity is, or is to be: the parts Arena allocates. */
export interface AllocationSet {
  venueId: string | null
  pitchId: string | null
  homeRoomId: string | null
  awayRoomId: string | null
  officialsRoomId: string | null
  /** Only for a fixture that had no kick-off: the time automatic allocation proposes ("HH:MM"). */
  kickoff?: string | null
}

export type PreviewOutcome = "FIRST_PREFERENCE" | "ALTERNATIVE" | "NO_PREFERENCE" | "UNRESOLVED" | "UNCHANGED"

export interface PreviewItem {
  kind: "FIXTURE" | "TRAINING"
  id: string
  title: string
  teamId: string | null
  window: string
  current: AllocationSet
  proposed: AllocationSet
  changes: ("VENUE" | "PITCH" | "ROOMS" | "KICKOFF")[]
  pitchOutcome: "FIRST_PREFERENCE" | "ALTERNATIVE" | "AVAILABLE" | "UNRESOLVED" | "KEPT"
  roomsOutcome: "FIRST_PREFERENCE" | "ALTERNATIVE" | "AVAILABLE" | "UNRESOLVED" | null
  outcome: PreviewOutcome
  explanation: string[]
}

export interface AllocationPreview {
  date: string
  venueId: string | null
  rerun: boolean
  items: PreviewItem[]
  summary: {
    firstPreferences: number
    alternatives: number
    noPreference: number
    unresolved: number
    unchanged: number
    pitchChanges: number
    kickoffProposals: number
    roomChanges: number
    venueChanges: number
  }
}

/**
 * One change Apply makes: what it expects to find (so nobody's change is applied over) and what to set. For a
 * training session, `kickoff` is its start time (moved through the Training Centre's writer) and `homeRoomId`
 * its changing room.
 */
export interface ArenaChange {
  kind: "FIXTURE" | "TRAINING"
  id: string
  expected?: Partial<AllocationSet> & { kickoff?: string | null }
  set: Partial<AllocationSet>
  /**
   * Whose decision this one change is, when a plan holds both (a person's moves alongside Auto Allocate's
   * proposals, saved as one transaction). Without it the plan's own source applies. A lock still binds an
   * AUTO change wherever it sits.
   */
  source?: "MANUAL" | "AUTO"
}

export type PreferencePurpose = "VENUE" | "MATCH_PITCH" | "TRAINING_PITCH" | "HOME_ROOM" | "AWAY_ROOM" | "OFFICIALS_ROOM"

export interface ArenaPreferences {
  canManage: boolean
  venues: { id: string; name: string; isDefault: boolean }[]
  pitches: { id: string; venueId: string; name: string; size: ArenaPitch["size"]; layout: ArenaPitch["layout"] }[]
  rooms: { id: string; venueId: string; name: string; roomType: ArenaRoom["roomType"] }[]
  clubDefault: Partial<Record<PreferencePurpose, string[]>>
  teams: { team: ArenaTeam; preferences: Partial<Record<PreferencePurpose, string[]>> }[]
}
