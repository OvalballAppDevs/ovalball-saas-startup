"use client"

import { useState } from "react"

import { setSafeguardingCapability, type SafeguardingCapabilityKey } from "./actions"

/**
 * Every control here is one real capability key, granted through the
 * canonical Scoped Capability Engine as a per-person `capability_overrides`
 * row. There is no second set of UI-only booleans, and no friendly label
 * that quietly means two capabilities.
 *
 * `connected` records whether anything in Main actually READS the
 * capability yet. Dispensations do: request/decide/revoke_player_dispensation
 * each call internal.notify_club_safeguarding_officers. Transfers do not --
 * Main has no inter-club transfer event at all (Player Moves are movements
 * between a club's OWN teams, plus call-ups and dispensations), so granting
 * a transfer capability today configures a notification nothing can send.
 * Saying so on the control is the honest option; silently offering a switch
 * that does nothing is not.
 */
const GROUPS: {
  label: string
  hint: string
  connected: boolean
  capabilities: { key: SafeguardingCapabilityKey; label: string; hint: string }[]
}[] = [
  {
    label: "Dispensations",
    hint: "Player dispensation requests, decisions and revocations.",
    connected: true,
    capabilities: [
      { key: "club.dispensation.view", label: "View dispensations", hint: "See this club's dispensation records." },
      { key: "club.dispensation.notify", label: "Receive notifications", hint: "Be notified when a dispensation is requested, decided or revoked." },
    ],
  },
  {
    label: "Player transfers",
    hint: "Ovalball has no inter-club transfer event yet, so nothing reads these. They can be set now and will take effect when transfers exist.",
    connected: false,
    capabilities: [
      { key: "club.transfer.safeguarding_view", label: "View transfer information", hint: "See safeguarding-relevant player movement between clubs." },
      { key: "club.transfer.safeguarding_notify", label: "Receive notifications", hint: "Be notified of safeguarding-relevant transfers." },
    ],
  },
]

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

  async function handleToggle(key: SafeguardingCapabilityKey, next: boolean) {
    const previous = granted[key]
    setGranted((g) => ({ ...g, [key]: next }))
    setWorking(key)
    setError(null)
    const result = await setSafeguardingCapability(officer.userId, officer.clubId, key, next)
    setWorking(null)
    if (!result.ok) {
      setGranted((g) => ({ ...g, [key]: previous }))
      setError(result.error)
    }
  }

  return (
    <li className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {officer.officerName}{" "}
          <span className="text-xs font-normal text-ink-muted">
            ({officer.officerType === "primary" ? "Primary" : "Deputy"})
          </span>
        </p>
        <p className="truncate text-xs text-ink-muted">{officer.clubName}</p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive-text">
          {error}
        </p>
      )}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <fieldset key={group.label} className="min-w-0">
            <legend className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.06em] text-ink/70 uppercase">
              {group.label}
              {!group.connected && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-medium tracking-normal text-amber-900 normal-case">
                  Not yet connected
                </span>
              )}
            </legend>
            <p className="mt-1 text-xs text-ink-muted">{group.hint}</p>

            <div className="mt-2 space-y-2">
              {group.capabilities.map((cap) => (
                <label key={cap.key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={granted[cap.key]}
                    disabled={working === cap.key}
                    onChange={(e) => handleToggle(cap.key, e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-forest-800"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{cap.label}</span>
                    <span className="block text-xs text-ink-muted">{cap.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </li>
  )
}
