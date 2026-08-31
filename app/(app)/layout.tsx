import { redirect } from "next/navigation"

import { buildNavItems } from "@/lib/app-context/build-nav-items"
import { getRecentNotifications } from "@/lib/app-context/notifications"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { AppMobileNav } from "./app-mobile-nav"
import { AppNav } from "./app-nav"

/**
 * Guards every route in this group: authenticated + at least one active
 * club membership or Site Admin status required, or this redirects to
 * /welcome (the existing pending-state page, unchanged). This is a
 * convenience redirect for a good UX, not the actual security boundary --
 * every page/action underneath still hits its own RLS policy or
 * SECURITY DEFINER function regardless of whether someone reached it
 * through this guard.
 */
export default async function AuthenticatedAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const ctx = await getSessionContext(supabase, user)

  if (!ctx.isSiteAdmin && ctx.clubMemberships.length === 0) {
    redirect("/welcome")
  }

  const { primary, roleLabel, clubName } = buildNavItems(ctx)
  const { items: notifications, unreadCount } = await getRecentNotifications(supabase, user.id)

  return (
    <div className="flex min-h-screen bg-chalk">
      <div className="hidden md:block">
        <AppNav
          primaryItems={primary}
          clubName={clubName}
          roleLabel={roleLabel}
          notifications={notifications}
          unreadCount={unreadCount}
        />
      </div>
      <AppMobileNav
        primaryItems={primary}
        clubName={clubName}
        roleLabel={roleLabel}
        notifications={notifications}
        unreadCount={unreadCount}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
