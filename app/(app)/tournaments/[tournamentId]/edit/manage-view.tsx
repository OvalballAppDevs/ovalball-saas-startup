"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Circle, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { TournamentBuilderOptions } from "@/lib/app-context/tournament-builder-data"
import type { TournamentCentreContext, TournamentEntry } from "@/lib/tournaments/view-model"
import { cn } from "@/lib/utils"

import { TournamentDetailsForm } from "../../tournament-details-form"
import {
  addTournamentTeamEntryAction,
  deleteTournamentGameAction,
  recordTournamentOpponentAction,
  releaseTournamentPitchAction,
  removeTournamentOpponentAction,
  removeTournamentTeamEntryAction,
  reserveTournamentPitchAction,
  saveTournamentGameAction,
  searchTournamentOpponents,
} from "../../actions"

const FIELD =
  "h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-base text-ink outline-none focus-visible:border-pitch-600"

/**
 * MANAGING A TOURNAMENT, ONE DECISION AT A TIME.
 *
 * PROGRESSIVE DISCLOSURE, NOT A WIZARD AND NOT ONE HUGE FORM. Each part of the
 * occasion is its own section, opened one at a time, and each says whether it
 * is done. An organiser building the day works down the list; an organiser
 * changing one kick-off opens one section and leaves. The same components
 * serve both, so there is no separate "create" and "edit" implementation to
 * drift apart.
 *
 * AUTHORITY IS PER SECTION, AND IT COMES FROM THE SERVER.
 * `canManageTournament` opens the sections that reach every team -- the
 * occasion's own details and the pitches it holds. `canManageEntry`, decided
 * per team, opens that team's opponents and that team's schedule. A U12
 * manager therefore sees U12's schedule editor and U13's read-only, which is
 * exactly the rule the database enforces underneath.
 */

type SectionKey = "details" | "teams" | "opponents" | "schedule" | "pitches"

export function TournamentManageView({
  tournament,
  options,
  initialStep,
}: {
  tournament: TournamentCentreContext
  options: TournamentBuilderOptions
  initialStep: SectionKey
}) {
  const [open, setOpen] = useState<SectionKey>(initialStep)

  const anyEntryManageable = tournament.entries.some((e) => e.canManageEntry)
  const sections: { key: SectionKey; title: string; done: boolean; hint: string; visible: boolean }[] = [
    {
      key: "details",
      title: "Tournament Details",
      done: Boolean(tournament.name && tournament.venue),
      hint: tournament.venue ? (tournament.venue.name ?? "") : "No venue set",
      visible: tournament.canManageTournament,
    },
    {
      key: "teams",
      title: "Our Teams",
      done: tournament.entries.length > 0,
      hint: tournament.entries.length === 0 ? "None entered" : tournament.entries.map((e) => e.teamName).join(", "),
      visible: true,
    },
    {
      key: "opponents",
      title: "Opponents",
      done: tournament.entries.length > 0 && tournament.entries.every((e) => e.opponents.length > 0),
      hint:
        tournament.entries.length === 0
          ? "Enter a team first"
          : `${tournament.entries.reduce((n, e) => n + e.opponents.length, 0)} recorded`,
      visible: anyEntryManageable,
    },
    {
      key: "schedule",
      title: "Schedule",
      done: tournament.entries.length > 0 && tournament.entries.some((e) => e.games.length > 0),
      hint: `${tournament.entries.reduce((n, e) => n + e.games.length, 0)} games`,
      visible: anyEntryManageable,
    },
    {
      key: "pitches",
      title: "Pitches",
      done: tournament.pitches.length > 0,
      hint: tournament.pitches.length === 0 ? "None reserved" : `${tournament.pitches.length} reserved`,
      visible: tournament.canManageTournament,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {sections
        .filter((s) => s.visible)
        .map((s) => (
          <section key={s.key} className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
            <h2>
              <button
                type="button"
                aria-expanded={open === s.key}
                onClick={() => setOpen(open === s.key ? ("" as SectionKey) : s.key)}
                className="flex w-full items-center gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset sm:px-5"
              >
                {/* DONE IS NEVER COLOUR ALONE: a tick or an empty circle, both
                    with an accessible name on the row itself. */}
                {s.done ? (
                  <Check className="size-4 shrink-0 text-pitch-600" aria-hidden="true" />
                ) : (
                  <Circle className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{s.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {s.done ? "" : "Still to do — "}
                    {s.hint}
                  </span>
                </span>
              </button>
            </h2>
            {open === s.key && (
              <div className="border-t border-ink/10 p-4 sm:p-5">
                {s.key === "details" && <TournamentDetailsForm options={options} tournament={tournament} />}
                {s.key === "teams" && <TeamsSection tournament={tournament} options={options} />}
                {s.key === "opponents" &&
                  tournament.entries.map((e) => <OpponentsSection key={e.id} tournament={tournament} entry={e} options={options} />)}
                {s.key === "schedule" &&
                  tournament.entries.map((e) => <ScheduleSection key={e.id} tournament={tournament} entry={e} options={options} />)}
                {s.key === "pitches" && <PitchesSection tournament={tournament} options={options} />}
              </div>
            )}
          </section>
        ))}
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text">{error}</p>
}

/* ------------------------------------------------------------------ teams */

function TeamsSection({ tournament, options }: { tournament: TournamentCentreContext; options: TournamentBuilderOptions }) {
  const router = useRouter()
  const [teamId, setTeamId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const entered = new Set(tournament.entries.map((e) => e.teamId))
  const available = options.teams.filter((t) => !entered.has(t.id))

  return (
    <div>
      {tournament.entries.length === 0 ? (
        <p className="text-sm text-ink-muted">No teams entered yet. Add the first one below.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.07]">
          {tournament.entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm font-medium text-ink">{e.teamName}</span>
              {e.canManageEntry && (
                <button
                  type="button"
                  aria-label={`Withdraw ${e.teamName}`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await removeTournamentTeamEntryAction(tournament.id, e.id)
                      if (!r.ok) setError(r.error)
                      else router.refresh()
                    })
                  }
                  className="inline-flex size-11 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-ink/[0.03] hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="t-add-team" className="sr-only">
              Team to enter
            </Label>
            <select id="t-add-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={FIELD}>
              <option value="">Choose a team…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            className="h-11 sm:h-11"
            disabled={!teamId || pending}
            onClick={() =>
              start(async () => {
                setError(null)
                const r = await addTournamentTeamEntryAction(tournament.id, teamId)
                if (!r.ok) setError(r.error)
                else {
                  setTeamId("")
                  router.refresh()
                }
              })
            }
          >
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            Enter Team
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  )
}

/* -------------------------------------------------------------- opponents */

function OpponentsSection({
  tournament,
  entry,
  options,
}: {
  tournament: TournamentCentreContext
  entry: TournamentEntry
  options: TournamentBuilderOptions
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<{ id: string; name: string; town: string | null }[]>([])
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null)
  const [typeId, setTypeId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!entry.canManageEntry) {
    return (
      <div className="border-b border-ink/[0.07] pb-4 last:border-0">
        <p className="text-sm font-medium text-ink">{entry.teamName}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {entry.opponents.length === 0 ? "No opponents recorded." : entry.opponents.map((o) => o.clubName).join(", ")}
        </p>
        <p className="mt-1.5 text-xs text-ink-subtle">You do not manage this team, so its opponents are read-only here.</p>
      </div>
    )
  }

  return (
    <div className="border-b border-ink/[0.07] pb-5 last:border-0 last:pb-0 [&:not(:first-child)]:pt-5">
      <p className="text-sm font-medium text-ink">{entry.teamName}</p>

      {entry.opponents.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {entry.opponents.map((o) => (
            <li key={o.id} className="inline-flex items-center gap-1.5 rounded-lg bg-ink/5 pl-2.5 text-sm text-ink">
              {o.clubName} <span className="text-ink-muted">{o.teamTypeLabel}</span>
              {/* A full 44px target, not a 32px one squeezed to fit the chip:
                  this is removed by thumb on a phone as often as by mouse. */}
              <button
                type="button"
                aria-label={`Remove ${o.clubName}`}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removeTournamentOpponentAction(tournament.id, o.id)
                    if (!r.ok) setError(r.error)
                    else router.refresh()
                  })
                }
                className="inline-flex size-11 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-ink/10 hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor={`opp-search-${entry.id}`} className="text-xs">
          Add an Opponent
        </Label>
        {/* THE CANONICAL CLUB DIRECTORY, scoped to this tournament's code in
            the query. Never free text: an opponent is a real club identity. */}
        <input
          id={`opp-search-${entry.id}`}
          value={chosen ? chosen.name : query}
          onChange={async (e) => {
            setChosen(null)
            setQuery(e.target.value)
            setResults(await searchTournamentOpponents(tournament.rugbyCode, e.target.value))
          }}
          placeholder="Search the Club Directory…"
          className={FIELD}
        />
        {!chosen && results.length > 0 && (
          <ul className="max-h-52 overflow-y-auto rounded-lg border border-ink/10">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen({ id: r.id, name: r.name })
                    setResults([])
                  }}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03]"
                >
                  <span className="text-ink">{r.name}</span>
                  {r.town && <span className="text-xs text-ink-muted">{r.town}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={FIELD} aria-label="Opponent team">
              <option value="">Which of their teams…</option>
              {options.teamTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              className="h-11"
              disabled={!typeId || pending}
              onClick={() =>
                start(async () => {
                  setError(null)
                  const r = await recordTournamentOpponentAction(tournament.id, entry.id, chosen.id, typeId)
                  if (!r.ok) setError(r.error)
                  else {
                    setChosen(null)
                    setQuery("")
                    setTypeId("")
                    router.refresh()
                  }
                })
              }
            >
              Add Opponent
            </Button>
          </div>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  )
}

/* --------------------------------------------------------------- schedule */

function ScheduleSection({
  tournament,
  entry,
  options,
}: {
  tournament: TournamentCentreContext
  entry: TournamentEntry
  options: TournamentBuilderOptions
}) {
  const router = useRouter()
  const [opponentId, setOpponentId] = useState("")
  const [time, setTime] = useState("")
  const [duration, setDuration] = useState("30")
  const [pitchId, setPitchId] = useState("")
  const [gameDate, setGameDate] = useState(tournament.startsOn)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!entry.canManageEntry) {
    return (
      <div className="border-b border-ink/[0.07] pb-4 last:border-0">
        <p className="text-sm font-medium text-ink">{entry.teamName}</p>
        <p className="mt-1 text-xs text-ink-muted">{entry.games.length} games scheduled.</p>
        <p className="mt-1.5 text-xs text-ink-subtle">You do not manage this team, so its schedule is read-only here.</p>
      </div>
    )
  }

  return (
    <div className="border-b border-ink/[0.07] pb-5 last:border-0 last:pb-0 [&:not(:first-child)]:pt-5">
      <p className="text-sm font-medium text-ink">{entry.teamName}</p>

      {entry.games.length > 0 && (
        <ul className="mt-2 divide-y divide-ink/[0.07]">
          {entry.games.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink">
                <span className="tabular-nums">{g.startTime?.slice(0, 5) ?? "TBC"}</span> v {g.opponentClubName}
                {g.pitchName && <span className="text-ink-muted"> · {g.pitchName}</span>}
              </span>
              <button
                type="button"
                aria-label={`Remove the game against ${g.opponentClubName}`}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteTournamentGameAction(tournament.id, g.id)
                    if (!r.ok) setError(r.error)
                    else router.refresh()
                  })
                }
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-ink/[0.03] hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {entry.opponents.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Record who {entry.teamName} is playing before adding games.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select value={opponentId} onChange={(e) => setOpponentId(e.target.value)} className={cn(FIELD, "col-span-2")} aria-label="Opponent">
            <option value="">Opponent…</option>
            {entry.opponents.map((o) => (
              <option key={o.id} value={o.id}>
                {o.clubName}
              </option>
            ))}
          </select>
          {tournament.isMultiDay && (
            <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} className={FIELD} aria-label="Day" />
          )}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} aria-label="Kick-off" />
          <select value={pitchId} onChange={(e) => setPitchId(e.target.value)} className={FIELD} aria-label="Pitch">
            <option value="">Pitch…</option>
            {options.pitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} className={FIELD} aria-label="Length">
            {[10, 15, 20, 25, 30, 40, 50, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <Button
            type="button"
            className="col-span-2 h-11 sm:col-span-1"
            disabled={!opponentId || pending}
            onClick={() =>
              start(async () => {
                setError(null)
                const r = await saveTournamentGameAction(tournament.id, {
                  gameId: null,
                  entryId: entry.id,
                  opponentId,
                  gameDate: tournament.isMultiDay ? gameDate : tournament.startsOn,
                  startTime: time || null,
                  durationMinutes: Number(duration),
                  pitchId: pitchId || null,
                })
                if (!r.ok) setError(r.error)
                else {
                  setOpponentId("")
                  setTime("")
                  setPitchId("")
                  router.refresh()
                }
              })
            }
          >
            Add Game
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  )
}

/* ---------------------------------------------------------------- pitches */

function PitchesSection({ tournament, options }: { tournament: TournamentCentreContext; options: TournamentBuilderOptions }) {
  const router = useRouter()
  const [pitchId, setPitchId] = useState("")
  const [from, setFrom] = useState("09:30")
  const [to, setTo] = useState("14:00")
  const [day, setDay] = useState(tournament.startsOn)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div>
      <p className="text-sm text-ink-muted">
        The real period each pitch is unavailable. Several pitches over overlapping periods is normal for a tournament and is never
        treated as a clash with itself.
      </p>

      {tournament.pitches.length > 0 && (
        <ul className="mt-3 divide-y divide-ink/[0.07]">
          {tournament.pitches.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink">
                {p.pitchName} <span className="tabular-nums text-ink-muted">{p.startTime.slice(0, 5)}–{p.endTime.slice(0, 5)}</span>
              </span>
              <button
                type="button"
                aria-label={`Release ${p.pitchName}`}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await releaseTournamentPitchAction(tournament.id, p.id)
                    if (!r.ok) setError(r.error)
                    else router.refresh()
                  })
                }
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-ink/[0.03] hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {options.pitches.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">This club has no pitches configured, so there is nothing to reserve.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select value={pitchId} onChange={(e) => setPitchId(e.target.value)} className={cn(FIELD, "col-span-2 sm:col-span-1")} aria-label="Pitch">
            <option value="">Pitch…</option>
            {options.pitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          {tournament.isMultiDay && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={FIELD} aria-label="Day" />}
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD} aria-label="From" />
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} aria-label="Until" />
          <Button
            type="button"
            className="col-span-2 h-11 sm:col-span-1"
            disabled={!pitchId || pending}
            onClick={() =>
              start(async () => {
                setError(null)
                const r = await reserveTournamentPitchAction(tournament.id, {
                  pitchId,
                  reservedOn: tournament.isMultiDay ? day : tournament.startsOn,
                  startTime: from,
                  endTime: to,
                })
                if (!r.ok) setError(r.error)
                else {
                  setPitchId("")
                  router.refresh()
                }
              })
            }
          >
            Reserve
          </Button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  )
}
