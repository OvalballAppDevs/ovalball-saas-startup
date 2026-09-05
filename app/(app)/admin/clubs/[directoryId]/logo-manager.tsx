"use client"

import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"

import { removeClubLogoAdmin, removeDirectoryLogoAdmin, uploadClubLogoAdmin, uploadDirectoryLogoAdmin } from "./actions"

/**
 * Mirrors app/(app)/club/club-profile-form.tsx's crest upload exactly
 * (same validation, same 2MB/PNG-JPEG-WebP-SVG limits, same
 * {clubId}/logo-{timestamp} path convention) -- this is the same feature
 * for a Site Admin acting on any activated club, not a second
 * implementation with its own rules.
 *
 * clubId is now OPTIONAL: when the directory entry has not activated (no
 * clubs row), this writes the CANONICAL club_directory.logo_storage_path
 * instead (uploadDirectoryLogoAdmin/removeDirectoryLogoAdmin) -- the fix
 * for a canonical-but-unactivated club having nowhere to store a crest and
 * no reachable UI to set one.
 */
export function LogoManager({
  clubId,
  directoryId,
  initialLogoUrl,
  source,
}: {
  clubId: string | null
  directoryId: string
  initialLogoUrl: string | null
  source: "imported" | "uploaded" | "canonical" | "none"
}) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [provenance, setProvenance] = useState(source)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgBroken, setImgBroken] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setWorking(true)
    setError(null)
    const formData = new FormData()
    formData.set("logo", file)
    const result = clubId ? await uploadClubLogoAdmin(clubId, directoryId, formData) : await uploadDirectoryLogoAdmin(directoryId, formData)
    setWorking(false)
    if (result.ok) {
      setLogoUrl(result.url)
      setProvenance(clubId ? "uploaded" : "canonical")
      setImgBroken(false)
    } else {
      setError(result.error)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleRemove() {
    setWorking(true)
    setError(null)
    const result = clubId ? await removeClubLogoAdmin(clubId, directoryId) : await removeDirectoryLogoAdmin(directoryId)
    setWorking(false)
    if (result.ok) {
      setLogoUrl(null)
      setProvenance("none")
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex items-start gap-5">
      <button
        type="button"
        disabled={working}
        onClick={() => fileInputRef.current?.click()}
        aria-label={logoUrl ? "Change crest" : "Upload crest"}
        className="group/crest relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-white outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-wait"
      >
        {logoUrl && !imgBroken ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL, avoids next/image's remote-pattern config for a small thumbnail
          <img src={logoUrl} alt="" className="size-full object-contain" onError={() => setImgBroken(true)} />
        ) : (
          <span className="text-xs text-ink/30">{logoUrl ? "Couldn't load" : "No crest"}</span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-forest-950/0 text-xs font-medium text-white opacity-0 transition-all group-hover/crest:bg-forest-950/70 group-hover/crest:opacity-100 group-focus-visible/crest:bg-forest-950/70 group-focus-visible/crest:opacity-100">
          {working ? "Working…" : "Change crest"}
        </span>
      </button>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {logoUrl && (
            <Button type="button" variant="outline" className="h-9" disabled={working} onClick={() => fileInputRef.current?.click()}>
              Replace
            </Button>
          )}
          {logoUrl && (
            <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={handleRemove}>
              Remove
            </Button>
          )}
          {logoUrl && (
            <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/55">
              {provenance === "uploaded" ? "Ovalball-uploaded" : provenance === "canonical" ? "Canonical (Site Admin)" : "Imported"}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink/45">
          {logoUrl ? "Click the crest to replace it. " : "Click the square to upload one. "}PNG, JPEG, WebP, or SVG. Up to 2MB.
          {!clubId && " This canonical crest is visible everywhere this club appears, even before it activates on Ovalball."}
        </p>
        {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    </div>
  )
}
