"use client"

import { useEffect, useRef } from "react"

/**
 * Tracks how far the viewport has scrolled through a tall "track" element
 * (0 at the top of the track, 1 once its bottom has scrolled past the
 * bottom of the viewport), rAF-throttled, and hands the raw number to
 * `onProgress` every tick rather than storing it in React state -- callers
 * write derived values (clip-path, opacity, transform) straight to DOM refs,
 * so scrolling never triggers a re-render. Returns the track ref to attach.
 */
export function useScrollProgress(onProgress: (progress: number) => void) {
  const trackRef = useRef<HTMLElement | null>(null)
  const onProgressRef = useRef(onProgress)

  // Keeps the ref pointed at the latest callback without re-subscribing the
  // scroll listener below on every render (that effect intentionally has an
  // empty dependency array).
  useEffect(() => {
    onProgressRef.current = onProgress
  })

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    let ticking = false

    function paint() {
      const rect = track!.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const scrollable = rect.height - viewportHeight
      const progress = scrollable > 0 ? -rect.top / scrollable : 0
      onProgressRef.current(Math.min(1, Math.max(0, progress)))
      ticking = false
    }

    function onScrollOrResize() {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(paint)
      }
    }

    paint()
    window.addEventListener("scroll", onScrollOrResize, { passive: true })
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      window.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [])

  return trackRef
}
