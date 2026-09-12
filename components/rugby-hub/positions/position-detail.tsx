import Link from "next/link"

import type { PositionExplorerBundle, PositionSummary } from "@/lib/app-context/position-explorer-types"
import { relatedPositionsOf } from "@/lib/app-context/position-explorer-types"
import { AgeStageBanner } from "./age-stage-banner"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink/85">{children}</p>
    </div>
  )
}

/**
 * Position detail: only renders the sections this specific position's data
 * actually supports (section 8) -- no empty headings. "What makes a good
 * X" is DEVELOPMENT_PRIORITIES + STRONG_PERFORMANCE_LOOKS_LIKE, framed
 * around awareness/decisions/technique/work-rate, never a physical-trait
 * claim (the migration content itself was written to that brief).
 */
export function PositionDetail({ bundle, position }: { bundle: PositionExplorerBundle; position: PositionSummary }) {
  const skills = bundle.skillsByPosition.get(position.id) ?? []
  const related = relatedPositionsOf(bundle, position)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-display-l text-ink">{position.displayName}</h2>
          {position.shirtNumber && <span className="font-display text-2xl text-ink-muted">#{position.shirtNumber}</span>}
        </div>
        <p className="mt-1 text-sm text-ink/60">{position.positionFamily.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>
      </div>

      <AgeStageBanner stage={position.ageStage} note={position.ageStageNote} />

      <Section heading="What this position does">{position.purpose}</Section>

      {(position.roleWithBall || position.roleWithoutBall) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {position.roleWithBall && <Section heading="With the ball">{position.roleWithBall}</Section>}
          {position.roleWithoutBall && <Section heading="Without the ball">{position.roleWithoutBall}</Section>}
        </div>
      )}

      {(position.attackResponsibilities || position.defenceResponsibilities) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {position.attackResponsibilities && <Section heading="In attack">{position.attackResponsibilities}</Section>}
          {position.defenceResponsibilities && <Section heading="In defence">{position.defenceResponsibilities}</Section>}
        </div>
      )}

      {position.setPieceResponsibilities && <Section heading="Set piece">{position.setPieceResponsibilities}</Section>}

      {skills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Key skills for this position</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {skills.map((s) => (
              <li key={s.skillId}>
                <Link
                  href={`/rugby-hub/skills/${s.skillKey}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  title={s.summary}
                >
                  {s.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {position.decisionMaking && <Section heading="Decision making">{position.decisionMaking}</Section>}
      {position.communication && <Section heading="Communication">{position.communication}</Section>}

      {(position.developmentPriorities || position.strongPerformanceLooksLike) && (
        <div className="rounded-xl border border-ink/10 bg-mint-100/50 p-4">
          <h3 className="font-display text-lg text-forest-900">What makes a good {position.displayName.toLowerCase()}?</h3>
          <div className="mt-3 flex flex-col gap-3">
            {position.developmentPriorities && <Section heading="Development priorities">{position.developmentPriorities}</Section>}
            {position.strongPerformanceLooksLike && <Section heading="What strong performance looks like">{position.strongPerformanceLooksLike}</Section>}
          </div>
        </div>
      )}

      {position.commonMistakes && <Section heading="Common mistakes">{position.commonMistakes}</Section>}

      {related.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related positions</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/rugby-hub/positions/${r.rugbyCode}/${r.positionKey}`}
                  scroll={false}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {r.shirtNumber && <span className="text-ink-muted">#{r.shirtNumber}</span>}
                  {r.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">
        Ovalball educational guidance — general coaching convention, not law or regulation.
      </p>
    </div>
  )
}
