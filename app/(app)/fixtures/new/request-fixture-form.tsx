"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"

import { describeArrangeFixtureHost } from "@ovalball/contracts"

import { FIXTURE_TYPE_OPTIONS, fixtureTypeLabel, type StoredGameType } from "@/lib/fixtures/fixture-type"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createFixtureRequest } from "./actions"
import { AvailabilityPanel } from "./availability-panel"
import {
  loadCompatibleOpponentIdentities,
  loadCompatibleOpponentTeams,
  searchOpponentClubs,
  type CompatibleIdentity,
  type CompatibleTeam,
  type OpponentSearchResult,
} from "./search-opponents"

interface Team {
  id: string
  displayName: string
}

interface TeamSelection {
  selected: boolean
  venuePreference: "home" | "away" | "either"
  kickoffTime: string
  note: string
}

interface InitialOpponent {
  directoryId: string
  clubId: string
  name: string
}

interface SuggestedTargetTeam {
  id: string
  displayName: string
}


interface TargetIdentity {
  ageGroup: string
  /**
   * Boys or Girls only, which is the request flow's own existing constraint rather than a compatibility
   * one: `TeamRequestInput.targetTeamGender` has always been "never Mixed/Men's/Women's", because the
   * recipient may turn this identity into a real team and Ovalball will not name a mixed or senior side
   * on their behalf. The compatibility reader answers the wider question honestly; this narrows it.
   */
  gender: "boys" | "girls"
  squad: string
}

export function RequestFixtureForm({
  clubId,
  clubName,
  teams,
  initialOpponent = null,
  initialDate = null,
  suggestedTargetTeam = null,
  initialTeamId = null,
  initialVenuePreference = null,
}: {
  clubId: string
  /** Section 8: named once so the summary and confirmation can say who hosts, not only who asked. */
  clubName: string
  teams: Team[]
  initialOpponent?: InitialOpponent | null
  initialDate?: string | null
  suggestedTargetTeam?: SuggestedTargetTeam | null
  /** Clubhouse Find a Fixture's own handoff (Section 6): the team the search was already run for, so
   * the person never has to re-tick the same team they just picked a moment ago. Ignored if the id
   * does not match one of THIS viewer's own teams -- never trusted blindly from a query string. */
  initialTeamId?: string | null
  initialVenuePreference?: "home" | "away" | "either" | null
}) {
  const [step, setStep] = useState<"details" | "review" | "sent">("details")
  const [gameType, setGameType] = useState<StoredGameType | "">("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<OpponentSearchResult[]>([])
  const [searching, startSearch] = useTransition()
  const [opponent, setOpponent] = useState<OpponentSearchResult | null>(
    initialOpponent
      ? { directoryId: initialOpponent.directoryId, clubId: initialOpponent.clubId, name: initialOpponent.name, town: null }
      : null
  )
  const [editingOpponent, setEditingOpponent] = useState(!initialOpponent)
  const [targetTeam, setTargetTeam] = useState(suggestedTargetTeam)
  const [namingIdentity, setNamingIdentity] = useState(false)
  const [targetIdentity, setTargetIdentity] = useState<TargetIdentity>({ ageGroup: "U12", gender: "boys", squad: "" })
  const [date, setDate] = useState(initialDate ?? "")
  const [selections, setSelections] = useState<Record<string, TeamSelection>>(
    Object.fromEntries(
      teams.map((t) => [
        t.id,
        { selected: t.id === initialTeamId, venuePreference: t.id === initialTeamId ? (initialVenuePreference ?? "either") : "either", kickoffTime: "", note: "" },
      ])
    )
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // WHAT THIS TEAM COULD LEGALLY PLAY, answered by the database for the one team that has been chosen.
  // Held as null until asked so that "we have not looked yet" is distinguishable from "there is nothing
  // compatible" -- the second is a real and useful answer and must not be shown as the first.
  const [compatibleTeams, setCompatibleTeams] = useState<CompatibleTeam[] | null>(null)
  const [compatibleIdentities, setCompatibleIdentities] = useState<CompatibleIdentity[] | null>(null)

  function updateSelection(teamId: string, patch: Partial<TeamSelection>) {
    setSelections((prev) => ({ ...prev, [teamId]: { ...prev[teamId], ...patch } }))
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    setOpponent(null)
    startSearch(async () => {
      const r = await searchOpponentClubs(value)
      setResults(r)
    })
  }

  const selectedTeams = teams.filter((t) => selections[t.id]?.selected)
  const canReview = Boolean(opponent) && Boolean(date) && selectedTeams.length > 0

  // A compatibility question needs ONE asking team, and the batch flow allows several. With more than
  // one selected the request carries no target team at all (see targetTeamId below), so there is
  // nothing to be compatible with and nothing to ask.
  const soleTeamId = selectedTeams.length === 1 ? selectedTeams[0].id : null
  const opponentClubId = opponent?.clubId ?? null
  /** What has been loaded, but only while there is still one team and one opponent club it was loaded for. */
  const opponentTeams = soleTeamId && opponentClubId ? compatibleTeams : null
  const nameableIdentities = soleTeamId ? compatibleIdentities : null

  useEffect(() => {
    // No synchronous setState here, in either branch. With no single team there is nothing to be
    // compatible with, and that is DERIVED below rather than stored -- writing "null" back into state on
    // the way through would be a second render for a fact the render already knows.
    if (!soleTeamId) return
    let live = true
    void (async () => {
      const [teamsForOpponent, identities] = await Promise.all([
        opponentClubId ? loadCompatibleOpponentTeams(soleTeamId, opponentClubId) : Promise.resolve([]),
        loadCompatibleOpponentIdentities(soleTeamId),
      ])
      if (!live) return
      setCompatibleTeams(teamsForOpponent)
      const nameable = identities.filter((i) => i.gender === "boys" || i.gender === "girls")
      setCompatibleIdentities(nameable)
      // The default must be a legal one. "U12" was hardcoded, so a U14 side opened the identity picker
      // already showing an age grade it could not play.
      setTargetIdentity((prev) =>
        nameable.some((i) => i.ageGroup === prev.ageGroup && i.gender === prev.gender)
          ? prev
          : {
              ...prev,
              ageGroup: nameable[0]?.ageGroup ?? "",
              gender: (nameable[0]?.gender as "boys" | "girls") ?? "boys",
            }
      )
    })()
    return () => {
      live = false
    }
  }, [soleTeamId, opponentClubId])

  // A named identity only ever applies when there's a single unambiguous
  // requesting team AND no real opposing team was found to pick instead --
  // same reasoning as targetTeamId below.
  const canNameIdentity =
    !targetTeam &&
    selectedTeams.length === 1 &&
    Boolean(opponent?.clubId) &&
    (nameableIdentities === null || nameableIdentities.length > 0)
  const namedIdentity = canNameIdentity && namingIdentity ? targetIdentity : null

  async function handleSubmit() {
    if (!opponent) return
    setSubmitting(true)
    setError(null)
    const result = await createFixtureRequest({
      requestingClubId: clubId,
      opponentDirectoryId: opponent.directoryId,
      opponentClubId: opponent.clubId,
      rawOpponentText: opponent.name,
      proposedDate: date,
      notes: null,
      gameType: gameType || null,
      // Section 8: this composer always shows its own "Request Sent" confirmation (below) rather than
      // the action's default redirect to /fixtures -- other callers (Calendar's Create Fixture dialog)
      // already pass this themselves and are unaffected.
      skipRedirect: true,
      teams: selectedTeams.map((t) => ({
        teamId: t.id,
        venuePreference: selections[t.id].venuePreference,
        preferredKickoffTime: selections[t.id].kickoffTime || null,
        note: selections[t.id].note || null,
        // Only attach the suggested opposing team when exactly one of our
        // own teams is in this batch -- with several selected there's no
        // single correct target for all of them, so each is left for the
        // responding side to resolve on accept, same as the normal flow.
        targetTeamId: targetTeam && selectedTeams.length === 1 ? targetTeam.id : null,
        targetTeamAgeGroup: namedIdentity?.ageGroup ?? null,
        targetTeamGender: namedIdentity?.gender ?? null,
        targetTeamSquadDesignation: namedIdentity?.squad.trim() || null,
      })),
    })
    setSubmitting(false)
    if (result && !result.ok) {
      setError(result.error)
      return
    }
    setStep("sent")
  }

  if (step === "review") {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Review request</p>
        <h2 className="mt-2 font-display text-display-l text-ink">
          vs {opponent?.name}
          {targetTeam && selectedTeams.length === 1 ? ` ${targetTeam.displayName}` : ""}
          {namedIdentity
            ? ` ${namedIdentity.gender === "girls" ? "Girls " : ""}${namedIdentity.ageGroup}${namedIdentity.squad.trim() ? ` ${namedIdentity.squad.trim()}` : ""}`
            : ""}
        </h2>
        {namedIdentity && (
          <p className="mt-1 text-xs text-ink-muted">
            They don&apos;t appear to have this team yet -- {opponent?.name} can create it when reviewing your request.
          </p>
        )}
        <p className="mt-1 text-sm text-ink-muted">
          {date ? new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
        </p>
        {selectedTeams.length === 1 && opponent?.clubId && (
          <p className="mt-1 text-sm text-ink-muted">
            {describeArrangeFixtureHost(selections[selectedTeams[0].id].venuePreference, clubName, opponent.name).statement ??
              "Home or away is not yet agreed."}
          </p>
        )}
        {gameType && <p className="mt-1 text-sm text-ink-muted">{fixtureTypeLabel(gameType)}</p>}

        <ul className="mt-5 flex flex-col gap-2">
          {selectedTeams.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-ink/10 px-4 py-3">
              <span className="text-sm font-medium text-ink">{t.displayName}</span>
              <span className="text-sm text-ink/60">
                {selections[t.id].venuePreference === "home" ? "Home" : selections[t.id].venuePreference === "away" ? "Away" : "Either"}
                {selections[t.id].kickoffTime ? ` · ${selections[t.id].kickoffTime}` : ""}
              </span>
            </li>
          ))}
        </ul>

        {!opponent?.clubId && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">{opponent?.name} is not currently active on Ovalball</p>
            <p className="mt-1 text-sm text-amber-800">
              This fixture will be added to your calendar, but no Ovalball request will be delivered &mdash; there
              is no one on Ovalball to receive it.
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-destructive-text">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <Button type="button" variant="ghost" className="h-10" onClick={() => setStep("details")} disabled={submitting}>
            Back
          </Button>
          <Button type="button" className="h-10" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : opponent?.clubId ? "Send request" : "Add to calendar"}
          </Button>
        </div>
      </div>
    )
  }

  if (step === "sent") {
    const sentToOvalball = Boolean(opponent?.clubId)
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium tracking-[0.04em] text-forest-800 uppercase">
          {sentToOvalball ? "Request sent" : "Added to your calendar"}
        </p>
        <h2 className="mt-2 font-display text-display-l text-ink">
          {sentToOvalball ? `${opponent?.name} has been asked to play` : `Recorded vs ${opponent?.name}`}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {selectedTeams.map((t) => t.displayName).join(", ")}
          {date ? ` · ${new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}` : ""}
        </p>
        {sentToOvalball && (
          <p className="mt-3 text-sm text-ink-muted">
            {opponent?.name} will confirm, decline or propose a change. Nothing is in either club&apos;s calendar
            until they accept.
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button className="h-10" render={<Link href="/fixtures" />}>
            View Requests
          </Button>
          <Button variant="ghost" className="h-10" render={<Link href="/clubhouse" />}>
            Back to Clubhouse
          </Button>
          <Button variant="ghost" className="h-10" render={<Link href="/calendar" />}>
            View Calendar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <div>
        <Label htmlFor="opponent-search" className="text-ink/80">
          Partner Club
        </Label>
        {opponent && !editingOpponent ? (
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-ink/15 bg-mint-100/40 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink">{opponent.name}</p>
              {targetTeam && (
                <p className="text-xs text-ink-muted">Checking availability for their {targetTeam.displayName}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingOpponent(true)
                setOpponent(null)
                setQuery("")
                setTargetTeam(null)
              }}
              className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Change
            </button>
          </div>
        ) : (
          <Input
            id="opponent-search"
            value={opponent ? opponent.name : query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search by club name"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        )}
        {editingOpponent && !opponent && query.trim().length >= 2 && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-1">
            {searching && <p className="px-3 py-2 text-sm text-ink-muted">Searching…</p>}
            {!searching && results.length === 0 && <p className="px-3 py-2 text-sm text-ink-muted">No clubs found.</p>}
            {results.map((r) => (
              <button
                key={r.directoryId}
                type="button"
                onClick={() => {
                  setOpponent(r)
                  setQuery(r.name)
                  setResults([])
                  setEditingOpponent(false)
                }}
                className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-ink/5"
              >
                {r.name}
                {r.town ? <span className="text-ink-muted"> · {r.town}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Label htmlFor="fixture-date" className="text-ink/80">
          Date
        </Label>
        <Input
          id="fixture-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1.5 h-11 w-48 border-ink/15 bg-white"
        />
      </div>

      {/* CA-M11.4: the same shared scheduling read model the native app's composer already uses --
          only once a single requesting team is unambiguous, since availability is asked FROM a team. */}
      {soleTeamId && <AvailabilityPanel ourTeamId={soleTeamId} partnerTeamId={targetTeam?.id ?? null} selectedDate={date} onSelectDate={setDate} />}

      <div className="mt-4">
        <Label htmlFor="fixture-type" className="text-ink/80">
          Fixture Type
        </Label>
        <select
          id="fixture-type"
          value={gameType}
          onChange={(e) => setGameType(e.target.value as StoredGameType | "")}
          className="mt-1.5 h-11 w-48 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="">Not set</option>
          {FIXTURE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-ink/80">Select your team(s)</p>
        <div className="mt-2 flex flex-col gap-2">
          {teams.map((t) => {
            const sel = selections[t.id]
            return (
              <div key={t.id} className="rounded-lg border border-ink/10 px-4 py-3">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={sel.selected}
                    onChange={(e) => updateSelection(t.id, { selected: e.target.checked })}
                    className="size-4 accent-pitch-600"
                  />
                  <span className="text-sm font-medium text-ink">{t.displayName}</span>
                </label>
                {sel.selected && (
                  <div className="mt-3 flex flex-wrap items-center gap-4 pl-6">
                    <div className="flex items-center gap-3">
                      {(["home", "away", "either"] as const).map((v) => (
                        <label key={v} className="flex items-center gap-1.5 text-sm text-ink/70">
                          <input
                            type="radio"
                            name={`venue-${t.id}`}
                            checked={sel.venuePreference === v}
                            onChange={() => updateSelection(t.id, { venuePreference: v })}
                            className="accent-pitch-600"
                          />
                          {v === "home" ? "Home" : v === "away" ? "Away" : "Either"}
                        </label>
                      ))}
                    </div>
                    <Input
                      type="time"
                      value={sel.kickoffTime}
                      onChange={(e) => updateSelection(t.id, { kickoffTime: e.target.value })}
                      className="h-9 w-32 border-ink/15 bg-white text-sm"
                      placeholder="Kick-off"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/*
        WHICH OF THEIR TEAMS. This step did not exist: the flow asked which CLUB, and the opposing team
        was left for somebody at the other club to work out from the age grade of the side requesting.
        A request now names the actual team it is for whenever that team exists -- and the list is the
        set of their teams this side may legally play, resolved on the server by the same rule that
        would refuse the request.
      */}
      {soleTeamId && opponent?.clubId && !suggestedTargetTeam && (
        <div className="mt-5">
          <p className="text-sm font-medium text-ink">Which of their teams?</p>
          {opponentTeams === null ? (
            <p className="mt-1 text-xs text-ink-muted">Checking which of their teams {selectedTeams[0].displayName} can play…</p>
          ) : opponentTeams.length === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              {opponent.name} does not run a team {selectedTeams[0].displayName} can play. You can still name the
              team you are asking for below, and they can create it when they answer.
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-ink-muted">
                Only teams {selectedTeams[0].displayName} may be matched against are shown.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {opponentTeams.map((t) => (
                  <button
                    key={t.teamId}
                    type="button"
                    onClick={() =>
                      setTargetTeam((prev) =>
                        prev?.id === t.teamId ? null : { id: t.teamId, displayName: t.displayName }
                      )
                    }
                    aria-pressed={targetTeam?.id === t.teamId}
                    className={`min-h-11 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      targetTeam?.id === t.teamId
                        ? "bg-forest-800 text-white"
                        : "border border-ink/15 bg-white text-ink hover:bg-ink/[0.04]"
                    }`}
                  >
                    {t.displayName}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {canNameIdentity && (
        <div className="mt-5">
          {!namingIdentity ? (
            <button
              type="button"
              onClick={() => setNamingIdentity(true)}
              className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Don&apos;t know if they have this team yet? Name it
            </button>
          ) : (
            <div className="rounded-lg border border-ink/10 bg-ink/5 px-3.5 py-3">
              <p className="text-sm font-medium text-ink">Which of their teams?</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                If {opponent?.name} doesn&apos;t have this team yet, they can create it when reviewing your request.
                It won&apos;t be accepted until they do.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  value={targetIdentity.ageGroup}
                  onChange={(e) => setTargetIdentity((prev) => ({ ...prev, ageGroup: e.target.value }))}
                  aria-label="Their team's age group"
                  className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                >
                  {[...new Set((nameableIdentities ?? []).map((i) => i.ageGroup))].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <select
                  value={targetIdentity.gender}
                  onChange={(e) => setTargetIdentity((prev) => ({ ...prev, gender: e.target.value as "boys" | "girls" }))}
                  aria-label="Their team's classification"
                  className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                >
                  {(nameableIdentities ?? [])
                    .filter((i) => i.ageGroup === targetIdentity.ageGroup)
                    .map((i) => (
                      <option key={i.gender} value={i.gender}>
                        {i.gender === "girls" ? "Girls" : "Boys"}
                      </option>
                    ))}
                </select>
                <input
                  value={targetIdentity.squad}
                  onChange={(e) => setTargetIdentity((prev) => ({ ...prev, squad: e.target.value }))}
                  placeholder="Squad (optional, e.g. A)"
                  aria-label="Their team's squad designation"
                  className="h-9 w-40 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                />
                <button
                  type="button"
                  onClick={() => setNamingIdentity(false)}
                  className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <Button type="button" className="h-10" disabled={!canReview} onClick={() => setStep("review")}>
          Review request
        </Button>
      </div>
    </div>
  )
}
