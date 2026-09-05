"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { searchUkAddresses, type AddressLookupResult } from "@/lib/address-lookup/lookup"

import { requireSiteAdmin } from "../../require-site-admin"

/** Thin server-action wrapper -- searchUkAddresses itself is the real integration, see its own doc comment. */
export async function lookupAddress(query: string): Promise<AddressLookupResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "club_data"])
  if (!auth.ok) return { status: "error", message: auth.error }
  if (query.trim().length < 3) return { status: "ok", candidates: [] }
  return searchUkAddresses(query)
}

export type ActionResult = { ok: true } | { ok: false; error: string }

export interface DirectoryFieldsInput {
  directoryId: string
  name: string
  rugbyCode: "union" | "league"
  country: string
  nation: "England" | "Scotland" | "Wales" | "Northern Ireland"
  region: string
  county: string
  town: string
  homeGround: string
  address: string
  postcode: string
  website: string
  officialEmail: string
  active: boolean
  verificationStatus: string
  notes: string
  constituentBody: string
}

/**
 * Canonical fields only -- never source/external_id/source_url/
 * source_updated_at, which have their own action below. RLS
 * (club_directory_update_admin: is_site_admin()) is the actual boundary;
 * requireSiteAdmin here just gives a real error instead of a confusing
 * RLS rejection if a non-admin session somehow reaches this action.
 */
export async function updateDirectoryFields(input: DirectoryFieldsInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!input.name.trim()) return { ok: false, error: "Club name is required." }

  const { error } = await supabase
    .from("club_directory")
    .update({
      name: input.name.trim(),
      // rugby_code is deliberately NOT here -- internal.prevent_casual_rugby_code_change()
      // rejects any attempt to change it through this ordinary update at
      // the database level regardless of what this action sends, and
      // correctClubRugbyCode() below is the only real path. Omitting it
      // here (rather than sending the unchanged current value) means this
      // update can never even attempt the change.
      country: input.country.trim() || "United Kingdom",
      nation: input.nation,
      region: input.region.trim() || null,
      county: input.county.trim() || null,
      town: input.town.trim() || null,
      home_ground: input.homeGround.trim() || null,
      address: input.address.trim() || null,
      postcode: input.postcode.trim() || null,
      website: input.website.trim() || null,
      official_email: input.officialEmail.trim() || null,
      active: input.active,
      verification_status: input.verificationStatus.trim() || "unverified",
      notes: input.notes.trim() || null,
      constituent_body: input.constituentBody.trim() || null,
    })
    .eq("id", input.directoryId)

  if (error) {
    console.error("updateDirectoryFields failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  revalidatePath("/admin/clubs")
  return { ok: true }
}

/**
 * The ONLY path that can ever change club_directory.rugby_code -- Full
 * Site Admin only, with a mandatory reason, calling
 * correct_club_rugby_code() (which itself re-checks authorization and
 * writes the audit row; requireSiteAdmin here just gives a clean error
 * instead of a raw RLS/trigger rejection).
 */
export async function correctClubRugbyCode(directoryId: string, newCode: "union" | "league", reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error: rpcError } = await supabase.rpc("correct_club_rugby_code", {
    p_directory_id: directoryId,
    p_new_code: newCode,
    p_reason: reason,
  })
  if (rpcError) return { ok: false, error: rpcError.message }

  revalidatePath(`/admin/clubs/${directoryId}`)
  revalidatePath("/admin/clubs")
  return { ok: true }
}

export interface ProvenanceInput {
  directoryId: string
  source: string
  externalId: string
  sourceUrl: string
}

/**
 * Deliberately separate from updateDirectoryFields -- provenance fields
 * (source/external_id/source_url) identify where a canonical record came
 * from, and casually overwriting them from the same form as "town" or
 * "postcode" is exactly the kind of accidental edit the brief calls out.
 * Same RLS boundary, just a second, explicit action so the UI can put a
 * real "I'm editing provenance data" step in front of it.
 */
export async function updateProvenance(input: ProvenanceInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("club_directory")
    .update({
      source: input.source.trim(),
      external_id: input.externalId.trim() || null,
      source_url: input.sourceUrl.trim() || null,
    })
    .eq("id", input.directoryId)

  if (error) {
    console.error("updateProvenance failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  return { ok: true }
}

export interface ClubProfileInput {
  clubId: string
  directoryId: string
  bio: string
  website: string
  facebookUrl: string
  addressDisplay: string
  status: "active" | "suspended"
  showWebsite: boolean
  showHomeGround: boolean
  showAddress: boolean
  showPostcode: boolean
}

/**
 * Only ever touches `clubs` -- never club_directory. clubs_update_admin
 * (is_site_admin() or is_club_admin(id)) is the real boundary, same policy
 * a Club Admin's own /club page already relies on; a Site Admin editing
 * here is exercising the same RLS grant, not a separate bypass.
 */
export async function updateClubProfile(input: ClubProfileInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("clubs")
    .update({
      bio: input.bio.trim() || null,
      website: input.website.trim() || null,
      facebook_url: input.facebookUrl.trim() || null,
      address_display: input.addressDisplay.trim() || null,
      status: input.status,
      show_website: input.showWebsite,
      show_home_ground: input.showHomeGround,
      show_address: input.showAddress,
      show_postcode: input.showPostcode,
    })
    .eq("id", input.clubId)

  if (error) {
    console.error("updateClubProfile failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  revalidatePath("/admin/clubs")
  return { ok: true }
}

export type UploadLogoResult = { ok: true; url: string } | { ok: false; error: string }

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"])

/**
 * Logo management only exists for activated clubs -- the club-logos
 * bucket's own ownership policy keys off {clubs.id}/... in the object
 * path (see 20260831095000_club_logo_storage.sql), so there's no
 * meaningful "whose crest" concept for a club_directory row with no
 * clubs row yet. Mirrors app/(app)/club/actions.ts's uploadClubLogo
 * exactly (validation, path convention, ownership check) -- this is the
 * same feature for a Site Admin acting on any club instead of a Club
 * Admin acting on their own.
 */
export async function uploadClubLogoAdmin(
  clubId: string,
  directoryId: string,
  formData: FormData
): Promise<UploadLogoResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const file = formData.get("logo")
  if (!(file instanceof File)) return { ok: false, error: "No file provided." }
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "Logo must be under 2MB." }
  if (!ALLOWED_LOGO_TYPES.has(file.type)) return { ok: false, error: "Logo must be PNG, JPEG, WebP, or SVG." }

  const { data: club } = await supabase.from("clubs").select("id, logo_storage_path").eq("id", clubId).maybeSingle()
  if (!club) return { ok: false, error: "Club not found." }

  const extension = file.name.split(".").pop() ?? "png"
  const path = `${clubId}/logo-${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) {
    console.error("uploadClubLogoAdmin storage upload failed:", uploadError)
    return { ok: false, error: "Couldn't upload the crest. Please try again." }
  }

  const { error: updateError } = await supabase.from("clubs").update({ logo_storage_path: path }).eq("id", clubId)
  if (updateError) {
    console.error("uploadClubLogoAdmin table update failed:", updateError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  // Clean up the previous object on a replace -- only after the new path is
  // safely saved, so a mid-request failure never leaves a club with no logo.
  if (club.logo_storage_path && club.logo_storage_path !== path) {
    await supabase.storage.from("club-logos").remove([club.logo_storage_path])
  }

  revalidatePath(`/admin/clubs/${directoryId}`)
  revalidatePath("/admin/clubs")
  return { ok: true, url: supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl }
}

export interface ConnectedUser {
  membershipId: string
  userId: string
  name: string
  email: string
  isSiteAdmin: boolean
  ovalballRole: string
  clubRoleTitle: string | null
  status: "active" | "revoked"
  teamRoles: { teamId: string; teamName: string; permission: string }[]
}

/**
 * "Who is connected to this club, why, and with what authority" -- three
 * deliberately separate concepts per the brief (global Site Admin access,
 * the Ovalball club_memberships.role permission, and the free-text
 * real-world club_role_title), plus team-scoped permissions. Never reads
 * profiles fields beyond name/email -- no DOB/address/phone here, matching
 * "do not expose irrelevant private profile fields".
 */
export async function getConnectedUsers(clubId: string): Promise<ConnectedUser[]> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return []

  const { data: memberships } = await supabase
    .from("club_memberships")
    .select("id, user_id, role, club_role_title, status")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true })

  if (!memberships || memberships.length === 0) return []

  const userIds = memberships.map((m) => m.user_id)
  const [{ data: profiles }, { data: siteAdmins }, { data: teamPerms }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, surname, email").in("id", userIds),
    supabase.from("site_admins").select("user_id").in("user_id", userIds).eq("status", "active"),
    supabase
      .from("team_permissions")
      .select("membership_id, permission, teams(id, display_name)")
      .in(
        "membership_id",
        memberships.map((m) => m.id)
      ),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
  const siteAdminIds = new Set((siteAdmins ?? []).map((s) => s.user_id))
  const teamPermsByMembership = new Map<string, ConnectedUser["teamRoles"]>()
  for (const tp of teamPerms ?? []) {
    const team = tp.teams as unknown as { id: string; display_name: string } | null
    if (!team) continue
    const list = teamPermsByMembership.get(tp.membership_id) ?? []
    list.push({ teamId: team.id, teamName: team.display_name, permission: tp.permission })
    teamPermsByMembership.set(tp.membership_id, list)
  }

  return memberships.map((m) => {
    const profile = profileById.get(m.user_id)
    return {
      membershipId: m.id,
      userId: m.user_id,
      name: profile ? [profile.first_name, profile.surname].filter(Boolean).join(" ") || "(no name on file)" : "(no name on file)",
      email: profile?.email ?? "",
      isSiteAdmin: siteAdminIds.has(m.user_id),
      ovalballRole: m.role,
      clubRoleTitle: m.club_role_title,
      status: m.status as "active" | "revoked",
      teamRoles: teamPermsByMembership.get(m.id) ?? [],
    }
  })
}

export interface UpdateRoleTitleInput {
  membershipId: string
  directoryId: string
  clubRoleTitle: string
}

/**
 * Descriptive-only edit -- never touches club_memberships.role (the
 * Ovalball permission). RLS (club_memberships_update_scoped:
 * is_site_admin() or is_club_admin(club_id)) is the real boundary.
 */
export async function updateMembershipRoleTitle(input: UpdateRoleTitleInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("club_memberships")
    .update({ club_role_title: input.clubRoleTitle.trim() || null })
    .eq("id", input.membershipId)

  if (error) {
    console.error("updateMembershipRoleTitle failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  return { ok: true }
}

export interface RevokeMembershipInput {
  membershipId: string
  directoryId: string
}

/**
 * Sets club_memberships.status = 'revoked' -- never a delete (the row
 * stays as history), and never touches .role, so this can't be repurposed
 * to promote/demote. Deliberately does not exist as a "make anyone admin"
 * counterpart; granting/promoting access from Club Management is out of
 * scope for this slice.
 */
export async function revokeMembership(input: RevokeMembershipInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("club_memberships")
    .update({ status: "revoked" })
    .eq("id", input.membershipId)

  if (error) {
    console.error("revokeMembership failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}

/**
 * The reverse of revokeMembership -- restores the membership's status to
 * active without touching .role or club_role_title, so a previously
 * revoked Club Admin comes back as a Club Admin, not silently downgraded.
 */
export async function reactivateMembership(input: RevokeMembershipInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("club_memberships")
    .update({ status: "active" })
    .eq("id", input.membershipId)

  if (error) {
    console.error("reactivateMembership failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}

export interface TeamGroupAssignment {
  teamId: string
  groupId: string | null
}

export interface ChangeAccessInput {
  membershipId: string
  directoryId: string
  userId: string
  /** A permission_groups.id with scope_type='club' -- the club-wide access this membership resolves to. Always required; "no club-wide admin authority" is itself a real group (the system "Member" mapping to BASIC_USER). */
  clubGroupId: string
  /** One optional team-scope permission_groups.id per team; null/omitted clears that team's assignment. */
  teamAssignments: TeamGroupAssignment[]
}

/**
 * The one path for changing what an existing member can do. Reads the
 * chosen permission_groups row(s) and writes their real, already-
 * implemented mapping (club_memberships.role / team_permissions.
 * permission) -- Permission Management's groups are the only source for
 * "what access level does this correspond to", so there is no hard-coded
 * duplicate dropdown logic here, matching the brief's own requirement.
 * assigned_group_id is set purely for traceability (Permission
 * Management's assigned-user counts); it never gates anything on its own.
 * Never touches site_admins -- granting Site Admin is a deliberately
 * separate, extra-friction action (see admin/users/[userId]/actions.ts)
 * so this form can never be used to create a Site Admin, by construction.
 */
export async function changeAccessProfile(input: ChangeAccessInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: clubGroup, error: clubGroupError } = await supabase
    .from("permission_groups")
    .select("id, scope_type, maps_to_role")
    .eq("id", input.clubGroupId)
    .eq("scope_type", "club")
    .maybeSingle()
  if (clubGroupError || !clubGroup || !clubGroup.maps_to_role) {
    return { ok: false, error: "That club-wide access group could not be found." }
  }

  const { error: roleError } = await supabase
    .from("club_memberships")
    .update({ role: clubGroup.maps_to_role, assigned_group_id: clubGroup.id })
    .eq("id", input.membershipId)
  if (roleError) {
    console.error("changeAccessProfile role update failed:", roleError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  const { error: deleteError } = await supabase.from("team_permissions").delete().eq("membership_id", input.membershipId)
  if (deleteError) {
    console.error("changeAccessProfile team_permissions clear failed:", deleteError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  const teamGroupIds = input.teamAssignments.map((t) => t.groupId).filter((id): id is string => Boolean(id))
  if (teamGroupIds.length > 0) {
    const { data: teamGroups, error: teamGroupError } = await supabase
      .from("permission_groups")
      .select("id, maps_to_team_permission")
      .in("id", teamGroupIds)
      .eq("scope_type", "team")
    if (teamGroupError || !teamGroups) {
      return { ok: false, error: "One of the selected team access groups could not be found." }
    }
    const permissionByGroupId = new Map(teamGroups.map((g) => [g.id, g.maps_to_team_permission]))
    const rows = input.teamAssignments
      .filter((t) => t.groupId && permissionByGroupId.get(t.groupId) && permissionByGroupId.get(t.groupId) !== "view_only")
      .map((t) => ({
        membership_id: input.membershipId,
        team_id: t.teamId,
        permission: permissionByGroupId.get(t.groupId!)!,
        assigned_group_id: t.groupId,
      }))
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("team_permissions").insert(rows)
      if (insertError) {
        console.error("changeAccessProfile team_permissions insert failed:", insertError)
        return { ok: false, error: toPublicSubmissionError() }
      }
    }
  }

  revalidatePath(`/admin/clubs/${input.directoryId}`)
  revalidatePath(`/admin/users/${input.userId}`)
  revalidatePath("/admin/users")
  revalidatePath("/admin/permissions")
  return { ok: true }
}

export interface ClubTeamSummary {
  id: string
  displayName: string
  rugbyCode: string
  category: string
  active: boolean
  memberCount: number
}

/** Read-only team roster for the Teams section -- Club Management never creates/edits teams itself, that stays the club's own Teams page. */
export async function getClubTeams(clubId: string): Promise<ClubTeamSummary[]> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return []

  const { data: teams } = await supabase
    .from("teams")
    .select("id, display_name, rugby_code, category, active")
    .eq("club_id", clubId)
    .order("display_name")

  if (!teams || teams.length === 0) return []

  const { data: counts } = await supabase
    .from("team_permissions")
    .select("team_id")
    .in(
      "team_id",
      teams.map((t) => t.id)
    )

  const countByTeam = new Map<string, number>()
  for (const row of counts ?? []) {
    countByTeam.set(row.team_id, (countByTeam.get(row.team_id) ?? 0) + 1)
  }

  return teams.map((t) => ({
    id: t.id,
    displayName: t.display_name,
    rugbyCode: t.rugby_code,
    category: t.category,
    active: t.active,
    memberCount: countByTeam.get(t.id) ?? 0,
  }))
}

export type DeleteClubResult = { ok: true } | { ok: false; error: string }

/**
 * Wraps the delete_canonical_club() SECURITY DEFINER RPC -- the only path
 * that may permanently remove a club_directory row. The RPC itself
 * re-checks is_site_admin() and blocks whenever any clubs/club_claims row
 * references this directory id; this wrapper just surfaces its error text
 * (already a friendly, specific message, not a raw Postgres error) rather
 * than mapping it through toPublicSubmissionError.
 */
export async function deleteCanonicalClub(directoryId: string, confirmName: string): Promise<DeleteClubResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("delete_canonical_club", {
    p_directory_id: directoryId,
    p_confirm_name: confirmName,
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/clubs")
  return { ok: true }
}

export type DeactivateClubResult = { ok: true; membershipsSuspended: number } | { ok: false; error: string }

/**
 * deactivate_club() is the real boundary -- reason required, writes a full
 * audit_log entry. Never touches a fixture (that stays a completely
 * separate, explicit cancellation workflow -- an active opponent's own
 * confirmed fixture simply becomes operationally external from this club,
 * exactly like an unclaimed one, via the SAME external-opponent check
 * every fixture RPC already had). Never touches club_directory (the
 * canonical rugby-club identity) -- only this club's own Ovalball
 * activation record and its members' authority (see
 * restoreClubMembershipAuthority below for how that authority comes back).
 */
export async function deactivateClubAdmin(clubId: string, reason: string): Promise<DeactivateClubResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "club_data"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data, error } = await supabase.rpc("deactivate_club", { p_club_id: clubId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs")
  return { ok: true, membershipsSuspended: data ?? 0 }
}

/** Restores the club's own active status -- deliberately does NOT restore any member's authority, see restoreClubMembershipAuthority. */
export async function reactivateClubAdmin(clubId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "club_data"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("reactivate_club", { p_club_id: clubId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs")
  return { ok: true }
}

export interface SuspendedClubMembership {
  membershipId: string
  userId: string
  role: string
  authoritySuspendedAt: string | null
  name: string
}

export async function listSuspendedClubMembershipsAdmin(clubId: string): Promise<SuspendedClubMembership[]> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "club_data"])
  if (!auth.ok) return []

  const { data } = await supabase.rpc("list_suspended_club_memberships", { p_club_id: clubId })
  return (data ?? []).map((m) => ({
    membershipId: m.membership_id,
    userId: m.user_id,
    role: m.role,
    authoritySuspendedAt: m.authority_suspended_at,
    name: [m.first_name, m.surname].filter(Boolean).join(" ") || "Unknown",
  }))
}

/** restore_club_membership_authority() is the real boundary -- one membership at a time, never a mass silent restoration. */
export async function restoreClubMembershipAuthorityAdmin(membershipId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "club_data"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("restore_club_membership_authority", { p_membership_id: membershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs")
  return { ok: true }
}

export async function removeClubLogoAdmin(clubId: string, directoryId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: club } = await supabase.from("clubs").select("logo_storage_path").eq("id", clubId).maybeSingle()
  if (!club) return { ok: false, error: "Club not found." }

  const { error: updateError } = await supabase.from("clubs").update({ logo_storage_path: null }).eq("id", clubId)
  if (updateError) {
    console.error("removeClubLogoAdmin table update failed:", updateError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  if (club.logo_storage_path) {
    await supabase.storage.from("club-logos").remove([club.logo_storage_path])
  }

  revalidatePath(`/admin/clubs/${directoryId}`)
  revalidatePath("/admin/clubs")
  return { ok: true }
}

/**
 * The canonical-crest counterpart to uploadClubLogoAdmin -- works whether
 * or not this directory entry has activated (no clubs row required), which
 * is the actual root-cause fix: a canonical club like an unactivated
 * "Wigan RUFC" previously had nowhere to store a crest and no UI to set
 * one, since every existing crest control required a clubId. Same bucket,
 * same 2MB/PNG-JPEG-WebP-SVG limits, same club-logos storage RLS (already
 * permits any is_site_admin() write regardless of path) -- just keyed
 * "{directoryId}/logo-{timestamp}" instead of "{clubId}/...", and written
 * to club_directory.logo_storage_path (club_directory_update_admin already
 * permits any Site Admin to write this row -- requireSiteAdmin below adds
 * the narrower full/club_data profile check the brief asks for).
 */
export async function uploadDirectoryLogoAdmin(directoryId: string, formData: FormData): Promise<UploadLogoResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const file = formData.get("logo")
  if (!(file instanceof File)) return { ok: false, error: "No file provided." }
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "Logo must be under 2MB." }
  if (!ALLOWED_LOGO_TYPES.has(file.type)) return { ok: false, error: "Logo must be PNG, JPEG, WebP, or SVG." }

  const { data: directory } = await supabase.from("club_directory").select("id, logo_storage_path").eq("id", directoryId).maybeSingle()
  if (!directory) return { ok: false, error: "Club not found." }

  const extension = file.name.split(".").pop() ?? "png"
  const path = `${directoryId}/logo-${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) {
    console.error("uploadDirectoryLogoAdmin storage upload failed:", uploadError)
    return { ok: false, error: "Couldn't upload the crest. Please try again." }
  }

  const { error: updateError } = await supabase.from("club_directory").update({ logo_storage_path: path }).eq("id", directoryId)
  if (updateError) {
    console.error("uploadDirectoryLogoAdmin table update failed:", updateError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  if (directory.logo_storage_path && directory.logo_storage_path !== path) {
    await supabase.storage.from("club-logos").remove([directory.logo_storage_path])
  }

  revalidatePath(`/admin/clubs/${directoryId}`)
  revalidatePath("/admin/clubs")
  revalidatePath("/admin/fixtures")
  return { ok: true, url: supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl }
}

export async function removeDirectoryLogoAdmin(directoryId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: directory } = await supabase.from("club_directory").select("logo_storage_path").eq("id", directoryId).maybeSingle()
  if (!directory) return { ok: false, error: "Club not found." }

  const { error: updateError } = await supabase.from("club_directory").update({ logo_storage_path: null }).eq("id", directoryId)
  if (updateError) {
    console.error("removeDirectoryLogoAdmin table update failed:", updateError)
    return { ok: false, error: toPublicSubmissionError() }
  }

  if (directory.logo_storage_path) {
    await supabase.storage.from("club-logos").remove([directory.logo_storage_path])
  }

  revalidatePath(`/admin/clubs/${directoryId}`)
  revalidatePath("/admin/clubs")
  revalidatePath("/admin/fixtures")
  return { ok: true }
}
