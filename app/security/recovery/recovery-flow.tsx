"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { useRecoveryCode } from "./actions"

export function RecoveryFlow() {
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const result = await useRecoveryCode(code)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Straight to enrolment: the session is still AAL1 and now has no factor at all, which is
      // exactly the state that has to be fixed before anything else happens.
      window.location.assign("/security/enrol")
    })
  }

  return (
    <form className="mt-8 rounded-lg border border-ink/10 bg-white p-5" onSubmit={submit}>
      <Label htmlFor="recovery-code">Recovery Code</Label>
      <Input
        id="recovery-code"
        autoComplete="one-time-code"
        autoFocus
        placeholder="XXXXX-XXXXX"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="mt-2 font-mono tracking-[0.18em] uppercase"
      />
      <p className="mt-2 text-sm text-ink/60">Capitals and dashes do not matter.</p>
      <Button type="submit" className="mt-4 h-11 px-6" disabled={pending || code.trim().length === 0}>
        {pending ? "Checking…" : "Use This Code"}
      </Button>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
