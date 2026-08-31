"use client"

import Image from "next/image"
import { useRef } from "react"

import { useReducedMotion } from "@/lib/motion/use-reduced-motion"
import { useScrollProgress } from "@/lib/motion/use-scroll-progress"

/**
 * A pinned, scroll-driven reveal rather than a static image-beside-text
 * block: the section is a tall track (220vh) with a sticky viewport-height
 * stage inside it. As the visitor scrolls through the track, one continuous
 * progress value (0-1, written directly to refs every rAF tick, never React
 * state) drives four things at once: the image crops in tighter to fully
 * revealed, a dark overlay lifts to let the image read clearly, the
 * headline crossfades from the problem statement to the resolution, and
 * the two headlines drift at slightly different depths for a subtle
 * parallax separation.
 *
 * Reduced motion gets the fully resolved final state, statically, in normal
 * document flow (no pinning, no tall track) -- never a shorter version of
 * the same animation.
 */
export function EmotionSection() {
  const reducedMotion = useReducedMotion()

  const imageRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const text1Ref = useRef<HTMLDivElement | null>(null)
  const text2Ref = useRef<HTMLDivElement | null>(null)

  const trackRef = useScrollProgress((progress) => {
    const image = imageRef.current
    const overlay = overlayRef.current
    const text1 = text1Ref.current
    const text2 = text2Ref.current
    if (!image || !overlay || !text1 || !text2) return

    // Crop tight -> full-bleed across the whole track.
    const crop = 22 * (1 - Math.min(1, progress / 0.65))
    image.style.clipPath = `inset(${crop}% ${crop * 1.3}% ${crop}% ${crop * 1.3}%)`

    // Dark -> light: the overlay lifts across the first two-thirds.
    overlay.style.opacity = String(Math.max(0.12, 0.82 - progress * 1.1))

    // Headline crossfade with a brief hold either side ("text locks
    // briefly while the image changes") and a small parallax drift.
    const out1 = Math.min(1, Math.max(0, (progress - 0.32) / 0.16))
    const in2 = Math.min(1, Math.max(0, (progress - 0.48) / 0.18))
    text1.style.opacity = String(1 - out1)
    text1.style.transform = `translateY(${-out1 * 24}px)`
    text2.style.opacity = String(in2)
    text2.style.transform = `translateY(${(1 - in2) * 24}px)`
  })

  if (reducedMotion) {
    return (
      <section className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-forest-950">
        <Image
          src="/images/muddy-boots.png"
          alt="A muddy rugby boot mid-stride on a rain-soaked pitch, with players and goalposts blurred in the background"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-forest-950/20" />
        <p className="relative px-4 text-center font-display text-display-xl text-white">
          Ovalball connects it.
        </p>
      </section>
    )
  }

  return (
    <section ref={trackRef as React.RefObject<HTMLElement>} className="relative h-[220vh]">
      <div className="sticky top-0 h-screen overflow-hidden bg-forest-950">
        <div ref={imageRef} className="absolute inset-0">
          <Image
            src="/images/muddy-boots.png"
            alt="A muddy rugby boot mid-stride on a rain-soaked pitch, with players and goalposts blurred in the background"
            fill
            className="object-cover"
            sizes="100vw"
          />
        </div>
        <div ref={overlayRef} className="absolute inset-0 bg-forest-950" />

        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div ref={text1Ref} className="absolute px-4 text-center">
            <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
              The game
            </p>
            <p className="mt-3 font-display text-display-xl text-white">
              Grassroots rugby is complex.
            </p>
          </div>
          <div ref={text2Ref} className="absolute px-4 text-center opacity-0">
            <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
              The platform
            </p>
            <p className="mt-3 font-display text-display-xl text-white">
              Ovalball connects it.
            </p>
            <p className="mx-auto mt-4 max-w-md text-base text-white/75 md:text-lg">
              Fixtures, teams, contacts and communication are scattered across
              spreadsheets, group chats and paper team sheets. Ovalball brings
              it into one place, built for the way clubs actually run.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
