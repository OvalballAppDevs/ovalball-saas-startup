"use client"

import { useEffect, useRef } from "react"

import { useReducedMotion } from "./use-reduced-motion"

/**
 * Restrained "magnetic" hover: the returned ref's element nudges a few px
 * toward the pointer while hovered, on desktop pointer devices only. Never
 * engages on touch (`hover`/`pointer: fine` gate) or under
 * prefers-reduced-motion. Writes `transform` straight to the DOM node from
 * inside a rAF, never through React state, so hovering never triggers a
 * re-render -- same discipline as useScrollProgress.
 *
 * Intended for a wrapping element around a single control (e.g. the header's
 * Log in button), not for every nav link -- one listener, not several.
 */
export function useMagnetic<T extends HTMLElement>(strength = 10) {
  const ref = useRef<T | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion) return
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return

    let frame = 0

    function onMove(event: PointerEvent) {
      const rect = el!.getBoundingClientRect()
      const x = ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * strength
      const y = ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * strength
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el!.style.transform = `translate(${x}px, ${y}px)`
      })
    }

    function onLeave() {
      cancelAnimationFrame(frame)
      el!.style.transform = ""
    }

    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerleave", onLeave)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerleave", onLeave)
      el.style.transform = ""
    }
  }, [reducedMotion, strength])

  return ref
}
