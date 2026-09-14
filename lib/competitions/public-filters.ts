/**
 * THE PUBLIC ROUND FILTER.
 *
 * A league's "Round 2" and a knockout's second round are different rounds. Each
 * option is keyed by stage and round ("league-2", "knockout-2") and named by
 * stage -- "League, Round 2", "Knockout, Quarter-Finals" -- using the knockout
 * naming the bracket uses, so the filter can never mix the two.
 */

import { knockoutRoundName } from "./knockout"

export function publicRoundOptions(
  matches: { kind: string; round: number | null }[],
  knockoutRounds: number,
  stage: "league" | "knockout" | null,
): [string, string][] {
  const seen = new Set<string>()
  const out: { kind: string; round: number }[] = []
  for (const m of matches) {
    if (m.round === null || (stage && m.kind !== stage)) continue
    const key = `${m.kind}-${m.round}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: m.kind, round: m.round })
  }
  return out
    .sort((a, b) => (a.kind === b.kind ? a.round - b.round : a.kind === "league" ? -1 : 1))
    .map(({ kind, round }) => [`${kind}-${round}`, kind === "knockout" ? `Knockout, ${knockoutRoundName(round, knockoutRounds)}` : `League, Round ${round}`])
}
