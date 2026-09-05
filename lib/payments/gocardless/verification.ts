import { createServiceRoleClient } from "@/lib/supabase/service-role"

import { getGoCardlessApiBaseUrl, type GoCardlessEnvironment } from "./env"

export type GoCardlessVerificationStatus = "action_required" | "in_review" | "successful" | "unknown"

const KNOWN_VERIFICATION_STATUSES: ReadonlySet<string> = new Set(["action_required", "in_review", "successful"])

interface GoCardlessCreditorsListResponse {
  creditors?: Array<{ verification_status?: string }>
}

/**
 * The ONE place that turns a real GoCardless Creditor.verification_status
 * into Ovalball's stored value, via update_gocardless_verification_status().
 * Called from both the OAuth callback (immediately after a club connects)
 * and the webhook handler (on a creditors/creditor_updated event) -- the
 * mapping must never be duplicated between those call sites or the UI.
 *
 * Fails safe in every direction: a network/HTTP failure, an unparsable
 * body, or a verification_status value GoCardless hasn't documented all
 * map to "unknown" rather than being trusted or guessed. This function
 * never marks a club verified on anything other than a genuine
 * "successful" value read directly from GoCardless.
 */
export async function syncGoCardlessVerificationStatus(params: { clubId: string; environment: GoCardlessEnvironment; accessToken: string }): Promise<GoCardlessVerificationStatus> {
  let mapped: GoCardlessVerificationStatus = "unknown"

  try {
    const response = await fetch(`${getGoCardlessApiBaseUrl(params.environment)}/creditors`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "GoCardless-Version": "2015-07-06",
        "Content-Type": "application/json",
      },
    })

    if (response.ok) {
      const body = (await response.json()) as GoCardlessCreditorsListResponse
      const raw = body.creditors?.[0]?.verification_status
      if (raw && KNOWN_VERIFICATION_STATUSES.has(raw)) {
        mapped = raw as GoCardlessVerificationStatus
      }
    }
  } catch {
    // Network or parse failure -- stays "unknown". Never assume success on
    // a provider API failure.
  }

  const supabase = createServiceRoleClient()
  await supabase.rpc("update_gocardless_verification_status", { p_club_id: params.clubId, p_status: mapped })

  return mapped
}
