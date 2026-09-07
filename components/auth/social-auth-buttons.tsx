"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-providers"
import { PROVIDER_MARKS } from "@/components/auth/provider-marks"
import { startOAuthSignIn } from "@/app/auth/oauth-actions"

/**
 * The provider buttons, designed as a set.
 *
 * Each carries its provider's own mark at a fixed 18px optical size, with
 * mark and label centred together as one unit so the three buttons read as
 * a matched set rather than three rectangles with text hanging off the left.
 * The 18px slot is fixed-width so a wider mark never nudges its label out of
 * line with the others.
 *
 * Ovalball's own surface stays neutral (white card, ink text, forest focus
 * ring) so the provider marks are the only colour in the group. Recolouring
 * a button to a provider's brand colour would both fight Ovalball's palette
 * and breach their brand guidance.
 *
 * Renders nothing when no provider is enabled, so the surrounding layout
 * collapses cleanly rather than leaving an empty "or" divider behind.
 */
export function SocialAuthButtons({
  turnstileToken,
  ready,
  next,
  /** "signin" | "signup" -- only affects the accessible name. */
  intent = "signin",
  className,
}: {
  turnstileToken: string | null
  ready: boolean
  next?: string
  intent?: "signin" | "signup"
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
      {providers.map((provider) => {
        const Mark = PROVIDER_MARKS[provider.id]
        const isPending = pending === provider.id
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => start(provider.id)}
            disabled={!ready || pending !== null}
            className={cn(
              // Centred as a unit: mark and label sit together in the middle
              // of the button rather than the label starting hard left.
              "group relative flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border px-4 text-[15px] font-medium",
              "transition-[transform,box-shadow,border-color] duration-150",
              // Gentle dimensionality: a top inner highlight and a soft
              // ground shadow, so the button reads as a raised key rather
              // than a flat rectangle. Deliberately restrained -- no bevel,
              // no heavy drop shadow.
              "border-ink/12 bg-gradient-to-b from-white to-[#f6f8f6] text-ink",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_1px_rgba(16,21,18,0.05),0_2px_4px_rgba(16,21,18,0.06)]",
              "hover:-translate-y-px hover:border-ink/22 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_3px_rgba(16,21,18,0.07),0_6px_12px_rgba(16,21,18,0.09)]",
              "active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(16,21,18,0.10)]",
              "focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:border-ink/12"
            )}
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center">
              {isPending ? (
                <Loader2 className="size-[18px] animate-spin text-ink-muted" aria-hidden="true" />
              ) : (
                <Mark className="size-[18px]" />
              )}
            </span>
            <span>{isPending ? "Redirecting…" : provider.label}</span>
            <span className="sr-only">
              {intent === "signup" ? " to create your Ovalball account" : " to your Ovalball account"}
            </span>
          </button>
        )
      })}

      <div aria-live="polite">
        {error && <p className="mt-1 text-sm text-destructive-text">{error}</p>}
      </div>
    </div>
  )
}

/** The "or" rule between provider buttons and the email path. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-orientation="horizontal">
      <span aria-hidden="true" className="h-px flex-1 bg-ink/10" />
      <span className="text-[11px] tracking-[0.1em] text-ink-muted uppercase">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-ink/10" />
    </div>
  )
}
