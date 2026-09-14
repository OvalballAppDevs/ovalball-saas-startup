/**
 * LEAGUE SCHEDULING, AS ARITHMETIC.
 *
 * A league of n teams where each plays m matches is a graph question before it
 * is a calendar one: every team needs exactly m opponents, nobody plays
 * themselves, and no pairing repeats unless the organiser asked for home and
 * away. This module answers it deterministically -- the same entrants always
 * produce the same draft -- so a generated league can be tested, explained and
 * regenerated one group at a time without surprising anybody.
 *
 * It knows nothing about clubs, dates or the database. Entrants are opaque ids;
 * the Competition Creator decides what they mean.
 */

export interface Pairing {
  home: string
  away: string
}

export interface LeagueRound {
  /** 1-based. */
  round: number
  matches: Pairing[]
  /** Entrants without a match this round (odd groups, partial schedules). */
  resting: string[]
}

export type MatchesMode = { kind: "single" } | { kind: "double" } | { kind: "custom"; perTeam: number }

export interface Feasibility {
  ok: boolean
  /** Matches each entrant will actually play when ok, or the nearest achievable count. */
  perTeam: number
  /** Plain-language reason when the exact request cannot be met. */
  reason?: string
}

/**
 * Whether "each of n teams plays m matches" is possible.
 *
 * Two facts decide it. Each match involves two teams, so n x m must be even.
 * And without repeating a pairing a team can meet at most n - 1 others, or
 * 2(n - 1) if every pairing is played home and away.
 */
export function leagueFeasibility(n: number, mode: MatchesMode): Feasibility {
  if (n < 2) return { ok: false, perTeam: 0, reason: "A league needs at least two teams." }
  if (mode.kind === "single") return { ok: true, perTeam: n - 1 }
  if (mode.kind === "double") return { ok: true, perTeam: 2 * (n - 1) }
  const m = Math.floor(mode.perTeam)
  if (m < 1) return { ok: false, perTeam: 0, reason: "Each team needs to play at least one match." }
  if (m > 2 * (n - 1)) {
    return {
      ok: false,
      perTeam: 2 * (n - 1),
      reason: `With ${n} teams, each team can play at most ${2 * (n - 1)} matches without meeting the same opponent more than twice.`,
    }
  }
  if ((n * m) % 2 !== 0) {
    return {
      ok: false,
      perTeam: m - 1,
      reason: `${n} teams cannot each play exactly ${m} matches -- every match needs two teams, so ${n} x ${m} would leave one team without an opponent. Choose ${m - 1} or ${m + 1}.`,
    }
  }
  return { ok: true, perTeam: m }
}

/**
 * The circle method: fix one entrant, rotate the rest. Round r pairs position i
 * with position n-1-i. With an odd field a phantom "bye" slot is added, and
 * whoever meets it rests. Venues are then balanced explicitly (balanceVenues).
 */
function circleRounds(ids: string[]): LeagueRound[] {
  const BYE = "\u0000bye"
  const slots = ids.length % 2 === 0 ? [...ids] : [...ids, BYE]
  const n = slots.length
  const rounds: LeagueRound[] = []
  let rotating = slots.slice(1)
  for (let r = 0; r < n - 1; r++) {
    const order = [slots[0], ...rotating]
    const matches: Pairing[] = []
    const resting: string[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = order[i]
      const b = order[n - 1 - i]
      if (a === BYE || b === BYE) {
        resting.push(a === BYE ? b : a)
        continue
      }
      matches.push({ home: a, away: b })
    }
    rounds.push({ round: r + 1, matches, resting })
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)]
  }
  return balanceVenues(rounds)
}

/**
 * Venues, balanced explicitly. Round by round, each match is oriented so the
 * side with fewer home matches so far is at home; level sides keep the order
 * the rotation gave. This holds every entrant within one home match of an even
 * split, which the rotation's own alternation does not guarantee for small
 * groups.
 */
function balanceVenues(rounds: LeagueRound[]): LeagueRound[] {
  const home = new Map<string, number>()
  const away = new Map<string, number>()
  return rounds.map((r) => ({
    ...r,
    matches: r.matches.map((p) => {
      const hb = (home.get(p.home) ?? 0) - (away.get(p.home) ?? 0)
      const ab = (home.get(p.away) ?? 0) - (away.get(p.away) ?? 0)
      const oriented = hb > ab ? { home: p.away, away: p.home } : p
      home.set(oriented.home, (home.get(oriented.home) ?? 0) + 1)
      away.set(oriented.away, (away.get(oriented.away) ?? 0) + 1)
      return oriented
    }),
  }))
}

/**
 * A partial schedule where every entrant plays exactly m distinct opponents
 * (m < n - 1). Built as a circulant graph -- entrant i meets i±1 … i±k, plus
 * the directly opposite entrant when m is odd and n even -- which is m-regular
 * by construction, then coloured into rounds greedily. Every entrant gets the
 * same number of home matches when m is even and is within one when it is odd.
 */
function partialRounds(ids: string[], m: number): LeagueRound[] {
  const n = ids.length
  const edges: Pairing[] = []
  for (let d = 1; d <= Math.floor(m / 2); d++) {
    for (let i = 0; i < n; i++) {
      const j = (i + d) % n
      // With n = 2d the same pair would be added twice.
      if (2 * d === n && i >= j) continue
      // Home at the lower offset: across one offset every entrant is home once
      // (to i + d) and away once (to i - d), so venues balance exactly.
      edges.push({ home: ids[i], away: ids[j] })
    }
  }
  if (m % 2 === 1) {
    for (let i = 0; i < n / 2; i++) {
      const j = i + n / 2
      edges.push(i % 2 === 0 ? { home: ids[i], away: ids[j] } : { home: ids[j], away: ids[i] })
    }
  }
  return colourIntoRounds(ids, edges)
}

/** Greedy edge colouring: each round takes as many unplayed, non-overlapping matches as it can. */
function colourIntoRounds(ids: string[], edges: Pairing[]): LeagueRound[] {
  const remaining = [...edges]
  const rounds: LeagueRound[] = []
  while (remaining.length > 0) {
    const busy = new Set<string>()
    const matches: Pairing[] = []
    for (let i = 0; i < remaining.length; ) {
      const e = remaining[i]
      if (!busy.has(e.home) && !busy.has(e.away)) {
        busy.add(e.home)
        busy.add(e.away)
        matches.push(e)
        remaining.splice(i, 1)
      } else {
        i++
      }
    }
    rounds.push({ round: rounds.length + 1, matches, resting: ids.filter((id) => !busy.has(id)) })
  }
  return rounds
}

export interface LeagueDraft {
  feasibility: Feasibility
  rounds: LeagueRound[]
}

/**
 * The draft league for one group.
 *
 * - single: every pairing once (n - 1 matches each).
 * - double: every pairing home and away (2(n - 1) matches each); the second
 *   half mirrors the first with venues swapped.
 * - custom m: exactly m matches each when feasible. Beyond n - 1, the extra
 *   matches are return fixtures of the earliest pairings, venue reversed --
 *   a deliberate, visible repeat, never an accidental one.
 *
 * An infeasible custom request produces NO rounds: the organiser is told why
 * and chooses, rather than being handed a schedule quietly different from the
 * one they asked for.
 */
export function generateLeague(ids: string[], mode: MatchesMode): LeagueDraft {
  const feasibility = leagueFeasibility(ids.length, mode)
  if (!feasibility.ok) return { feasibility, rounds: [] }
  const n = ids.length
  const single = circleRounds(ids)
  const renumber = (rs: LeagueRound[], from: number) => rs.map((r, i) => ({ ...r, round: from + i }))
  const mirrored = () => single.map((r) => ({ ...r, matches: r.matches.map((p) => ({ home: p.away, away: p.home })) }))

  if (mode.kind === "single") return { feasibility, rounds: single }
  if (mode.kind === "double") return { feasibility, rounds: renumber([...single, ...mirrored()], 1) }

  const m = feasibility.perTeam
  if (m === n - 1) return { feasibility, rounds: single }
  if (m < n - 1) return { feasibility, rounds: partialRounds(ids, m) }
  if (m === 2 * (n - 1)) return { feasibility, rounds: renumber([...single, ...mirrored()], 1) }

  // n - 1 < m < 2(n - 1): the full single round robin, then m - (n - 1) extra
  // matches each, drawn as a regular sub-schedule with venues reversed.
  // Each extra match is the RETURN of a pairing already played: the home side
  // is whichever side was away the first time, never "the second name".
  const firstHome = new Map<string, string>()
  for (const r of single) for (const p of r.matches) firstHome.set([p.home, p.away].sort().join("|"), p.home)
  const extra = partialRounds(ids, m - (n - 1)).map((r) => ({
    ...r,
    matches: r.matches.map((p) => (firstHome.get([p.home, p.away].sort().join("|")) === p.home ? { home: p.away, away: p.home } : p)),
  }))
  return { feasibility, rounds: renumber([...single, ...extra], 1) }
}

export interface LeagueBalance {
  played: Map<string, number>
  home: Map<string, number>
  duplicatePairings: number
  selfFixtures: number
}

/** The facts a draft must satisfy, computed rather than assumed -- the tests and the UI both read this. */
export function leagueBalance(ids: string[], rounds: LeagueRound[]): LeagueBalance {
  const played = new Map(ids.map((id) => [id, 0]))
  const home = new Map(ids.map((id) => [id, 0]))
  const seen = new Map<string, number>()
  let selfFixtures = 0
  for (const r of rounds) {
    for (const p of r.matches) {
      if (p.home === p.away) selfFixtures++
      played.set(p.home, (played.get(p.home) ?? 0) + 1)
      played.set(p.away, (played.get(p.away) ?? 0) + 1)
      home.set(p.home, (home.get(p.home) ?? 0) + 1)
      const key = [p.home, p.away].sort().join("|")
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  let duplicatePairings = 0
  for (const c of seen.values()) if (c > 1) duplicatePairings += c - 1
  return { played, home, duplicatePairings, selfFixtures }
}
