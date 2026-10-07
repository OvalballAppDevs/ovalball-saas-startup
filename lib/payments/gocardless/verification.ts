import { createServiceRoleClient } from "@/lib/supabase/service-role"

import { gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"

export type GoCardlessVerificationStatus = "action_required" | "in_review" | "successful" | "unknown"

/** GoCardless's documented Creditor.verification_status values (https://docs.gocardless.com/docs/api-reference/creditor). */
const KNOWN_VERIFICATION_STATUSES: ReadonlySet<string> = new Set(["action_required", "in_review", "successful"])

interface GoCardlessCreditorsListResponse {
  creditors?: Array<{ verification_status?: string }>
}

/**
 * The ONE place that turns a real GoCardless Creditor.verification_status
 * into Ovalball's stored value, via update_gocardless_verification_status().
 * Called from the OAuth callback (immediately after a club connects), the
 * webhook handler (on a creditors/creditor_updated event) and the replay job
 * (a live connection whose status is still unknown) -- the mapping must never
 * be duplicated between those call sites or the UI.
 *
 * ONLY AN ANSWER IS WRITTEN (20270749000000, gap G8). A check that failed -- the
 * request, the body, or a verification_status GoCardless has not documented --
 * writes NOTHING and THROWS, so a known status is never downgraded to "unknown"
 * (which blocked enrolment until GoCardless happened to send another event) and
 * the creditor event that asked is retried. This function still never marks a
 * club verified on anything other than a genuine "successful" read directly
 * from GoCardless. Through gcRequest, the read is retried when GoCardless rate-
 * limits it, and refused outright if the connection belongs to the other
 * GoCardless environment.
 */
export async function syncGoCardlessVerificationStatus(params: { clubId: string; environment: GoCardlessEnvironment; accessToken: string }): Promise<Exclude<GoCardlessVerificationStatus, "unknown">> {
  const body = await gcRequest<GoCardlessCreditorsListResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: "/creditors",
  })
  const raw = body?.creditors?.[0]?.verification_status
  if (!raw || !KNOWN_VERIFICATION_STATUSES.has(raw)) {
    throw new Error(`GoCardless did not report a verification status Ovalball recognises (${raw ?? "none"}); nothing was written.`)
  }
  const status = raw as Exclude<GoCardlessVerificationStatus, "unknown">

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("update_gocardless_verification_status", { p_club_id: params.clubId, p_status: status })
  if (error) throw new Error(error.message)

  return status
}
