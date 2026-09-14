"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { groupLetter, knockoutDraftMatches, tieLabel } from "@/lib/competitions/drafts"
import { bracketSameGroupTies, buildBracket, bracketSize, knockoutRoundName, seededQualifiers, type Bracket } from "@/lib/competitions/knockout"
import { computeStandings, DEFAULT_POINTS } from "@/lib/competitions/standings"
import { MATCH_STATUS_WORD, participantLabel, type CompetitionWorkspace, type KnockoutSettings, type WorkspaceMatch } from "@/lib/competitions/workspace-types"
import { leaveNotice, takeNotice } from "@/lib/competitions/flash"
import { cn } from "@/lib/utils"

import { replaceDraftMatches, saveStage, updateMatch, updateMatches } from "../../actions"
import { planReplacement } from "@/lib/competitions/match-edits"
import { MatchRow, venueChooser } from "./step-fixtures"
import { competitionConflicts } from "@/lib/competitions/competition-conflicts"

/**
 * KNOCKOUT -- THE DRAW, AND THE BRACKET IT MAKES.
 *
 * Random (a numbered draw), seeded (by the seeds on Participants) or manual
 * (slot order). One or two legs, a third-place playoff, a final venue. Byes
 * go to the top seeds and are never matches: their team goes straight into
 * the next round. In League + Knockout the first round is made of places
 * ("Group A 1st"), filled from the group tables once the group stage is done.
 */

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function StepKnockout({ ws }: { ws: CompetitionWorkspace }) {
  const router = useRouter()
  const league = ws.stages.find((s) => s.kind === "league")
  const knockout = ws.stages.find((s) => s.kind === "knockout")
  const saved: KnockoutSettings = knockout?.settings ?? {}
  const [seeding, setSeeding] = useState<NonNullable<KnockoutSettings["seeding"]>>(saved.seeding ?? "seeded")
  const [seedNumber, setSeedNumber] = useState(saved.seedNumber ?? 1)
  const [legs, setLegs] = useState<1 | 2>(saved.legs ?? 1)
  const [thirdPlace, setThirdPlace] = useState(saved.thirdPlace ?? false)
  const [perGroup, setPerGroup] = useState(saved.qualifiersPerGroup ?? 2)
  const [pairing, setPairing] = useState<NonNullable<KnockoutSettings["qualifierPairing"]>>(saved.qualifierPairing ?? "winners_seeded")
  const [finalVenue, setFinalVenue] = useState(saved.finalVenueText ?? "")
  const [finalVenueMode, setFinalVenueMode] = useState<NonNullable<KnockoutSettings["finalVenueMode"]>>(saved.finalVenueMode ?? (saved.finalVenueText ? "neutral" : "home"))
  const [homeAllocation, setHomeAllocation] = useState<NonNullable<KnockoutSettings["homeAllocation"]>>(saved.homeAllocation ?? "seeded")
  const [avoidSameGroup, setAvoidSameGroup] = useState(saved.avoidSameGroup ?? true)
  const [firstDate, setFirstDate] = useState(saved.firstDate ?? "")
  const [everyDays, setEveryDays] = useState(saved.everyDays ?? 14)
  const [kickoff, setKickoff] = useState(saved.kickoff ?? "")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => takeNotice(`${ws.editionId}:knockout`))
  const [pending, start] = useTransition()
  // Two clicks swap two teams between round-one ties (or home and away within one).
  const [pick, setPick] = useState<{ matchId: string; side: "home" | "away" } | null>(null)
  const reports = useMemo(() => new Map(competitionConflicts(ws).map((r) => [r.key, r])), [ws])

  const entered = useMemo(() => ws.participants.filter((p) => p.status === "entered").sort((a, b) => a.slot - b.slot), [ws.participants])
  const byId = useMemo(() => new Map(ws.participants.map((p) => [p.id, p])), [ws.participants])
  const koMatches = ws.matches.filter((m) => m.stageId === knockout?.id)
  const issued = koMatches.some((m) => m.status !== "draft")

  if (ws.format === "league") {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">This competition is a league, so it has no knockout. Change the format in Details to add one.</p>
  }
  const fromGroups = ws.format === "league_knockout"
  const groups = league?.groups ?? []
  if (fromGroups && groups.length === 0) {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">Draw the groups first. The knockout is made of the places each group sends through.</p>
  }
  if (!fromGroups && entered.length < 2) {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">Add at least two participants before drawing the knockout.</p>
  }

  const entrants = fromGroups ? seededQualifiers(groups.length, Math.max(1, Math.min(perGroup, Math.min(...groups.map((g) => g.members.length))))) : entered.map((p) => ({ id: p.id, seed: p.seed }))
  const entrantCount = entrants.length
  const size = bracketSize(entrantCount)
  const byes = size - entrantCount
  const placeName = (id: string) => {
    if (id.startsWith("q:")) {
      const [, g, pos] = id.split(":")
      return `${groups[Number(g)]?.name ?? `Group ${groupLetter(Number(g))}`} ${["", "1st", "2nd", "3rd"][Number(pos)] ?? `${pos}th`}`
    }
    return participantLabel(byId.get(id))
  }
  const drawSeeding = fromGroups ? (pairing === "winners_seeded" ? "seeded" : pairing) : seeding
  const preview: Bracket | null = entrantCount >= 2 ? buildBracket(entrants, { seeding: drawSeeding, seedNumber, legs, thirdPlace, homeAllocation, avoidSameGroup: fromGroups && avoidSameGroup }) : null
  const rematches = fromGroups && preview ? bracketSameGroupTies(preview, (id) => (id.startsWith("q:") ? Number(id.split(":")[1]) : null)) : 0
  // Who goes straight into round two, said by name.
  const byeNames = (preview?.matches ?? [])
    .filter((m) => m.isBye)
    .map((m) => (m.home.kind === "entrant" ? m.home.id : m.away.kind === "entrant" ? m.away.id : null))
    .filter((id): id is string => Boolean(id))
    .map(placeName)

  function generate() {
    setError(null)
    setNotice(null)
    const settings: KnockoutSettings = { seeding, seedNumber, legs, thirdPlace, qualifiersPerGroup: perGroup, qualifierPairing: pairing, avoidSameGroup, homeAllocation, finalVenueMode, finalVenueText: finalVenueMode === "neutral" ? finalVenue || null : null, firstDate: firstDate || null, everyDays, kickoff: kickoff || null }
    if (finalVenueMode === "neutral" && !finalVenue.trim()) return setError("Name the neutral ground for the final, or choose Decide Later.")
    const bracket = buildBracket(entrants, { seeding: drawSeeding, seedNumber, legs, thirdPlace, homeAllocation, avoidSameGroup: fromGroups && avoidSameGroup })
    const draft = knockoutDraftMatches(bracket, {
      legs,
      place: (id) => {
        if (id.startsWith("q:")) {
          const [, g, pos] = id.split(":")
          return { qualifier: { group_index: Number(g), position: Number(pos) } }
        }
        return { participantId: id }
      },
      groupName: (g) => groups[g]?.name ?? `Group ${groupLetter(g)}`,
      firstDate: firstDate || null,
      everyDays,
      kickoff: kickoff || null,
      finalVenueText: finalVenueMode === "neutral" ? finalVenue.trim() || null : null,
      finalVenueMode,
      neutralVenues: homeAllocation === "neutral",
      venueFor: venueChooser(ws),
      newId,
    })
    start(async () => {
      const stage = await saveStage(ws.editionId, { stageId: knockout?.id ?? null, kind: "knockout", name: "Knockout", sortOrder: 2, settings, groups: null })
      if (!stage.ok) return setError(stage.error)
      const r = await replaceDraftMatches(ws.editionId, stage.stageId, draft.matches, {}, draft.rounds)
      if (!r.ok) return setError(r.error)
      setNotice(`${r.added} knockout match${r.added === 1 ? "" : "es"} drafted${byes ? `, with ${byes} bye${byes === 1 ? "" : "s"}` : ""}.`)
      leaveNotice(`${ws.editionId}:knockout`, `${r.added} knockout match${r.added === 1 ? "" : "es"} drafted${byes ? `, with ${byes} bye${byes === 1 ? "" : "s"}` : ""}.`)
      router.refresh()
    })
  }

  // Filling the places once every group match is decided.
  const groupMatches = ws.matches.filter((m) => m.stageId === league?.id)
  const groupStageDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed" || m.status === "cancelled")
  const openPlaces = koMatches.filter((m) => (!m.homeParticipantId && m.homeSource?.qualifier) || (!m.awayParticipantId && m.awaySource?.qualifier))

  function fillPlaces() {
    const tables = groups.map((g) =>
      computeStandings(
        g.members.map((id) => ({ id, label: participantLabel(byId.get(id)) })),
        groupMatches.filter((m) => m.groupId === g.id).map((m) => ({ homeParticipantId: m.homeParticipantId, awayParticipantId: m.awayParticipantId, homeScore: m.homeScore, awayScore: m.awayScore, status: m.status })),
        (league?.settings.points as typeof DEFAULT_POINTS | undefined) ?? DEFAULT_POINTS,
      ),
    )
    const placeFor = (q: { group_index: number; position: number }) => tables[q.group_index]?.find((row) => row.position === q.position)?.participantId ?? null
    // Every place in one save: the qualifiers go into the bracket together, or not at all.
    const changes = openPlaces.map((m) => {
      const patch: { home_participant_id?: string | null; away_participant_id?: string | null; venue_id?: string | null; venue_text?: string | null } = {}
      if (!m.homeParticipantId && m.homeSource?.qualifier) {
        patch.home_participant_id = placeFor(m.homeSource.qualifier)
        // The home place's ground follows the team that fills it, unless a ground was already set.
        if (patch.home_participant_id && !m.venueId && !m.venueText) {
          const v = venueChooser(ws)(patch.home_participant_id)
          patch.venue_id = v.venueId
          patch.venue_text = v.venueText
        }
      }
      if (!m.awayParticipantId && m.awaySource?.qualifier) patch.away_participant_id = placeFor(m.awaySource.qualifier)
      return { id: m.id, patch }
    })
    start(async () => {
      const r = await updateMatches(ws.editionId, changes)
      if (!r.ok) return setError(r.error)
      setNotice("The knockout places have been filled from the group tables.")
      leaveNotice(`${ws.editionId}:knockout`, "The knockout places have been filled from the group tables.")
      router.refresh()
    })
  }

  const roundsCount = Math.max(0, ...koMatches.map((m) => m.roundNumber ?? 0))
  // In a saved draw, a bye is a round-two place filled at the draw rather than by a round-one winner.
  const savedByes =
    koMatches.some((m) => m.roundNumber === 1) && roundsCount >= 2
      ? koMatches
          .filter((m) => m.roundNumber === 2 && !m.homeSource?.loser_of)
          .flatMap((m) => [
            [m.homeParticipantId, m.homeSource],
            [m.awayParticipantId, m.awaySource],
          ] as const)
          .filter(([id, src]) => !src?.winner_of && (id || src?.qualifier))
          .map(([id, src]) => (id ? participantLabel(byId.get(id)) : (src?.label ?? "TBC")))
          // A two-legged tie names its teams twice; a bye is one team.
          .filter((name, i, all) => all.indexOf(name) === i)
      : []
  const swappable = (m: WorkspaceMatch) => m.status === "draft" && m.roundNumber === 1 && (saved.legs ?? 1) === 1

  function onPick(m: WorkspaceMatch, side: "home" | "away") {
    if (!swappable(m)) return
    if (!pick) return setPick({ matchId: m.id, side })
    if (pick.matchId === m.id && pick.side === side) return setPick(null)
    const a = koMatches.find((x) => x.id === pick.matchId)!
    const aId = pick.side === "home" ? a.homeParticipantId : a.awayParticipantId
    const bId = side === "home" ? m.homeParticipantId : m.awayParticipantId
    setPick(null)
    start(async () => {
      setError(null)
      const patches =
        a.id === m.id
          ? [{ id: a.id, patch: { home_participant_id: a.awayParticipantId, away_participant_id: a.homeParticipantId } }]
          : [
              { id: a.id, patch: { [pick.side === "home" ? "home_participant_id" : "away_participant_id"]: bId } },
              { id: m.id, patch: { [side === "home" ? "home_participant_id" : "away_participant_id"]: aId } },
            ]
      // Both ties change in one save, so a failure never leaves one team in two ties.
      const r = await updateMatches(ws.editionId, patches)
      if (!r.ok) return setError(r.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="ko-title" className="rounded-lg border border-ink/10 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <h2 id="ko-title" className="text-base font-semibold text-ink">
              Knockout Draw
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {entrantCount} {fromGroups ? "places" : "teams"} in a draw of {size}
              {byes ? `, ${byes} bye${byes === 1 ? "" : "s"}${drawSeeding === "seeded" ? ` to the top ${fromGroups ? "places" : "seeds"}` : ""}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {fromGroups ? (
              <>
                <NumberField id="per-group" label="Through Per Group" value={perGroup} min={1} onChange={setPerGroup} />
                <SelectField id="pairing" label="Draw" value={pairing} onChange={(v) => setPairing(v as typeof pairing)} options={[["winners_seeded", "Seeded by Group Place"], ["random", "Random Draw"], ["manual", "In Group Order"]]} />
                <label className="flex h-9 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={avoidSameGroup} onChange={(e) => setAvoidSameGroup(e.target.checked)} className="size-4 accent-forest-800" />
                  Avoid Same-Group Ties
                </label>
              </>
            ) : (
              <SelectField id="seeding" label="Draw" value={seeding} onChange={(v) => setSeeding(v as typeof seeding)} options={[["seeded", "Seeded"], ["random", "Random"], ["manual", "Slot Order"]]} />
            )}
            {(seeding === "random" || pairing === "random") && <NumberField id="draw-number" label="Draw Number" value={seedNumber} min={1} onChange={setSeedNumber} />}
            <SelectField
              id="home-allocation"
              label="Home Side"
              value={homeAllocation}
              onChange={(v) => setHomeAllocation(v as typeof homeAllocation)}
              options={[["seeded", "Higher Seed at Home"], ["random", "Random"], ["first_drawn", "First Drawn at Home"], ["neutral", "Neutral Grounds"], ["manual", "Set by Hand"]]}
            />
            <SelectField id="legs" label="Legs" value={String(legs)} onChange={(v) => setLegs(v === "2" ? 2 : 1)} options={[["1", "One Match"], ["2", "Home and Away"]]} />
            <label className="flex h-9 items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} className="size-4 accent-forest-800" />
              Third-Place Playoff
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-ink/8 px-5 py-3">
          <div>
            <label htmlFor="ko-first" className="block text-xs font-medium text-ink-muted">
              First Round Date
            </label>
            <input id="ko-first" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
          </div>
          <NumberField id="ko-every" label="Days Between Rounds" value={everyDays} min={1} onChange={setEveryDays} />
          <div>
            <label htmlFor="ko-kickoff" className="block text-xs font-medium text-ink-muted">
              Kick-Off
            </label>
            <input id="ko-kickoff" type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
          </div>
          <SelectField id="ko-final-mode" label="Final Venue" value={finalVenueMode} onChange={(v) => setFinalVenueMode(v as typeof finalVenueMode)} options={[["home", "Home Side's Ground"], ["neutral", "Neutral Ground"], ["later", "Decide Later"]]} />
          {finalVenueMode === "neutral" && (
            <div className="min-w-56 flex-1">
              <label htmlFor="ko-final-venue" className="block text-xs font-medium text-ink-muted">
                Neutral Ground
              </label>
              <input id="ko-final-venue" value={finalVenue} onChange={(e) => setFinalVenue(e.target.value)} placeholder="Edgeley Park" className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm" />
            </div>
          )}
          <Button type="button" className="h-9" disabled={pending || issued || entrantCount < 2} onClick={generate}>
            {pending ? "Working…" : koMatches.length ? "Redraw Knockout" : "Draw Knockout"}
          </Button>
        </div>
        <div className="space-y-1 border-t border-ink/8 px-5 py-2 text-sm [&:not(:has(>:not(:empty)))]:hidden">
          {rematches > 0 && <p className="text-amber-800">▲ {rematches} first-round tie{rematches === 1 ? " pairs" : "s pair"} two places from the same group.</p>}
          {byeNames.length > 0 && !koMatches.length && <p className="text-ink-muted">Byes to the next round: {byeNames.join(", ")}.</p>}
          {savedByes.length > 0 && <p className="text-ink-muted">Byes in this draw, straight into round two: {savedByes.join(", ")}.</p>}
          {homeAllocation === "manual" && koMatches.length > 0 && <p className="text-ink-muted">Home side set by hand: use Swap Home and Away on each tie below.</p>}
          {legs === 2 && <p className="text-ink-muted">With two legs, record the tie&rsquo;s winner on the second leg. The final is one match.</p>}
          {issued && <p className="text-ink-muted">Knockout matches have been issued, so the draw is fixed.</p>}
          {fromGroups && openPlaces.length > 0 && groupStageDone && (
            <p className="text-ink">
              The group stage is complete.{" "}
              <button type="button" disabled={pending} onClick={fillPlaces} className="font-medium text-forest-800 underline underline-offset-2">
                Fill Places from Group Tables
              </button>
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive-text">
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className="text-ink empty:hidden">{notice}</p>
        </div>
      </section>

      {koMatches.length > 0 && (
        <section aria-label="Bracket" className="relative overflow-x-auto rounded-lg border border-ink/10 bg-white">
          <div className="flex min-w-max gap-0 px-2 py-4">
            {Array.from({ length: roundsCount }, (_, i) => i + 1).map((round) => {
              const ties = groupTies(koMatches.filter((m) => m.roundNumber === round))
              return (
                <div key={round} className="flex w-64 flex-col px-3">
                  <h3 className="mb-2 text-xs font-semibold text-ink-muted">{knockoutRoundName(round, roundsCount)}</h3>
                  <ol className="flex flex-1 flex-col justify-around gap-3">
                    {ties.map((legsOfTie) => (
                      <li key={legsOfTie[0].id} className="relative rounded-md border border-ink/12 bg-white">
                        <p className="border-b border-ink/8 px-2.5 py-1 text-[11px] text-ink-muted">
                          {legsOfTie[0].bracketSlot === 2 && round === roundsCount && legsOfTie[0].homeSource?.loser_of ? "Third Place" : tieLabel(round, roundsCount, legsOfTie[0].bracketSlot ?? 1)}
                        </p>
                        {legsOfTie.map((m, li) => (
                          <TieLeg
                            key={m.id}
                            match={m}
                            leg={legsOfTie.length > 1 ? li + 1 : null}
                            home={m.homeParticipantId ? participantLabel(byId.get(m.homeParticipantId)) : (m.homeSource?.label ?? "TBC")}
                            away={m.awayParticipantId ? participantLabel(byId.get(m.awayParticipantId)) : (m.awaySource?.label ?? "TBC")}
                            onPick={swappable(m) && !pending ? (side) => onPick(m, side) : undefined}
                            picked={pick?.matchId === m.id ? pick.side : null}
                          />
                        ))}
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {koMatches.length > 0 && (
        <section aria-labelledby="ties-title" className="relative overflow-x-auto rounded-lg border border-ink/10 bg-white">
          <div className="border-b border-ink/8 px-4 py-2">
            <h3 id="ties-title" className="text-sm font-semibold text-ink">
              Ties
            </h3>
            <p className="text-xs text-ink-muted">
              {(saved.legs ?? 1) === 1 ? "Choose a team in the bracket, then another, to swap them. " : ""}Dates, kick-off, venue and home or away are edited here.
            </p>
          </div>
          <table aria-labelledby="ties-title" className="w-full min-w-[1320px] text-sm">
            <thead className="sr-only">
              <tr>
                <th>Check</th>
                <th>Group</th>
                <th>Round</th>
                <th>Date</th>
                <th>Kick-Off</th>
                <th>Home</th>
                <th>Swap</th>
                <th>Away</th>
                <th>Venue</th>
                <th>Pitch</th>
                <th>Status</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {[...koMatches]
                .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0) || (a.bracketSlot ?? 0) - (b.bracketSlot ?? 0))
                .map((m) => (
                  <MatchRow
                    key={m.id}
                    ws={ws}
                    match={m}
                    report={reports.get(m.id)}
                    pending={pending}
                    onPatch={(patch) =>
                      start(async () => {
                        const r = await updateMatch(ws.editionId, m.id, patch)
                        if (!r.ok) return setError(r.error)
                        router.refresh()
                      })
                    }
                    onDelete={() => undefined}
                    canDelete={false}
                    choices={swappable(m) && !fromGroups ? entered.map((p) => p.id) : undefined}
                    onReplace={(side, id) => {
                      setError(null)
                      const plan = planReplacement(m, side, id, koMatches, venueChooser(ws))
                      if (plan.kind === "refused") return setError(plan.reason)
                      if (plan.changes.length === 0) return
                      start(async () => {
                        const r = await updateMatches(ws.editionId, plan.changes)
                        if (!r.ok) return setError(r.error)
                        router.refresh()
                      })
                    }}
                  />
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function groupTies(matches: WorkspaceMatch[]): WorkspaceMatch[][] {
  const bySlot = new Map<string, WorkspaceMatch[]>()
  for (const m of matches) {
    const key = `${m.bracketSlot ?? m.id}|${m.homeSource?.loser_of ? "third" : ""}`
    bySlot.set(key, [...(bySlot.get(key) ?? []), m])
  }
  return [...bySlot.values()].map((legs) => legs.sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? ""))).sort((a, b) => (a[0].bracketSlot ?? 0) - (b[0].bracketSlot ?? 0))
}

function TieLeg({
  match: m,
  leg,
  home,
  away,
  onPick,
  picked,
}: {
  match: WorkspaceMatch
  leg: number | null
  home: string
  away: string
  onPick?: (side: "home" | "away") => void
  picked: "home" | "away" | null
}) {
  const played = m.homeScore !== null && m.awayScore !== null
  const side = (which: "home" | "away") => {
    const label = which === "home" ? home : away
    const known = which === "home" ? m.homeParticipantId : m.awayParticipantId
    const won = m.winnerParticipantId && m.winnerParticipantId === known
    const className = cn("truncate text-left", known ? "text-ink" : "text-ink-muted italic", won && "font-semibold")
    return (
      <div className="flex items-center justify-between gap-2">
        {onPick && known ? (
          <button
            type="button"
            aria-pressed={picked === which}
            title={`${label}. Choose, then choose another team to swap with.`}
            onClick={() => onPick(which)}
            className={cn(className, "-mx-1 min-h-7 rounded px-1 outline-none hover:bg-ink/[0.05] focus-visible:ring-2 focus-visible:ring-pitch-400", picked === which && "bg-forest-800 text-white hover:bg-forest-800")}
          >
            {label}
          </button>
        ) : (
          <span className={className} title={label}>
            {label}
          </span>
        )}
        {played && <span className="tabular-nums text-ink">{which === "home" ? m.homeScore : m.awayScore}</span>}
      </div>
    )
  }
  return (
    <div className="px-2.5 py-1.5 text-sm">
      {side("home")}
      {side("away")}
      <p className="mt-0.5 text-[11px] text-ink-muted tabular-nums">
        {leg ? `Leg ${leg}, ` : ""}
        {m.matchDate ? formatShort(m.matchDate) : "Date not set"}
        {`, ${MATCH_STATUS_WORD[m.status] ?? m.status}`}
      </p>
    </div>
  )
}

function formatShort(iso: string) {
  const [y, mo, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

function NumberField({ id, label, value, min, onChange }: { id: string; label: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input id={id} type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} className="mt-1 h-9 w-20 rounded-md border border-ink/15 bg-white px-2 text-sm tabular-nums" />
    </div>
  )
}

function SelectField({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  )
}
