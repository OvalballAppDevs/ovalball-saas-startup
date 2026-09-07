"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useId, useState } from "react"
import { ArrowLeft, Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import { AuthSecurityCheck } from "@/components/auth/auth-security-check"
import { AuthDivider, SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { hasAnyOAuthProvider } from "@/lib/auth/oauth-providers"
import { REMEMBER_COOKIE_NAME } from "@/lib/supabase/remember-constants"

import { submitLogin } from "./actions"

const EMAIL_PATTERN = /\S+@\S+\.\S+/
const REMEMBER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

/**
 * Non-sensitive UI preference only -- see lib/supabase/remember.ts.
 */
function setRememberCookie(remember: boolean) {
  document.cookie = `${REMEMBER_COOKIE_NAME}=${remember ? "1" : "0"}; path=/; max-age=${REMEMBER_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
}

type Status = "idle" | "submitting" | "sent" | "error"

/**
 * Sign in -- for people who already have an Ovalball account.
 *
 * Ovalball is passwordless. The email route sends a one-time sign-in link;
 * there is no password field, and "Forgot password" is not a state this
 * product has. That is a deliberate architecture decision, reconfirmed when
 * this screen was redesigned, so the copy says exactly what the button does
 * rather than implying a password exists.
 *
 * Composition: providers first, then a rule, then email behind one control.
 * The email form is revealed rather than always-on because most returning
 * users will use a provider, and an unconditional form pushed the whole page
 * long enough that a phone opened on a security panel instead of a way in.
 *
 * Deliberately shows the same "check your email" state whether or not an
 * account exists -- see lib/auth/check-account.ts for why that oracle is
 * closed on purpose.
 */
export function LoginForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const searchParams = useSearchParams()

  // Turnstile is the only thing that gates submission. When it is not
  // configured there is nothing to verify, so nothing is shown and nothing
  // is blocked -- a checkpoint with no verification behind it would be
  // theatre occupying the top of the page.
  const securityCheckActive = Boolean(turnstileSiteKey)
  const [humanToken, setHumanToken] = useState<string | null>(null)
  const [humanPassed, setHumanPassed] = useState(!turnstileSiteKey)

  const [showEmail, setShowEmail] = useState(() => Boolean(searchParams.get("email")))
  const [linkError, setLinkError] = useState(() => searchParams.get("error") === "link")
  const [sessionUpdated, setSessionUpdated] = useState(() => searchParams.get("reason") === "updated")
  const [sessionSuspended, setSessionSuspended] = useState(() => searchParams.get("reason") === "suspended")
  const [email, setEmail] = useState(searchParams.get("email") ?? "")
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [hasSent, setHasSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [rememberMe, setRememberMe] = useState(true)
  const emailId = useId()
  const rememberId = useId()

  const syntaxValid = EMAIL_PATTERN.test(email)
  const showSyntaxError = touched && email.length > 0 && !syntaxValid

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  async function sendLink() {
    if (!syntaxValid || status === "submitting" || !humanPassed) return

    setStatus("submitting")
    setErrorMessage(null)
    setLinkError(false)
    setSessionUpdated(false)
    setSessionSuspended(false)
    setRememberCookie(rememberMe)
    const result = await submitLogin(email, humanToken)

    if (result.ok) {
      setStatus("sent")
      setHasSent(true)
      setResendCooldown(30)
      // A Turnstile token is single-use; the checkpoint re-runs itself for
      // a resend rather than failing with an error nobody can act on.
      if (securityCheckActive) {
        setHumanToken(null)
        setHumanPassed(false)
      }
    } else {
      setStatus("error")
      setErrorMessage(result.message)
    }
  }

  if (hasSent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex size-11 items-center justify-center rounded-full bg-mint-100">
          <Mail className="size-5 text-forest-800" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink">Check your email</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink/60">
            If an Ovalball account exists for <strong className="text-ink">{email}</strong>, a
            sign-in link is on its way. Open it to continue &mdash; you can close this tab.
          </p>
        </div>

        {securityCheckActive && !humanPassed && turnstileSiteKey && (
          <AuthSecurityCheck
            siteKey={turnstileSiteKey}
            action="login-resend"
            onVerified={(token) => {
              setHumanToken(token)
              setHumanPassed(true)
            }}
          />
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-lg"
            disabled={resendCooldown > 0 || status === "submitting" || !humanPassed}
            onClick={sendLink}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend link"}
          </Button>
        </div>
        <p className="text-sm text-ink-muted">
          Nothing after a few minutes? Check the spelling above, or{" "}
          <Link
            href={`/signup?email=${encodeURIComponent(email)}`}
            className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            create an account
          </Link>{" "}
          if you&apos;re new to Ovalball.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {sessionUpdated && <Notice tone="info">Ovalball has been updated &mdash; please sign in again.</Notice>}
      {sessionSuspended && (
        <Notice tone="danger">
          Your Ovalball account has been suspended. Please contact Ovalball Support if you believe
          this is an error.
        </Notice>
      )}
      {linkError && (
        <Notice tone="info">
          That link didn&apos;t work &mdash; sign-in links are one-time only and expire. Request a
          fresh one below.
        </Notice>
      )}

      <SocialAuthButtons turnstileToken={humanToken} ready={humanPassed} intent="signin" />

      {hasAnyOAuthProvider() && <AuthDivider label="or" />}

      {!showEmail ? (
        <button
          type="button"
          onClick={() => setShowEmail(true)}
          className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-ink/12 bg-gradient-to-b from-white to-[#f6f8f6] px-4 text-[15px] font-medium text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_1px_rgba(16,21,18,0.05),0_2px_4px_rgba(16,21,18,0.06)] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-ink/22 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_3px_rgba(16,21,18,0.07),0_6px_12px_rgba(16,21,18,0.09)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(16,21,18,0.10)] focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          <Mail className="size-[18px] text-ink-muted" aria-hidden="true" />
          Sign in with email
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void sendLink()
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId} className="text-ink/80">
              Email address
            </Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (status === "error") setStatus("idle")
                if (linkError) setLinkError(false)
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={showSyntaxError}
              aria-describedby={`${emailId}-hint`}
              placeholder="you@example.com"
              className={cn(
                "h-12 rounded-xl border-ink/15 bg-white px-3.5 text-base text-ink placeholder:text-ink-subtle",
                showSyntaxError && "border-destructive focus-visible:border-destructive"
              )}
            />
            <p id={`${emailId}-hint`} className="text-xs text-ink-muted">
              We&apos;ll email you a one-time sign-in link. Ovalball has no passwords.
            </p>
            {showSyntaxError && (
              <p className="text-sm text-destructive-text">
                Enter a valid email address, like you@example.com.
              </p>
            )}
          </div>

          <label htmlFor={rememberId} className="flex items-start gap-2.5 text-sm text-ink/70">
            <input
              id={rememberId}
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-ink/25 accent-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
            <span>Keep me signed in on this device</span>
          </label>

          <div aria-live="polite">
            {status === "error" && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
                {errorMessage ?? "Something went wrong. Please try again."}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="h-12 rounded-xl text-[15px]"
            disabled={!syntaxValid || status === "submitting" || !humanPassed}
          >
            {status === "submitting" ? "Sending…" : "Send sign-in link"}
          </Button>

          {hasAnyOAuthProvider() && (
            <button
              type="button"
              onClick={() => setShowEmail(false)}
              className="flex items-center justify-center gap-1.5 text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Use another method
            </button>
          )}
        </form>
      )}

      {/* Quiet footnote, deliberately last: it reports on the page, not on
          any one control above it. */}
      {securityCheckActive && turnstileSiteKey && (
        <AuthSecurityCheck
          siteKey={turnstileSiteKey}
          action="login"
          onVerified={(token) => {
            setHumanToken(token)
            setHumanPassed(true)
          }}
        />
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: "info" | "danger"; children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5 text-destructive-text"
          : "border-ink/10 bg-white text-ink/70"
      )}
    >
      {children}
    </div>
  )
}
