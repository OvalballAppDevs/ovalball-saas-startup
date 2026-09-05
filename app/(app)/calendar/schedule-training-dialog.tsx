"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { createTrainingSession } from "./actions"

export interface TrainingTargetOption {
  value: string
  label: string
  kind: "team" | "group"
}

export interface PitchOption {
  id: string
  displayName: string
}

/** Scoped to the session's single club -- a coach/admin managing teams across multiple clubs would need to pick a club first, an edge case out of scope for this pass. */
export function ScheduleTrainingDialog({
  clubId,
  targets,
  pitches,
  range,
}: {
  clubId: string
  targets: TrainingTargetOption[]
  pitches: PitchOption[]
  /** Pre-Season/Main-Season date-boundary addendum: bounds the date field client-side; createTrainingSession() re-validates server-side regardless (Section 7 -- date restrictions must not be UI-only). */
  range: { start: string; end: string } | null
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(targets[0]?.value ?? "")
  const [sessionDate, setSessionDate] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [pitchId, setPitchId] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    const selected = targets.find((t) => t.value === target)
    if (!selected || !sessionDate) return
    setSaving(true)
    setError(null)
    const result = await createTrainingSession({
      clubId,
      teamId: selected.kind === "team" ? selected.value : null,
      schedulingGroupId: selected.kind === "group" ? selected.value : null,
      sessionDate,
      startTime: startTime || null,
      endTime: endTime || null,
      pitchId: pitchId || null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpen(false)
    setSessionDate("")
    setStartTime("")
    setEndTime("")
    setPitchId("")
    setNotes("")
  }

  if (targets.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="h-10 gap-1.5" />}>
        <Plus className="size-4" />
        Schedule training
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule training</DialogTitle>
          <DialogDescription>A calendar event, not a fixture — no opponent, no result.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="training-target" className="text-sm font-medium text-ink/80">
              Team or Mini-Rugby Group
            </label>
            <select
              id="training-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            >
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="training-date" className="text-sm font-medium text-ink/80">
              Date
            </label>
            <input
              id="training-date"
              type="date"
              value={sessionDate}
              min={range?.start}
              max={range?.end}
              onChange={(e) => setSessionDate(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
          <div>
            <label htmlFor="training-pitch" className="text-sm font-medium text-ink/80">
              Pitch (optional)
            </label>
            <select
              id="training-pitch"
              value={pitchId}
              onChange={(e) => setPitchId(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            >
              <option value="">Not set</option>
              {pitches.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="training-start-time" className="text-sm font-medium text-ink/80">
              Start time
            </label>
            <input
              id="training-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
          <div>
            <label htmlFor="training-end-time" className="text-sm font-medium text-ink/80">
              End time
            </label>
            <input
              id="training-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="training-notes" className="text-sm font-medium text-ink/80">
              Notes (optional)
            </label>
            <input
              id="training-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
          <Button type="button" className="h-10" disabled={saving || !sessionDate} onClick={handleCreate}>
            {saving ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
