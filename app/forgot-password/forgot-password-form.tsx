"use client"

import { useState } from "react"
import { Mail } from "lucide-react"

import { AuthSecurityCheck } from "@/components/auth/auth-security-check"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  canSubmitProtected,
  challengeIdle,
  challengeSpent,
  challengeVerified,
  tokenForSubmission,
} from "@/lib/auth/challenge-state"

import { requestPasswordReset } from "./actions"

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Ask for a password reset link.
 *
 * The answer is the SAME whether or not the address has an account, because Phase 2 E says so: a
 * public form that distinguishes them is a way to find out who uses Ovalball. That is why the
 * confirmation below never names a state -- it says what would happen if an account exists, and
 * nothing about whether one does.
 *
 * The challenge state uses the shared rule from lib/auth/challenge-state.ts, so this surface cannot
 * repeat the login regression: a spent token clears the "passed" flag with it and the checkpoint is
 * remounted for a fresh one.
 */
export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const securityCheckActive = Boolean(turnstileSiteKey)
  const [email, setEmail] = useState("")
  const [challenge, setChallenge] = useState(() => challengeIdle(securityCheckActive))
  const [challengeNonce, setChallengeNonce] = useState(0)
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const ready = canSubmitProtected(challenge, securityCheckActive)
  const valid = EMAIL_PATTERN.test(email.trim())

  function spendChallenge() {
    setChallenge(challengeSpent(securityCheckActive))
    if (securityCheckActive) setChallengeNonce((n) => n + 1)
  }

  async function submit() {
    if (!valid || !ready || status === "submitting") return
    setStatus("submitting")
    setError(null)
    const result = await requestPasswordReset(email, tokenForSubmission(challenge, securityCheckActive))
    // The token went with the request whatever the answer.
    spendChallenge()
    if (result.ok) {
      setStatus("sent")
    } else {
      setStatus("error")
      setError(result.message)
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex size-11 items-center justify-center rounded-full bg-mint-100">
          <Mail className="size-5 text-forest-800" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink">Check your email</h2>
          {/* Names no account state, deliberately. */}
          <p className="mt-2 text-[15px] leading-relaxed text-ink/60">
            If an Ovalball account exists for <strong className="text-ink">{email.trim()}</strong>, a link to set a
            new password is on its way. It can be used once, and it expires.
          </p>
          <p className="mt-3 text-sm text-ink/60">
            You&rsquo;ll still need your authenticator afterwards, if you have one set up.
          </p>
        </div>
        <Button variant="outline" className="h-11" nativeButton={false} render={<a href="/login" />}>
          Back to Sign In
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fp-email" className="text-ink/80">
            Email Address
          </Label>
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourclub.com"
          />
          <p className="text-sm text-ink/60">We&rsquo;ll send a link to set a new password.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
            {error}
          </div>
        )}

        <Button type="submit" className="h-12 rounded-xl text-[15px]" disabled={!valid || !ready || status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Send Reset Link"}
        </Button>
      </form>

      <a href="/login" className="text-center text-sm text-ink/60 underline hover:text-ink">
        Back to Sign In
      </a>

      {securityCheckActive && turnstileSiteKey && (
        <AuthSecurityCheck
          key={`forgot-${challengeNonce}`}
          siteKey={turnstileSiteKey}
          action="forgot-password"
          onVerified={(token) => setChallenge(challengeVerified(token))}
        />
      )}
    </div>
  )
}
