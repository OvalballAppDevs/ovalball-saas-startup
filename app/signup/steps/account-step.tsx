"use client"

import Link from "next/link"
import { useState } from "react"
import { Check, Mail } from "lucide-react"

import { AuthSecurityCheck } from "@/components/auth/auth-security-check"
import { AuthDivider, SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { hasAnyOAuthProvider } from "@/lib/auth/oauth-providers"

import { FormField } from "../form-field"

interface AccountStepProps {
  email: string
  onChange: (email: string) => void
  /** Public Turnstile site key, or null when not configured. */
  turnstileSiteKey?: string | null
  /** Verified token, lifted so the wizard can send it with the submission. */
  onVerified?: (token: string) => void
  humanPassed?: boolean
  /** True when a provider already authenticated this visitor. */
  isAuthenticated?: boolean
}

const EMAIL_PATTERN = /\S+@\S+\.\S+/

/**
 * Step 1 of Get Started -- where a NEW user chooses how to create an
 * account. Providers first, then email, in the same order and with the same
 * components as Sign In, because these are two journeys through one product
 * and a returning visitor should find the same button in the same place.
 *
 * A visitor who arrives here already authenticated (they picked a provider,
 * came back through the callback, and has no Ovalball profile yet) does not
 * see any of this: their email is settled, so the step collapses to a
 * confirmation and the wizard moves them on to the details it still needs.
 */
export function AccountStep({
  email,
  onChange,
  turnstileSiteKey = null,
  onVerified,
  humanPassed = true,
  isAuthenticated = false,
}: AccountStepProps) {
  const [touched, setTouched] = useState(false)
  const showError = touched && email.length > 0 && !EMAIL_PATTERN.test(email)

  if (isAuthenticated) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Step 1</p>
          <h1 className="mt-2 font-display text-display-l text-ink">You&apos;re signed in</h1>
          <p className="mt-3 max-w-sm text-base text-ink/60">
            We just need a few details to finish setting up your Ovalball account.
          </p>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-pitch-600/30 bg-mint-100/50 px-4 py-3.5">
          <Check className="size-4 shrink-0 text-forest-800" strokeWidth={3} aria-hidden="true" />
          <span className="text-sm text-forest-900">{email}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Step 1</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Join Ovalball</h1>
        <p className="mt-3 max-w-sm text-base text-ink/60">
          Create your account and get connected with your rugby club.
        </p>
      </div>

      <SocialAuthButtons
        turnstileToken={null}
        ready={humanPassed}
        intent="signup"
        next="/signup"
      />

      {hasAnyOAuthProvider() && <AuthDivider label="or sign up with email" />}

      <div>
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError}
          className={showError ? "border-destructive focus-visible:border-destructive" : undefined}
          placeholder="you@example.com"
        />
        {showError && (
          <p className="mt-1.5 text-sm text-destructive">
            Enter a valid email address, like you@example.com.
          </p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink/45">
          <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Ovalball has no passwords. We&apos;ll email you a one-time link to confirm your account
            at the end.
          </span>
        </p>
      </div>

      {turnstileSiteKey && onVerified && (
        <AuthSecurityCheck siteKey={turnstileSiteKey} action="signup-start" onVerified={onVerified} />
      )}

      <p className="border-t border-ink/10 pt-5 text-sm text-ink/60">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
