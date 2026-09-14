import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { getPublicHeaderIdentity } from "@/lib/app-context/public-header-identity"
import { groupLetter, tieLabel } from "@/lib/competitions/drafts"
import { knockoutRoundName } from "@/lib/competitions/knockout"
import { publicRoundOptions } from "@/lib/competitions/public-filters"
import { computeStandings, DEFAULT_POINTS } from "@/lib/competitions/standings"
import { getBetaBadgeState } from "@/lib/platform/mode"
import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { cn } from "@/lib/utils"

/**
 * A COMPETITION, IN PUBLIC.
 *
 * Schedule, results, tables and the bracket, all read from Competition Match
 * records -- never from club fixtures -- so a match between two clubs that are
 * not on Ovalball appears exactly like any other. Only issued, public matches
 * of an active competition are visible, by RLS. Filters are plain links and a
 * GET form, so the page works without JavaScript and every view can be shared.
 *
 * Rounds are named by their stage: "League, Round 2" is a different round from
 * "Knockout, Quarter-Finals", so a filter never mixes them.
 */

type View = "schedule" | "results" | "tables" | "bracket"
const VIEWS: { key: View; label: string }[] = [
  { key: "schedule", label: "Upcoming" },
  { key: "results", label: "Results" },
  { key: "tables", label: "Tables" },
  { key: "bracket", label: "Bracket" },
]

async function loadCompetition(slug: string) {
  const supabase = await createClient()
  const { data: competition } = await supabase.from("competitions").select("id, name, rugby_code, organiser_name, canonical_team_type_id").eq("slug", slug).eq("active", true).maybeSingle()
  if (!competition) return null
  const { data: editions } = await supabase.from("competition_editions").select("id, seasons(name, starts_on)").eq("competition_id", competition.id).eq("active", true)
  const edition = [...(editions ?? [])].sort((a, b) => (b.seasons?.starts_on ?? "").localeCompare(a.seasons?.starts_on ?? ""))[0]
  if (!edition) return { competition, category: null, edition: null, participants: [], stages: [], members: [], matches: [] }
  const [{ data: participants }, { data: stages }, { data: matches }, { data: category }] = await Promise.all([
    supabase.from("competition_participants").select("id, club_directory_id, club_directory(name), teams(rugby_code, category, age_group, gender, squad_designation)").eq("edition_id", edition.id),
    supabase.from("competition_stages").select("id, kind, name, sort_order, settings, competition_groups(id, name, sort_order)").eq("edition_id", edition.id).order("sort_order"),
    supabase
      .from("competition_matches")
      .select("id, stage_id, group_id, round_number, bracket_slot, home_participant_id, away_participant_id, home_source, away_source, match_date, kickoff_time, venue_text, status, home_score, away_score, winner_participant_id, venues(name)")
      .eq("edition_id", edition.id)
      .order("match_date", { nullsFirst: false })
      .order("kickoff_time", { nullsFirst: false }),
    competition.canonical_team_type_id
      ? // The base catalogue, which the public may read (the per-code view joins regulatory mappings it may not).
        supabase.from("canonical_team_types").select("category, age_group, gender").eq("id", competition.canonical_team_type_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const stageIds = (stages ?? []).map((s) => s.id)
  const { data: members } = stageIds.length ? await supabase.from("competition_group_members").select("group_id, participant_id").in("stage_id", stageIds) : { data: [] }
  const type = category as { category: string; age_group: string | null; gender: string | null } | null
  // The competition's age and category, in the site-wide display form ("Under 12 Boys").
  const categoryLabel = type ? fullTeamLabel({ category: type.category, ageGroup: type.age_group, gender: type.gender, squadDesignation: null, rugbyCode: competition.rugby_code }) : null
  return { competition, category: categoryLabel, edition, participants: participants ?? [], stages: stages ?? [], members: members ?? [], matches: matches ?? [] }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = await loadCompetition(slug)
  return { title: data ? data.competition.name : "Competition" }
}

export default async function PublicCompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ view?: string; stage?: string; group?: string; round?: string; date?: string; club?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const data = await loadCompetition(slug)
  if (!data) notFound()
  const [identity, beta] = await Promise.all([getPublicHeaderIdentity(), getBetaBadgeState()])
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "schedule"

  const nameOf = new Map(
    data.participants.map((p) => [
      p.id,
      [p.club_directory?.name, p.teams ? fullTeamLabel({ category: p.teams.category, ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation, rugbyCode: p.teams.rugby_code }) : null]
        .filter(Boolean)
        .join(" "),
    ]),
  )
  const clubOf = new Map(data.participants.map((p) => [p.id, p.club_directory_id]))
  const clubs = [...new Map(data.participants.map((p) => [p.club_directory_id, p.club_directory?.name ?? "Club"])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const groups = data.stages.flatMap((s) => [...(s.competition_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order))
  const source = (s: unknown) => (s && typeof s === "object" && "label" in s ? String((s as { label: string }).label) : "TBC")
  const league = data.stages.find((s) => s.kind === "league")
  const knockout = data.stages.find((s) => s.kind === "knockout")
  const kindOf = (stageId: string) => data.stages.find((s) => s.id === stageId)?.kind ?? "league"
  const knockoutRounds = Math.max(0, ...data.matches.filter((m) => kindOf(m.stage_id) === "knockout").map((m) => m.round_number ?? 0))
  const roundOptions = publicRoundOptions(
    data.matches.map((m) => ({ kind: kindOf(m.stage_id), round: m.round_number })),
    knockoutRounds,
    sp.stage === "league" || sp.stage === "knockout" ? sp.stage : null,
  )
  const dates = [...new Set(data.matches.map((m) => m.match_date).filter((d): d is string => Boolean(d)))].sort()
  const today = new Date().toISOString().slice(0, 10)

  const filtered = data.matches.filter(
    (m) =>
      (!sp.stage || kindOf(m.stage_id) === sp.stage) &&
      (!sp.group || m.group_id === sp.group) &&
      (!sp.round || `${kindOf(m.stage_id)}-${m.round_number}` === sp.round) &&
      (!sp.date || m.match_date === sp.date) &&
      (!sp.club || clubOf.get(m.home_participant_id ?? "") === sp.club || clubOf.get(m.away_participant_id ?? "") === sp.club),
  )
  const filtering = Boolean(sp.stage || sp.group || sp.round || sp.date || sp.club)
  // Upcoming: not yet played, today or later (or a date still to be set).
  const schedule = filtered.filter((m) => m.status !== "completed" && m.status !== "cancelled" && (!m.match_date || m.match_date >= today))
  const results = filtered.filter((m) => m.status === "completed").reverse()
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ view, stage: sp.stage, group: sp.group, round: sp.round, date: sp.date, club: sp.club, ...over }).filter(([, v]) => v) as [string, string][])
    return `/competitions/${slug}?${q.toString()}`
  }

  return (
    <>
      <Header identity={identity} beta={beta} />
      <main className="bg-chalk">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-12">
          <p className="text-sm text-ink-muted">
            {data.edition?.seasons?.name && /rugby/i.test(data.edition.seasons.name)
              ? data.edition.seasons.name
              : [data.competition.rugby_code === "league" ? "Rugby League" : "Rugby Union", data.edition?.seasons?.name].filter(Boolean).join(", ")}
            {data.category ? `, ${data.category}` : ""}
            {data.competition.organiser_name ? `, organised by ${data.competition.organiser_name}` : ""}
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink">{data.competition.name}</h1>

          <nav aria-label="Competition views" className="mt-6 flex gap-1 border-b border-ink/10">
            {VIEWS.map((v) => (
              <Link key={v.key} href={href({ view: v.key })} aria-current={view === v.key ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", view === v.key ? "border-forest-800 font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink")}>
                {v.label}
              </Link>
            ))}
          </nav>

          {(view === "schedule" || view === "results") && (
            <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="view" value={view} />
              {league && knockout && <Filter id="f-stage" name="stage" label="Stage" value={sp.stage} options={[["league", "League"], ["knockout", "Knockout"]]} />}
              {groups.length > 0 && sp.stage !== "knockout" && <Filter id="f-group" name="group" label="Group" value={sp.group} options={groups.map((g) => [g.id, g.name])} />}
              {roundOptions.length > 0 && <Filter id="f-round" name="round" label="Round" value={sp.round} options={roundOptions} />}
              {dates.length > 0 && <Filter id="f-date" name="date" label="Date" value={sp.date} options={dates.map((d) => [d, formatDate(d)])} />}
              <Filter id="f-club" name="club" label="Club" value={sp.club} options={clubs} />
              <button type="submit" className="h-9 rounded-md bg-forest-800 px-3 text-sm font-medium text-white hover:bg-forest-900">
                Apply Filters
              </button>
              {(sp.club || sp.group || sp.round || sp.stage || sp.date) && (
                <Link href={`/competitions/${slug}?view=${view}`} className="h-9 px-2 text-sm leading-9 text-ink-muted hover:text-ink">
                  Clear
                </Link>
              )}
            </form>
          )}

          {view === "schedule" && <MatchList matches={schedule} nameOf={nameOf} source={source} empty={filtering ? "No upcoming matches match these filters." : "No upcoming matches."} />}
          {view === "results" && <MatchList matches={results} nameOf={nameOf} source={source} empty={filtering ? "No results match these filters." : "No results yet."} showScore />}

          {view === "tables" &&
            (league && groups.length > 0 ? (
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {(league.competition_groups ?? []).map((g, gi) => {
                  const ids = data.members.filter((m) => m.group_id === g.id).map((m) => m.participant_id)
                  const rows = computeStandings(
                    ids.map((id) => ({ id, label: nameOf.get(id) ?? "Team" })),
                    data.matches.filter((m) => m.group_id === g.id).map((m) => ({ homeParticipantId: m.home_participant_id, awayParticipantId: m.away_participant_id, homeScore: m.home_score, awayScore: m.away_score, status: m.status })),
                    ((league.settings as { points?: typeof DEFAULT_POINTS } | null)?.points) ?? DEFAULT_POINTS,
                  )
                  return (
                    <section key={g.id} aria-labelledby={`table-${g.id}`} className="relative overflow-x-auto rounded-lg border border-ink/10 bg-white">
                      <h2 id={`table-${g.id}`} className="border-b border-ink/8 px-4 py-2 text-sm font-semibold text-ink">
                        {g.name || `Group ${groupLetter(gi)}`}
                      </h2>
                      <table className="w-full text-sm tabular-nums">
                        <thead>
                          <tr className="text-left text-xs text-ink-muted">
                            <th scope="col" className="px-3 py-1.5 font-medium">
                              <span className="sr-only">Position</span>
                            </th>
                            <th scope="col" className="px-2 py-1.5 font-medium">
                              Team
                            </th>
                            {["P", "W", "D", "L", "+/-", "Pts"].map((h) => (
                              <th key={h} scope="col" className="px-2 py-1.5 text-right font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.participantId} className="border-t border-ink/6">
                              <td className="px-3 py-1.5 text-ink-muted">{r.position}</td>
                              <td className="px-2 py-1.5 text-ink">{r.label}</td>
                              <td className="px-2 py-1.5 text-right">{r.played}</td>
                              <td className="px-2 py-1.5 text-right">{r.won}</td>
                              <td className="px-2 py-1.5 text-right">{r.drawn}</td>
                              <td className="px-2 py-1.5 text-right">{r.lost}</td>
                              <td className="px-2 py-1.5 text-right">{r.difference}</td>
                              <td className="px-2 py-1.5 text-right font-semibold text-ink">{r.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )
                })}
              </div>
            ) : (
              <p className="mt-6 text-sm text-ink-muted">This competition has no league tables.</p>
            ))}

          {view === "bracket" &&
            (knockout ? (
              <Bracket matches={data.matches.filter((m) => m.stage_id === knockout.id)} nameOf={nameOf} source={source} />
            ) : (
              <p className="mt-6 text-sm text-ink-muted">This competition has no knockout.</p>
            ))}
        </div>
      </main>
      <Footer />
    </>
  )
}

type PublicMatch = NonNullable<Awaited<ReturnType<typeof loadCompetition>>>["matches"][number]

/** A knockout tie fed by semi-final losers is the third-place playoff, whatever its slot. */
function isThirdPlace(m: { home_source: unknown }) {
  return Boolean(m.home_source && typeof m.home_source === "object" && "loser_of" in (m.home_source as object))
}

function Filter({ id, name, label, value, options }: { id: string; name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className="mt-1 h-9 max-w-56 rounded-md border border-ink/15 bg-white px-2 text-sm">
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return "Date to be confirmed"
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

function MatchList({ matches, nameOf, source, empty, showScore = false }: { matches: PublicMatch[]; nameOf: Map<string, string>; source: (s: unknown) => string; empty: string; showScore?: boolean }) {
  if (matches.length === 0) return <p className="mt-6 text-sm text-ink-muted">{empty}</p>
  const byDate = new Map<string, PublicMatch[]>()
  for (const m of matches) byDate.set(m.match_date ?? "", [...(byDate.get(m.match_date ?? "") ?? []), m])
  return (
    <div className="mt-6 flex flex-col gap-5">
      {[...byDate.entries()].map(([date, list]) => (
        <section key={date || "tbc"} aria-label={formatDate(date || null)}>
          <h2 className="text-sm font-semibold text-ink">{formatDate(date || null)}</h2>
          <ul className="mt-2 divide-y divide-ink/6 rounded-lg border border-ink/10 bg-white">
            {list.map((m) => (
              <li key={m.id} className="grid grid-cols-[4rem_1fr_auto_1fr] items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-ink-muted tabular-nums">{m.kickoff_time?.slice(0, 5) ?? "TBC"}</span>
                <span className={cn("text-right text-ink", m.winner_participant_id && m.winner_participant_id === m.home_participant_id && "font-semibold")}>{m.home_participant_id ? nameOf.get(m.home_participant_id) : source(m.home_source)}</span>
                <span className="text-center font-medium text-ink tabular-nums">{showScore && m.home_score !== null ? `${m.home_score} – ${m.away_score}` : m.status === "postponed" ? "Postponed" : "v"}</span>
                <span className={cn("text-ink", m.winner_participant_id && m.winner_participant_id === m.away_participant_id && "font-semibold")}>
                  {m.away_participant_id ? nameOf.get(m.away_participant_id) : source(m.away_source)}
                  {(m.venues?.name || m.venue_text) && <span className="block text-xs text-ink-muted">{m.venues?.name ?? m.venue_text}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Bracket({ matches, nameOf, source }: { matches: PublicMatch[]; nameOf: Map<string, string>; source: (s: unknown) => string }) {
  const roundsCount = Math.max(0, ...matches.map((m) => m.round_number ?? 0))
  if (roundsCount === 0) return <p className="mt-6 text-sm text-ink-muted">The knockout draw has not been published.</p>
  return (
    <div className="relative mt-6 overflow-x-auto rounded-lg border border-ink/10 bg-white">
      <div className="flex min-w-max px-2 py-4">
        {Array.from({ length: roundsCount }, (_, i) => i + 1).map((round) => {
          const inRound = matches.filter((m) => m.round_number === round).sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0))
          return (
            <div key={round} className="flex w-60 flex-col px-3">
              <h2 className="mb-2 text-xs font-semibold text-ink-muted">{knockoutRoundName(round, roundsCount)}</h2>
              <ol className="flex flex-1 flex-col justify-around gap-3">
                {inRound.map((m) => (
                  <li key={m.id} className="rounded-md border border-ink/12 px-2.5 py-1.5 text-sm">
                    <p className="text-[11px] text-ink-muted">{isThirdPlace(m) ? "Third Place" : tieLabel(round, roundsCount, m.bracket_slot ?? 1)}</p>
                    {[
                      [m.home_participant_id, m.home_source, m.home_score],
                      [m.away_participant_id, m.away_source, m.away_score],
                    ].map(([pid, src, score], i) => (
                      <p key={i} className={cn("flex justify-between gap-2", pid && pid === m.winner_participant_id && "font-semibold")}>
                        <span className={cn("truncate", pid ? "text-ink" : "italic text-ink-muted")}>{pid ? nameOf.get(pid as string) : source(src)}</span>
                        {score !== null && <span className="tabular-nums">{String(score)}</span>}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          )
        })}
      </div>
    </div>
  )
}
