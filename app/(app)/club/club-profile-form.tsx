"use client"

import Image from "next/image"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { removeClubLogo, saveClubProfile, uploadClubLogo } from "./actions"

export interface ClubProfileFormData {
  clubId: string
  bio: string
  website: string
  facebookUrl: string
  addressDisplay: string
  logoUrl: string | null
}

export function ClubProfileForm({ initial }: { initial: ClubProfileFormData }) {
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl)
  const [logoUploading, setLogoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await saveClubProfile(form)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    setError(null)
    const formData = new FormData()
    formData.set("logo", file)
    const result = await uploadClubLogo(form.clubId, formData)
    setLogoUploading(false)
    if (result.ok) {
      setLogoUrl(URL.createObjectURL(file))
    } else {
      setError(result.error)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleRemoveLogo() {
    setLogoUploading(true)
    setError(null)
    const result = await removeClubLogo(form.clubId)
    setLogoUploading(false)
    if (result.ok) {
      setLogoUrl(null)
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Crest</p>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-white">
            {logoUrl ? (
              <Image src={logoUrl} alt="Club crest" width={64} height={64} className="size-full object-contain" />
            ) : (
              <span className="text-xs text-ink/30">No crest</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={logoUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {logoUploading ? "Working…" : logoUrl ? "Replace crest" : "Upload crest"}
              </Button>
              {logoUrl && (
                <Button type="button" variant="ghost" className="h-9" disabled={logoUploading} onClick={handleRemoveLogo}>
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink/45">PNG, JPEG, WebP, or SVG. Up to 2MB.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoChange}
            />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="bio" className="text-ink/80">
          About the club
        </Label>
        <textarea
          id="bio"
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          rows={4}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          placeholder="A short introduction shown on your club's public page."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="website" className="text-ink/80">
            Website
          </Label>
          <Input
            id="website"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            className="mt-1.5 h-11 border-ink/15 bg-white"
            placeholder="https://"
          />
        </div>
        <div>
          <Label htmlFor="facebook" className="text-ink/80">
            Facebook
          </Label>
          <Input
            id="facebook"
            value={form.facebookUrl}
            onChange={(e) => setForm((f) => ({ ...f, facebookUrl: e.target.value }))}
            className="mt-1.5 h-11 border-ink/15 bg-white"
            placeholder="https://facebook.com/…"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="address" className="text-ink/80">
          Home ground address
        </Label>
        <Input
          id="address"
          value={form.addressDisplay}
          onChange={(e) => setForm((f) => ({ ...f, addressDisplay: e.target.value }))}
          className="mt-1.5 h-11 border-ink/15 bg-white"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </div>
  )
}
