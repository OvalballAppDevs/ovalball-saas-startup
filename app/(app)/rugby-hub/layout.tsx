import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubTeamOptions } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"
import { HubNav } from "@/components/rugby-hub/nav/hub-nav"
import { HubSearch } from "@/components/rugby-hub/search/hub-search"

import { RUGBY_HUB_TEAM_COOKIE } from "./constants"
import { TeamSwitcher } from "./team-switcher"

export default async function RugbyHubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const teamOptions = await getRugbyHubTeamOptions(supabase, ctx)
  const store = await cookies()
  const cookieTeamId = store.get(RUGBY_HUB_TEAM_COOKIE)?.value
  const activeTeamId = teamOptions.find((t) => t.teamId === cookieTeamId)?.teamId ?? teamOptions[0]?.teamId ?? null

  return (
    <main className="min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-4 sm:justify-start">
            <Link href="/dashboard" className="inline-flex min-h-11 w-fit items-center font-display text-lg text-ink">
              Ovalball
            </Link>
            <Link href="/rugby-hub" className="inline-flex min-h-11 items-center text-sm font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 sm:hidden">
              Rugby Hub
            </Link>
          </div>
          <div className="flex items-center gap-4 sm:flex-1 sm:justify-end">
            <Suspense fallback={<div className="h-11 w-full max-w-sm rounded-full border border-ink/15 bg-white" />}>
              <HubSearch />
            </Suspense>
            <Link href="/rugby-hub" className="hidden min-h-11 shrink-0 items-center text-sm font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 sm:inline-flex">
              Rugby Hub
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pt-5 md:px-8">
        {teamOptions.length > 1 && <TeamSwitcher options={teamOptions} activeTeamId={activeTeamId} />}
      </div>

      <HubNav />

      {/* pb-28 clears the global "Ask Ovie" floating widget (fixed
          bottom-right on every page) -- without it, the Safeguarding
          Officer contact form's Send button sits directly underneath it at
          narrow viewports (confirmed overlapping via getBoundingClientRect
          on the equivalent Match Centre control during UAT).

          activeTeamId is NOT a gate here: not every Rugby Hub destination
          is team-specific. The Story of Rugby (and any future universally-
          available knowledge, e.g. Glossary) needs no team relationship at
          all. Rules/Safeguarding/Player Welfare each already re-derive
          their own team context independently and render their own
          "no team relationship" notice when it's null -- see
          rugby-hub/safeguarding/page.tsx and player-welfare/page.tsx --
          so a second, blunter block here was blocking a destination it
          should never have applied to. */}
      <div className="mx-auto max-w-3xl px-4 pt-10 pb-28 md:px-8 md:pt-14 md:pb-28">{children}</div>
    </main>
  )
}
