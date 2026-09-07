"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { nominateSafeguardingOfficer } from "./actions"

export function NominateOfficerForm({ clubId, officerType }: { clubId: string; officerType: "primary" | "deputy" }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
        Nominate {officerType === "primary" ? "Safeguarding Officer" : "Deputy Safeguarding Officer"}
      </Button>
    )
  }

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setError("A name and email are required.")
      return
    }
    setWorking(true)
    setError(null)
    const result = await nominateSafeguardingOfficer(clubId, officerType, name.trim(), email.trim())
    setWorking(false)
    if (result.ok) {
      setOpen(false)
      setName("")
      setEmail("")
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-ink/20 bg-white/60 p-4">
      <p className="text-sm font-medium text-ink">Nominate {officerType === "primary" ? "Safeguarding Officer" : "Deputy Safeguarding Officer"}</p>
      <p className="mt-1 text-xs text-ink-muted">
        This adds a contact record only -- it doesn&rsquo;t give this person Ovalball access. Invite them separately once they&rsquo;re nominated.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <div>
          <Label htmlFor={`sg-name-${officerType}`}>Name</Label>
          <Input id={`sg-name-${officerType}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`sg-email-${officerType}`}>Email</Label>
          <Input id={`sg-email-${officerType}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <p className="text-xs text-destructive-text">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={working} onClick={handleSubmit}>
            Nominate
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
