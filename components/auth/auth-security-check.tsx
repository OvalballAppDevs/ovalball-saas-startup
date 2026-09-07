"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The anti-bot checkpoint, as one quiet line.
 *
 * This replaces an earlier slider that was rejected on review, and it was
 * right to reject it: a range control cannot prove anything about who is
 * operating it -- pointer, touch and keyboard events are all automatable --
 * so it occupied the top of the sign-in page while contributing no security
 * at all. Cloudflare Turnstile was always the real boundary underneath it;
 * this component simply stops pretending the gesture mattered.
 *
 * Behaviour now: Turnstile runs in interaction-only mode as soon as the form
 * mounts. For almost everyone it resolves silently and all that ever appears
 * is a small "Verified" line. A visitor Cloudflare actually wants to
 * challenge gets the widget inline, at compact size, at the moment it is
 * needed -- challenge on demand, rather than a permanent obstacle.
 *
 * The server contract is unchanged: lib/auth/turnstile.ts verifies the token
 * against Cloudflare before an email is sent or an OAuth flow starts, and
 * fails closed. Nothing here is trusted.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          "error-callback"?: () => void
          "expired-callback"?: () => void
          appearance?: "always" | "execute" | "interaction-only"
          size?: "normal" | "flexible" | "compact"
          action?: string
        }
      ) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type Phase = "checking" | "verified" | "failed"

export function AuthSecurityCheck({
  siteKey,
  action,
  onVerified,
  className,
}: {
  siteKey: string
  action: string
  onVerified: (token: string) => void
  className?: string
}) {
  const [phase, setPhase] = useState<Phase>("checking")
  const widgetRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  // Kept in a ref so a parent re-render never re-registers the widget, and
  // written in an effect rather than during render.
  const onVerifiedRef = useRef(onVerified)
  useEffect(() => {
    onVerifiedRef.current = onVerified
  }, [onVerified])

  const render = useCallback(() => {
    const el = widgetRef.current
    if (!el || !window.turnstile || widgetIdRef.current) return
    widgetIdRef.current = window.turnstile.render(el, {
      sitekey: siteKey,
      action,
      appearance: "interaction-only",
      size: "flexible",
      callback: (token: string) => {
        setPhase("verified")
        onVerifiedRef.current(token)
      },
      "error-callback": () => setPhase("failed"),
      "expired-callback": () => {
        // A spent or stale token is not a failure the visitor caused; ask
        // Cloudflare for a fresh one rather than showing an error.
        setPhase("checking")
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current)
      },
    })
  }, [siteKey, action])

  useEffect(() => {
    if (window.turnstile) {
      render()
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener("load", render, { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener("load", render, { once: true })
    script.addEventListener("error", () => setPhase("failed"), { once: true })
    document.head.appendChild(script)
  }, [render])

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [])

  function retry() {
    setPhase("checking")
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
    } else {
      widgetIdRef.current = null
      render()
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* The widget container. Stays empty (and takes no space) unless
          Cloudflare decides this visitor needs an actual challenge. */}
      <div ref={widgetRef} className="empty:hidden" />

      <p
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-1.5 text-xs",
          phase === "failed" ? "text-destructive-text" : "text-ink-muted"
        )}
      >
        {phase === "verified" ? (
          <>
            <Check className="size-3.5 shrink-0 text-forest-800" strokeWidth={3} aria-hidden="true" />
            <span className="text-forest-800">Security check passed</span>
          </>
        ) : phase === "failed" ? (
          <>
            <span>We couldn&apos;t complete the security check.</span>
            <button
              type="button"
              onClick={retry}
              className="font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Checking your browser&hellip;</span>
          </>
        )}
      </p>
    </div>
  )
}
