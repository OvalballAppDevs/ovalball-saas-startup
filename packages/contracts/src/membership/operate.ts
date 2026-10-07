import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import {
  SETTLED_STANDINGS,
  STANDING_ORDER,
  type ClubMembershipBoard,
  type MembershipReason,
  type MembershipRow,
  type MembershipStanding,
  type MembershipTeamRef,
  type ReminderResult,
  type ReminderSkipReason,
  type StandingCounts,
} from "./board"

type Client = SupabaseClient<Database>

/**
 * RUNNING CLUB MEMBERSHIPS -- the views' shared arithmetic (Club Memberships Part 2, 20270753000000).
 *
 * Everything here is a pure reading of the server's board: which segment a row is in, what a filter keeps, how a
 * team is doing, who a reminder audience is, and what a reason means for the person reading it. The web and the
 * phone both call these, so they cannot count or word anything differently. Nothing here decides a standing --
 * that is `internal.membership_standing`'s alone.
 */

/** "Need action": somebody has something to do -- Action needed, Overdue, Not set up or Due, each counted once. */
export const NEEDS_ACTION: ReadonlySet<MembershipStanding> = new Set(["ACTION_NEEDED", "OVERDUE", "NOT_SET_UP", "DUE"])

/** The same, from a board's counts: what a team's home, the squad card and the club's overview all call "need action". */
export function needsActionCount(c: StandingCounts): number {
  return c.actionNeeded + c.overdue + c.notSetUp + c.due
}

export type MemberSegment = "all" | "up_to_date" | "needs_action"

export const MEMBER_SEGMENTS: { key: MemberSegment; label: string }[] = [
  { key: "all", label: "All" },
  { key: "up_to_date", label: "Up to Date" },
  { key: "needs_action", label: "Need Action" },
]

export function inSegment(row: Pick<MembershipRow, "standing">, segment: MemberSegment): boolean {
  if (segment === "all") return row.standing !== "ENDED"
  if (segment === "up_to_date") return row.standing === "UP_TO_DATE"
  return NEEDS_ACTION.has(row.standing)
}

export function segmentCounts(rows: Pick<MembershipRow, "standing">[]): Record<MemberSegment, number> {
  return {
    all: rows.filter((r) => inSegment(r, "all")).length,
    up_to_date: rows.filter((r) => inSegment(r, "up_to_date")).length,
    needs_action: rows.filter((r) => inSegment(r, "needs_action")).length,
  }
}

export interface MemberFilters {
  segment: MemberSegment
  teamId: string | null
  membershipId: string | null
  standing: MembershipStanding | null
  /** Matched against the player's name, case- and accent-insensitively. */
  query: string
}

export const NO_MEMBER_FILTERS: MemberFilters = { segment: "all", teamId: null, membershipId: null, standing: null, query: "" }

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

/** The rows a person asked for, in the server's working order. */
export function filterMembers(rows: MembershipRow[], f: MemberFilters): MembershipRow[] {
  const q = fold(f.query)
  return rows.filter((r) => {
    if (!inSegment(r, f.segment)) return false
    if (f.standing && r.standing !== f.standing) return false
    if (f.membershipId && r.membership?.id !== f.membershipId) return false
    if (f.teamId && !(r.teams ?? []).some((t) => t.id === f.teamId)) return false
    if (q && !fold(`${r.firstName} ${r.surname}`).includes(q)) return false
    return true
  })
}

/** How many filters beyond the segment are on, for a "Filters (2)" control. */
export function activeFilterCount(f: MemberFilters): number {
  return [f.teamId, f.membershipId, f.standing, f.query.trim() || null].filter(Boolean).length
}

/** Every team that appears on the board, youngest first, then by name. */
export function memberTeamOptions(rows: MembershipRow[]): MembershipTeamRef[] {
  const seen = new Map<string, MembershipTeamRef>()
  for (const r of rows) for (const t of r.teams ?? []) if (!seen.has(t.id)) seen.set(t.id, t)
  return [...seen.values()].sort((a, b) => ageRank(a.ageGroup) - ageRank(b.ageGroup) || a.name.localeCompare(b.name))
}

function ageRank(age: string | null): number {
  const m = age ? /^U(\d+)$/i.exec(age) : null
  return m ? Number(m[1]) : 99
}

export interface TeamStanding {
  team: MembershipTeamRef
  total: number
  upToDate: number
  collecting: number
  needsAction: number
  exempt: number
}

/**
 * Each team at a glance, from the club's own board (a player in two teams counts in both). Teams nobody in a
 * membership plays for do not appear: the board knows only the players memberships cover.
 */
export function teamBreakdown(board: Pick<ClubMembershipBoard, "rows">): TeamStanding[] {
  const out = new Map<string, TeamStanding>()
  for (const r of board.rows) {
    if (r.standing === "ENDED") continue
    for (const t of r.teams ?? []) {
      const s = out.get(t.id) ?? { team: t, total: 0, upToDate: 0, collecting: 0, needsAction: 0, exempt: 0 }
      s.total += 1
      if (r.standing === "UP_TO_DATE") s.upToDate += 1
      else if (r.standing === "COLLECTING") s.collecting += 1
      else if (r.standing === "EXEMPT") s.exempt += 1
      else if (NEEDS_ACTION.has(r.standing)) s.needsAction += 1
      out.set(t.id, s)
    }
  }
  return [...out.values()].sort((a, b) => ageRank(a.team.ageGroup) - ageRank(b.team.ageGroup) || a.team.name.localeCompare(b.team.name))
}

/** Rows grouped by standing in working order; settled groups (up to date, exempt, ended) are marked so a view can fold them. */
export function memberGroups(rows: MembershipRow[]): { standing: MembershipStanding; rows: MembershipRow[]; settled: boolean }[] {
  return STANDING_ORDER.map((standing) => ({ standing, rows: rows.filter((r) => r.standing === standing), settled: SETTLED_STANDINGS.has(standing) })).filter(
    (g) => g.rows.length > 0
  )
}

// ---- Reminder audiences (the Send Reminders screen) ---------------------------------------------------------

export type ReminderAudience =
  | { kind: "selected"; playerIds: string[] }
  | { kind: "team"; teamId: string }
  | { kind: "needs_action" }
  | { kind: "overdue" }

/**
 * Who an audience would remind: only rows the server says can be put to a payer now (`canRemind`). The server
 * re-checks every one; this only keeps the count on the button honest.
 */
export function audiencePlayerIds(rows: MembershipRow[], audience: ReminderAudience): string[] {
  const remindable = rows.filter((r) => r.canRemind)
  switch (audience.kind) {
    case "selected": {
      const chosen = new Set(audience.playerIds)
      return remindable.filter((r) => chosen.has(r.playerId)).map((r) => r.playerId)
    }
    case "team":
      return remindable.filter((r) => (r.teams ?? []).some((t) => t.id === audience.teamId)).map((r) => r.playerId)
    case "needs_action":
      return remindable.filter((r) => NEEDS_ACTION.has(r.standing)).map((r) => r.playerId)
    case "overdue":
      return remindable.filter((r) => r.standing === "OVERDUE").map((r) => r.playerId)
  }
}

/** The button's words: "Send Reminder", "Send 3 Reminders". A button, so Title Case. */
export function sendRemindersLabel(n: number): string {
  return n === 1 ? "Send Reminder" : `Send ${n} Reminders`
}

// ---- What a reason means for the person reading it (brief section 30) ---------------------------------------

export type GuidanceAction = "remind" | "change_payer" | "end_or_place" | "none"

export interface StandingGuidance {
  /** A status, so sentence case: "No Direct Debit set up". */
  title: string
  /** What happened, whether anything happens on its own, and who needs to act. Body copy. */
  body: string
  /** The one thing to do about it, if anything. The server still decides whether the reader may. */
  action: GuidanceAction
  tone: "settled" | "moving" | "neutral" | "attention" | "problem" | "quiet"
}

/**
 * The reason, turned into what a person needs to know: does it sort itself out, does the payer need to act, does
 * the club. Never a provider error code. A team's staff are told what the club will handle rather than offered it.
 */
export function standingGuidance(reason: MembershipReason, viewer: "club" | "team" = "club"): StandingGuidance {
  switch (reason) {
    case "PAID":
      return { title: "Paid this month", body: "This month's payment has been collected. Nothing to do.", action: "none", tone: "settled" }
    case "WITH_THE_BANK":
      return { title: "With the bank", body: "This month's payment is on its way. It shows as paid once GoCardless confirms the bank has paid it. Nothing to do.", action: "none", tone: "moving" }
    case "RETRYING":
      return { title: "Being tried again", body: "This month's payment didn't go through the first time and is being tried again. Nothing to do unless it fails again.", action: "none", tone: "moving" }
    case "SCHEDULED":
      return { title: "Direct Debit set up", body: "The Direct Debit collects this month on the collection day. Nothing to do.", action: "none", tone: "moving" }
    case "SETUP_UNFINISHED":
      return { title: "Direct Debit not finished", body: "The payer started setting up the Direct Debit but didn't finish, so nothing can be collected. A reminder asks them to finish it.", action: "remind", tone: "neutral" }
    case "NOT_STARTED":
      return { title: "Membership not started", body: "The Direct Debit is in place, but the payer hasn't started the membership, so nothing is being collected. A reminder asks them to start it.", action: "remind", tone: "neutral" }
    case "NOT_COLLECTED":
      return viewer === "club"
        ? { title: "Not collected yet", body: "The Direct Debit is running, but this month hasn't been collected. Check the payments below, and remind the payer to check their Direct Debit.", action: "remind", tone: "attention" }
        : { title: "Not collected yet", body: "The Direct Debit is running, but this month hasn't been collected yet. A reminder asks the family to check their Direct Debit.", action: "remind", tone: "attention" }
    case "PAYMENT_FAILED":
      return viewer === "club"
        ? { title: "Payment failed", body: "The bank didn't pay this month's Direct Debit. Ovalball doesn't try it again on its own: ask the payer to check their bank account, then retry the payment.", action: "remind", tone: "problem" }
        : { title: "Payment failed", body: "The bank didn't pay this month's Direct Debit. A reminder asks the family to check their bank account; the club can then try the payment again.", action: "remind", tone: "problem" }
    case "CHARGED_BACK":
      return viewer === "club"
        ? { title: "Payment reclaimed", body: "The payer's bank returned this month's payment at their request. Talk to the family before collecting it again.", action: "remind", tone: "problem" }
        : { title: "Payment returned", body: "This month's payment was returned by the bank. The club will talk to the family about it.", action: "none", tone: "problem" }
    case "PAYMENT_CANCELLED":
      return { title: "Payment cancelled", body: "This month's payment was cancelled before it was collected. A reminder asks the payer to check their Direct Debit.", action: "remind", tone: "problem" }
    case "MANDATE_PROBLEM":
      return { title: "Direct Debit stopped", body: "The Direct Debit was cancelled, expired or blocked, so nothing more can be collected. The payer needs to set up a new one.", action: "remind", tone: "problem" }
    case "LEFT_THE_TEAM":
      return viewer === "club"
        ? { title: "No longer in a team", body: "Still enrolled, but no longer in any of the club's teams, so the membership would keep being charged. End the membership, or place them in a team.", action: "end_or_place", tone: "problem" }
        : { title: "No longer in a team", body: "Still enrolled, but no longer in a team. The club will sort this out.", action: "none", tone: "problem" }
    case "PAYER_NOT_GUARDIAN":
      return viewer === "club"
        ? { title: "Payer is not a guardian", body: "The person paying is no longer recorded as this player's guardian. Change who pays, or correct the guardian record in People.", action: "change_payer", tone: "problem" }
        : { title: "For the club to sort out", body: "Something about how this membership is paid needs the club's attention. The club will sort this out.", action: "none", tone: "problem" }
    case "NO_PAYER":
      return { title: "No Direct Debit set up", body: "Nobody has set up this membership yet. A reminder asks the family to set it up.", action: "remind", tone: "attention" }
    case "EXEMPT":
      return { title: "Exempt this month", body: "The club exempted this month. Nothing to pay.", action: "none", tone: "quiet" }
    case "WAIVED":
      return { title: "Waived this month", body: "The club waived this month. Nothing to pay.", action: "none", tone: "quiet" }
    case "REFUNDED":
      return { title: "Refunded", body: "This month was refunded.", action: "none", tone: "quiet" }
    case "NOTHING_TO_PAY":
      return { title: "Nothing to pay", body: "Nothing is owed this month.", action: "none", tone: "quiet" }
    case "ENDED":
      return { title: "Membership ended", body: "This membership has ended. Nothing more is collected.", action: "none", tone: "quiet" }
  }
}

// ---- Reminders: preview and send in batches ------------------------------------------------------------------

/** Which message a family gets, by what is theirs to do (internal.membership_reminder_variant). */
export type ReminderVariant = "SET_UP" | "START" | "NOT_COLLECTED" | "DUE" | "OVERDUE" | "ATTENTION"

export interface ReminderExample {
  playerId: string
  firstName: string
  title: string
  body: string
}

export interface ReminderPreview {
  willSend: number
  skipped: { playerId: string; reason: ReminderSkipReason }[]
  /** One family's message exactly as they would receive it, or null when nobody would be asked. */
  example: ReminderExample | null
  /**
   * One message per situation in the audience, most families first, each with how many get it: an audience mixes
   * situations and each family gets the words for its own, so showing one example would misdescribe the rest.
   */
  examples: (ReminderExample & { variant: ReminderVariant; count: number })[]
}

/** Who a reminder reaches, said once beside the messages (send_membership_reminders' recipient rule). */
export const REMINDER_RECIPIENTS_EXPLAINED =
  "Each family gets the message for their child's situation, with their child's name. It goes to whoever pays. If nobody pays yet, it goes to the player's guardians, or to the player if they're an adult. Never to a child."

/** The preview's messages, most families first. An older server's single example is the one message every family gets. */
export function reminderMessages(preview: ReminderPreview): (ReminderExample & { variant: ReminderVariant | "ONE"; count: number })[] {
  if (preview.examples.length > 0) return preview.examples
  return preview.example ? [{ ...preview.example, variant: "ONE", count: preview.willSend }] : []
}

/** "1 family gets this:" / "3 families get this:" */
export function familiesGetThis(count: number): string {
  return count === 1 ? "1 family gets this:" : `${count} families get this:`
}

type Raw = Record<string, unknown>

function parseExample(e: Raw): ReminderExample {
  return { playerId: String(e.player_id), firstName: String(e.first_name ?? ""), title: String(e.title ?? ""), body: String(e.body ?? "") }
}

/** Pure: the preview's JSON. */
export function parseReminderPreview(raw: unknown): ReminderPreview {
  const r = (raw ?? {}) as Raw
  const e = r.example as Raw | null
  return {
    willSend: typeof r.will_send === "number" ? r.will_send : 0,
    skipped: ((r.skipped as Raw[] | null) ?? []).map((s) => ({ playerId: String(s.player_id), reason: s.reason as ReminderSkipReason })),
    example: e ? parseExample(e) : null,
    examples: ((r.examples as Raw[] | null) ?? []).map((x) => ({
      ...parseExample(x),
      variant: x.variant as ReminderVariant,
      count: typeof x.count === "number" ? x.count : 0,
    })),
  }
}

/** What a reminder would do, with exactly the sending rule; records nothing. Pass `teamId` as that team's staff. */
export async function previewMembershipReminders(supabase: Client, input: { clubId: string; playerIds: string[]; teamId?: string | null }): Promise<ReminderPreview> {
  const { data, error } = await supabase.rpc("membership_reminder_preview", {
    p_club_id: input.clubId,
    p_player_ids: input.playerIds,
    p_team_id: input.teamId ?? undefined,
  })
  if (error) throw error
  return parseReminderPreview(data)
}

/** The server sends at most this many per call (send_membership_reminders). */
export const REMINDER_BATCH = 50

/**
 * Sends a large audience in the server's batches, one after another, adding the results up. A refusal part-way
 * (the 100-a-day limit, say) stops there and is returned beside what was already sent -- nothing is retried, so
 * a family is never asked twice.
 */
export async function sendRemindersInBatches(
  send: (playerIds: string[]) => Promise<ReminderResult>,
  playerIds: string[]
): Promise<{ result: ReminderResult; error: unknown | null }> {
  const total: ReminderResult = { sent: 0, recipients: 0, skipped: [] }
  const unique = [...new Set(playerIds)]
  for (let i = 0; i < unique.length; i += REMINDER_BATCH) {
    try {
      const r = await send(unique.slice(i, i + REMINDER_BATCH))
      total.sent += r.sent
      total.recipients += r.recipients
      total.skipped.push(...r.skipped)
    } catch (error) {
      return { result: total, error }
    }
  }
  return { result: total, error: null }
}
