import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { SkillsExplorerBundle, SkillSummary } from "@/lib/app-context/skills-explorer-types"
import { relatedSkillsOf, skillCitedContent, skillCoachingLinks, skillDevelopmentLinks, skillRugbyCodeLabel } from "@/lib/app-context/skills-explorer-types"
import { TechniqueSteps } from "./technique-steps"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink/85">{children}</p>
    </div>
  )
}

/**
 * Skill detail: only renders sections this specific skill's data actually
 * supports, so a thin skill renders as a short, honest page rather than an
 * empty template. Contact-gated tackling replaces the technique steps with
 * the real, sourced regulatory note instead of showing tackle technique to
 * a viewer whose age grade doesn't play contact yet -- never a hardcoded
 * age check, driven entirely by skill.contactNotYetPermitted (itself
 * resolved from live regulatory data, see skills-explorer-data.ts). The
 * code badge next to the title is skill.rugbyCode read directly off the
 * row -- never inferred from skillKey -- and stays absent for the common,
 * genuinely code-universal skill.
 */
export function SkillDetail({ bundle, skill }: { bundle: SkillsExplorerBundle; skill: SkillSummary }) {
  const positions = bundle.positionsBySkill.get(skill.id) ?? []
  const related = relatedSkillsOf(bundle, skill)
  const trainingContent = bundle.trainingContentBySkill.get(skill.id) ?? []
  // hub_skill_content_links is one link table with no type restriction, so
  // the same rows that cite a guide also carry the Player Development
  // concepts that sit above this skill. Those are a destination, not a
  // citation, so they get real links -- this is what makes Skill ->
  // Development discoverable in the browser rather than only in SQL.
  const developmentLinks = skillDevelopmentLinks(trainingContent)
  const coachingLinks = skillCoachingLinks(trainingContent)
  const citedContent = skillCitedContent(trainingContent)
  const showSteps = skill.techniqueSteps && skill.techniqueSteps.length > 0 && !skill.contactNotYetPermitted
  const codeLabel = skillRugbyCodeLabel(skill.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-display-l text-ink">{skill.displayName}</h2>
          {codeLabel && (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>
          )}
        </div>
      </div>

      <Section heading="What it is">{skill.summary}</Section>

      {skill.whyItMatters && <Section heading="Why it matters">{skill.whyItMatters}</Section>}
      {skill.whenYouUseIt && <Section heading="When you use it">{skill.whenYouUseIt}</Section>}

      {skill.contactNotYetPermitted && citedContent.length > 0 && (
        <div className="rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-4">
          <p className="text-sm font-semibold text-forest-900">Contact rugby isn&apos;t introduced at your stage yet</p>
          <p className="mt-1 text-[15px] leading-relaxed text-forest-900/85">
            Tackling is taught progressively. Full contact isn&apos;t part of the game at your age grade yet, and is introduced from Under 9 &mdash; this is the governing body&apos;s own rule, not an Ovalball estimate.
          </p>
        </div>
      )}

      {showSteps && skill.techniqueSteps && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">How to do it</h3>
          <div className="mt-3">
            <TechniqueSteps steps={skill.techniqueSteps} />
          </div>
        </div>
      )}

      {skill.keyCues && <Section heading="Key cues">{skill.keyCues}</Section>}
      {skill.commonMistakes && <Section heading="Common mistakes">{skill.commonMistakes}</Section>}
      {skill.howToImprove && <Section heading="How to improve">{skill.howToImprove}</Section>}
      {skill.gameExamples && <Section heading="Game examples">{skill.gameExamples}</Section>}

      {positions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Positions that use this skill</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {positions.map((p) => (
              <li key={p.positionId}>
                <Link
                  href={`/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`}
                  scroll={false}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {p.shirtNumber && <span className="text-ink-muted">#{p.shirtNumber}</span>}
                  {p.displayName}
                  <span className="text-xs text-ink-muted">{p.rugbyCode === "union" ? "Union" : "League"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related skills</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map(({ skill: r, relationshipType }) => (
              <li key={r.id}>
                <Link
                  href={`/rugby-hub/skills/${r.skillKey}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {r.displayName}
                  {relationshipType === "PREREQUISITE" && <span className="text-xs text-ink-muted">Learn first</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {developmentLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Develop This Further</h3>
          <p className="mt-1 text-sm text-ink/60">This skill is the technique. These explain what you are actually learning, and why it is taught this way.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {developmentLinks.map((c) => (
              <li key={c.contentKey}>
                <Link
                  href={`/rugby-hub/development/${c.contentKey}` as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coachingLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Coaching This Skill</h3>
          <p className="mt-1 text-sm text-ink/60">For coaches: how to build practice that teaches this, rather than what to practise.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {coachingLinks.map((c) => (
              <li key={c.contentKey}>
                <Link
                  href={`/rugby-hub/coaching/${c.contentKey}` as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {citedContent.length > 0 && !skill.contactNotYetPermitted && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Sources</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {citedContent.map((c) => (
              <li key={c.contentKey} className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/70">
                <p className="font-medium text-ink">{c.title}</p>
                <p className="mt-0.5">{c.summary}</p>
                {c.regulatoryFacts.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-t border-ink/10 pt-2">
                    {c.regulatoryFacts.map((f) => (
                      <li key={f.factKey} className="flex items-start gap-1.5 text-xs text-ink/60">
                        <ExternalLink aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                        <span>{f.valueText ?? "Governing-body regulation"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general coaching convention, not law or regulation.</p>
    </div>
  )
}
