import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * PAYMENTS & SUBSCRIPTIONS, for a player managing their own membership.
 *
 * Deliberately not a second payments screen. Ovalball already has one, built
 * on real GoCardless mandates, subscriptions and collections, and it already
 * admits an adult player managing their own membership alongside a guardian
 * managing a child's -- so this resolves who is asking and sends them to it.
 *
 * Duplicating it would mean two places where a person could be told a
 * different thing about their own money, which is the one subject where that
 * is least acceptable.
 */
export default async function PlayerPaymentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: ctx } = await supabase.rpc("my_player_context").single()

  // No player record yet, or no club: there is nothing to pay for, and the
  // honest next step is the journey that would create one.
  if (!ctx?.player_id) redirect("/player/join")
  if (ctx.state !== "ACTIVE") redirect("/player/join")

  redirect(`/parent/players/${ctx.player_id}/subscription`)
}
