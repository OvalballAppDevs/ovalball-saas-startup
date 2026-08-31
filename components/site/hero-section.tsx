"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Reveal } from "@/lib/motion/reveal"

// Marketing copy kept as a plain, easy-to-edit list -- not wired to any CMS
// yet, just isolated from layout/markup so it's a one-line change later.
const HEADLINE_LINES = ["YOUR CLUB.", "YOUR TEAMS.", "YOUR FIXTURES."]
const HEADLINE_ACCENT_LINE = "ONE PLATFORM."
const EYEBROW = "Rugby, connected."
const SUBHEAD = "Powering rugby clubs across Rugby Union and Rugby League."

type IrisState = "open" | "closed" | "opening"

const IRIS_SESSION_KEY = "ovalball-iris-seen"

export function HeroSection() {
  // Defaults to fully open/visible so there is never an SSR/hydration flash
  // -- the closed->opening sequence, when it plays at all, is layered on
  // top client-side after mount, never gating first paint.
  const [iris, setIris] = useState<IrisState>("open")

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    if (prefersReducedMotion) return

    if (sessionStorage.getItem(IRIS_SESSION_KEY)) return
    sessionStorage.setItem(IRIS_SESSION_KEY, "1")

    // This is a one-time imperative animation kickoff (gated on
    // sessionStorage/matchMedia, both only readable post-mount), not state
    // derived from props/other state, so the effect+setState pattern is the
    // correct tool here -- not a case useSyncExternalStore or a render-time
    // computation could replace. The double rAF below is why: it guarantees
    // the browser paints the "closed" state before we switch to "opening",
    // so the CSS transition actually has a start point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIris("closed")
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setIris("opening"))
    })
    return () => cancelAnimationFrame(raf1)
  }, [])

  return (
    <section className="relative flex min-h-[100svh] items-end overflow-hidden bg-forest-950 pt-28 md:pt-36">
      <div
        className="absolute inset-0"
        data-iris={iris === "open" ? undefined : iris}
      >
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster="/video/hero-poster.jpg"
          aria-hidden="true"
        >
          <source src="/video/hero-mobile.mp4" media="(max-width: 767px)" type="video/mp4" />
          <source src="/video/hero-desktop.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/90 via-forest-950/40 to-forest-950/55" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 pb-16 md:px-8 md:pb-24">
        <div className="max-w-4xl">
          <Reveal>
            <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
              {EYEBROW}
            </p>
          </Reveal>

          <Reveal index={1} as="h1">
            {/* Smaller display scale below md: at display-2xl, 4 stacked
                lines run ~450-500px tall on a short phone viewport and bury
                the hero video the section is built around. */}
            <span className="mt-4 block font-display text-display-xl leading-[0.94] text-white md:text-display-2xl">
              {HEADLINE_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block text-pitch-600">{HEADLINE_ACCENT_LINE}</span>
            </span>
          </Reveal>

          <Reveal index={2}>
            <p className="mt-6 max-w-xl text-base text-white/80 md:text-lg">{SUBHEAD}</p>
          </Reveal>

          <Reveal index={3}>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button
                className="h-11 rounded-lg px-6 text-base md:h-12 md:px-8"
                nativeButton={false}
                render={<Link href="/signup" />}
              >
                Get Started
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-lg border-white/40 bg-transparent px-6 text-base text-white hover:bg-white/10 md:h-12 md:px-8"
                nativeButton={false}
                render={<Link href="#product" />}
              >
                Explore Ovalball
              </Button>
            </div>
          </Reveal>
        </div>
      </div>

      {/* Header watches this to know when to switch from transparent to solid. */}
      <div
        data-nav-sentinel=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[20%] h-px w-full"
      />
    </section>
  )
}
