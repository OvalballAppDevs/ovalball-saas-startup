import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Finish Setting Up" }

/**
 * THE SETUP-RESTRICTED LANDING (Phase 2 D.2).
 *
 * D.2 names three destinations: "AAL1 -> /security/verify; setup-restricted -> /account/setup;
 * suspended -> /account/suspended". This is the second. It was referenced by the design and by
 * `requireSession` and returned a production 404, which is why 6b.1 builds it before 6b.2 wires the
 * session layer that redirects here.
 *
 * "Setup-restricted" is D's term for a session that authenticated by a route which proves the address
 * and nothing else -- a setup or recovery link, or magic link once T6 arrives. Such a session may
 * only finish setting the account up. It is not a lesser sign-in to be worked around; it is the
 * design refusing to let a link stand in for a password and a second factor.
 *
 * This page does not decide who is restricted -- that is the session layer's job in 6b.2. It is the
 * honest destination, and it refuses to strand anybody: a person who has in fact finished is sent on
 * rather than held here, because a setup page that will not let a set-up account leave is its own
 * kind of lockout.
 */
export default async function AccountSetupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, setup_state, account_state")
    .eq("id", user.id)
    .maybeSingle()

  // A suspended account has a different destination, and it outranks this one.
  if (profile?.account_state === "SUSPENDED" || profile?.account_state === "DISABLED") {
    redirect("/account/suspended")
  }
  // Already finished: do not trap them here.
  if (profile && profile.setup_state === "COMPLETE") redirect("/dashboard")

  const { data: security } = await supabase
    .from("account_security_state")
    .select("password_set_at, mfa_enrolled_at")
    .eq("user_id", user.id)
    .maybeSingle()

  const hasPassword = Boolean(security?.password_set_at)
  const hasAuthenticator = Boolean(security?.mfa_enrolled_at)

  return (
    <AuthShell
      eyebrow="Almost there"
      title="Finish setting up your account"
      subtitle="Two steps, and then Ovalball is yours."
      panelLine="The season doesn't organise itself."
    >
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          <Step done={hasPassword} n={1} title="Choose a password" detail="At least 12 characters, with a capital letter and a special character." />
          <Step done={hasAuthenticator} n={2} title="Set up an authenticator" detail="A six-digit code that changes every 30 seconds, so a stolen password is not enough." />
        </ol>

        <Button
          className="h-12 rounded-xl text-[15px]"
          nativeButton={false}
          render={<a href={hasPassword ? "/security/enrol" : "/account/security"} />}
        >
          {hasPassword ? "Set Up My Authenticator" : "Choose My Password"}
        </Button>

        <p className="text-sm text-ink/60">
          Your club can see that your account exists, but you won&rsquo;t appear as an active member until
          this is done.
        </p>
      </div>
    </AuthShell>
  )
}

function Step({ done, n, title, detail }: { done: boolean; n: number; title: string; detail: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3">
      <span
        aria-hidden="true"
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
          done ? "bg-pitch-600 text-white" : "bg-ink/8 text-ink/60"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span>
        <span className="block text-[15px] font-medium text-ink">
          {title}
          {done && <span className="ml-2 text-sm font-normal text-pitch-700">Done</span>}
        </span>
        <span className="mt-0.5 block text-sm text-ink/60">{detail}</span>
      </span>
    </li>
  )
}
