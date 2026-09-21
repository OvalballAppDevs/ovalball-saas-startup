import type { TeamRelationship } from "@/lib/teams/team-relationship"

/**
 * WHAT YOU ARE TO THIS TEAM.
 *
 * The first question anybody asks when a team page opens, and until Step 10 the
 * page could not answer it: it showed the team's name and then, depending on
 * capabilities, a settings form. A parent could not tell from the page that
 * they were a parent.
 *
 * ROLE IS NOT IDENTITY, so this is a LIST. A coach who is also a parent of a
 * child in the same team is the most ordinary shape in grassroots rugby, and it
 * shows as two badges rather than one invented "primary role". A guardian of
 * two children in one team gets two badges, each naming the child, because
 * "Parent/Guardian" twice would be indistinguishable.
 *
 * A BADGE IS NEVER AUTHORITY. It is read from `my_team_relationship`, which
 * returns nothing for a revoked role or a suspended membership, so a badge
 * cannot outlive the relationship it describes. Every control on the page still
 * asks the capability engine independently.
 *
 * NOT COLOUR ALONE. Each badge carries its words; the tint distinguishes staff
 * from family at a glance and carries nothing a reader would lose without it.
 */
export function TeamRelationshipBadges({ relationships }: { relationships: TeamRelationship[] }) {
  if (relationships.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="sr-only">Your relationship to this team:</span>
      {relationships.map((r) => (
        <span
          key={`${r.relationship}-${r.subjectPlayerId ?? "self"}`}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
            r.relationship === "GUARDIAN"
              ? "bg-mint-100 text-forest-900"
              : r.relationship === "PLAYER"
                ? "bg-ink/8 text-ink"
                : "bg-pitch-600/15 text-forest-900"
          }`}
        >
          {r.label}
          {/* Named, so two children in one team are two distinguishable badges. */}
          {r.subjectName && r.relationship === "GUARDIAN" && (
            <span className="ml-1 font-normal text-forest-800">· {r.subjectName}</span>
          )}
        </span>
      ))}
    </div>
  )
}
