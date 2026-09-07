"use client"

import { useState, useTransition } from "react"

import { sendSafeguardingOfficerMessage } from "../../actions"

export function ContactForm({ clubId, officerId, officerName }: { clubId: string; officerId: string; officerName: string | null }) {
  const [body, setBody] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (sent) {
    return (
      <div role="status" className="mt-4 rounded-lg border border-pitch-600/30 bg-pitch-50 px-4 py-3.5">
        <p className="text-[15px] leading-relaxed text-ink/80">Your message has been sent to {officerName ?? "the Safeguarding Officer"}.</p>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-ink" htmlFor="mc-officer-message">
        Message to {officerName ?? "the Safeguarding Officer"}
      </label>
      <textarea
        id="mc-officer-message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="mt-1.5 w-full rounded-md border border-ink/15 px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      />
      <button
        type="button"
        disabled={isPending || !body.trim()}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await sendSafeguardingOfficerMessage(clubId, officerId, body.trim())
            if (result.ok) setSent(true)
            else setError(result.message)
          })
        }}
        className="mt-3 flex min-h-11 items-center rounded-md bg-forest-800 px-4 text-sm font-medium text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
