"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import { REMEMBER_COOKIE_NAME } from "@/lib/supabase/remember-constants"

import { submitLogin } from "./actions"

const EMAIL_PATTERN = /\S+@\S+\.\S+/
const REMEMBER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

/**
 * Non-sensitive UI preference only -- read server-side wherever this app
 * writes Supabase's own auth cookies (see lib/supabase/remember.ts for
 * why a plain client-set cookie, not a server round trip, is enough).
 * Written now, before the magic-link redirect away from this tab, so
 * it's already present when /auth/callback issues the real session.
 */
function setRememberCookie(remember: boolean) {
  document.cookie = `${REMEMBER_COOKIE_NAME}=${remember ? "1" : "0"}; path=/; max-age=${REMEMBER_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
}

type Status = "idle" | "submitting" | "sent" | "error"

/**
 * Single-purpose sign-in: one email field, no password (this app is
 * passwordless/OTP-only end to end -- there is no password to reset, so
 * "forgot password" isn't a state this form has).
 *
 * Deliberately shows the same "Check your email" success state whether or
 * not an account exists for the entered address -- see
 * lib/auth/check-account.ts. There is no "we couldn't find an account"
 * state to route from: that response is exactly the account-existence
 * oracle a privacy review flagged (type an email, learn instantly whether
 * that person has an Ovalball account). A genuinely new visitor isn't
 * stuck -- "Create an account" below is always visible, not conditional on
 * this form's result.
 */
export function LoginForm() {
  const searchParams = useSearchParams()
  // Set once from the initial URL, deliberately not re-read on every
  // render -- /auth/callback lands here with ?error=link for any failed
  // exchange (expired/reused/invalid/missing token, see that route's own
  // comment for why these aren't distinguished further); this banner
  // clears itself the moment the visitor edits the email field or submits,
  // rather than persisting across an unrelated later action.
  const [linkError, setLinkError] = useState(() => searchParams.get("error") === "link")
  // Set by proxy.ts when a session's recorded AUTH_SESSION_VERSION falls
  // behind the current requirement -- never shown for an ordinary deploy,
  // only a deliberate security/session-breaking version bump.
  const [sessionUpdated, setSessionUpdated] = useState(() => searchParams.get("reason") === "updated")
  // Set by proxy.ts when a Site Admin suspends this account while it has an
  // active session -- deliberately no internal reason surfaced beyond
  // "suspended," matching lib/supabase/middleware.ts's own choice not to
  // leak suspension detail to the client.
  const [sessionSuspended, setSessionSuspended] = useState(() => searchParams.get("reason") === "suspended")
  const [email, setEmail] = useState(searchParams.get("email") ?? "")
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  // Separate from `status`: once a link has been sent, the success screen
  // stays up even while a resend is `submitting` -- status alone would flip
  // the view back to the plain form for that moment, which reads as "did
  // that resend just undo the first email?"
  const [hasSent, setHasSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // UX pacing only, not a security control -- the real protection against
  // rapid-fire resends is Supabase's own per-email/per-IP rate limiting on
  // the OTP endpoint (see supabase/config.toml's [auth.rate_limit]). This
  // just stops someone mashing "Resend" a dozen times in ten seconds while
  // wondering where the email is.
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
    if (!syntaxValid || status === "submitting") return

    setStatus("submitting")
    setErrorMessage(null)
    setLinkError(false)
    setSessionUpdated(false)
    setSessionSuspended(false)
    setRememberCookie(rememberMe)
    const result = await submitLogin(email)

    if (result.ok) {
      setStatus("sent")
      setHasSent(true)
      setResendCooldown(30)
    } else {
      setStatus("error")
      setErrorMessage(result.message)
    }
  }

  if (hasSent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Check your email
        </p>
        <h1 className="font-display text-display-l text-ink">Almost there</h1>
        <p className="max-w-sm text-base text-ink/60">
          If an Ovalball account exists for <strong className="text-ink">{email}</strong>, a
          sign-in link is on its way. Click it to continue &mdash; you can close this tab.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg"
            disabled={resendCooldown > 0 || status === "submitting"}
            onClick={sendLink}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend link"}
          </Button>
        </div>
        <p className="text-sm text-ink/45">
          Still nothing after a few minutes? Check your spelling above and try again, or{" "}
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
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void sendLink()
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Welcome back
        </p>
        <h1 className="mt-2 font-display text-display-l text-ink">Sign in</h1>
        <p className="mt-3 max-w-sm text-base text-ink/60">
          Enter your email and we&apos;ll send you a one-time sign-in link.
        </p>
      </div>

      {sessionUpdated && (
        <div className="rounded-lg border border-ink/10 bg-white p-4" aria-live="polite">
          <p className="text-sm font-medium text-ink">Ovalball has been updated</p>
          <p className="mt-1 text-sm text-ink/60">For security, please sign in again.</p>
        </div>
      )}

      {sessionSuspended && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4" aria-live="polite">
          <p className="text-sm font-medium text-destructive">Your Ovalball account has been suspended.</p>
          <p className="mt-1 text-sm text-ink/60">
            Please contact Ovalball Support if you believe this is an error.
          </p>
        </div>
      )}

      {linkError && (
        <div className="rounded-lg border border-ink/10 bg-white p-4" aria-live="polite">
          <p className="text-sm font-medium text-ink">That link didn&apos;t work.</p>
          <p className="mt-1 text-sm text-ink/60">
            It may have expired or already been used &mdash; sign-in links are one-time only.
            Enter your email below and we&apos;ll send you a fresh one.
          </p>
        </div>
      )}

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
            if (sessionUpdated) setSessionUpdated(false)
            if (sessionSuspended) setSessionSuspended(false)
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={showSyntaxError}
          placeholder="you@example.com"
          className={cn(
            "h-11 border-ink/15 bg-white px-3.5 text-base text-ink placeholder:text-ink/35",
            showSyntaxError && "border-destructive focus-visible:border-destructive"
          )}
        />
        {showSyntaxError && (
          <p className="mt-1 text-sm text-destructive">
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
          className="mt-0.5 size-4 shrink-0 rounded border-ink/25 text-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        <span>
          Keep me signed in on this device
          <span className="block text-xs text-ink/45">
            Stay signed in until you sign out or Ovalball requires you to sign in again for
            security. Turn this off on a shared or public computer.
          </span>
        </span>
      </label>

      <div aria-live="polite">
        {status === "error" && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage ?? "Something went wrong. Please try again."}
          </p>
        )}
      </div>

      <Button
        type="submit"
        className="h-11 rounded-lg px-6"
        disabled={!syntaxValid || status === "submitting"}
      >
        {status === "submitting" ? "Sending…" : "Send sign-in link"}
      </Button>

      <p className="text-center text-sm text-ink/50">
        New to Ovalball?{" "}
        <Link
          href={email ? `/signup?email=${encodeURIComponent(email)}` : "/signup"}
          className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          Create an account
        </Link>
      </p>

      {/* Restrained by design: present and reachable, but visually quiet so
          they don't compete with signing in. */}
      <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink/40">
        <Link href="/legal/privacy" className="py-1 underline-offset-2 hover:text-ink/70 hover:underline focus-visible:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none">
          Privacy
        </Link>
        <Link href="/legal/terms" className="py-1 underline-offset-2 hover:text-ink/70 hover:underline focus-visible:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none">
          Terms
        </Link>
        <Link href="/legal/cookies" className="py-1 underline-offset-2 hover:text-ink/70 hover:underline focus-visible:text-ink/70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none">
          Cookies
        </Link>
      </nav>
    </form>
  )
}
