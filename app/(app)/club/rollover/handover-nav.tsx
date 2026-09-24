import Link from "next/link"
import { HANDOVER_SECTIONS, HANDOVER_SECTION_LABELS, resolveHandoverSection, type HandoverSection } from "@ovalball/contracts/club/handover"

/**
 * The board's five sections are ROUTES, not tab widgets.
 *
 * A season handover is reviewed over days, by more than one person, and its
 * items get linked to from Needs attention and from notifications. Anything
 * built as an ARIA tablist loses that: Back goes to the previous page rather
 * than the previous section, Refresh returns to the first tab, and a copied URL
 * takes a colleague somewhere else entirely. These are links with
 * aria-current="page", which is what they actually are.
 *
 * The sections, their order and their names come from the shared contract, so
 * the phone's screens are the same five, called the same things.
 */
export { HANDOVER_SECTIONS, resolveHandoverSection, type HandoverSection }

export function HandoverNav({ active, attentionCount }: { active: HandoverSection; attentionCount: number }) {
  return (
    <nav aria-label="Season Handover sections" className="mt-6 flex flex-wrap gap-1 border-b border-ink/10">
      {HANDOVER_SECTIONS.map((section) => {
        const isActive = section === active
        return (
          <Link
            key={section}
            href={`/club/rollover?section=${section}`}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-t-md px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              isActive
                ? "-mb-px border-b-2 border-forest-800 font-medium text-forest-950"
                : "border-b-2 border-transparent text-ink-muted hover:text-ink/80"
            }`}
          >
            {HANDOVER_SECTION_LABELS[section]}
            {section === "attention" && attentionCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                {attentionCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
