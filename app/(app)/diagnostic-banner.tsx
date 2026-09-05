import { ShieldAlert } from "lucide-react"

import type { DiagnosticClub } from "@/lib/app-context/diagnostic-access"

import { exitDiagnosticClub } from "./diagnostic-actions"

/**
 * Persistent, impossible-to-miss strip while a Site Admin is viewing a
 * club they hold no real membership at -- deliberately never blends into
 * the ordinary forest-green chrome (amber, not brand color) so it can
 * never be mistaken for genuinely operating as that club. "Actions are
 * audited" is literal: every entry/exit is a row in
 * site_admin_diagnostic_sessions naming the real Site Admin actor, never
 * a fabricated club identity.
 */
export function DiagnosticBanner({ diagnosticClub }: { diagnosticClub: DiagnosticClub }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-800/30 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" />
        Site Admin diagnostic access &middot; viewing {diagnosticClub.clubName} (read-only) &middot; actions are audited
      </span>
      <form action={exitDiagnosticClub.bind(null, diagnosticClub.sessionId)}>
        <button
          type="submit"
          className="rounded-md border border-amber-950/25 bg-amber-950/10 px-3 py-1 text-sm font-medium text-amber-950 outline-none transition-colors hover:bg-amber-950/20 focus-visible:ring-2 focus-visible:ring-amber-950/50"
        >
          Exit diagnostic view
        </button>
      </form>
    </div>
  )
}
