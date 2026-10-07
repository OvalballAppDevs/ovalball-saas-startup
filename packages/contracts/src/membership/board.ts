import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * ONE MEMBERSHIP STANDING, READ BY EVERY VIEW (20270746000000; docs/architecture/club-management-domain.md 5-7).
 *
 * Whether somebody is up to date with the club is decided ONCE, on the server, by
 * `internal.membership_standing`, from the canonical records -- this month's obligation, the enrolment and
 * its responsible payer, the Direct Debit and its collection. This module never re-derives it: it carries the
 * server's answer and gives it the same words on the web and on the phone, so the two can never disagree
 * about whether somebody is "paid", "due" or "overdue".
 *
 * Two readers, one standing. The CLUB board (`finance.subscription.view` at the club) carries amounts, the
 * responsible payer and the month's money. The TEAM board (`finance.subscription.view` at the team: a Team
 * Manager) carries the same standing for that team's own players and nothing else -- no payer, no Direct
 * Debit, no money totals. The server decides which shape a caller gets; nothing is hidden in a component.
 */

export type MembershipStanding = "UP_TO_DATE" | "COLLECTING" | "DUE" | "OVERDUE" | "ACTION_NEEDED" | "NOT_SET_UP" | "EXEMPT" | "ENDED"

export type MembershipReason =
  | "PAID"
  | "WITH_THE_BANK"
  | "RETRYING"
  | "SCHEDULED"
  | "SETUP_UNFINISHED"
  /** A Direct Debit is in place, but the payer never started the membership, so nothing will be collected. */
  | "NOT_STARTED"
  | "NOT_COLLECTED"
  | "PAYMENT_FAILED"
  | "CHARGED_BACK"
  | "PAYMENT_CANCELLED"
  | "MANDATE_PROBLEM"
  | "LEFT_THE_TEAM"
  | "PAYER_NOT_GUARDIAN"
  | "NO_PAYER"
  | "EXEMPT"
  | "WAIVED"
  | "REFUNDED"
  | "NOTHING_TO_PAY"
  | "ENDED"

/** The order a person works through them: what needs somebody first. */
export const STANDING_ORDER: MembershipStanding[] = ["ACTION_NEEDED", "OVERDUE", "NOT_SET_UP", "DUE", "COLLECTING", "UP_TO_DATE", "EXEMPT", "ENDED"]

/** A status, so UK sentence case (content standard rule 2). */
export const STANDING_LABEL: Record<MembershipStanding, string> = {
  UP_TO_DATE: "Up to date",
  COLLECTING: "Collecting",
  DUE: "Due",
  OVERDUE: "Overdue",
  // The brief's own name for this state. "Needs attention" was also the board's word for everybody with
  // something to do, so one label meant two different sets on the same screen.
  ACTION_NEEDED: "Action needed",
  NOT_SET_UP: "Not set up",
  EXEMPT: "Exempt",
  ENDED: "Ended",
}

/**
 * The visual weight of a standing, by meaning -- never red everywhere. Forest/pitch for settled, mint for
 * money on its way, neutral for an ordinary month not yet paid, amber where somebody should look soon, red
 * only where something has gone wrong.
 */
export type StandingTone = "settled" | "moving" | "neutral" | "attention" | "problem" | "quiet"

export const STANDING_TONE: Record<MembershipStanding, StandingTone> = {
  UP_TO_DATE: "settled",
  COLLECTING: "moving",
  DUE: "neutral",
  OVERDUE: "attention",
  NOT_SET_UP: "attention",
  ACTION_NEEDED: "problem",
  EXEMPT: "quiet",
  ENDED: "quiet",
}

/** One plain sentence about a row's reason, for the person reading the board. Body copy: sentence case. */
export function reasonSentence(reason: MembershipReason, viewer: "club" | "team" = "club"): string {
  switch (reason) {
    case "PAID":
      return "This month is paid."
    case "WITH_THE_BANK":
      return "This month's payment is with the bank."
    case "RETRYING":
      return "This month's payment is being tried again."
    case "SCHEDULED":
      return "The Direct Debit will collect this month on the collection day."
    case "SETUP_UNFINISHED":
      return "The payer hasn't finished setting up the Direct Debit."
    case "NOT_STARTED":
      return "The Direct Debit is in place, but the payer hasn't started the membership, so nothing is being collected."
    case "NOT_COLLECTED":
      return "The Direct Debit is in place, but this month hasn't been collected."
    case "PAYMENT_FAILED":
      return "This month's payment didn't go through."
    case "CHARGED_BACK":
      return "This month's payment was reclaimed through the bank."
    case "PAYMENT_CANCELLED":
      return "This month's payment was cancelled before it was collected."
    case "MANDATE_PROBLEM":
      return "The Direct Debit was cancelled or has stopped working."
    case "LEFT_THE_TEAM":
      return viewer === "club" ? "Still enrolled, but no longer in any team. End the membership or place them in a team." : "Still enrolled, but no longer in a team."
    case "PAYER_NOT_GUARDIAN":
      return "The person paying is no longer this player's guardian."
    case "NO_PAYER":
      return "Nobody has set up this membership yet."
    case "EXEMPT":
      return "The club exempted this month."
    case "WAIVED":
      return "The club waived this month."
    case "REFUNDED":
      return "This month was refunded."
    case "NOTHING_TO_PAY":
      return "Nothing to pay this month."
    case "ENDED":
      return "The membership has ended."
  }
}

/**
 * The same reason in a few words, for a dense row beside its status chip ("Payment failed", "Not started").
 * A status, so sentence case. The full sentence (reasonSentence) belongs on the member's own page.
 */
export function reasonShort(reason: MembershipReason, viewer: "club" | "team" = "club"): string {
  // A team's staff see whether a player is sorted, not the family's or the club's private business: who pays, a
  // bank's chargeback, or a payer who is no longer the guardian (decision #2's least privilege, in words too).
  if (viewer === "team") {
    if (reason === "CHARGED_BACK") return "Payment returned"
    if (reason === "PAYER_NOT_GUARDIAN" || reason === "LEFT_THE_TEAM") return "For the club to sort out"
  }
  switch (reason) {
    case "PAID":
      return "Paid this month"
    case "WITH_THE_BANK":
      return "With the bank"
    case "RETRYING":
      return "Being tried again"
    case "SCHEDULED":
      return "Direct Debit set up"
    case "SETUP_UNFINISHED":
      return "Direct Debit not finished"
    case "NOT_STARTED":
      return "Membership not started"
    case "NOT_COLLECTED":
      return "Not collected yet"
    case "PAYMENT_FAILED":
      return "Payment failed"
    case "CHARGED_BACK":
      return "Payment reclaimed"
    case "PAYMENT_CANCELLED":
      return "Payment cancelled"
    case "MANDATE_PROBLEM":
      return "Direct Debit stopped"
    case "LEFT_THE_TEAM":
      return "No longer in a team"
    case "PAYER_NOT_GUARDIAN":
      return "Payer is not a guardian"
    case "NO_PAYER":
      return "No Direct Debit set up"
    case "EXEMPT":
      return "Exempt this month"
    case "WAIVED":
      return "Waived this month"
    case "REFUNDED":
      return "Refunded"
    case "NOTHING_TO_PAY":
      return "Nothing to pay"
    case "ENDED":
      return "Ended"
  }
}

/**
 * A MONTH'S RECORD (membership_obligations.status) in the standing's own tones, so a month and a member never read in
 * different colours: money on its way is "moving", late is "attention", red only where a payment failed or was taken
 * back. Both clients draw month chips from this.
 */
export const MONTH_STATUS_TONE: Record<string, StandingTone> = {
  PAID: "settled",
  SUBMITTED: "moving",
  SCHEDULED: "moving",
  READY: "moving",
  RETRYING: "moving",
  SETUP_PENDING: "neutral",
  OVERDUE: "attention",
  FAILED: "problem",
  CHARGEDBACK: "problem",
  EXEMPT: "quiet",
  WAIVED: "quiet",
  CANCELLED: "quiet",
  REFUNDED: "quiet",
}

export interface MembershipTeamRef {
  id: string
  name: string
  ageGroup: string | null
}

/** One of the club's memberships, as a player holds it or would hold it. */
export interface MembershipRef {
  id: string
  name: string
}

export interface MembershipRow {
  playerId: string
  firstName: string
  surname: string
  standing: MembershipStanding
  reason: MembershipReason
  /** The membership the player holds, or would hold from their team. Null when no membership covers them. */
  membership: MembershipRef | null
  lastRemindedAt: string | null
  /** The name of whoever sent the last reminder. */
  lastRemindedBy: string | null
  /** The server's answer: this standing can be put to the payer, and nobody has been asked in the last 72 hours. */
  canRemind: boolean
  // ---- club board only: absent on a team's board, which carries no money (decision #2) -------------
  /** Minor units owed for this month, where there is an obligation. */
  amountDueMinor?: number | null
  teams?: MembershipTeamRef[]
  payer?: { userId: string; relationship: "guardian" | "self"; name: string | null } | null
  payerSubscriptionId?: string | null
  monthlyAmountMinor?: number | null
  obligationStatus?: string | null
  dueDate?: string | null
  mandateStatus?: string | null
  nextCollectionDate?: string | null
  /** A GoCardless collection exists for the membership (the payer pressed start). */
  collectionStarted?: boolean
}

export interface StandingCounts {
  total: number
  upToDate: number
  collecting: number
  due: number
  overdue: number
  actionNeeded: number
  notSetUp: number
  exempt: number
  ended?: number
  activeMemberships?: number
  /** Club board only: memberships whose Direct Debit is in place (active, or on its way to the bank). */
  directDebitInPlace?: number
}

/**
 * The month's money by the canonical definitions -- membership amounts, gross of GoCardless's own fee.
 * Collected is what GoCardless has confirmed, less refunds it has confirmed. Ovalball's fee is what it earned on
 * collected payments; `membersFeeMinor` is the part of it members paid on top (when the club chose that).
 * `clubReceivesMinor` is before GoCardless's own fee, which is only known once GoCardless pays the club out.
 */
export interface MembershipMoney {
  period: string
  currency: string
  expectedMinor: number
  collectedMinor: number
  collectingMinor: number
  outstandingMinor: number
  overdueMinor: number
  failedMinor: number
  refundedMinor: number
  waivedMinor: number
  ovalballFeeMinor: number
  membersFeeMinor: number
  /**
   * Ovalball's fee on payments that were later refunded. GoCardless's documentation does not say whether that fee
   * comes back, so it is neither counted as earned nor left in what the club receives.
   */
  feeOnRefundsMinor: number
  clubReceivesMinor: number
  nextCollectionMinor: number
}

/** One of the club's memberships on the board: today's price, how many teams it covers, how many hold it. */
export interface BoardMembership {
  id: string
  name: string
  priceMinor: number | null
  teams: number
  members: number
}

export interface ClubMembershipBoard {
  clubId: string
  teamId: string | null
  asOf: string
  programme: {
    id: string
    /** Taking new memberships. A paused club still has members paying. */
    enabled: boolean
    activatedAt: string | null
    collectionDay: number
    /** Only when the club has exactly one membership; with several there is no single price. */
    priceMinor: number | null
    currency: string
    feeBearer: "CLUB" | "PAYER" | null
    /** Ovalball's rate on new memberships, in basis points (250 = 2.5%); 0 until the club chooses who pays it. */
    feeBps: number
  } | null
  memberships: BoardMembership[]
  counts: StandingCounts
  money: MembershipMoney
  rows: MembershipRow[]
}

export interface TeamMembershipBoard {
  teamId: string
  teamName: string
  clubId: string
  asOf: string
  /** The club runs memberships (taking new ones, or paused with members still paying). */
  programmeEnabled: boolean
  takingNewMemberships: boolean
  counts: StandingCounts
  rows: MembershipRow[]
}

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : null)

function counts(raw: unknown): StandingCounts {
  const c = (raw ?? {}) as Raw
  return {
    total: num(c.total) ?? 0,
    upToDate: num(c.up_to_date) ?? 0,
    collecting: num(c.collecting) ?? 0,
    due: num(c.due) ?? 0,
    overdue: num(c.overdue) ?? 0,
    actionNeeded: num(c.action_needed) ?? 0,
    notSetUp: num(c.not_set_up) ?? 0,
    exempt: num(c.exempt) ?? 0,
    ended: num(c.ended) ?? undefined,
    activeMemberships: num(c.active_memberships) ?? undefined,
    directDebitInPlace: num(c.direct_debit_in_place) ?? undefined,
  }
}

function membershipRef(raw: unknown): MembershipRef | null {
  const m = raw as Raw | null
  return m && typeof m.id === "string" ? { id: m.id, name: str(m.name) ?? "" } : null
}

function row(raw: Raw): MembershipRow {
  const out: MembershipRow = {
    playerId: String(raw.player_id),
    firstName: str(raw.first_name) ?? "",
    surname: str(raw.surname) ?? "",
    standing: raw.standing as MembershipStanding,
    reason: raw.reason as MembershipReason,
    membership: membershipRef(raw.membership),
    lastRemindedAt: str(raw.last_reminded_at),
    lastRemindedBy: str(raw.last_reminded_by),
    canRemind: raw.can_remind === true,
  }
  // The club's board carries money and the payer; a team's board never does, so nothing is invented for it.
  if ("teams" in raw) {
    out.amountDueMinor = num(raw.amount_due_minor)
    out.teams = ((raw.teams as Raw[] | null) ?? []).map((t) => ({ id: String(t.id), name: str(t.name) ?? "", ageGroup: str(t.age_group) }))
    const payer = raw.payer as Raw | null
    out.payer = payer ? { userId: String(payer.user_id), relationship: payer.relationship === "self" ? "self" : "guardian", name: str(payer.name) } : null
    out.payerSubscriptionId = str(raw.payer_subscription_id)
    out.monthlyAmountMinor = num(raw.monthly_amount_minor)
    out.obligationStatus = str(raw.obligation_status)
    out.dueDate = str(raw.due_date)
    out.mandateStatus = str(raw.mandate_status)
    out.nextCollectionDate = str(raw.next_collection_date)
    out.collectionStarted = raw.collection_started === true
  }
  return out
}

/** Pure: the club board's JSON as both clients read it. */
export function parseClubMembershipBoard(raw: unknown): ClubMembershipBoard {
  const b = (raw ?? {}) as Raw
  const m = (b.money ?? {}) as Raw
  const p = b.programme as Raw | null
  return {
    clubId: String(b.club_id),
    teamId: str(b.team_id),
    asOf: str(b.as_of) ?? "",
    programme: p
      ? {
          id: String(p.id),
          enabled: p.enabled === true,
          activatedAt: str(p.activated_at),
          collectionDay: num(p.collection_day) ?? 1,
          priceMinor: num(p.price_minor),
          currency: str(p.currency) ?? "GBP",
          feeBearer: p.fee_bearer === "CLUB" || p.fee_bearer === "PAYER" ? p.fee_bearer : null,
          feeBps: num(p.fee_bps) ?? 0,
        }
      : null,
    memberships: ((b.memberships as Raw[] | null) ?? []).map((m) => ({
      id: String(m.id),
      name: str(m.name) ?? "",
      priceMinor: num(m.price_minor),
      teams: num(m.teams) ?? 0,
      members: num(m.members) ?? 0,
    })),
    counts: counts(b.counts),
    money: {
      period: str(m.period) ?? "",
      currency: str(m.currency) ?? "GBP",
      expectedMinor: num(m.expected_minor) ?? 0,
      collectedMinor: num(m.collected_minor) ?? 0,
      collectingMinor: num(m.collecting_minor) ?? 0,
      outstandingMinor: num(m.outstanding_minor) ?? 0,
      overdueMinor: num(m.overdue_minor) ?? 0,
      failedMinor: num(m.failed_minor) ?? 0,
      refundedMinor: num(m.refunded_minor) ?? 0,
      waivedMinor: num(m.waived_minor) ?? 0,
      ovalballFeeMinor: num(m.ovalball_fee_minor) ?? 0,
      membersFeeMinor: num(m.members_fee_minor) ?? 0,
      feeOnRefundsMinor: num(m.fee_on_refunds_minor) ?? 0,
      clubReceivesMinor: num(m.club_receives_minor) ?? 0,
      nextCollectionMinor: num(m.next_collection_minor) ?? 0,
    },
    rows: ((b.rows as Raw[] | null) ?? []).map(row),
  }
}

/** Pure: a team board's JSON as both clients read it. */
export function parseTeamMembershipBoard(raw: unknown): TeamMembershipBoard {
  const b = (raw ?? {}) as Raw
  return {
    teamId: String(b.team_id),
    teamName: str(b.team_name) ?? "",
    clubId: String(b.club_id),
    asOf: str(b.as_of) ?? "",
    programmeEnabled: b.programme_enabled === true,
    takingNewMemberships: b.taking_new_memberships === true,
    counts: counts(b.counts),
    rows: ((b.rows as Raw[] | null) ?? []).map(row),
  }
}

/** Throws the server's refusal (42501) for anybody who may not see the club's memberships. */
export async function loadClubMembershipBoard(supabase: Client, clubId: string, teamId: string | null = null): Promise<ClubMembershipBoard> {
  const { data, error } = await supabase.rpc("club_membership_board", { p_club_id: clubId, p_team_id: teamId ?? undefined })
  if (error) throw error
  return parseClubMembershipBoard(data)
}

/** Throws the server's refusal (42501) for anybody who may not see this team's memberships. */
export async function loadTeamMembershipBoard(supabase: Client, teamId: string): Promise<TeamMembershipBoard> {
  const { data, error } = await supabase.rpc("team_membership_board", { p_team_id: teamId })
  if (error) throw error
  return parseTeamMembershipBoard(data)
}

export type ReminderSkipReason = "NOT_AT_CLUB" | "NOT_IN_TEAM" | "NOTHING_TO_ASK" | "RECENTLY_REMINDED" | "NOBODY_TO_ASK"

export interface ReminderResult {
  sent: number
  /** How many people were told. Never who: a team's staff never learn a payer's identity from this. */
  recipients: number
  skipped: { playerId: string; reason: ReminderSkipReason }[]
}

/**
 * Reminds each player's responsible payer (or, with nothing set up, their guardians -- never a child).
 * Pass `teamId` when acting as that team's staff: the server then allows only that team's players.
 */
export async function sendMembershipReminders(
  supabase: Client,
  input: { clubId: string; playerIds: string[]; teamId?: string | null }
): Promise<ReminderResult> {
  const { data, error } = await supabase.rpc("send_membership_reminders", {
    p_club_id: input.clubId,
    p_player_ids: input.playerIds,
    p_team_id: input.teamId ?? undefined,
  })
  if (error) throw error
  const r = (data ?? {}) as Raw
  return {
    sent: num(r.sent) ?? 0,
    recipients: num(r.recipients) ?? 0,
    skipped: ((r.skipped as Raw[] | null) ?? []).map((s) => ({ playerId: String(s.player_id), reason: s.reason as ReminderSkipReason })),
  }
}

export interface TeamAttentionResult {
  sent: number
  players: number
  /** Why nobody was told: nothing needs attention, or nobody on the team's staff can see its memberships. */
  reason: "NOTHING_NEEDS_ATTENTION" | "NOBODY_TO_TELL" | null
}

/** The club telling a team's staff how many of their players need attention (once a day per team). */
export async function sendTeamMembershipAttention(supabase: Client, teamId: string): Promise<TeamAttentionResult> {
  const { data, error } = await supabase.rpc("send_team_membership_attention", { p_team_id: teamId })
  if (error) throw error
  const r = (data ?? {}) as Raw
  const reason = r.reason === "NOTHING_NEEDS_ATTENTION" || r.reason === "NOBODY_TO_TELL" ? r.reason : null
  return { sent: num(r.sent) ?? 0, players: num(r.players) ?? 0, reason }
}

/** What telling a team's staff did, in a sentence -- including the case where there was nobody to tell. */
export function teamAttentionSentence(result: TeamAttentionResult): string {
  const players = result.players === 1 ? "1 player needs" : `${result.players} players need`
  if (result.sent > 0) return `The team's staff were told ${players} action.`
  if (result.players > 0) return `${players} action, but nobody on the team's staff can see memberships, so nobody was told.`
  return "Nothing needs the team's attention right now."
}

/** A plain sentence about what a reminder did, for the toast or the inline result. */
export function reminderOutcomeSentence(result: ReminderResult): string {
  const held = result.skipped.filter((s) => s.reason === "RECENTLY_REMINDED").length
  const parts: string[] = []
  if (result.sent === 1) parts.push("Reminder sent.")
  else if (result.sent > 1) parts.push(`${result.sent} reminders sent.`)
  else parts.push("No reminder sent.")
  if (held === 1) parts.push("1 was reminded in the last 3 days, so wasn't asked again.")
  else if (held > 1) parts.push(`${held} were reminded in the last 3 days, so weren't asked again.`)
  const nobody = result.skipped.filter((s) => s.reason === "NOBODY_TO_ASK").length
  if (nobody > 0) parts.push(nobody === 1 ? "1 has no adult the club can contact." : `${nobody} have no adult the club can contact.`)
  return parts.join(" ")
}

/** Rows grouped by standing, in working order; empty groups are left out. */
export function groupByStanding(rows: MembershipRow[]): { standing: MembershipStanding; rows: MembershipRow[] }[] {
  return STANDING_ORDER.map((standing) => ({ standing, rows: rows.filter((r) => r.standing === standing) })).filter((g) => g.rows.length > 0)
}

/** "18 players · 14 up to date · 2 collecting · 2 need attention" -- the Team Manager's one line. */
export function standingSummaryLine(c: StandingCounts): string {
  const needs = c.actionNeeded + c.overdue + c.notSetUp + c.due
  const parts = [`${c.total} ${c.total === 1 ? "player" : "players"}`, `${c.upToDate} up to date`]
  if (c.collecting > 0) parts.push(`${c.collecting} collecting`)
  if (needs > 0) parts.push(`${needs} ${needs === 1 ? "needs" : "need"} attention`)
  if (c.exempt > 0) parts.push(`${c.exempt} exempt`)
  return parts.join(" · ")
}

/** Minor units as a person reads them: 1250 -> "£12.50"; whole pounds without pence. */
export function formatMoneyMinor(amountMinor: number, currency = "GBP"): string {
  const whole = amountMinor % 100 === 0
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(whole ? 0 : 2)} ${currency}`
  }
}

/** When a row held back by the 72-hour rule can be reminded again ("6 Oct"), or null if it is not held. */
export function remindAgainOn(row: Pick<MembershipRow, "lastRemindedAt" | "canRemind" | "standing" | "reason">): string | null {
  if (row.canRemind || !row.lastRemindedAt) return null
  const askable = row.standing === "NOT_SET_UP" || row.standing === "DUE" || row.standing === "OVERDUE" ||
    (row.standing === "ACTION_NEEDED" && ["PAYMENT_FAILED", "CHARGED_BACK", "PAYMENT_CANCELLED", "MANDATE_PROBLEM"].includes(row.reason))
  if (!askable) return null
  const at = new Date(new Date(row.lastRemindedAt).getTime() + 72 * 60 * 60 * 1000)
  if (at.getTime() <= Date.now()) return null
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * Who a bulk reminder will NOT ask, and why -- so a board that says "7 need attention" next to "Send 4
 * Reminders" says where the other three went: reminded in the last three days, or the club's to sort out
 * (still enrolled after leaving every team; a payer who is no longer the guardian).
 */
export function reminderExclusions(rows: MembershipRow[]): { held: number; clubToSortOut: number } {
  let held = 0
  let clubToSortOut = 0
  for (const r of rows) {
    if (r.canRemind) continue
    if (r.reason === "LEFT_THE_TEAM" || r.reason === "PAYER_NOT_GUARDIAN") clubToSortOut += 1
    else if (remindAgainOn(r)) held += 1
  }
  return { held, clubToSortOut }
}

/** "3 not included: 2 reminded in the last 3 days, 1 for the club to sort out", or null. */
export function exclusionsSentence(x: { held: number; clubToSortOut: number }, viewer: "club" | "team" = "club"): string | null {
  const parts: string[] = []
  if (x.held > 0) parts.push(`${x.held} reminded in the last 3 days`)
  if (x.clubToSortOut > 0) parts.push(viewer === "club" ? `${x.clubToSortOut} for the club to sort out` : `${x.clubToSortOut} for the club`)
  if (parts.length === 0) return null
  return `${x.held + x.clubToSortOut} not included: ${parts.join(", ")}.`
}

/** The standings that are settled, so a long board can fold them away by default. */
export const SETTLED_STANDINGS: ReadonlySet<MembershipStanding> = new Set(["UP_TO_DATE", "EXEMPT", "ENDED"])

/**
 * The squad strip's cells, in working order, never losing a small standing: a large club is drawn at one cell
 * per few players, but every standing anybody is in keeps at least one cell. `per` is how many players a
 * cell stands for, so the page can say so.
 */
export function stripCells(c: StandingCounts, max = 120): { cells: MembershipStanding[]; per: number } {
  const n: Record<MembershipStanding, number> = {
    ACTION_NEEDED: c.actionNeeded,
    OVERDUE: c.overdue,
    NOT_SET_UP: c.notSetUp,
    DUE: c.due,
    COLLECTING: c.collecting,
    UP_TO_DATE: c.upToDate,
    EXEMPT: c.exempt,
    ENDED: 0,
  }
  const total = STANDING_ORDER.reduce((sum, s) => sum + n[s], 0)
  const per = Math.max(1, Math.ceil(total / max))
  const cells: MembershipStanding[] = []
  for (const s of STANDING_ORDER) {
    if (n[s] <= 0) continue
    const count = Math.max(1, Math.round(n[s] / per))
    for (let i = 0; i < count; i++) cells.push(s)
  }
  return { cells, per }
}

