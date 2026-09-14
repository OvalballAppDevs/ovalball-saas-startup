/**
 * KNOCKOUT BRACKETS.
 *
 * A bracket is built for the next power of two above the entrants, and the
 * spare places are BYES -- given to the top seeds -- so nobody is quietly left
 * out of a draw of 12 or 20. Later rounds are placeholders that name the match
 * whose winner fills them ({ winner_of }), which is exactly how the database
 * advances a bracket when a result is recorded.
 *
 * Pure and deterministic: the same entrants, seeding and seed number always
 * give the same bracket.
 */

import { seededRandom, shuffle } from "./groups"

export type Seeding = "random" | "seeded" | "manual"

/**
 * Who is at home in a first-round tie:
 * - first_drawn: the side drawn first (the top of the pairing) hosts;
 * - seeded: the better-seeded side hosts;
 * - random: decided by the numbered draw;
 * - neutral: nobody -- the ground is set per tie, and venues are left blank;
 * - manual: drawn as first_drawn, then swapped by hand in the Ties table.
 * Later rounds are placeholders ("Winner of ...") and keep first-drawn order.
 */
export type HomeAllocation = "first_drawn" | "seeded" | "random" | "neutral" | "manual"

export interface KnockoutEntrant {
  id: string
  /** 1 is the top seed. Read when seeding or home allocation is "seeded". */
  seed?: number | null
  /** A qualifier's group, so a first-round tie between two teams of one group can be avoided. */
  group?: number | null
}

export type SlotSource =
  | { kind: "entrant"; id: string }
  | { kind: "bye" }
  | { kind: "winner_of"; matchKey: string }
  | { kind: "loser_of"; matchKey: string }
  | { kind: "qualifier"; groupIndex: number; position: number }

export interface BracketMatch {
  /** Stable within the bracket, e.g. "R1-M3". The Creator maps these to match ids. */
  key: string
  round: number
  /** 1-based position within the round. */
  slot: number
  leg: 1 | 2
  home: SlotSource
  away: SlotSource
  /** True for a round-one pairing where one side is a bye: the other side goes straight through. */
  isBye: boolean
  isThirdPlace: boolean
}

export interface Bracket {
  size: number
  byes: number
  rounds: number
  matches: BracketMatch[]
}

export function bracketSize(entrants: number): number {
  let size = 1
  while (size < Math.max(2, entrants)) size *= 2
  return size
}

/**
 * Standard seed placement: seed 1 meets the lowest seed, and seeds 1 and 2 can
 * only meet in the final. For a draw of 8: 1v8, 4v5, 2v7, 3v6.
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2]
  while (order.length < size) {
    const next = order.length * 2 + 1
    order = order.flatMap((s) => [s, next - s])
  }
  return order
}

function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round
  if (fromEnd === 0) return "Final"
  if (fromEnd === 1) return "Semi-Finals"
  if (fromEnd === 2) return "Quarter-Finals"
  return `Round of ${2 ** (fromEnd + 1)}`
}

export { roundName as knockoutRoundName }

/**
 * Build a bracket.
 *
 * - random: entrants are shuffled with the seed number, then placed by seed order
 *   (so byes still land evenly across the draw).
 * - seeded: by the entrants' seed numbers, unseeded entrants after them.
 * - manual: the order given is the draw order, top to bottom.
 *
 * With two legs every tie is a pair of matches with venues reversed; the final
 * stays one match. A third-place playoff, when asked for, is fed by the
 * semi-final losers.
 */
export function buildBracket(
  entrants: KnockoutEntrant[],
  options: { seeding: Seeding; seedNumber?: number; legs?: 1 | 2; thirdPlace?: boolean; homeAllocation?: HomeAllocation; avoidSameGroup?: boolean },
): Bracket {
  const n = entrants.length
  const size = bracketSize(n)
  const rounds = Math.log2(size)
  const legs = options.legs ?? 1

  let ordered: KnockoutEntrant[]
  if (options.seeding === "random") {
    ordered = shuffle(entrants, options.seedNumber ?? 1)
  } else if (options.seeding === "seeded") {
    ordered = [...entrants].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER))
  } else {
    ordered = [...entrants]
  }

  // Positions in the draw: for manual, top to bottom as given; otherwise by
  // seed order so byes go to the top of each quarter.
  const positions: SlotSource[] = new Array(size)
  if (options.seeding === "manual") {
    // In the order given, and never two byes in one tie: the first pairings are
    // full, and each bye then sits beside one entrant.
    const byes = size - n
    const full = size / 2 - byes
    let next = 0
    for (let pair = 0; pair < size / 2; pair++) {
      positions[pair * 2] = { kind: "entrant", id: ordered[next++].id }
      positions[pair * 2 + 1] = pair < full ? { kind: "entrant", id: ordered[next++].id } : { kind: "bye" }
    }
  } else {
    const order = seedOrder(size)
    for (let i = 0; i < size; i++) {
      const rank = order[i]
      positions[i] = rank <= n ? { kind: "entrant", id: ordered[rank - 1].id } : { kind: "bye" }
    }
  }

  const byId = new Map(entrants.map((e) => [e.id, e]))
  const idAt = (i: number) => (positions[i].kind === "entrant" ? (positions[i] as { id: string }).id : null)

  // A first-round tie between two qualifiers of one group is swapped with a
  // neighbouring tie's second team where that leaves both ties mixed.
  if (options.avoidSameGroup) {
    const groupAt = (i: number) => {
      const id = idAt(i)
      return id ? (byId.get(id)?.group ?? null) : null
    }
    for (let pair = 0; pair < size / 2; pair++) {
      const a = pair * 2
      if (groupAt(a) === null || groupAt(a) !== groupAt(a + 1)) continue
      for (let offset = 1; offset < size / 2; offset++) {
        const other = ((pair + offset) % (size / 2)) * 2
        const g1 = groupAt(a)
        const g2 = groupAt(other)
        const g2b = groupAt(other + 1)
        if (g2b === null) continue
        if (g2b !== g1 && groupAt(a + 1) !== g2) {
          ;[positions[a + 1], positions[other + 1]] = [positions[other + 1], positions[a + 1]]
          break
        }
      }
    }
  }

  // Home allocation for the first round.
  const allocation = options.homeAllocation ?? "first_drawn"
  if (allocation === "seeded" || allocation === "random") {
    const flip = seededRandom((options.seedNumber ?? 1) * 7919 + 17)
    for (let pair = 0; pair < size / 2; pair++) {
      const a = idAt(pair * 2)
      const b = idAt(pair * 2 + 1)
      if (!a || !b) continue
      const swap =
        allocation === "seeded"
          ? (byId.get(b)?.seed ?? Number.MAX_SAFE_INTEGER) < (byId.get(a)?.seed ?? Number.MAX_SAFE_INTEGER)
          : flip() < 0.5
      if (swap) [positions[pair * 2], positions[pair * 2 + 1]] = [positions[pair * 2 + 1], positions[pair * 2]]
    }
  }

  const matches: BracketMatch[] = []
  const tieKeys: string[][] = []
  let previous: string[] = []
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r
    const keys: string[] = []
    for (let s = 1; s <= count; s++) {
      const key = `R${r}-M${s}`
      keys.push(key)
      const home: SlotSource = r === 1 ? positions[(s - 1) * 2] : { kind: "winner_of", matchKey: previous[(s - 1) * 2] }
      const away: SlotSource = r === 1 ? positions[(s - 1) * 2 + 1] : { kind: "winner_of", matchKey: previous[(s - 1) * 2 + 1] }
      const isBye = r === 1 && (home.kind === "bye" || away.kind === "bye")
      const isFinal = r === rounds
      matches.push({ key, round: r, slot: s, leg: 1, home, away, isBye, isThirdPlace: false })
      if (legs === 2 && !isFinal && !isBye) {
        matches.push({ key: `${key}-L2`, round: r, slot: s, leg: 2, home: away, away: home, isBye: false, isThirdPlace: false })
      }
    }
    tieKeys.push(keys)
    previous = keys
  }

  if (options.thirdPlace && rounds >= 2) {
    const semis = tieKeys[rounds - 2]
    matches.push({
      key: "THIRD",
      round: rounds,
      slot: 2,
      leg: 1,
      home: { kind: "loser_of", matchKey: semis[0] },
      away: { kind: "loser_of", matchKey: semis[1] },
      isBye: false,
      isThirdPlace: true,
    })
  }

  return { size, byes: size - n, rounds, matches }
}

/** Every entrant appears exactly once in round one -- the property "no team silently discarded". */
export function roundOneEntrants(bracket: Bracket): string[] {
  return bracket.matches
    .filter((m) => m.round === 1 && m.leg === 1)
    .flatMap((m) => [m.home, m.away])
    .filter((s): s is { kind: "entrant"; id: string } => s.kind === "entrant")
    .map((s) => s.id)
}

/**
 * LEAGUE INTO KNOCKOUT.
 *
 * Qualifiers are placeholders -- "Group A, 1st" -- until the group tables are
 * final. With group winners seeded, winners are kept apart and each winner
 * meets a runner-up from a DIFFERENT group where the draw allows it, so a
 * group's two qualifiers do not replay each other in the first knockout round.
 */
/**
 * Qualifiers as seeded entrants: every group winner is seeded above every
 * runner-up, and so on down the places, so a standard seeded draw keeps the
 * winners apart, gives any byes to group winners, and meets a winner with a
 * lower place. Works for top 1, 2, 4 -- any number through per group.
 */
export function seededQualifiers(groupCount: number, perGroup: number): (KnockoutEntrant & { groupIndex: number; position: number })[] {
  const out: (KnockoutEntrant & { groupIndex: number; position: number })[] = []
  for (let p = 1; p <= perGroup; p++) {
    for (let g = 0; g < groupCount; g++) {
      out.push({ id: `q:${g}:${p}`, seed: (p - 1) * groupCount + g + 1, group: g, groupIndex: g, position: p })
    }
  }
  return out
}

/** First-round ties in which both teams came from the same group. */
export function bracketSameGroupTies(bracket: Bracket, groupOf: (entrantId: string) => number | null): number {
  return bracket.matches.filter((m) => m.round === 1 && m.leg === 1 && m.home.kind === "entrant" && m.away.kind === "entrant" && groupOf(m.home.id) !== null && groupOf(m.home.id) === groupOf(m.away.id)).length
}

export function qualifierEntrants(groupCount: number, perGroup: number): { groupIndex: number; position: number; label: string }[] {
  const out: { groupIndex: number; position: number; label: string }[] = []
  for (let p = 1; p <= perGroup; p++) {
    for (let g = 0; g < groupCount; g++) {
      out.push({ groupIndex: g, position: p, label: `Group ${String.fromCharCode(65 + g)}, ${ordinal(p)}` })
    }
  }
  return out
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * First knockout round for qualifiers. Winners seeded: winner of group g meets
 * the runner-up of group (g + 1) mod G, which never pairs a group with itself
 * when there are two or more groups. Otherwise the qualifiers are drawn at
 * random with the seed number. Returns pairings of qualifier placeholders.
 */
export function qualifierPairings(
  groupCount: number,
  perGroup: number,
  options: { mode: "winners_seeded" | "random" | "manual"; seedNumber?: number },
): { home: { groupIndex: number; position: number }; away: { groupIndex: number; position: number } }[] {
  const all = qualifierEntrants(groupCount, perGroup).map(({ groupIndex, position }) => ({ groupIndex, position }))
  if (options.mode === "winners_seeded" && perGroup === 2 && groupCount >= 2) {
    return Array.from({ length: groupCount }, (_, g) => ({
      home: { groupIndex: g, position: 1 },
      away: { groupIndex: (g + 1) % groupCount, position: 2 },
    }))
  }
  const pool = options.mode === "random" ? shuffle(all, options.seedNumber ?? 1) : all
  const pairs: { home: { groupIndex: number; position: number }; away: { groupIndex: number; position: number } }[] = []
  for (let i = 0; i + 1 < pool.length; i += 2) pairs.push({ home: pool[i], away: pool[i + 1] })
  return pairs
}

/** Pairings where both qualifiers come from the same group -- shown as a warning, never silently allowed or fixed. */
export function sameGroupRematches(pairs: { home: { groupIndex: number }; away: { groupIndex: number } }[]): number {
  return pairs.filter((p) => p.home.groupIndex === p.away.groupIndex).length
}
