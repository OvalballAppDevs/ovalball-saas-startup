"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { ALL_FIXTURE_STATUSES, FIXTURE_STATUS_LABEL } from "@/lib/fixtures/status"

import { SOURCE_LABEL } from "./format"
import type { AdminFixtureQuery, CompetitionFilterOption, SeasonFilterOption, TeamFilterOption } from "./types"

export function FixtureFilters({
  query,
  competitionOptions,
  basePath,
  showCodeFilter = true,
  seasonOptions = [],
  teamOptions = [],
}: {
  query: AdminFixtureQuery
  competitionOptions: CompetitionFilterOption[]
  basePath: string
  /** Seasons that actually have fixtures -- never the whole register. */
  seasonOptions?: SeasonFilterOption[]
  /** Only supplied on a club-scoped surface: "which of OUR teams" is not a question Site Admin's global view can ask. */
  teamOptions?: TeamFilterOption[]
  /** False for a club-scoped surface whose active teams field only one rugby code -- a "Union + League" choice has nothing to offer there. Site Admin's global view always keeps it. */
  showCodeFilter?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(query.q)
  const [prevQ, setPrevQ] = useState(query.q)
  if (query.q !== prevQ) {
    setPrevQ(query.q)
    setSearchValue(query.q)
  }

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      // "date"'s neutral/default value is "upcoming" (Section 5), not
      // "all" -- every other filter here still treats "all" as "no filter
      // applied, omit the param". Special-cased rather than made generic
      // since date is the one filter whose default isn't its widest value.
      const isDefault = key === "date" ? value === "upcoming" : value === "all"
      if (value === null || value === "" || isDefault) params.delete(key)
      else params.set(key, value)
    }
    params.delete("page")
    router.push(`${basePath}?${params.toString()}`)
  }

  useEffect(() => {
    const trimmed = searchValue.trim()
    if (trimmed === query.q) return
    const timer = setTimeout(() => updateParams({ q: trimmed || null }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the debounced value should re-trigger this
  }, [searchValue])

  return (
    // A TOOLBAR, NOT A FORM. The fixture table is the hero; wrapped in a
    // white card with generous padding, the filters read as something to
    // fill in before the real content, and cost about a sixth of the
    // viewport doing it. The controls are unchanged; the container stops
    // announcing itself.
    <div className="flex flex-col gap-2 border-b border-ink/10 pb-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search fixtures</span>
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by club, team, opposition, competition or venue&hellip;"
            className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink/60">
          <span className="whitespace-nowrap">Sort</span>
          <select
            value={query.sort}
            onChange={(e) => updateParams({ sort: e.target.value })}
            className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="date-asc">Date &uarr;</option>
            <option value="date-desc">Date &darr;</option>
            <option value="club">Club A &rarr; Z</option>
            <option value="created-desc">Recently created</option>
            <option value="updated-desc">Recently updated</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <select
          value={query.date}
          onChange={(e) => updateParams({ date: e.target.value })}
          aria-label="Date range"
          className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
        >
          <option value="all">All dates</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        {seasonOptions.length > 0 && (
          <select
            value={query.seasonId ?? "all"}
            onChange={(e) => updateParams({ season: e.target.value === "all" ? null : e.target.value })}
            aria-label="Season"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">All seasons</option>
            {seasonOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {teamOptions.length > 0 && (
          <select
            value={query.teamId ?? "all"}
            onChange={(e) => updateParams({ team: e.target.value === "all" ? null : e.target.value })}
            aria-label="Team"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">All teams</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <select
          value={query.homeAway}
          onChange={(e) => updateParams({ ha: e.target.value })}
          aria-label="Home or away"
          className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
        >
          <option value="all">Home + Away</option>
          <option value="Home">Home</option>
          <option value="Away">Away</option>
        </select>
        <select
          value={query.status}
          onChange={(e) => updateParams({ status: e.target.value })}
          aria-label="Status"
          className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
        >
          <option value="all">Any status</option>
          {ALL_FIXTURE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FIXTURE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {showCodeFilter && (
          <select
            value={query.code}
            onChange={(e) => updateParams({ code: e.target.value })}
            aria-label="Rugby code"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">Union + League</option>
            <option value="union">Union</option>
            <option value="league">League</option>
          </select>
        )}
        <select
          value={query.source}
          onChange={(e) => updateParams({ source: e.target.value })}
          aria-label="Source"
          className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
        >
          <option value="all">Any source</option>
          <option value="club_created">{SOURCE_LABEL.club_created}</option>
          <option value="site_admin_manual">{SOURCE_LABEL.site_admin_manual}</option>
          <option value="csv_import">{SOURCE_LABEL.csv_import}</option>
          <option value="competition_import">{SOURCE_LABEL.competition_import}</option>
        </select>
        <select
          value={query.resultStatus}
          onChange={(e) => updateParams({ resultStatus: e.target.value })}
          aria-label="Result status"
          className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
        >
          <option value="all">Any result</option>
          <option value="none">No result</option>
          <option value="awaiting_confirmation">Awaiting confirmation</option>
          <option value="final">Final</option>
          <option value="disputed">Disputed</option>
          <option value="amendment_pending">Amendment pending</option>
          <option value="unverified">Unverified</option>
          <option value="external_recorded">Recorded (external opponent)</option>
        </select>
        {competitionOptions.length > 0 && (
          <select
            value={query.competitionEditionId ?? "all"}
            onChange={(e) => updateParams({ competition: e.target.value === "all" ? null : e.target.value })}
            aria-label="Competition"
            className="h-9 rounded-full border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
          >
            <option value="all">Any competition</option>
            {competitionOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        {(query.q ||
          query.date !== "upcoming" ||
          query.status !== "all" ||
          query.code !== "all" ||
          query.source !== "all" ||
          query.resultStatus !== "all" ||
          query.competitionEditionId) && (
          <button
            type="button"
            onClick={() => router.push(basePath)}
            className="flex h-9 items-center rounded-full px-3 text-sm text-ink-muted underline decoration-dotted outline-none hover:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
