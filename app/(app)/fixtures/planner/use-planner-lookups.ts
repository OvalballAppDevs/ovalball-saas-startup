"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { PlannableTeam } from "@/lib/fixtures/fixture-team-authority"
import { FIXTURE_TYPE_OPTIONS } from "@/lib/fixtures/fixture-type"
import type { MatchableTeam } from "@/lib/fixtures/opposition-match"
import type { PlannerDefaultsContext } from "@/lib/fixtures/planner-defaults"
import { buildLookupIndex, exactEntry, rememberRecent, searchLookup, type LookupEntry } from "@/lib/fixtures/planner-lookup"
import { normaliseHomeAway, type PlannerDraftRow, type PlannerField } from "@/lib/fixtures/planner-model"

import { listOppositionTeams, loadOppositionCatalogue, type OppositionClubOption, type OppositionTeamOption } from "./lookup-actions"

/**
 * EVERY LOOKUP THE GRID OFFERS, FROM ONE PLACE, WITHOUT ASKING TWICE.
 *
 * Our teams, venues, pitches and competitions arrive with the page. The
 * opposition catalogue is fetched once, in the background, as soon as the
 * planner is idle -- so by the time somebody reaches an Opposition cell it is
 * already here. An opponent's own teams are fetched once per opponent and
 * remembered. Nothing is fetched because a cell opened.
 *
 * Every option is server-supplied and server-scoped. This hook ranks and
 * filters them; it never adds one.
 */

export type LookupKind = "team" | "oppositionClub" | "oppositionTeam" | "competition" | "venue" | "pitch" | "fixtureType"

export interface PlannerVenue {
  id: string
  name: string
}

export interface PlannerPitch {
  id: string
  name: string
  venueId: string | null
}

export interface LookupAnswer {
  options: LookupEntry[]
  loading: boolean
  /** Said when there is nothing to offer, and why. */
  emptyHint?: string
}

// Forty is the cap the planner has always used: enough to scan, short enough to read.
const LIMIT = 40

/** Module-level so a remount of the planner in the same session reuses the catalogue. */
const catalogueCache = new Map<string, Promise<OppositionClubOption[]>>()
const oppositionTeamCache = new Map<string, Promise<OppositionTeamOption[]>>()

export function usePlannerLookups({
  clubId,
  teams,
  venues,
  pitches,
  competitions,
  ourGround = null,
}: {
  clubId: string
  teams: PlannableTeam[]
  venues: PlannerVenue[]
  pitches: PlannerPitch[]
  competitions: string[]
  /** Our primary ground, suggested on a Home row. */
  ourGround?: { venue: string; pitch: string | null } | null
}) {
  const [catalogue, setCatalogue] = useState<OppositionClubOption[] | null>(null)
  const [teamsVersion, setTeamsVersion] = useState(0)
  const oppositionTeams = useRef(new Map<string, OppositionTeamOption[]>())
  const recent = useRef<Partial<Record<LookupKind, string[]>>>({})

  // THE ONE CATALOGUE FETCH, started while the person is still reading the page.
  useEffect(() => {
    let alive = true
    const start = () => {
      let pending = catalogueCache.get(clubId)
      if (!pending) {
        pending = loadOppositionCatalogue(clubId).catch(() => [])
        catalogueCache.set(clubId, pending)
      }
      pending.then((c) => {
        if (!alive) return
        // An empty answer is not remembered: a transient failure should not
        // leave the session without opponents until a reload.
        if (c.length === 0) catalogueCache.delete(clubId)
        setCatalogue(c)
      })
    }
    const idle = typeof window !== "undefined" && "requestIdleCallback" in window
    const handle = idle ? window.requestIdleCallback(start, { timeout: 1200 }) : window.setTimeout(start, 200)
    return () => {
      alive = false
      if (idle) window.cancelIdleCallback(handle as number)
      else window.clearTimeout(handle as number)
    }
  }, [clubId])

  const teamIndex = useMemo(
    () =>
      buildLookupIndex(
        teams.map((t) => ({
          id: t.id,
          label: t.label,
          hint: t.groups[0],
          aliases: [t.compact, ...(t.alias ? [t.alias] : [])],
          context: t.groups,
        })),
      ),
    [teams],
  )
  const competitionIndex = useMemo(
    () => buildLookupIndex(competitions.map((c) => ({ id: c, label: c }))),
    [competitions],
  )
  const clubIndex = useMemo(
    () =>
      buildLookupIndex(
        (catalogue ?? []).map((c) => ({
          id: c.id,
          label: c.name,
          hint: c.tenantClubId ? "On Ovalball" : "Club Directory",
        })),
      ),
    [catalogue],
  )
  const clubById = useMemo(() => new Map((catalogue ?? []).map((c) => [c.id, c])), [catalogue])
  const fixtureTypeIndex = useMemo(
    () => buildLookupIndex(FIXTURE_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label, hint: o.competitionApplies ? "Choose the competition" : undefined }))),
    [],
  )
  const venueIndex = useMemo(() => buildLookupIndex(venues.map((v) => ({ id: v.id, label: v.name, hint: "Our ground" }))), [venues])

  /** Which catalogue club a row's Opposition Club text names, if it names one exactly. */
  const oppositionFor = useCallback(
    (row: PlannerDraftRow): OppositionClubOption | null => {
      const entry = exactEntry(clubIndex, row.oppositionClub)
      return entry ? (clubById.get(entry.id) ?? null) : null
    },
    [clubIndex, clubById],
  )

  /** Which of OUR venues a row's Venue text names, if any. */
  const venueFor = useCallback((row: PlannerDraftRow): PlannerVenue | null => {
    const entry = exactEntry(venueIndex, row.venue)
    return entry ? (venues.find((v) => v.id === entry.id) ?? null) : null
  }, [venueIndex, venues])

  const pitchesFor = useCallback(
    (row: PlannerDraftRow): { pitches: PlannerPitch[]; reason?: string } => {
      if (!row.venue.trim()) return { pitches }
      const venue = venueFor(row)
      if (!venue) return { pitches: [], reason: "Pitches are only listed for your own grounds." }
      return { pitches: pitches.filter((p) => !p.venueId || p.venueId === venue.id) }
    },
    [pitches, venueFor],
  )

  /**
   * THE VENUE/PITCH RULE. A pitch is compatible with a row's venue when the
   * venue is blank, or the pitch is at that venue. Anything else is a pitch
   * at a different ground and is cleared when the venue changes.
   */
  const pitchCompatible = useCallback(
    (row: PlannerDraftRow): boolean => {
      if (!row.pitch.trim()) return true
      const known = pitches.find((p) => p.name.toLowerCase() === row.pitch.trim().toLowerCase())
      if (!known) return true
      return pitchesFor(row).pitches.some((p) => p.id === known.id)
    },
    [pitches, pitchesFor],
  )

  const ensureOppositionTeams = useCallback(
    (tenantClubId: string): Promise<OppositionTeamOption[]> => {
      const known = oppositionTeams.current.get(tenantClubId)
      if (known) return Promise.resolve(known)
      let pending = oppositionTeamCache.get(`${clubId}|${tenantClubId}`)
      if (!pending) {
        pending = listOppositionTeams(tenantClubId, clubId).catch(() => [])
        oppositionTeamCache.set(`${clubId}|${tenantClubId}`, pending)
      }
      return pending.then((list) => {
        if (!oppositionTeams.current.has(tenantClubId)) {
          oppositionTeams.current.set(tenantClubId, list)
          setTeamsVersion((v) => v + 1)
        }
        return list
      })
    },
    [clubId],
  )

  /**
   * What a row's suggestions are based on: our team's identity, the
   * opposition club (and its teams, once loaded) and our primary ground.
   * lib/fixtures/planner-defaults.ts decides what to fill.
   */
  const defaultsContext = useCallback(
    (row: PlannerDraftRow): PlannerDefaultsContext => {
      const teamEntry = exactEntry(teamIndex, row.ourTeam)
      const t = teamEntry ? teams.find((x) => x.id === teamEntry.id) : undefined
      const ourTeam: MatchableTeam | null = t
        ? { id: t.id, label: t.label, rugbyCode: t.rugbyCode, category: t.category, ageGroup: t.ageGroup, gender: t.gender, squadDesignation: t.squadDesignation }
        : null
      const club = oppositionFor(row)
      return {
        ourTeam,
        ourGround,
        opposition: club
          ? {
              onOvalball: Boolean(club.tenantClubId),
              homeGround: club.homeGround,
              homePitch: club.homePitch,
              teams: club.tenantClubId ? (oppositionTeams.current.get(club.tenantClubId) ?? null) : null,
            }
          : null,
      }
    },
    [teamIndex, teams, oppositionFor, ourGround],
  )

  const answer = useCallback(
    (kind: LookupKind, row: PlannerDraftRow, query: string): LookupAnswer => {
      // Read so that an opponent's teams arriving gives this function a new
      // identity, and the open cell re-renders with them.
      void teamsVersion
      const recentFor = recent.current[kind] ?? []
      switch (kind) {
        case "team":
          return {
            options: searchLookup(teamIndex, query, { limit: LIMIT, recent: recentFor }),
            loading: false,
            emptyHint: teams.length === 0 ? "There are no teams here you can plan fixtures for." : undefined,
          }
        case "competition":
          return {
            options: searchLookup(competitionIndex, query, { limit: LIMIT, recent: recentFor }),
            loading: false,
            emptyHint: competitions.length === 0 ? "There are no active competitions to choose from." : undefined,
          }
        case "oppositionClub": {
          if (!catalogue) return { options: [], loading: true }
          // An empty query over fourteen hundred clubs is a wall, not help:
          // show what was used this session, and ask for letters otherwise.
          if (!query.trim()) {
            const recentOptions = recentFor
              .map((label) => exactEntry(clubIndex, label))
              .filter((e): e is LookupEntry => Boolean(e))
            return { options: recentOptions, loading: false, emptyHint: "Start typing — opponents come from Ovalball clubs and the Club Directory." }
          }
          return {
            options: searchLookup(clubIndex, query, { limit: LIMIT, recent: recentFor }),
            loading: false,
          }
        }
        case "oppositionTeam": {
          const club = oppositionFor(row)
          if (!club?.tenantClubId) {
            return {
              options: [],
              loading: !catalogue && Boolean(row.oppositionClub),
              emptyHint: "Pick an Ovalball opposition club first, or leave this blank for an external opponent.",
            }
          }
          const list = oppositionTeams.current.get(club.tenantClubId)
          if (!list) {
            void ensureOppositionTeams(club.tenantClubId)
            return { options: [], loading: true }
          }
          return {
            options: searchLookup(buildLookupIndex(list.map((t) => ({ id: t.id, label: t.label }))), query, { limit: LIMIT, recent: recentFor }),
            loading: false,
            emptyHint: `${club.name} has no active teams on Ovalball.`,
          }
        }
        case "venue": {
          const ours = searchLookup(venueIndex, query, { limit: LIMIT, recent: recentFor })
          // VENUES, RANKED BY WHERE THE MATCH IS ACTUALLY BEING PLAYED. An
          // away row offers the opponent's recorded ground first; a home row
          // offers ours first. A suggestion, never a restriction.
          const club = oppositionFor(row)
          const theirs: LookupEntry[] =
            club?.homeGround && (!query.trim() || club.homeGround.toLowerCase().includes(query.trim().toLowerCase()))
              ? [{ id: `directory:${club.id}`, label: club.homeGround, hint: `${club.name} — their ground` }]
              : []
          const away = normaliseHomeAway(row.homeAway) === "Away"
          // An Ovalball opponent is asked, and a ground typed here goes to them
          // with the request -- it is a proposal, not something held for review.
          const emptyHint = away && club?.tenantClubId ? `No match. ${club.name} are asked to play at the ground typed here.` : undefined
          return { options: away ? [...theirs, ...ours] : [...ours, ...theirs], loading: false, emptyHint }
        }
        case "fixtureType":
          return { options: searchLookup(fixtureTypeIndex, query, { limit: LIMIT }), loading: false }
        case "pitch": {
          // Away at an Ovalball club's ground: their only pitch there is offered,
          // and a pitch typed here is proposed to them with the ground.
          const club = oppositionFor(row)
          if (normaliseHomeAway(row.homeAway) === "Away" && club?.tenantClubId && club.homeGround && row.venue.trim().toLowerCase() === club.homeGround.toLowerCase()) {
            const theirs: LookupEntry[] = club.homePitch && (!query.trim() || club.homePitch.toLowerCase().includes(query.trim().toLowerCase())) ? [{ id: `their-pitch:${club.id}`, label: club.homePitch, hint: `${club.name} — their pitch` }] : []
            return { options: theirs, loading: false, emptyHint: `No match. ${club.name} are asked to play on the pitch typed here.` }
          }
          const { pitches: available, reason } = pitchesFor(row)
          const index = buildLookupIndex(available.map((p) => ({ id: p.id, label: p.name })))
          return {
            options: searchLookup(index, query, { limit: LIMIT, recent: recentFor }),
            loading: false,
            emptyHint: reason ?? "This venue has no pitches recorded.",
          }
        }
      }
    },
    [teamIndex, competitionIndex, clubIndex, venueIndex, fixtureTypeIndex, catalogue, teams.length, competitions.length, oppositionFor, pitchesFor, ensureOppositionTeams, teamsVersion],
  )

  const remember = useCallback((kind: LookupKind, label: string) => {
    recent.current[kind] = rememberRecent(recent.current[kind] ?? [], label)
  }, [])

  return { answer, remember, pitchCompatible, defaultsContext, ensureOppositionTeams, oppositionFor, catalogueReady: catalogue !== null }
}

/** Which lookup a column uses, if it is structured at all. */
export const LOOKUP_BY_FIELD: Partial<Record<PlannerField, LookupKind>> = {
  ourTeam: "team",
  oppositionClub: "oppositionClub",
  oppositionTeam: "oppositionTeam",
  competition: "competition",
  venue: "venue",
  pitch: "pitch",
  fixtureType: "fixtureType",
}
