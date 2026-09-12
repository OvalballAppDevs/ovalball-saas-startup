import Link from "next/link"

import type { SkillSummary } from "@/lib/app-context/skills-explorer-types"
import { groupSkillsByFamily, SKILL_FAMILY_LABEL, skillRugbyCodeLabel } from "@/lib/app-context/skills-explorer-types"

/**
 * The Skills Explorer landing: grouped by the real skill_family -- never a
 * 50-card grid, never an invented taxonomy. Most families hold 1-2 skills;
 * the grouping still earns its place because it's the same real category a
 * coach would use. SET_PIECE now holds two genuinely different skills
 * (Scrum and Lineout Technique / Play-the-Ball and Restart) -- the small
 * code badge is what keeps them from reading as accidental duplicates; it
 * comes straight off each skill's own rugbyCode and stays absent for every
 * skill that's genuinely code-universal.
 */
export function SkillsLanding({ skills }: { skills: SkillSummary[] }) {
  const groups = groupSkillsByFamily(skills)

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <div key={g.family}>
          <h2 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{SKILL_FAMILY_LABEL[g.family] ?? g.family}</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.skills.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/rugby-hub/skills/${s.skillKey}`}
                  className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-sm font-semibold text-ink">{s.displayName}</span>
                    {skillRugbyCodeLabel(s.rugbyCode) && (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">
                        {skillRugbyCodeLabel(s.rugbyCode)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{s.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
