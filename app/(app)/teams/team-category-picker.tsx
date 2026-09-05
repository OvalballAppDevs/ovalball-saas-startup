"use client"

import Link from "next/link"
import { ArchiveRestore } from "lucide-react"

import { ADDITIONAL_SQUAD_LETTERS, resolveStructuredFields, type TeamCategoryGroup, type TeamOptionAvailability } from "@/lib/teams/catalog"
import { compactTeamLabel } from "@/lib/teams/compact-label"
import { cn } from "@/lib/utils"

/**
 * The one picker for "which team is this" -- reused by Add Team and Edit
 * Team. A club admin never types a name: they pick a category from the
 * same canonical list signup's claim step shows, then B/C only if this is
 * a genuine second/third team at that level. The resulting display name is
 * always computed (previewed here, enforced again server-side and by the
 * teams_set_display_name_trigger), never entered.
 *
 * Duplicate-aware (section 6 of the closed-catalogue brief): an identity
 * the club already has ACTIVE is shown disabled with "Already added", never
 * offered again. One it has INACTIVE (folded) is never re-creatable --
 * it links straight to Reactivate on that team's own page instead. A B/C
 * squad stays disabled until its own primary is active, so the structure
 * can never go primary-missing-with-a-squad-present.
 */
export function TeamCategoryPicker({
  groups,
  categoryLabel,
  squadLetter,
  onChange,
  availability,
}: {
  /** The live catalogue (from `loadTeamCategoryGroups`), fetched once by the nearest server page and threaded down -- never imported as a static constant, so a Site-Admin-added global type appears here with zero further code changes. */
  groups: TeamCategoryGroup[]
  categoryLabel: string | null
  squadLetter: string | null
  onChange: (categoryLabel: string | null, squadLetter: string | null) => void
  /** Omit entirely to render every catalogue option as freely pickable (used by Edit Team, which is re-categorizing one already-owned row, not adding a new one). */
  availability?: TeamOptionAvailability[]
}) {
  const selectedOption = categoryLabel ? groups.flatMap((g) => g.options).find((o) => o.label === categoryLabel) : null
  const preview = selectedOption ? compactTeamLabel(resolveStructuredFields(selectedOption, squadLetter)) : null
  const availabilityByKey = new Map((availability ?? []).map((a) => [a.option.key, a]))

  return (
    <div>
      <p className="text-sm font-medium text-ink/80">Which team is this?</p>
      <div className="mt-2 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-medium tracking-[0.06em] text-ink/40 uppercase">{group.label}</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.options.map((option) => {
                const checked = option.label === categoryLabel
                const avail = availabilityByKey.get(option.key)
                const primaryState = avail?.primary.state ?? "addable"

                if (primaryState === "active") {
                  // The primary itself can never be re-added, but a second
                  // or third squad at this level might still be missing --
                  // offer those directly (never gated behind selecting an
                  // already-disabled primary radio, which would make them
                  // permanently unreachable from this screen).
                  const addableLetters = option.allowAdditionalSquads
                    ? ADDITIONAL_SQUAD_LETTERS.filter((l) => (avail?.additionalSquads[l]?.state ?? "addable") === "addable")
                    : []
                  const inactiveLetters = option.allowAdditionalSquads
                    ? ADDITIONAL_SQUAD_LETTERS.filter((l) => avail?.additionalSquads[l]?.state === "inactive")
                    : []
                  return (
                    <div key={option.label} className="rounded-lg border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink/40">{option.label}</span>
                        <span className="shrink-0 text-xs font-medium text-ink/35">Already added</span>
                      </div>
                      {(addableLetters.length > 0 || inactiveLetters.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-ink/45">Second or third team at this level?</span>
                          {addableLetters.map((letter) => {
                            const active = categoryLabel === option.label && squadLetter === letter
                            return (
                              <button
                                key={letter}
                                type="button"
                                onClick={() => onChange(option.label, letter)}
                                className={cn(
                                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                                  active ? "border-forest-900 bg-forest-900 text-white" : "border-ink/15 text-ink/55 hover:border-pitch-600 hover:text-ink"
                                )}
                              >
                                Add {option.label} {letter}
                              </button>
                            )
                          })}
                          {inactiveLetters.map((letter) => {
                            const row = avail?.additionalSquads[letter]
                            const teamId = row?.state === "inactive" ? row.teamId : null
                            return (
                              <Link
                                key={letter}
                                href={teamId ? `/teams/${teamId}` : "#"}
                                className="rounded-full border border-dashed border-ink/15 px-2.5 py-0.5 text-xs font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
                              >
                                Reactivate {option.label} {letter}
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }
                if (primaryState === "inactive" && avail?.primary.state === "inactive") {
                  return (
                    <div key={option.label} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-ink/15 px-3.5 py-2.5">
                      <span className="text-sm text-ink/50">{option.label}</span>
                      <Link
                        href={`/teams/${avail.primary.teamId}`}
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
                      >
                        <ArchiveRestore className="size-3" />
                        Reactivate
                      </Link>
                    </div>
                  )
                }

                return (
                  <div
                    key={option.label}
                    className={cn("rounded-lg border px-3.5 py-2.5 transition-colors", checked ? "border-pitch-600 bg-mint-100/30" : "border-ink/12")}
                  >
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="radio"
                        name="team-category"
                        checked={checked}
                        onChange={() => onChange(option.label, null)}
                        className="size-4 shrink-0 accent-pitch-600"
                      />
                      <span className={checked ? "font-medium text-ink" : "text-ink/70"}>{option.label}</span>
                    </label>
                    {checked && option.allowAdditionalSquads && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
                        <span className="text-xs text-ink/45">Second or third team at this level?</span>
                        {ADDITIONAL_SQUAD_LETTERS.map((letter) => {
                          const squadState = avail?.additionalSquads[letter]?.state ?? "addable"
                          if (squadState === "active") {
                            return (
                              <span key={letter} className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-xs font-medium text-ink/35">
                                {option.label} {letter} · Added
                              </span>
                            )
                          }
                          if (squadState === "inactive") {
                            const teamId = avail?.additionalSquads[letter]?.state === "inactive" ? avail.additionalSquads[letter].teamId : null
                            return (
                              <Link
                                key={letter}
                                href={teamId ? `/teams/${teamId}` : "#"}
                                className="rounded-full border border-dashed border-ink/15 px-2.5 py-0.5 text-xs font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
                              >
                                Reactivate {option.label} {letter}
                              </Link>
                            )
                          }
                          const active = squadLetter === letter
                          const blocked = squadState === "blocked_primary_inactive"
                          return (
                            <button
                              key={letter}
                              type="button"
                              disabled={blocked}
                              title={blocked ? `Reactivate ${option.label} before adding a ${letter} squad.` : undefined}
                              onClick={() => onChange(option.label, active ? null : letter)}
                              className={cn(
                                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                                active
                                  ? "border-forest-900 bg-forest-900 text-white"
                                  : "border-ink/15 text-ink/55 hover:border-pitch-600 hover:text-ink"
                              )}
                            >
                              {option.label} {letter}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <p className="mt-2 text-sm text-ink/55">
          This team will be shown as <span className="font-medium text-ink">{preview}</span>.
        </p>
      )}
    </div>
  )
}
