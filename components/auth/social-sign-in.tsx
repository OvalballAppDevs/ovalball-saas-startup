"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-providers"
import { startOAuthSignIn } from "@/app/auth/oauth-actions"

/**
 * The provider buttons.
 *
 * Renders nothing at all when no provider is enabled, so shipping this
 * component changes no page until a provider is genuinely configured --
 * that is what makes the activation order in the brief real rather than
 * aspirational.
 *
 * Initiation goes through a server action so the human-verification token
 * is checked before an OAuth flow starts. `turnstileToken` is whatever the
 * checkpoint produced; the server decides whether that is acceptable, and
 * this component never treats a local value as permission.
 *
 * Provider marks: each provider's brand guidance requires their own
 * official asset, and drawing an approximation of the Google G or the Apple
 * logo from memory would produce a misleading near-copy. Until the official
 * SVGs are added under /public/brand/, these render as correctly-worded
 * text buttons -- which is permitted, whereas a wrong mark is not.
 */
export function SocialSignIn({
  turnstileToken,
  ready,
  next,
  className,
}: {
  turnstileToken: string | null
  /** False until the human check has been satisfied. */
  ready: boolean
  next?: string
  className?: string
}) {
  const providers = getEnabledOAuthProviders()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (providers.length === 0) return null

  async function start(providerId: string) {
    if (!ready || pending) return
    setPending(providerId)
    setError(null)
    const result = await startOAuthSignIn(providerId, next ?? null, turnstileToken)
    if (result.ok) {
      window.location.assign(result.url)
      return
    }
    setPending(null)
    setError(result.error)
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => start(provider.id)}
          disabled={!ready || pending !== null}
          aria-describedby={!ready ? "social-locked-hint" : undefined}
          className={cn(
            "flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
            "border-ink/15 bg-white text-ink hover:border-ink/35",
            "disabled:cursor-not-allowed disabled:opacity-45"
          )}
        >
          {pending === provider.id ? "Redirecting…" : provider.label}
        </button>
      ))}

      {!ready && (
        <p id="social-locked-hint" className="text-xs text-ink/45">
          Complete the security check above to continue.
        </p>
      )}

      <div aria-live="polite">
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
