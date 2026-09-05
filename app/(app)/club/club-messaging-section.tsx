"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { updateClubMessagingPolicy } from "./actions"

interface CapabilityState {
  origin: "global_default" | "club_override"
  effective: boolean
  clubOverrideAllowed: boolean
  globalDefault: boolean
}

export interface ClubMessagingPolicy {
  directAttachments: CapabilityState
  documentLibrarySharing: CapabilityState
  imageUploads: CapabilityState
  contactCardSharing: CapabilityState
  participantManagement: CapabilityState
}

const CAPABILITIES: { key: keyof ClubMessagingPolicy; label: string }[] = [
  { key: "directAttachments", label: "Direct file attachments" },
  { key: "documentLibrarySharing", label: "Document library sharing" },
  { key: "imageUploads", label: "Image uploads" },
  { key: "contactCardSharing", label: "Contact card sharing" },
  { key: "participantManagement", label: "Participant management" },
]

type Selection = "default" | "on" | "off"

function selectionFor(state: CapabilityState): Selection {
  if (state.origin === "global_default") return "default"
  return state.effective ? "on" : "off"
}

/**
 * "Use default" / "On" / "Off" per capability -- never hides which one is
 * active, matching the brief's "must make it obvious whether a value is
 * Ovalball default or a club override" requirement exactly. A capability
 * the global policy has marked non-overridable is shown read-only with an
 * explanation rather than a disabled control that gives no reason.
 */
export function ClubMessagingSection({ clubId, initial }: { clubId: string; initial: ClubMessagingPolicy }) {
  const [selections, setSelections] = useState<Record<keyof ClubMessagingPolicy, Selection>>({
    directAttachments: selectionFor(initial.directAttachments),
    documentLibrarySharing: selectionFor(initial.documentLibrarySharing),
    imageUploads: selectionFor(initial.imageUploads),
    contactCardSharing: selectionFor(initial.contactCardSharing),
    participantManagement: selectionFor(initial.participantManagement),
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setPending(true)
    setError(null)
    setSaved(false)
    const result = await updateClubMessagingPolicy({
      clubId,
      useDefaultDirectAttachments: selections.directAttachments === "default",
      allowDirectAttachments: selections.directAttachments === "on",
      useDefaultDocumentLibrarySharing: selections.documentLibrarySharing === "default",
      allowDocumentLibrarySharing: selections.documentLibrarySharing === "on",
      useDefaultImageUploads: selections.imageUploads === "default",
      allowImageUploads: selections.imageUploads === "on",
      useDefaultContactCardSharing: selections.contactCardSharing === "default",
      allowContactCardSharing: selections.contactCardSharing === "on",
      useDefaultParticipantManagement: selections.participantManagement === "default",
      allowParticipantManagement: selections.participantManagement === "on",
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
  }

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Messaging</p>
      <p className="mt-1 text-xs text-ink/45">
        These settings apply only to messages sent by your club&apos;s own members. A capability marked
        &ldquo;set by Ovalball&rdquo; below cannot be changed here.
      </p>

      <div className="mt-3 flex flex-col divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        {CAPABILITIES.map((cap) => {
          const state = initial[cap.key]
          return (
            <div key={cap.key} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-sm font-medium text-ink">{cap.label}</p>
                <p className="text-xs text-ink/45">
                  Ovalball default: {state.globalDefault ? "Allowed" : "Not allowed"}
                  {state.origin === "club_override" && <> &middot; your override: {state.effective ? "Allowed" : "Not allowed"}</>}
                </p>
              </div>
              {state.clubOverrideAllowed ? (
                <select
                  value={selections[cap.key]}
                  onChange={(e) => setSelections((s) => ({ ...s, [cap.key]: e.target.value as Selection }))}
                  className="h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                >
                  <option value="default">Use Ovalball default</option>
                  <option value="on">Override: Allowed</option>
                  <option value="off">Override: Not allowed</option>
                </select>
              ) : (
                <p className="text-xs text-ink/40">Set by Ovalball -- not club-overridable</p>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="mt-2 text-sm text-forest-800">Messaging settings saved.</p>}

      <div className="mt-3">
        <Button type="button" size="sm" className="h-9" disabled={pending} onClick={handleSave}>
          {pending ? "Saving…" : "Save messaging settings"}
        </Button>
      </div>
    </div>
  )
}
