"use client"

import { useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"

import { safeNextPath } from "@/lib/auth/safe-next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { verifyTotpChallenge } from "./actions"

export function VerifyFlow({ factorId }: { factorId: string }) {
  const searchParams = useSearchParams()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const result = await verifyTotpChallenge(factorId, code)
      if (!result.ok) {
        setError(result.error)
        setCode("")
        return
      }
      // A full page load, so the new assurance is on the very next server render rather than a
      // cached one that still thinks this session is AAL1.
      //
      // THROUGH safeNextPath, WHICH THIS LINE USED TO SKIP. It read `next` straight off the query
      // string, so /security/verify?next=https://evil.example sent a person who had just passed their
      // second factor to another origin. Slice 5 fixed precisely this on the password path, and
      // safe-next.ts's own header predicted the rest: "two copies of an open-redirect guard is exactly
      // how one of them drifts." This was a third consumer that never called it.
      window.location.assign(safeNextPath(searchParams.get("next")))
    })
  }

  return (
    <form className="mt-8 rounded-lg border border-ink/10 bg-white p-5" onSubmit={submit}>
      <Label htmlFor="verify-code">Six-Digit Code</Label>
      <Input
        id="verify-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        className="mt-2 max-w-40 font-mono text-lg tracking-[0.3em]"
      />
      <Button type="submit" className="mt-4 h-11 px-6" disabled={pending || code.length < 6}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <p className="mt-5 border-t border-ink/10 pt-4 text-sm text-ink/70">
        Lost your phone?{" "}
        <a href="/security/recovery" className="font-medium text-forest-800 underline underline-offset-4">
          Use a recovery code
        </a>
        .
      </p>
    </form>
  )
}
