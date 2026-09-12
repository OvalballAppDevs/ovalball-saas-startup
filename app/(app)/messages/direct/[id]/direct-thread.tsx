"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { deleteOwnMessage, reportMessage } from "@/app/(app)/messages/actions"

import { Composer } from "@/components/messenger/composer"
import { MessageThread } from "@/components/messenger/message-thread"
import { useConversationRealtime } from "@/components/messenger/use-conversation-realtime"
import type { ThreadMessage } from "@/lib/messenger/thread-types"

import { sendDirectMessage } from "./actions"

/**
 * A 1:1 thread, on the shared components.
 *
 * MessageThread and Composer are the same ones the fixture workspace, the
 * compact panel and announcements use, so a direct message looks and behaves
 * like every other message in Ovalball -- same bubble sides, same runs, same
 * delete and report dialogs. Nothing here is a second implementation.
 *
 * WHAT DIFFERS IS ONLY WHAT MUST. A direct conversation has no participants
 * to manage, no organisational sender, and no fixture controls; the composer
 * is either usable or it is not, and when it is not the reason given is the
 * same neutral sentence whatever the cause.
 */
export function DirectThread({
  conversationId,
  messages,
  canSend,
  unavailableReason,
}: {
  conversationId: string
  messages: ThreadMessage[]
  canSend: boolean
  unavailableReason: string | null
}) {
  const [draft, setDraft] = useState("")
  const router = useRouter()

  // A direct message from the other side arrives the same way it does in the
  // fixture workspace: the database broadcasts, this re-reads through RLS.
  // The container prefix is 'd' -- see internal.message_realtime_topic.
  useConversationRealtime(`presence:d:${conversationId}`)

  return (
    // MessageThread already IS the flex child that scrolls -- its own root
    // carries min-h-0 flex-1. Wrapping it in a plain block div meant that
    // flex-1 governed nothing, so the list grew to its content instead of
    // scrolling inside the pane: the last message rendered past the bottom of
    // the viewport, over the composer, and stole its pointer events. The
    // fixture workspace makes it a direct child of a bounded flex column, and
    // so does this now.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MessageThread
        messages={messages}
        density="full"
        // THE SHARED REPORT AND DELETE, ON THE SHARED COMPONENT. Both are
        // container-agnostic server actions keyed by message id, so a direct
        // message is reported and withdrawn through exactly the same route
        // as a fixture message. Not passing them was the only reason a
        // private conversation -- the place a person is most likely to need
        // them -- was the one surface that offered neither.
        onDeleteMessage={async (messageId) => {
          const result = await deleteOwnMessage(messageId)
          if (result.ok) router.refresh()
          return result
        }}
        onReportMessage={async (messageId, reason) => {
          const result = await reportMessage(messageId, reason)
          if (result.ok) router.refresh()
          return result
        }}
        emptyTitle="No messages yet"
        emptyBody="Say hello — only the two of you can read this."
      />

      <Composer
        value={draft}
        onValueChange={setDraft}
        disabled={!canSend}
        disabledReason={unavailableReason ?? undefined}
        placeholder="Write a message…"
        onSend={async (value) => {
          const result = await sendDirectMessage(conversationId, value)
          if (result.ok) setDraft("")
          return result
        }}
      />
    </div>
  )
}
