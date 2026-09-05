"use client"

import { useState } from "react"
import { ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { enterDiagnosticClub } from "@/app/(app)/diagnostic-actions"

/**
 * Read-only diagnostic entry point -- never impersonation. Only rendered
 * when the signed-in Site Admin has actually been granted
 * diagnostic_club_access (see Site Admin Management); enter_diagnostic_club
 * re-validates that grant and the club's active status server-side
 * regardless of what this button's visibility implies.
 */
export function EnterDiagnosticButton({ clubId }: { clubId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setPending(true)
    setError(null)
    const result = await enterDiagnosticClub(clubId)
    // A success redirects (throws) before returning -- only a failure
    // reaches this line.
    setPending(false)
    if (result && "error" in result) setError(result.error)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" disabled={pending} onClick={handleClick}>
        <ShieldAlert className="size-3.5" />
        {pending ? "Opening…" : "View as this club (diagnostic)"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
