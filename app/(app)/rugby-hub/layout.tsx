import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubTeamOptions } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"

import { RugbyHubSectionNav } from "./section-nav"
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
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/dashboard" className="w-fit font-display text-lg text-ink">
            Ovalball
          </Link>
          <Link href="/rugby-hub" className="text-sm font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
            Rugby Hub
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pt-5 md:px-8">
        {teamOptions.length > 1 && <TeamSwitcher options={teamOptions} activeTeamId={activeTeamId} />}
      </div>

      <RugbyHubSectionNav />

      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8 md:py-14">
        {activeTeamId ? (
          children
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3.5" role="alert">
            <p className="text-[15px] leading-relaxed text-ink/80">
              Rugby Hub needs a real club/team relationship to show content for -- you don&rsquo;t currently have one (no linked player, guardian relationship, or team role).
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
