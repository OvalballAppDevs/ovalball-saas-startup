import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts"

type Client = SupabaseClient<Database>

/**
 * SECTION 10 (CLUBHOUSE): starting and answering a club-to-club conversation, mobile.
 *
 * `start_or_get_club_conversation` and `respond_to_club_conversation` are the website's own canonical
 * RPCs (CA-M9) -- this file only forwards the same calls its `app/(app)/messages/club-actions.ts`
 * makes, with no service role and no second implementation of the spam/cooldown/partnership rules
 * those functions already enforce server-side.
 */

export interface StartClubConversationResult {
  ok: boolean
  conversationId: string | null
  status: "pending" | "accepted" | null
  error: string | null
}

export async function startClubConversation(supabase: Client, myClubId: string, targetClubId: string, firstMessage: string): Promise<StartClubConversationResult> {
  const { data, error } = await supabase.rpc("start_or_get_club_conversation", { p_my_club_id: myClubId, p_target_club_id: targetClubId, p_first_message: firstMessage }).single()
  if (error || !data) return { ok: false, conversationId: null, status: null, error: error?.message ?? "Could not start this conversation." }
  return { ok: true, conversationId: data.conversation_id, status: data.status as "pending" | "accepted", error: null }
}

export async function respondToClubConversation(supabase: Client, conversationId: string, approve: boolean): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc("respond_to_club_conversation", { p_conversation_id: conversationId, p_approve: approve })
  if (error) return { ok: false, error: error.message }
  return { ok: true, error: null }
}

export interface ClubMessageSearchResult {
  directoryId: string
  clubId: string | null
  name: string
  town: string | null
  county: string | null
  rugbyCode: string
  isActiveOnOvalball: boolean
  isPartner: boolean
}

/**
 * Reproduces `app/(app)/messages/club-search.ts` exactly: club_directory is public-read (the same
 * "discovery is always allowed" reasoning as fixture-request opponent search), scoped to real clubs
 * only for the partnership lookup.
 */
export async function searchClubsForMessaging(supabase: Client, query: string, myClubId: string): Promise<ClubMessageSearchResult[]> {
  if (query.trim().length < 2) return []

  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, county, rugby_code, clubs(id, status)")
    .eq("active", true)
    .ilike("name", `%${query.trim()}%`)
    .limit(8)

  const clubIds = (data ?? []).flatMap((d) => (d.clubs?.id ? [d.clubs.id] : []))
  const { data: partnerships } =
    clubIds.length > 0
      ? await supabase.from("club_partnerships").select("requesting_club_id, partner_club_id").eq("status", "active").or(`requesting_club_id.eq.${myClubId},partner_club_id.eq.${myClubId}`)
      : { data: [] as { requesting_club_id: string; partner_club_id: string }[] }
  const partnerClubIds = new Set(
    (partnerships ?? []).flatMap((p) => [p.requesting_club_id === myClubId ? p.partner_club_id : null, p.partner_club_id === myClubId ? p.requesting_club_id : null].filter((v): v is string => Boolean(v)))
  )

  return (data ?? [])
    .filter((d) => d.clubs?.id !== myClubId)
    .map((d) => ({
      directoryId: d.id,
      clubId: d.clubs?.id ?? null,
      name: d.name,
      town: d.town,
      county: d.county,
      rugbyCode: d.rugby_code,
      isActiveOnOvalball: d.clubs?.status === "active",
      isPartner: d.clubs?.id ? partnerClubIds.has(d.clubs.id) : false,
    }))
}
