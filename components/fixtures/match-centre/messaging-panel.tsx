"use client"

import { useState, useTransition } from "react"

import { sendFixtureMessage } from "@/app/(app)/fixtures/[fixtureId]/actions"
import type { FixtureConversationRef } from "@/lib/app-context/match-centre-data"

export interface FixtureMessageRow {
  id: string
  body: string
  createdAt: string
  senderName: string
  isOwn: boolean
}

function formatRelative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function MessagingPanel({ fixtureId, conversation, initialMessages }: { fixtureId: string; conversation: FixtureConversationRef; initialMessages: FixtureMessageRow[] }) {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!conversation.canView) {
    return (
      <div className="rounded-xl border border-ink/10 bg-white px-4 py-3.5">
        <h3 className="text-xs font-medium tracking-[0.06em] text-ink/50 uppercase">Messages</h3>
        <p className="mt-1.5 text-sm text-ink/50">Fixture messages are currently for club/team staff only.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3.5">
      <h3 className="text-xs font-medium tracking-[0.06em] text-ink/50 uppercase">Messages</h3>
      <ul className="mt-2 flex flex-col gap-2.5">
        {messages.length === 0 && <li className="text-sm text-ink/45">No messages yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.isOwn ? "ml-auto bg-pitch-600/10 text-pitch-900" : "bg-ink/5 text-ink"}`}>
            <p>{m.body}</p>
            <p className="mt-1 text-[10px] text-ink/40">
              {m.senderName} · {formatRelative(m.createdAt)}
            </p>
          </li>
        ))}
      </ul>

      {conversation.canPost && (
        <div className="mt-3 flex items-end gap-2">
          <label className="sr-only" htmlFor="mc-message-draft">
            Write a message
          </label>
          <textarea
            id="mc-message-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="Write a message…"
            className="min-h-11 flex-1 resize-none rounded-md border border-ink/15 px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          />
          <button
            type="button"
            disabled={isPending || !draft.trim()}
            onClick={() => {
              const body = draft.trim()
              setError(null)
              startTransition(async () => {
                const result = await sendFixtureMessage(fixtureId, body)
                if (result.ok) {
                  setMessages((prev) => [...prev, { id: `local-${Date.now()}`, body, createdAt: new Date().toISOString(), senderName: "You", isOwn: true }])
                  setDraft("")
                } else {
                  setError(result.message)
                }
              })
            }}
            className="flex min-h-11 shrink-0 items-center rounded-md bg-forest-800 px-4 text-sm font-medium text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
          >
            {isPending ? "Sending…" : "Send"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
