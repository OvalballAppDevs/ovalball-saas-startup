import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { SecurityManager } from "./security-manager"

export const metadata: Metadata = { title: "Security" }

/**
 * ACCOUNT -> SECURITY (Phase 2 F, G, H).
 *
 * Everything a person can do about their own sign-in, in one place: authenticators, recovery codes,
 * the devices they are signed in on, and any recovery somebody has started against their account.
 *
 * That last one is the reason this page matters beyond convenience. G makes a factor reset survivable
 * by telling the account holder and giving them 24 hours to stop it -- and a notification is only a
 * defence if it lands somewhere with a Cancel button.
 */
export default async function AccountSecurityPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/account/security")

  const [{ data: factors }, { data: sessions }, { data: codeCount }, { data: assurance }, { data: recoveries }] =
    await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.rpc("my_sessions"),
      supabase.rpc("my_recovery_code_count"),
      supabase.rpc("my_session_assurance"),
      supabase
        .from("privileged_recovery_requests")
        .select("id, kind, state, execute_after, reason")
        .in("state", ["PENDING_APPROVAL", "WAITING"]),
    ])

  const totp = (factors?.totp ?? []).filter((f) => f.status === "verified")
  const posture = (assurance ?? {}) as { aal?: string | null; enforcement_group?: string }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <h1 className="font-display text-display-l text-ink">Security</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        How you sign in to Ovalball, and where you are signed in.
      </p>

      <SecurityManager
        factors={totp.map((f) => ({ id: f.id, name: f.friendly_name ?? "Authenticator", createdAt: f.created_at }))}
        sessions={(sessions ?? []).map((s) => ({
          id: s.session_id as string,
          createdAt: s.created_at as string,
          refreshedAt: s.refreshed_at as string | null,
          userAgent: (s.user_agent as string | null) ?? null,
          isCurrent: Boolean(s.is_current),
        }))}
        recoveryCodesLeft={(codeCount as number | null) ?? 0}
        atAal2={posture.aal === "aal2"}
        enforcementGroup={posture.enforcement_group ?? "NONE"}
        openRecoveries={(recoveries ?? []).map((r) => ({
          id: r.id as string,
          kind: r.kind as string,
          state: r.state as string,
          executeAfter: r.execute_after as string | null,
          reason: r.reason as string,
        }))}
      />
    </div>
  )
}
