import Link from "next/link"

export type ClubSettingsSection = "overview" | "profile" | "teams" | "venues" | "rollover" | "pitchAllocation" | "playerMoves" | "guardians"

const TABS: { key: ClubSettingsSection; href: string; label: string; requires: "any" | "profile" | "teams" | "venues" | "rollover" | "pitchAllocation" | "playerMoves" | "guardians" }[] = [
  { key: "overview", href: "/club/settings", label: "Overview", requires: "any" },
  { key: "profile", href: "/club", label: "Club Profile", requires: "profile" },
  { key: "teams", href: "/teams", label: "Teams", requires: "teams" },
  { key: "venues", href: "/club/venues", label: "Lookup Administration", requires: "venues" },
  { key: "rollover", href: "/club/rollover", label: "Season Rollover", requires: "rollover" },
  { key: "pitchAllocation", href: "/club/settings/pitch-allocation", label: "Pitch Allocation", requires: "pitchAllocation" },
  { key: "playerMoves", href: "/club/player-moves", label: "Player Moves", requires: "playerMoves" },
  { key: "guardians", href: "/club/settings/guardians", label: "Guardians & Players", requires: "guardians" },
]

/**
 * Shared tab strip rendered at the top of every Club Settings section
 * (/club/settings, /club, /teams, /club/venues, /club/rollover) -- Master
 * Architecture Pass "Club Admin Information Architecture" §2: once inside
 * Club Settings, move between sections without returning to unrelated
 * top-level app navigation. Season Rollover joined this pass (addendum
 * "Season Rollover still incorrect" -- it was a separate top-level nav
 * item before; it is a Club Settings section now, reusing the existing
 * /club/rollover implementation verbatim, never duplicated). Purely
 * presentational: which links render is driven by the SAME
 * context-scoped capability booleans each page already computed for its
 * own guard, never re-derived here, and every link still lands on a page
 * that reauthorizes itself server-side regardless of which tabs a
 * tampered client render shows.
 *
 * Canonical Scoped Capability Engine pass: independent booleans per
 * section, not one combined "isClubAdmin" flag -- a Site Admin deny
 * override on any one capability must hide only that one tab.
 */
export function ClubSettingsNav({
  active,
  canProfile,
  canTeams,
  canVenues,
  canRollover,
  canPitchAllocation,
  canPlayerMoves,
  canGuardians,
}: {
  active: ClubSettingsSection
  canProfile: boolean
  canTeams: boolean
  canVenues: boolean
  canRollover: boolean
  canPitchAllocation?: boolean
  canPlayerMoves?: boolean
  canGuardians?: boolean
}) {
  const visible = TABS.filter(
    (t) =>
      t.requires === "any" ||
      (t.requires === "profile" && canProfile) ||
      (t.requires === "teams" && canTeams) ||
      (t.requires === "venues" && canVenues) ||
      (t.requires === "rollover" && canRollover) ||
      (t.requires === "pitchAllocation" && Boolean(canPitchAllocation)) ||
      (t.requires === "playerMoves" && Boolean(canPlayerMoves)) ||
      (t.requires === "guardians" && Boolean(canGuardians))
  )
  if (visible.length <= 1) return null
  return (
    <nav aria-label="Club Settings sections" className="mt-6 flex flex-wrap gap-1 border-b border-ink/10">
      {visible.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
            t.key === active ? "border-forest-800 text-forest-950" : "border-transparent text-ink/50 hover:text-ink/80"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
