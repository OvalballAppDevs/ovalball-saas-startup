import type { Metadata } from "next"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { JoinPanel } from "./join-panel"

export const metadata: Metadata = { title: "Accept an Invitation" }

/** What each kind of invitation is, said to the person holding it rather than to the database. */
const KIND_LABEL: Record<string, string> = {
  CLUB_STAFF: "a club role",
  GUARDIAN: "a parent or guardian account",
  PLAYER_ACCOUNT: "a player account",
  TEAM_JOIN_CODE: "a team",
  SAFEGUARDING_OFFICER: "the Safeguarding Officer role",
  SITE_ADMIN: "Ovalball Site Admin",
  ACCOUNT_SETUP: "your Ovalball account",
  CLUB_REFERRAL: "bringing your club onto Ovalball",
}

/**
 * THE ONE PLACE AN INVITATION IS ACCEPTED.
 *
 * Every kind of invitation Ovalball sends -- club staff, guardian, player, team join code,
 * safeguarding officer, site admin, account setup, club referral -- arrives here, because they are
 * one credential with one redemption path behind them.
 *
 * The page is public, and deliberately says very little. `preview_invitation` returns which club
 * invited you and roughly what for; it never returns who was invited, so an intercepted link does not
 * disclose an email address, and a wrong token previews nothing at all rather than explaining which
 * part was wrong.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; c?: string }>
}) {
  const { t } = await searchParams
  const token = t?.trim() || null
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: preview } = token
    ? await supabase.rpc("preview_invitation", { p_token: token, p_code: undefined }).maybeSingle()
    : { data: null }

  const usable = preview?.state === "usable"

  // Somebody invited to Ovalball who has never been anybody here yet has no NAME. Creating an account
  // now creates a profile row alongside it, so "has a profile" is not the question -- an empty one is
  // just as nameless, and asking only when the row is missing left those people unable to answer the
  // age question at all, because first name and surname are NOT NULL on that row.
  const { data: profile } = user
    ? await supabase.from("profiles").select("first_name, surname").eq("id", user.id).maybeSingle()
    : { data: null }
  const hasName = Boolean(profile?.first_name?.trim() && profile?.surname?.trim())

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-lg px-4 py-16 md:py-24">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Invitation</p>

        {token && !preview ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">This link can&apos;t be used</h1>
            <p className="mt-3 text-base text-ink/60">
              It may have been used already, withdrawn, or copied incompletely. Ask whoever invited you to send
              it again.
            </p>
          </>
        ) : token && !usable ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">This invitation is no longer open</h1>
            <p className="mt-3 text-base text-ink/60">
              Ask whoever invited you to send a new one.
            </p>
          </>
        ) : preview ? (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">{preview.scope_label}</h1>
            <p className="mt-3 text-base text-ink/60">
              You have been invited to {KIND_LABEL[preview.kind] ?? "join"} on Ovalball
              {preview.inviter_label ? ` by ${preview.inviter_label}` : ""}.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-display text-display-l text-ink">Accept an invitation</h1>
            <p className="mt-3 text-base text-ink/60">
              Enter the code from your invitation, or open the link you were sent.
            </p>
          </>
        )}

        <JoinPanel
          token={token}
          signedIn={Boolean(user)}
          hasInvitation={Boolean(usable)}
          needsName={Boolean(user) && !hasName}
        />
      </div>
    </main>
  )
}
