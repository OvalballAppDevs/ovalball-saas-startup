"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { generateObligationsForCurrentPeriod } from "./actions"

/** Obligations don't magically exist -- an admin (or a future scheduled job) explicitly generates them for a period, idempotently (a repeat click for the same period creates nothing new). */
export function GenerateObligationsButton({ clubId, billingPeriod }: { clubId: string; billingPeriod: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)

  async function handleClick() {
    setStatus("loading")
    setMessage(null)
    const result = await generateObligationsForCurrentPeriod(clubId, billingPeriod)
    if (result.ok) {
      setStatus("idle")
      setMessage("Obligations generated for this period.")
    } else {
      setStatus("error")
      setMessage(result.error)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" className="h-9" disabled={status === "loading"} onClick={handleClick}>
        {status === "loading" ? "Generating…" : "Generate this month's obligations"}
      </Button>
      {message && <span className={`text-xs ${status === "error" ? "text-destructive" : "text-ink/50"}`}>{message}</span>}
    </div>
  )
}
