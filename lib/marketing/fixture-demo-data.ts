/**
 * Marketing-only mock data for the homepage's interactive product demos.
 * Never touches Supabase -- this exists purely to let a visitor feel the
 * product's own interaction model (team switching, fixture workflow,
 * club-to-club messaging) without a real account or real data.
 */
export type FixtureWorkflowStatus = "planned" | "request-sent" | "awaiting-club" | "confirmed"

export interface DemoFixture {
  id: string
  opponent: string
  venue: "Home" | "Away"
  date: string
  kickoff: string
  status: FixtureWorkflowStatus
}

export interface DemoTeam {
  id: string
  label: string
  fixtures: DemoFixture[]
}

export const DEMO_TEAMS: DemoTeam[] = [
  {
    id: "mens-1st",
    label: "Men's 1st",
    fixtures: [
      { id: "m1-1", opponent: "Guildford RFC", venue: "Home", date: "Sat 12 Sep", kickoff: "15:00", status: "confirmed" },
      { id: "m1-2", opponent: "Camberley RFC", venue: "Away", date: "Sat 19 Sep", kickoff: "14:30", status: "planned" },
      { id: "m1-3", opponent: "Redhill RFC", venue: "Home", date: "Sat 26 Sep", kickoff: "15:00", status: "confirmed" },
    ],
  },
  {
    id: "mens-2nd",
    label: "Men's 2nd",
    fixtures: [
      { id: "m2-1", opponent: "Guildford RFC 2nd XV", venue: "Home", date: "Sat 12 Sep", kickoff: "13:00", status: "confirmed" },
      { id: "m2-2", opponent: "Woking RFC 2nd XV", venue: "Away", date: "Sat 19 Sep", kickoff: "14:00", status: "planned" },
    ],
  },
  {
    id: "senior-colts",
    label: "Senior Colts",
    fixtures: [
      { id: "sc-1", opponent: "Farnham Colts", venue: "Away", date: "Sun 13 Sep", kickoff: "11:00", status: "planned" },
      { id: "sc-2", opponent: "Camberley Colts", venue: "Home", date: "Sun 20 Sep", kickoff: "11:00", status: "confirmed" },
    ],
  },
  {
    id: "junior-colts",
    label: "Junior Colts",
    // Deliberately "planned" (not "confirmed") -- every team needs at
    // least one non-confirmed fixture, or its tab loads with the workflow
    // demo already finished and nothing to interact with.
    fixtures: [
      { id: "jc-1", opponent: "Redhill Colts", venue: "Home", date: "Sun 13 Sep", kickoff: "10:30", status: "planned" },
    ],
  },
  {
    id: "u15a",
    label: "U15 A",
    fixtures: [
      { id: "u15a-1", opponent: "Guildford U15 A", venue: "Home", date: "Sun 13 Sep", kickoff: "10:00", status: "confirmed" },
      { id: "u15a-2", opponent: "Redhill U15 A", venue: "Away", date: "Sun 20 Sep", kickoff: "10:00", status: "planned" },
    ],
  },
  {
    id: "u15b",
    label: "U15 B",
    fixtures: [
      { id: "u15b-1", opponent: "Guildford U15 B", venue: "Home", date: "Sun 13 Sep", kickoff: "10:00", status: "planned" },
    ],
  },
]

export const WORKFLOW_STAGES: { status: FixtureWorkflowStatus; label: string }[] = [
  { status: "planned", label: "Planned" },
  { status: "request-sent", label: "Request sent" },
  { status: "awaiting-club", label: "Awaiting club" },
  { status: "confirmed", label: "Confirmed" },
]

// --- Season calendar (Feature Story 2) ---

export interface SeasonFixture {
  team: string
  month: string
  opponent: string
  venue: "H" | "A"
  status: "planned" | "confirmed"
  isCup?: boolean
}

export const SEASON_TEAMS = ["Men's 1st", "Men's 2nd", "Senior Colts", "U15 A", "U15 B"] as const
export const SEASON_MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"] as const

export const SEASON_FIXTURES: SeasonFixture[] = [
  { team: "Men's 1st", month: "Sep", opponent: "Guildford", venue: "H", status: "confirmed" },
  { team: "Men's 1st", month: "Sep", opponent: "Camberley", venue: "A", status: "planned" },
  { team: "Men's 1st", month: "Oct", opponent: "Redhill", venue: "H", status: "confirmed" },
  { team: "Men's 1st", month: "Oct", opponent: "County Cup R1", venue: "A", status: "confirmed", isCup: true },
  { team: "Men's 1st", month: "Nov", opponent: "Woking", venue: "A", status: "planned" },
  { team: "Men's 1st", month: "Jan", opponent: "Farnham", venue: "H", status: "planned" },
  { team: "Men's 1st", month: "Feb", opponent: "County Cup R2", venue: "H", status: "planned", isCup: true },
  { team: "Men's 1st", month: "Mar", opponent: "Guildford", venue: "A", status: "planned" },

  { team: "Men's 2nd", month: "Sep", opponent: "Guildford 2nd", venue: "H", status: "confirmed" },
  { team: "Men's 2nd", month: "Oct", opponent: "Woking 2nd", venue: "A", status: "planned" },
  { team: "Men's 2nd", month: "Dec", opponent: "Redhill 2nd", venue: "H", status: "planned" },
  { team: "Men's 2nd", month: "Feb", opponent: "Camberley 2nd", venue: "A", status: "planned" },

  { team: "Senior Colts", month: "Sep", opponent: "Farnham Colts", venue: "A", status: "planned" },
  { team: "Senior Colts", month: "Sep", opponent: "Camberley Colts", venue: "H", status: "confirmed" },
  { team: "Senior Colts", month: "Nov", opponent: "Redhill Colts", venue: "A", status: "confirmed" },
  { team: "Senior Colts", month: "Jan", opponent: "Guildford Colts", venue: "H", status: "planned" },

  { team: "U15 A", month: "Sep", opponent: "Guildford U15 A", venue: "H", status: "confirmed" },
  { team: "U15 A", month: "Oct", opponent: "Redhill U15 A", venue: "A", status: "planned" },
  { team: "U15 A", month: "Nov", opponent: "Camberley U15 A", venue: "H", status: "planned" },
  { team: "U15 A", month: "Mar", opponent: "Woking U15 A", venue: "A", status: "planned" },

  { team: "U15 B", month: "Sep", opponent: "Guildford U15 B", venue: "H", status: "planned" },
  { team: "U15 B", month: "Dec", opponent: "Redhill U15 B", venue: "H", status: "planned" },
]

// --- Partner club conversation (Feature Story 3) ---

export interface ConversationMessage {
  from: "own" | "opponent"
  text: string
}

export const CONVERSATION_THREAD: ConversationMessage[] = [
  { from: "own", text: "Can you confirm kick-off at 11:00?" },
  { from: "opponent", text: "Confirmed. Pitch 2 allocated." },
  { from: "opponent", text: "Visitor guide attached." },
  { from: "own", text: "Great, see you Saturday." },
]
