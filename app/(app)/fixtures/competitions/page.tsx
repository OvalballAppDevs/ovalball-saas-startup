import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus } from "lucide-react"

import { resolveOrganiserScope } from "@/lib/competitions/organiser-scope"
import { MATCH_STATUS_WORD } from "@/lib/competitions/workspace-types"

export const metadata = { title: "Competitions" }

/**
 * THE COMPETITIONS THIS PERSON ORGANISES.
 *
 * Site Admin (active as Site Admin) sees every competition; a club's fixture
 * administrators see the competitions their club organises. Team staff never
 * reach this page -- organising a competition is club and platform work.
 */
export default async function CompetitionsListPage() {
  const scope = await resolveOrganiserScope()
  if (!scope) redirect("/fixtures")
  const { supabase } = scope

  let query = supabase
    .from("competition_editions")
    .select("id, active, created_at, competitions!inner(id, name, rugby_code, format, team_count, organiser_club_id, active), seasons(name)")
    .eq("competitions.active", true)
    .order("created_at", { ascending: false })
    .limit(200)
  if (!scope.siteAdmin) query = query.eq("competitions.organiser_club_id", scope.clubId!)
  const { data: editions } = await query

  const editionIds = (editions ?? []).map((e) => e.id)
  const { data: matchRows } =
    editionIds.length > 0 ? await supabase.from("competition_matches").select("edition_id, status").in("edition_id", editionIds) : { data: [] }
  const counts = new Map<string, Record<string, number>>()
  for (const m of matchRows ?? []) {
    const c = counts.get(m.edition_id) ?? {}
    c[m.status] = (c[m.status] ?? 0) + 1
    counts.set(m.edition_id, c)
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Competitions</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            {scope.siteAdmin ? "Every competition on Ovalball." : "Competitions your club organises."} Build the draw, check it for clashes, then issue it to the clubs taking part.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/fixtures/competitions/requests" className="inline-flex h-9 items-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 hover:border-ink/30 hover:text-ink">
            Competition Requests
          </Link>
          <Link href="/fixtures/competitions/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-forest-800 px-4 text-sm font-medium text-white hover:bg-forest-900">
            <Plus className="size-4" aria-hidden="true" />
            New Competition
          </Link>
        </div>
      </div>

      {(editions ?? []).length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-6 py-12 text-center">
          <p className="font-display text-xl text-ink">No competitions yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">Start with a name. Teams, groups, fixtures and a knockout can all be added step by step.</p>
          <Link href="/fixtures/competitions/new" className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg bg-forest-800 px-4 text-sm font-medium text-white hover:bg-forest-900">
            <Plus className="size-4" aria-hidden="true" />
            New Competition
          </Link>
        </div>
      ) : (
        <div className="relative mt-6 overflow-x-auto rounded-lg border border-ink/10 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Competition
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Season
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Format
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Matches
                </th>
              </tr>
            </thead>
            <tbody>
              {(editions ?? []).map((e) => {
                const c = counts.get(e.id) ?? {}
                const total = Object.values(c).reduce((a, b) => a + b, 0)
                const summary = Object.entries(c)
                  .filter(([, n]) => n > 0)
                  .map(([s, n]) => `${n} ${MATCH_STATUS_WORD[s]?.toLowerCase() ?? s}`)
                  .join(", ")
                return (
                  <tr key={e.id} className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
                    <td className="px-4 py-2.5">
                      <Link href={`/fixtures/competitions/${e.id}/participants`} className="font-medium text-ink hover:underline">
                        {e.competitions.name}
                      </Link>
                      <span className="block text-xs text-ink-muted">{e.competitions.rugby_code === "league" ? "Rugby League" : "Rugby Union"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{e.seasons?.name ?? "No season"}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {e.competitions.format === "league_knockout" ? "League + Knockout" : e.competitions.format === "knockout" ? "Knockout" : e.competitions.format === "league" ? "League" : "Not set"}
                      {e.competitions.team_count ? `, ${e.competitions.team_count} teams` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted tabular-nums">{total > 0 ? summary : "None yet"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
