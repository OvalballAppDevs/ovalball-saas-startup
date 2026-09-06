import type { BetaBadgeState } from "@/lib/platform/mode"

/**
 * The single Beta indicator for the whole product.
 *
 * Mounted in exactly two places — the shared public header and the shared
 * authenticated shell — so every surface (public site, Site Admin, Club
 * Admin, Team Admin, Parent, Player) shows the same badge from the same
 * canonical resolver. It is never added page by page, and there is no
 * client-owned Beta boolean behind it: `state` is always resolved
 * server-side by `getBetaBadgeState`.
 *
 * Purple, at the owner's request, and deliberately not a colour the rest of
 * the product uses: forest and pitch mean "Ovalball", amber means "this
 * needs attention", and Beta is neither. It is a state of the platform, so
 * it gets a colour of its own.
 *
 * Not colour-only. The word BETA carries the meaning, the colour is a
 * second signal, and the accessible name spells the whole thing out for a
 * screen reader rather than leaving it as four shouted letters.
 */
export function BetaBadge({
  state,
  tone = "light",
}: {
  state: BetaBadgeState
  /** `dark` for placement over the forest-950 public header. */
  tone?: "light" | "dark"
}) {
  // The badge exists only while Ovalball is actually in Beta. Nothing to
  // hide with CSS, nothing to get out of step: in Live it does not render.
  if (state.mode !== "beta") return null

  const label = state.releaseVersion ? `BETA ${state.releaseVersion}` : "BETA"

  const accessibleName = state.releaseVersion
    ? `Ovalball is in Beta, version ${state.releaseVersion}. Clubs are not being charged.`
    : "Ovalball is in Beta. Clubs are not being charged."

  return (
    <span
      className={
        tone === "dark"
          ? "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-purple-300/40 bg-purple-400/15 px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-purple-100"
          : "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-purple-300 bg-purple-100 px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-purple-900"
      }
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${tone === "dark" ? "bg-purple-300" : "bg-purple-500"}`}
      />
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{accessibleName}</span>
    </span>
  )
}
