"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

import { replyToOwnClaim, type ClaimThreadMessage } from "./actions"

/**
 * THE CLAIMANT'S SIDE OF A REVIEW.
 *
 * Ovalball decides whether somebody may administer a rugby club, and that decision is better made by
 * asking than by guessing. So a reviewer can ask a question here, and this is where it is answered.
 *
 * Replying moves the claim back to SUBMITTED, which is what puts it in front of a reviewer again. The
 * state machine does that, not this component -- so there is no way for the thread and the queue to
 * disagree about whose turn it is.
 */
export function ClaimConversation({
  claimId,
  state,
  messages,
}: {
  claimId: string
  state: string
  messages: ClaimThreadMessage[]
}) {
  const [body, setBody] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (messages.length === 0 && state !== "NEEDS_INFORMATION") return null

  function send() {
    setError(null)
    start(async () => {
      const result = await replyToOwnClaim(claimId, body)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBody("")
      setSent(true)
    })
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-lg font-medium text-ink">
        {state === "NEEDS_INFORMATION" ? "Ovalball has asked you something" : "Your conversation with Ovalball"}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.authorRole === "SITE_ADMIN"
                ? "rounded-lg bg-mint-100/50 px-3 py-2.5"
                : "rounded-lg border border-ink/10 px-3 py-2.5"
            }
          >
            <p className="text-xs text-ink-muted">
              {message.authorRole === "SITE_ADMIN" ? "Ovalball" : "You"} &middot;{" "}
              {new Date(message.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </p>
            <p className="mt-1 text-sm text-ink/80">{message.body}</p>
          </li>
        ))}
      </ul>

      {sent ? (
        <p className="mt-4 text-sm text-ink/70">
          Sent. Your claim is back with Ovalball &mdash; we&rsquo;ll email you when it has been reviewed.
        </p>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Your answer"
            aria-label="Your answer"
            className="mt-4 min-h-24 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus-visible:border-pitch-600"
          />
          <Button type="button" className="mt-3 h-9" disabled={pending || body.trim().length === 0} onClick={send}>
            {pending ? "Sending…" : "Send Reply"}
          </Button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
