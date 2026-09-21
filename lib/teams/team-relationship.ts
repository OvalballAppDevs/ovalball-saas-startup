/**
 * The viewer's own relationships to one team.
 *
 * A thin shape over `public.my_team_relationship`, which is where the rule
 * lives. Kept as its own module so the badges component and the page agree
 * about the contract without either importing the other's internals.
 */
export interface TeamRelationship {
  /** The canonical role key, or PLAYER / GUARDIAN for the two relationships that are not roles. */
  relationship: string
  /** The catalogue's own wording -- never invented here. */
  label: string
  /** The child a Parent/Guardian badge is about, or this person's own player record. */
  subjectPlayerId: string | null
  subjectName: string | null
}

/** True where the viewer is being ASKED about rugby rather than administering it. */
export function isFamilyRelationship(r: TeamRelationship): boolean {
  return r.relationship === "GUARDIAN" || r.relationship === "PLAYER"
}

/**
 * The players this viewer may legitimately be asked to answer for, at this
 * team. Their own player record, plus every child they are guardian of --
 * deduplicated, because a person could conceivably be both.
 *
 * The SERVER still decides whether each answer is allowed; this only decides
 * whose rows to show an answer control beside.
 */
export function answerablePlayerIds(relationships: TeamRelationship[]): string[] {
  return [...new Set(relationships.filter(isFamilyRelationship).map((r) => r.subjectPlayerId).filter((id): id is string => Boolean(id)))]
}
