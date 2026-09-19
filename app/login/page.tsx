import { Suspense } from "react"

import { AuthShell, AuthSwitchLink } from "@/components/auth/auth-shell"

import { LoginForm } from "./login-form"

/**
 * RENDERED PER REQUEST, SO THE CONTENT SECURITY POLICY CAN NONCE IT.
 *
 * This page was statically prerendered, and that is a CSP hole with no warning
 * attached: Next stamps its per-request nonce onto its own script tags at render
 * time, and HTML produced at BUILD time has no request and therefore no nonce.
 * With a nonce-bound `script-src`, an un-nonced bootstrap script is refused, and
 * `'strict-dynamic'` then refuses the chunks it would have loaded -- so the page
 * served correct markup and never hydrated. `/login` was the only route in the
 * build where that was true, which is exactly why it was hard to see: every
 * dynamic page around it worked.
 *
 * The cost is one prerendered page. Sign In runs a Turnstile challenge and a
 * client form, so it was never a cache win worth a dead authentication surface.
 */
export const dynamic = "force-dynamic"

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
