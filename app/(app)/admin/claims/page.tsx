import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { ClaimCard } from "./claim-card"

/**
 * The first functional Site Admin workflow, and the actual unlock for
 * every downstream authenticated screen: before this existed, a claim had
 * no way to become a real club + CLUB_ADMIN membership except by hand via
 * SQL. RLS (club_claims_select_admin: is_site_admin() only) already
 * restricts what this query can return; the redirect below is a UX
 * courtesy for a non-admin who lands here, not the actual boundary.
 */
export default async function SiteAdminClaimsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const { data: claims } = await supabase
    .from("club_claims")
    .select("id, claimant_user_id, claimed_role, authority_declaration, created_at, club_directory(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })

  // No direct FK from club_claims to profiles (both reference auth.users
  // independently), so PostgREST can't auto-embed it -- fetched separately
  // and merged in JS instead.
  const claimantIds = (claims ?? []).map((c) => c.claimant_user_id)
  const { data: claimantProfiles } =
    claimantIds.length > 0
      ? await supabase.from("profiles").select("id, first_name, surname, email").in("id", claimantIds)
      : { data: [] }
  const profileById = new Map((claimantProfiles ?? []).map((p) => [p.id, p]))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Club claims</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Review who&apos;s asking to represent a club on Ovalball before they get administrative access.
      </p>

      {!claims || claims.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">No claims waiting for review</p>
          <p className="mt-1 text-sm text-ink/55">New claims will appear here as clubs are claimed.</p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {claims.map((c) => {
            const claimant = profileById.get(c.claimant_user_id)
            return (
            <ClaimCard
              key={c.id}
              claim={{
                id: c.id,
                clubName: c.club_directory?.name ?? "Unknown club",
                claimantName: [claimant?.first_name, claimant?.surname].filter(Boolean).join(" ") || "Unknown",
                claimantEmail: claimant?.email ?? "",
                claimedRole: c.claimed_role,
                authorityDeclaration: c.authority_declaration,
                submittedAt: c.created_at,
              }}
            />
            )
          })}
        </div>
      )}
    </div>
  )
}
