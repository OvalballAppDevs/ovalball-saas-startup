import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"
import { CompleteProfileForm } from "@/app/invite/site-admin/[token]/complete-profile-form"

import { AcceptSafeguardingOfficerInvitationButton } from "./accept-button"

/**
 * Deliberately public (no auth required to view):
 * get_safeguarding_officer_invitation_preview() only returns the safe
 * subset of fields needed to render this page, never the full
 * club_safeguarding_officer_invitations row. Accepting requires signing in
 * as the invited email -- same pattern as every other invite type in this
 * codebase. Reuses the site-admin invite flow's own CompleteProfileForm
 * (generic: creates a minimal profiles row for the current session, not
 * site-admin-specific) for a genuinely new person with no profile yet.
 */
export default async function SafeguardingOfficerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: preview, error } = await supabase.rpc("get_safeguarding_officer_invitation_preview", { p_token: token }).maybeSingle()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let hasProfile = false
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle()
    hasProfile = !!profile
  }

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-lg px-4 py-16 md:py-24">
        {error || !preview ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Safeguarding Officer Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">This link isn&apos;t valid</h1>
            <p className="mt-3 text-base text-ink/60">It may have already been used, revoked, or the link was copied incorrectly.</p>
          </>
        ) : preview.status !== "pending" ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Safeguarding Officer Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">{preview.status === "accepted" ? "Already accepted" : "No longer available"}</h1>
            <p className="mt-3 text-base text-ink/60">
              {preview.status === "accepted" ? "This invitation has already been used." : "This invitation has expired or been revoked."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">You&apos;re invited</p>
            <h1 className="mt-2 font-display text-display-l text-ink">
              {preview.officer_type === "primary" ? "Safeguarding Officer" : "Deputy Safeguarding Officer"}
            </h1>
            <p className="mt-3 text-base text-ink/60">
              {preview.club_name} has invited you to become their {preview.officer_type === "primary" ? "" : "deputy "}Safeguarding
              Officer on Ovalball. This gives you access to safeguarding-related information and communication for this club only
              &mdash; nothing else.
            </p>

            {!user ? (
              <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/70">
                  Sign in with <strong className="text-ink">{preview.invited_email}</strong> to accept this invitation, then come back
                  to this link.
                </p>
                <Link
                  href={`/login?email=${encodeURIComponent(preview.invited_email)}`}
                  className="mt-3 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
                >
                  Sign in
                </Link>
              </div>
            ) : user.email?.toLowerCase() !== preview.invited_email.toLowerCase() ? (
              <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
                <p className="text-sm text-destructive-text">
                  You&apos;re signed in as {user.email}, but this invitation was sent to {preview.invited_email}. Sign in as that
                  address to accept it.
                </p>
              </div>
            ) : !hasProfile ? (
              <CompleteProfileForm />
            ) : (
              <div className="mt-8">
                <AcceptSafeguardingOfficerInvitationButton token={token} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
