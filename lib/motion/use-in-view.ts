"use client"

import { useEffect, useRef, useState } from "react"

/**
 * IntersectionObserver-backed "has this element been scrolled into view"
 * hook, driven by real React state rather than an imperative DOM attribute
 * write. Reveals once and stops observing, same as `Reveal` in reveal.tsx,
 * but state-driven so the visible/hidden class is always derived from a
 * single source of truth at render time -- there is no separate DOM
 * attribute for a later re-render to silently overwrite.
 */
export function useInView<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true)
          observer.unobserve(el)
        }
      }
    }, options)

    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ref, inView }
}
