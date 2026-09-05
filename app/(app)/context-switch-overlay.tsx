"use client"

import { useSwitchContextState } from "./switch-context-provider"

/**
 * Section 23: covers the main content area while a context switch is
 * pending, so the previous context's (possibly private/club-scoped)
 * content is never visible once the identity block has already relabelled
 * itself for the newly-selected context. Purely a presentation timing
 * fix -- RLS/has_capability() re-authorize the new page independently the
 * moment its own request lands, regardless of whether this overlay ever
 * rendered.
 */
export function ContextSwitchOverlay() {
  const { isPending } = useSwitchContextState()
  if (!isPending) return null
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-10 flex items-center justify-center bg-chalk/80 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-2.5 rounded-lg border border-ink/10 bg-white px-4 py-2.5 shadow-sm">
        <span className="size-3.5 animate-spin rounded-full border-2 border-forest-800/25 border-t-forest-800" />
        <span className="text-sm font-medium text-ink/70">Switching context&hellip;</span>
      </div>
    </div>
  )
}
