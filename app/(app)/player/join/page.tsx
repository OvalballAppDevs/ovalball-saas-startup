import { redirect } from "next/navigation"
import Link from "next/link"
import { Check, Clock } from "lucide-react"

import { createClient } from "@/lib/supabase/server"

import { JoinAsPlayer } from "./join-as-player"

export const metadata = { title: "Join As A Player" }

/**
 * ADULT PLAYER REGISTRATION.
 *
 * The counterpart to a guardian adding a child, and deliberately the same
 * shape: profile, then the rugby you are registering for, then a request the
 * club decides. The difference is authority, not architecture -- an adult
 * manages their own player record, a guardian manages a child's.
 *
 * WHAT THIS SCREEN IS FOR, AND WHAT IT IS NOT
 *
 * Signing in does not make somebody a rugby player. They may be a parent, a
 * coach, a club secretary, or all three. So nothing here runs automatically:
 * a person arrives because they chose to, and my_player_context() is asked
 * where they have got to rather than the page guessing from the URL.
 */
export default async function PlayerJoinPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: ctx } = await supabase.rpc("my_player_context").single()
  const state = ctx?.state ?? "NO_PLAYER"

  // Somebody already playing is not shown a journey to join.
  if (state === "ACTIVE") redirect("/dashboard")

  const firstName = ctx?.first_name ?? ""

  if (state === "PENDING") {
    return (
      <Shell>
        <div className="rounded-xl border border-ink/10 bg-white p-6 md:p-8">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-forest-800" aria-hidden="true" />
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Awaiting Club Approval</p>
          </div>
          <h2 className="mt-3 font-display text-display-m text-ink">{ctx?.club_name}</h2>
          <p className="mt-2 max-w-md text-sm text-ink-muted">
            Your request has been sent. {ctx?.club_name} will place you in the right side and let you know &mdash; you
            are not a member of a team until they do.
          </p>
          {ctx?.resolved_category && (
            <p className="mt-4 text-sm text-ink">
              You asked to join as: <span className="font-medium">{ctx.resolved_category}</span>
            </p>
          )}
          <Link
            href="/dashboard"
            className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            Back to your dashboard
          </Link>
        </div>
      </Shell>
    )
  }

  if (state === "DECLINED") {
    return (
      <Shell>
        <div className="rounded-xl border border-ink/10 bg-white p-6 md:p-8">
          <p className="text-sm font-medium tracking-[0.08em] text-ink-muted uppercase">Request Not Accepted</p>
          <h2 className="mt-3 font-display text-display-m text-ink">{ctx?.club_name} could not accept you</h2>
          {/*
            Factual, and only what the club wrote for the player to read. A
            club's internal notes are not shown here.
          */}
          {ctx?.decline_reason ? (
            <p className="mt-2 max-w-md text-sm text-ink-muted">{ctx.decline_reason}</p>
          ) : (
            <p className="mt-2 max-w-md text-sm text-ink-muted">
              The club has not given a reason. They will usually be able to explain if you get in touch.
            </p>
          )}
          <p className="mt-4 max-w-md text-sm text-ink-muted">You can ask another club instead.</p>
          <JoinAsPlayer
            playerId={ctx?.player_id ?? null}
            firstName={firstName}
            hasProfile
            className="mt-6"
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {state === "PROFILE_INCOMPLETE" && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-50/60 px-4 py-3">
          <p className="text-sm font-medium text-ink">Complete Your Player Profile</p>
          <p className="mt-1 text-sm text-ink-muted">
            To place you in the correct rugby category, we need a few more details. Signing in was enough to get you
            an account &mdash; this is what makes you a player.
          </p>
        </div>
      )}
      <JoinAsPlayer
        playerId={ctx?.player_id ?? null}
        firstName={firstName}
        hasProfile={state === "NO_CLUB"}
      />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Player</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Join As A Player</h1>
      <p className="mt-2 mb-6 max-w-md text-sm text-ink-muted">
        Register yourself with a club. Ovalball works out which rugby category you play in, and the club decides which
        of their sides you join.
      </p>
      {children}
    </div>
  )
}
