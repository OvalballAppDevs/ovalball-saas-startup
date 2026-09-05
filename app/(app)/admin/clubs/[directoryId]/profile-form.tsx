"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { updateClubProfile, type ClubProfileInput } from "./actions"

/**
 * Only ever shown for activated clubs -- there's no `clubs` row to edit
 * otherwise. Deliberately does not surface club_contacts (member phone/
 * email) or any club_memberships/profiles data: the brief's own
 * instruction is "do not expose private member/user data here", and this
 * form only ever touches the four public-facing `clubs` columns plus
 * activation status, matching exactly what the Club Admin's own /club
 * page already edits.
 */
export function ProfileForm({ initial }: { initial: ClubProfileInput }) {
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updateClubProfile(form)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label htmlFor="profile-bio" className="text-ink/80">
          About the club
        </Label>
        <textarea
          id="profile-bio"
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          rows={4}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          placeholder="Shown on the club's public page."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="profile-website" className="text-ink/80">
            Website
          </Label>
          <Input
            id="profile-website"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            className="mt-1.5 h-11 border-ink/15 bg-white"
            placeholder="https://"
          />
        </div>
        <div>
          <Label htmlFor="profile-facebook" className="text-ink/80">
            Facebook
          </Label>
          <Input
            id="profile-facebook"
            value={form.facebookUrl}
            onChange={(e) => setForm((f) => ({ ...f, facebookUrl: e.target.value }))}
            className="mt-1.5 h-11 border-ink/15 bg-white"
            placeholder="https://facebook.com/…"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="profile-address" className="text-ink/80">
          Home ground address (public display)
        </Label>
        <Input
          id="profile-address"
          value={form.addressDisplay}
          onChange={(e) => setForm((f) => ({ ...f, addressDisplay: e.target.value }))}
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>

      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <p className="text-sm font-medium text-ink">What&apos;s shown on the public club page</p>
        <p className="mt-1 text-xs text-ink/50">
          Name, crest, town/county, bio and teams are always shown. These fields are optional &mdash; the default is
          privacy-conscious, so a club&apos;s exact address and postcode stay hidden unless deliberately turned on.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <VisibilityToggle
            label="Website"
            checked={form.showWebsite}
            onChange={(v) => setForm((f) => ({ ...f, showWebsite: v }))}
          />
          <VisibilityToggle
            label="Home ground name"
            checked={form.showHomeGround}
            onChange={(v) => setForm((f) => ({ ...f, showHomeGround: v }))}
          />
          <VisibilityToggle
            label="Full address"
            checked={form.showAddress}
            onChange={(v) => setForm((f) => ({ ...f, showAddress: v }))}
          />
          <VisibilityToggle
            label="Postcode"
            checked={form.showPostcode}
            onChange={(v) => setForm((f) => ({ ...f, showPostcode: v }))}
          />
        </div>
        <p className="mt-3 text-xs text-ink/45">
          Public phone and email are set per named contact (Fixture Secretary, Minis Secretary, General) on the
          club&apos;s own Club page, not here &mdash; each contact has its own independent public/private toggle.
        </p>
      </div>

      <div>
        <Label htmlFor="profile-status" className="text-ink/80">
          Club status
        </Label>
        <select
          id="profile-status"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "suspended" }))}
          className="mt-1.5 h-11 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <p className="mt-1 text-xs text-ink/45">
          Suspended hides the club&apos;s public page. Its administrators keep their own access &mdash; this doesn&apos;t
          remove or pause anyone&apos;s permissions.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save profile"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </div>
  )
}

function VisibilityToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-ink/80">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={`Show ${label.toLowerCase()} on the public page`}
        className={`relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
          checked ? "bg-pitch-600" : "bg-ink/15"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  )
}
