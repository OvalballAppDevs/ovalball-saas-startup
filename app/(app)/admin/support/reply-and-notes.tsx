"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { addInternalNote, sendSupportReply } from "./actions"

export function ReplyToUserForm({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (body.trim().length === 0) return
    setSubmitting(true)
    setError(null)
    const result = await sendSupportReply(ticketId, body)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBody("")
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Reply to user</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="We've identified the problem and are working on a fix."
        className="mt-2 w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      <Button size="sm" className="mt-2 h-9" disabled={submitting || body.trim().length === 0} onClick={handleSend}>
        {submitting ? "Sending…" : "Send Update"}
      </Button>
    </div>
  )
}

export function InternalNoteForm({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (body.trim().length === 0) return
    setSubmitting(true)
    setError(null)
    const result = await addInternalNote(ticketId, body)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBody("")
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-50 p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-amber-800 uppercase">Internal note &middot; Site Admin only</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Reproduced locally. Appears related to..."
        className="mt-2 w-full resize-y rounded-lg border border-amber-400/50 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      <Button size="sm" variant="outline" className="mt-2 h-9 border-amber-400/50" disabled={submitting || body.trim().length === 0} onClick={handleAdd}>
        {submitting ? "Adding…" : "Add Internal Note"}
      </Button>
    </div>
  )
}
