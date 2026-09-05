"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { lookupAddress, updateDirectoryFields, updateProvenance, type DirectoryFieldsInput, type ProvenanceInput } from "./actions"
import { AddressLookupField } from "@/components/address/address-lookup-field"
import { RugbyCodeCorrectionDialog } from "./rugby-code-correction-dialog"

const NATIONS = ["England", "Scotland", "Wales", "Northern Ireland"] as const

export function DirectoryForm({
  initial,
  initialProvenance,
}: {
  initial: DirectoryFieldsInput
  initialProvenance: ProvenanceInput
}) {
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updateDirectoryFields(form)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  function field<K extends keyof DirectoryFieldsInput>(key: K) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="dir-name" className="text-ink/80">
            Club name
          </Label>
          <Input id="dir-name" {...field("name")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label className="text-ink/80">Rugby code</Label>
          <div className="mt-1.5 flex h-11 items-center justify-between rounded-lg border border-ink/15 bg-ink/[0.02] px-3.5">
            <span className="text-base text-ink">{form.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}</span>
            <RugbyCodeCorrectionDialog
              directoryId={form.directoryId}
              currentCode={form.rugbyCode}
              onCorrected={(next) => setForm((f) => ({ ...f, rugbyCode: next }))}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink/45">
            Union and League are separate canonical identities. Use Correct for a genuine fix, with a reason.
          </p>
        </div>
        <div>
          <Label htmlFor="dir-nation" className="text-ink/80">
            Nation
          </Label>
          <select
            id="dir-nation"
            value={form.nation}
            onChange={(e) => setForm((f) => ({ ...f, nation: e.target.value as DirectoryFieldsInput["nation"] }))}
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
          <Label htmlFor="dir-country" className="text-ink/80">
            Country
          </Label>
          <Input id="dir-country" {...field("country")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-region" className="text-ink/80">
            Region
          </Label>
          <Input id="dir-region" {...field("region")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-county" className="text-ink/80">
            County
          </Label>
          <Input id="dir-county" {...field("county")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-town" className="text-ink/80">
            Town
          </Label>
          <Input id="dir-town" {...field("town")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-postcode" className="text-ink/80">
            Postcode
          </Label>
          <Input id="dir-postcode" {...field("postcode")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="dir-home-ground" className="text-ink/80">
            Home ground
          </Label>
          <Input id="dir-home-ground" {...field("homeGround")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div className="sm:col-span-2">
          <AddressLookupField
            search={lookupAddress}
            onSelect={(picked) =>
              setForm((f) => ({ ...f, address: picked.address, town: picked.town, county: picked.county || f.county, postcode: picked.postcode }))
            }
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="dir-address" className="text-ink/80">
            Address
          </Label>
          <Input id="dir-address" {...field("address")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-website" className="text-ink/80">
            Website
          </Label>
          <Input id="dir-website" {...field("website")} className="mt-1.5 h-11 border-ink/15 bg-white" placeholder="https://" />
        </div>
        <div>
          <Label htmlFor="dir-email" className="text-ink/80">
            Official email
          </Label>
          <Input id="dir-email" type="email" {...field("officialEmail")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-verification" className="text-ink/80">
            Verification status
          </Label>
          <Input id="dir-verification" {...field("verificationStatus")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="dir-constituent" className="text-ink/80">
            Constituent body
          </Label>
          <Input id="dir-constituent" {...field("constituentBody")} className="mt-1.5 h-11 border-ink/15 bg-white" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="dir-notes" className="text-ink/80">
            Notes
          </Label>
          <textarea
            id="dir-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-pitch-600"
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
        Directory entry is active (visible in club search and public listings)
      </label>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save canonical details"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>

      <ProvenanceSection initial={initialProvenance} />
    </div>
  )
}

/**
 * A deliberately separate, initially-locked section -- source/external_id/
 * source_url identify where this record came from during ingestion.
 * Editing them isn't part of the normal "fix a postcode" workflow, so this
 * form stays read-only until explicitly unlocked, matching the brief's
 * "put provenance in a separate advanced section" instruction.
 */
function ProvenanceSection({ initial }: { initial: ProvenanceInput }) {
  const [unlocked, setUnlocked] = useState(false)
  const [form, setForm] = useState<ProvenanceInput>(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updateProvenance(form)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-ink/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Source &amp; provenance</p>
          <p className="mt-1 text-sm text-ink/50">
            Where this record came from during ingestion. Not part of routine edits &mdash; unlock only if you&apos;re
            deliberately correcting the source data itself.
          </p>
        </div>
        {!unlocked && (
          <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setUnlocked(true)}>
            Unlock to edit
          </Button>
        )}
      </div>

      {unlocked && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="prov-source" className="text-ink/80">
                Source
              </Label>
              <Input
                id="prov-source"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                className="mt-1.5 h-11 border-ink/15 bg-white"
              />
            </div>
            <div>
              <Label htmlFor="prov-external-id" className="text-ink/80">
                External ID
              </Label>
              <Input
                id="prov-external-id"
                value={form.externalId}
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
                className="mt-1.5 h-11 border-ink/15 bg-white"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="prov-source-url" className="text-ink/80">
              Source URL
            </Label>
            <Input
              id="prov-source-url"
              value={form.sourceUrl}
              onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              className="mt-1.5 h-11 border-ink/15 bg-white"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" className="h-9" disabled={status === "saving"} onClick={handleSave}>
              {status === "saving" ? "Saving…" : "Save provenance"}
            </Button>
            {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
