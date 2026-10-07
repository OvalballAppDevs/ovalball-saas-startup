import { useCallback, useEffect, useRef, useState } from "react"
import { useFocusEffect } from "expo-router"
import { readClubDay, readClubDayDetail, readClubDays, readPlayingDays, readSeasonBoard, type BoardRow, type ClubDayDetail, type ClubDayListItem, type IsoWeekday, type PlannerClubDay, type PlayingDays } from "@ovalball/contracts"
import { readClubAuthority } from "@ovalball/contracts/club/overview"
import { readClubTeams, sortTeamsInRugbyAgeOrder, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../auth/supabase"
import { friendly, logDetail } from "../errors/translate"
import { loadSeasonsForClub, type CanonicalSeason } from "../training-planning/data"

/**
 * WHAT THE PLANNER READS. Every answer is canonical: the club-scope planner capability, the season register, the
 * club's own team list, and the planner RPCs over fixtures, requests and competition matches. Each screen re-reads on
 * focus, so a request accepted, declined or cancelled anywhere else shows here when the planner is next looked at.
 */

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** `fixture.planner.use` at club scope -- Club Admin, Fixture Secretary. Never inferred from a role name. */
export function usePlannerAccess(clubId: string | null): { loading: boolean; allowed: boolean } {
  const [state, setState] = useState({ loading: true, allowed: false })
  useEffect(() => {
    if (!clubId) {
      setState({ loading: false, allowed: false })
      return
    }
    let live = true
    void readClubAuthority(supabase, clubId)
      .then((a) => live && setState({ loading: false, allowed: a.plannerUse }))
      .catch(() => live && setState({ loading: false, allowed: false }))
    return () => {
      live = false
    }
  }, [clubId])
  return state
}

/** The season being planned by default: the current one, or -- between seasons -- the next; never a hardcoded year. */
export function defaultPlanningSeason(seasons: readonly CanonicalSeason[], today: string): CanonicalSeason | null {
  const current = seasons.find((s) => (s.preSeasonStartsOn ?? s.startsOn) <= today && s.endsOn >= today)
  if (current) return current
  const upcoming = seasons.filter((s) => s.startsOn > today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  return upcoming[0] ?? null
}

export function usePlannerSeasons(clubId: string | null) {
  const [seasons, setSeasons] = useState<CanonicalSeason[] | null>(null)
  useEffect(() => {
    if (!clubId) return
    let live = true
    void loadSeasonsForClub(supabase, clubId).then((result) => live && setSeasons(result.seasons))
    return () => {
      live = false
    }
  }, [clubId])
  return seasons
}

/** The club's schedulable teams, in rugby age order. */
export function useClubPlannerTeams(clubId: string | null) {
  const key = clubId ?? ""
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; teams: ClubTeam[] | null; rugbyCode: string | null; problem: string | null }>({ key, teams: null, rugbyCode: null, problem: null })
  const load = useCallback(async () => {
    if (!clubId) return
    const asked = key
    try {
      const directory = await readClubTeams(supabase, clubId)
      if (current.current !== asked) return
      setState({ key: asked, teams: sortTeamsInRugbyAgeOrder(directory.teams), rugbyCode: directory.rugbyCode, problem: null })
    } catch (caught) {
      if (current.current !== asked) return
      const failure = friendly(caught, "your teams")
      logDetail("planner teams", failure)
      setState((s) => ({ key: asked, teams: s.key === asked ? s.teams : null, rugbyCode: s.key === asked ? s.rugbyCode : null, problem: failure.message }))
    }
  }, [clubId, key, current])
  useEffect(() => {
    void load()
  }, [load])
  const mine = state.key === key
  return { teams: mine ? state.teams : null, rugbyCode: mine ? state.rugbyCode : null, problem: mine ? state.problem : null }
}

/** The live board for one season. */
export function useSeasonBoard(clubId: string | null, seasonId: string | null) {
  const key = `${clubId}|${seasonId}`
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; rows: BoardRow[] | null; problem: string | null }>({ key, rows: null, problem: null })
  const load = useCallback(async () => {
    if (!clubId || !seasonId) return
    const asked = key
    const result = await readSeasonBoard(supabase, clubId, seasonId)
    if (current.current !== asked) return
    if (result.ok) setState({ key: asked, rows: result.rows, problem: null })
    else setState((s) => ({ key: asked, rows: s.key === asked ? s.rows : null, problem: plannerProblem(result.message) }))
  }, [clubId, seasonId, key, current])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const mine = state.key === key
  return { rows: mine ? state.rows : null, problem: mine ? state.problem : null, reload: load }
}

/** One opponent on one date, re-read whenever either changes and on every return to the screen. */
export function useClubDay(clubId: string | null, opponentClubId: string | null, date: string | null) {
  const key = `${clubId}|${opponentClubId}|${date}`
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; day: PlannerClubDay | null; problem: string | null }>({ key, day: null, problem: null })
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    const asked = key
    if (!clubId || !opponentClubId || !date) {
      setState({ key: asked, day: null, problem: null })
      return
    }
    setLoading(true)
    const result = await readClubDay(supabase, clubId, opponentClubId, date)
    if (current.current !== asked) return
    setLoading(false)
    if (result.ok) setState({ key: asked, day: result.day, problem: null })
    else setState({ key: asked, day: null, problem: plannerProblem(result.message, result.code) })
  }, [clubId, opponentClubId, date, key, current])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const mine = state.key === key
  return { day: mine ? state.day : null, problem: mine ? state.problem : null, loading, reload: load }
}

/** A planner failure in words a club secretary can act on. */
export function plannerProblem(message: string, code?: string | null): string {
  if (code === "42501" || /not authorised/i.test(message)) return "You no longer have permission to plan this club's fixtures."
  if (/network|fetch|timed? ?out/i.test(message)) return "Ovalball could not be reached. Check your connection and try again."
  return message
}

/** The club's canonical playing days (club default, kinds of team, team overrides) and the season's team structure. */
export function usePlayingDays(clubId: string | null, seasonId: string | null) {
  const key = `${clubId}|${seasonId}`
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; days: PlayingDays | null; problem: string | null }>({ key, days: null, problem: null })
  const load = useCallback(async () => {
    if (!clubId) return
    const asked = key
    const result = await readPlayingDays(supabase, clubId, seasonId)
    if (current.current !== asked) return
    if (result.ok) setState({ key: asked, days: result.days, problem: null })
    else setState((s) => ({ key: asked, days: s.key === asked ? s.days : null, problem: plannerProblem(result.message, result.code) }))
  }, [clubId, seasonId, key, current])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const mine = state.key === key
  return { days: mine ? state.days : null, problem: mine ? state.problem : null, reload: load }
}

/**
 * THE DAY A CLUB DAY IS PLANNED AROUND: the club default, else the day most of its teams play, else Sunday -- the
 * last only so the weeks have a day to show; the screen says when nothing has been set.
 */
export function planningWeekday(days: PlayingDays | null): { day: IsoWeekday; configured: boolean } {
  if (days?.clubDefault) return { day: days.clubDefault, configured: true }
  const counts = new Map<IsoWeekday, number>()
  for (const t of days?.teams ?? []) if (t.effective) counts.set(t.effective, (counts.get(t.effective) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? { day: top[0], configured: true } : { day: 7, configured: false }
}

/** The club's club days in one season, sent and received. */
export function useClubDays(clubId: string | null, seasonId: string | null) {
  const key = `${clubId}|${seasonId}`
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; days: ClubDayListItem[] | null; problem: string | null }>({ key, days: null, problem: null })
  const load = useCallback(async () => {
    if (!clubId || !seasonId) return
    const asked = key
    const result = await readClubDays(supabase, clubId, seasonId)
    if (current.current !== asked) return
    if (result.ok) setState({ key: asked, days: result.days, problem: null })
    else setState((s) => ({ key: asked, days: s.key === asked ? s.days : null, problem: plannerProblem(result.message) }))
  }, [clubId, seasonId, key, current])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const mine = state.key === key
  return { days: mine ? state.days : null, problem: mine ? state.problem : null, reload: load }
}

/** One club day, re-read on every return to the screen (an answer given elsewhere shows here). */
export function useClubDayDetail(groupId: string | null) {
  const key = groupId ?? ""
  const current = useCurrentKey(key)
  const [state, setState] = useState<{ key: string; detail: ClubDayDetail | null; problem: string | null; missing: boolean }>({ key, detail: null, problem: null, missing: false })
  const load = useCallback(async () => {
    if (!groupId) return
    const asked = key
    const result = await readClubDayDetail(supabase, groupId)
    if (current.current !== asked) return
    if (result.ok) setState({ key: asked, detail: result.detail, problem: null, missing: false })
    else if (result.code === "P0002") setState({ key: asked, detail: null, problem: null, missing: true })
    else setState((s) => ({ key: asked, detail: s.key === asked ? s.detail : null, problem: plannerProblem(result.message, result.code), missing: false }))
  }, [groupId, key, current])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const mine = state.key === key
  return { detail: mine ? state.detail : null, problem: mine ? state.problem : null, missing: mine ? state.missing : false, reload: load }
}

/**
 * THE KEY THE SCREEN IS SHOWING NOW. A read records the key it was asked for and drops its answer when the screen has
 * since moved on (another club, season, opponent or club day) -- a slow answer never lands under the wrong subject.
 */
function useCurrentKey(key: string) {
  const ref = useRef(key)
  ref.current = key
  return ref
}
