/**
 * DIVIDING ENTRANTS INTO GROUPS.
 *
 * Three ways, all producing the same shape and all editable afterwards:
 * Random (seeded, so a draw can be reproduced and explained), By Distance
 * (closer clubs together, group sizes respected), and Manual (the organiser's
 * own arrangement, which this module only validates).
 *
 * Pure and deterministic. Coordinates come from canonical, geocoded records;
 * an entrant without them is never guessed at -- it is placed last, and said.
 */

export interface GroupEntrant {
  id: string
  /** Canonical coordinates, or null when the record has none that can be trusted. */
  lat: number | null
  lng: number | null
}

export interface GroupAllocation {
  groups: string[][]
  /** Entrants placed without coordinates, so a By Distance draw could not position them. */
  unlocated: string[]
}

/** Balanced sizes: 32 into 4 is 8/8/8/8; 30 into 4 is 8/8/7/7. */
export function groupSizes(entrants: number, groupCount: number): number[] {
  const g = Math.max(1, Math.min(groupCount, entrants))
  const base = Math.floor(entrants / g)
  const extra = entrants % g
  return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0))
}

/** A small, well-known deterministic PRNG (mulberry32), so a seed reproduces a draw. */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const rand = seededRandom(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function randomAllocation(entrants: GroupEntrant[], groupCount: number, seed: number): GroupAllocation {
  const sizes = groupSizes(entrants.length, groupCount)
  const order = shuffle(
    entrants.map((e) => e.id),
    seed,
  )
  const groups: string[][] = []
  let at = 0
  for (const size of sizes) {
    groups.push(order.slice(at, at + size))
    at += size
  }
  return { groups, unlocated: [] }
}

// ---------------------------------------------------------------------------
// BY DISTANCE
// ---------------------------------------------------------------------------

const EARTH_MILES = 3958.8

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

interface Located {
  id: string
  lat: number
  lng: number
}

/** The total of every within-group pairwise distance -- what By Distance minimises. */
export function groupTravel(groups: string[][], entrants: GroupEntrant[]): number {
  const byId = new Map(entrants.map((e) => [e.id, e]))
  let total = 0
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = byId.get(g[i])
        const b = byId.get(g[j])
        if (a?.lat != null && a.lng != null && b?.lat != null && b.lng != null) {
          total += milesBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
        }
      }
    }
  }
  return total
}

/**
 * BY DISTANCE: capacity-constrained clustering, then local improvement.
 *
 * 1. Seeds: the entrant furthest from the centre starts group one; each next
 *    seed is the entrant furthest from every seed chosen so far. Deterministic,
 *    and it spreads the groups across the map rather than clumping them.
 * 2. Assignment: every (entrant, group) pair is ranked by distance to that
 *    group's centre and taken greedily while the group has room, so the
 *    requested sizes are always exactly met.
 * 3. Centres move to their members' mean and step 2 repeats until stable.
 * 4. Swaps: any two entrants in different groups trade places when that lowers
 *    total within-group travel, until no single swap helps.
 *
 * Postcodes are never sorted alphabetically and no coordinate is invented.
 * Entrants without trustworthy coordinates fill the remaining places after the
 * located entrants are grouped, and are reported as unlocated.
 */
export function distanceAllocation(entrants: GroupEntrant[], groupCount: number): GroupAllocation {
  const sizes = groupSizes(entrants.length, groupCount)
  const located: Located[] = entrants
    .filter((e): e is GroupEntrant & { lat: number; lng: number } => e.lat != null && e.lng != null)
    .map((e) => ({ id: e.id, lat: e.lat, lng: e.lng }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const unlocated = entrants.filter((e) => e.lat == null || e.lng == null).map((e) => e.id)
  const g = sizes.length

  // Unlocated entrants are owed places too. They are spread one at a time from
  // the last group backwards, so no single group absorbs all of them.
  const capacity = [...sizes]
  let spare = unlocated.length
  for (let i = g - 1; spare > 0; i = (i - 1 + g) % g) {
    if (capacity[i] > 0) {
      capacity[i]--
      spare--
    }
  }

  const groups: string[][] = Array.from({ length: g }, () => [])
  if (located.length > 0) {
    const centre = {
      lat: located.reduce((s, e) => s + e.lat, 0) / located.length,
      lng: located.reduce((s, e) => s + e.lng, 0) / located.length,
    }
    const seeds: Located[] = []
    const first = [...located].sort((a, b) => milesBetween(b, centre) - milesBetween(a, centre) || a.id.localeCompare(b.id))[0]
    seeds.push(first)
    while (seeds.length < g && seeds.length < located.length) {
      const next = located
        .filter((e) => !seeds.includes(e))
        .map((e) => ({ e, d: Math.min(...seeds.map((s) => milesBetween(e, s))) }))
        .sort((a, b) => b.d - a.d || a.e.id.localeCompare(b.e.id))[0].e
      seeds.push(next)
    }
    let centres = seeds.map((s) => ({ lat: s.lat, lng: s.lng }))
    while (centres.length < g) centres.push({ ...centre })

    let assignment = new Map<string, number>()
    for (let iter = 0; iter < 25; iter++) {
      const room = [...capacity]
      const pairs = located
        .flatMap((e) => centres.map((c, gi) => ({ id: e.id, gi, d: milesBetween(e, c) })))
        .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id) || a.gi - b.gi)
      const next = new Map<string, number>()
      for (const p of pairs) {
        if (next.has(p.id) || room[p.gi] <= 0) continue
        next.set(p.id, p.gi)
        room[p.gi]--
      }
      const stable = located.every((e) => assignment.get(e.id) === next.get(e.id))
      assignment = next
      centres = centres.map((c, gi) => {
        const members = located.filter((e) => assignment.get(e.id) === gi)
        return members.length === 0
          ? c
          : { lat: members.reduce((s, e) => s + e.lat, 0) / members.length, lng: members.reduce((s, e) => s + e.lng, 0) / members.length }
      })
      if (stable) break
    }
    for (const e of located) groups[assignment.get(e.id) ?? 0].push(e.id)

    // Local improvement by pairwise swaps.
    const cost = (gs: string[][]) => groupTravel(gs, entrants)
    let best = cost(groups)
    let improved = true
    let guard = 0
    while (improved && guard++ < 200) {
      improved = false
      for (let a = 0; a < g && !improved; a++) {
        for (let b = a + 1; b < g && !improved; b++) {
          for (let i = 0; i < groups[a].length && !improved; i++) {
            for (let j = 0; j < groups[b].length && !improved; j++) {
              ;[groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]]
              const c = cost(groups)
              if (c < best - 1e-9) {
                best = c
                improved = true
              } else {
                ;[groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]]
              }
            }
          }
        }
      }
    }
  }

  // Unlocated entrants fill the remaining places, in a stable order.
  const queue = [...unlocated].sort()
  for (let gi = 0; gi < g; gi++) {
    while (groups[gi].length < sizes[gi] && queue.length > 0) groups[gi].push(queue.shift()!)
  }
  for (const gs of groups) gs.sort()
  return { groups, unlocated }
}

/** Manual allocations are the organiser's; this only checks they account for every entrant exactly once. */
export function validateAllocation(groups: string[][], entrantIds: string[]): { ok: boolean; missing: string[]; duplicated: string[] } {
  const counts = new Map<string, number>()
  for (const g of groups) for (const id of g) counts.set(id, (counts.get(id) ?? 0) + 1)
  return {
    ok: entrantIds.every((id) => counts.get(id) === 1) && [...counts.keys()].every((id) => entrantIds.includes(id)),
    missing: entrantIds.filter((id) => !counts.has(id)),
    duplicated: [...counts].filter(([, c]) => c > 1).map(([id]) => id),
  }
}

/** Swap two entrants between (or within) groups; returns a new allocation. */
export function swapEntrants(groups: string[][], a: string, b: string): string[][] {
  return groups.map((g) => g.map((id) => (id === a ? b : id === b ? a : id)))
}
