"use server"

import { revalidatePath } from "next/cache"

import { resolveClubCrestEmailUrl } from "@/lib/email/club-crest"
import { sendEmailEvent } from "@/lib/email/send"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import type { InvitationShareData } from "@/components/invitations/invitation-share"
import {
  describeIntendedOutcome,
  invitationExpiryLabel,
  invitationJoinUrl,
  invitationQrSvg,
  outcomeLines,
} from "@/lib/invitations/share"
import { clubRoleLabel } from "@/lib/permissions/role-labels"
import { roleKeyLabel } from "@/lib/permissions/role-presentation"
import { createClient } from "@/lib/supabase/server"
import { peopleErrorMessage, removeTeamAccess, setPrimaryClubRole, transitionMembership } from "@ovalball/contracts/club/people"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"
import { guardAction } from "@/lib/auth/action-boundary"

export type InviteResult = { ok: true; share: InvitationShareData } | { ok: false; error: string }

export interface InviteInput {
  clubId: string
  clubName: string
  email: string
  declaredRole: string
  /** A role key from `invitationStaffRoleOptions`, never a word invented at the call site. */
  clubRole: string | null
  teamAssignments: { teamId: string; roleKey: string; teamName?: string }[]
}

export type StaffRoleOption = { roleKey: string; label: string; heldAtTeam: boolean }

/**
 * What a staff invitation may carry, from the role catalogue. The database narrows it to the O.1
 * ceiling and to roles the catalogue marks visible, so the form and the issuer cannot disagree about
 * what a staff invitation can produce.
 */
export async function invitationStaffRoleOptions(): Promise<StaffRoleOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("invitation_staff_role_options")
  if (error) {
    console.error("invitation_staff_role_options failed:", error)
    return []
  }
  // The catalogue's own wording, except where the product has settled on a
  // different one: it spells the club's fixtures role "Fixtures Secretary" and
  // every other surface in Ovalball says "Fixture Secretary", so somebody
  // inviting a Fixture Secretary was offered a differently-named role from the
  // one they would later see on the person's row. Mapped in presentation only --
  // the key is untouched, nothing authorises off the string, and the catalogue
  // stays the authority for every role whose wording is not in dispute.
  return (data ?? []).map((row) => ({
    roleKey: row.role_key,
    label: roleKeyLabel(row.role_key, row.label),
    heldAtTeam: row.held_at_team,
  }))
}


/**
 * The canonical club staff invitation.
 *
 * `public.issue_invitation` is the authority: it checks that the caller may invite for this club,
 * that every role is within what O.1 allows a staff invitation to carry, and that every team named
 * is an active team of THIS club. The link token and the human code are returned once, at issue, and
 * only their hashes are stored -- so this is the only moment either exists, and nothing can read
 * them back afterwards.
 *
 * The invitation grants nothing by existing. Redemption, reached from /join, is the only path from
 * here to a membership or a role, and it requires the recipient's own authenticated session to match
 * the address the invitation was sent to.
 */

export async function createInvitation(input: InviteInput): Promise<InviteResult> {
  const supabase = await createClient()

  const clubRoles = input.clubRole ? [input.clubRole] : []

  // Teams are grouped by the role they are being given, because one invitation can legitimately make
  // somebody Coach of one team and Team Manager of another -- and flattening that would hand both
  // roles to both teams. Nothing here validates the role: `issue_invitation` does, against the same
  // catalogue the options came from.
  const teamRoles: { id: string; roles: string[] }[] = []
  for (const assignment of input.teamAssignments) {
    const existing = teamRoles.find((t) => t.id === assignment.teamId)
    if (existing) existing.roles.push(assignment.roleKey)
    else teamRoles.push({ id: assignment.teamId, roles: [assignment.roleKey] })
  }

  if (clubRoles.length === 0 && teamRoles.length === 0) {
    return { ok: false, error: "Choose a club role, a team role, or both." }
  }

  const { data, error } = await supabase
    .rpc("issue_invitation", {
      p_kind: "CLUB_STAFF",
      p_club_id: input.clubId,
      p_email: input.email.trim().toLowerCase(),
      p_intended_outcome: { roles: clubRoles, declared_role: input.declaredRole || null },
      p_team_roles: teamRoles.length > 0 ? teamRoles : undefined,
    })
    .maybeSingle()

  if (error || !data) {
    console.error("createInvitation failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  // An identical invitation already out there is returned rather than reissued, and deliberately
  // without a second live secret -- so the honest answer is that one is already on its way.
  if (data.already_existed || !data.token) {
    return { ok: false, error: "That person already has an invitation to this club waiting to be accepted." }
  }

  // The link, the code and the QR are three ways to pass on ONE credential, and
  // this is the only moment any of them exists: Ovalball stores only their
  // hashes. Building the share panel's contents here, from what the authority
  // just returned, is what makes that a product fact rather than a limitation
  // somebody discovers later.
  const inviteLink = invitationJoinUrl(data.token)
  const teamNames = new Map(input.teamAssignments.map((a) => [a.teamId, a.teamName ?? "A team"]))
  const roleOptions = await invitationStaffRoleOptions()
  const roleLabels = new Map(roleOptions.map((o) => [o.roleKey, o.label]))
  const share: InvitationShareData = {
    url: inviteLink,
    code: data.code ?? null,
    qrSvg: await invitationQrSvg(inviteLink),
    outcome: outcomeLines(
      describeIntendedOutcome(
        { roles: clubRoles, teams: teamRoles },
        (id) => teamNames.get(id) ?? "A team",
        (key) => roleLabels.get(key) ?? clubRoleLabel(key)
      )
    ),
    expiresLabel: invitationExpiryLabel(data.expires_at ?? null),
    sentTo: input.email.trim().toLowerCase(),
  }

  // Recipient is resolved from the invitation ROW, not from `input.email`: the address is a property
  // of the invitation this action just created under its own authorization, never an argument the
  // browser can aim.
  await sendEmailEvent({
    supabase,
    eventKey: "club_invitation",
    idempotencyKey: `club_invitation:${data.invitation_id}`,
    recipient: { kind: "access_invitation", invitationId: data.invitation_id },
    data: {
      clubName: input.clubName,
      clubLogoUrl: await resolveClubCrestEmailUrl(supabase, input.clubId),
      inviteToken: data.token,
      roleLabel: input.declaredRole || null,
    },
  })

  revalidatePath("/people")
  return { ok: true, share }
}

/**
 * RESEND -- WHICH IS A REISSUE, AND THE PRODUCT SAYS SO.
 *
 * `resend_invitation` does not email the old secret again, and could not: only
 * the hashes are stored. It ROTATES both the token and the code, so the previous
 * link and code stop working the moment it returns, refreshes the expiry from
 * the kind's own lifetime, keeps the intended outcome and the audit lineage, and
 * records the resend. That makes it the remedy for a link sent to the wrong
 * address as well as for one that was lost -- which is worth saying out loud,
 * because "resend" normally implies the opposite.
 *
 * It refuses anything that is not still ISSUED, so a redeemed, revoked or
 * expired invitation cannot be quietly brought back to life.
 */
export async function resendInvitation(invitationId: string): Promise<InviteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("resend_invitation", { p_invitation_id: invitationId }).maybeSingle()
  if (error || !data?.token) {
    console.error("resendInvitation failed:", error)
    return { ok: false, error: error?.message ?? toPublicSubmissionError() }
  }

  // The recipient is resolved from the invitation ROW by the email layer, never
  // from an argument this action could aim somewhere else.
  const { data: row } = await supabase
    .from("invitations_admin_view")
    .select("club_id, invited_email_normalised, intended_outcome")
    .eq("id", invitationId)
    .maybeSingle()

  const url = invitationJoinUrl(data.token)
  if (row?.club_id) {
    const { data: club } = await supabase.from("clubs").select("club_directory(name)").eq("id", row.club_id).maybeSingle()
    await sendEmailEvent({
      supabase,
      eventKey: "club_invitation",
      idempotencyKey: `club_invitation:${invitationId}:resend:${data.expires_at}`,
      recipient: { kind: "access_invitation", invitationId },
      data: {
        clubName: (club?.club_directory as unknown as { name: string } | null)?.name ?? "your club",
        clubLogoUrl: await resolveClubCrestEmailUrl(supabase, row.club_id),
        inviteToken: data.token,
        roleLabel: null,
      },
    })
  }

  const roleOptions = await invitationStaffRoleOptions()
  const roleLabels = new Map(roleOptions.map((o) => [o.roleKey, o.label]))
  const { data: teams } = row?.club_id
    ? await supabase.from("teams").select("id, display_name").eq("club_id", row.club_id)
    : { data: [] }
  const teamNames = new Map((teams ?? []).map((t) => [t.id, t.display_name]))

  revalidatePath("/people", "layout")
  return {
    ok: true,
    share: {
      url,
      code: data.code ?? null,
      qrSvg: await invitationQrSvg(url),
      outcome: outcomeLines(
        describeIntendedOutcome(
          row?.intended_outcome,
          (id) => teamNames.get(id) ?? "A team",
          (key) => roleLabels.get(key) ?? clubRoleLabel(key)
        )
      ),
      expiresLabel: invitationExpiryLabel(data.expires_at ?? null),
      sentTo: row?.invited_email_normalised ?? null,
      replacesPrevious: true,
    },
  }
}

/**
 * THE CANONICAL REVOCATION, AGAINST THE TABLE THE INVITATION IS ACTUALLY IN.
 *
 * This used to write `status = 'revoked'` straight into `public.invitations`.
 * That table is not where invitations live: `issue_invitation` -- the authority
 * `createInvitation` above has called since Slice 5 -- writes
 * `public.access_invitations`, and `public.invitations` has held zero rows ever
 * since. So the update matched nothing, returned no error, and the button
 * reported success. It was never reachable anyway, because the page listing
 * pending invitations read the same empty table and therefore never drew a row.
 *
 * `revoke_invitation` is the authority: it checks the caller may revoke THIS
 * invitation, records who revoked it and why, and refuses to revoke one that
 * has already been redeemed. A reason is required, so one is always sent.
 */
export async function revokeInvitation(invitationId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: invitationId,
    p_reason: reason.trim() || "Withdrawn by the club.",
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * GIVES AN EXISTING MEMBER A ROLE AT ONE TEAM, FROM THE PAGE ABOUT THAT PERSON.
 *
 * `set_team_access` is not new and is not unused: `assignTeamMember` on
 * /teams/[teamId] has called it since the team surface was built. What was
 * missing was the CLUB-scope way in. A Club Admin looking at one person could
 * see every team role they held and change none of them, because the only place
 * a team role could be given was the page for one team, one team at a time --
 * so "give Nadia Coach at the U14s" started by working out which page the U14s
 * were on. The same authority, reached from the person instead of the team.
 *
 * Nothing is validated here. The permission comes from the canonical team role
 * list and the database decides whether this caller may set it on this team --
 * it refuses self-assignment, refuses to let Team Administration hand out or
 * reassign Team Admin, and enforces the adult-record rule for staff roles.
 */
export async function grantTeamAccess(
  membershipId: string,
  teamId: string,
  permission: string,
  reason: string
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_team_access", {
    p_membership_id: membershipId,
    p_team_id: teamId,
    p_permission: permission,
    p_reason: reason.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people", "layout")
  // The team's own page lists exactly this relationship, so it is refreshed too.
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  return { ok: true }
}

/** `href` names where to go when the refusal is a recent-authenticator one (`/security/verify`). */
export type MembershipActionResult = { ok: true } | { ok: false; error: string; href?: string }

/**
 * set_primary_club_role is the boundary: it checks the caller is this club's
 * Club Admin (or a Full Site Admin), never leaves the club without a Club
 * Admin, and records the change as role assignments with a security event.
 */
export async function updateMembershipRole(
  membershipId: string,
  role: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY",
  reason = ""
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  // CA-M3: the shared wrapper, with the reason the server may record (required only for a site actor
  // -- the one shared list, REASON_REQUIRED_OPERATIONS, says so for both clients).
  try {
    await setPrimaryClubRole(supabase, membershipId, role, reason)
  } catch (error) {
    return { ok: false, error: peopleErrorMessage(error, "The role could not be changed. Please try again.") }
  }
  revalidatePath("/people")
  return { ok: true }
}

/** Suspend or restore a membership (transition_club_membership; a reason is always required). */
export async function setMembershipSuspended(membershipId: string, suspended: boolean, reason: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  // people.membership.suspend is `R`: the database asks for a code entered within the last ten minutes
  // after it has checked the capability; this boundary asks the same question first so the person is
  // sent somewhere useful. The database remains the boundary of record.
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await transitionMembership(supabase, membershipId, suspended ? "SUSPENDED" : "ACTIVE", reason)
  } catch (error) {
    return {
      ok: false,
      error: peopleErrorMessage(error, "The membership could not be changed. Please try again."),
      href: isRecentAuthRefusal(error) ? "/security/verify" : undefined,
    }
  }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Removes someone from the club: the membership becomes REVOKED history
 * (never deleted, never switched back on) and every role it held ends with
 * it. transition_club_membership requires the reason and refuses to remove
 * the club's last Club Admin.
 */
export async function revokeMembership(membershipId: string, reason: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  // people.membership.revoke is `R` -- the same recent-authenticator rule as a suspension.
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await transitionMembership(supabase, membershipId, "REVOKED", reason)
  } catch (error) {
    return {
      ok: false,
      error: peopleErrorMessage(error, "The membership could not be removed. Please try again."),
      href: isRecentAuthRefusal(error) ? "/security/verify" : undefined,
    }
  }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Ends a person's Coach, Team Manager and Team Admin roles on one team.
 *
 * The team id is carried purely so the TEAM's own page can be refreshed. One
 * relationship has two legitimate consumers -- the page about the person and the
 * page about the team -- and revalidating only the one you happened to act from
 * leaves the other free to serve a cached render of a role that no longer exists.
 * A hard reload was always correct; this is about the client router cache, which
 * a person navigating between the two pages would hit and a test using full page
 * loads would not.
 */
export async function removeTeamAssignment(teamPermissionId: string, teamId: string, reason = ""): Promise<MembershipActionResult> {
  const supabase = await createClient()
  try {
    await removeTeamAccess(supabase, teamPermissionId, reason)
  } catch (error) {
    return { ok: false, error: peopleErrorMessage(error, "The team role could not be removed. Please try again.") }
  }
  revalidatePath("/people", "layout")
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  return { ok: true }
}

/**
 * Approves or declines a request to join the club. decide_club_join_request
 * checks the caller's authority, refuses a request that has already been
 * decided, and requires a reason to decline.
 */
export async function decideJoinRequest(
  requestId: string,
  decision: "APPROVE" | "DECLINE",
  reason: string
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("decide_club_join_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * ADDITIONAL CLUB ROLES — the ones that are not the primary seat.
 *
 * `set_primary_club_role` decides one three-way seat: Member, Fixture
 * Secretary or Club Admin. A person is not only one of those. Volunteer is a
 * canonical club role that `role_definitions` says a Club Admin may assign
 * (`assignable_by = {SITE,CLUB}`), and until now no screen could.
 *
 * This calls `assign_role`, the canonical primitive, which enforces the
 * delegation ceiling itself -- and refuses Safeguarding Officer outright,
 * because an officer is nominated and accepts rather than being assigned.
 * Nothing here decides anything; a role this caller may not give is refused by
 * the database with 42501 whether or not the control was shown.
 */
export async function assignAdditionalRole(
  membershipId: string,
  roleKey: string,
  teamId: string | null,
  reason: string,
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("assign_role", {
    p_membership_id: membershipId,
    p_role_key: roleKey,
    p_team_id: teamId as unknown as string,
    p_reason: reason.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message || "That role could not be given." }
  revalidatePath(`/people/${membershipId}`)
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Ends ONE role assignment.
 *
 * Deliberately narrow: it names the assignment, not the person. Removing
 * somebody's Coach role at one team must leave their Team Manager role at
 * another, their membership, their family relationships and any unrelated
 * explicit grant exactly as they were -- which is what
 * `transition_role_assignment` already guarantees, and what
 * `supabase/tests/step8_operational_access.sql` section D proves.
 */
export async function endRoleAssignment(
  membershipId: string,
  assignmentId: string,
  reason: string,
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("transition_role_assignment", {
    p_assignment_id: assignmentId,
    p_to_state: "REVOKED",
    p_reason: reason.trim() || undefined,
    p_allow_no_club_admin: false,
  })
  if (error) return { ok: false, error: error.message || "That role could not be removed." }
  revalidatePath(`/people/${membershipId}`)
  revalidatePath("/people")
  return { ok: true }
}
