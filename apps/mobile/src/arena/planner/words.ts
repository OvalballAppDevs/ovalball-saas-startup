import { activityLabel, opponentShort, teamShort, type AllocationPreview, type ArenaActivity } from "@ovalball/contracts/arena"

import type { Plan } from "./plan"

/**
 * ARENA PLANNING'S WORDS -- said the same way everywhere a person meets them: the board, the save bar, the leave
 * sheet, the details sheet and VoiceOver. Kept here, apart from the screens, so they are one decision each.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * THE ONE VERB FOR SAVING THE DAY'S PLAN. "1 unsaved change / Save Change", "3 unsaved changes / Save 3 Changes";
 * "3 proposed changes / Apply Plan" when every change is Ovalball's proposal. Never Confirm, never Commit.
 */
export function saveWords(total: number, auto: number): { status: string; action: string } {
  if (total > 0 && auto === total) return { status: plural(total, "proposed change", "proposed changes"), action: "Apply Plan" }
  return { status: plural(total, "unsaved change", "unsaved changes"), action: total === 1 ? "Save Change" : `Save ${total} Changes` }
}

/**
 * WHAT A PROPOSAL TAKES FROM ANOTHER MATCH. Re-running Auto Allocation can give one match a room or pitch by taking
 * it from another that Ovalball placed earlier -- which solves nothing if the other is left without. Each match
 * that would lose something, what it would lose, and who would get it, so the plan says so rather than hiding the
 * trade inside "1 issue remains".
 */
export interface Displacement { id: string; loses: "rooms" | "pitch"; to: string[] }
const PLACES = ["pitchId", "homeRoomId", "awayRoomId", "officialsRoomId"] as const
export function displacements(plan: Plan): Displacement[] {
  const changes = Array.from(plan.values()).filter((c) => c.origin === "AUTO")
  const out: Displacement[] = []
  for (const c of changes) {
    const lost = PLACES.filter((k) => k in c.set && (c.set[k] ?? null) === null && (c.expected[k] ?? null) !== null)
    if (lost.length === 0) continue
    const ids = new Set(lost.map((k) => c.expected[k] as string))
    const to = changes.filter((d) => d !== c && PLACES.some((k) => k in d.set && !!d.set[k] && ids.has(d.set[k] as string))).map((d) => d.label)
    out.push({ id: c.id, loses: lost.includes("pitchId") ? "pitch" : "rooms", to })
  }
  return out
}

/**
 * WHAT AUTO ALLOCATE DID, IN A CLUB ADMINISTRATOR'S WORDS -- how many changes it proposes, how they came out against
 * the teams' preferences, what any of them takes from another match, and what it could not solve. Never the
 * engine's own vocabulary.
 */
export function proposalWords(p: AllocationPreview, proposed: number, displaced: readonly { label: string; loses: "rooms" | "pitch" }[] = []): { title: string; details: string[] } {
  const s = p.summary
  const left = Math.max(s.unresolved - displaced.length, 0)
  return {
    title: proposed > 0
      ? `Ovalball proposed ${plural(proposed, "change", "changes")}`
      : s.unresolved > 0 ? "Ovalball couldn't place everything" : "Everything already has its place",
    details: [
      s.firstPreferences > 0 ? `${s.firstPreferences} ${s.firstPreferences === 1 ? "matches" : "match"} your preferences` : null,
      s.alternatives > 0 ? `${s.alternatives} ${s.alternatives === 1 ? "uses" : "use"} the next available option` : null,
      s.noPreference > 0 ? `${s.noPreference} with no preference set` : null,
      ...displaced.map((d) => `${d.label} would lose its ${d.loses === "pitch" ? "pitch" : "changing rooms"}`),
      left > 0 ? (left === 1 ? "1 issue remains" : `${left} issues remain`) : null,
    ].filter((x): x is string => !!x),
  }
}

const LOCK_ORDER = ["pitch", "home_room", "away_room", "officials_room"]
/** What is locked, in words and in a sensible order: "the pitch, the home changing room and the away changing room". */
export function lockedWords(locks: readonly string[]): string {
  const words = [...locks].sort((x, y) => LOCK_ORDER.indexOf(x) - LOCK_ORDER.indexOf(y)).map((l) =>
    l === "pitch" ? "the pitch" : l === "home_room" ? "the home changing room" : l === "away_room" ? "the away changing room" : "the officials room")
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

/** A club's name on the board, without the words every club shares: "Sedgley Park", not "Sedgley Park Rugby Union Football Club". */
const CLUB_SUFFIX = /\s+(Rugby Union Football Club|Rugby Football Union Club|Rugby Union FC|Rugby Football Club|Rugby Union Club|Rugby Club|Football Club|R\.?U\.?F\.?C\.?|R\.?F\.?C\.?)$/i
export const boardOpponent = (name: string): string => opponentShort(name).replace(CLUB_SUFFIX, "") || opponentShort(name)

/** An activity as the board names it: "U8 v Vale of Lune", "U12 Training". */
export const boardLabel = (a: ArenaActivity): string => (a.kind === "FIXTURE" ? `${teamShort(a.team)} v ${boardOpponent(a.opponentName)}` : activityLabel(a))
