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
      footer={<AuthSwitchLink prompt="New to Ovalball?" href="/signup" label="Get started" />}
    >
      <Suspense>
        {/* The public site key only; the secret half never leaves the server. */}
        <LoginForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null} />
      </Suspense>
    </AuthShell>
  )
}
