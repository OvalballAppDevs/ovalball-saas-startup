"use client"

import { useState } from "react"

import { Composer } from "@/components/messenger/composer"
import { MessageThread } from "@/components/messenger/message-thread"
import { useConversationRealtime } from "@/components/messenger/use-conversation-realtime"
import type { ThreadMessage } from "@/lib/messenger/thread-types"

import { replyToAnnouncement } from "./actions"

/**
 * THE REPLY THREAD, on the shared components.
 *
 * MessageThread and Composer are the ones the compact Messenger and the
 * workspace already use, so a reply looks and behaves like every other
 * message in Ovalball -- same bubble sides, same runs, same delete dialog.
 * Building a second thread renderer here would have been quicker and would
 * have started drifting on the first change to either.
 *
 * WHAT IS DIFFERENT is the empty state, and only because the honest empty
 * state differs by reply mode. "No replies yet" is right for a discussion and
 * wrong for a private reply thread, where a recipient seeing nothing is not
 * an absence of replies -- it is the absence of THEIRS, and the others are
 * deliberately invisible. Saying "no replies yet" there would quietly imply
 * that nobody else has answered.
 */
export function AnnouncementThread({
  announcementId,
  replies,
  replyMode,
  canReply,
  replyBlockedReason,
  viewerIsSender,
}: {
  announcementId: string
  replies: ThreadMessage[]
  replyMode: "NO_REPLY" | "PRIVATE_REPLY" | "GROUP_DISCUSSION"
  canReply: boolean
  replyBlockedReason: string | null
  viewerIsSender: boolean
}) {
  const [draft, setDraft] = useState("")

  // A reply arrives live here exactly as a direct message does. The database
  // already broadcasts on this announcement's topic; NO_REPLY announcements
  // simply never produce one, so the subscription costs nothing there.
  useConversationRealtime(`presence:a:${announcementId}`)

  const { title, body } = emptyState(replyMode, viewerIsSender)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <MessageThread messages={replies} density="full" emptyTitle={title} emptyBody={body} />
      </div>

      {replyMode !== "NO_REPLY" && (
        <Composer
          value={draft}
          onValueChange={setDraft}
          disabled={!canReply}
          disabledReason={replyBlockedReason ?? undefined}
          placeholder={replyMode === "PRIVATE_REPLY" ? "Reply privately…" : "Write a message…"}
          footnote={
            replyMode === "PRIVATE_REPLY" && !viewerIsSender ? (
              // Said plainly, because the person needs it BEFORE they type. A
              // parent answering a question about their child should know
              // whether the rest of the team is reading it.
              <span>Only the sender sees your reply.</span>
            ) : null
          }
          onSend={async (value) => {
            const result = await replyToAnnouncement(announcementId, value)
            if (result.ok) setDraft("")
            return result
          }}
        />
      )}
    </div>
  )
}

function emptyState(
  replyMode: "NO_REPLY" | "PRIVATE_REPLY" | "GROUP_DISCUSSION",
  viewerIsSender: boolean,
): { title: string; body: string } {
  if (replyMode === "NO_REPLY") {
    return {
      title: "No replies",
      body: "This announcement was sent without a reply option.",
    }
  }

  if (replyMode === "PRIVATE_REPLY") {
    return viewerIsSender
      ? { title: "No replies yet", body: "Replies arrive here privately, one thread per person." }
      : {
          // Never "no replies yet" -- see the component note above.
          title: "Reply privately",
          body: "Anything you write here goes only to the sender.",
        }
  }

  return {
    title: "No replies yet",
    body: "Everyone this was sent to can read and answer here.",
  }
}
