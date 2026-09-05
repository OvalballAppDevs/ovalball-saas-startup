/**
 * The single synthetic fixture set behind every preview on /fixtures.
 *
 * There is deliberately ONE object per fixture rather than a separate
 * invented example per panel: the whole argument of that page is that a
 * fixture is one record that appears wherever it is needed, so the
 * Fixture Management list, the conversation, the calendar entry and the
 * pitch allocation all read from the same entry here. Changing the
 * selected fixture changes every panel, because that is exactly the
 * behaviour being described.
 *
 * STRICTLY SYNTHETIC. Every club name below was checked against the live
 * club directory and returns zero matches, so nothing here can be mistaken
 * for a real club, and no production fixture, message, player or guardian
 * record is referenced. Nothing on this page performs a server mutation.
 */

export interface DemoMessage {
  /** Which side of the conversation, by club short name. */
  from: string
  /** Whose column the message sits in when rendered. */
  side: "ours" | "theirs"
  text: string
}

export interface DemoJourneyFixture {
  id: string
  /** Our club's team, as a club admin would see it. */
  ourTeam: string
  /** The opposition team. */
  opponentTeam: string
  /** Short forms for tight UI (chips, calendar cells). */
  ourShort: string
  opponentShort: string
  homeOrAway: "Home" | "Away"
  /** Long form, e.g. "Saturday 19 September". */
  date: string
  /** Compact form for the calendar grid, e.g. "Sat 19". */
  shortDate: string
  /** Day-of-month for the calendar cell. */
  dayOfMonth: number
  kickoff: string
  venue: string
  pitch: string
  competition: string
  status: "Planned" | "Confirmed"
  messages: DemoMessage[]
  /** The window the ground needs to accommodate, including warm-up. */
  pitchWindow: string
}

export const DEMO_CLUB = "Northbridge RFC"

export const JOURNEY_FIXTURES: DemoJourneyFixture[] = [
  {
    id: "u14-westbrook",
    ourTeam: "Northbridge RFC U14",
    opponentTeam: "Westbrook RFC U14",
    ourShort: "Northbridge U14",
    opponentShort: "Westbrook U14",
    homeOrAway: "Home",
    date: "Saturday 19 September",
    shortDate: "Sat 19",
    dayOfMonth: 19,
    kickoff: "11:00",
    venue: "Riverside Ground",
    pitch: "Pitch 2",
    competition: "Friendly",
    status: "Confirmed",
    messages: [
      { from: "Northbridge U14", side: "ours", text: "11:00 works for us. We can host." },
      { from: "Westbrook U14", side: "theirs", text: "Perfect. We'll confirm with our coaches." },
      { from: "Northbridge U14", side: "ours", text: "Great — Pitch 2 is available. See you Saturday." },
    ],
    pitchWindow: "10:00 – 12:30",
  },
  {
    id: "u15-eastfield",
    ourTeam: "Northbridge RFC U15",
    opponentTeam: "Eastfield RFC U15",
    ourShort: "Northbridge U15",
    opponentShort: "Eastfield U15",
    homeOrAway: "Away",
    date: "Sunday 27 September",
    shortDate: "Sun 27",
    dayOfMonth: 27,
    kickoff: "13:30",
    venue: "Eastfield Park",
    pitch: "Pitch 1",
    competition: "League",
    status: "Confirmed",
    messages: [
      { from: "Eastfield U15", side: "theirs", text: "We can host on the 27th, 13:30 kick-off." },
      { from: "Northbridge U15", side: "ours", text: "That works. Any parking guidance for visitors?" },
      { from: "Eastfield U15", side: "theirs", text: "Main gate car park, it's signposted from the road." },
    ],
    pitchWindow: "Away — hosted by Eastfield RFC",
  },
  {
    id: "u13-westbrook",
    ourTeam: "Northbridge RFC U13",
    opponentTeam: "Westbrook RFC U13",
    ourShort: "Northbridge U13",
    opponentShort: "Westbrook U13",
    homeOrAway: "Home",
    date: "Saturday 26 September",
    shortDate: "Sat 26",
    dayOfMonth: 26,
    kickoff: "11:00",
    venue: "Riverside Ground",
    pitch: "Pitch 1",
    competition: "Friendly",
    status: "Planned",
    messages: [
      { from: "Northbridge U13", side: "ours", text: "We're looking for a friendly fixture on Saturday morning." },
    ],
    pitchWindow: "10:00 – 12:00",
  },
]

/** Non-fixture activity, so the calendar and pitch views aren't all matches. */
export interface DemoTrainingSlot {
  id: string
  label: string
  shortDate: string
  dayOfMonth: number
  time: string
  pitch: string
  pitchWindow: string
}

export const JOURNEY_TRAINING: DemoTrainingSlot[] = [
  {
    id: "u12-training",
    label: "U12 Training",
    shortDate: "Sun 20",
    dayOfMonth: 20,
    time: "10:00",
    pitch: "Pitch 2",
    pitchWindow: "11:00 – 12:00",
  },
]

/**
 * The stages a fixture moves through, as the walkthrough presents them.
 * These are presentational labels for the public page, not the fixture
 * status vocabulary of the application itself.
 */
export const JOURNEY_STAGES: { id: string; label: string; blurb: string }[] = [
  {
    id: "request",
    label: "Request",
    blurb:
      "A fixture starts against a real club and a real team, not a message with no shared context. Who is playing, roughly when, and where it would be held.",
  },
  {
    id: "discuss",
    label: "Discuss",
    blurb:
      "Kick-off, venue and anything still open get agreed in a conversation attached to the fixture itself — so it is still there when someone needs it in three weeks.",
  },
  {
    id: "confirm",
    label: "Confirm",
    blurb:
      "Both clubs agree the detail once. The fixture becomes the record both sides are working from, rather than two versions in two inboxes.",
  },
  {
    id: "schedule",
    label: "Schedule",
    blurb:
      "The agreed fixture appears in the calendars of the people it belongs to — their club, their team, their child's team.",
  },
  {
    id: "allocate",
    label: "Allocate",
    blurb:
      "For a home fixture, the people responsible for the ground can see what needs accommodating, and on which pitch.",
  },
  {
    id: "play",
    label: "Play",
    blurb:
      "Everyone arrives at the same ground, at the same time, expecting the same game. Afterwards the result belongs to the same record.",
  },
]

/** Compact September grid for the calendar preview: weeks of a real-shaped month. */
export const CALENDAR_WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const

/** September days laid out Monday-first; 0 marks a leading blank cell. */
export const CALENDAR_DAYS: number[] = [
  1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14,
  15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28,
]
