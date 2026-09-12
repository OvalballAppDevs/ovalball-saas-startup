import type { Certainty } from "@/lib/app-context/heritage-types"
import { CERTAINTY_LABEL } from "@/lib/app-context/heritage-types"

/**
 * The certainty vocabulary, in plain language. This is the one honesty
 * mechanism the whole heritage model rests on -- MYTH and LEGEND must never
 * read the same as ESTABLISHED, in copy, colour or weight. Colour is never
 * the only signal: the label text itself always says which one this is.
 * Labels come from the shared CERTAINTY_LABEL map (also used by Rugby Hub
 * search) so a result never disagrees with its own detail page.
 */
const CERTAINTY_DESCRIPTION: Record<Certainty, string> = {
  ESTABLISHED: "Strong historical evidence",
  WELL_DOCUMENTED: "Solid evidence, detail varies between accounts",
  CONTESTED: "Historians disagree",
  LEGEND: "Part of rugby tradition, not established historical fact",
  MYTH: "Widely repeated, but the evidence doesn't support it",
}
const CERTAINTY_COPY: Record<Certainty, { label: string; description: string }> = Object.fromEntries(
  (Object.keys(CERTAINTY_LABEL) as Certainty[]).map((c) => [c, { label: CERTAINTY_LABEL[c], description: CERTAINTY_DESCRIPTION[c] }])
) as Record<Certainty, { label: string; description: string }>

export function CertaintyBadge({ certainty, size = "sm" }: { certainty: Certainty; size?: "sm" | "md" }) {
  const copy = CERTAINTY_COPY[certainty]
  const isQuestionable = certainty === "CONTESTED" || certainty === "LEGEND" || certainty === "MYTH"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${isQuestionable ? "border-amber-600/40 bg-amber-50 text-amber-900" : "border-ink/15 bg-white text-ink/70"}`}
      title={copy.description}
    >
      {isQuestionable && (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 shrink-0 fill-current">
          <path d="M8 1.5 15 14.5H1L8 1.5Z" fillOpacity="0" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="8" cy="11.3" r="0.9" />
          <rect x="7.4" y="6" width="1.2" height="3.6" rx="0.6" />
        </svg>
      )}
      {copy.label}
    </span>
  )
}

/** The longer-form explanation, used on the detail page beside the badge. Never invents a description when the source data has none -- CONTESTED/LEGEND/MYTH always carry a real certainty_note from the data; this is only the fallback plain-language gloss for the classification itself. */
export function CertaintyDescription({ certainty }: { certainty: Certainty }) {
  return <span className="text-ink/60">{CERTAINTY_COPY[certainty].description}</span>
}
