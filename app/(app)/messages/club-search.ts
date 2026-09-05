"use server"

import { createClient } from "@/lib/supabase/server"

export interface ClubMessageSearchResult {
  directoryId: string
  clubId: string | null
  name: string
  town: string | null
  county: string | null
  rugbyCode: string
  /** clubId is not null AND the real clubs row is status='active'. */
  isActiveOnOvalball: boolean
  isPartner: boolean
}

/**
 * club_directory is public-read (same reasoning as the fixture-request
 * opponent search) -- discovery is always allowed, whether or not the
 * club has an Ovalball account. Partner status is resolved against
 * p_my_club_id's own club_partnerships rows.
 */
export async function searchClubsForMessaging(query: string, myClubId: string): Promise<ClubMessageSearchResult[]> {
  if (query.trim().length < 2) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, county, rugby_code, clubs(id, status)")
    .eq("active", true)
    .ilike("name", `%${query.trim()}%`)
    .limit(8)

  const clubIds = (data ?? []).flatMap((d) => (d.clubs?.id ? [d.clubs.id] : []))
  const { data: partnerships } =
    clubIds.length > 0
      ? await supabase
          .from("club_partnerships")
          .select("requesting_club_id, partner_club_id")
          .eq("status", "active")
          .or(`requesting_club_id.eq.${myClubId},partner_club_id.eq.${myClubId}`)
      : { data: [] }
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
