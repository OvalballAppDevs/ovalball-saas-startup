"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { createCanonicalClub, searchPossibleDuplicates, type DuplicateCandidate } from "./actions"

const NATIONS = ["England", "Scotland", "Wales", "Northern Ireland"] as const

const EMPTY_FORM = {
  name: "",
  rugbyCode: "union" as "union" | "league",
  country: "United Kingdom",
  nation: "England" as (typeof NATIONS)[number],
  region: "",
  county: "",
  town: "",
  postcode: "",
  website: "",
  officialEmail: "",
  active: true,
  verificationStatus: "unverified",
  notes: "",
}

/**
 * Two-step Site Admin canonical creation: check for possible existing
 * records first (never automatic, never merged), then create only once the
 * admin has either confirmed nothing matches or deliberately chosen
 * "Create anyway". Required fields stay minimal (name + code); everything
 * else is optional at creation and editable afterward on the detail page.
 */
export function AddClubDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [step, setStep] = useState<"form" | "duplicates">("form")
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([])
  const [checking, setChecking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setForm(EMPTY_FORM)
    setStep("form")
    setCandidates([])
    setError(null)
  }

  async function handleCheck() {
    if (!form.name.trim()) {
      setError("Club name is required.")
      return
    }
    setError(null)
    setChecking(true)
    const found = await searchPossibleDuplicates(form.name, form.postcode, form.rugbyCode)
    setChecking(false)
    if (found.length > 0) {
      setCandidates(found)
      setStep("duplicates")
    } else {
      await handleCreate()
    }
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    const result = await createCanonicalClub(form)
    setCreating(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpen(false)
    reset()
    router.push(`/admin/clubs/${result.directoryId}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button type="button" className="h-10" />}>+ Add club</DialogTrigger>
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === "form" ? "Add a recognised club" : "Possible existing club"}</DialogTitle>
          <DialogDescription>
            {step === "form"
              ? "Creates a new canonical directory entry. We'll check for likely duplicates first."
              : "One or more clubs already look similar. Open an existing record, or create this as a genuinely distinct club."}
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="add-name" className="text-ink/80">
                  Club name
                </Label>
                <Input
                  id="add-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="add-code" className="text-ink/80">
                  Rugby code
                </Label>
                <select
                  id="add-code"
                  value={form.rugbyCode}
                  onChange={(e) => setForm((f) => ({ ...f, rugbyCode: e.target.value as "union" | "league" }))}
                  className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
                >
                  <option value="union">Union</option>
                  <option value="league">League</option>
                </select>
              </div>
              <div>
                <Label htmlFor="add-nation" className="text-ink/80">
                  Nation
                </Label>
                <select
                  id="add-nation"
                  value={form.nation}
                  onChange={(e) => setForm((f) => ({ ...f, nation: e.target.value as (typeof NATIONS)[number] }))}
                  className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
                >
                  {NATIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="add-town" className="text-ink/80">
                  Town
                </Label>
                <Input
                  id="add-town"
                  value={form.town}
                  onChange={(e) => setForm((f) => ({ ...f, town: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                />
              </div>
              <div>
                <Label htmlFor="add-county" className="text-ink/80">
                  County
                </Label>
                <Input
                  id="add-county"
                  value={form.county}
                  onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                />
              </div>
              <div>
                <Label htmlFor="add-postcode" className="text-ink/80">
                  Postcode
                </Label>
                <Input
                  id="add-postcode"
                  value={form.postcode}
                  onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                />
              </div>
              <div>
                <Label htmlFor="add-website" className="text-ink/80">
                  Website
                </Label>
                <Input
                  id="add-website"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                  placeholder="https://"
                />
              </div>
              <div>
                <Label htmlFor="add-email" className="text-ink/80">
                  Official email
                </Label>
                <Input
                  id="add-email"
                  type="email"
                  value={form.officialEmail}
                  onChange={(e) => setForm((f) => ({ ...f, officialEmail: e.target.value }))}
                  className="mt-1.5 h-11 border-ink/15 bg-white"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-ink/75">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="size-4 accent-pitch-600"
              />
              Active (searchable during signup and claim/join flows)
            </label>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="button" className="h-10 w-full" disabled={checking || creating} onClick={handleCheck}>
              {checking ? "Checking for duplicates…" : creating ? "Creating…" : "Continue"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {candidates.map((c) => (
                <li key={c.directoryId} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-ink/50">
                      {[c.town, c.county, c.postcode].filter(Boolean).join(", ") || "No location on file"} &middot;{" "}
                      {c.isActivated ? "Activated" : "Unclaimed"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0"
                    render={<a href={`/admin/clubs/${c.directoryId}`} />}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => setStep("form")}>
                Back
              </Button>
              <Button type="button" variant="destructive" className="h-10 flex-1" disabled={creating} onClick={handleCreate}>
                {creating ? "Creating…" : "Create anyway"}
              </Button>
            </div>
            <p className="text-xs text-ink/45">
              Only choose &ldquo;Create anyway&rdquo; if this is genuinely a distinct club, not the same club listed twice.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
