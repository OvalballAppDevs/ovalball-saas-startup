"use client"

import { useState, useSyncExternalStore } from "react"
import { Check, Link2, Share2 } from "lucide-react"

import { cn } from "@/lib/utils"

import { FOCUS_LIGHT } from "./primitives"

/**
 * Share an article the way clubs actually do: copy the link for a group chat,
 * or hand it to the phone's own share sheet. The WhatsApp, Facebook and email
 * options are ordinary links, so they work without this component's script.
 */
const noSubscription = () => () => {}

export function ShareActions({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)
  // Whether this device has a native share sheet. False while server
  // rendering, so the button only appears once the browser can honour it.
  const canShare = useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === "function",
    () => false
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const chip = cn(FOCUS_LIGHT, "inline-flex min-h-10 items-center gap-2 rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:border-ink/40")
  const text = encodeURIComponent(`${title} ${url}`)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} className={chip}>
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Link2 aria-hidden="true" className="size-4" />}
        {copied ? "Link Copied" : "Copy Link"}
      </button>
      {canShare && (
        <button type="button" onClick={() => navigator.share({ title, url }).catch(() => undefined)} className={chip}>
          <Share2 aria-hidden="true" className="size-4" />
          Share
        </button>
      )}
      <a href={`https://wa.me/?text=${text}`} target="_blank" rel="noopener noreferrer" className={chip}>
        WhatsApp<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" className={chip}>
        Facebook<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`} className={chip}>
        Email
      </a>
      <p className="sr-only" aria-live="polite">
        {copied ? "Link copied to the clipboard" : ""}
      </p>
    </div>
  )
}
