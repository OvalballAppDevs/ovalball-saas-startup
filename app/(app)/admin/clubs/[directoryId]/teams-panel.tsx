import type { ClubTeamSummary } from "./actions"

/** Read-only roster -- Club Management inspects team structure but never creates/edits teams itself (that stays the club's own Teams page, not duplicated here). */
export function TeamsPanel({ teams }: { teams: ClubTeamSummary[] }) {
  if (teams.length === 0) {
    return <p className="text-sm text-ink/50">No teams recorded for this club yet.</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {teams.map((team) => (
        <li key={team.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white p-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{team.displayName}</p>
            <p className="text-xs text-ink/45">
              {team.rugbyCode === "union" ? "Union" : "League"} &middot; {team.category === "senior" ? "Senior" : "Youth"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!team.active && <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/45">Inactive</span>}
            <span className="text-xs text-ink/50">
              {team.memberCount} assigned member{team.memberCount === 1 ? "" : "s"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
