import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"

import { Button } from "@/components/ui/button"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getClubConversationSummaries, getConversationSummaries } from "@/lib/app-context/conversations"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ConversationList, type ConversationRow } from "./conversation-list"

const STATUS_LABELS: Record<string, string> = {
  sent: "Awaiting response",
  pending: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  counter_proposed: "Counter-proposed",
}

export default async function MessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // Product decision: Parent/Player (view only) doesn't see the club-to-
  // club fixture/request negotiation threads at all -- those are between
  // the two clubs' admins/fixture secretaries (and, for "club" kind,
  // unrelated general correspondence), not something a parent needs
  // visibility into. A parent-facing team channel (parents + team staff,
  // scoped to one team) is a distinct, not-yet-built conversation type --
  // this only removes the wrong one from view, it doesn't invent the
  // right one. Skip both fetches entirely rather than fetch-then-hide.
  const inParentOrPlayerContext = activeContext.kind === "parent" || activeContext.kind === "player"
  const conversations = inParentOrPlayerContext ? [] : await getConversationSummaries(supabase, ctx, user.id)
  const clubConversations = inParentOrPlayerContext ? [] : await getClubConversationSummaries(supabase, ctx, user.id)
  // Scoped to the ACTIVE club specifically, not "does this session hold
  // CLUB_ADMIN/FIXTURE_SECRETARY ANYWHERE" -- otherwise Parent View (or an
  // unrelated team context) offers "New message" (a club-to-club message)
  // merely because the account also manages a different club elsewhere.
  const canMessageClubs = Boolean(activeManageableClubId(ctx, activeContext))

  // Presentation-only normalization over the SAME two real data sources --
  // no new fetch, no new table. kind "request"/"fixture" -> the existing
  // fixture-conversation route; kind "club" (pending or accepted) -> the
  // same [kind]/[id] route already used for accepted club conversations,
  // which already renders the request/accept affordance for a pending one.
  const rows: ConversationRow[] = [
    ...conversations.map((c) => ({
      key: `${c.kind}:${c.id}`,
      kind: c.kind,
      href: `/messages/${c.kind}/${c.id}`,
      logoUrl: c.opponentClubLogoUrl,
      clubName: c.opponentClubName,
      title: `${c.kind === "request" ? "Fixture request" : "Fixture"}: ${c.myTeamDisplayName} vs ${c.oppositionLabel}`,
      preview: c.latestMessageSenderName ? `${c.latestMessageSenderName}: ${c.latestMessagePreview ?? ""}` : c.latestMessagePreview,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      activityAt: c.latestMessageAt ?? c.date,
      unreadCount: c.unreadCount,
    })),
    ...clubConversations.map((c) => ({
      key: `club:${c.id}`,
      kind: "club" as const,
      href: `/messages/club/${c.id}`,
      logoUrl: c.opponentClubLogoUrl,
      clubName: c.opponentClubName,
      title: "Club message",
      preview: c.latestMessageSenderName ? `${c.latestMessageSenderName}: ${c.latestMessagePreview ?? ""}` : c.latestMessagePreview,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      activityAt: c.latestMessageAt ?? c.requestedAt,
      unreadCount: c.unreadCount,
    })),
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Messages</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Conversations</h1>
          <p className="mt-2 max-w-md text-sm text-ink/55">
            Fixture and fixture-request conversations, plus direct club-to-club messages.
          </p>
        </div>
        {canMessageClubs && (
          <Button className="h-10 shrink-0" nativeButton={false} render={<Link href="/messages/new" />}>
            New message
          </Button>
        )}
      </div>

      <div className="mt-8">
        <ConversationList rows={rows} />
      </div>
    </div>
  )
}
