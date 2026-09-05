import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export const DIAGNOSTIC_SESSION_COOKIE = "ovalball_diag_session"

export interface DiagnosticClub {
  sessionId: string
  clubId: string
  clubName: string
  clubLogoUrl: string | null
  enteredAt: string
}

/**
 * Turns a diagnostic-session cookie value into real, currently-valid
 * facts via resolve_diagnostic_session (SECURITY DEFINER) -- the cookie
 * is a UI pointer only, same trust model as active-context.ts's
 * ovalball_ctx cookie. A stale, foreign, or closed session id resolves to
 * null (the RPC's own WHERE clause requires site_admin_user_id = auth.uid()
 * and exited_at is null and the club still active), never a fabricated
 * banner.
 */
export async function resolveDiagnosticClub(
  supabase: SupabaseClient<Database>,
  sessionId: string | null
): Promise<DiagnosticClub | null> {
  if (!sessionId) return null

  const { data } = await supabase.rpc("resolve_diagnostic_session", { p_session_id: sessionId }).maybeSingle()
  if (!data) return null

  return {
    sessionId,
    clubId: data.club_id,
    clubName: data.club_name,
    clubLogoUrl: data.club_logo_storage_path
      ? supabase.storage.from("club-logos").getPublicUrl(data.club_logo_storage_path).data.publicUrl
      : null,
    enteredAt: data.entered_at,
  }
}
