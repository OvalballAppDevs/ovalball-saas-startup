"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { updateOwnPhoneNumber } from "./actions"

export function PhoneNumberForm({ initialPhone }: { initialPhone: string | null }) {
  const [phone, setPhone] = useState(initialPhone ?? "")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updateOwnPhoneNumber(phone)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Telephone number</p>
      <p className="mt-1 text-xs text-ink/45">
        Private by default. Only shared when you deliberately share a Contact Card in a fixture conversation.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Label htmlFor="phone-number" className="sr-only">
          Telephone number
        </Label>
        <Input
          id="phone-number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 07700 900123"
          className="h-10 w-56 border-ink/15 bg-white"
        />
        <Button type="button" className="h-10" disabled={status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
