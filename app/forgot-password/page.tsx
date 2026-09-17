import { AuthShell, AuthSwitchLink } from "@/components/auth/auth-shell"

import { ForgotPasswordForm } from "./forgot-password-form"

export const metadata = { title: "Forgotten Password" }

/**
 * Phase 2 G, the first step of "lost password".
 *
 * This route is reached from a link the Sign In page has always shown. Until Slice 6b it was a
 * production 404, which meant the only Full Site Admin had no way back into their own account if
 * they forgot their password -- with no second administrator to help (AN-3).
 */
export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Forgotten your password?"
      subtitle="We'll email you a link to set a new one."
      panelLine="The season doesn't organise itself."
      footer={<AuthSwitchLink prompt="Remembered it?" href="/login" label="Sign in instead" />}
    >
      <ForgotPasswordForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null} />
    </AuthShell>
  )
}
