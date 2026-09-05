"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { Button } from "@/components/ui/button"
import {
  EMPTY_SIGNUP_STATE,
  SIGNUP_STEPS,
  type SignupFormState,
  type SignupStep,
  type TeamCategoryGroup,
} from "@/lib/signup/types"

import { ProgressIndicator } from "./progress-indicator"
import { STEP_IMAGERY } from "./step-imagery"
import { AccountStep } from "./steps/account-step"
import { ClubStep, type ClubStepHandle } from "./steps/club-step"
import { PersonalDetailsStep } from "./steps/personal-details-step"
import { ReviewStep } from "./steps/review-step"
import { submitSignup } from "./submit-signup"

const DEFAULT_STEP: SignupStep = "account"

function isSignupStep(value: unknown): value is SignupStep {
  return typeof value === "string" && (SIGNUP_STEPS as readonly string[]).includes(value)
}

/**
 * Owns the wizard's form state (step navigation lives in the URL -- see
 * below) and the whole split layout, so the left brand panel's imagery can
 * change with the current step. Every surface here is locked to explicit
 * brand tokens (bg-chalk, text-ink, etc.) rather than the theme-dependent
 * bg-background/text-foreground -- this route has no dark-mode variant of
 * its own, so it must never inherit the site-wide dark mode toggle, which
 * was otherwise silently flipping this whole page to a near-black
 * background with dark-on-dark text.
 *
 * Step is driven by the `?step=` URL param via next/navigation's router,
 * not raw window.history calls: the App Router owns the History API for
 * client-side navigation, and a manual history.pushState/back() fights it --
 * concretely, it caused Next's router to hard-reset the whole page (wiping
 * all form state back to its initial values) on the very next back
 * navigation, which is a much worse bug than the one it was fixing. Routing
 * through useRouter()/useSearchParams() lets Next's own router manage the
 * history stack correctly, and the browser's native back/forward and OS
 * back gesture work automatically as a result, with no manual listener.
 *
 * Stepping back never clears previously entered values -- formState is
 * only ever merged, never reset. STEP 4's "Confirm and continue" calls
 * submitSignup, which only ever sends a one-time sign-in email -- no
 * profile/claim/join-request/directory-request row is written until the
 * user actually clicks that email link and /auth/callback runs with a real
 * session. See submit-signup.ts and complete-signup.ts for the full
 * sequence and why it has to be split across those two points.
 */
export function SignupShell({ teamCategoryGroups }: { teamCategoryGroups: TeamCategoryGroup[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stepParam = searchParams.get("step")
  const step = isSignupStep(stepParam) ? stepParam : DEFAULT_STEP

  const [formState, setFormState] = useState<SignupFormState>(() => {
    const prefillEmail = searchParams.get("email")
    return prefillEmail ? { ...EMPTY_SIGNUP_STATE, email: prefillEmail } : EMPTY_SIGNUP_STATE
  })
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle"
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Separate from submitStatus for the same reason as login-form.tsx's
  // identical hasSent: a resend sets submitStatus back to "submitting"
  // momentarily, and without this the check-your-email screen would flip
  // back to the full wizard for that instant.
  const [hasSubmitted, setHasSubmitted] = useState(false)
  // UX pacing only (see login-form.tsx's identical comment) -- Supabase's
  // own [auth.rate_limit] is the real protection against resend abuse.
  const [resendCooldown, setResendCooldown] = useState(0)
  const clubStepRef = useRef<ClubStepHandle>(null)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const stepIndex = SIGNUP_STEPS.indexOf(step)
  const imagery = STEP_IMAGERY[step]

  function canAdvance(): boolean {
    switch (step) {
      case "account":
        return /\S+@\S+\.\S+/.test(formState.email)
      case "details":
        return (
          formState.personal.firstName.trim().length > 0 &&
          formState.personal.surname.trim().length > 0
        )
      case "club":
        return formState.club.kind !== "unselected"
      case "review":
        return formState.termsAccepted
    }
  }

  function goToStep(nextStep: SignupStep) {
    router.push(`/signup?step=${nextStep}`)
  }

  // No existence check here -- an earlier version called checkExistingAccount
  // on this step and showed "you already have an account" before the user
  // could proceed. That was a real account-enumeration oracle (type an
  // email, learn instantly whether it's registered), so this step now only
  // validates the email's syntax (see canAdvance) before continuing.
  // submitSignup's own signInWithOtp call at the end of the wizard already
  // handles an existing email safely: it just sends that person a normal
  // sign-in link, and completeSignupIfNeeded's own idempotency guard (an
  // existing profile is a no-op) means the freshly-collected wizard data is
  // silently discarded rather than duplicated if they follow it.
  function goNext() {
    const nextIndex = stepIndex + 1
    if (nextIndex < SIGNUP_STEPS.length) goToStep(SIGNUP_STEPS[nextIndex])
  }

  function goBack() {
    // Give the club step first refusal -- it may have its own sub-screen to
    // step back through before the wizard moves to the previous top-level
    // step. See ClubStepHandle for why this exists.
    if (step === "club" && clubStepRef.current?.handleBack()) return
    if (stepIndex === 0) return
    // router.back() (not goToStep) so this is indistinguishable from the
    // browser's own back button/gesture -- Next's router owns the actual
    // history entry either way.
    router.back()
  }

  async function handleSubmit() {
    setSubmitStatus("submitting")
    setSubmitError(null)
    const result = await submitSignup(formState)
    if (result.ok) {
      setSubmitStatus("sent")
      setHasSubmitted(true)
      setResendCooldown(30)
    } else {
      setSubmitStatus("error")
      setSubmitError(result.error)
    }
  }

  return (
    <main className="brand-light-scope grid min-h-screen grid-cols-1 bg-chalk md:grid-cols-2">
      {/* Desktop brand panel -- image changes per step, crossfading rather
          than hard-cutting so it never feels like a jarring page reload. */}
      <div className="relative hidden overflow-hidden bg-forest-950 md:block">
        {SIGNUP_STEPS.map((s) => (
          <Image
            key={s}
            src={STEP_IMAGERY[s].src}
            alt={STEP_IMAGERY[s].alt}
            fill
            className={`object-cover transition-opacity duration-700 ease-out ${
              s === step ? "opacity-100" : "opacity-0"
            }`}
            sizes="50vw"
            priority={s === "account"}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/95 via-forest-950/50 to-forest-950/25" />

        <div className="relative flex h-full flex-col justify-between p-10 lg:p-14">
          <div className="flex items-center justify-between">
            <Link href="/" className="w-fit">
              <OvalballLogo variant="dark" />
            </Link>
            <span className="font-display text-sm tracking-[0.08em] text-white/70">
              {String(stepIndex + 1).padStart(2, "0")} / {String(SIGNUP_STEPS.length).padStart(2, "0")}
            </span>
          </div>

          <div>
            <p
              key={step}
              className="max-w-sm font-display text-display-l text-white"
            >
              {imagery.line}
            </p>
            <div className="mt-6 flex gap-1.5">
              {SIGNUP_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i <= stepIndex ? "w-8 bg-pitch-600" : "w-4 bg-white/25"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Form panel -- explicitly light-locked (bg-chalk/text-ink), never
          the theme-dependent bg-background/text-foreground. */}
      <div className="flex flex-col bg-chalk">
        {/* Compact mobile brand strip -- not the desktop panel's full image
            (kept deliberately light per the brief: "no giant decorative
            panel consuming the screen"), but still carries the same
            per-step supportive line and progress dots so mobile isn't a
            bare, unbranded form. */}
        <div className="border-b border-ink/8 px-4 pt-5 pb-4 md:hidden">
          <div className="flex items-center justify-between">
            <Link href="/">
              <OvalballLogo variant="light" />
            </Link>
            <div className="flex gap-1">
              {SIGNUP_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i <= stepIndex ? "w-5 bg-pitch-600" : "w-2.5 bg-ink/12"
                  }`}
                />
              ))}
            </div>
          </div>
          <p className="mt-3 text-sm text-ink/55">{imagery.line}</p>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 py-8 md:items-center md:px-12 md:py-16 lg:px-20">
          {hasSubmitted ? (
            <div className="flex w-full max-w-lg flex-col gap-4">
              <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
                Check your email
              </p>
              <h1 className="font-display text-display-l text-ink">
                We&apos;ve sent you a link
              </h1>
              <p className="max-w-sm text-base text-ink/60">
                Click the link we sent to <strong className="text-ink">{formState.email}</strong>{" "}
                to confirm your account. You can close this tab &mdash; nothing else to do here.
              </p>
              <p className="text-sm text-ink/45">
                Your club request won&apos;t be submitted until you confirm your email.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg"
                  disabled={resendCooldown > 0 || submitStatus === "submitting"}
                  onClick={handleSubmit}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend email"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-lg text-ink/60"
                  onClick={() => {
                    setSubmitStatus("idle")
                    setHasSubmitted(false)
                    goToStep("account")
                  }}
                >
                  Use a different email
                </Button>
              </div>
            </div>
          ) : (
          <div className="flex w-full max-w-lg flex-col gap-8">
            <ProgressIndicator current={step} />

            <div key={step} className="animate-signup-step-in">
              {step === "account" && (
                <AccountStep
                  email={formState.email}
                  onChange={(email) => setFormState((prev) => ({ ...prev, email }))}
                />
              )}

              {step === "details" && (
                <PersonalDetailsStep
                  value={formState.personal}
                  onChange={(personal) => setFormState((prev) => ({ ...prev, personal }))}
                />
              )}

              {step === "club" && (
                <ClubStep
                  ref={clubStepRef}
                  teamCategoryGroups={teamCategoryGroups}
                  rugbyCode={formState.rugbyCode}
                  onRugbyCodeChange={(rugbyCode) =>
                    setFormState((prev) => ({ ...prev, rugbyCode, club: { kind: "unselected" } }))
                  }
                  onRugbyCodeClear={() =>
                    setFormState((prev) => ({ ...prev, rugbyCode: null, club: { kind: "unselected" } }))
                  }
                  club={formState.club}
                  onClubChange={(club) => setFormState((prev) => ({ ...prev, club }))}
                  onAdvance={goNext}
                />
              )}

              {step === "review" && (
                <ReviewStep
                  value={formState}
                  onTermsChange={(termsAccepted) =>
                    setFormState((prev) => ({ ...prev, termsAccepted }))
                  }
                  onEditStep={goToStep}
                />
              )}
            </div>

            {step === "review" && submitStatus === "error" && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {submitError ?? "Something went wrong. Please try again."}
              </p>
            )}

            <div className="flex items-center justify-between border-t border-ink/10 pt-6">
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-lg text-ink/70 hover:bg-ink/5 hover:text-ink"
                onClick={goBack}
                disabled={stepIndex === 0 || submitStatus === "submitting"}
              >
                Back
              </Button>

              {step === "review" ? (
                <Button
                  type="button"
                  className="h-11 rounded-lg px-6"
                  disabled={!canAdvance() || submitStatus === "submitting"}
                  onClick={handleSubmit}
                >
                  {submitStatus === "submitting" ? "Sending…" : "Confirm and continue"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-11 rounded-lg px-6"
                  onClick={goNext}
                  disabled={!canAdvance()}
                >
                  Continue
                </Button>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </main>
  )
}
