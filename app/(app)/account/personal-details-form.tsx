"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { updatePersonalDetails, type PersonalDetailsInput } from "./actions"

export function PersonalDetailsForm({ initial, dateOfBirth }: { initial: PersonalDetailsInput; dateOfBirth: string | null }) {
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updatePersonalDetails(form)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Personal details</p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="pd-first-name" className="text-ink/80">
            First name
          </Label>
          <Input
            id="pd-first-name"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="pd-surname" className="text-ink/80">
            Surname
          </Label>
          <Input
            id="pd-surname"
            value={form.surname}
            onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))}
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
        </div>
      </div>

      {dateOfBirth && (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Date of birth</p>
          <p className="mt-1 text-sm text-ink/70">
            {new Date(dateOfBirth + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
          <p className="mt-0.5 text-xs text-ink/40">Set at signup. Contact Site Admin if this needs to change.</p>
        </div>
      )}

      <div className="mt-5 border-t border-ink/10 pt-5">
        <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Address</p>
        <p className="mt-1 text-xs text-ink/40">Private -- never shown to other club members, opposition, or in chat.</p>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <Label htmlFor="pd-address1" className="text-ink/80">
              Address line 1
            </Label>
            <Input
              id="pd-address1"
              value={form.addressLine1}
              onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
              className="mt-1.5 h-10 border-ink/15 bg-white"
            />
          </div>
          <div>
            <Label htmlFor="pd-address2" className="text-ink/80">
              Address line 2
            </Label>
            <Input
              id="pd-address2"
              value={form.addressLine2}
              onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
              className="mt-1.5 h-10 border-ink/15 bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pd-town" className="text-ink/80">
                Town / City
              </Label>
              <Input
                id="pd-town"
                value={form.town}
                onChange={(e) => setForm((f) => ({ ...f, town: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
            <div>
              <Label htmlFor="pd-county" className="text-ink/80">
                County
              </Label>
              <Input
                id="pd-county"
                value={form.county}
                onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pd-postcode" className="text-ink/80">
                Postcode
              </Label>
              <Input
                id="pd-postcode"
                value={form.postcode}
                onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
            <div>
              <Label htmlFor="pd-country" className="text-ink/80">
                Country
              </Label>
              <Input
                id="pd-country"
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </div>
  )
}
