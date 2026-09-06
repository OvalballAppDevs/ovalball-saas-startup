import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import type { Database } from "@/types/database.types"
import type { ClubSelection, PersonalDetails } from "@/lib/signup/types"
import { getSiteUrl } from "@/lib/site-url"
import { policyAcknowledgements, termsAgreementVersion } from "@/lib/legal/required-consents"

/**
 * Runs once, from /auth/callback, immediately after exchangeCodeForSession
 * has produced a real session for the user. This is the ONLY place the
 * data collected in the signup wizard (stashed as user_metadata by
 * submitSignup's signInWithOtp call, since no session existed yet at that
 * point) is written to profiles/club_claims/club_join_requests/
 * directory_requests -- see submit-signup.ts for why it has to work this
 * way rather than inserting directly during signup.
 *
 * Every insert below runs through the caller's own authenticated Supabase
 * client (the user's session, not a service role), so it is bound by the
 * same RLS a browser request would get: profiles_insert_self, and this
 * migration's *_select_self additions, all check `= auth.uid()`. Nothing
 * here inserts into club_memberships (an admin-only INSERT per RLS) or sets
 * any permission -- a claim/join-request row is a request, not a grant.
 *
 * Idempotency: guarded by checking for an existing profiles row first. If
 * one already exists, this user has already completed signup (e.g. they're
 * going through a later, unrelated magic-link sign-in) and this is a no-op
 * -- prevents a duplicate profile/claim from a stale metadata payload on a
 * repeat auth callback.
 */
export async function completeSignupIfNeeded(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<{ completed: boolean; error?: string }> {
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()

  if (existingProfile) {
    return { completed: false }
  }

  const payload = extractPayload(user)
  if (!payload) {
    // No signup payload on this user (e.g. they authenticated some other
    // way that isn't this wizard) -- nothing for this function to do.
    return { completed: false }
  }

  return writeSignupRecords(supabase, user, payload)
}

export interface SignupRecordsPayload {
  personal: PersonalDetails
  club: ClubSelection
  rugbyCode: string | null
  termsVersion: string
}

/**
 * The actual insert sequence, shared by both ways a signup can complete.
 *
 * The magic-link path reaches it via completeSignupIfNeeded above, reading
 * a payload stashed in user_metadata because no session existed when the
 * wizard was filled in. The OAuth path reaches it directly from
 * completeAuthenticatedSignup: there the provider hands us a session
 * FIRST, so the wizard can post its payload to an authenticated action and
 * skip the metadata round trip entirely.
 *
 * Both call the same function on purpose -- a second copy of this sequence
 * is how one path quietly stops writing a terms_acceptances row.
 *
 * Every insert runs as the caller's own authenticated user, bound by the
 * same RLS a browser request gets. Nothing here grants a permission:
 * club_memberships has no self-serve INSERT, and a claim or join request is
 * a request awaiting human review, not authority.
 */
export async function writeSignupRecords(
  supabase: SupabaseClient<Database>,
  user: User,
  payload: SignupRecordsPayload
): Promise<{ completed: boolean; error?: string }> {
  const { personal, club, termsVersion } = payload

  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.id,
    first_name: personal.firstName,
    surname: personal.surname,
    date_of_birth: personal.dateOfBirth || null,
    address_line_1: personal.addressLine1 || null,
    address_line_2: personal.addressLine2 || null,
    address_line_3: personal.addressLine3 || null,
    town: personal.town || null,
    county: personal.county || null,
    country: personal.country || null,
    postcode: personal.postcode || null,
  })
  if (profileError) {
    return { completed: false, error: `profile: ${profileError.message}` }
  }

  // Two DIFFERENT legal events, recorded in two different places on
  // purpose. Terms is a contractual agreement and belongs in
  // terms_acceptances, which exists for exactly that. Privacy and
  // Safeguarding are acknowledgements that a published document was read --
  // not consent to processing -- so they go to policy_acknowledgements.
  // Recording all three as "terms acceptance" would answer "what did this
  // person agree to?" incorrectly.
  //
  // Both versions come from the server (requiredConsents), never from the
  // payload, so a stale or invented version cannot be persisted. Both
  // timestamps are database defaults, so neither can be backdated.
  void termsVersion
  const { error: termsError } = await supabase.from("terms_acceptances").insert({
    user_id: user.id,
    terms_version: termsAgreementVersion(),
  })
  if (termsError) {
    return { completed: false, error: `terms: ${termsError.message}` }
  }

  const { error: acknowledgementError } = await supabase
    .from("policy_acknowledgements")
    .insert(
      policyAcknowledgements().map((ack) => ({
        user_id: user.id,
        policy_id: ack.policy_id,
        policy_version: ack.policy_version,
      }))
    )
  if (acknowledgementError) {
    return { completed: false, error: `acknowledgements: ${acknowledgementError.message}` }
  }

  if (club.kind === "existing-unclaimed") {
    const { error } = await supabase.from("club_claims").insert({
      directory_id: club.directory.id,
      claimant_user_id: user.id,
      claimed_role: club.role,
      authority_declaration: club.authorityConfirmed
        ? "I confirm that I have permission from this club to act on its behalf and to request administrative access to its Ovalball account."
        : "",
      proposed_teams: club.teams as unknown as Database["public"]["Tables"]["club_claims"]["Insert"]["proposed_teams"],
    })
    if (error) return { completed: false, error: `club_claims: ${error.message}` }

    // Due-diligence email to the configured Site Admin notification
    // destination -- distinct from the in-app notification every active
    // Site Admin already gets automatically via the
    // notify_site_admins_club_claim_submitted DB trigger. Never sends
    // anything for real this session -- see lib/email/dispatch.ts.
    await dispatchEmailEvent({
      type: "club_claim_submitted",
      toSiteAdminInbox: true,
      data: {
        clubName: club.directory.name,
        claimantName: `${personal.firstName} ${personal.surname}`.trim(),
        claimantEmail: user.email ?? "",
        declaredRole: club.role,
        reviewUrl: `${getSiteUrl()}/admin/claims`,
      },
    })
  } else if (club.kind === "existing-claimed") {
    // club_join_requests.club_id references clubs(id), never
    // club_directory(id) -- directory.clubId is the resolved clubs.id from
    // the STEP 3 search (see searchClubDirectory), populated only when
    // that search itself found an active clubs row, exactly the condition
    // this branch is already gated on.
    if (!club.directory.clubId) {
      return { completed: false, error: "club_join_requests: club is not actually activated on Ovalball yet." }
    }
    const { error } = await supabase.from("club_join_requests").insert({
      club_id: club.directory.clubId,
      requesting_user_id: user.id,
      requested_role: club.role,
    })
    if (error) return { completed: false, error: `club_join_requests: ${error.message}` }
  } else if (club.kind === "not-found") {
    const { error } = await supabase.from("directory_requests").insert({
      submitted_by: user.id,
      club_name: club.proposal.clubName,
      bio: club.proposal.bio || null,
      postcode: club.proposal.postcode || null,
      address_line_1: club.proposal.addressLine1 || null,
      address_line_2: club.proposal.addressLine2 || null,
      address_line_3: club.proposal.addressLine3 || null,
      town: club.proposal.town || null,
      county: club.proposal.county || null,
      country: club.proposal.country || null,
      phone: club.proposal.phone || null,
      email: club.proposal.email || null,
      rugby_code: payload.rugbyCode,
      proposed_teams: club.teams as unknown as Database["public"]["Tables"]["directory_requests"]["Insert"]["proposed_teams"],
    })
    if (error) return { completed: false, error: `directory_requests: ${error.message}` }
  }

  return { completed: true }
}

// Minimal structural check, not full schema validation -- worth remembering
// that user_metadata is set via the OTP call before the user is
// authenticated, so a motivated caller could in principle send a malformed
// or hostile payload here. That's bounded by RLS regardless: every table
// this writes to only ever inserts a *_self row (own user id) or a request
// awaiting human review -- there is no path here to any elevated
// permission, so this guards against crashes/garbage data, not privilege
// escalation.
function extractPayload(user: User): SignupRecordsPayload | null {
  const raw = user.user_metadata?.ovalballSignupPayload
  if (!raw || typeof raw !== "object") return null
  const { personal, club, rugbyCode, termsVersion } = raw as Record<string, unknown>
  if (!personal || typeof personal !== "object") return null
  if (!club || typeof club !== "object" || !("kind" in club)) return null
  if (typeof termsVersion !== "string") return null
  // Minimal shape check only, then trust the rest -- see the comment above
  // this function for why a full schema validator isn't warranted here.
  return {
    personal: personal as PersonalDetails,
    club: club as ClubSelection,
    rugbyCode: typeof rugbyCode === "string" ? rugbyCode : null,
    termsVersion,
  }
}
