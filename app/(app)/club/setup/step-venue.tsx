"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { AlertCircle, Check, Loader2, MapPin, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createVenueWithPitches } from "./actions"

export interface ExistingVenue {
  id: string
  name: string
  line1: string | null
  town: string | null
  county: string | null
  postcode: string | null
  legacyAddress: string | null
  pitchCount: number
}

/**
 * Step 2 -- the club's home ground and the pitches on it.
 *
 * VENUE AND PITCH ARE CREATED TOGETHER. A venue with no pitch is not a
 * usable home ground: fixtures and training sessions are scheduled onto
 * pitches, and a pitch detached from its venue is rejected by training
 * validation. Splitting these into two screens is what produced clubs with
 * a ground and nowhere to play on it, so this form does both in one
 * submission and the server does them in one action.
 *
 * The address is captured in structured fields rather than one free-text
 * line, because "where is this club playing on Saturday" is a question
 * parents ask on a phone, and a postcode that can be handed to a maps app
 * is worth more than a pretty string.
 */
export function StepVenue({
  existing,
  defaultVenueName,
}: {
  existing: ExistingVenue | null
  defaultVenueName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(defaultVenueName)
  const [line1, setLine1] = useState("")
  const [line2, setLine2] = useState("")
  const [town, setTown] = useState("")
  const [county, setCounty] = useState("")
  const [postcode, setPostcode] = useState("")
  // Two empty rows to start with, because "a ground has more than one
  // pitch" is the common case and an empty list reads as optional.
  const [pitches, setPitches] = useState<string[]>(["Main Pitch", ""])

  function setPitch(i: number, value: string) {
    setPitches((prev) => prev.map((p, j) => (j === i ? value : p)))
  }

  function addPitch() {
    setPitches((prev) => [...prev, ""])
  }

  function removePitch(i: number) {
    setPitches((prev) => (prev.length === 1 ? [""] : prev.filter((_, j) => j !== i)))
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await createVenueWithPitches({
        name,
        line1,
        line2,
        town,
        county,
        postcode,
        country: "United Kingdom",
        latitude: null,
        longitude: null,
        providerRef: null,
        pitchNames: pitches,
        makeDefault: true,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (existing) {
    const addressLine =
      [existing.line1, existing.town, existing.county, existing.postcode].filter(Boolean).join(", ") ||
      existing.legacyAddress ||
      null

    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-ink/10 bg-white">
          <div className="flex items-start gap-3 px-5 py-4">
            <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-mint-100">
              <MapPin className="size-4 text-forest-950" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                {existing.name}
                <span className="rounded-full bg-mint-100 px-2 py-0.5 text-xs font-medium text-forest-950">
                  Home ground
                </span>
              </p>
              {addressLine ? (
                <p className="mt-1 text-sm text-ink/55">{addressLine}</p>
              ) : (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-700">
                  <AlertCircle aria-hidden="true" className="size-3.5" />
                  No address yet
                </p>
              )}
              <p className="mt-2 text-xs text-ink/45">
                {existing.pitchCount === 0
                  ? "No pitches here yet"
                  : `${existing.pitchCount} ${existing.pitchCount === 1 ? "pitch" : "pitches"}`}
              </p>
            </div>
          </div>
        </div>

        <p className="text-sm text-ink/55">
          Add more grounds, more pitches, or change any of this in{" "}
          <Link
            href="/club/venues"
            className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            Venues &amp; Pitches
          </Link>
          . You can come straight back here afterwards.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="rounded-lg border border-ink/10 bg-white p-5 md:p-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="venue-name">Ground name</Label>
            <Input
              id="venue-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Towneley Playing Fields"
              className="mt-1.5"
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">Address</legend>

            <div>
              <Label htmlFor="venue-line1">Street address</Label>
              <Input
                id="venue-line1"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                autoComplete="address-line1"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="venue-line2">
                Address line 2 <span className="font-normal text-ink/45">(optional)</span>
              </Label>
              <Input
                id="venue-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                autoComplete="address-line2"
                className="mt-1.5"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="venue-town">Town or city</Label>
                <Input
                  id="venue-town"
                  value={town}
                  onChange={(e) => setTown(e.target.value)}
                  autoComplete="address-level2"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="venue-county">
                  County <span className="font-normal text-ink/45">(optional)</span>
                </Label>
                <Input
                  id="venue-county"
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                  autoComplete="address-level1"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="sm:max-w-[12rem]">
              <Label htmlFor="venue-postcode">Postcode</Label>
              <Input
                id="venue-postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                autoComplete="postal-code"
                spellCheck={false}
                className="mt-1.5 font-mono uppercase"
              />
              <p className="mt-1.5 text-xs text-ink/45">Used for directions on every fixture here.</p>
            </div>
          </fieldset>
        </div>

        <div className="mt-6 border-t border-ink/8 pt-5">
          <p className="text-sm font-medium text-ink">Pitches at this ground</p>
          <p className="mt-0.5 text-xs text-ink/50">
            Name them the way your club says them out loud &mdash; &ldquo;Main Pitch&rdquo;, &ldquo;Back
            Field&rdquo;, &ldquo;AGP&rdquo;. Fixtures and training are scheduled onto these.
          </p>

          <ul className="mt-3 space-y-2">
            {pitches.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  value={p}
                  onChange={(e) => setPitch(i, e.target.value)}
                  aria-label={`Pitch ${i + 1} name`}
                  placeholder={i === 0 ? "Main Pitch" : "Another pitch"}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removePitch(i)}
                  aria-label={`Remove pitch ${i + 1}`}
                  className="shrink-0 text-ink/40 hover:text-ink"
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>

          <Button type="button" variant="ghost" onClick={addPitch} className="mt-2 h-9 px-2 text-forest-800">
            <Plus aria-hidden="true" className="size-4" />
            Add another pitch
          </Button>
        </div>

        <div className="mt-6 flex justify-end border-t border-ink/8 pt-5">
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Check aria-hidden="true" className="size-4" />
            )}
            Save home ground
          </Button>
        </div>
      </div>
    </div>
  )
}
