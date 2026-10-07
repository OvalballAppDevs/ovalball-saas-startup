import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * THE AGE DISPENSATION WORKFLOW (20270742000000) -- one reading for both apps.
 *
 * A child who does not fit a team's age grade stays refused. The only way round it is a persisted request
 * that the club's Safeguarding Officer or a Club Admin decides -- once -- for one player, one team, one
 * club and one season. The server decides everything: who may ask (`request_dispensation`), who may decide
 * (`decide_dispensation`), what each person may read (`dispensation_record`, which never hands a team's
 * staff the child's date of birth or the family's reasons). This module only reads the server's answers and
 * puts them in the one set of words both apps use, so the phone and the website can never describe the same
 * record differently.
 */

type Client = SupabaseClient

/** The record's stored states. Shown to people as DISPENSATION_STATUS_LABEL says, never raw. */
export type DispensationStatus = "requested" | "approved" | "rejected" | "withdrawn" | "expired" | "revoked"

export const DISPENSATION_STATUS_LABEL: Record<DispensationStatus, string> = {
  requested: "Pending",
  approved: "Approved",
  rejected: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
  revoked: "Revoked",
}

/** How a status is drawn: waiting (amber), granted (green), refused or ended (red), closed (grey). */
export type DispensationTone = "waiting" | "granted" | "refused" | "closed"

export function dispensationTone(status: DispensationStatus): DispensationTone {
  switch (status) {
    case "requested":
      return "waiting"
    case "approved":
      return "granted"
    case "rejected":
    case "revoked":
      return "refused"
    default:
      return "closed"
  }
}

/** Why a child does not fit, as the record snapshotted it when it was asked for. */
export type DispensationVerdict = "TOO_YOUNG" | "TOO_OLD" | "UNDER_18" | "OUTSIDE_AGE_GRADE" | "PATHWAY"
export type DispensationDecider = "SAFEGUARDING_OFFICER" | "CLUB_ADMIN"
export type DispensationRequester = "GUARDIAN" | "TEAM_STAFF" | "CLUB_ADMIN" | "CLUB_STAFF" | "CALL_UP"

export interface DispensationPerson {
  id: string
  name: string
}

export interface DispensationRecord {
  id: string
  status: DispensationStatus
  player: { id: string; firstName: string; surname: string; /** Only for the family, the requester and the deciders. */ dateOfBirth: string | null }
  club: { id: string; name: string | null }
  team: { id: string; label: string; adultSide: boolean }
  sourceTeam: { id: string; label: string } | null
  season: { id: string; name: string; endsOn: string | null }
  playerAgeGroup: string | null
  teamAgeGroup: string | null
  verdict: DispensationVerdict | null
  /** The requester's own words: only for the family, the requester and the deciders. */
  reason: string | null
  ruleReference: string | null
  requestedBy: DispensationPerson | null
  requestedAs: DispensationRequester | null
  requestedAt: string | null
  requiresGoverningBody: boolean
  /** An under-18 onto an adult side: the Safeguarding Officer alone decides it. */
  safeguardingOnly: boolean
  governingBodyReference: string | null
  decidedBy: DispensationPerson | null
  /** SAFEGUARDING_OFFICER, CLUB_ADMIN -- or LEGACY for a record made before the one decision existed. */
  decidedAs: DispensationDecider | "LEGACY" | null
  decidedAt: string | null
  /** The decider's note: only for the family, the requester and the deciders. */
  decisionNote: string | null
  withdrawnBy: DispensationPerson | null
  withdrawnAt: string | null
  expiredAt: string | null
  revokedBy: DispensationPerson | null
  revokedAt: string | null
  revokeReason: string | null
  /** The team place waiting on this record, if one is. */
  place: { membershipId: string; state: string } | null
  /** What THIS viewer may do with it. The server refuses anything else regardless. */
  viewer: {
    decidesAs: DispensationDecider | null
    mayWithdraw: boolean
    mayRevoke: boolean
    mayRecordGoverningBody: boolean
    isRequester: boolean
    isFamily: boolean
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const bool = (v: unknown): boolean => v === true
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const person = (v: unknown): DispensationPerson | null => {
  const p = obj(v)
  const id = str(p.id)
  return id ? { id, name: str(p.name) ?? "Someone at the club" } : null
}
const STATUSES = new Set<DispensationStatus>(["requested", "approved", "rejected", "withdrawn", "expired", "revoked"])
const asStatus = (v: unknown): DispensationStatus => (STATUSES.has(v as DispensationStatus) ? (v as DispensationStatus) : "requested")
const decider = (v: unknown): DispensationDecider | null => (v === "SAFEGUARDING_OFFICER" || v === "CLUB_ADMIN" ? v : null)

/** Pure: one record as the server described it, read without guessing. `null` when there is no record to show. */
export function interpretDispensationRecord(raw: unknown): DispensationRecord | null {
  const r = obj(raw)
  const id = str(r.id)
  if (!id) return null
  const player = obj(r.player)
  const club = obj(r.club)
  const team = obj(r.team)
  const source = obj(r.source_team)
  const season = obj(r.season)
  const place = obj(r.place)
  const viewer = obj(r.viewer)
  const decidedAs = r.decided_as === "LEGACY" ? "LEGACY" : decider(r.decided_as)
  return {
    id,
    status: asStatus(r.status),
    player: { id: str(player.id) ?? "", firstName: str(player.first_name) ?? "", surname: str(player.surname) ?? "", dateOfBirth: str(player.date_of_birth) },
    club: { id: str(club.id) ?? "", name: str(club.name) },
    team: { id: str(team.id) ?? "", label: str(team.label) ?? "the team", adultSide: bool(team.adult_side) },
    sourceTeam: str(source.id) ? { id: source.id as string, label: str(source.label) ?? "their team" } : null,
    season: { id: str(season.id) ?? "", name: str(season.name) ?? "this season", endsOn: str(season.ends_on) },
    playerAgeGroup: str(r.player_age_group),
    teamAgeGroup: str(r.team_age_group),
    verdict: (str(r.verdict) as DispensationVerdict | null) ?? null,
    reason: str(r.reason),
    ruleReference: str(r.rule_reference),
    requestedBy: person(r.requested_by),
    requestedAs: (str(r.requested_as) as DispensationRequester | null) ?? null,
    requestedAt: str(r.requested_at),
    requiresGoverningBody: bool(r.requires_governing_body),
    safeguardingOnly: bool(r.safeguarding_only),
    governingBodyReference: str(r.governing_body_reference),
    decidedBy: person(r.decided_by),
    decidedAs,
    decidedAt: str(r.decided_at),
    decisionNote: str(r.decision_note),
    withdrawnBy: person(r.withdrawn_by),
    withdrawnAt: str(r.withdrawn_at),
    expiredAt: str(r.expired_at),
    revokedBy: person(r.revoked_by),
    revokedAt: str(r.revoked_at),
    revokeReason: str(r.revoke_reason),
    place: str(place.membership_id) ? { membershipId: place.membership_id as string, state: str(place.state) ?? "PENDING" } : null,
    viewer: {
      decidesAs: decider(viewer.decides_as),
      mayWithdraw: bool(viewer.may_withdraw),
      mayRevoke: bool(viewer.may_revoke),
      mayRecordGoverningBody: bool(viewer.may_record_governing_body),
      isRequester: bool(viewer.is_requester),
      isFamily: bool(viewer.is_family),
    },
  }
}

const records = (raw: unknown): DispensationRecord[] =>
  (Array.isArray(raw) ? raw : []).map(interpretDispensationRecord).filter((r): r is DispensationRecord => r !== null)

// ---------------------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------------------

/** One record, or null: not found and not yours read the same, so an id is never an oracle. */
export async function readDispensationRecord(supabase: Client, dispensationId: string): Promise<DispensationRecord | null> {
  const { data, error } = await supabase.rpc("dispensation_record", { p_dispensation_id: dispensationId })
  if (error) throw error
  return interpretDispensationRecord(data)
}

/** The club's register: its Safeguarding Officer, Club Admins and club-level requesters. Pending first. */
export async function readDispensationRegister(supabase: Client, clubId: string): Promise<DispensationRecord[]> {
  const { data, error } = await supabase.rpc("dispensation_register", { p_club_id: clubId })
  if (error) throw error
  return records(data)
}

/** The requests this person made, and those about their own children. Pending first. */
export async function readMyDispensations(supabase: Client): Promise<DispensationRecord[]> {
  const { data, error } = await supabase.rpc("my_dispensations")
  if (error) throw error
  return records(data)
}

/** What is waiting for THIS person's decision -- the Needs Attention source. */
export interface DispensationWaiting {
  id: string
  clubId: string
  teamId: string
  playerId: string
  firstName: string
  surname: string
  teamLabel: string
  decidesAs: DispensationDecider
  safeguardingOnly: boolean
  requestedAt: string | null
}

export function interpretDispensationsWaiting(raw: unknown): DispensationWaiting[] {
  return (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [])
    .filter((r) => str(r.id) && decider(r.decides_as))
    .map((r) => ({
      id: r.id as string,
      clubId: str(r.club_id) ?? "",
      teamId: str(r.team_id) ?? "",
      playerId: str(r.player_id) ?? "",
      firstName: str(r.first_name) ?? "",
      surname: str(r.surname) ?? "",
      teamLabel: str(r.team_label) ?? "the team",
      decidesAs: decider(r.decides_as) as DispensationDecider,
      safeguardingOnly: bool(r.safeguarding_only),
      requestedAt: str(r.requested_at),
    }))
}

export async function readDispensationsWaiting(supabase: Client): Promise<DispensationWaiting[]> {
  const { data, error } = await supabase.rpc("dispensation_decisions_waiting")
  if (error) throw error
  return interpretDispensationsWaiting(data)
}

/** Whether a player fits a team this season, and whether this person may ask for a dispensation. */
export interface DispensationOptions {
  verdict: string
  playerAgeGroup: string | null
  teamAgeGroup: string | null
  seasonId: string | null
  adultRequirement: string | null
  detail: string | null
  mayRequest: boolean
  live: { id: string; status: DispensationStatus; decidedAs: string | null } | null
}

export function interpretDispensationOptions(raw: unknown): DispensationOptions | null {
  const r = obj(raw)
  const verdict = str(r.verdict)
  if (!verdict) return null
  const live = obj(r.live)
  return {
    verdict,
    playerAgeGroup: str(r.player_age_group),
    teamAgeGroup: str(r.team_age_group),
    seasonId: str(r.season_id),
    adultRequirement: str(r.adult_requirement),
    detail: str(r.detail),
    mayRequest: bool(r.may_request),
    live: str(live.id) ? { id: live.id as string, status: asStatus(live.status), decidedAs: str(live.decided_as) } : null,
  }
}

export async function readDispensationOptions(supabase: Client, playerId: string, teamId: string): Promise<DispensationOptions | null> {
  const { data, error } = await supabase.rpc("dispensation_options", { p_player_id: playerId, p_team_id: teamId })
  if (error) throw error
  return interpretDispensationOptions(data)
}

// ---------------------------------------------------------------------------------------------------
// Actions -- each one the server re-decides in full
// ---------------------------------------------------------------------------------------------------

export const DISPENSATION_REASON_MAX = 1000
export const DISPENSATION_REFERENCE_MAX = 200

/** Ask. Never a grant: the record waits for the Safeguarding Officer or a Club Admin. Returns the record's id. */
export async function requestDispensation(
  supabase: Client,
  input: { playerId: string; teamId: string; reason: string; sourceTeamId?: string | null; seasonId?: string | null }
): Promise<string> {
  const { data, error } = await supabase.rpc("request_dispensation", {
    p_player_id: input.playerId,
    p_team_id: input.teamId,
    p_reason: input.reason.trim(),
    p_source_team_id: input.sourceTeamId ?? null,
    p_season_id: input.seasonId ?? null,
  })
  if (error) throw error
  return data as string
}

/** The one decision. A decline needs a note (the person who asked is told it); some approvals need a reference. */
export async function decideDispensation(
  supabase: Client,
  dispensationId: string,
  decision: { approve: boolean; note?: string | null; governingBodyReference?: string | null }
): Promise<DispensationStatus> {
  const { data, error } = await supabase.rpc("decide_dispensation", {
    p_dispensation_id: dispensationId,
    p_approve: decision.approve,
    p_note: decision.note?.trim() || null,
    p_governing_body_reference: decision.governingBodyReference?.trim() || null,
  })
  if (error) throw error
  return asStatus(data)
}

export async function withdrawDispensation(supabase: Client, dispensationId: string, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc("withdraw_dispensation", { p_dispensation_id: dispensationId, p_reason: reason?.trim() || null })
  if (error) throw error
}

export async function revokeDispensation(supabase: Client, dispensationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_player_dispensation", { p_id: dispensationId, p_reason: reason.trim() })
  if (error) throw error
}

export async function recordDispensationReference(supabase: Client, dispensationId: string, reference: string): Promise<void> {
  const { error } = await supabase.rpc("record_dispensation_reference", { p_dispensation_id: dispensationId, p_reference: reference.trim() })
  if (error) throw error
}

/** The server's own sentence for the refusals it writes; the fallback for anything else. */
export function dispensationErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "23505" || e.code === "P0001" || e.code === "P0002") {
    return e.message || fallback
  }
  return fallback
}

// ---------------------------------------------------------------------------------------------------
// Words -- one set, both apps (UK English; sentences in sentence case, labels in Title Case)
// ---------------------------------------------------------------------------------------------------

/** "U12" -> "Under 12". */
export function ageGradeName(ageGroup: string | null): string | null {
  const n = ageGroup?.match(/(\d+)/)?.[1]
  return n ? `Under ${n}` : null
}

export function decidedAsLabel(decidedAs: DispensationRecord["decidedAs"]): string {
  if (decidedAs === "SAFEGUARDING_OFFICER") return "Safeguarding Officer"
  if (decidedAs === "CLUB_ADMIN") return "Club Admin"
  if (decidedAs === "LEGACY") return "recorded before the decision workflow"
  return ""
}

/** Who decides a record, in words -- said on every request so nobody mistakes asking for approval. */
export function whoDecides(r: Pick<DispensationRecord, "safeguardingOnly" | "requiresGoverningBody">): string {
  return r.safeguardingOnly
    ? "The club's Safeguarding Officer decides this, with the governing body's approval."
    : "The club's Safeguarding Officer or a Club Admin decides this."
}

/** The sentence that makes plain a request is not a grant. Shown wherever a request is made or shown pending. */
export const DISPENSATION_NOT_A_GRANT = "Asking is not approval. Nothing changes until it is approved."

/**
 * WHY THE CHILD DOES NOT FIT, from the record's snapshot -- the mismatch in one sentence, for every viewer.
 * "Yan is in the Under 11 age grade this season. Under 12 Boys is an Under 12 side."
 */
export function dispensationMismatchSentence(r: Pick<DispensationRecord, "player" | "team" | "verdict" | "playerAgeGroup" | "teamAgeGroup">): string {
  const who = r.player.firstName || "This player"
  const mine = ageGradeName(r.playerAgeGroup)
  const theirs = ageGradeName(r.teamAgeGroup)
  switch (r.verdict) {
    case "UNDER_18":
      return `${who} is under 18. ${r.team.label} is an adult side.`
    case "PATHWAY":
      return `${r.team.label} is in the other playing pathway. That is a governing-body matter.`
    case "TOO_YOUNG":
    case "TOO_OLD":
    case "OUTSIDE_AGE_GRADE":
      if (mine && theirs) return `${who} is in the ${mine} age grade this season. ${r.team.label} is an ${theirs} side.`
      return `${who} is outside the age grade for ${r.team.label} this season.`
    default:
      return `${who} is outside the age grade for ${r.team.label} this season.`
  }
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })
export function dispensationDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : DAY.format(d)
}

/**
 * WHERE IT STANDS, in one or two sentences -- the same words on the phone and the website. Names the
 * person who decided (and as what) and when; a pending one says who decides and that asking is not a grant.
 */
export function dispensationStateSentence(r: DispensationRecord): string {
  const who = r.player.firstName || "This player"
  switch (r.status) {
    case "requested":
      return `${whoDecides(r)} ${DISPENSATION_NOT_A_GRANT}`
    case "approved": {
      const by = r.decidedBy ? ` by ${r.decidedBy.name}${r.decidedAs && r.decidedAs !== "LEGACY" ? ` (${decidedAsLabel(r.decidedAs)})` : ""}` : ""
      const when = dispensationDate(r.decidedAt)
      return `Approved${by}${when ? ` on ${when}` : ""}. ${who} can be placed with ${r.team.label} for ${r.season.name} only.`
    }
    case "rejected": {
      const by = r.decidedBy ? ` by ${r.decidedBy.name}` : ""
      const when = dispensationDate(r.decidedAt)
      return `Declined${by}${when ? ` on ${when}` : ""}.${r.decisionNote ? ` Reason: ${r.decisionNote}` : ""}`
    }
    case "withdrawn": {
      const by = r.withdrawnBy ? ` by ${r.withdrawnBy.name}` : ""
      const when = dispensationDate(r.withdrawnAt)
      return `Withdrawn${by}${when ? ` on ${when}` : ""} before it was decided.`
    }
    case "expired":
      return `Expired: ${r.season.name} ended before it was decided. A new season needs a new request.`
    case "revoked": {
      const by = r.revokedBy ? ` by ${r.revokedBy.name}` : ""
      const when = dispensationDate(r.revokedAt)
      return `Revoked${by}${when ? ` on ${when}` : ""}.${r.revokeReason ? ` Reason: ${r.revokeReason}` : ""} A place already made stays; nothing new can rely on it.`
    }
  }
}

/** The record's title: "Dispensation for Yan Adams" -- the person, never the state. */
export function dispensationTitle(r: Pick<DispensationRecord, "player">): string {
  return `Dispensation for ${`${r.player.firstName} ${r.player.surname}`.trim() || "a player"}`
}

/** What a decider is asked, above Approve and Decline. */
export function dispensationDecisionPrompt(r: DispensationRecord): string {
  const who = r.player.firstName || "this player"
  const base = `Approving lets ${who} be placed with ${r.team.label} for ${r.season.name} only. It does not change ${who}'s age grade.`
  return r.requiresGoverningBody ? `${base} Record the governing body's reference to approve it.` : base
}

/**
 * RECORDING THE GOVERNING BODY'S REFERENCE ON AN APPROVAL. Where the approval needs one (an approval made before
 * the one workflow and still without it), it is a step, and call-ups wait on it. Anywhere else the club MAY add
 * a governing body's approval it also holds, and nothing waits on it -- so it must never read as a step.
 */
export function dispensationReferenceAsk(r: Pick<DispensationRecord, "requiresGoverningBody">): { title: string; body: string; action: string } {
  return r.requiresGoverningBody
    ? {
        title: "Record the Governing Body's Approval",
        body: "This approval needs the governing body's reference. Once recorded, it never changes, and call-ups waiting on it go ahead.",
        action: "Record the Governing Body's Approval",
      }
    : {
        title: "Governing Body Reference",
        body: "Not needed for this dispensation. If the club also holds a governing body's approval for it, you can add the reference. Once recorded, it never changes.",
        action: "Add Governing Body Reference",
      }
}

/**
 * Needs Attention's one id per waiting decision (`attentionId("dispensation", id)`), so the notification
 * that asked for it pairs with the item, and a decided record leaves nothing behind.
 */
export function dispensationAttentionId(dispensationId: string): string {
  return `dispensation:${dispensationId}`
}

/** Needs Attention's line: "Dispensation requested for Yan Adams" -- the brief's wording, for both deciders. */
export function dispensationWaitingTitle(w: Pick<DispensationWaiting, "firstName" | "surname">): string {
  return `Dispensation requested for ${`${w.firstName} ${w.surname}`.trim() || "a player"}`
}

export function dispensationWaitingDetail(w: Pick<DispensationWaiting, "teamLabel" | "safeguardingOnly">): string {
  return w.safeguardingOnly
    ? `${w.teamLabel} is an adult side. Waiting for your decision, with the governing body's approval.`
    : `${w.teamLabel}. Waiting for your decision.`
}

// ---------------------------------------------------------------------------------------------------
// The age-grade bridge -- the one picture both apps draw of a mismatch
// ---------------------------------------------------------------------------------------------------

/** One rung of the ladder: a grade, and whether it is the child's own or the team's. */
export interface DispensationRung {
  grade: string
  label: string
  role: "player" | "team" | "between" | "edge"
}

/** How the bridge between the child's rung and the team's is drawn: built, waiting, or not built. */
export type DispensationBridge = "waiting" | "built" | "broken"

export interface DispensationLadder {
  rungs: DispensationRung[]
  bridge: DispensationBridge
  /** The child plays UP into an older grade, or DOWN into a younger one. */
  direction: "up" | "down"
}

const gradeNumber = (g: string | null): number | null => {
  const n = g?.match(/(\d+)/)?.[1]
  return n ? Number(n) : null
}

export function dispensationBridge(status: DispensationStatus): DispensationBridge {
  if (status === "requested") return "waiting"
  if (status === "approved") return "built"
  return "broken"
}

/**
 * THE LADDER for an age-grade mismatch: the child's grade, the team's, every grade between, and one rung
 * either side for context. Null where there is no ladder to draw -- an adult side (no grades), a pathway
 * question, or grades the record could not establish. Pure, so both apps draw exactly the same rungs.
 */
export function dispensationLadder(r: Pick<DispensationRecord, "playerAgeGroup" | "teamAgeGroup" | "verdict" | "status">): DispensationLadder | null {
  if (r.verdict !== "TOO_YOUNG" && r.verdict !== "TOO_OLD" && r.verdict !== "OUTSIDE_AGE_GRADE") return null
  const mine = gradeNumber(r.playerAgeGroup)
  const theirs = gradeNumber(r.teamAgeGroup)
  if (mine === null || theirs === null || mine === theirs) return null
  const low = Math.max(1, Math.min(mine, theirs) - 1)
  const high = Math.max(mine, theirs) + 1
  const rungs: DispensationRung[] = []
  for (let n = low; n <= high; n++) {
    const role: DispensationRung["role"] = n === mine ? "player" : n === theirs ? "team" : n > Math.min(mine, theirs) && n < Math.max(mine, theirs) ? "between" : "edge"
    rungs.push({ grade: `U${n}`, label: `Under ${n}`, role })
  }
  return { rungs, bridge: dispensationBridge(r.status), direction: theirs > mine ? "up" : "down" }
}

/** The ladder's accessible sentence, read instead of the drawing: the mismatch and the bridge's state. */
export function dispensationLadderSentence(r: Pick<DispensationRecord, "player" | "team" | "playerAgeGroup" | "teamAgeGroup" | "verdict" | "status">): string {
  const bridge = dispensationBridge(r.status)
  const state = bridge === "built" ? "A dispensation is approved for this season." : bridge === "waiting" ? "A dispensation is waiting for a decision." : "No dispensation is in place."
  return `${dispensationMismatchSentence(r)} ${state}`
}

/**
 * THE HISTORY of a record, oldest first -- every transition, who made it, as what and when. The record is
 * immutable, so this is a reading of it, never a log anybody edits.
 */
export interface DispensationEvent {
  kind: "requested" | "approved" | "declined" | "withdrawn" | "expired" | "revoked" | "reference"
  title: string
  who: string | null
  at: string | null
  detail: string | null
}

const REQUESTED_AS: Record<DispensationRequester, string> = {
  GUARDIAN: "parent or guardian",
  TEAM_STAFF: "team staff",
  CLUB_ADMIN: "Club Admin",
  CLUB_STAFF: "club staff",
  CALL_UP: "for a call-up",
}

export function dispensationHistory(r: DispensationRecord): DispensationEvent[] {
  const out: DispensationEvent[] = []
  const asked = r.requestedAs ? ` (${REQUESTED_AS[r.requestedAs]})` : ""
  out.push({ kind: "requested", title: "Requested", who: r.requestedBy ? `${r.requestedBy.name}${asked}` : null, at: r.requestedAt, detail: r.reason })
  if (r.decidedAt && (r.status === "approved" || r.status === "revoked")) {
    const as = r.decidedAs && r.decidedAs !== "LEGACY" ? ` (${decidedAsLabel(r.decidedAs)})` : r.decidedAs === "LEGACY" ? " (recorded before the decision workflow)" : ""
    out.push({ kind: "approved", title: "Approved", who: r.decidedBy ? `${r.decidedBy.name}${as}` : null, at: r.decidedAt, detail: r.decisionNote })
  }
  if (r.status === "rejected") {
    const as = r.decidedAs && r.decidedAs !== "LEGACY" ? ` (${decidedAsLabel(r.decidedAs)})` : ""
    out.push({ kind: "declined", title: "Declined", who: r.decidedBy ? `${r.decidedBy.name}${as}` : null, at: r.decidedAt, detail: r.decisionNote })
  }
  if (r.governingBodyReference) {
    out.push({ kind: "reference", title: "Governing body's reference recorded", who: null, at: null, detail: r.governingBodyReference })
  }
  if (r.status === "withdrawn") out.push({ kind: "withdrawn", title: "Withdrawn", who: r.withdrawnBy?.name ?? null, at: r.withdrawnAt, detail: null })
  if (r.status === "expired") out.push({ kind: "expired", title: "Expired", who: null, at: r.expiredAt, detail: `${r.season.name} ended before a decision.` })
  if (r.status === "revoked") out.push({ kind: "revoked", title: "Revoked", who: r.revokedBy?.name ?? null, at: r.revokedAt, detail: r.revokeReason })
  return out
}
