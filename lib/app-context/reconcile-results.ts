import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * reconcile_overdue_fixture_results() is the real, idempotent 24-hour
 * deadline mechanism (20260902110000) -- there is no scheduled-job
 * infrastructure in this stack, so it is called opportunistically from
 * every page that reads fixture results, matching this codebase's
 * established pattern of doing reconciliation work inline on read
 * (see reconcile_new_club_fixture_requests()). It is safe to call on
 * every request: FOR UPDATE SKIP LOCKED means concurrent callers never
 * double-process the same overdue row, and a request with nothing overdue
 * is a fast no-op. Errors are swallowed -- this is a best-effort side
 * effect of loading the page, never something that should break the page
 * itself if it fails.
 */
export async function reconcileOverdueFixtureResults(supabase: SupabaseClient<Database>): Promise<void> {
  await supabase.rpc("reconcile_overdue_fixture_results").then(
    () => undefined,
    () => undefined
  )
}
