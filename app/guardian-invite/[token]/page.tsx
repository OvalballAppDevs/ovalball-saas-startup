import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { GuardianInviteFlow } from "./guardian-invite-flow"

/**
 * The Parent-facing acceptance screen for a team-scoped Guardian
 * invitation (Side Project 1 integration). Deliberately public (no auth
 * required to view) -- get_guardian_invitation_preview() returns only the
 * safe subset of fields needed to render this page, exactly like the
 * existing staff /invite/[token] flow's get_invitation_preview();
 * guardian_invitations_select_scoped itself stays staff/inviter/Site-
 * Admin-only, never opened up to satisfy this page. Accepting requires
 * signing in as the invited email -- if not already signed in, the
 * visitor signs in via /login and returns to this same link.
 */
export default async function GuardianInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: preview, error } = await supabase.rpc("get_guardian_invitation_preview", { p_token: token }).maybeSingle()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const teamLabel = preview ? (preview.team_alias ?? preview.team_display_name) : null

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
            <p className="mt-3 text-base text-ink/60">This invitation has expired or been revoked. Ask the club for a new one.</p>
          </>
        ) : preview.status === "accepted" && preview.accepted_by !== user?.id ? (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>
            <h1 className="mt-2 font-display text-display-l text-ink">Already used</h1>
            <p className="mt-3 text-base text-ink/60">This invitation has already been accepted.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">You&apos;re invited</p>
            <h1 className="mt-2 font-display text-display-l text-ink">{teamLabel}</h1>
            <p className="mt-3 text-base text-ink/60">
              {preview.replacement_for_player_id
                ? `Connect as ${preview.replacement_for_player_first_name}'s parent or guardian at ${preview.club_name} on Ovalball.`
                : `Connect as a parent or guardian at ${preview.club_name} on Ovalball. Once you accept, you'll be able to add your child as a player.`}
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
              <div className="mt-8">
                <GuardianInviteFlow
                  token={token}
                  invitationId={preview.invitation_id}
                  teamLabel={teamLabel ?? "this team"}
                  alreadyAccepted={preview.status === "accepted"}
                  replacementForPlayerId={preview.replacement_for_player_id}
                  replacementForPlayerFirstName={preview.replacement_for_player_first_name}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
