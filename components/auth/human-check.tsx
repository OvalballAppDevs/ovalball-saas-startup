"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Ovalball's security checkpoint: a rugby ball carried to the posts.
 *
 * TWO SEPARATE THINGS ARE HAPPENING HERE, and conflating them would be a
 * security bug:
 *
 *   1. The slider is UX. Pointer, touch and keyboard events are all
 *      trivially automated, so completing it proves nothing at all. It
 *      exists so the checkpoint feels like Ovalball rather than a generic
 *      CAPTCHA, and so there is a deliberate moment before an
 *      authentication request is sent.
 *   2. Cloudflare Turnstile is the actual anti-bot mechanism. The token it
 *      issues is verified server-side (lib/auth/turnstile.ts) before any
 *      auth request is honoured. The parent never treats slider state as
 *      permission -- it waits for `onVerified(token)`.
 *
 * Accessibility is a hard requirement, not a fallback, so the control is a
 * native <input type="range">. That gives keyboard operation (arrows, Home,
 * End, Page keys), touch, pointer, and correct screen-reader semantics
 * without a bespoke drag handler -- there is no drag-only path, and nobody
 * has to make a precise gesture to sign in. Reduced motion is respected by
 * the CSS transition being dropped, never by removing functionality.
 *
 * When Turnstile is not configured, `siteKey` is null: the checkpoint still
 * renders and still gates the form, but it resolves without a token and the
 * server records that no verification was enforced. That keeps a working
 * production sign-in working rather than locking everyone out over a
 * missing key.
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
const COMPLETE_AT = 100

type Phase = "idle" | "sliding" | "checking" | "done" | "failed"

export function HumanCheck({
  siteKey,
  action,
  onVerified,
  className,
}: {
  /** Public Turnstile site key, or null when Turnstile is not configured. */
  siteKey: string | null
  /** Distinguishes what is being protected, e.g. "login" or "signup". */
  action: string
  /** Called once the checkpoint is satisfied. Token is null when unenforced. */
  onVerified: (token: string | null) => void
  className?: string
}) {
  const [value, setValue] = useState(0)
  const [phase, setPhase] = useState<Phase>("idle")
  const widgetRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const sliderId = useId()

  const finish = useCallback(
    (token: string | null) => {
      setPhase("done")
      setValue(COMPLETE_AT)
      onVerified(token)
    },
    [onVerified]
  )

  const runTurnstile = useCallback(() => {
    if (!siteKey) {
      // Nothing configured to verify against; the checkpoint resolves
      // unenforced and the server is told so.
      finish(null)
      return
    }

    setPhase("checking")

    const render = () => {
      const el = widgetRef.current
      if (!el || !window.turnstile) return
      if (widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current)
        return
      }
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: siteKey,
        action,
        // Only show a visible challenge if Cloudflare actually needs one --
        // no deliberate puzzle for a visitor it can already clear.
        appearance: "interaction-only",
        size: "flexible",
        callback: (token: string) => finish(token),
        "error-callback": () => setPhase("failed"),
        "expired-callback": () => {
          widgetIdRef.current = null
          setPhase("failed")
        },
      })
    }

    if (window.turnstile) {
      render()
      return
    }

    // Load the script only when it is actually needed, so a page with no
    // Turnstile configured makes no third-party request at all.
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
  }, [siteKey, action, finish])

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [])

  function onSlide(next: number) {
    if (phase === "done" || phase === "checking") return
    setValue(next)
    if (next >= COMPLETE_AT) {
      runTurnstile()
    } else if (next > 0) {
      setPhase("sliding")
    }
  }

  function retry() {
    widgetIdRef.current = null
    setValue(0)
    setPhase("idle")
  }

  const done = phase === "done"

  return (
    <div className={cn("rounded-xl border border-ink/10 bg-white p-5", className)}>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
        Quick security check
      </p>
      <p className="mt-1.5 text-sm text-ink/60">
        Help us keep Ovalball and our rugby community protected from automated accounts.
      </p>

      {phase === "failed" ? (
        <div className="mt-4">
          <p role="alert" className="text-sm text-destructive">
            We couldn&apos;t complete the security check. Please try again.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 min-h-11 rounded-lg border border-ink/20 px-4 text-sm font-medium text-ink transition-colors hover:border-ink/45 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <label htmlFor={sliderId} className="sr-only">
            Slide the ball to the posts to continue. You can also use the arrow keys, or press End.
          </label>

          <div className="relative">
            {/* The pitch: ball travels left to right towards the posts. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-ink/8"
            >
              <div
                className={cn(
                  "h-full rounded-full bg-pitch-600/70",
                  "motion-safe:transition-[width] motion-safe:duration-150"
                )}
                style={{ width: `${value}%` }}
              />
            </div>

            <input
              id={sliderId}
              type="range"
              min={0}
              max={COMPLETE_AT}
              step={1}
              value={value}
              disabled={done || phase === "checking"}
              onChange={(event) => onSlide(Number(event.target.value))}
              aria-describedby={`${sliderId}-status`}
              aria-valuetext={done ? "Security check complete" : `${value} percent`}
              className="ovalball-human-slider relative z-10 h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none"
            />

            {/* The posts, at the end of the run. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 24"
              className={cn(
                "pointer-events-none absolute top-1/2 right-0 h-6 w-5 -translate-y-1/2",
                done ? "text-pitch-600" : "text-ink/25"
              )}
            >
              <path
                d="M4 23V4M16 23V4M1 8h18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <p
            id={`${sliderId}-status`}
            role="status"
            aria-atomic="true"
            className="mt-3 flex items-center gap-1.5 text-sm"
          >
            {done ? (
              <>
                <Check className="size-4 shrink-0 text-forest-800" strokeWidth={3} aria-hidden="true" />
                <span className="font-medium text-forest-800">Security check complete</span>
              </>
            ) : phase === "checking" ? (
              <span className="text-ink/55">Checking&hellip;</span>
            ) : (
              <span className="text-ink/55">Slide to continue</span>
            )}
          </p>

          {/* Turnstile mounts here. Usually renders nothing visible --
              appearance is interaction-only, so a challenge appears only if
              Cloudflare actually wants one. */}
          <div ref={widgetRef} className="mt-3 empty:mt-0" />
        </div>
      )}
    </div>
  )
}
