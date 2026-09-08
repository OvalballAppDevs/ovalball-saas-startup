import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { SubscriptionView } from "../../parent/players/[playerId]/subscription/page"

export const metadata = { title: "Payments & Subscriptions" }

/**
 * PAYMENTS & SUBSCRIPTIONS, for a player managing their own membership.
 *
 * A real Player-facing route, not a redirect into a guardian one. It used to
 * send the adult to /parent/players/<id>/subscription, which worked and read
 * as though they were their own child's parent.
 *
 * It renders the SAME SubscriptionView the guardian route renders, so there is
 * still exactly one implementation of a person's membership, one set of
 * GoCardless facts, and no second place anybody could be told something
 * different about their own money. What `isSelf` changes is the wording and
 * where Back goes -- never the figures.
 */
export default async function PlayerPaymentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: ctx } = await supabase.rpc("my_player_context").single()

  // No player record, or no club yet: there is nothing to pay for, and the
  // honest next step is the journey that would create one.
  if (!ctx?.player_id || ctx.state !== "ACTIVE") redirect("/player/join")

  return <SubscriptionView playerId={ctx.player_id} isSelf />
}
