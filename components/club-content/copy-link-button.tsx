"use client"

import { useState } from "react"
import { Check, Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Copies a public link, and says so where a screen reader will hear it. */
export function CopyLinkButton({ url, label = "Copy Link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2500)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {copied ? "Link Copied" : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied to the clipboard" : ""}
      </span>
    </>
  )
}
