import Link from "next/link"

import type { OfficiatingBundle } from "@/lib/app-context/officiating-types"
import { OFFICIATING_FAMILY_LABEL, groupConceptsByFamily, officiatingRugbyCodeLabel } from "@/lib/app-context/officiating-types"

/**
 * The Officiating landing: one coherent domain, six labelled families --
 * never seven disconnected mini-products. This is a reference/lookup
 * domain rather than a linear journey (mirrors Skills Explorer's own
 * family-grouped shape, not Game Knowledge's beginner-journey shape).
 * RESPECT_AND_BEHAVIOUR is rendered with the same visual weight as every
 * other family -- never buried below a footer link -- per the explicit
 * requirement that Respect the Referee stay easy to discover.
 */
export function OfficiatingLanding({ bundle }: { bundle: OfficiatingBundle }) {
  const families = groupConceptsByFamily(bundle.concepts)

  return (
    <div className="flex flex-col gap-8">
      {families.map((group) => (
        <div key={group.family}>
          <h2 className="font-display text-2xl text-ink">{OFFICIATING_FAMILY_LABEL[group.family] ?? group.family}</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.concepts.map((c) => {
              const codeLabel = officiatingRugbyCodeLabel(c.rugbyCode)
              return (
                <li key={c.id}>
                  <Link
                    href={`/rugby-hub/officiating/${c.contentKey}`}
                    className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
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
  )
}
