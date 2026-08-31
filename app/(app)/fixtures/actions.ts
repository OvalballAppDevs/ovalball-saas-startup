"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type RequestActionResult = { ok: true } | { ok: false; error: string }

/**
 * accept_fixture_request (SECURITY DEFINER) re-checks the responding
 * side's authority itself -- see
 * supabase/migrations/20260831092000_fixture_requests.sql. This action
 * only forwards the call.
 */
export async function acceptFixtureRequest(requestId: string): Promise<RequestActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("accept_fixture_request", { p_request_id: requestId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/fixtures")
  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * A plain status update, not a function -- fixture_requests_update_scoped
 * RLS already covers this (either side may decline/cancel), no atomic
 * multi-table write is needed the way acceptance requires.
 */
export async function declineFixtureRequest(requestId: string): Promise<RequestActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { error } = await supabase
    .from("fixture_requests")
    .update({ status: "declined", decided_by: user.id, decided_at: new Date().toISOString() })
    .eq("id", requestId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/fixtures")
  revalidatePath("/dashboard")
  return { ok: true }
}
