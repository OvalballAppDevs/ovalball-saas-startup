"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { generateObligationsForCurrentPeriod } from "./actions"

/** Obligations don't magically exist -- an admin (or a future scheduled job) explicitly generates them for a period, idempotently (a repeat click for the same period creates nothing new). */
export function GenerateObligationsButton({ clubId, billingPeriod, monthLabel }: { clubId: string; billingPeriod: string; monthLabel: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)

  async function handleClick() {
    setStatus("loading")
    setMessage(null)
    const result = await generateObligationsForCurrentPeriod(clubId, billingPeriod)
    if (result.ok) {
      setStatus("idle")
      setMessage(`Obligations generated for ${monthLabel}.`)
      router.refresh()
    } else {
      setStatus("error")
      setMessage(result.error)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={status === "loading"} aria-busy={status === "loading"} onClick={handleClick}>
        {status === "loading" ? "Generating…" : `Generate Obligations for ${monthLabel}`}
      </Button>
      <span role="status" className={`text-xs ${status === "error" ? "text-destructive-text" : "text-ink-muted"}`}>
        {message ?? ""}
      </span>
    </div>
  )
}
