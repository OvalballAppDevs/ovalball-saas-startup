"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { addSupportFollowup } from "../actions"

export function FollowupForm({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (body.trim().length === 0) return
    setSubmitting(true)
    setError(null)
    const result = await addSupportFollowup(ticketId, body)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBody("")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 border-t border-ink/8 pt-4">
      <label htmlFor="followup-body" className="text-sm font-medium text-ink">
        Add information
      </label>
      <textarea
        id="followup-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add anything else that might help…"
        className="mt-1.5 w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" className="mt-2 h-9" disabled={submitting || body.trim().length === 0}>
        {submitting ? "Sending…" : "Add information"}
      </Button>
    </form>
  )
}
