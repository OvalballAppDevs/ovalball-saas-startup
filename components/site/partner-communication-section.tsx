"use client"

import { Check, Link2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { OvalballMark } from "@/components/brand/ovalball-mark"
import { CONVERSATION_THREAD } from "@/lib/marketing/fixture-demo-data"
import { Reveal } from "@/lib/motion/reveal"
import { useReducedMotion } from "@/lib/motion/use-reduced-motion"

/**
 * Feature Story 3 -- Communicate with Partner Clubs. Deliberately not a
 * generic chat UI: every message is anchored to the one fixture connecting
 * both clubs (shown as a persistent header above the thread, not a chat
 * app's contact list), and the fixture's own status flips to Confirmed
 * automatically once the thread plays out -- the point is that the
 * conversation and the fixture record are the same object, not two
 * separate tools bridged by copy-pasting.
 */
export function PartnerCommunicationSection() {
  const reducedMotion = useReducedMotion()
  // Not derived from reducedMotion at useState's initial-value time: that
  // value comes from useSyncExternalStore, which (correctly) starts at its
  // getServerSnapshot default and only becomes accurate after the client
  // reads the real media query -- an initializer that reads it once at
  // mount could catch it still false and permanently under-initialize
  // these, exactly the "stuck on the placeholder instead of the resolved
  // final state" bug this component shipped with. The effect below is the
  // single place that decides the actual displayed state, every time
  // reducedMotion changes.
  const [visibleCount, setVisibleCount] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (reducedMotion) {
      // Jumping straight to the resolved final state, not a value mirrored
      // from props/other state -- this is the reduced-motion contract this
      // whole codebase uses (see globals.css's [data-reveal] etc.): reduced
      // motion renders the finished state immediately, never a shorter
      // version of the same staged reveal.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleCount(CONVERSATION_THREAD.length)
      setConfirmed(true)
      return
    }
    const el = sectionRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true
            observer.unobserve(el)
            CONVERSATION_THREAD.forEach((_, i) => {
              setTimeout(() => setVisibleCount(i + 1), i * 900)
            })
            setTimeout(
              () => setConfirmed(true),
              CONVERSATION_THREAD.length * 900 + 400
            )
          }
        }
      },
      { threshold: 0.4 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [reducedMotion])

  return (
    <section className="bg-forest-950 py-20 md:py-28">
      <div className="mx-auto max-w-[900px] px-4 md:px-8">
        <Reveal>
          <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
            Communicate with partner clubs
          </p>
          <h2 className="mt-3 font-display text-display-xl text-white">
            One conversation. Both clubs.
          </h2>
          <p className="mt-4 max-w-xl text-base text-white/60 md:text-lg">
            Every message here is attached to the fixture itself &mdash; not
            scattered across email threads and WhatsApp groups.
          </p>
        </Reveal>

        <Reveal index={1}>
          <div ref={sectionRef} className="mt-10 rounded-xl border border-white/10 bg-white/[0.04]">
            {/* Fixture connector header */}
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
              <ClubBadge name="Burnley RUFC" />
              <div className="flex flex-col items-center gap-1">
                <Link2 className="size-4 text-pitch-400" />
                <span className="text-xs text-white/55">Sat 12 Sep &middot; 11:00</span>
              </div>
              <ClubBadge name="Opposition Club" align="right" />
            </div>

            {/* Thread */}
            <div className="flex flex-col gap-3 px-6 py-6">
              {CONVERSATION_THREAD.slice(0, visibleCount).map((message, i) => (
                <div
                  key={i}
                  className={`flex ${message.from === "own" ? "justify-end" : "justify-start"} ${
                    !reducedMotion ? "animate-signup-step-in" : ""
                  }`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg px-4 py-2.5 text-sm ${
                      message.from === "own"
                        ? "bg-pitch-600 text-ink"
                        : "bg-white/10 text-white/85"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}
              {visibleCount === 0 && (
                <p className="py-6 text-center text-sm text-white/30">
                  Scroll to watch the fixture get confirmed.
                </p>
              )}
            </div>

            {/* Status footer -- flips automatically once the thread plays out */}
            <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
              <span className="text-xs text-white/55">Fixture status</span>
              <span
                role="status"
                aria-atomic="true"
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-500 ${
                  confirmed ? "bg-pitch-600/20 text-pitch-400" : "bg-white/8 text-white/65"
                }`}
              >
                {confirmed && <Check className="size-3" strokeWidth={3} />}
                {confirmed ? "Confirmed" : "Awaiting reply"}
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function ClubBadge({ name, align = "left" }: { name: string; align?: "left" | "right" }) {
  return (
    <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <OvalballMark variant="dark" aria-hidden="true" className="h-3.5 w-5 shrink-0" />
      <span className="text-sm font-medium text-white/85">{name}</span>
    </div>
  )
}
