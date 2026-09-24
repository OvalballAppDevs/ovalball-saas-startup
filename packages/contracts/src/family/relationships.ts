import type { PlayerAgeState } from "../age-state"
import type { SessionContext } from "../session-context"

/**
 * A FAMILY IN PLAIN WORDS (CA-M9).
 *
 * What the Children screen shows: who this person looks after, and who they are themselves, each as a
 * person with the sides they play for and the clubs those sides belong to. Built from the session
 * context the server already proved -- `guardianRelationships` and `linkedPlayerTeams` -- so there is
 * no second read and no second idea of who the family is. A child on two teams is one child.
 *
 * WHAT IS DELIBERATELY ABSENT: a date of birth, a relationship id, a source, a provenance flag. The age
 * state is the canonical resolved state (adult / minor / unknown), never the date it came from.
 */
export type FamilyRelationshipKind = "guardian_of" | "self"

export interface FamilyRelationshipTeam {
  teamId: string
  teamName: string
  clubId: string
  clubName: string
}

export interface FamilyRelationship {
  playerId: string
  firstName: string
  fullName: string
  initials: string
  avatarStoragePath: string | null
  relationship: FamilyRelationshipKind
  /** "Parent / Guardian of" or "You" -- the words a person would use. */
  relationshipLabel: string
  ageState: PlayerAgeState
  /** "Adult", "Under 18", or "Age not recorded" -- never a date. */
  ageLabel: string
  teams: FamilyRelationshipTeam[]
}

export function ageLabelFor(state: PlayerAgeState): string {
  switch (state) {
    case "adult":
      return "Adult"
    case "minor":
    case "unknown_youth_protected":
      return "Under 18"
    default:
      return "Age not recorded"
  }
}

/** A child the session proves the person looks after but who has no active side yet. */
export interface UnplacedChild {
  playerId: string
  firstName: string
  surname: string
  avatarStoragePath: string | null
  ageState: PlayerAgeState
}

export function describeFamily(
  ctx: Pick<SessionContext, "guardianRelationships" | "linkedPlayerTeams" | "firstName">,
  unplaced: UnplacedChild[] = []
): FamilyRelationship[] {
  const rows = new Map<string, FamilyRelationship>()
  const order: string[] = []

  for (const g of ctx.guardianRelationships) {
    let row = rows.get(g.playerId)
    if (!row) {
      row = {
        playerId: g.playerId,
        firstName: g.playerFirstName,
        fullName: `${g.playerFirstName} ${g.playerSurname}`.trim(),
        initials: `${g.playerFirstName[0] ?? ""}${g.playerSurname[0] ?? ""}`.toUpperCase() || "?",
        avatarStoragePath: g.avatarStoragePath,
        relationship: "guardian_of",
        relationshipLabel: "Parent / Guardian of",
        ageState: g.ageState,
        ageLabel: ageLabelFor(g.ageState),
        teams: [],
      }
      rows.set(g.playerId, row)
      order.push(g.playerId)
    }
    if (g.teamId && !row.teams.some((t) => t.teamId === g.teamId)) {
      row.teams.push({ teamId: g.teamId, teamName: g.teamDisplayName, clubId: g.clubId, clubName: g.clubName })
    }
  }

  // A CHILD WITHOUT A SIDE IS STILL A CHILD. The session's relationship list is (child × active team),
  // so a child awaiting a team from the club would otherwise vanish from their own family's screen.
  for (const c of unplaced) {
    if (rows.has(c.playerId)) continue
    rows.set(c.playerId, {
      playerId: c.playerId,
      firstName: c.firstName,
      fullName: `${c.firstName} ${c.surname}`.trim(),
      initials: `${c.firstName[0] ?? ""}${c.surname[0] ?? ""}`.toUpperCase() || "?",
      avatarStoragePath: c.avatarStoragePath,
      relationship: "guardian_of",
      relationshipLabel: "Parent / Guardian of",
      ageState: c.ageState,
      ageLabel: ageLabelFor(c.ageState),
      teams: [],
    })
    order.push(c.playerId)
  }

  for (const t of ctx.linkedPlayerTeams) {
    let row = rows.get(t.playerId)
    if (!row) {
      const first = ctx.firstName ?? "You"
      row = {
        playerId: t.playerId,
        firstName: first,
        fullName: first,
        initials: (first[0] ?? "?").toUpperCase(),
        avatarStoragePath: t.avatarStoragePath,
        relationship: "self",
        relationshipLabel: "You",
        ageState: t.ageState,
        ageLabel: ageLabelFor(t.ageState),
        teams: [],
      }
      rows.set(t.playerId, row)
      order.push(t.playerId)
    }
    if (t.teamId && !row.teams.some((x) => x.teamId === t.teamId)) {
      row.teams.push({ teamId: t.teamId, teamName: t.teamDisplayName, clubId: t.clubId, clubName: t.clubName })
    }
  }

  // Children first, by first name; the person themselves last.
  return order
    .map((id) => rows.get(id)!)
    .sort((a, b) => (a.relationship === b.relationship ? a.firstName.localeCompare(b.firstName) : a.relationship === "self" ? 1 : -1))
}

/** The distinct clubs a family reaches, for provenance labels. */
export function familyClubs(rows: FamilyRelationship[]): { clubId: string; clubName: string }[] {
  const seen = new Map<string, string>()
  for (const row of rows) for (const t of row.teams) if (!seen.has(t.clubId)) seen.set(t.clubId, t.clubName)
  return [...seen].map(([clubId, clubName]) => ({ clubId, clubName }))
}
