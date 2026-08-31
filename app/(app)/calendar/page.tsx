import { redirect } from "next/navigation"
import Link from "next/link"
import { CalendarDays } from "lucide-react"

import { getMyTeams } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<string, string> = {
  Booked: "bg-mint-100 text-forest-900",
  Confirmed: "bg-mint-100 text-forest-900",
  Planned: "bg-mint-100/60 text-forest-800",
  "To Be Determined": "bg-mint-100/60 text-forest-800",
  Cancelled: "bg-destructive/10 text-destructive",
  Completed: "bg-ink/5 text-ink/50",
}

/**
 * A real, if intentionally simple, calendar: every upcoming fixture for
 * the session's authorised teams, filterable to one team, grouped by
 * month. Browsing a partner club's shared availability and requesting a
 * fixture from it lives at /partner-clubs/[clubId] instead of here -- this
 * page stays "my own teams' fixtures," that one is "someone else's
 * availability."
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>
}) {
  const { team: teamFilter } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const myTeams = await getMyTeams(supabase, ctx)
  const teamIds = teamFilter ? myTeams.filter((t) => t.id === teamFilter).map((t) => t.id) : myTeams.map((t) => t.id)

  const { data: fixtures } =
    teamIds.length > 0
      ? await supabase
          .from("fixtures")
          .select(
            "id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, venue_address, teams!fixtures_owning_team_id_fkey(display_name)"
          )
          .in("owning_team_id", teamIds)
          .order("kickoff_date", { ascending: true })
      : { data: [] }

  const grouped = new Map<string, typeof fixtures>()
  for (const f of fixtures ?? []) {
    const monthKey = new Date(f.kickoff_date + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    grouped.set(monthKey, [...(grouped.get(monthKey) ?? []), f])
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Calendar</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Fixtures calendar</h1>

      {myTeams.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/calendar"
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              !teamFilter ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/60 hover:bg-ink/5"
            )}
          >
            All teams
          </Link>
          {myTeams.map((t) => (
            <Link
              key={t.id}
              href={`/calendar?team=${t.id}`}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                teamFilter === t.id ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/60 hover:bg-ink/5"
              )}
            >
              {t.displayName}
            </Link>
          ))}
        </div>
      )}

      {grouped.size === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <CalendarDays className="size-5 text-ink/30" />
          <div>
            <p className="text-sm font-medium text-ink">No fixtures yet</p>
            <p className="mt-1 text-sm text-ink/55">Fixtures for your team(s) will appear here once scheduled.</p>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {Array.from(grouped.entries()).map(([month, monthFixtures]) => (
            <section key={month}>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">{month}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {(monthFixtures ?? []).map((f) => {
                  const date = new Date(f.kickoff_date + "T00:00:00")
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                      <div className="w-24 shrink-0">
                        <p className="text-sm font-medium text-ink">
                          {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        </p>
                        {f.kickoff_time && <p className="text-xs text-ink/45">{f.kickoff_time.slice(0, 5)}</p>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {f.teams?.display_name} <span className="text-ink/40">vs</span> {f.raw_opposition_text}
                        </p>
                        <p className="text-xs text-ink/50">
                          {f.home_away}
                          {f.venue_address ? ` · ${f.venue_address}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[f.status] ?? "bg-ink/5 text-ink/60"}`}>
                        {f.status}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
