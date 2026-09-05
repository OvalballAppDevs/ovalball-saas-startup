import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"
import { profileLabel } from "@/app/(app)/admin/site-admins/profiles"

import { AcceptSiteAdminInvitationButton } from "./accept-button"
import { CompleteProfileForm } from "./complete-profile-form"

/**
 * Deliberately public (no auth required to view): get_site_admin_invitation_preview()
 * only returns the safe subset of fields needed to render this page, never
 * the full site_admin_invitations row. Accepting requires signing in as
 * the invited email -- same simplification as /invite/[token]: if not
 * already signed in, sign in via /login and come back to this same link.
 */
export default async function SiteAdminInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: preview, error } = await supabase.rpc("get_site_admin_invitation_preview", { p_token: token }).maybeSingle()

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
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">This link isn&apos;t valid</h1>
            <p className="mt-3 text-base text-ink/60">
              It may have already been used, revoked, or the link was copied incorrectly.
            </p>
          </>
        ) : preview.status !== "pending" ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">
              {preview.status === "accepted" ? "Already accepted" : "No longer available"}
            </h1>
            <p className="mt-3 text-base text-ink/60">
              {preview.status === "accepted"
                ? "This invitation has already been used."
                : "This invitation has expired or been revoked."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">You&apos;re invited</p>
            <h1 className="mt-2 font-display text-display-l text-ink">
              {profileLabel(preview.admin_role)}
            </h1>
            <p className="mt-3 text-base text-ink/60">
              You&apos;ve been invited to become a Site Administrator on Ovalball &mdash; a global platform role,
              separate from any club membership.
            </p>

            {!user ? (
              <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/70">
                  Sign in with <strong className="text-ink">{preview.invited_email}</strong> to accept this
                  invitation, then come back to this link.
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
                <p className="text-sm text-destructive">
                  You&apos;re signed in as {user.email}, but this invitation was sent to {preview.invited_email}.
                  Sign in as that address to accept it.
                </p>
              </div>
            ) : !hasProfile ? (
              <CompleteProfileForm />
            ) : (
              <div className="mt-8">
                <AcceptSiteAdminInvitationButton token={token} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
