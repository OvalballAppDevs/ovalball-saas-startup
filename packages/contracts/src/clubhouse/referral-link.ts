import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * A CLUB'S REFERRAL LINK -- `/r/<its slug>` (One Referral Link per Club, the owner's decision of 2026-10-05).
 *
 * The club's public address and nothing more: it grants nothing and holds no secret, so -- unlike an
 * invitation -- it can be shown, printed and shared again at any time. Using it only remembers which club
 * recommended Ovalball; who is credited is decided on the server when the club that used it is approved
 * (`20270740000000_one_referral_link_per_club.sql`), by the same first-referrer rule as a club referred by name.
 */
export function clubReferralUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(slug)}`
}

/**
 * A slug as it may arrive in a link or a query string: trimmed and lower-cased, and only the characters a
 * club slug is made of -- anything else is no referral at all, never an error. The server resolves it to an
 * active club or records nothing.
 */
export function referralSlugFrom(value: string | null | undefined): string | null {
  const slug = (value ?? "").trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ? slug : null
}

/** The club's own link address: its slug while the club is active on Ovalball, else none. */
export async function readClubReferralSlug(supabase: SupabaseClient<Database>, clubId: string): Promise<string | null> {
  const { data, error } = await supabase.from("clubs").select("slug, status").eq("id", clubId).maybeSingle()
  if (error) throw error
  return data && data.status === "active" && data.slug ? data.slug : null
}
