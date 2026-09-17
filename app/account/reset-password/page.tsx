import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { createClient } from "@/lib/supabase/server"

import { ResetPasswordForm } from "./reset-password-form"

export const metadata = { title: "Set a New Password" }

/**
 * Where a recovery link lands (Phase 2 E "Reset", G).
 *
 * /auth/callback has already exchanged the link for a session, so arriving here signed in IS the
 * authorisation -- the link was the proof. Arriving here without one means the link expired, was
 * already used, or was never valid, and all three have the same fix, so they get the same answer.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/forgot-password?expired=1")

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Set a new password"
      subtitle="Choose something you haven't used on Ovalball before."
      panelLine="The season doesn't organise itself."
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
