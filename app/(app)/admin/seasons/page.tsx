import { redirect } from "next/navigation"
import { CalendarRange } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { effectivePhaseRange } from "@/lib/calendar/season-window"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { CreateSeasonForm } from "./create-season-form"
import { SeasonRow } from "./season-row"

/**
 * Site Admin reference-data for the season model (20260902150000): a real
 * Union or League campaign with an operational main-season window and,
 * optionally, a pre-season window. Club Admins never create seasons
 * themselves -- they generate/review an age-grade rollover TO a season
 * that already exists here, matching how competitions/venues work.
 */
export default async function AdminSeasonsPage() {
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

  // Site Admin Season CRUD: gated by the narrow site.seasons.manage
  // capability, not blanket is_site_admin() -- a Full Site Admin always
  // has it; a narrow Site Admin needs the explicit grant from Site Admin
  // Management (supabase/migrations/20260924100000_site_admin_seasons_crud.sql).
  const canManageSeasons = await hasCapability(supabase, "site.seasons.manage", "site")

  // Grouped by rugby code (Union and League are separate campaigns, never
  // interleaved chronologically), oldest to newest within each code --
  // past to present, matching how a Club Admin reads a season history.
  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, starts_on, ends_on, pre_season_starts_on, active, is_regression_fixture, season_year_start")
    .order("rugby_code", { ascending: true })
    .order("starts_on", { ascending: true })

  // Real, canonical seasons first within their rugby-code/chronological
  // grouping; regression-only scaffolding (flagged [TEST], see
  // 20260906000000_structured_season_identity.sql) sorted after, so it
  // doesn't clutter the product-owner's normal view. Array.prototype.sort
  // is stable, so this secondary sort preserves the rugby-code/date
  // ordering already established above within each of the two groups.
  const seasons = [...(seasonRows ?? [])].sort((a, b) => Number(a.is_regression_fixture) - Number(b.is_regression_fixture))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <CalendarRange className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Seasons</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Union and League run different campaigns, so each season row carries its own rugby code and, where relevant,
        a real pre-season start date &mdash; never a hard-coded day count that would misfire across a leap year.
      </p>

      {canManageSeasons ? (
        <div className="mt-8 rounded-lg border border-ink/10 bg-white p-6">
          <p className="text-sm font-medium text-ink">Add a season</p>
          <CreateSeasonForm />
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-4 text-sm text-ink/55">
          You can view seasons, but adding, editing, archiving, or deleting one requires Seasons management access. Ask a Full Site Admin to
          grant it from Site Admin Management.
        </div>
      )}

      <div className="mt-8 overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-wide text-ink/50 uppercase">
              <th scope="col" className="px-4 py-3">
                Season name
              </th>
              <th scope="col" className="px-4 py-3">
                Ref
              </th>
              <th scope="col" className="px-4 py-3">
                Code
              </th>
              <th scope="col" className="px-4 py-3">
                Pre-season
              </th>
              <th scope="col" className="px-4 py-3">
                Main season
              </th>
              {canManageSeasons && (
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {canManageSeasons
              ? seasons.map((s) => (
                  <SeasonRow
                    key={s.id}
                    season={{
                      id: s.id,
                      name: s.name,
                      seasonRef: s.season_ref,
                      rugbyCode: s.rugby_code as "union" | "league" | null,
                      seasonYearStart: s.season_year_start,
                      startsOn: s.starts_on,
                      endsOn: s.ends_on,
                      preSeasonStartsOn: s.pre_season_starts_on,
                      active: s.active,
                      isRegressionFixture: s.is_regression_fixture,
                    }}
                  />
                ))
              : seasons.map((s) => (
                  <tr key={s.id} className={`border-b border-ink/5 last:border-0 ${s.is_regression_fixture ? "bg-ink/[0.02]" : ""} ${!s.active ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 font-medium text-ink">
                      {s.name}
                      {s.is_regression_fixture && (
                        <span className="ml-2 rounded border border-ink/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink/45 uppercase">
                          Regression only
                        </span>
                      )}
                      {!s.active && (
                        <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-900 uppercase">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink/70">{s.season_ref}</td>
                    <td className="px-4 py-3 text-ink/70 capitalize">{s.rugby_code ?? "—"}</td>
                    <td className="px-4 py-3 text-ink/70">
                      {(() => {
                        const range = effectivePhaseRange(
                          { id: s.id, name: s.name, seasonRef: s.season_ref, rugbyCode: s.rugby_code, preSeasonStartsOn: s.pre_season_starts_on, startsOn: s.starts_on, endsOn: s.ends_on },
                          "pre"
                        )
                        return range ? `${fmt(range.start)} – ${fmt(range.end)}` : "—"
                      })()}
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {fmt(s.starts_on)} – {fmt(s.ends_on)}
                    </td>
                  </tr>
                ))}
            {seasons.length === 0 && (
              <tr>
                <td colSpan={canManageSeasons ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink/45">
                  No seasons yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
