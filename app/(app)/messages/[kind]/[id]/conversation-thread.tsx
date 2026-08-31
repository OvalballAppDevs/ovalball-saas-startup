"use client"

import { useRef, useState } from "react"
import { Send } from "lucide-react"

import { cn } from "@/lib/utils"

import { sendFixtureMessage, type ConversationKind } from "../../actions"

export interface ThreadMessage {
  id: string
  body: string
  createdAt: string
  isOwn: boolean
  senderName: string
  senderRoleLabel: string
  senderClubName: string
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export function ConversationThread({
  kind,
  id,
  initialMessages,
}: {
  kind: ConversationKind
  id: string
  initialMessages: ThreadMessage[]
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)

    const result = await sendFixtureMessage(kind, id, body)
    setSending(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    // Optimistic append -- we know our own identity locally, no need to
    // refetch the whole thread just to show the message we just sent.
    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        body,
        createdAt: new Date().toISOString(),
        isOwn: true,
        senderName: "You",
        senderRoleLabel: "",
        senderClubName: "",
      },
    ])
    setDraft("")
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-ink/10 bg-white">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-ink">No messages yet</p>
            <p className="max-w-xs text-sm text-ink/50">
              Start the conversation &mdash; confirm kick-off time, pitch allocation, or anything else about this
              fixture.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id} className={cn("flex flex-col", m.isOwn ? "items-end" : "items-start")}>
                {!m.isOwn && (
                  <p className="mb-1 text-xs font-medium text-ink/50">
                    {m.senderName} <span className="text-ink/35">&middot; {m.senderRoleLabel}, {m.senderClubName}</span>
                  </p>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                    m.isOwn ? "rounded-br-sm bg-forest-950 text-chalk" : "rounded-bl-sm bg-ink/5 text-ink"
                  )}
                >
                  {m.body}
                </div>
                <p className="mt-1 text-[11px] text-ink/35">{timeLabel(m.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-ink/10 bg-white px-3 py-3 sm:px-4">
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message…"
            aria-label="Message"
            rows={1}
            className="min-h-11 flex-1 resize-none rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !draft.trim()}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-pitch-600 text-white outline-none transition-colors hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
