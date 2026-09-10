"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Clock, MailQuestion } from "lucide-react"

import { Button } from "@/components/ui/button"

import { respondToClubMessageRequest } from "./club-actions"

/**
 * THE DECISION ON A CLUB MESSAGE REQUEST.
 *
 * Another club has asked to open a conversation. Until somebody answers, the
 * thread exists but nothing can be written in it -- so this is the whole point
 * of the screen for the club that received it, and it belongs in the
 * conversation itself rather than in an admin list somewhere else.
 *
 * It had no home at all before this: respond_to_club_conversation existed and
 * was correctly enforced in the database, the action wrapping it existed, and
 * nothing in the product called either. A request could be received, listed,
 * and read -- and then not answered, because there was no control anywhere
 * that answered it. The conversation simply said it was not open yet, forever.
 *
 * SHOWN TO THE RECIPIENT SIDE ONLY, and the server decides that regardless:
 * respond_to_club_conversation refuses anyone who is not managing the invited
 * club. This asks the same question the database asks, so the requesting club
 * is told where the request stands instead of being offered a control that
 * would be rejected.
 */
export function MessageRequestDecision({
  conversationId,
  side,
  otherClubName,
}: {
  conversationId: string
  /** "recipient" is the club being asked; "requester" asked. */
  side: "recipient" | "requester"
  otherClubName: string
}) {
  const router = useRouter()
  const [working, setWorking] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(approve: boolean) {
    setWorking(approve ? "accept" : "decline")
    setError(null)
    const result = await respondToClubMessageRequest(conversationId, approve)
    if (!result.ok) {
      setWorking(null)
      setError(result.error)
      return
    }
    // The thread, the composer and the status all come from the server, so the
    // page is re-rendered rather than patched: nothing here has to guess what
    // an accepted conversation now looks like.
    router.refresh()
  }

  if (side === "requester") {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-ink/10 bg-white px-4 py-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Waiting for {otherClubName}</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            They can accept or decline your request. Your first message is already with them; you can write
            again once they accept.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <MailQuestion className="mt-0.5 size-4 shrink-0 text-amber-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{otherClubName} would like to message you</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Accepting opens the conversation for both clubs. Declining closes it, and they are told.
          </p>

          {error && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-destructive-text">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" className="h-11" disabled={working !== null} onClick={() => respond(true)}>
              {working === "accept" ? "Accepting…" : "Accept Request"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={working !== null}
              onClick={() => respond(false)}
            >
              {working === "decline" ? "Declining…" : "Decline"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
