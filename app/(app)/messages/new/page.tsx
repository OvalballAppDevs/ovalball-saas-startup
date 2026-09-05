import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { NewMessageForm } from "./new-message-form"

export default async function NewMessagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- a new club-to-club message
  // must be sent AS the club actually active, never whichever club-wide
  // authority happens to be first in the session.
  const myClubId = activeManageableClubId(ctx, activeContext)
  if (!myClubId) redirect("/messages")

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Messages</p>
      <h1 className="mt-2 font-display text-display-l text-ink">New message</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Message another club directly &mdash; separate from any fixture. Partner clubs open a conversation
        immediately; other Ovalball clubs get a message request to accept first.
      </p>

      <div className="mt-8">
        <NewMessageForm myClubId={myClubId} />
      </div>
    </div>
  )
}
