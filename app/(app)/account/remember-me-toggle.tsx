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
    /*
      The whole row is the switch, exactly as on the notification
      preferences above -- one interactive element, the track rendered inside
      it as presentation, and a tap target the size of the thing a person is
      aiming at rather than the 24px track alone.
    */
    <button
      type="button"
      role="switch"
      aria-checked={remember}
      aria-labelledby="remember-me-label"
      aria-describedby="remember-me-description"
      disabled={saving}
      onClick={handleToggle}
      className="mt-3 flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border border-ink/10 bg-chalk px-3.5 py-3 text-left outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
    >
      <span className="min-w-0">
        <span id="remember-me-label" className="block text-sm font-medium text-ink">
          Keep me signed in on this device
        </span>
        <span id="remember-me-description" className="mt-0.5 block text-xs text-ink-muted">
          Stay signed in on this device until you sign out or Ovalball requires you to sign in
          again for security.
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          remember ? "bg-pitch-600" : "bg-ink/20"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            remember ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  )
}
