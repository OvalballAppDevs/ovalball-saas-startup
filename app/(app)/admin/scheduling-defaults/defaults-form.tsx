"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import { savePlatformSchedulingDefaults } from "./actions"

/** The same 0-60 in 5-minute steps a club's own form offers, and the database enforces. */
const BUFFER_OPTIONS = Array.from({ length: 13 }, (_, i) => i * 5)

/**
 * PITCH ALLOCATION DEFAULTS, for the whole platform.
 *
 * Deliberately the same control, the same options and the same wording as a
 * club's own Pitch Allocation settings, because it is the same decision made
 * one level up. An administrator who has seen one should recognise the other.
 *
 * WHAT IT DOES NOT DO. It does not reach into any club. Setting 20 here does
 * not write 20 to a single club row -- it changes what clubs INHERIT, and a
 * club that has set its own times keeps them. That distinction is the whole
 * point of the hierarchy, so the page says it in words rather than leaving an
 * administrator to discover it by changing something.
 */
export function PlatformSchedulingDefaultsForm({
  initial,
  canEdit,
}: {
  initial: { warmUpMinutes: number; packUpMinutes: number }
  /** Full Site Admin only. The database refuses regardless; this decides whether to offer the controls at all. */
  canEdit: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(initial)
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const dirty = form.warmUpMinutes !== saved.warmUpMinutes || form.packUpMinutes !== saved.packUpMinutes

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await savePlatformSchedulingDefaults(form.warmUpMinutes, form.packUpMinutes)
    if (!result.ok) {
      setError(result.error)
      setStatus("error")
      return
    }
    setSaved(form)
    setStatus("saved")
    // Keeps the server-rendered page in step with what was just written, so
    // a client-side return to this route shows the new default rather than
    // the one that was in effect when the page was first rendered.
    router.refresh()
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      {/* No repeated heading: the page title already names this, and a card
          that restates its own page reads as a section that is missing its
          siblings. The card says what the numbers DO instead. */}
      <p className="max-w-xl text-sm text-ink-muted">
        Time reserved on the pitch either side of a fixture, so the board shows how long a pitch is really in use rather than just the match.
      </p>

      <p className="mt-3 inline-flex max-w-xl items-start gap-1.5 rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        These defaults apply to clubs that have not set their own Pitch Allocation times. A club that has set its own keeps them.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="platform-warm-up" className="text-ink/80">
            Warm-Up
          </Label>
          <select
            id="platform-warm-up"
            value={form.warmUpMinutes}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, warmUpMinutes: Number(e.target.value) }))}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600 disabled:bg-ink/5 disabled:text-ink-muted"
          >
            {BUFFER_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "None" : `${m} minutes`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="platform-pack-up" className="text-ink/80">
            Pack-Up
          </Label>
          <select
            id="platform-pack-up"
            value={form.packUpMinutes}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, packUpMinutes: Number(e.target.value) }))}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600 disabled:bg-ink/5 disabled:text-ink-muted"
          >
            {BUFFER_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "None" : `${m} minutes`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canEdit && (
        <p className="mt-4 text-sm text-ink-muted">
          Only a Full Site Admin can change these. You can see what is currently in effect.
        </p>
      )}

      {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}

      {canEdit && (
        <div className="mt-5 flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={!dirty || status === "saving"} className="h-11 sm:h-10">
            {status === "saving" ? "Saving…" : "Save Changes"}
          </Button>
          {status === "saved" && !dirty && <p className="text-sm text-forest-800">Saved.</p>}
        </div>
      )}
    </div>
  )
}
