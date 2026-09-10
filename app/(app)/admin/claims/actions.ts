"use server"

import { revalidatePath } from "next/cache"

import { resolveClubCrestEmailUrl } from "@/lib/email/club-crest"
import { sendEmailEvent } from "@/lib/email/send"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export type ClaimActionResult = { ok: true } | { ok: false; error: string }

/**
 * Both actions call the SECURITY DEFINER functions from
 * supabase/migrations/20260831090000_role_vocabulary_and_claim_approval.sql,
 * which independently re-check is_site_admin() themselves -- that remains
 * the real boundary for "does this account genuinely hold Site Admin
 * authority at all". It cannot, however, know whether the account has
 * actively switched INTO Site Admin as its current context (that's a
 * Next.js cookie, never written to the database) -- the Site Admin
 * route-family guard addendum requires this action to check that half
 * itself, explicitly, before forwarding the call.
 */
export async function approveClaim(claimId: string, notes: string): Promise<ClaimActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("approve_club_claim", {
    p_claim_id: claimId,
    p_notes: notes || undefined,
  })
  if (error) return { ok: false, error: error.message }

  await sendClubWelcome(supabase, claimId)

  revalidatePath("/admin/claims")
  return { ok: true }
}

/**
 * Tells the claimant their club is live.
 *
 * Deliberately AFTER the approval has succeeded and deliberately unable to
 * fail it. A Site Admin who has approved a claim has approved it; making that
 * outcome depend on a mail provider being reachable would invent a dependency
 * the decision does not have. The delivery is recorded in email_deliveries,
 * which is where an operator looks when somebody says they never heard back.
 *
 * The recipient is not a parameter. It is resolved from the claim row itself,
 * under this Site Admin's own session -- see the club_claimant case in
 * lib/email/recipients.ts for why an approval must not be redirectable.
 */
async function sendClubWelcome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claimId: string
): Promise<void> {
  const { data: claim } = await supabase
    .from("club_claims")
    .select("id, claimant_user_id, directory_id, club_directory(name)")
    .eq("id", claimId)
    .maybeSingle()
  if (!claim) return

  const [{ data: profile }, { data: club }] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", claim.claimant_user_id).maybeSingle(),
    // approve_club_claim() has already run and created this row -- see this
    // function's own call site. Read by directory_id rather than trusting a
    // parameter, since the newly-activated club's own id was never handed in.
    supabase.from("clubs").select("id").eq("directory_id", claim.directory_id).maybeSingle(),
  ])

  const directory = claim.club_directory as unknown as { name: string } | null
  const clubName = directory?.name ?? ""
  if (!clubName) return

  await sendEmailEvent({
    supabase,
    eventKey: "club_welcome",
    idempotencyKey: `club_welcome:${claim.id}`,
    recipient: { kind: "club_claimant", claimId: claim.id },
    data: {
      firstName: profile?.first_name ?? "",
      clubName,
      clubLogoUrl: await resolveClubCrestEmailUrl(supabase, club?.id ?? null),
    },
  })
}

export async function rejectClaim(claimId: string, notes: string): Promise<ClaimActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("reject_club_claim", {
    p_claim_id: claimId,
    p_notes: notes || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/claims")
  return { ok: true }
}
