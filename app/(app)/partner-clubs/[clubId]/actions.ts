"use server"

import { createClient } from "@/lib/supabase/server"

export type AvailabilityResult =
  | { ok: true; unavailableDates: string[] }
  | { ok: false; error: string }

/**
 * get_partner_team_availability (SECURITY DEFINER) re-checks the active
 * partnership itself -- this only forwards the call and reshapes its
 * result into a plain list of unavailable dates. Every date NOT in the
 * list is implicitly available, per that function's own doc comment.
 */
export async function getPartnerAvailability(teamId: string, from: string, to: string): Promise<AvailabilityResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_partner_team_availability", {
    p_team_id: teamId,
    p_from: from,
    p_to: to,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, unavailableDates: (data ?? []).map((row) => row.fixture_date) }
}
