import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type MerchantTokenRow = { access_token: string; environment: string }

/**
 * A club's GoCardless merchant token, for one server-side provider call.
 *
 * The token functions are executable by service_role only: an ordinary
 * signed-in session can never read the credential, however it calls the
 * database. Callers must already have proved the signed-in user's authority
 * with that user's own session; the database then re-checks the same
 * authority for `actorUserId` before it returns anything. Never pass an
 * actor id that did not come from `supabase.auth.getUser()`, and never send
 * the token to the browser.
 */
export async function merchantTokenForPayerSubscription(payerSubscriptionId: string, actorUserId: string): Promise<MerchantTokenRow | null> {
  const { data, error } = await createServiceRoleClient()
    .rpc("get_gocardless_token_for_payer_subscription", { p_payer_subscription_id: payerSubscriptionId, p_actor_user_id: actorUserId })
    .maybeSingle()
  if (error || !data) return null
  return data
}

export async function merchantTokenForClubPaymentAction(clubId: string, actorUserId: string): Promise<MerchantTokenRow | null> {
  const { data, error } = await createServiceRoleClient()
    .rpc("get_gocardless_token_for_club_admin_action", { p_club_id: clubId, p_actor_user_id: actorUserId })
    .maybeSingle()
  if (error || !data) return null
  return data
}
