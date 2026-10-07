import { revokeGoCardlessToken } from "./oauth"
import type { GoCardlessEnvironment } from "./env"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

/**
 * THE TOKENS OVALBALL HAS LET GO OF, REVOKED AT GOCARDLESS. Disconnecting (and reconnecting over an old
 * connection) moves the club's token out of its connection into a server-only queue in the same transaction
 * (20270744000000). This empties that queue: each token is revoked at GoCardless and then deleted; one that
 * could not be revoked stays, with its error, for the next run. Called after a disconnect and by the replay job,
 * so a disconnect made from the phone is revoked too. Server-only: it reads tokens, so it runs with the service
 * role and never returns or logs one.
 */
export async function drainGoCardlessTokenRevocations(limit = 20): Promise<{ revoked: number; failed: number }> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc("claim_gocardless_token_revocations", { p_limit: limit })
  if (error) throw new Error(error.message)
  let revoked = 0
  let failed = 0
  for (const row of data ?? []) {
    try {
      await revokeGoCardlessToken({ environment: row.environment as GoCardlessEnvironment, token: row.access_token })
      const { error: finishError } = await supabase.rpc("finish_gocardless_token_revocation", { p_id: row.id, p_error: undefined })
      if (finishError) throw new Error(finishError.message)
      revoked += 1
    } catch (cause) {
      failed += 1
      await supabase.rpc("finish_gocardless_token_revocation", {
        p_id: row.id,
        p_error: cause instanceof Error ? cause.message : "Revocation failed.",
      })
    }
  }
  return { revoked, failed }
}
