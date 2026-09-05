"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import { Switch } from "@/components/ui/switch"

import { setPlayerPermission } from "./actions"

export interface PermissionRowData {
  key: string
  label: string
  description: string
  effective: boolean
  myDecision: boolean | null
  coGuardiansPending: boolean
}

/**
 * One plain-language control per permission -- label, description, and
 * current selected-state are all programmatically tied together
 * (aria-describedby + Switch's own role="switch"/aria-checked), and
 * "waiting on your co-guardian" is shown as real text, not just a dimmed
 * toggle, so a household with more than one Guardian understands WHY
 * something reads as off even after they personally granted it.
 * setPlayerPermission() only ever records THIS signed-in guardian's own
 * decision -- the effective/aggregate state shown here is always
 * re-derived server-side on the next load, never computed client-side.
 */
export function PermissionRow({ permission, playerId }: { permission: PermissionRowData; playerId: string }) {
  const router = useRouter()
  const descId = useId()
  const [granted, setGranted] = useState(permission.myDecision ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: boolean) {
    setGranted(next)
    setSaving(true)
    setError(null)
    const result = await setPlayerPermission(playerId, permission.key, next)
    setSaving(false)
    if (!result.ok) {
      setGranted(!next)
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={descId} className="text-sm font-medium text-ink">
          {permission.label}
        </label>
        <p id={descId} className="mt-0.5 text-sm text-ink/55">
          {permission.description}
        </p>
        {granted && permission.coGuardiansPending && <p className="mt-1.5 text-xs font-medium text-amber-700">Waiting on another guardian to also allow this.</p>}
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      </div>
      <Switch aria-labelledby={descId} checked={granted} disabled={saving} onCheckedChange={handleChange} className="mt-0.5 shrink-0" />
    </li>
  )
}
