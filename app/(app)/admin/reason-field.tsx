"use client"

import { Label } from "@/components/ui/label"

/**
 * The reason a Site Admin gives for a change to someone's access. It is kept
 * with the record and its security event, and the database refuses the
 * change without one.
 */
export function ReasonField({ id, value, onChange, label = "Reason" }: { id: string; value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        className="h-8 min-w-0 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
      />
    </div>
  )
}
