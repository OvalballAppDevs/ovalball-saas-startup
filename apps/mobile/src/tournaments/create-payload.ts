import { SWISS_ROUND_RANGE, compareAgeGroups } from "@ovalball/contracts/club/tournaments"

import type { TournamentDraft } from "./create-context"
import { teamCountForGrade } from "./teams-selection"

/**
 * WHAT GETS SENT, AND WHAT STOPS IT BEING SENT.
 *
 * ONE PAYLOAD FOR ONE CALL. The whole tournament -- details, competitions, our own sides and every
 * other club's -- goes to `create_tournament_with_teams` in a single transaction, so there is no
 * sequence to get half way through. Building that payload is a pure function, which is why it lives
 * here and not inside the screen.
 *
 * THE CLIENT VALIDATES SO THE PERSON GETS A SENTENCE, NOT SO THE DATABASE CAN RELAX. Every rule below
 * is re-checked server side; the point of checking here is to say *which step* to go back to, which a
 * Postgres error cannot.
 */

export type WizardStep = "basics" | "ageGroups" | "teams"

export interface DraftProblem {
  step: WizardStep
  /** What is wrong, in the words a person would use. */ message: string
}

/**
 * Everything wrong with the draft, in the order the wizard asks for it -- so the first problem is
 * always the earliest step, and fixing them in order never sends somebody backwards twice.
 */
export function validateDraft(draft: TournamentDraft): DraftProblem[] {
  const problems: DraftProblem[] = []

  if (draft.name.trim().length <= 1) problems.push({ step: "basics", message: "The tournament needs a name." })
  if (!draft.startsOn) problems.push({ step: "basics", message: "The tournament needs a start date." })
  if (draft.multiDay && !draft.endsOn) problems.push({ step: "basics", message: "A multi-day tournament needs an end date." })
  if (draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn) {
    problems.push({ step: "basics", message: "The end date is before the start date." })
  }
  if (!draft.venueId) problems.push({ step: "basics", message: "The tournament needs a venue." })
  if (!(["round_robin", "tri_fixture", "swiss", "knockout", "hybrid"] as const).includes(draft.format)) {
    problems.push({ step: "basics", message: "The tournament needs a format." })
  }
  // Swiss is the one shape that is incomplete without a number, and the database says so with a
  // check constraint. Caught here it is a sentence on the step that owns it.
  if (draft.format === "swiss" && (draft.swissRounds == null || draft.swissRounds < SWISS_ROUND_RANGE.min || draft.swissRounds > SWISS_ROUND_RANGE.max)) {
    problems.push({ step: "basics", message: `A Swiss tournament runs between ${SWISS_ROUND_RANGE.min} and ${SWISS_ROUND_RANGE.max} rounds.` })
  }

  if (draft.visibility !== "public" && draft.visibility !== "private") {
    problems.push({ step: "basics", message: "The tournament needs a visibility." })
  }

  if (draft.ageGroups.length === 0) {
    problems.push({ step: "ageGroups", message: "Select at least one age group." })
  }

  // A competition with nobody in it is not a competition, and it is the one thing a person can get
  // all the way to Review without noticing.
  const empty = draft.ageGroups.filter((g) => teamCountForGrade(g) === 0).map((g) => g.ageGroup)
  if (empty.length === 1) problems.push({ step: "teams", message: `${empty[0]} has no teams.` })
  if (empty.length > 1) problems.push({ step: "teams", message: `${empty.slice(0, -1).join(", ")} and ${empty[empty.length - 1]} have no teams.` })

  // The database refuses a duplicate side outright, so a draft carrying one would fail at the last
  // moment. Caught here it is a sentence rather than a constraint name.
  for (const g of draft.ageGroups) {
    const keys = new Set<string>()
    for (const s of g.sides) {
      if (keys.has(s.key)) {
        problems.push({ step: "teams", message: `${s.label} is in ${g.ageGroup} twice.` })
        break
      }
      keys.add(s.key)
    }
  }

  return problems
}

export interface CreateTournamentPayload {
  p_club_id: string
  p_name: string
  p_starts_on: string
  p_ends_on: string | null
  p_kickoff_time: string | null
  p_format: string
  p_swiss_rounds: number | null
  /** Only a LIBRARY choice travels with the create. An uploaded photo's storage path contains the
   * tournament's id, which does not exist yet, so it is uploaded and set immediately afterwards
   * through the same governed RPC every later change uses. */
  p_cover_stock_key: string | null
  p_visibility: string
  p_venue_id: string
  p_notes: string | null
  p_age_groups: string[]
  p_our_team_ids: string[]
  p_participants: { directory_id: string | null; club_name: string | null; team_id: string | null; age_group: string; squad_label: string | null }[]
}

/**
 * THE DRAFT, AS THE ONE CALL WANTS IT.
 *
 * Age groups go in canonical order, and each side carries the grade it is entered at -- the grade is
 * what identifies a competition, not the participant's canonical type, because a club that is not on
 * Ovalball has a grade and no pathway.
 *
 * A DIRECTORY ID THE SCREEN INVENTED IS NOT SENT. An external club typed in has no directory row yet,
 * and the screen marks that with a `pending:` key purely to keep its own list unique; sending it as
 * though it were a real id would point the participant at nothing. The server matches the name or
 * creates the directory row itself.
 */
export function buildCreatePayload(draft: TournamentDraft, clubId: string): CreateTournamentPayload {
  const grades = draft.ageGroups.map((g) => g.ageGroup).sort(compareAgeGroups)

  const ourTeamIds: string[] = []
  const participants: CreateTournamentPayload["p_participants"] = []

  for (const g of draft.ageGroups) {
    for (const id of g.ourTeamIds ?? []) ourTeamIds.push(id)
    for (const s of g.sides) {
      const real = s.directoryId.startsWith("pending:") ? null : s.directoryId
      participants.push({
        directory_id: real,
        club_name: s.clubName,
        team_id: s.teamId,
        age_group: g.ageGroup,
        // A REAL TEAM IS ITS OWN NAME. Otherwise the side carries whatever the organiser actually
        // typed -- which for a directory club added without a squad name is NOTHING. `label` is the
        // display fallback (the age group), and writing that as a squad label would invent a name the
        // organiser never gave and make a second unnamed side look like a duplicate.
        squad_label: s.teamId ? null : s.squadLabel !== undefined ? s.squadLabel : s.label,
      })
    }
  }

  return {
    p_club_id: clubId,
    p_name: draft.name.trim(),
    p_starts_on: draft.startsOn!,
    // A one-day tournament ends the day it starts. The column is NOT NULL, and null here means "one
    // day" rather than "unknown", so the server coalesces rather than rejecting.
    p_ends_on: draft.multiDay ? draft.endsOn : null,
    p_kickoff_time: draft.startTime,
    p_format: draft.format,
    // Sent only for the shape that may carry it -- the column is forbidden to be set otherwise.
    p_swiss_rounds: draft.format === "swiss" ? draft.swissRounds : null,
    p_cover_stock_key: draft.cover?.kind === "stock" ? draft.cover.key : null,
    p_visibility: draft.visibility,
    p_venue_id: draft.venueId!,
    p_notes: draft.notes.trim() || null,
    p_age_groups: grades,
    p_our_team_ids: ourTeamIds,
    p_participants: participants,
  }
}

/** How many days the tournament runs, inclusive. One day is one day, not zero. */
export function tournamentDayCount(startsOn: string | null, endsOn: string | null): number {
  if (!startsOn) return 0
  const start = Date.parse(`${startsOn}T00:00:00Z`)
  const end = Date.parse(`${endsOn ?? startsOn}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1
  return Math.round((end - start) / 86400000) + 1
}

export function daysLabel(count: number): string {
  return count === 1 ? "1 day" : `${count} days`
}

export function ageGroupsLabel(count: number): string {
  return count === 1 ? "1 age group" : `${count} age groups`
}
