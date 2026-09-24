import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadStaffPlayers } from "../team/players"

type Client = SupabaseClient<Database>

/**
 * SAFEGUARDING ON THE PHONE (CA-M11.1): the website's Safeguarding Officer product, over the SAME
 * canonical operations and the SAME authority, read and written from the phone exactly as
 * `app/(app)/club/settings/safeguarding` does it.
 *
 * TWO SIDES, ONE SURFACE. The CLUB side is the appointment: who the club's safeguarding contact is,
 * nominating one, inviting them onto Ovalball, resending or withdrawing that invitation, correcting the
 * contact card, and ending the assignment -- every one gated on the club's own key
 * (`safeguarding.officer.nominate`, `.deactivate`, `.conversation.start`). The OFFICER side is what a
 * CONFIRMED officer may read because the server already provides it: safeguarding conversations, the
 * club's dispensations, a reasoned welfare lookup and the club's reported messages. Nothing on either
 * side is a role label: `my_capabilities` decides what is offered and the server judges every call again.
 *
 * WHAT DOES NOT EXIST, DELIBERATELY. There is no safeguarding case, concern, incident, note or document
 * domain anywhere on the server (`docs/architecture/safeguarding-officer-model.md`, "Explicit
 * non-goals"), so nothing here reads or writes one. `safeguarding.transfer.view` is catalogued and
 * bundled to the officer but Ovalball has no inter-club transfer domain and no read behind the key, so
 * it has no screen. Message-report decisions are Site-only (`site.messages.moderate`), so the officer's
 * queue is read-only. Nothing here emits a notification.
 *
 * NO EMAIL LEAVES THE PHONE. The website emails the invitation link through a server-only module the
 * app cannot call. The canonical issuer hands the link back once, so the phone shows it once for the
 * administrator to pass on themselves, and says plainly that no email was sent.
 */

/** The club's own keys: appointing and reaching its officer. */
export const SAFEGUARDING_CLUB_KEYS = {
  nominate: "safeguarding.officer.nominate",
  deactivate: "safeguarding.officer.deactivate",
  conversationStart: "safeguarding.conversation.start",
  contactView: "safeguarding.contact.view",
} as const

/**
 * The confirmed officer's own keys, from the catalogue's SO bundle
 * (`supabase/migrations/20270349000000_capability_catalogue_and_bundles.sql`). Each one that has a
 * server read behind it opens one section; the one that has none (`transferView`) opens nothing.
 */
export const SAFEGUARDING_OFFICER_KEYS = {
  dispensationView: "safeguarding.dispensation.view",
  welfareView: "safeguarding.welfare.view",
  transferView: "safeguarding.transfer.view",
  conversationHandle: "safeguarding.conversation.handle",
  moderationReview: "messaging.moderation.club_review",
} as const

/** Held at SELF scope: an officer correcting their own contact card. */
export const SAFEGUARDING_SELF_KEYS = {
  contactEdit: "safeguarding.officer.contact_edit",
} as const

export type OfficerCapabilityName = keyof typeof SAFEGUARDING_OFFICER_KEYS

export interface SafeguardingAccess {
  nominate: boolean
  deactivate: boolean
  conversationStart: boolean
  contactView: boolean
  officer: Record<OfficerCapabilityName, boolean>
  /** Any officer key at all -- the officer's sections exist only when this is true. */
  anyOfficer: boolean
  /** The person may correct a contact card that names THEM. */
  contactEditSelf: boolean
}

export function noSafeguardingAccess(): SafeguardingAccess {
  return {
    nominate: false,
    deactivate: false,
    conversationStart: false,
    contactView: false,
    officer: { dispensationView: false, welfareView: false, transferView: false, conversationHandle: false, moderationReview: false },
    anyOfficer: false,
    contactEditSelf: false,
  }
}

/**
 * ONE PROBE AT CLUB SCOPE, and one at self scope for the officer's own card. Re-asked on every
 * context change and every focus; never cached across either.
 */
export async function readSafeguardingAccess(supabase: Client, clubId: string): Promise<SafeguardingAccess> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  const officer = Object.fromEntries(Object.entries(SAFEGUARDING_OFFICER_KEYS).map(([name, key]) => [name, allowed.has(key)])) as Record<OfficerCapabilityName, boolean>

  let contactEditSelf = false
  try {
    const self = await supabase.rpc("my_capabilities", { p_scope_type: "self" })
    contactEditSelf = (self.data ?? []).some((r) => r.allowed === true && r.capability_key === SAFEGUARDING_SELF_KEYS.contactEdit)
  } catch {
    contactEditSelf = false
  }

  return {
    nominate: allowed.has(SAFEGUARDING_CLUB_KEYS.nominate),
    deactivate: allowed.has(SAFEGUARDING_CLUB_KEYS.deactivate),
    conversationStart: allowed.has(SAFEGUARDING_CLUB_KEYS.conversationStart),
    contactView: allowed.has(SAFEGUARDING_CLUB_KEYS.contactView),
    officer,
    anyOfficer: Object.values(officer).some(Boolean),
    contactEditSelf,
  }
}

// ---------------------------------------------------------------------------------------------------
// THE CLUB SIDE: the contact register and the appointment state machine, read together.
// ---------------------------------------------------------------------------------------------------

export type OfficerType = "primary" | "deputy"
export type OfficerContactStatus = "not_invited" | "invite_sent" | "active" | "inactive"

export interface SafeguardingOfficerContact {
  id: string
  officerType: OfficerType
  contactName: string
  contactEmail: string
  status: OfficerContactStatus
  userId: string | null
  /**
   * The open invitation for this contact, if any. The canonical issuer (`issue_invitation`) is what
   * `invite_safeguarding_officer` writes to, and its open row is read from the secret-free admin view;
   * a row from the retired per-table issuer is carried as `legacy` so the website's own revoke path is
   * still called for it. The control state is derived from THIS, never from the contact's status alone.
   */
  openInvitation: { id: string; legacy: boolean; expiresAt: string | null } | null
}

export interface SafeguardingAppointment {
  assignmentId: string
  userId: string
  officerType: OfficerType
  /** PENDING_CONFIRMATION until Ovalball confirms it; CONFIRMED afterwards. Confers nothing before. */
  confirmationState: string | null
  /** ACTIVE or SUSPENDED -- a revoked appointment is not returned. */
  state: string
  personName: string | null
}

export interface ClubSafeguardingState {
  officers: SafeguardingOfficerContact[]
  pending: SafeguardingAppointment[]
  confirmed: SafeguardingAppointment[]
  hasPrimary: boolean
  hasDeputy: boolean
}

export const OFFICER_TYPE_LABEL: Record<OfficerType, string> = {
  primary: "Safeguarding Officer",
  deputy: "Deputy Safeguarding Officer",
}

export const OFFICER_STATUS_LABEL: Record<OfficerContactStatus, string> = {
  not_invited: "Not Invited",
  invite_sent: "Invite Sent",
  active: "Active",
  inactive: "Inactive",
}

/** The website's sentence for the middle of the state machine, word for word. */
export const PENDING_CONFIRMATION_EXPLANATION =
  "Nominated by the club and waiting for Ovalball to confirm the appointment. Until it is confirmed they hold no Safeguarding Officer authority."

function officerType(value: string | null | undefined): OfficerType {
  return value === "deputy" ? "deputy" : "primary"
}

/**
 * The same two records the website reads, and for the same reason it reads both: the CONTACT register
 * (`get_club_safeguarding_officers`, written by the invite-an-outsider path) and the APPOINTMENT
 * (`role_assignments`, the 4G state machine a nominated member enters). RLS decides who sees which;
 * the shape is reported exactly as stored. Names come from the club's authorised directory, the same
 * call the website makes, and are never a contact detail.
 */
export async function readClubSafeguarding(supabase: Client, clubId: string): Promise<ClubSafeguardingState> {
  const [officersResult, assignmentsResult, invitationsResult] = await Promise.all([
    supabase.rpc("get_club_safeguarding_officers", { p_club_id: clubId }),
    supabase
      .from("role_assignments")
      .select("id, user_id, attributes, confirmation_state, state, granted_at")
      .eq("club_id", clubId)
      .eq("role_key", "SAFEGUARDING_OFFICER")
      .is("team_id", null)
      .in("state", ["ACTIVE", "SUSPENDED"])
      .order("granted_at"),
    supabase.from("invitations_admin_view").select("id, intended_outcome, expires_at").eq("club_id", clubId).eq("kind", "SAFEGUARDING_OFFICER").eq("state", "ISSUED"),
  ])
  if (officersResult.error) throw officersResult.error

  const openByOfficer = new Map<string, { id: string; expiresAt: string | null }>()
  for (const row of invitationsResult.data ?? []) {
    const outcome = (row.intended_outcome ?? {}) as { officer_id?: string }
    if (row.id && outcome.officer_id) openByOfficer.set(outcome.officer_id, { id: row.id, expiresAt: row.expires_at ?? null })
  }

  const officers: SafeguardingOfficerContact[] = (officersResult.data ?? []).map((o) => {
    const canonical = openByOfficer.get(o.id)
    const openInvitation = canonical
      ? { id: canonical.id, legacy: false, expiresAt: canonical.expiresAt }
      : o.pending_invitation_id
        ? { id: o.pending_invitation_id, legacy: true, expiresAt: o.pending_invitation_expires_at ?? null }
        : null
    return {
      id: o.id,
      officerType: officerType(o.officer_type),
      contactName: o.contact_name,
      contactEmail: o.contact_email,
      status: (o.status as OfficerContactStatus) ?? "not_invited",
      userId: o.user_id ?? null,
      openInvitation,
    }
  })

  const assignmentRows = (assignmentsResult.data ?? []).filter((row): row is typeof row & { id: string; user_id: string } => Boolean(row.id && row.user_id))
  let names = new Map<string, string>()
  if (assignmentRows.length > 0) {
    const { data: directory } = await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
    names = new Map((directory ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
  }
  const appointments: SafeguardingAppointment[] = assignmentRows.map((row) => {
    const attributes = (row.attributes ?? {}) as { officer_type?: string }
    return {
      assignmentId: row.id,
      userId: row.user_id,
      officerType: officerType(attributes.officer_type),
      confirmationState: row.confirmation_state,
      state: row.state ?? "ACTIVE",
      personName: names.get(row.user_id) || null,
    }
  })

  const pending = appointments.filter((a) => a.confirmationState === "PENDING_CONFIRMATION")
  const confirmed = appointments.filter((a) => a.confirmationState !== "PENDING_CONFIRMATION")
  const heldFor = (t: OfficerType) => officers.some((o) => o.officerType === t) || appointments.some((a) => a.officerType === t)
  return { officers, pending, confirmed, hasPrimary: heldFor("primary"), hasDeputy: heldFor("deputy") }
}

// ---------------------------------------------------------------------------------------------------
// NOMINATION: the canonical member path (the 4G state machine) and the contact card.
// ---------------------------------------------------------------------------------------------------

export interface NominationCandidate {
  userId: string
  name: string
}

/** Active members of THIS club, from the club's authorised directory. No contact detail is carried. */
export async function readNominationCandidates(supabase: Client, clubId: string): Promise<NominationCandidate[]> {
  const { data, error } = await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
  if (error) throw error
  return (data ?? [])
    .map((p) => ({ userId: p.user_id, name: [p.first_name, p.surname].filter(Boolean).join(" ") }))
    .filter((p) => p.userId && p.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type MemberNominationOutcome = { outcome: "PENDING_CONFIRMATION"; assignmentId: string | null } | { outcome: "INVITATION_REQUIRED"; reason: string }

/**
 * Nominate an existing ACTIVE member of this club. Enters PENDING_CONFIRMATION and confers nothing
 * until Ovalball confirms it (AN-6). Anybody who is not a member here comes back INVITATION_REQUIRED,
 * which is an answer rather than an error: nominate them as a contact and invite them instead.
 */
export async function nominateClubMemberAsOfficer(
  supabase: Client,
  input: { clubId: string; userId: string; officerType: OfficerType; reason?: string }
): Promise<MemberNominationOutcome> {
  const { data, error } = await supabase.rpc("nominate_club_safeguarding_officer", {
    p_club_id: input.clubId,
    p_user_id: input.userId,
    p_officer_type: input.officerType,
    p_reason: input.reason?.trim() || undefined,
  })
  if (error) throw error
  const result = (data ?? {}) as { outcome?: string; assignment_id?: string; reason?: string }
  if (result.outcome === "INVITATION_REQUIRED") return { outcome: "INVITATION_REQUIRED", reason: result.reason ?? "That person is not a member of this club." }
  return { outcome: "PENDING_CONFIRMATION", assignmentId: result.assignment_id ?? null }
}

/** The CONTACT record only. Grants nothing: status starts not_invited. */
export async function nominateSafeguardingContact(
  supabase: Client,
  input: { clubId: string; officerType: OfficerType; contactName: string; contactEmail: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("nominate_safeguarding_officer", {
    p_club_id: input.clubId,
    p_officer_type: input.officerType,
    p_contact_name: input.contactName.trim(),
    p_contact_email: input.contactEmail.trim(),
  })
  if (error) throw error
  return data as string
}

export async function updateSafeguardingOfficerContact(supabase: Client, officerId: string, contactName: string, contactEmail: string): Promise<void> {
  const { error } = await supabase.rpc("update_safeguarding_officer_contact", {
    p_officer_id: officerId,
    p_contact_name: contactName.trim(),
    p_contact_email: contactEmail.trim(),
  })
  if (error) throw error
}

/** Ends the assignment. The server transfers the officer's conversations to a remaining confirmed officer or tells Ovalball there is none. */
export async function deactivateSafeguardingOfficer(supabase: Client, officerId: string): Promise<void> {
  const { error } = await supabase.rpc("deactivate_safeguarding_officer", { p_officer_id: officerId })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// THE INVITATION: issued by the canonical issuer, the link shown once, no email from the phone.
// ---------------------------------------------------------------------------------------------------

export interface IssuedSafeguardingInvitation {
  invitationId: string
  /** The canonical `/join?t=` link. Held in memory for one showing and never stored. */
  joinUrl: string
}

/** The canonical invitation address, the same one the website emails. */
export function safeguardingJoinUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/$/, "")}/join?t=${encodeURIComponent(token)}`
}

function issued(webUrl: string, data: { invitation_id: string; token: string }[] | { invitation_id: string; token: string } | null): IssuedSafeguardingInvitation {
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.invitation_id || !row.token) throw new Error("The invitation was not created.")
  return { invitationId: row.invitation_id, joinUrl: safeguardingJoinUrl(webUrl, row.token) }
}

export async function inviteSafeguardingOfficer(supabase: Client, officerId: string, webUrl: string): Promise<IssuedSafeguardingInvitation> {
  const { data, error } = await supabase.rpc("invite_safeguarding_officer", { p_officer_id: officerId })
  if (error) throw error
  return issued(webUrl, data)
}

/** Reissues the secret on the SAME invitation: the old link stops working and the new one is shown once. */
export async function resendSafeguardingOfficerInvitation(supabase: Client, officerId: string, webUrl: string): Promise<IssuedSafeguardingInvitation> {
  const { data, error } = await supabase.rpc("resend_safeguarding_officer_invitation", { p_officer_id: officerId })
  if (error) throw error
  return issued(webUrl, data)
}

/**
 * Withdraws an open invitation. A canonical row goes through `revoke_invitation`, which records the
 * reason; a legacy row goes through the website's own `revoke_safeguarding_officer_invitation`.
 */
export async function revokeSafeguardingOfficerInvitation(supabase: Client, invitation: { id: string; legacy: boolean }, reason: string): Promise<void> {
  if (invitation.legacy) {
    const { error } = await supabase.rpc("revoke_safeguarding_officer_invitation", { p_invitation_id: invitation.id })
    if (error) throw error
    return
  }
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitation.id, p_reason: reason })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// REACHING THE OFFICER, AND THE CONVERSATION ITSELF.
// ---------------------------------------------------------------------------------------------------

export type MessageOfficerResult = { mode: "ovalball"; conversationId: string } | { mode: "no-account" }

/**
 * Opens (or finds) the one conversation between this person and the club's officer, exactly as the
 * website and the Rugby Hub do. ONLY 22023 means "no active, registered officer to message on
 * Ovalball": the website falls back to a server-sent email there, which the phone cannot send, so it
 * answers `no-account` and the screen offers the officer's own recorded address instead. Every other
 * error -- 42501 above all -- is a refusal and is thrown as one.
 */
export async function messageSafeguardingOfficer(supabase: Client, clubId: string, officerId: string, body: string): Promise<MessageOfficerResult> {
  const text = body.trim()
  if (!text) throw new Error("Write a message first.")
  const { data, error } = await supabase.rpc("start_or_get_safeguarding_officer_conversation", { p_club_id: clubId, p_officer_id: officerId, p_first_message: text })
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    const conversationId = (row as { conversation_id?: string } | null)?.conversation_id
    if (conversationId) return { mode: "ovalball", conversationId }
    throw new Error("The conversation could not be opened.")
  }
  if (error.code === "22023") return { mode: "no-account" }
  throw error
}

export interface SafeguardingThread {
  conversationId: string
  clubId: string
  requesterUserId: string
  officerUserId: string
  createdAt: string
  requesterName: string | null
  lastMessageAt: string | null
  /** Ovalball opened this thread and recorded why (AN-9). Visible to the club's officers only. */
  reviewedAt: string | null
}

/**
 * The conversations this person may see: their own as requester, or the club's as a confirmed officer.
 * RLS on `club_safeguarding_officer_conversations` is the boundary. No message body is read here.
 */
export async function readSafeguardingThreads(supabase: Client, clubId: string): Promise<SafeguardingThread[]> {
  const { data, error } = await supabase
    .from("club_safeguarding_officer_conversations")
    .select("id, club_id, requester_user_id, officer_user_id, created_at")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false })
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const [activity, reviews, directory] = await Promise.all([
    supabase.from("fixture_messages").select("safeguarding_conversation_id, created_at").in("safeguarding_conversation_id", ids).order("created_at", { ascending: false }),
    supabase.from("safeguarding_thread_reviews").select("conversation_id, reviewed_at").in("conversation_id", ids).order("reviewed_at", { ascending: false }),
    supabase.rpc("get_club_member_directory", { p_club_id: clubId }),
  ])
  const lastAt = new Map<string, string>()
  for (const m of activity.data ?? []) if (m.safeguarding_conversation_id && !lastAt.has(m.safeguarding_conversation_id)) lastAt.set(m.safeguarding_conversation_id, m.created_at)
  const reviewedAt = new Map<string, string>()
  for (const r of reviews.data ?? []) if (!reviewedAt.has(r.conversation_id)) reviewedAt.set(r.conversation_id, r.reviewed_at)
  const names = new Map((directory.data ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ")]))

  return rows
    .map((r) => ({
      conversationId: r.id,
      clubId: r.club_id,
      requesterUserId: r.requester_user_id,
      officerUserId: r.officer_user_id,
      createdAt: r.created_at,
      requesterName: names.get(r.requester_user_id) || null,
      lastMessageAt: lastAt.get(r.id) ?? null,
      reviewedAt: reviewedAt.get(r.id) ?? null,
    }))
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
}

export interface SafeguardingMessage {
  id: string
  senderUserId: string | null
  body: string
  createdAt: string
}

export interface SafeguardingThreadDetail {
  /** Oldest first, as the canonical reader returns them. */
  messages: SafeguardingMessage[]
  /** Each time Ovalball opened this thread, with the reason it recorded. */
  reviews: { reviewedAt: string; reason: string }[]
}

/** The thread body, under `fixture_messages_select_scoped` -- the same boundary the website's reader relies on. */
export async function readSafeguardingThread(supabase: Client, conversationId: string): Promise<SafeguardingThreadDetail> {
  const [messages, reviews] = await Promise.all([
    supabase.from("fixture_messages").select("id, sender_user_id, body, created_at").eq("safeguarding_conversation_id", conversationId).order("created_at", { ascending: true }),
    supabase.from("safeguarding_thread_reviews").select("reviewed_at, reason").eq("conversation_id", conversationId).order("reviewed_at", { ascending: false }),
  ])
  if (messages.error) throw messages.error
  return {
    messages: (messages.data ?? []).map((m) => ({ id: m.id, senderUserId: m.sender_user_id ?? null, body: m.body ?? "", createdAt: m.created_at })),
    reviews: (reviews.data ?? []).map((r) => ({ reviewedAt: r.reviewed_at, reason: r.reason })),
  }
}

export async function sendSafeguardingThreadMessage(supabase: Client, conversationId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("send_safeguarding_officer_message", { p_conversation_id: conversationId, p_body: body.trim() })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// THE OFFICER'S READS: dispensations, a reasoned welfare lookup, and the club's reported messages.
// ---------------------------------------------------------------------------------------------------

export interface OfficerDispensation {
  id: string
  status: string
  playerName: string
  sourceTeamName: string
  targetTeamName: string
  seasonName: string
  eligibilityRuleReference: string
  governingBodyReference: string | null
  createdAt: string
}

export const DISPENSATION_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  source_team_approved: "Team Approved",
  club_approved: "Club Approved",
  approved: "Approved",
  rejected: "Declined",
  expired: "Expired",
  revoked: "Revoked",
}

/**
 * The club's dispensations, under `player_team_dispensation_select`: the officer's grant is one branch
 * of that policy and the rows are whatever it allows. Read-only -- deciding is somebody else's job and
 * the officer's grant carries none of it. `decision_reason` is deliberately not selected.
 */
export async function readOfficerDispensations(supabase: Client, clubId: string): Promise<OfficerDispensation[]> {
  const { data: teams, error: teamsError } = await supabase.from("teams").select("id").eq("club_id", clubId)
  if (teamsError) throw teamsError
  const teamIds = (teams ?? []).map((t) => t.id)
  if (teamIds.length === 0) return []
  const { data, error } = await supabase
    .from("player_team_dispensation")
    .select("id, status, eligibility_rule_reference, governing_body_reference, player_id, created_at, source_team:source_team_id(display_name), target_team:target_team_id(display_name), seasons(name)")
    .in("source_team_id", teamIds)
    .order("created_at", { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const players = await loadStaffPlayers(supabase, rows.map((r) => r.player_id))
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    playerName: players.get(r.player_id)?.displayName || "A player",
    sourceTeamName: r.source_team?.display_name ?? "A team",
    targetTeamName: r.target_team?.display_name ?? "A team",
    seasonName: r.seasons?.name ?? "This season",
    eligibilityRuleReference: r.eligibility_rule_reference,
    governingBodyReference: r.governing_body_reference ?? null,
    createdAt: r.created_at,
  }))
}

export interface WelfareCandidate {
  playerId: string
  name: string
}

/** Players this person may already see by name (`player_staff_view`); the lookup itself is judged again per player. */
export async function searchWelfareCandidates(supabase: Client, query: string): Promise<WelfareCandidate[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const pattern = `%${q.replace(/[%_]/g, "")}%`
  const { data, error } = await supabase.from("player_staff_view").select("id, first_name, surname").eq("active", true).or(`first_name.ilike.${pattern},surname.ilike.${pattern}`).limit(20)
  if (error) throw error
  return (data ?? [])
    .filter((p): p is typeof p & { id: string } => Boolean(p.id))
    .map((p) => ({ playerId: p.id, name: [p.first_name, p.surname].filter(Boolean).join(" ") }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface WelfareRecord {
  playerName: string
  teamName: string | null
  guardianName: string | null
  guardianContact: string | null
  guardianState: string | null
}

/** A reasoned lookup. The server refuses without a reason and records the one given as a security event. */
export async function lookupWelfare(supabase: Client, playerId: string, reason: string): Promise<WelfareRecord[]> {
  const { data, error } = await supabase.rpc("welfare_member_view", { p_player_id: playerId, p_reason: reason.trim() })
  if (error) throw error
  return (data ?? []).map((r) => ({
    playerName: r.player_name,
    teamName: r.team_name || null,
    guardianName: r.guardian_name || null,
    guardianContact: r.guardian_contact || null,
    guardianState: r.guardian_state || null,
  }))
}

export interface ReportedMessage {
  id: string
  messageId: string
  reason: string
  status: string
  createdAt: string
  reporterName: string | null
  messageBody: string
  messageSentAt: string
  messageDeletedAt: string | null
}

/** The club's reported messages, gated by the server on `messaging.moderation.club_review`. Decisions are Ovalball's. */
export async function readClubMessageReports(supabase: Client, clubId: string): Promise<ReportedMessage[]> {
  const { data, error } = await supabase.rpc("club_message_reports", { p_club_id: clubId })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    messageId: r.message_id,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
    reporterName: r.reporter_name || null,
    messageBody: r.message_body ?? "",
    messageSentAt: r.message_sent_at,
    messageDeletedAt: r.message_deleted_at ?? null,
  }))
}

/**
 * What a person reads when the server refuses. The safeguarding operations raise product-language
 * sentences on purpose, so those are shown as they are; anything else falls back to the caller's.
 */
export function safeguardingErrorMessage(cause: unknown, fallback: string): string {
  const e = (cause ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23505" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}
