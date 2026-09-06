import { Suspense } from "react"

import { AuthShell, AuthSwitchLink } from "@/components/auth/auth-shell"

import { LoginForm } from "./login-form"

/**
 * Sign In -- for people who already have an Ovalball account.
 *
 * Shares AuthShell with Get Started so the two read as one product, while
 * staying two clearly distinct journeys: different heading, different
 * content, and an explicit route across to the other one.
 *
 * LoginForm reads `?email=` / `?error=` via useSearchParams, which Next.js
 * requires a Suspense boundary around.
 */
export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      subtitle="Pick up where your club left off."
      panelLine="The season doesn't organise itself."
      footer={
        <div className="space-y-1.5">
          {/* Two different journeys, both of which end up here by mistake:
              somebody bringing a club, and somebody whose club invited them.
              Only the first is a signup. */}
          <AuthSwitchLink prompt="Run a rugby club?" href="/signup" label="Bring it to Ovalball" />
          <AuthSwitchLink prompt="Invited by your club?" href="/invited" label="What to do" />
        </div>
      }
    >
      <Suspense>
        {/* The public site key only; the secret half never leaves the server. */}
        <LoginForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null} />
      </Suspense>
    </AuthShell>
  )
}
