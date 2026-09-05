"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import type { SupportCategory } from "@/lib/support/types"

export type SupportActionResult = { ok: true; id: string; reference: string } | { ok: false; error: string }

export async function createSupportTicket(input: {
  category: SupportCategory
  subject: string
  description: string
  sourceRoute: string | null
  relatedFixtureId?: string | null
  relatedFixtureRequestId?: string | null
  relatedTeamId?: string | null
}): Promise<SupportActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("create_support_ticket", {
      p_category: input.category,
      p_subject: input.subject,
      p_description: input.description,
      p_related_fixture_id: input.relatedFixtureId ?? undefined,
      p_related_fixture_request_id: input.relatedFixtureRequestId ?? undefined,
      p_related_team_id: input.relatedTeamId ?? undefined,
      p_source_route: input.sourceRoute ?? undefined,
    })
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't submit your request. Please try again." }

  revalidatePath("/support")
  return { ok: true, id: data.id, reference: data.reference }
}

export type SimpleActionResult = { ok: true } | { ok: false; error: string }

export async function addSupportFollowup(ticketId: string, body: string): Promise<SimpleActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_support_followup", { p_ticket_id: ticketId, p_body: body })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/support/${ticketId}`)
  return { ok: true }
}
