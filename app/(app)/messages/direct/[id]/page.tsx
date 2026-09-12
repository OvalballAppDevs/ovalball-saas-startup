import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { getDirectThread } from "@/lib/messenger/direct"
import { createClient } from "@/lib/supabase/server"

import { DirectBlockControl } from "./direct-block-control"
import { DirectThread } from "./direct-thread"
import { markDirectRead } from "./actions"

/**
 * THE DIRECT CONVERSATION SURFACE.
 *
 * Deliberately LIGHTER than a fixture thread. A fixture header carries two
 * clubs, a date, a status and a participant list because a fixture is an
 * event several people are arranging; a 1:1 carries one name, because that is
 * the entire context. Reusing the fixture header here would dress a private
 * conversation up as an organisational one.
 *
 * There is no Add participant and no Remove participant: a direct
 * conversation has exactly two people by definition, and mutating one into a
 * group would silently change what both of them agreed to be in.
 */
export default async function DirectConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const view = await getDirectThread(supabase, id, user.id)

  // Not a member and not existing are the same answer, so a guessed id cannot
  // confirm that two particular people have a conversation.
  if (!view) notFound()

  await markDirectRead(id)

  // Only the viewer's OWN blocks. This decides whether the control offers
  // Block or Unblock; it can never reveal a block held the other way, which
  // stays indistinguishable from every other reason a composer is closed.
  const { data: blockedRows } = await supabase.rpc("my_blocked_users")
  const blockedByMe = (blockedRows ?? []).some(
    (row: { user_id: string }) => row.user_id === view.otherUserId,
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-chalk">
      <div className="relative shrink-0 bg-gradient-to-b from-forest-900 to-forest-950 text-chalk">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex overflow-hidden">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className={i % 2 === 0 ? "h-full flex-1 bg-white/[0.035]" : "h-full flex-1"} />
          ))}
        </div>

        <div className="relative flex items-center gap-2.5 px-3 py-2.5 sm:px-4">
          <Link
            href="/messages"
            aria-label="Back to conversations"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-chalk/85 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 lg:hidden"
          >
            <ChevronLeft className="size-[18px]" aria-hidden="true" />
          </Link>

          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-forest-800 text-xs font-semibold text-white ring-1 ring-white/15">
            {view.otherName.charAt(0).toUpperCase()}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[1.0625rem] leading-tight text-chalk">{view.otherName}</h1>
            {/* ONE context line, and only where it says something. A private
                conversation does not need a status, a date or a count. */}
            {view.contextLabel && <p className="truncate text-xs text-chalk/60">{view.contextLabel}</p>}
          </div>

          <DirectBlockControl
            otherUserId={view.otherUserId}
            otherName={view.otherName}
            blockedByMe={blockedByMe}
          />
        </div>
      </div>

      <DirectThread
        conversationId={id}
        messages={view.messages}
        canSend={view.canSend}
        unavailableReason={view.unavailableReason}
      />
    </div>
  )
}
