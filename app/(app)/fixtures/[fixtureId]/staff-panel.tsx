"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Clock, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { setFixtureMeetTime } from "./meet-time-actions"

/**
 * The staff area of the Match Centre.
 *
 * Phase 3A deliberately ships ONE action here -- the meet time -- and no
 * communications. Attendance reminders and messaging are Phase 3B and want
 * a real recipient model behind them; a button that looks like it emails a
 * squad and does not is worse than no button, and one that emails a squad
 * without a canonical recipient policy is worse still.
 *
 * The section only renders for a viewer the server has already told us holds
 * fixture-management capability, and the action re-checks that capability in
 * the database regardless.
 */
export function StaffPanel({ fixtureId, meetTime, kickoffTime }: { fixtureId: string; meetTime: string | null; kickoffTime: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(meetTime ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(next: string | null) {
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await setFixtureMeetTime(fixtureId, next)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <section aria-labelledby="mc-staff-heading" className="rounded-lg border border-ink/10 bg-white px-5 py-4">
      <h2 id="mc-staff-heading" className="flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        <Wrench className="size-3.5" aria-hidden="true" />
        Fixture admin
      </h2>

      <div className="mt-3">
        <Label htmlFor="meet-time">Meet time</Label>
        <p className="mt-1 text-sm text-ink-muted">
          {kickoffTime
            ? "When players should arrive. Everyone sees this alongside kick-off."
            : "Set a kick-off time first — a meet time needs something to be early for."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            id="meet-time"
            type="time"
            value={value}
            disabled={!kickoffTime || busy}
            max={kickoffTime ?? undefined}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            className="w-36"
          />
          <Button type="button" className="h-9" disabled={busy || !kickoffTime} onClick={() => void save(value || null)}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {meetTime && (
            <Button
              type="button"
              variant="ghost"
              className="h-9"
              disabled={busy}
              onClick={() => {
                setValue("")
                void save(null)
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
        {saved && !error && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-forest-800">
            <Clock className="size-3.5" aria-hidden="true" />
            Meet time saved.
          </p>
        )}
      </div>
    </section>
  )
}
