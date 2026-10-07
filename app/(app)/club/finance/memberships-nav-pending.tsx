"use client"

import { useLinkStatus } from "next/link"

/**
 * The section a person just chose says it is on its way while the server answers (each section reads the club's
 * board, which can take a moment), so a click never looks ignored. Decorative: the page that arrives is the news.
 */
export function MembershipsNavPending() {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden="true"
      className={`ml-1.5 inline-block size-1.5 rounded-full bg-forest-800 align-middle motion-safe:animate-pulse ${pending ? "visible" : "invisible"}`}
    />
  )
}
