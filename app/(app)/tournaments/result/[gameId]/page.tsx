import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * `/tournaments/result/<gameId>` -- THE GAME-RESULT ADDRESS every tournament result notification carries
 * (`notificationHref`). The phone renders the one shared result screen at it; the website has no screen of
 * its own for one game, so it opens the tournament the game belongs to. Before this page existed the
 * address was a 404 on the website for five notification types (integration audit).
 *
 * The game is read under the visitor's own row rule, so the address grants nothing: a game the visitor
 * cannot see is a 404, exactly like one that does not exist.
 */
export default async function TournamentGameResultAddress({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("tournament_games").select("tournament_id").eq("id", gameId).maybeSingle()
  if (!data?.tournament_id) notFound()
  redirect(`/tournaments/${encodeURIComponent(data.tournament_id)}`)
}
