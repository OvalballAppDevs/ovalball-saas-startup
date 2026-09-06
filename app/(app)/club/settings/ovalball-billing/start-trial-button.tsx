"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { startTrial } from "./actions"

/**
 * Starting the trial is idempotent server-side, so a double click cannot
 * produce two trials. The button still disables while saving, because a
 * control that looks unresponsive gets clicked again.
 */
export function StartTrialButton() {
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setStatus("saving")
    setError(null)
    const result = await startTrial()
    if (result.ok) {
      setStatus("idle")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div>
      <Button type="button" className="h-9" disabled={status === "saving"} onClick={handleClick}>
        {status === "saving" ? "Starting…" : "Start the free trial"}
      </Button>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
