import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ChevronRight } from "lucide-react"

import type { User, SupabaseClient } from "@supabase/supabase-js"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, getRugbyHubTeamOptions, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"
import { HUB_GROUPS, HUB_START_HERE } from "@/components/rugby-hub/nav/hub-nav-groups"

import { RUGBY_HUB_TEAM_COOKIE } from "./constants"

export const metadata: Metadata = {
  title: "Rugby Hub",
  description: "Learn the game, play and develop, coach, and explore rugby's teams, people and story — all in one place.",
}

/**
 * The Hub home reinforces the navigation's own mental model rather than
 * restating it as a flat wall of equal cards: the same five intent groups,
 * in the same order, each with its own destinations underneath. A first-time
 * reader gets a short Start Here path above all of it, because "where do I
 * even begin" is the one question a directory cannot answer.
 */
function DestinationRow({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <li>
      <Link
        href={href as never}
        className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{label}</span>
          <span className="mt-0.5 block text-sm text-ink/70">{description}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink/30" />
      </Link>
    </li>
  )
}

/**
 * Personalisation: only ever states what genuinely resolved -- a real active
 * team, a real code, a real child's name where the viewer is a Guardian.
 * When nothing resolves it renders nothing rather than a fabricated
 * "recommended for you" card. Every destination stays listed below
 * regardless -- this is a pointer into the same grouped list, never a
 * second, narrower version of it.
 */
async function PersonalStrip({ supabase, user }: { supabase: SupabaseClient<Database>; user: User }) {
  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)
  if (!teamId) return null

  const teamOptions = await getRugbyHubTeamOptions(supabase, ctx)
  const team = teamOptions.find((t) => t.teamId === teamId)
  if (!team) return null

  const identity = await getRugbyHubIdentityContext(supabase, teamId)
  const codeLabel = identity.rugbyCode === "league" ? "Rugby League" : identity.rugbyCode === "union" ? "Rugby Union" : null

  return (
    <div className="mt-6 rounded-xl border border-mint-300/60 bg-mint-100/50 px-4 py-3">
      <p className="text-sm text-forest-900">
        Showing what&apos;s relevant to <span className="font-semibold">{team.childName ? `${team.childName}'s ` : ""}{team.teamDisplayName}</span>
        {codeLabel ? ` (${codeLabel})` : ""} where it applies &mdash; every destination below stays open to explore.
      </p>
    </div>
  )
}

export default async function RugbyHubLandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Rugby Hub</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Everything Ovalball knows about rugby, in one place &mdash; how the game works, how to play it, how to coach it, and where it all came from. Rules, safeguarding and player-welfare guidance
        comes directly from the governing bodies.
      </p>

      <PersonalStrip supabase={supabase} user={user} />

      <section aria-labelledby="start-here-heading" className="mt-10 rounded-2xl border border-pitch-400/50 bg-mint-100/60 p-5 sm:p-6">
        <h2 id="start-here-heading" className="font-display text-xl text-forest-900">
          New to Rugby? Start Here
        </h2>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-forest-900/85">
          Three places to begin if the sport is new to you. Read them in any order &mdash; nothing is tracked and there is nothing to complete.
        </p>
        <ol className="mt-4 flex flex-col gap-2">
          {HUB_START_HERE.map((item, index) => (
            <li key={item.href}>
              <Link
                href={item.href as never}
                className="flex items-start gap-3 rounded-xl border border-forest-900/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/50 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <span aria-hidden="true" className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-forest-800 text-xs font-semibold text-chalk">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{item.label}</span>
                  <span className="mt-0.5 block text-sm text-ink/70">{item.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-12 flex flex-col gap-10">
        {HUB_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`hub-group-${group.key}`}>
            <h2 id={`hub-group-${group.key}`} className="font-display text-2xl text-ink">
              {group.label}
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/70">{group.blurb}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {group.items.map((item) => (
                <DestinationRow key={item.href} href={item.href} label={item.label} description={item.description} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
