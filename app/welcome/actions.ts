"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type ClaimThreadMessage = { id: string; body: string; authorRole: "SITE_ADMIN" | "CLAIMANT"; createdAt: string }
export type ReplyResult = { ok: true } | { ok: false; error: string }

/**
 * `public.reply_to_claim` is the boundary: it accepts a message only from the claim's own claimant or
 * from somebody holding `site.claims.review`, and it decides the author's role itself rather than
 * taking it as an argument. Naming a stranger's claim id achieves nothing.
 */
export async function replyToOwnClaim(claimId: string, body: string): Promise<ReplyResult> {
  const supabase = await createClient()
  if (!body.trim()) return { ok: false, error: "Write your answer first." }

  const { error } = await supabase.rpc("reply_to_claim", { p_claim_id: claimId, p_body: body.trim() })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/welcome")
  return { ok: true }
}

/** RLS returns the thread only to the two parties to the claim. Nothing is filtered in the browser. */
export async function ownClaimMessages(claimId: string): Promise<ClaimThreadMessage[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("club_claim_messages")
    .select("id, body, author_role, created_at")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: true })
  return (data ?? []).map((m) => ({
    id: m.id as string,
    body: m.body as string,
    authorRole: m.author_role as "SITE_ADMIN" | "CLAIMANT",
    createdAt: m.created_at as string,
  }))
}
