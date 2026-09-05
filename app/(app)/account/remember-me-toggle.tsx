"use client"

import { useState } from "react"

import { setRememberPreference } from "./actions"

export function RememberMeToggle({ initialRemember }: { initialRemember: boolean }) {
  const [remember, setRemember] = useState(initialRemember)
  const [saving, setSaving] = useState(false)

  async function handleToggle() {
    const next = !remember
    setRemember(next)
    setSaving(true)
    const result = await setRememberPreference(next)
    setSaving(false)
    if (!result.ok) setRemember(!next) // revert on failure
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-ink/10 bg-chalk px-3.5 py-3">
      <div>
        <p className="text-sm font-medium text-ink">Keep me signed in on this device</p>
        <p className="mt-0.5 text-xs text-ink/50">
          Stay signed in on this device until you sign out or Ovalball requires you to sign in
          again for security.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={remember}
        aria-label="Keep me signed in on this device"
        disabled={saving}
        onClick={handleToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
          remember ? "bg-pitch-600" : "bg-ink/20"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            remember ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  )
}
