import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { MessengerShell } from "@/components/messenger/messenger-shell"
import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, isFamilyFacingContext, resolveActiveContext } from "@/lib/app-context/active-context"
import { getMessengerRows } from "@/lib/app-context/messenger-rows"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

/**
 * THE MESSENGER LIVES IN THE LAYOUT, NOT IN THE PAGE.
 *
 * That one decision is what makes /messages a workspace rather than a set of
 * separate screens. The conversation list is rendered here, so it stays put
 * while the conversation beside it changes -- on a laptop, moving between two
 * conversations is a click, not a journey back to an index and out again.
 *
 * It also keeps deep links honest. /messages/fixture/<id> is still one URL
 * that opens one conversation; on a wide screen it simply arrives with its
 * list already beside it. Nothing about where a notification or a message
 * takes you changed, and the browser's Back button still means what it says.
 *
 * The authority questions are answered HERE, once, exactly as the page
 * answered them before: whether this context sees club-to-club conversations
 * at all, and whether it may start one.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // Unchanged product decision: Parent/Player (view only) does not see the
  // club-to-club fixture and request negotiation threads -- those are between
  // the two clubs' admins and fixture secretaries. Their own Support thread is
  // still theirs, and is fetched regardless.
  const includeClubToClub = !isFamilyFacingContext(activeContext.kind)

  // Scoped to the ACTIVE club, never "does this account hold CLUB_ADMIN
  // anywhere" -- otherwise Parent View offers to start a club-to-club message
  // because the same person also runs a different club elsewhere.
  const canStartConversation = Boolean(activeManageableClubId(ctx, activeContext))

  const rows = await getMessengerRows(supabase, ctx, user.id, { includeClubToClub })

  // WHETHER THE ANNOUNCEMENT CONTROL APPEARS is asked of the database, using
  // the same function the composer and the send trigger use. Deriving it from
  // session roles here would eventually offer the control to somebody the
  // composer then shows an empty identity list to.
  const { data: senderIdentities } = await supabase.rpc("my_sender_identities")
  const canAnnounce = (senderIdentities ?? []).length > 0

  return (
    <MessengerShell rows={rows} canStartConversation={canStartConversation} canAnnounce={canAnnounce}>
      {children}
    </MessengerShell>
  )
}
