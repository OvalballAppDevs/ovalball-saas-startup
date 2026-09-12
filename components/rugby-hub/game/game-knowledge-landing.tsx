"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronRight } from "lucide-react"

import type { GameConcept, GameKnowledgeBundle } from "@/lib/app-context/game-knowledge-types"
import { CONCEPT_FAMILY_LABEL, conceptRugbyCodeLabel, groupConceptsByFamily, journeySteps } from "@/lib/app-context/game-knowledge-types"
import { cn } from "@/lib/utils"

/**
 * The Game Knowledge landing: a genuine beginner journey first (never a
 * card wall), then every concept explorable directly underneath, grouped
 * by its real concept_family. A journey step shared by both codes (e.g.
 * "what happens after a tackle") shows whichever variant matches the
 * active code toggle -- never both stacked, never merged into one
 * flattened explanation.
 */
export function GameKnowledgeLanding({ bundle, defaultCode }: { bundle: GameKnowledgeBundle; defaultCode: "union" | "league" }) {
  const [code, setCode] = useState<"union" | "league">(defaultCode)
  const steps = journeySteps(bundle)
  const families = groupConceptsByFamily(bundle.concepts)

  function stepConcept(concepts: GameConcept[]): GameConcept {
    if (concepts.length === 1) return concepts[0]
    return concepts.find((c) => c.rugbyCode === code) ?? concepts[0]
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-ink">The Beginner Journey</h2>
          <div role="group" aria-label="Rugby code" className="inline-flex rounded-full border border-ink/15 bg-white p-0.5">
            {(["union", "league"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={code === c}
                onClick={() => setCode(c)}
                className={cn(
                  "min-h-9 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                  code === c ? "bg-ink text-chalk" : "text-ink/60 hover:text-ink/90"
                )}
              >
                {c === "union" ? "Rugby Union" : "Rugby League"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-sm text-ink/60">Twelve steps, in order, from what the game is trying to do through to reading a full sequence of play.</p>

        <ol className="mt-4 flex flex-col gap-2">
          {steps.map(({ order, concepts }, i) => {
            const concept = stepConcept(concepts)
            const codeLabel = conceptRugbyCodeLabel(concept.rugbyCode)
            return (
              <li key={order}>
                <Link
                  href={`/rugby-hub/game/${concept.contentKey}`}
                  className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-forest-800">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink">{concept.title}</span>
                      {codeLabel && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{codeLabel}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-sm text-ink/60">{concept.summary}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink/30" />
                </Link>
              </li>
            )
          })}
        </ol>
      </div>

      <div>
        <h2 className="font-display text-2xl text-ink">Explore Any Concept</h2>
        <p className="mt-2 text-sm text-ink/60">Already know your way around? Jump straight to any concept, in any order.</p>
        <div className="mt-4 flex flex-col gap-8">
          {families.map((group) => (
            <div key={group.family}>
              <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{CONCEPT_FAMILY_LABEL[group.family] ?? group.family}</h3>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.concepts.map((c) => {
                  const codeLabel = conceptRugbyCodeLabel(c.rugbyCode)
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/rugby-hub/game/${c.contentKey}`}
                        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">{c.title}</span>
                          {codeLabel && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{codeLabel}</span>}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{c.summary}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
