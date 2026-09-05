import { redirect } from "next/navigation"
import { Trophy } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AddCompetitionDialog } from "./add-competition-dialog"
import { CompetitionEditionsPanel } from "./competition-editions-panel"
import { DeactivateCompetitionButton } from "./deactivate-competition-button"

export interface GeographicArea {
  id: string
  name: string
  nation: string
}

export interface SeasonOption {
  id: string
  name: string
  rugbyCode: string | null
}

export interface EditionRow {
  id: string
  competitionId: string
  active: boolean
  seasonId: string
  seasonName: string
}

/**
 * Site Admin Competition Directory -- the GLOBAL competition catalogue
 * every club's fixture form reads from live (via competition_editions,
 * one per-season run of a competition -- this page manages the enduring
 * competition concept itself, e.g. "Lancashire Cup"). Every active Site
 * Admin can VIEW this directory; only one with the specific
 * manage_competitions grant (see /admin/site-admins) can add or
 * deactivate a competition.
 */
export default async function CompetitionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx

  const [{ data: competitions }, { data: areas }, { data: compAreas }, { data: seasonRows }, { data: editionRows }] = await Promise.all([
    supabase.from("competitions").select("id, name, description, rugby_code, is_national, active").order("rugby_code").order("name"),
    supabase.from("geographic_areas").select("id, name, nation").order("nation").order("sort_order"),
    supabase.from("competition_areas").select("competition_id, geographic_areas(name)"),
    supabase.from("seasons").select("id, name, rugby_code").eq("is_regression_fixture", false).order("starts_on", { ascending: false }),
    supabase.from("competition_editions").select("id, competition_id, active, seasons(id, name)").order("created_at", { ascending: false }),
  ])

  const areaNamesByCompetition = new Map<string, string[]>()
  for (const row of compAreas ?? []) {
    const list = areaNamesByCompetition.get(row.competition_id) ?? []
    if (row.geographic_areas?.name) list.push(row.geographic_areas.name)
    areaNamesByCompetition.set(row.competition_id, list)
  }

  const seasons: SeasonOption[] = (seasonRows ?? []).map((s) => ({ id: s.id, name: s.name, rugbyCode: s.rugby_code }))

  const editionsByCompetition = new Map<string, EditionRow[]>()
  for (const row of editionRows ?? []) {
    if (!row.seasons) continue
    const list = editionsByCompetition.get(row.competition_id) ?? []
    list.push({ id: row.id, competitionId: row.competition_id, active: row.active, seasonId: row.seasons.id, seasonName: row.seasons.name })
    editionsByCompetition.set(row.competition_id, list)
  }

  const byCode = new Map<string, typeof competitions>()
  for (const c of competitions ?? []) {
    const list = byCode.get(c.rugby_code) ?? []
    list.push(c)
    byCode.set(c.rugby_code, list)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Trophy className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Competitions</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        The global list of real competitions every club&apos;s fixture form selects from &mdash; leagues, cups, and
        friendlies&apos; own categorisation. Clubs enter each season&apos;s edition of a competition; this directory
        defines the competition itself.
      </p>

      {!ctx.manageCompetitions && (
        <p className="mt-6 rounded-lg border border-forest-800/20 bg-forest-800/5 px-4 py-3 text-sm text-forest-800">
          You can view the Competition Directory. Adding or deactivating a competition requires the Competition
          management capability &mdash; a Full Site Admin can grant it from Site Admin Management.
        </p>
      )}

      {ctx.manageCompetitions && (
        <div className="mt-8">
          <AddCompetitionDialog areas={(areas ?? []) as GeographicArea[]} />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-6">
        {["union", "league"].map((code) => {
          const rows = byCode.get(code) ?? []
          if (rows.length === 0) return null
          return (
            <div key={code}>
              <p className="text-xs font-medium tracking-[0.06em] text-ink/40 uppercase">{code === "union" ? "Rugby Union" : "Rugby League"}</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-ink/10 bg-white">
                <ul className="divide-y divide-ink/5">
                  {rows.map((c) => {
                    const scope = c.is_national ? "National" : (areaNamesByCompetition.get(c.id) ?? []).join(", ") || "No area set"
                    return (
                      <li key={c.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-medium ${c.active ? "text-ink" : "text-ink/40 line-through"}`}>{c.name}</p>
                            <p className="truncate text-xs text-ink/40">
                              {scope}
                              {!c.active && " · Deactivated"}
                            </p>
                            {c.description && <p className="mt-0.5 truncate text-xs text-ink/35">{c.description}</p>}
                          </div>
                          {ctx.manageCompetitions && c.active && <DeactivateCompetitionButton id={c.id} name={c.name} />}
                        </div>
                        {c.active && (
                          <CompetitionEditionsPanel
                            competitionId={c.id}
                            competitionRugbyCode={c.rugby_code}
                            editions={editionsByCompetition.get(c.id) ?? []}
                            seasons={seasons}
                            canManage={ctx.manageCompetitions}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
        {(competitions ?? []).length === 0 && <p className="text-sm text-ink/45">No competitions yet.</p>}
      </div>
    </div>
  )
}
