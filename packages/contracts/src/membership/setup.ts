import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { formatFinanceDate, formatMinorUnits, ordinalWord } from "../club/finance"
import { DIRECTORY_GROUPS, groupKeyFor, type DirectoryGroupKey } from "../teams/directory-taxonomy"

type Client = SupabaseClient<Database>

/**
 * CLUB MEMBERSHIPS SETUP -- ONE READ, ONE SET OF DOORS, ONE VOCABULARY (Club Memberships Part 1, 20270748000000).
 *
 * The website and the phone set a club up from the same server answer, `membership_setup_state`: the GoCardless
 * connection in GoCardless's own terms, the programme's settings, the club's memberships with their prices and
 * teams, who pays Ovalball's fee, the club's agreement to it, and what is still missing before memberships can be
 * switched on. Nothing here re-derives readiness; Activate re-derives it on the server whatever a screen showed.
 *
 * OWNER-LOCKED (6 October 2026): several memberships per club, assigned by team; monthly, continuous pricing;
 * Ovalball takes 2.5% of member payments and each club chooses who bears it. The rate comes from the server
 * (`fee_bps`), never from a constant here.
 */

export type ConnectionState = "NOT_CONNECTED" | "CHECKING" | "VERIFYING" | "ACTION_REQUIRED" | "READY" | "DISCONNECTED"
export type ProgrammeState = "NOT_STARTED" | "SETTING_UP" | "ACTIVE" | "PAUSED"
export type FeeBearer = "CLUB" | "PAYER"
export type SetupFirstPaymentPolicy = "PRORATE_CURRENT_MONTH" | "NEXT_COLLECTION_DAY"
export type ReadinessItem = "TERMS" | "CONNECT" | "VERIFY" | "FEE" | "MEMBERSHIP"

export interface MembershipTeam {
  id: string
  name: string
  /** The Team Directory's group (Minis, Juniors, Youth, Colts, Men's, Women's, Girls), from the team's identity. */
  group: DirectoryGroupKey
}

/** What a membership means in money for a new member, by the club's chosen fee arrangement (the server's figures). */
export interface MembershipPriceFigures {
  feeMinor: number
  membersPayMinor: number
  clubReceivesMinor: number
}

export interface SetupMembership {
  id: string
  name: string
  monthlyAmountMinor: number | null
  priceEffectiveFrom: string | null
  nextPrice: { amountMinor: number; effectiveFrom: string } | null
  /** Null until the membership has a price and the club has chosen who pays Ovalball's fee. */
  money: MembershipPriceFigures | null
  teams: MembershipTeam[]
  activeMemberships: number
}

export interface MembershipSetupState {
  clubId: string
  state: ProgrammeState
  canConfigure: boolean
  canConnect: boolean
  connection: {
    state: ConnectionState
    verification: string | null
    environment: "sandbox" | "production" | null
    connectedAt: string | null
    disconnectedAt: string | null
    checkedAt: string | null
  }
  programme: {
    id: string
    enabled: boolean
    activatedAt: string | null
    collectionDay: number
    firstPaymentPolicy: SetupFirstPaymentPolicy
    feeBearer: FeeBearer | null
    currency: string
  } | null
  feeBps: number
  terms: { version: string; accepted: boolean; acceptedAt: string | null; acceptedByName: string | null }
  memberships: SetupMembership[]
  teams: (MembershipTeam & { productId: string | null })[]
  readiness: { canActivate: boolean; missing: ReadinessItem[]; readyMemberships: number }
}

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null)
const bool = (v: unknown): boolean => v === true

/** A team as the server sends it, placed in the Team Directory's group by the one taxonomy. */
function team(x: Raw): MembershipTeam {
  return {
    id: String(x.id),
    name: String(x.name),
    group: groupKeyFor({ id: String(x.id), category: str(x.category) ?? "", ageGroup: str(x.age_group), gender: str(x.gender), squadDesignation: null, isActive: true, sortOrder: 0 }),
  }
}

/**
 * Teams in the Team Directory's groups and order (Minis, Juniors, Youth, Colts, Men's, Women's, Girls), each
 * group keeping the server's order within it. Empty groups are left out.
 */
export function groupTeams<T extends MembershipTeam>(teams: T[]): { key: DirectoryGroupKey; title: string; teams: T[] }[] {
  return DIRECTORY_GROUPS.map((g) => ({ key: g.key, title: g.title, teams: teams.filter((t) => t.group === g.key) })).filter((g) => g.teams.length > 0)
}

export function parseMembershipSetupState(raw: unknown): MembershipSetupState {
  const r = (raw ?? {}) as Raw
  const c = (r.connection ?? {}) as Raw
  const p = r.programme as Raw | null
  const t = (r.terms ?? {}) as Raw
  const rd = (r.readiness ?? {}) as Raw
  return {
    clubId: String(r.club_id),
    state: (str(r.state) ?? "NOT_STARTED") as ProgrammeState,
    canConfigure: bool(r.can_configure),
    canConnect: bool(r.can_connect),
    connection: {
      state: (str(c.state) ?? "NOT_CONNECTED") as ConnectionState,
      verification: str(c.verification),
      environment: (str(c.environment) as "sandbox" | "production" | null) ?? null,
      connectedAt: str(c.connected_at),
      disconnectedAt: str(c.disconnected_at),
      checkedAt: str(c.checked_at),
    },
    programme: p
      ? {
          id: String(p.id),
          enabled: bool(p.enabled),
          activatedAt: str(p.activated_at),
          collectionDay: num(p.collection_day) ?? 1,
          firstPaymentPolicy: (str(p.first_payment_policy) ?? "NEXT_COLLECTION_DAY") as SetupFirstPaymentPolicy,
          feeBearer: (str(p.fee_bearer) as FeeBearer | null) ?? null,
          currency: str(p.currency) ?? "GBP",
        }
      : null,
    feeBps: num(r.fee_bps) ?? 0,
    terms: { version: str(t.version) ?? "", accepted: bool(t.accepted), acceptedAt: str(t.accepted_at), acceptedByName: str(t.accepted_by_name) },
    memberships: ((r.memberships as Raw[] | null) ?? []).map((m) => {
      const next = m.next_price as Raw | null
      const money = m.money as Raw | null
      return {
        id: String(m.id),
        name: String(m.name),
        monthlyAmountMinor: num(m.monthly_amount_minor),
        priceEffectiveFrom: str(m.price_effective_from),
        nextPrice: next ? { amountMinor: num(next.amount_minor) ?? 0, effectiveFrom: String(next.effective_from) } : null,
        money: money
          ? { feeMinor: num(money.fee_minor) ?? 0, membersPayMinor: num(money.members_pay_minor) ?? 0, clubReceivesMinor: num(money.club_receives_minor) ?? 0 }
          : null,
        teams: ((m.teams as Raw[] | null) ?? []).map(team),
        activeMemberships: num(m.active_memberships) ?? 0,
      }
    }),
    teams: ((r.teams as Raw[] | null) ?? []).map((x) => ({ ...team(x), productId: str(x.product_id) })),
    readiness: {
      canActivate: bool(rd.can_activate),
      missing: ((rd.missing as string[] | null) ?? []) as ReadinessItem[],
      readyMemberships: num(rd.ready_memberships) ?? 0,
    },
  }
}

/** Throws the server's refusal (42501) for anybody who is not one of the club's finance holders. */
export async function loadMembershipSetup(supabase: Client, clubId: string): Promise<MembershipSetupState> {
  const { data, error } = await supabase.rpc("membership_setup_state", { p_club_id: clubId })
  if (error) throw error
  return parseMembershipSetupState(data)
}

// -----------------------------------------------------------------------------------------------------------------
// THE DOORS. Every one re-checks authority and validity on the server; each throws the server's sentence.
// -----------------------------------------------------------------------------------------------------------------

export async function acceptMembershipTerms(supabase: Client, clubId: string, version: string): Promise<void> {
  const { error } = await supabase.rpc("accept_club_membership_terms", { p_club_id: clubId, p_version: version })
  if (error) throw error
}

export async function saveMembershipSettings(
  supabase: Client,
  clubId: string,
  input: { collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }
): Promise<string> {
  const { data, error } = await supabase.rpc("save_membership_settings", {
    p_club_id: clubId,
    p_collection_day: input.collectionDay,
    p_first_payment_policy: input.firstPaymentPolicy,
    p_fee_bearer: input.feeBearer ?? undefined,
  })
  if (error) throw error
  return String(data)
}

export async function createMembership(supabase: Client, clubId: string, input: { name: string; monthlyAmountMinor: number; teamIds: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc("create_membership_product", {
    p_club_id: clubId,
    p_name: input.name,
    p_monthly_amount_minor: input.monthlyAmountMinor,
    p_team_ids: input.teamIds,
  })
  if (error) throw error
  return String(data)
}

export async function renameMembership(supabase: Client, productId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc("rename_membership_product", { p_product_id: productId, p_name: name })
  if (error) throw error
}

export async function setMembershipPrice(supabase: Client, productId: string, amountMinor: number, effectiveFrom: string): Promise<void> {
  const { error } = await supabase.rpc("set_membership_product_price", { p_product_id: productId, p_amount_minor: amountMinor, p_effective_from: effectiveFrom })
  if (error) throw error
}

export async function setMembershipTeams(supabase: Client, productId: string, teamIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("set_membership_product_teams", { p_product_id: productId, p_team_ids: teamIds })
  if (error) throw error
}

export interface MembershipPriceRow {
  id: string
  productId: string | null
  amountMinor: number
  effectiveFrom: string
}

/**
 * Every price the club's memberships have had or are going to have, newest first. Prices are added, never edited,
 * so this is the whole story; where a price was set twice for the same day, the later one is the one that counts
 * and the only one listed.
 */
export async function readMembershipPriceHistory(supabase: Client, programmeId: string): Promise<MembershipPriceRow[]> {
  const { data, error } = await supabase
    .from("club_subscription_pricing")
    .select("id, product_id, amount_minor, effective_from, created_at")
    .eq("programme_id", programmeId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
  if (error) throw error
  const seen = new Set<string>()
  const rows: MembershipPriceRow[] = []
  for (const p of data ?? []) {
    const key = `${p.product_id ?? ""}|${p.effective_from}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ id: p.id, productId: p.product_id ?? null, amountMinor: p.amount_minor, effectiveFrom: p.effective_from })
  }
  return rows
}

export async function archiveMembership(supabase: Client, productId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_membership_product", { p_product_id: productId })
  if (error) throw error
}

export type ActivationOutcome = "ACTIVATED" | "RESUMED" | "ALREADY_ACTIVE"

export async function activateMemberships(supabase: Client, clubId: string): Promise<ActivationOutcome> {
  const { data, error } = await supabase.rpc("activate_membership_programme", { p_club_id: clubId })
  if (error) throw error
  return String(((data ?? {}) as Raw).outcome ?? "ACTIVATED") as ActivationOutcome
}

export async function pauseMemberships(supabase: Client, clubId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("pause_membership_programme", { p_club_id: clubId, p_reason: reason })
  if (error) throw error
}

/**
 * What a person reads when a door refuses. The doors above raise their refusals as sentences written for a
 * person ("A monthly price must be at least £1.00.", "This club already has a membership called Juniors."), so
 * those are shown as they are. Anything else -- a raw constraint or a database message that names a table, a
 * column or a function -- is never shown: the caller's own fallback is.
 */
export function membershipSetupErrorMessage(cause: unknown, fallback: string): string {
  const e = (cause ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof e.code === "string" ? e.code : ""
  const message = typeof e.message === "string" ? e.message.trim() : ""
  const internal = !message || /duplicate key|violates|constraint|relation |column |function |syntax|null value|permission denied for/i.test(message)
  if (code === "42501") return internal ? "You are not authorised to do this for this club." : message
  if (internal) return fallback
  return ["22023", "23505", "23514", "P0001", "P0002", "55000"].includes(code) ? message : fallback
}

// -----------------------------------------------------------------------------------------------------------------
// THE WORKED EXAMPLE, CALCULATED ON THE SERVER (membership_first_payment_example): the generator's own rules.
// -----------------------------------------------------------------------------------------------------------------

export interface FirstPaymentExample {
  joinDate: string
  monthlyAmountMinor: number
  firstAmountMinor: number
  firstBillingPeriod: string
  firstCollectionDate: string | null
  isProrated: boolean
  proratedDays: number | null
  daysInMonth: number | null
  nothingInJoiningMonth: boolean
  belowMinimum: boolean
  thenMonthlyFrom: string
  feeBps: number
  feeBearer: FeeBearer | null
  firstFeeMinor: number
  monthlyFeeMinor: number
  firstCollectMinor: number
  monthlyCollectMinor: number
  clubReceivesMonthlyBeforeGoCardlessMinor: number
}

export async function loadFirstPaymentExample(
  supabase: Client,
  input: { clubId: string; monthlyAmountMinor: number; joinDate: string; collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }
): Promise<FirstPaymentExample | null> {
  const { data, error } = await supabase.rpc("membership_first_payment_example", {
    p_club_id: input.clubId,
    p_monthly_amount_minor: input.monthlyAmountMinor,
    p_join_date: input.joinDate,
    p_collection_day: input.collectionDay,
    p_first_payment_policy: input.firstPaymentPolicy,
    p_fee_bearer: input.feeBearer ?? undefined,
  })
  if (error) throw error
  return parseFirstPaymentExample(data)
}

/** Pure: `membership_first_payment_example`'s JSON, as every reader of it (the club's example, a family's first payment). */
export function parseFirstPaymentExample(raw: unknown): FirstPaymentExample | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Raw
  return {
    joinDate: String(r.join_date),
    monthlyAmountMinor: num(r.monthly_amount_minor) ?? 0,
    firstAmountMinor: num(r.first_amount_minor) ?? 0,
    firstBillingPeriod: String(r.first_billing_period),
    firstCollectionDate: str(r.first_collection_date),
    isProrated: bool(r.is_prorated),
    proratedDays: num(r.prorated_days),
    daysInMonth: num(r.days_in_month),
    nothingInJoiningMonth: bool(r.nothing_in_joining_month),
    belowMinimum: bool(r.below_minimum),
    thenMonthlyFrom: String(r.then_monthly_from),
    feeBps: num(r.fee_bps) ?? 0,
    feeBearer: (str(r.fee_bearer) as FeeBearer | null) ?? null,
    firstFeeMinor: num(r.first_fee_minor) ?? 0,
    monthlyFeeMinor: num(r.monthly_fee_minor) ?? 0,
    firstCollectMinor: num(r.first_collect_minor) ?? 0,
    monthlyCollectMinor: num(r.monthly_collect_minor) ?? 0,
    clubReceivesMonthlyBeforeGoCardlessMinor: num(r.club_receives_monthly_before_gocardless_minor) ?? 0,
  }
}

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })

/** The example in one or two plain sentences, from the server's figures only. */
export function firstPaymentExampleSentences(e: FirstPaymentExample): string[] {
  const join = longDate(e.joinDate)
  const monthly = formatMinorUnits(e.monthlyCollectMinor)
  const lines: string[] = []
  if (e.belowMinimum) {
    lines.push(`A player joining on ${join} pays nothing for the rest of ${monthName(e.joinDate)}: the part month is under the £1 Direct Debit minimum.`)
  } else if (e.nothingInJoiningMonth) {
    lines.push(`A player joining on ${join} pays nothing for the rest of ${monthName(e.joinDate)}. Their first payment is ${formatMinorUnits(e.firstCollectMinor)} for ${monthName(e.firstBillingPeriod)}.`)
  } else if (e.isProrated) {
    lines.push(`A player joining on ${join} pays ${formatMinorUnits(e.firstCollectMinor)} for the ${e.proratedDays} days left in ${monthName(e.joinDate)}, collected once their Direct Debit is set up.`)
  } else {
    lines.push(`A player joining on ${join} pays ${formatMinorUnits(e.firstCollectMinor)} for ${monthName(e.firstBillingPeriod)}.`)
  }
  lines.push(`Then ${monthly} a month from ${longDate(e.thenMonthlyFrom)}.`)
  return lines
}

// -----------------------------------------------------------------------------------------------------------------
// WORDS. Statuses are sentence case; option labels match the website's.
// -----------------------------------------------------------------------------------------------------------------

export const CONNECTION_STATE_LABEL: Record<ConnectionState, string> = {
  NOT_CONNECTED: "Not connected",
  CHECKING: "Checking with GoCardless",
  VERIFYING: "Being verified",
  ACTION_REQUIRED: "Needs information",
  READY: "Connected",
  DISCONNECTED: "Disconnected",
}

export type ConnectionTone = "neutral" | "moving" | "attention" | "settled"

export const CONNECTION_STATE_TONE: Record<ConnectionState, ConnectionTone> = {
  NOT_CONNECTED: "neutral",
  CHECKING: "moving",
  VERIFYING: "moving",
  ACTION_REQUIRED: "attention",
  READY: "settled",
  DISCONNECTED: "attention",
}

/** What the connection means for collecting, in GoCardless's own terms (Getting Your Users Verified). */
export function connectionSentence(state: ConnectionState): string {
  switch (state) {
    case "NOT_CONNECTED":
      return "Connect the club's GoCardless account to collect membership payments by Direct Debit."
    case "CHECKING":
      return "Connected. Ovalball hasn't yet confirmed with GoCardless whether the account is verified."
    case "VERIFYING":
      return "Connected. GoCardless is reviewing the account; there is nothing for the club to do. Collections can start once it is verified."
    case "ACTION_REQUIRED":
      return "Connected, but GoCardless needs more information from the club before it can collect. Finish verification with GoCardless."
    case "READY":
      return "Connected and verified. GoCardless can collect the club's membership payments."
    case "DISCONNECTED":
      return "GoCardless was disconnected. Ovalball can't set up or record collections until it is connected again."
  }
}

/** GoCardless's own public explanation of what it is, for "Learn More About GoCardless". */
export const GOCARDLESS_ABOUT_URL = "https://gocardless.com/"

/** GoCardless's own verification page for a club that has more to do. */
export function goCardlessVerifyUrl(environment: "sandbox" | "production" | null): string {
  return environment === "production" ? "https://verify.gocardless.com" : "https://verify-sandbox.gocardless.com"
}

export const PROGRAMME_STATE_LABEL: Record<ProgrammeState, string> = {
  NOT_STARTED: "Not set up",
  SETTING_UP: "Setting up",
  ACTIVE: "Active",
  PAUSED: "Paused",
}

export function readinessSentence(item: ReadinessItem, connection: ConnectionState): string {
  switch (item) {
    case "TERMS":
      return "Agree to Ovalball's fee and how Ovalball uses the club's GoCardless account."
    case "CONNECT":
      return "Connect the club's GoCardless account."
    case "VERIFY":
      return connection === "ACTION_REQUIRED" ? "Give GoCardless the information it asked for." : "Wait for GoCardless to verify the club's account."
    case "FEE":
      return "Choose who pays Ovalball's fee."
    case "MEMBERSHIP":
      return "Add a membership with a monthly price and at least one team."
  }
}

/** "2.5%" from the server's basis points. */
export function feePercent(bps: number): string {
  const pct = bps / 100
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toString()}%`
}

export function feeBearerOptions(bps: number): { value: FeeBearer; label: string; body: string }[] {
  const pct = feePercent(bps)
  return [
    {
      value: "CLUB",
      label: "The club pays it",
      body: `Members pay the membership price. Ovalball's ${pct} is taken from each payment before it reaches the club.`,
    },
    {
      value: "PAYER",
      label: "Members pay it",
      body: `Ovalball's ${pct} is added to what members pay, so the club receives the full membership price.`,
    },
  ]
}

export function feeBearerSentence(bearer: FeeBearer | null, bps: number): string {
  const pct = feePercent(bps)
  if (bearer === "CLUB") return `The club pays Ovalball's ${pct}: it is taken from each payment before it reaches the club.`
  if (bearer === "PAYER") return `Members pay Ovalball's ${pct} on top of the membership price.`
  return `Choose who pays Ovalball's ${pct}: the club or its members.`
}

/** The two first-payment policies, described with the club's own collection day (never a hard-coded 1st). */
export function firstPaymentPolicyOptions(collectionDay: number): { value: SetupFirstPaymentPolicy; label: string; body: string }[] {
  const day = ordinalWord(collectionDay)
  return [
    {
      value: "PRORATE_CURRENT_MONTH",
      label: "Charge a pro-rata amount",
      body: `Charge only for the days left in the month they join. Full monthly payments then follow from the ${day} of the next month.`,
    },
    {
      value: "NEXT_COLLECTION_DAY",
      label: "Start payments next month",
      body: `If they join after the ${day}, nothing is due for that month and their first full payment is on the ${day} of the next month.`,
    },
  ]
}

/** Direct Debit is asynchronous: the collection day is when a payment is submitted, not when the club is paid. */
export function collectionDaySentence(day: number): string {
  return `Payments are taken on the ${ordinalWord(day)}, or the next working day. The money reaches the club a few working days later, when GoCardless pays it out.`
}

/**
 * One membership in money, said in a line: what a member's Direct Debit collects and, when the club pays the fee,
 * what reaches the club. From the server's figures (`money`), never worked out here.
 */
export function membershipMoneyLine(m: Pick<SetupMembership, "money">, bearer: FeeBearer | null): string | null {
  if (!m.money || !bearer) return null
  if (bearer === "PAYER") return `Members pay ${formatMinorUnits(m.money.membersPayMinor)} a month, including Ovalball's ${formatMinorUnits(m.money.feeMinor)}`
  return `The club receives ${formatMinorUnits(m.money.clubReceivesMinor)} a month after Ovalball's ${formatMinorUnits(m.money.feeMinor)}`
}

/** A receipt said once, for a screen reader, when its figures change. */
export function receiptAnnouncement(r: { memberPaysMinor: number; feeMinor: number; clubReceivesMinor: number }): string {
  return `Members pay ${formatMinorUnits(r.memberPaysMinor)} a month. Ovalball's fee is ${formatMinorUnits(r.feeMinor)}. The club receives ${formatMinorUnits(r.clubReceivesMinor)}, before GoCardless's own fee.`
}

/** True when the only thing standing between a club and Activate is GoCardless finishing its own review. */
export function onlyWaitingForVerification(s: Pick<MembershipSetupState, "readiness" | "connection">): boolean {
  return s.readiness.missing.length > 0 && s.readiness.missing.every((m) => m === "VERIFY") && s.connection.state !== "ACTION_REQUIRED"
}

/** The finished ending while GoCardless verifies: nothing is left for the club to do, and it is told how it will hear. */
export function verificationWaitSentence(clubName: string | null): string {
  return `GoCardless is reviewing ${clubName ?? "the club"}'s account. There is nothing more to do: you'll get a notification when it is verified, and then you can switch Club Memberships on.`
}

/** After Activate: who can now set a Direct Debit up. Adult sides included, so never "families". */
export function activatedSentence(pricedTeams: number): string {
  return `Direct Debits can now be set up for ${pricedTeams === 1 ? "1 team" : `${pricedTeams} teams`}. Each member, or their parent, sets up their own.`
}

export const GOCARDLESS_FEES_SENTENCE =
  "GoCardless charges the club its own fees for each payment, under the club's agreement with GoCardless. They are separate from Ovalball's fee."

/**
 * WHAT THE CLUB IS AGREEING TO -- PROPOSED WORDING, PENDING OWNER AND LEGAL APPROVAL (version below).
 *
 * Every sentence states a fact established from GoCardless's official documentation or from this integration's
 * own code. The binding club agreement GoCardless's Integration Partner Agreement requires (cl. 20, 21, 24) --
 * including Ovalball's data-protection role -- is NOT written here; it is the owner's and legal's, and the version
 * string changes when they approve the final wording.
 */
export function clubMembershipTermsPoints(bps: number): { title: string; body: string }[] {
  const pct = feePercent(bps)
  return [
    {
      title: `Ovalball's fee is ${pct} of the membership price`,
      body: `${pct} of the membership price in every payment collected through Ovalball, taken by GoCardless when the payment is collected. The club chooses who pays it: the club (it comes out of the payment) or its members (it is added to the payment). If a payment fails or is charged back, GoCardless returns the fee to the club.`,
    },
    {
      title: "GoCardless's own fees are separate",
      body: GOCARDLESS_FEES_SENTENCE,
    },
    {
      title: "GoCardless holds the bank details",
      body: "Members enter their bank details on GoCardless's own pages. Ovalball never sees or stores them.",
    },
    {
      title: "What Ovalball does on the club's GoCardless account",
      body: "With the club's permission, Ovalball sets up members' Direct Debits, creates their payments and monthly collections, cancels them when a membership ends, and reads payments, Direct Debits and payouts so the club can see who has paid.",
    },
    {
      title: "The club stays in charge",
      body: "The club has its own agreement with GoCardless and can disconnect Ovalball at any time. Payments GoCardless has already scheduled may still be collected after disconnecting.",
    },
  ]
}

export const CLUB_MEMBERSHIP_TERMS_STATUS = "Proposed wording, pending owner and legal approval."

/**
 * The term a club using GoCardless for anything else most needs to see, so it is never folded away behind "Read the
 * Details": the access Ovalball is given is to the whole account.
 */
export const GOCARDLESS_ACCESS_SENTENCE =
  "Connecting gives Ovalball read and write access to the club's whole GoCardless account, including activity that did not come through Ovalball."

// -----------------------------------------------------------------------------------------------------------------
// THE SETUP JOURNEY, SAID ONCE FOR BOTH CLIENTS: what a club sets up, why GoCardless, what Ovalball receives, how
// the money works, and where Review stands. Every status here reads the server's own readiness; nothing decides it.
// -----------------------------------------------------------------------------------------------------------------

export type SetupStepKey = "connect" | "settings" | "memberships" | "review"

/** What the club sets up, in order: shown before it starts, and on the Memberships home while it goes. */
export function setupOverviewSteps(bps: number): { key: SetupStepKey; title: string; body: string }[] {
  const pct = feePercent(bps)
  return [
    { key: "connect", title: "Connect GoCardless", body: "The club's own GoCardless account collects the Direct Debits. Bank details stay with GoCardless." },
    { key: "settings", title: "Choose how collection works", body: `The collection day, what someone joining part-way pays first, and who pays Ovalball's ${pct}.` },
    { key: "memberships", title: "Price your memberships", body: "What each team's players pay a month." },
    { key: "review", title: "Review and activate", body: "Check everything, then switch memberships on. Nothing is collected until each member sets up their own Direct Debit." },
  ]
}

/** Why GoCardless, and what connecting means for bank details and for Ovalball: the Connect step's reassurance. */
export const GOCARDLESS_CONNECT_POINTS: { key: "secure" | "bank" | "data" | "return"; title: string; body: string }[] = [
  { key: "secure", title: "Secure, on GoCardless's own pages", body: "The club signs in to its GoCardless account, or creates one. Nothing is typed into Ovalball." },
  { key: "bank", title: "Bank details stay with GoCardless", body: "Members authorise their Direct Debit with GoCardless. Ovalball never sees or stores anyone's bank details." },
  { key: "data", title: "What Ovalball receives", body: "Who has set up a Direct Debit, how each payment is going, and what GoCardless pays the club: what Ovalball needs to run memberships and match the money." },
  { key: "return", title: "Straight back to Ovalball", body: "You come back here as soon as the connection is made." },
]

/**
 * HOW THE MONEY WORKS -- the merchant disclosure. PROPOSED WORDING (CLUB_MEMBERSHIP_TERMS_STATUS): it names each
 * party's role plainly and claims nothing GoCardless has not stated or approved; the final words are the owner's
 * and legal's.
 */
export function membershipDisclosure(bps: number): string {
  const pct = feePercent(bps)
  return `GoCardless provides the Direct Debit service and pays the money out to the club. Ovalball provides the club's membership platform and charges ${pct} of each membership payment collected, paid by the club or its members as the club chooses. GoCardless's own fees are separate.`
}

/** Where a setup stands, step by step, from the server's own readiness: the Memberships home's checklist. */
export function setupProgress(
  s: Pick<MembershipSetupState, "terms" | "connection" | "programme" | "readiness" | "feeBps">
): { key: SetupStepKey; title: string; done: boolean; detail: string }[] {
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  const settingsDone = !!s.programme?.feeBearer
  const priced = s.readiness.readyMemberships
  const titles = Object.fromEntries(setupOverviewSteps(s.feeBps).map((x) => [x.key, x.title])) as Record<SetupStepKey, string>
  return [
    { key: "connect", title: titles.connect, done: connected && s.terms.accepted, detail: connected ? CONNECTION_STATE_LABEL[s.connection.state] : CONNECTION_STATE_LABEL[s.connection.state === "DISCONNECTED" ? "DISCONNECTED" : "NOT_CONNECTED"] },
    {
      key: "settings",
      title: titles.settings,
      done: settingsDone,
      detail: settingsDone && s.programme ? `${ordinalWord(s.programme.collectionDay)} of each month · ${s.programme.feeBearer === "CLUB" ? "the club pays Ovalball's fee" : "members pay Ovalball's fee"}` : "Not chosen yet",
    },
    { key: "memberships", title: titles.memberships, done: priced > 0, detail: priced === 0 ? "None priced yet" : priced === 1 ? "1 membership ready" : `${priced} memberships ready` },
    { key: "review", title: titles.review, done: false, detail: s.readiness.canActivate ? "Ready to activate" : onlyWaitingForVerification(s) ? "Waiting for GoCardless" : "Not ready yet" },
  ]
}

export type ActivationStatus = { kind: "READY" | "WAITING" | "ACTION_REQUIRED" | "NOT_ALLOWED"; title: string; body: string }

/**
 * WHERE REVIEW STANDS, in one line: ready, waiting only for GoCardless, or what is still to do. It is the server's
 * readiness said in words -- Activate is judged again on the server whatever this says.
 */
export function activationStatus(s: Pick<MembershipSetupState, "readiness" | "connection" | "canConfigure">, clubName: string | null): ActivationStatus {
  if (s.readiness.canActivate) {
    return s.canConfigure
      ? { kind: "READY", title: "Ready to activate", body: "Everything is set up and GoCardless has verified the club's account." }
      : { kind: "NOT_ALLOWED", title: "Ready for a Club Admin", body: "Only someone who can set up memberships can switch them on." }
  }
  if (onlyWaitingForVerification(s)) return { kind: "WAITING", title: "Waiting for GoCardless", body: verificationWaitSentence(clubName) }
  const n = s.readiness.missing.length
  return { kind: "ACTION_REQUIRED", title: "Action required", body: n === 1 ? "1 thing to finish before memberships can be switched on." : `${n} things to finish before memberships can be switched on.` }
}

const VERIFICATION_WORDS: Record<ConnectionState, string> = {
  NOT_CONNECTED: "Not connected",
  CHECKING: "Being checked with GoCardless",
  VERIFYING: "GoCardless is reviewing the account",
  ACTION_REQUIRED: "GoCardless needs more information",
  READY: "Verified by GoCardless",
  DISCONNECTED: "Disconnected",
}

/** The connection as facts: which kind of account, since when, and GoCardless's verification. Never a token or an id. */
export function connectionFacts(c: MembershipSetupState["connection"]): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = []
  if (c.environment) facts.push({ label: "Account", value: c.environment === "production" ? "Live GoCardless account" : "GoCardless test account, no real money" })
  if (c.connectedAt) facts.push({ label: "Connected", value: formatFinanceDate(c.connectedAt, "long") })
  facts.push({ label: "Verification", value: VERIFICATION_WORDS[c.state] })
  if (c.checkedAt) facts.push({ label: "Last Checked", value: formatFinanceDate(c.checkedAt, "long") })
  return facts
}

