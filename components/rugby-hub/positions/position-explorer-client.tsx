"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { X } from "lucide-react"

import type { AgeStage, PositionExplorerBundle } from "@/lib/app-context/position-explorer-types"
import { findPositionByKey } from "@/lib/app-context/position-explorer-types"
import { CodeSwitch } from "./code-switch"
import { PositionPitch } from "./position-pitch"
import { PositionList } from "./position-list"
import { PositionDetail } from "./position-detail"
import { AgeStageBanner } from "./age-stage-banner"

/**
 * Section 12: a younger viewer must never be greeted with an adult "pick
 * your position" picker as the FIRST thing they see. This slice seeded
 * age-stage uniformly per code+identity (see the migration), so every
 * position genuinely shares one stage for a given viewer -- when they do,
 * that's the whole code's stage, shown once, prominently, above the pitch,
 * rather than only surfacing per-position after a selection. The pitch and
 * list stay fully browsable underneath it either way ("explore what
 * positions become later"), never blocked.
 */
function resolveCodeAgeStage(bundle: PositionExplorerBundle): { stage: AgeStage; note: string | null } | null {
  if (bundle.positions.length === 0) return null
  const [first, ...rest] = bundle.positions
  if (first.ageStage === "NORMAL" || first.ageStage === "UNASSESSED") return null
  if (rest.every((p) => p.ageStage === first.ageStage)) return { stage: first.ageStage, note: first.ageStageNote }
  return null
}

export type ContextLabel = { kind: "own-context"; text: string } | { kind: "exploring" } | null

/**
 * The one Position Explorer shell, mounted once per code in
 * app/(app)/rugby-hub/positions/[code]/layout.tsx and never remounted when
 * only the selected position changes underneath it -- selecting a position
 * is a real Link navigation to a child route segment, so it's deep-linkable
 * and refresh-safe, but Next.js keeps this layout (and the bundle it
 * already fetched) mounted across that change: no full reload, no second
 * fetch. useParams() (not props from a server page) is what lets a CLIENT
 * component read the deeper [positionKey] segment a layout's own server
 * params never receive.
 */
export function PositionExplorerClient({ bundle, contextLabel }: { bundle: PositionExplorerBundle; contextLabel: ContextLabel }) {
  const params = useParams<{ code: string; positionKey?: string }>()
  const selectedKey = params.positionKey ?? null
  const selected = selectedKey ? findPositionByKey(bundle, selectedKey) : null
  const detailRef = useRef<HTMLDivElement>(null)
  const codeAgeStage = resolveCodeAgeStage(bundle)

  useEffect(() => {
    if (selected && window.matchMedia("(max-width: 768px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
    }
  }, [selected])

  return (
    <div>
      <CodeSwitch code={bundle.rugbyCode} contextLabel={contextLabel} />

      {codeAgeStage && (
        <div className="mt-6">
          <AgeStageBanner stage={codeAgeStage.stage} note={codeAgeStage.note} />
        </div>
      )}

      {bundle.positions.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-ink/15 bg-white px-4 py-8 text-center">
          <p className="text-sm text-ink/60">
            {bundle.rugbyCode === "union" ? "Rugby Union" : "Rugby League"} positions are still being added to the Explorer.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <PositionPitch code={bundle.rugbyCode} positions={bundle.positions} selectedKey={selectedKey} />
            <PositionList code={bundle.rugbyCode} positions={bundle.positions} selectedKey={selectedKey} />
          </div>

          <div ref={detailRef} className="lg:sticky lg:top-6 lg:self-start">
            {selected ? (
              <div className="rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
                <Link
                  href={`/rugby-hub/positions/${bundle.rugbyCode}`}
                  scroll={false}
                  className="mb-4 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink/60 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 lg:hidden"
                >
                  <X aria-hidden="true" className="size-4" />
                  Back to pitch
                </Link>
                <PositionDetail bundle={bundle} position={selected} />
              </div>
            ) : selectedKey ? (
              <div className="rounded-2xl border border-dashed border-ink/15 bg-white p-6 text-center">
                <p className="text-sm text-ink/60">That position link doesn&apos;t match a position Ovalball currently has published for {bundle.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}.</p>
                <Link
                  href={`/rugby-hub/positions/${bundle.rugbyCode}`}
                  scroll={false}
                  className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Back to the pitch
                </Link>
              </div>
            ) : (
              <div className="hidden rounded-2xl border border-dashed border-ink/15 bg-white p-6 text-center lg:block">
                <p className="text-sm text-ink/60">
                  {codeAgeStage?.stage === "NOT_APPLICABLE"
                    ? "Explore the pitch to see what each position becomes later on."
                    : "Select a position on the pitch, or from the list, to see what it does."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
