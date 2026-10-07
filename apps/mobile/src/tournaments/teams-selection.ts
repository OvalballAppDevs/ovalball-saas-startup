import type { OurTeamOption, TournamentCandidateTeam, TournamentClubResult } from "@ovalball/contracts/club/tournament-teams"

import type { DraftAgeGroup, DraftSide } from "./create-context"

/** "U12" with no alias, "U12 Spears" with one. The grade is always present, because it is the fact
 * that places the side in a competition -- the alias only tells two of a club's sides apart.
 *
 * DEFINED HERE, NOT BESIDE THE FORM, so a pure module can use it: the form is a .tsx that imports
 * React Native, and pulling that into the draft rules would make them untestable without a renderer. */
export function sideIdentityLabel(ageGroup: string, alias: string | null): string {
  const a = alias?.trim()
  return a ? `${ageGroup} ${a}` : ageGroup
}

/**
 * THE TEAMS STEP'S RULES, held apart from the screen so they can be tested without a renderer.
 *
 * The step answers one question per age group: who is coming to THIS competition? Everything below
 * exists to keep that answer honest as the organiser moves between grades.
 *
 * FOUR RULES THAT ARE NOT OBVIOUS FROM LOOKING AT THE SCREEN:
 *
 *   1. AGE GROUPS DO NOT LEAK. Every function takes one grade and touches only that grade's entry.
 *      Adding Burnley's U9 sides must not put them in the U11 competition, and the flat `sides` list
 *      lives inside the age group rather than beside it precisely so that cannot happen.
 *
 *   2. OUR OWN SIDES ARE SEEDED ONCE, NOT RE-SEEDED. `ourTeamIds === null` means "never looked at",
 *      and seeding fills it from the club's real teams at that grade. `[]` means the organiser took
 *      them all out. Re-seeding an empty list would silently undo that every time they changed tab.
 *
 *   3. A SIDE IS A SIDE, NOT A CLUB. A club bringing three U9 teams is three entries, because that is
 *      three teams in the competition and three rows in `tournament_participants`.
 *
 *   4. ADDED IS NOT INVITED. Nothing here produces a pending, accepted or declined state, and nothing
 *      here asks the other club anything. That is a product decision, not an omission.
 */

/** The key a side is deduplicated and removed by. An Ovalball side IS its team; an external side is
 * the club plus what the organiser called it, because it has no team row to be. */
export function sideKey(input: { teamId: string | null; directoryId: string; label: string }): string {
  return input.teamId ? `team:${input.teamId}` : `ext:${input.directoryId}:${input.label.trim().toLowerCase()}`
}

/** Finds one grade's entry. Returns undefined rather than creating one: a grade that is not in the
 * draft was not selected on Step 2, and must not be conjured into existence by being looked at. */
export function ageGroupEntry(draft: DraftAgeGroup[], ageGroup: string): DraftAgeGroup | undefined {
  return draft.find((a) => a.ageGroup === ageGroup)
}

function mapGroup(draft: DraftAgeGroup[], ageGroup: string, fn: (g: DraftAgeGroup) => DraftAgeGroup): DraftAgeGroup[] {
  return draft.map((g) => (g.ageGroup === ageGroup ? fn(g) : g))
}

/**
 * SEED THE HOST'S OWN SIDES for any grade that has not been looked at yet.
 *
 * Called once the club's real teams have loaded. A grade whose `ourTeamIds` is already an array --
 * including an empty one -- is left exactly as it is.
 */
export function seedOurTeams(draft: DraftAgeGroup[], byGrade: Record<string, OurTeamOption[]>): DraftAgeGroup[] {
  let changed = false
  const next = draft.map((g) => {
    if (g.ourTeamIds !== null) return g
    changed = true
    return { ...g, ourTeamIds: (byGrade[g.ageGroup] ?? []).map((t) => t.teamId) }
  })
  return changed ? next : draft
}

/** Takes one of our own sides out of this grade. The team record is untouched: it is simply not in
 * this competition, and `addOurTeam` puts it back. */
export function removeOurTeam(draft: DraftAgeGroup[], ageGroup: string, teamId: string): DraftAgeGroup[] {
  return mapGroup(draft, ageGroup, (g) => ({ ...g, ourTeamIds: (g.ourTeamIds ?? []).filter((id) => id !== teamId) }))
}

/** Puts one of our own sides back, in the canonical order the club's teams were read in. */
export function addOurTeam(draft: DraftAgeGroup[], ageGroup: string, teamId: string, order: OurTeamOption[]): DraftAgeGroup[] {
  return mapGroup(draft, ageGroup, (g) => {
    const have = new Set(g.ourTeamIds ?? [])
    if (have.has(teamId)) return g
    have.add(teamId)
    return { ...g, ourTeamIds: order.filter((t) => have.has(t.teamId)).map((t) => t.teamId) }
  })
}

/**
 * ADD ANOTHER CLUB'S SIDES TO ONE GRADE.
 *
 * Idempotent by side key, so adding a club twice, or re-opening it and confirming the same teams,
 * cannot produce two entries for one side -- the same guarantee the database's unique index gives,
 * applied here so the screen never shows a duplicate it would later fail to save.
 */
export function addSides(draft: DraftAgeGroup[], ageGroup: string, club: TournamentClubResult, teams: TournamentCandidateTeam[]): DraftAgeGroup[] {
  return mapGroup(draft, ageGroup, (g) => {
    const have = new Set(g.sides.map((s) => s.key))
    const added: DraftSide[] = []
    for (const t of teams) {
      const key = sideKey({ teamId: t.teamId, directoryId: club.directoryId, label: t.name })
      if (have.has(key)) continue
      have.add(key)
      added.push({
        key,
        directoryId: club.directoryId,
        clubName: club.name,
        clubId: club.onOvalball ? club.directoryId : null,
        crestUrl: club.crestUrl,
        teamId: t.teamId,
        label: t.name,
      })
    }
    return added.length === 0 ? g : { ...g, sides: [...g.sides, ...added] }
  })
}

/**
 * RECORD A CLUB THAT IS NOT ON OVALBALL.
 *
 * No account is fabricated and no email is required -- the side is recorded against the directory row
 * if there is one, or against a name the organiser typed. It will be saved as `external_recorded`,
 * which is a statement of fact about that club, never a request it has to answer.
 */
export function addExternalSide(
  draft: DraftAgeGroup[],
  ageGroup: string,
  input: { directoryId: string | null; clubName: string; crestUrl?: string | null; alias: string | null },
): DraftAgeGroup[] {
  const clubName = input.clubName.trim()
  if (clubName.length === 0) return draft
  // THE ALIAS IS OPTIONAL AND IS NOT THE GRADE. A club recorded with no alias is a real side -- the
  // club, at that competition -- so there is nothing to fall back to and nothing to invent.
  const alias = input.alias?.trim() || null
  const directoryId = input.directoryId ?? `pending:${clubName.toLowerCase()}`
  const key = sideKey({ teamId: null, directoryId, label: alias ?? "" })
  return mapGroup(draft, ageGroup, (g) => {
    if (g.sides.some((s) => s.key === key)) return g
    return {
      ...g,
      sides: [
        ...g.sides,
        {
          key,
          directoryId,
          clubName,
          clubId: null,
          crestUrl: input.crestUrl ?? null,
          teamId: null,
          label: sideIdentityLabel(ageGroup, alias),
          squadLabel: alias,
        },
      ],
    }
  })
}

/**
 * A CANONICAL DIRECTORY CLUB WITH NO TEAM AT THIS GRADE.
 *
 * Wigan is in Ovalball's directory, has a crest and a town, and simply has not created its U12 team --
 * or has not claimed its account at all. It is still Wigan, so the side keeps Wigan's real
 * `directoryId` and is saved as `added`. Routing it through `addExternalSide` would be the mistake
 * this function exists to prevent: it would call a club Ovalball knows "external", and a club with no
 * directory id gets a `pending:` key that invents a second identity for a club we already have.
 *
 * THE LABEL IS OPTIONAL, so a club coming with one unnamed side is a real state. The age group stands
 * in for display only -- nothing is written as a squad label unless the organiser typed one.
 */
export function addDirectoryClubSide(
  draft: DraftAgeGroup[],
  ageGroup: string,
  input: { directoryId: string; clubName: string; crestUrl?: string | null; alias: string | null },
): DraftAgeGroup[] {
  const clubName = input.clubName.trim()
  if (clubName.length === 0) return draft
  const label = input.alias?.trim() || null
  // Keyed on the club and the label, so two squads coexist and the same squad twice does not.
  const key = sideKey({ teamId: null, directoryId: input.directoryId, label: label ?? "" })
  return mapGroup(draft, ageGroup, (g) => {
    if (g.sides.some((s) => s.key === key)) return g
    return {
      ...g,
      sides: [
        ...g.sides,
        {
          key,
          directoryId: input.directoryId,
          clubName,
          clubId: null,
          crestUrl: input.crestUrl ?? null,
          teamId: null,
          // "U12" with no alias, "U12 Spears" with one. Display only -- `squadLabel` is what is
          // written, and a side with no alias writes nothing.
          label: sideIdentityLabel(ageGroup, label),
          squadLabel: label,
        },
      ],
    }
  })
}

/** Takes another club's side out of this grade. */
export function removeSide(draft: DraftAgeGroup[], ageGroup: string, key: string): DraftAgeGroup[] {
  return mapGroup(draft, ageGroup, (g) => ({ ...g, sides: g.sides.filter((s) => s.key !== key) }))
}

/** Which of a club's sides are already in this grade -- so the selection sheet can show them as
 * already in rather than offering them again. */
export function alreadyInGrade(group: DraftAgeGroup | undefined, teams: TournamentCandidateTeam[], directoryId: string): Set<string> {
  if (!group) return new Set()
  const have = new Set(group.sides.map((s) => s.key))
  return new Set(teams.filter((t) => have.has(sideKey({ teamId: t.teamId, directoryId, label: t.name }))).map((t) => t.teamId))
}

/** TEAMS, NOT CLUBS. A club bringing three U9 sides is three teams, and the host's own sides count too. */
export function teamCountForGrade(group: DraftAgeGroup | undefined): number {
  if (!group) return 0
  return (group.ourTeamIds ?? []).length + group.sides.length
}

export function totalTeamCount(draft: DraftAgeGroup[]): number {
  return draft.reduce((n, g) => n + teamCountForGrade(g), 0)
}

/** "6 teams", and "1 team". */
export function teamsLabel(count: number): string {
  return count === 1 ? "1 team" : `${count} teams`
}

/** The Add button on the club sheet says how many it will add: "Add 1 Team", "Add 3 Teams". */
export function addTeamsCtaLabel(count: number): string {
  return count === 1 ? "Add 1 Team" : `Add ${count} Teams`
}

/** "U9: 3 · U10: 2" -- the per-grade breakdown under the total. Grades with nobody in them are named
 * too, because an empty competition is exactly what the organiser needs to notice. */
export function gradeBreakdown(draft: DraftAgeGroup[]): string {
  return draft.map((g) => `${g.ageGroup}: ${teamCountForGrade(g)}`).join("  ·  ")
}

/**
 * WHICH GRADES HAVE NOBODY IN THEM.
 *
 * Used to explain why the step cannot be finished, rather than greying the button and leaving the
 * organiser to work it out. A competition with no teams in it is not a competition.
 */
export function emptyGrades(draft: DraftAgeGroup[]): string[] {
  return draft.filter((g) => teamCountForGrade(g) === 0).map((g) => g.ageGroup)
}

export function teamsStepHint(draft: DraftAgeGroup[]): string | null {
  const empty = emptyGrades(draft)
  if (empty.length === 0) return null
  if (empty.length === 1) return `${empty[0]} has no teams yet. Add at least one team to continue.`
  return `${empty.slice(0, -1).join(", ")} and ${empty[empty.length - 1]} have no teams yet. Add at least one team to each to continue.`
}
