"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { requestEmailChange } from "./actions"

export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [editing, setEditing] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setStatus("sending")
    setError(null)
    const result = await requestEmailChange(newEmail)
    if (result.ok) {
      setStatus("sent")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Account</p>
      <p className="mt-1 text-xs text-ink/45">Email</p>
      <p className="text-sm text-ink">{currentEmail}</p>

      {status === "sent" ? (
        <p className="mt-3 rounded-lg border border-pitch-600/20 bg-pitch-600/5 px-3.5 py-2.5 text-sm text-forest-800">
          Check <span className="font-medium">{newEmail}</span> for a confirmation link. Your sign-in email won&rsquo;t change until you confirm it.
        </p>
      ) : !editing ? (
        <Button type="button" variant="outline" className="mt-3 h-9" onClick={() => setEditing(true)}>
          Change email
        </Button>
      ) : (
        <div className="mt-3">
          <Label htmlFor="new-email" className="text-ink/80">
            New email address
          </Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-10 w-64 border-ink/15 bg-white"
            />
            <Button type="button" className="h-10" disabled={status === "sending" || !newEmail.trim()} onClick={handleSubmit}>
              {status === "sending" ? "Sending…" : "Send confirmation"}
            </Button>
            <Button type="button" variant="ghost" className="h-10" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink/45">We&rsquo;ll email a confirmation link to the new address before it takes effect.</p>
          {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
