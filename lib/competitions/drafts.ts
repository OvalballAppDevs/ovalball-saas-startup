/**
 * FROM A DRAW TO DRAFT COMPETITION MATCHES.
 *
 * The engines (league.ts, knockout.ts, rounds.ts) decide who plays whom; this
 * turns their answer into the draft Competition Match rows the Creator saves.
 * Pure, so the rows an organiser will issue are tested rather than trusted:
 * every group's round r shares round r's date, a bye never becomes a match,
 * a winner goes into the next tie by the match it came from, and a qualifier
 * is a named place ("Group A 1st") until the tables fill it.
 */

import { generateLeague, type MatchesMode } from "./league"
import { knockoutRoundName, ordinal, type Bracket, type SlotSource } from "./knockout"
import { roundDates } from "./rounds"
import type { DraftMatchInput, SlotSourceRecord } from "./workspace-types"

export interface VenueChoice {
  venueId: string | null
  venueText: string | null
}

export interface LeagueDraftResult {
  matches: DraftMatchInput[]
  rounds: { roundNumber: number; name: string | null; roundDate: string | null }[]
  /** One sentence per group whose request cannot be met exactly. */
  warnings: string[]
}

export function groupLetter(index: number): string {
  let n = index
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

export function leagueDraftMatches(
  groups: { id: string; name: string; members: string[] }[],
  mode: MatchesMode,
  options: { firstDate: string | null; everyDays: number; kickoff: string | null; venueFor: (homeParticipantId: string) => VenueChoice; newId?: () => string },
): LeagueDraftResult {
  const warnings: string[] = []
  const matches: DraftMatchInput[] = []
  let roundCount = 0
  for (const g of groups) {
    const draft = generateLeague(g.members, mode)
    if (!draft.feasibility.ok) {
      warnings.push(`${g.name}: ${draft.feasibility.reason ?? "that schedule is not possible."}`)
      continue
    }
    roundCount = Math.max(roundCount, draft.rounds.length)
    for (const r of draft.rounds) {
      for (const p of r.matches) {
        const venue = options.venueFor(p.home)
        matches.push({
          id: options.newId?.(),
          groupId: g.id,
          roundNumber: r.round,
          homeParticipantId: p.home,
          awayParticipantId: p.away,
          matchDate: null,
          kickoffTime: options.kickoff,
          venueId: venue.venueId,
          venueText: venue.venueText,
        })
      }
    }
  }
  const dates = options.firstDate ? roundDates(roundCount, { kind: "weekly", start: options.firstDate, everyDays: options.everyDays }) : roundDates(roundCount, { kind: "none" })
  for (const m of matches) m.matchDate = dates[(m.roundNumber ?? 1) - 1] ?? null
  return { matches, rounds: dates.map((d, i) => ({ roundNumber: i + 1, name: `Round ${i + 1}`, roundDate: d })), warnings }
}

/** One tie, named the way a draw sheet names it: "Semi-Final 2", "Round of 32 Match 7". */
export function tieLabel(round: number, rounds: number, slot: number): string {
  const fromEnd = rounds - round
  if (fromEnd === 0) return "Final"
  if (fromEnd === 1) return `Semi-Final ${slot}`
  if (fromEnd === 2) return `Quarter-Final ${slot}`
  return `Round of ${2 ** (fromEnd + 1)} Match ${slot}`
}

export type EntrantPlace = { participantId: string } | { qualifier: { group_index: number; position: number } }

export interface KnockoutDraftResult {
  matches: DraftMatchInput[]
  rounds: { roundNumber: number; name: string | null; roundDate: string | null }[]
  /** Bracket key to saved match id, for drawing the bracket. */
  idByKey: Record<string, string>
}

export function knockoutDraftMatches(
  bracket: Bracket,
  options: {
    legs: 1 | 2
    place: (entrantId: string) => EntrantPlace
    groupName: (groupIndex: number) => string
    firstDate: string | null
    everyDays: number
    kickoff: string | null
    /** A neutral ground for the final, by name. Null: see finalVenueMode. */
    finalVenueText: string | null
    /** "home": the final's home side's ground (the default); "neutral": finalVenueText; "later": no ground yet. */
    finalVenueMode?: "home" | "neutral" | "later"
    /** Neutral home allocation: no tie gets a club's ground; each is set by hand. */
    neutralVenues?: boolean
    venueFor: (homeParticipantId: string) => VenueChoice
    newId: () => string
  },
): KnockoutDraftResult {
  const byKey = new Map(bracket.matches.map((m) => [m.key, m]))
  const idByKey: Record<string, string> = {}
  for (const m of bracket.matches) if (!m.isBye) idByKey[m.key] = options.newId()

  // The match a winner is taken from: with two legs, the tie is decided on the second leg.
  const decidingId = (key: string) => (options.legs === 2 && idByKey[`${key}-L2`] ? idByKey[`${key}-L2`] : idByKey[key])

  type Resolved = { participantId: string | null; source: SlotSourceRecord }
  const resolve = (s: SlotSource): Resolved => {
    switch (s.kind) {
      case "bye":
        return { participantId: null, source: null }
      case "entrant": {
        const place = options.place(s.id)
        if ("participantId" in place) return { participantId: place.participantId, source: null }
        return {
          participantId: null,
          source: { qualifier: place.qualifier, label: `${options.groupName(place.qualifier.group_index)} ${ordinal(place.qualifier.position)}` },
        }
      }
      case "qualifier":
        return { participantId: null, source: { qualifier: { group_index: s.groupIndex, position: s.position }, label: `${options.groupName(s.groupIndex)} ${ordinal(s.position)}` } }
      case "winner_of": {
        const from = byKey.get(s.matchKey)
        // A bye is not played: its entrant goes straight into the next tie.
        if (from?.isBye) return resolve(from.home.kind === "bye" ? from.away : from.home)
        const m = /^R(\d+)-M(\d+)/.exec(s.matchKey)
        return { participantId: null, source: { winner_of: decidingId(s.matchKey), label: m ? `Winner of ${tieLabel(Number(m[1]), bracket.rounds, Number(m[2]))}` : "Winner" } }
      }
      case "loser_of": {
        const m = /^R(\d+)-M(\d+)/.exec(s.matchKey)
        return { participantId: null, source: { loser_of: decidingId(s.matchKey), label: m ? `Loser of ${tieLabel(Number(m[1]), bracket.rounds, Number(m[2]))}` : "Loser" } }
      }
    }
  }

  // Round dates: a two-legged round takes two dates, the legs a date apart.
  const legDates: (string | null)[][] = []
  let dateIndex = 0
  const totalSlots = Array.from({ length: bracket.rounds }, (_, i) => (options.legs === 2 && i + 1 < bracket.rounds ? 2 : 1)).reduce((a, b) => a + b, 0)
  const dates = options.firstDate ? roundDates(totalSlots, { kind: "weekly", start: options.firstDate, everyDays: options.everyDays }) : roundDates(totalSlots, { kind: "none" })
  for (let r = 1; r <= bracket.rounds; r++) {
    const legsThisRound = options.legs === 2 && r < bracket.rounds ? 2 : 1
    legDates.push(dates.slice(dateIndex, dateIndex + legsThisRound))
    dateIndex += legsThisRound
  }

  const matches: DraftMatchInput[] = []
  for (const m of bracket.matches) {
    if (m.isBye) continue
    const home = resolve(m.home)
    const away = resolve(m.away)
    const isFinal = m.round === bracket.rounds && !m.isThirdPlace
    const finalMode = options.finalVenueMode ?? (options.finalVenueText ? "neutral" : "home")
    const none = { venueId: null, venueText: null }
    const venue = isFinal
      ? finalMode === "neutral" && options.finalVenueText
        ? { venueId: null, venueText: options.finalVenueText }
        : finalMode === "later"
          ? none
          : home.participantId && !options.neutralVenues
            ? options.venueFor(home.participantId)
            : none
      : options.neutralVenues
        ? none
        : home.participantId
          ? options.venueFor(home.participantId)
          : none
    matches.push({
      id: idByKey[m.key],
      roundNumber: m.round,
      bracketSlot: m.slot,
      homeParticipantId: home.participantId,
      awayParticipantId: away.participantId,
      homeSource: home.source,
      awaySource: away.source,
      matchDate: legDates[m.round - 1]?.[m.leg - 1] ?? null,
      kickoffTime: options.kickoff,
      venueId: venue.venueId,
      venueText: venue.venueText,
    })
  }

  return {
    matches,
    rounds: legDates.map((d, i) => ({ roundNumber: i + 1, name: knockoutRoundName(i + 1, bracket.rounds), roundDate: d[0] ?? null })),
    idByKey,
  }
}
