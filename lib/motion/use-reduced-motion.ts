"use client"

import { useSyncExternalStore } from "react"

function subscribe(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// Defaults to `false` (motion allowed) on the server, matching the CSS in
// globals.css which defaults every animated primitive to its final state
// unless `no-preference` is confirmed.
function getServerSnapshot() {
  return false
}

/**
 * Tracks `prefers-reduced-motion` via useSyncExternalStore rather than an
 * effect+setState pair -- this is exactly the "subscribe to an external
 * store" case the hook exists for, and it sidesteps the extra render an
 * effect-driven setState would otherwise cause on mount.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
