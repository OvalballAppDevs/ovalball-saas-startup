"use client"

import Link from "next/link"

/**
 * WHAT THIS PAGE IS DECIDING ABOUT.
 *
 * A permission is only half a decision without its scope: "Amina may add fixtures" means something
 * very different for the club than it does for Under 12 Boys. The screen used to decide one of those
 * and say nothing about the other, so a Club Admin who wanted to let one coach run one team's matches
 * had to make them fixture staff for every side at the club.
 *
 * SCOPE IS IN THE URL, not in component state. It survives the reload a permission change causes, it
 * can be linked to from the team's own product, and the server reads it -- so what the page shows and
 * what the write targets are the same value rather than two that agree most of the time.
 */
export function ScopeSwitcher({
  teams,
  activeTeamId,
  clubName,
}: {
  teams: { id: string; name: string }[]
  activeTeamId: string | null
  clubName: string
}) {
  if (teams.length === 0) return null

  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
      active
        ? "bg-forest-800 text-white"
        : "border border-ink/15 bg-white text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
    }`

  return (
    <div className="mt-5 rounded-lg border border-ink/10 bg-ink/[0.02] px-3.5 py-3">
      <p className="text-xs font-medium text-ink">Deciding for</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link href="/club/permissions" aria-current={activeTeamId === null ? "page" : undefined} className={chip(activeTeamId === null)}>
          All of {clubName}
        </Link>
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/club/permissions?team=${team.id}`}
            aria-current={activeTeamId === team.id ? "page" : undefined}
            className={chip(activeTeamId === team.id)}
          >
            {team.name}
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-subtle">
        A club decision applies everywhere at {clubName}. A team decision applies to that team only.
      </p>
    </div>
  )
}
