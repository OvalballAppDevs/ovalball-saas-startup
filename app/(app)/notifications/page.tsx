import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getRecentNotifications } from "@/lib/app-context/notifications"
import { activityContext, type ActivityItem } from "@/lib/notifications/activity"
import { createClient } from "@/lib/supabase/server"

import { ActivityInbox } from "./activity-inbox"

export const metadata: Metadata = {
  title: "Activity | Ovalball",
}

/**
 * THE FULL ACTIVITY INBOX.
 *
 * The same source as the bell in the header: public.my_bell_notifications,
 * which decides what belongs to the bell from the notification registry's own
 * topic, so the page and the badge can never disagree about what activity is.
 * The same destinations, the same renderer, the same read semantics -- the
 * page is a bigger window onto one inbox, not a second one.
 *
 * A PAGE, NOT AN ARCHIVE. Fifty is the RPC's ceiling and this asks for it:
 * enough that a person can find the thing they half-remember from last week,
 * and bounded so that a club three seasons in does not send every notification
 * it has ever produced down the wire. Older activity is reachable through the
 * surfaces that own it -- the fixture, the training session, the club -- which
 * is where the full record actually lives.
 */
export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const notifications = await getRecentNotifications(supabase, 50)

  const items: ActivityItem[] = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt,
    readAt: n.readAt,
    context: activityContext(n.type),
  }))

  return (
    <div className="absolute inset-0 min-h-0 bg-chalk">
      <ActivityInbox initialItems={items} />
    </div>
  )
}
