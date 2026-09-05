"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { buildFixtureCsv } from "@/lib/fixtures/csv-export"

import { buildAdminFixtureQuery } from "../admin/fixtures/query"
import type { AdminFixtureQuery } from "../admin/fixtures/types"

export type RequestActionResult = { ok: true } | { ok: false; error: string }

/**
 * accept_fixture_request (SECURITY DEFINER) re-checks the responding
 * side's authority itself -- see
 * supabase/migrations/20260831092000_fixture_requests.sql. This action
 * only forwards the call.
 */
export async function acceptFixtureRequest(requestId: string, targetTeamId?: string): Promise<RequestActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("accept_fixture_request", { p_request_id: requestId, p_target_team_id: targetTeamId })
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

export type IncomingRequestResolution =
  | "not_found"
  | "has_target_team"
  | "no_structured_identity"
  | "no_target_club"
  | "exists_active"
  | "exists_folded"
  | "ambiguous_squad"
  | "pending_rollover"
  | "pending_structural"
  | "genuinely_missing"

export type CheckIncomingRequestTargetResult =
  | { ok: true; resolution: IncomingRequestResolution; existingTeamId: string | null; message: string }
  | { ok: false; error: string }

/**
 * Read-only -- check_incoming_request_target (SECURITY DEFINER) re-checks
 * the caller's own authority over the recipient club itself; this action
 * only forwards the call. Never creates anything.
 */
export async function checkIncomingRequestTarget(requestId: string): Promise<CheckIncomingRequestTargetResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("check_incoming_request_target", { p_request_id: requestId }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not check this request." }
  return { ok: true, resolution: data.resolution as IncomingRequestResolution, existingTeamId: data.existing_team_id, message: data.message }
}

export type CreateMissingTargetTeamResult = { ok: true; teamId: string } | { ok: false; error: string }

/**
 * create_missing_target_team (SECURITY DEFINER) re-validates the exact
 * same resolution server-side before creating anything -- never trusts
 * this action's own (or the client's) cached read. Never changes
 * fixture_requests.status: the request stays 'sent' until a separate,
 * deliberate Accept.
 *
 * @deprecated kept only for any other caller -- the Fixture Requests page
 * itself now uses acceptFixtureRequestWithTeamAction, the single atomic
 * "Accept Fixture & Create/Reactivate Team" entry point (Central Fixture
 * Participant Resolution), which never leaves a created team with an
 * unaccepted request the way calling this separately could.
 */
export async function createMissingTargetTeam(requestId: string): Promise<CreateMissingTargetTeamResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_missing_target_team", { p_request_id: requestId })
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create this team." }
  revalidatePath("/fixtures")
  revalidatePath("/teams")
  return { ok: true, teamId: data }
}

export type AcceptWithTeamActionResult = { ok: true; fixtureId: string } | { ok: false; error: string; requiresEscalation?: boolean }

/**
 * The one atomic "Accept Fixture & Create/Reactivate Team" entry point
 * (Central Fixture Participant Resolution). p_consentTeamAction is consent
 * that a team action MAY be performed if the fresh, server-re-resolved
 * state still needs one -- the RPC itself re-checks live state inside one
 * transaction, so this is safe to call even if another request already
 * created/reactivated the same team in the meantime (it will simply skip
 * straight to accepting). Team creation/reactivation specifically requires
 * club-structural authority (Site Admin or the recipient club's Club
 * Admin) -- a Fixtures Secretary calling this without that authority gets
 * a clear escalation error, not a silent failure.
 */
export async function acceptFixtureRequestWithTeamAction(requestId: string, consentTeamAction: boolean): Promise<AcceptWithTeamActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_fixture_request_with_team_action", {
    p_request_id: requestId,
    p_consent_team_action: consentTeamAction,
  })
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not accept this request.", requiresEscalation: error?.code === "42501" }
  }
  revalidatePath("/fixtures")
  revalidatePath("/dashboard")
  revalidatePath("/teams")
  return { ok: true, fixtureId: data }
}

export type ExportCsvResult = { ok: true; csv: string; filename: string } | { ok: false; error: string }

const UNFILTERED_CLUB_EXPORT_QUERY: AdminFixtureQuery = {
  q: "",
  date: "all",
  status: "all",
  code: "all",
  source: "all",
  resultStatus: "all",
  competitionEditionId: null,
  sort: "date-asc",
  page: 1,
  size: 100,
}

/**
 * Club-scoped fixture export -- the SAME `admin_fixture_overview` view
 * and CSV schema (lib/fixtures/csv-export.ts) as the Site Admin export,
 * scoped to fixtures where the active club is either side (owning or
 * opponent -- Master Fixture Registry means one row IS the whole match,
 * so a club must be able to export fixtures it responded to as well as
 * ones it created). The exported `fixture_id` column round-trips through
 * the club import's own fixture_id update detection.
 *
 * Reconciliation complaint 29: this previously ALWAYS exported every
 * fixture regardless of any filter the caller had applied (a hardcoded
 * unfiltered query object, not even accepting a parameter) -- a genuine
 * "Export All"-only bug for Club Admin/Fixtures Secretary, unlike the
 * Site Admin export which already read its real applied query. `query`
 * is now optional and, when supplied by the caller (the Fixtures page's
 * export filter panel), genuinely narrows the exported rows to exactly
 * that filtered set -- omitting it keeps the previous unfiltered
 * behaviour for any other caller.
 */
export async function exportClubFixturesCsv(query?: AdminFixtureQuery): Promise<ExportCsvResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) return { ok: false, error: "You don't have fixture management authority for a club right now." }

  const { data, error } = await buildAdminFixtureQuery(supabase, query ?? UNFILTERED_CLUB_EXPORT_QUERY, clubId)
  if (error || !data) return { ok: false, error: "Couldn't generate the export. Please try again." }

  const csv = await buildFixtureCsv(supabase, data)
  const timestamp = new Date().toISOString().slice(0, 10)
  return { ok: true, csv, filename: `ovalball-fixtures-${timestamp}.csv` }
}
