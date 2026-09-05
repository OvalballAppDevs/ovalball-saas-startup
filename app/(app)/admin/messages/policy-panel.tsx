"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { updateGlobalMessagePolicyAction, type GlobalPolicyInput } from "./actions"

const CAPABILITIES: { key: keyof Pick<GlobalPolicyInput, "allowDirectAttachments" | "allowDocumentLibrarySharing" | "allowImageUploads" | "allowContactCardSharing" | "allowParticipantManagement">; overrideKey: keyof GlobalPolicyInput; label: string; description: string }[] = [
  { key: "allowDirectAttachments", overrideKey: "allowDirectAttachmentsClubOverrideAllowed", label: "Direct file attachments", description: "PDF/image files attached straight to a message." },
  { key: "allowDocumentLibrarySharing", overrideKey: "allowDocumentLibrarySharingClubOverrideAllowed", label: "Document library sharing", description: "Sharing a document from the club's own library by reference -- never duplicates the file." },
  { key: "allowImageUploads", overrideKey: "allowImageUploadsClubOverrideAllowed", label: "Image uploads", description: "Independent of direct attachments -- turning this off still allows PDFs if that stays on." },
  { key: "allowContactCardSharing", overrideKey: "allowContactCardSharingClubOverrideAllowed", label: "Contact card sharing", description: "A coach/official sharing their name, role, club, and phone number." },
  { key: "allowParticipantManagement", overrideKey: "allowParticipantManagementClubOverrideAllowed", label: "Participant management", description: "Adding a coach or official to a fixture conversation." },
]

export function PolicyPanel({
  initial,
  canEdit,
}: {
  initial: GlobalPolicyInput
  canEdit: boolean
}) {
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setPending(true)
    setError(null)
    const result = await updateGlobalMessagePolicyAction(draft)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditing(false)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Global Ovalball policy</p>
          <p className="mt-1 text-xs text-ink/45">
            The platform default for every club. A club may only override a capability below if you leave its own
            &ldquo;club override&rdquo; switch on.
          </p>
        </div>
        {canEdit && !editing && (
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-col divide-y divide-ink/8">
        {CAPABILITIES.map((cap) => (
          <div key={cap.key} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4">
            <div>
              <p className="text-sm font-medium text-ink">{cap.label}</p>
              <p className="text-xs text-ink/50">{cap.description}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                disabled={!editing}
                checked={draft[cap.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [cap.key]: e.target.checked }))}
                className="size-4 accent-pitch-600 disabled:opacity-60"
              />
              Allowed by default
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                disabled={!editing}
                checked={draft[cap.overrideKey] as boolean}
                onChange={(e) => setDraft((d) => ({ ...d, [cap.overrideKey]: e.target.checked }))}
                className="size-4 accent-pitch-600 disabled:opacity-60"
              />
              Clubs may override
            </label>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-ink/8 pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-ink/50 uppercase">Max attachment size</p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              disabled={!editing}
              min={1}
              max={2097152}
              value={draft.maxAttachmentSizeBytes}
              onChange={(e) => setDraft((d) => ({ ...d, maxAttachmentSizeBytes: Number(e.target.value) }))}
              className="h-9 w-32 rounded-md border border-ink/15 px-2 text-sm outline-none disabled:bg-ink/[0.03] disabled:text-ink/50"
            />
            <span className="text-xs text-ink/45">bytes (platform ceiling is 2,097,152 / 2MB)</span>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {editing && (
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" size="sm" className="h-9" disabled={pending} onClick={handleSave}>
            {pending ? "Saving…" : "Save global policy"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setDraft(initial)
              setEditing(false)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {!canEdit && <p className="mt-3 text-xs text-ink/40">Only a Full Site Admin may change the global policy.</p>}
    </div>
  )
}
