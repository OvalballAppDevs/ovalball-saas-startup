"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Info } from "lucide-react"

import { Label } from "@/components/ui/label"

import { saveSchedulingPolicy, type SchedulingPolicySettings } from "./actions"

const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

function equal(a: SchedulingPolicySettings, b: SchedulingPolicySettings) {
  return a.autoAllocateHomeFixtures === b.autoAllocateHomeFixtures && a.warmUpMinutes === b.warmUpMinutes && a.packUpMinutes === b.packUpMinutes
}

/**
 * ONE consolidated Save/Discard for the whole settings section -- not a
 * separate save per field -- matching this app's existing settings-form
 * pattern (club-profile-form.tsx). Save is disabled until something
 * actually differs from what's saved, and Discard resets the form back
 * to that saved state rather than leaving a half-edited form behind.
 */
export function PitchAllocationSettingsForm({
  clubId,
  initial,
  bufferSource,
}: {
  clubId: string
  initial: SchedulingPolicySettings
  /** Whether the warm-up/pack-up shown are this club's own, or inherited from the platform default. */
  bufferSource: "club" | "platform"
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(initial)
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const dirty = !equal(form, saved)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await saveSchedulingPolicy(clubId, form)
    if (result.ok) {
      setSaved(form)
      setStatus("saved")
      // WHERE THE VALUE CAME FROM IS SERVER TRUTH, and saving changes it: a
      // club that was inheriting has just set its own times. Without this
      // refresh the chip above went on saying "Using the Ovalball default"
      // over numbers the club had just chosen, until the page was reloaded
      // by hand. revalidatePath alone does not re-render a client component
      // that is already mounted.
      router.refresh()
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  function handleDiscard() {
    setForm(saved)
    setStatus("idle")
    setError(null)
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Automatically allocate home fixtures</p>
            <p className="mt-1 text-xs text-ink-muted">
              When a Club Admin or Fixture Secretary opens Pitch Allocation for a day with unallocated home fixtures, a proposal is generated
              automatically for review. This never applies changes by itself, and never overwrites a fixture already allocated manually.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.autoAllocateHomeFixtures}
            aria-label="Automatically allocate home fixtures"
            onClick={() => setForm((f) => ({ ...f, autoAllocateHomeFixtures: !f.autoAllocateHomeFixtures }))}
            className={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              form.autoAllocateHomeFixtures ? "bg-pitch-600" : "bg-ink/15"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                form.autoAllocateHomeFixtures ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Allocation buffers</p>
        <p className="mt-1 text-xs text-ink-muted">
          Time reserved on the pitch around each fixture&rsquo;s kick-off, separate from the turnaround gap between different fixtures on the same
          pitch. Shown on the board as orange bands either side of the fixture.
        </p>
        {/* WHY THIS NUMBER IS IN EFFECT. An administrator seeing "15 minutes"
            should never have to wonder whether their club chose it or whether
            it is simply what everyone gets. Saving turns the inherited value
            into this club's own. */}
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink-muted">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          {bufferSource === "club"
            ? "These are your club's own times. Saving new values updates them."
            : "Using the Ovalball default. Saving here sets your club's own times instead."}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="warm-up" className="text-ink/80">
              Warm-Up Time
            </Label>
            <select
              id="warm-up"
              value={form.warmUpMinutes}
              onChange={(e) => setForm((f) => ({ ...f, warmUpMinutes: Number(e.target.value) }))}
              className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
            >
              {BUFFER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "None" : `${m} minutes`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pack-up" className="text-ink/80">
              Pack-Up Time
            </Label>
            <select
              id="pack-up"
              value={form.packUpMinutes}
              onChange={(e) => setForm((f) => ({ ...f, packUpMinutes: Number(e.target.value) }))}
              className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
            >
              {BUFFER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "None" : `${m} minutes`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={!dirty || status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save Changes"}
        </Button>
        {dirty && status !== "saving" && (
          <Button type="button" variant="ghost" className="h-10" onClick={handleDiscard}>
            Discard
          </Button>
        )}
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </div>
  )
}
