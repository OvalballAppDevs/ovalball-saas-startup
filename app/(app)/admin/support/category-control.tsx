"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/lib/support/types"

import { updateSupportTicketCategory } from "./actions"

/** Mirrors StatusControl's inline-edit shape, minus the dialog -- a category
 * correction has no requester-facing message to compose, so a plain select
 * that saves on change is enough. */
export function CategoryControl({ ticketId, currentCategory }: { ticketId: string; currentCategory: SupportCategory }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: SupportCategory) {
    if (next === currentCategory) return
    setSaving(true)
    setError(null)
    const result = await updateSupportTicketCategory(ticketId, next)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Category</p>
      <select
        value={currentCategory}
        onChange={(e) => handleChange(e.target.value as SupportCategory)}
        disabled={saving}
        className="mt-1.5 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        {SUPPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {SUPPORT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
