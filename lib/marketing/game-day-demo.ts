/**
 * Shared synthetic data for /game-management and /payment-services.
 *
 * One fictional club and one fictional family run through both pages, so
 * the public site reads as one product rather than two unrelated demos.
 *
 * STRICTLY SYNTHETIC. The club names carry the "Ovalball" prefix precisely
 * so they cannot be mistaken for, or collide with, a real club in the
 * directory. No production player, guardian, message, payment amount or
 * provider identifier appears anywhere in this file, and nothing here is
 * ever written back to a server.
 *
 * Vocabulary note: the availability statuses below are the CANONICAL ones
 * from public.player_fixture_attendance (ATTENDING / CANNOT_ATTEND /
 * UNSURE), and the payment statuses are the canonical membership-obligation
 * statuses with their real Club Finance labels. Neither is a second
 * marketing vocabulary invented for these pages.
 */

export const DEMO_CLUB = "Ovalball North RFC"
export const DEMO_OPPONENT = "Ovalball West RFC"

// --- Game Management ---------------------------------------------------

export const DEMO_FIXTURE = {
  team: "U14",
  ourTeam: `${DEMO_CLUB} U14`,
  opponentTeam: `${DEMO_OPPONENT} U14`,
  date: "Saturday 19 September",
  kickoff: "11:00",
  homeAway: "Home" as const,
  venue: "Riverside Ground",
  pitch: "Pitch 1",
  /** From the fixtures table's own status vocabulary. */
  status: "Booked" as const,
  squadSize: 27,
}

/**
 * The three responses a guardian, an eligible player, or team staff can
 * record. `id` matches the database value exactly; `label` is the wording
 * the product uses in front of a person.
 */
export const ATTENDANCE_OPTIONS = [
  { id: "ATTENDING", label: "Attending" },
  { id: "CANNOT_ATTEND", label: "Can't attend" },
  { id: "UNSURE", label: "Unsure" },
] as const

export type AttendanceStatus = (typeof ATTENDANCE_OPTIONS)[number]["id"]

/**
 * Baseline counts BEFORE the demo family responds. Charlie is deliberately
 * excluded and sits in "no response" until the visitor answers for him, so
 * the parent panel and the team panel are genuinely the same response seen
 * twice.
 */
export const BASELINE_COUNTS: Record<AttendanceStatus | "NO_RESPONSE", number> = {
  ATTENDING: 17,
  CANNOT_ATTEND: 3,
  UNSURE: 2,
  NO_RESPONSE: 5,
}

export interface DemoSquadMember {
  name: string
  status: AttendanceStatus | "NO_RESPONSE"
}

/** A short, obviously fictional roster sample -- first name plus initial. */
export const DEMO_SQUAD: DemoSquadMember[] = [
  { name: "Alex M.", status: "ATTENDING" },
  { name: "Jamie R.", status: "ATTENDING" },
  { name: "Sam T.", status: "UNSURE" },
  { name: "Taylor K.", status: "CANNOT_ATTEND" },
  { name: "Rowan P.", status: "ATTENDING" },
  { name: "Noor H.", status: "NO_RESPONSE" },
]

/** Position groups, for the squad-shape illustration. */
export const POSITION_GROUPS = [
  { label: "Front Row", needed: 3 },
  { label: "Second Row", needed: 2 },
  { label: "Back Row", needed: 3 },
  { label: "Half Backs", needed: 2 },
  { label: "Centres", needed: 2 },
  { label: "Back Three", needed: 3 },
]

/**
 * Participant-facing updates. Each corresponds to a change Ovalball
 * genuinely notifies on today -- pitch changes, kick-off changes and
 * fixture information -- rather than an invented announcements feature.
 */
export const DEMO_FIXTURE_UPDATES = [
  { text: "Pitch confirmed: Pitch 1.", meta: "Pitch updated" },
  { text: "Kick-off remains 11:00.", meta: "Kick-off confirmed" },
  { text: "Please arrive in club kit.", meta: "Team information" },
  { text: "Parking is available via the main clubhouse entrance.", meta: "Venue information" },
]

// --- Payment Services --------------------------------------------------

export const DEMO_PARENT = "Alex Morgan"

export interface DemoMember {
  player: string
  ageGroup: string
  membership: string
  monthly: string
  /** Canonical membership-obligation status. */
  status: "PAID" | "SCHEDULED" | "SUBMITTED" | "FAILED"
}

/**
 * The Morgan family, used on both pages: Charlie is the U14 player the
 * availability demo responds for, and both children appear here for the
 * family/sibling section.
 */
export const DEMO_FAMILY: DemoMember[] = [
  { player: "Charlie Morgan", ageGroup: "U14", membership: "Junior Membership", monthly: "£25", status: "PAID" },
  { player: "Sophie Morgan", ageGroup: "U9", membership: "Junior Membership", monthly: "£20", status: "PAID" },
]

/**
 * The real Club Finance labels for the membership-obligation statuses used
 * in the dashboard preview. These are copied from the application's own
 * OBLIGATION_STATUS_LABEL map, not paraphrased.
 */
export const OBLIGATION_LABELS: Record<string, string> = {
  PAID: "Paid",
  SCHEDULED: "Scheduled for collection",
  SUBMITTED: "Submitted to GoCardless",
  FAILED: "Failed",
  OVERDUE: "Overdue",
  EXEMPT: "Exempt",
  SETUP_PENDING: "Membership not yet set up",
}

export interface DemoFinanceRow {
  member: string
  ageGroup: string
  amount: string
  status: keyof typeof OBLIGATION_LABELS
}

export const DEMO_FINANCE_ROWS: DemoFinanceRow[] = [
  { member: "Charlie Morgan", ageGroup: "U14", amount: "£25.00", status: "PAID" },
  { member: "Sophie Morgan", ageGroup: "U9", amount: "£20.00", status: "PAID" },
  { member: "Jamie Rivers", ageGroup: "U14", amount: "£25.00", status: "SCHEDULED" },
  { member: "Sam Tolan", ageGroup: "U12", amount: "£25.00", status: "SUBMITTED" },
  { member: "Rowan Pike", ageGroup: "U16", amount: "£25.00", status: "FAILED" },
  { member: "Noor Haddad", ageGroup: "U9", amount: "£20.00", status: "EXEMPT" },
]

export const DEMO_FINANCE_SUMMARY = {
  activeMembers: 247,
  expectedThisMonth: "£6,175",
  collected: "£5,925",
  needsAttention: 10,
}

/** The member-facing setup journey, as stages rather than timings. */
export const MEMBERSHIP_JOURNEY = [
  {
    id: "join",
    label: "Join the club",
    body: "A player is added to the club and linked to their guardian, the same way any Ovalball player record is created.",
  },
  {
    id: "choose",
    label: "Choose membership",
    body: "The club's own membership options and prices are shown, including any family adjustment the club has configured.",
  },
  {
    id: "setup",
    label: "Set up payment",
    body: "The payer authorises a Direct Debit arrangement with GoCardless. Ovalball never sees or stores the bank details.",
  },
  {
    id: "active",
    label: "Membership active",
    body: "Once the arrangement is confirmed by the provider, the membership becomes active and future collections are scheduled.",
  },
]
