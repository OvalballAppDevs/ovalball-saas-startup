import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { AcceptPlayerInviteFlow } from "./accept-player-invite-flow"

/**
 * The optional Player-login acceptance screen (Side Project 1
 * integration) -- the exact same public-preview-then-sign-in-then-accept
 * pattern as /guardian-invite/[token], reusing
 * get_player_account_invitation_preview (a safe, minimal, token-scoped
 * read) rather than exposing player_account_invitations' normal
 * guardian/inviter-only RLS.
 */
export default async function PlayerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: preview, error } = await supabase.rpc("get_player_account_invitation_preview", { p_token: token }).maybeSingle()

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">This link isn&apos;t valid</h1>
            <p className="mt-3 text-base text-ink/60">It may have already been used, revoked, or the link was copied incorrectly.</p>
          </>
        ) : preview.status === "expired" || preview.status === "revoked" ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">No longer available</h1>
            <p className="mt-3 text-base text-ink/60">This invitation has expired or been revoked. Ask your parent/guardian for a new one.</p>
          </>
        ) : preview.status === "accepted" && preview.accepted_by !== user?.id ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">Already used</h1>
            <p className="mt-3 text-base text-ink/60">This invitation has already been accepted.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your own Ovalball account</p>
            <h1 className="mt-2 font-display text-display-l text-ink">{preview.player_first_name}&rsquo;s profile</h1>
            <p className="mt-3 text-base text-ink/60">
              Your parent/guardian has invited you to have your own Ovalball login, connected to your player profile. Your parent/guardian keeps their own Parent/Guardian controls, and this does not
              give you Parent, Team Admin, or Club Admin permissions.
            </p>

            {!user ? (
              <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/70">
                  Sign in with <strong className="text-ink">{preview.invited_email}</strong> to accept this invitation, then come back to this link.
                </p>
                <Link href={`/login?email=${encodeURIComponent(preview.invited_email)}`} className="mt-3 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                  Sign in
                </Link>
              </div>
            ) : user.email?.toLowerCase() !== preview.invited_email.toLowerCase() ? (
              <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
                <p className="text-sm text-destructive">
                  You&apos;re signed in as {user.email}, but this invitation was sent to {preview.invited_email}. Sign in as that address to accept it.
                </p>
              </div>
            ) : (
              <AcceptPlayerInviteFlow token={token} playerFirstName={preview.player_first_name} />
            )}
          </>
        )}
      </div>
    </main>
  )
}
