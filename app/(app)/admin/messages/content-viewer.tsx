"use client"

import { useState } from "react"
import { MessageSquareText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { markMessageReportReviewedAction, resolveMessageReportAction, revealMessageThreadContentAction, type ThreadContentResult } from "./actions"

type RevealedMessage = Extract<ThreadContentResult, { ok: true }>["messages"][number]

/**
 * Full Site Admin / Message Moderator only -- gated one level up by
 * `canRevealContent` (never rendered at all for a restricted profile).
 * Every open here calls admin_get_message_thread_content, which writes
 * its own audit_log row server-side -- opening this dialog IS the audited
 * event, not a separate step.
 */
export function ContentViewer({
  fixtureId,
  fixtureRequestId,
  label,
}: {
  fixtureId: string | null
  fixtureRequestId: string | null
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<RevealedMessage[]>([])

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    setError(null)
    const result = await revealMessageThreadContentAction(fixtureId, fixtureRequestId)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessages(result.messages)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? handleOpen() : setOpen(false))}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" />}>
        <MessageSquareText className="size-3.5" />
        View content
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-ink/50">Loading message content…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && (
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {messages.length === 0 && <p className="text-sm text-ink/45">No messages in this conversation.</p>}
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink/70">{m.senderName}</p>
                  <p className="text-xs text-ink/40">{new Date(m.createdAt).toLocaleString()}</p>
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{m.body}</p>
                {m.reportStatus && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Report: {m.reportStatus}
                      {m.reportReason ? ` — ${m.reportReason}` : ""}
                    </span>
                    {m.reportStatus === "open" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={async () => {
                          await markMessageReportReviewedAction(m.id)
                          setOpen(false)
                        }}
                      >
                        Mark reviewed
                      </Button>
                    )}
                    {(m.reportStatus === "open" || m.reportStatus === "reviewed") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={async () => {
                          await resolveMessageReportAction(m.id)
                          setOpen(false)
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
