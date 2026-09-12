"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Megaphone, MessageSquarePlus, Search, ShieldBan, UserPlus } from "lucide-react"

import { ConversationRow } from "@/components/messenger/conversation-row"
import { badgeCount, byRecentActivity, unreadLabel, type MessengerRow } from "@/lib/messenger/view-model"
import { cn } from "@/lib/utils"

/**
 * THE COMMUNICATIONS WORKSPACE.
 *
 * One shell, two shapes, decided by width alone:
 *
 *   DESKTOP   conversation list on the left, the open conversation beside it.
 *             The list never goes away, so moving between conversations is a
 *             click rather than a there-and-back journey.
 *
 *   MOBILE    list, then tap, then the conversation full-screen. NOT the
 *             desktop columns squeezed -- a 320px-wide conversation list
 *             stapled to a 70px-wide thread is two unusable things instead of
 *             one usable one.
 *
 * WHICH ONE IS SHOWING is decided from the route, not from state, so a deep
 * link into a conversation opens the conversation on a phone and opens the
 * conversation *with its list* on a laptop -- and the browser's own Back
 * button does exactly what it looks like it does. There is no "which pane"
 * state to get out of step with the URL.
 *
 * The rows come from the layout above, which fetched them once through the
 * canonical queries. This component filters and renders; it never fetches, and
 * the compact header panel renders the SAME rows through the SAME row
 * component.
 */
export function MessengerShell({
  rows,
  canStartConversation,
  canAnnounce = false,
  children,
}: {
  rows: MessengerRow[]
  canStartConversation: boolean
  /** Whether this person may speak as any team, club, or Ovalball itself. */
  canAnnounce?: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const [query, setQuery] = useState("")

  // "/messages" itself is the list. Anything deeper is a conversation (or the
  // new-message form), which on a phone means the list stands aside.
  const listIsTheWholeScreen = pathname === "/messages"

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? rows.filter(
          (r) =>
            r.title.toLowerCase().includes(needle) ||
            (r.context ?? "").toLowerCase().includes(needle) ||
            (r.preview ?? "").toLowerCase().includes(needle)
        )
      : rows
    return [...matched].sort(byRecentActivity)
  }, [rows, query])

  const totalUnread = rows.reduce((sum, r) => sum + r.unreadCount, 0)

  // EXACTLY THE HEIGHT OF THE PANE IT WAS GIVEN, with no arithmetic.
  //
  // Messenger is a full-height surface: its own list scrolls while the search
  // box and the composer stay put. Getting there by subtracting chrome from
  // 100dvh means guessing at heights that change -- the Beta strip, the
  // diagnostic banner, the mobile top bar -- and being 36px wrong the moment
  // one of them appears, which is exactly what happened.
  //
  // The app shell's <main> is already `relative` and already sized correctly
  // by the flex column above it, so filling it absolutely is the true answer
  // rather than an approximation of it.
  return (
    <div className="absolute inset-0 flex min-h-0 bg-chalk">
      {/* ---------------------------------------------------------------
          THE LIST
          --------------------------------------------------------------- */}
      <aside
        aria-label="Conversations"
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-ink/10 bg-white lg:flex lg:w-[340px] lg:border-r xl:w-[380px]",
          listIsTheWholeScreen ? "flex" : "hidden"
        )}
      >
        <div className="shrink-0 border-b border-ink/10 px-4 pt-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-[1.375rem] leading-none text-ink">Messages</h1>
            <div className="flex items-center gap-1.5">
              {/* PERSONAL privacy, not administration. It sits with the other
                  Messenger controls because it governs Messenger, and it is
                  deliberately not in Club or Site Admin settings: no
                  administrator can see or change who a person has blocked. */}
              <Link
                href="/messages/blocked"
                className="flex size-9 items-center justify-center rounded-lg border border-ink/15 text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                aria-label="Blocked People"
                title="Blocked People"
              >
                <ShieldBan className="size-[18px]" aria-hidden="true" />
              </Link>
              {/* TWO DIFFERENT ACTS, TWO CONTROLS. Starting a conversation is
                  a message to somebody who can answer; an announcement goes to
                  a whole team or club and most often cannot be answered at
                  all. Folding them into one "+" menu would ask a person to
                  discover that difference, when getting it wrong means
                  telling four hundred families something meant for one club. */}
              {/* MESSAGE A PERSON. Always offered: whether anybody is
                  actually reachable is the server's answer, and the picker
                  says so honestly rather than the control vanishing and
                  leaving the person wondering where it went. */}
              <Link
                href="/messages/new/person"
                className="flex size-9 items-center justify-center rounded-lg border border-ink/15 text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                aria-label="Message a Person"
                title="Message a Person"
              >
                <UserPlus className="size-[18px]" aria-hidden="true" />
              </Link>
              {canAnnounce && (
                <Link
                  href="/messages/new/announcement"
                  className="flex size-9 items-center justify-center rounded-lg border border-ink/15 text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  aria-label="Send an Announcement"
                >
                  <Megaphone className="size-[18px]" aria-hidden="true" />
                </Link>
              )}
              {canStartConversation && (
                <Link
                  href="/messages/new"
                  className="flex size-9 items-center justify-center rounded-lg bg-forest-950 text-white outline-none transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  aria-label="New Message"
                >
                  <MessageSquarePlus className="size-[18px]" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            {totalUnread > 0 ? (
              <span>
                <span className="font-medium text-ink">{badgeCount(totalUnread)}</span> unread across{" "}
                {rows.length} conversation{rows.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>Fixtures, fixture requests, club messages and Ovalball Support.</span>
            )}
          </p>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="h-11 w-full rounded-lg border border-ink/15 bg-chalk pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 ? (
            <EmptyList searching={query.trim().length > 0} canStartConversation={canStartConversation} />
          ) : (
            <ul className="divide-y divide-ink/[0.07]">
              {visible.map((row) => (
                <li key={row.key}>
                  <ConversationRow row={row} selected={pathname === row.href} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------------------
          THE CONVERSATION
          --------------------------------------------------------------- */}
      {/* A SECTION, NOT A SECOND <main>. The app shell already renders the
          page's one main landmark, and this sits inside it -- two nested
          mains is a landmark violation, and it leaves a screen-reader user
          with two "main" targets and no way to tell which is the page. A
          labelled region says the same thing truthfully: this is the
          conversation, beside the list. */}
      <section
        aria-label="Conversation"
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col lg:flex",
          listIsTheWholeScreen ? "hidden" : "flex"
        )}
      >
        {children}
      </section>
    </div>
  )
}

function EmptyList({ searching, canStartConversation }: { searching: boolean; canStartConversation: boolean }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{searching ? "Nothing matches that" : "No conversations yet"}</p>
      <p className="mx-auto mt-1.5 max-w-[26ch] text-sm text-ink-muted">
        {searching
          ? "Try a club name, a team, or a word from the message."
          : "Fixture requests, fixture conversations and club messages arrive here."}
      </p>
      {!searching && canStartConversation && (
        <Link
          href="/messages/new"
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-forest-950 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          New Message
        </Link>
      )}
    </div>
  )
}

/** Skeleton that approximates a real row, not a grey slab. */
export function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-ink/[0.07]" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="size-9 shrink-0 animate-pulse rounded-lg bg-ink/8" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <div className="h-3 w-1/2 animate-pulse rounded bg-ink/8" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-ink/6" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-ink/6" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export { unreadLabel }
