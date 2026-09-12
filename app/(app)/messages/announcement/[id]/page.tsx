import { ChevronLeft, Megaphone } from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { getAnnouncementView } from "@/lib/messenger/announcement"
import { createClient } from "@/lib/supabase/server"

import { AnnouncementThread } from "./announcement-thread"
import { WithdrawAnnouncement } from "./withdraw-announcement"
import { markAnnouncementRead } from "./actions"

/**
 * AN ANNOUNCEMENT IS NOT A CONVERSATION, SO IT IS NOT THE CONVERSATION ROUTE.
 *
 * /messages/[kind]/[id] renders a container that two or more named people
 * share: everyone in it can see everyone else, and the header is built around
 * "who you are talking to". None of that is true here. An announcement has
 * one author and an audience that must stay invisible to itself, so a header
 * showing participants would be the leak, not a nicety.
 *
 * This is therefore a sibling route rather than a sixth `kind`. Next.js
 * resolves the static `announcement` segment ahead of the dynamic `[kind]`
 * one, so /messages/announcement/<id> lands here and the existing
 * conversation route is untouched.
 *
 * It is NOT a fork of a shared surface in the sense CLAUDE.md forbids: that
 * rule is about one fixture rendering differently per role, and Match Centre
 * still has exactly one implementation. What is shared here is shared
 * properly -- the same MessageThread, the same Composer, the same header
 * language -- because the parts that ARE the same must not drift.
 *
 * WHAT DIFFERS BY VIEWER IS DATA, NOT DESIGN. The sending side sees a
 * recipient count and a withdraw control; a recipient does not. Both come
 * from the same component tree reading the same view model, and the figures a
 * recipient must not have are absent from the payload rather than hidden in
 * the markup.
 */
export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const view = await getAnnouncementView(supabase, id, user.id)

  // RLS returning nothing and the announcement not existing are the same
  // answer on purpose: a 404 either way, so a wrong guess at an id cannot
  // confirm that an announcement exists.
  if (!view) notFound()

  // Opening it is reading it. Done after the read so a failure here cannot
  // stop the page rendering.
  if (view.viewerIsRecipient) await markAnnouncementRead(id)

  const sentLabel = view.sentAt
    ? new Date(view.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "Not yet sent"

  return (
    <div className="flex h-full min-h-0 flex-col bg-chalk">
      {/* -----------------------------------------------------------------
          THE HEADER, in the same forest language as every other Messenger
          surface, so this reads as part of Messenger rather than as a
          notice board bolted onto it.
          ----------------------------------------------------------------- */}
      <div className="relative shrink-0 overflow-hidden bg-gradient-to-b from-forest-900 to-forest-950 text-chalk">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className={i % 2 === 0 ? "h-full flex-1 bg-white/[0.035]" : "h-full flex-1"} />
          ))}
        </div>

        <div className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap sm:px-4">
          <Link
            href="/messages"
            aria-label="Back to conversations"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-chalk/85 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 lg:hidden"
          >
            <ChevronLeft className="size-[18px]" aria-hidden="true" />
          </Link>

          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
            <Megaphone className="size-[18px] text-pitch-400" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1 basis-40">
            <h1 className="truncate font-display text-[1.0625rem] leading-tight text-chalk">{view.senderLabel}</h1>
            {/* ONE context line. The recipient count is only ever in the
                sending side's payload, so it cannot appear here otherwise. */}
            <p className="truncate text-xs text-chalk/60">
              {[
                "Announcement",
                sentLabel,
                view.recipientCount !== null
                  ? `${view.recipientCount} ${view.recipientCount === 1 ? "recipient" : "recipients"}`
                  : null,
                view.withdrawn ? "Withdrawn" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {view.viewerIsSender && !view.withdrawn && <WithdrawAnnouncement announcementId={id} />}
        </div>
      </div>

      {/* THE ANNOUNCEMENT ITSELF, above the replies and visually distinct
          from them: it is the thing being replied TO, not the first message
          in a thread. Treating it as a bubble would have made the author look
          like just another participant. */}
      <div className="shrink-0 border-b border-ink/10 bg-white px-3 py-4 sm:px-4">
        <div className="mx-auto max-w-[46rem]">
          {view.title && <h2 className="font-display text-lg leading-snug text-ink">{view.title}</h2>}
          <p
            className={`whitespace-pre-wrap text-sm leading-relaxed ${view.title ? "mt-1.5" : ""} ${
              view.withdrawn ? "italic text-ink-subtle" : "text-ink"
            }`}
          >
            {view.body}
          </p>

          {view.excludedU18 && !view.withdrawn && view.viewerIsSender && (
            <p className="mt-3 text-xs text-ink-muted">
              Under-18 players and their guardians were excluded from this announcement.
            </p>
          )}

          {/* WHO COULD NOT BE REACHED. The sender's business alone, and shown
              rather than swallowed: a sender who is not told believes they
              told everybody. */}
          {view.unreachable && view.unreachable.length > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {view.unreachable.length === 1
                ? "1 player in this audience has nobody who can be contacted for them."
                : `${view.unreachable.length} players in this audience have nobody who can be contacted for them.`}{" "}
              They did not receive this.
            </p>
          )}
        </div>
      </div>

      <AnnouncementThread
        announcementId={id}
        replies={view.replies}
        replyMode={view.replyMode}
        canReply={view.canReply}
        replyBlockedReason={view.replyBlockedReason}
        viewerIsSender={view.viewerIsSender}
      />
    </div>
  )
}
