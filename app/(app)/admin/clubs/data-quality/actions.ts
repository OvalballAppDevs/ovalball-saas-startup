"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Site Admin route-family guard addendum: RLS/the RPC's own is_site_admin() check remains the boundary for real authority; this adds the active-context half, which RLS cannot see. */
export async function acceptResearchProposal(proposalId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("accept_directory_research_proposal", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs/data-quality")
  return { ok: true }
}

export async function rejectResearchProposal(proposalId: string, reason?: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("reject_directory_research_proposal", { p_proposal_id: proposalId, p_reason: reason || undefined })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs/data-quality")
  return { ok: true }
}
