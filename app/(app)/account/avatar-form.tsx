"use client"

import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/profile/user-avatar"

import { removeAvatar, uploadAvatar } from "./actions"

export function AvatarForm({ initialUrl, name }: { initialUrl: string | null; name: string }) {
  const [avatarUrl, setAvatarUrl] = useState(initialUrl)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setWorking(true)
    setError(null)
    const formData = new FormData()
    formData.set("avatar", file)
    const result = await uploadAvatar(formData)
    setWorking(false)
    if (result.ok) {
      setAvatarUrl(result.url)
    } else {
      setError(result.error)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleRemove() {
    setWorking(true)
    setError(null)
    const result = await removeAvatar()
    setWorking(false)
    if (result.ok) {
      setAvatarUrl(null)
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={working}
        onClick={() => fileInputRef.current?.click()}
        aria-label={avatarUrl ? "Change photo" : "Upload photo"}
        className="group/avatar relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-wait"
      >
        <UserAvatar avatarUrl={avatarUrl} name={name} size="lg" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-forest-950/0 text-[11px] font-medium text-white opacity-0 transition-all group-hover/avatar:bg-forest-950/60 group-hover/avatar:opacity-100 group-focus-visible/avatar:bg-forest-950/60 group-focus-visible/avatar:opacity-100">
          {working ? "Working…" : "Change photo"}
        </span>
      </button>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-9" disabled={working} onClick={() => fileInputRef.current?.click()}>
            {avatarUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {avatarUrl && (
            <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={handleRemove}>
              Remove
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink/45">PNG, JPEG, or WEBP. Up to 2MB.</p>
        {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleChange} />
      </div>
    </div>
  )
}
