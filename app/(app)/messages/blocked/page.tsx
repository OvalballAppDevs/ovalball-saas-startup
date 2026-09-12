import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { BlockedUsersList, type BlockedUser } from "./blocked-users-list"

/**
 * PERSONAL PRIVACY, INSIDE MESSENGER.
 *
 * This lives at /messages/blocked rather than under a new top-level section
 * because it manages one thing -- who may contact you in Messenger -- and a
 * person looking for it will look where the messages are.
 *
 * IT IS NOT AN ADMIN SCREEN. Club Admin and Site Admin messaging settings
 * decide what a whole club or the platform may do; this decides what one
 * person wants for themselves, and no administrator can see or change it.
 * They are deliberately different surfaces with different authority, and the
 * fact that both concern "messaging settings" is not a reason to merge them.
 *
 * The list comes from public.my_blocked_users(), which resolves names only
 * for ids named by the caller's own live block rows. There is no query this
 * page can make that returns anybody the viewer has not blocked.
 */
export default async function BlockedUsersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data } = await supabase.rpc("my_blocked_users")

  const blocked: BlockedUser[] = (data ?? []).map((row) => ({
    userId: row.user_id,
    // A profile with no name recorded still has to be manageable -- otherwise
    // a person could be blocked and impossible to unblock from this screen.
    displayName: row.display_name ?? "Ovalball user",
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/messages"
        className="inline-flex items-center gap-1 text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Messages
      </Link>

      <h1 className="mt-3 font-display text-display-l text-ink">Blocked People</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        People you&rsquo;ve blocked can&rsquo;t message you privately, and you can&rsquo;t message them. You may still
        see each other in team conversations, and announcements from a team or club still reach you both.
      </p>

      <div className="mt-8">
        <BlockedUsersList blocked={blocked} />
      </div>
    </div>
  )
}
