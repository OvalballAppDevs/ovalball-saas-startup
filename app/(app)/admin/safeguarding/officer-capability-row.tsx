"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { setSafeguardingCapability, type SafeguardingCapabilityKey } from "./actions"

const CAPABILITY_LABELS: Record<SafeguardingCapabilityKey, string> = {
  "club.dispensation.view": "Dispensations: View",
  "club.dispensation.notify": "Dispensations: Notify",
  "club.transfer.safeguarding_view": "Transfer safeguarding: View",
  "club.transfer.safeguarding_notify": "Transfer safeguarding: Notify",
}

export interface OfficerCapabilityData {
  userId: string
  clubId: string
  clubName: string
  officerName: string
  officerType: "primary" | "deputy"
  granted: Record<SafeguardingCapabilityKey, boolean>
}

export function OfficerCapabilityRow({ officer }: { officer: OfficerCapabilityData }) {
  const [granted, setGranted] = useState(officer.granted)
  const [working, setWorking] = useState<SafeguardingCapabilityKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(key: SafeguardingCapabilityKey) {
    const previous = granted[key]
    setGranted((g) => ({ ...g, [key]: !previous }))
    setWorking(key)
    setError(null)
    const result = await setSafeguardingCapability(officer.userId, officer.clubId, key, !previous)
    setWorking(null)
    if (!result.ok) {
      setGranted((g) => ({ ...g, [key]: previous }))
      setError(result.error)
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {officer.officerName} <span className="text-xs font-normal text-ink/45">({officer.officerType === "primary" ? "Primary" : "Deputy"})</span>
        </p>
        <p className="truncate text-xs text-ink/45">{officer.clubName}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(CAPABILITY_LABELS) as SafeguardingCapabilityKey[]).map((key) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            className={granted[key] ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
            disabled={working === key}
            onClick={() => handleToggle(key)}
          >
            {CAPABILITY_LABELS[key]}: {granted[key] ? "On" : "Off"}
          </Button>
        ))}
      </div>
    </li>
  )
}
