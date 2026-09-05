"use client"

import { useState, useTransition } from "react"
import { ChevronDown } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { cancelFixture, updateFixtureStatus } from "../actions"

// The subset of ALL_FIXTURE_STATUSES (lib/fixtures/status.ts) settable
// directly here -- matches admin/fixtures/actions.ts's own
// DIRECT_STATUS_TRANSITIONS exactly (a deliberate business-rule subset,
// not a display omission). Colours come from the shared
// FIXTURE_STATUS_BADGE_CLASS map so this control never drifts from any
// other status pill in the app again.
const DIRECT_OPTIONS = ["Planned", "Booked", "To Be Determined", "Completed"] as const

/**
 * A real operational control, not a static badge -- offers only the
 * fixture's actual STATUS_OPTIONS values (Cancelled routes to the
 * existing reason-required cancel flow rather than a bare write, so a
 * destructive transition can never skip its confirmation+reason). Built on
 * the same DropdownMenu primitive as the notification/messages popovers
 * (Base UI Menu) rather than a hand-rolled listbox -- keyboard open/close/
 * navigate, Escape-to-close, and focus-return-to-trigger all come from the
 * primitive for free, matching the brief's own "reuse existing accessible
 * menu primitive" instruction.
 */
export function FixtureStatusControl({ fixtureId, status }: { fixtureId: string; status: string }) {
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (status === "Cancelled") {
    return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.04em] uppercase", FIXTURE_STATUS_BADGE_CLASS.Cancelled)}>Cancelled</span>
  }

  function handleSelect(next: string) {
    setError(null)
    if (next === status) return
    if (next === "Cancelled") {
      setCancelling(true)
      return
    }
    startTransition(async () => {
      const result = await updateFixtureStatus(fixtureId, next)
      if (!result.ok) setError(result.error)
    })
  }

  if (cancelling) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.03] p-3 sm:items-start">
        <p className="text-xs font-medium text-destructive">Cancel this fixture</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, shown in audit history)"
          rows={2}
          className="w-full max-w-xs rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-xs outline-none focus-visible:border-pitch-600"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await cancelFixture(fixtureId, reason)
                if (result.ok) setCancelling(false)
                else setError(result.error)
              })
            }
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-destructive/90 disabled:opacity-40"
          >
            {pending ? "Cancelling…" : "Confirm cancel"}
          </button>
          <button type="button" onClick={() => setCancelling(false)} className="text-xs font-medium text-ink/50 hover:text-ink">
            Back
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={pending}
              aria-label={`Fixture status: ${status}. Change status`}
              // Visual pill stays compact; -m-2 p-2.5 extends the real hit area
              // toward a comfortable touch target without growing the badge look.
              className={cn(
                "-m-2 inline-flex items-center gap-1 rounded-full p-2.5 text-xs font-bold tracking-[0.04em] uppercase outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
              )}
            />
          }
        >
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1", FIXTURE_STATUS_BADGE_CLASS[status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/8 text-ink/50")}>
            {status}
            <ChevronDown className="size-3" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-44">
          {DIRECT_OPTIONS.map((s) => (
            <DropdownMenuItem key={s} onClick={() => handleSelect(s)} className={cn(s === status && "font-semibold")}>
              {s}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem variant="destructive" onClick={() => handleSelect("Cancelled")}>
            Cancelled
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
