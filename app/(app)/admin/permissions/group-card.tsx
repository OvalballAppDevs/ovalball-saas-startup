"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { deletePermissionGroup, setGroupActive } from "./actions"
import { CATEGORY_LABEL, type Capability, type PermissionGroup } from "./types"
import { GroupForm } from "./group-form"

export function GroupCard({ group, capabilities }: { group: PermissionGroup; capabilities: Capability[] }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const capByKey = new Map(capabilities.map((c) => [c.key, c]))

  async function toggleActive() {
    setWorking(true)
    setError(null)
    const result = await setGroupActive(group.id, !group.isActive)
    setWorking(false)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  async function handleDelete() {
    setWorking(true)
    setError(null)
    const result = await deletePermissionGroup(group.id)
    setWorking(false)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  return (
    <div className={`rounded-lg border border-ink/10 bg-white p-4 ${!group.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-ink">{group.name}</p>
            {group.isSystem && <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-ink/50 uppercase">System</span>}
            {!group.isActive && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-destructive uppercase">Inactive</span>}
          </div>
          {group.description && <p className="mt-0.5 text-sm text-ink/55">{group.description}</p>}
          <p className="mt-1 text-xs text-ink/40">
            Grants: {group.mapsToRole ?? group.mapsToTeamPermission} &middot; assigned to {group.assignedCount} {group.assignedCount === 1 ? "person" : "people"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <GroupForm capabilities={capabilities} editing={group} triggerLabel="Edit" triggerVariant="outline" triggerClassName="h-8" />
          <Button type="button" variant="ghost" className="h-8" disabled={working} onClick={toggleActive}>
            {group.isActive ? "Deactivate" : "Reactivate"}
          </Button>
          {!group.isSystem &&
            (!confirmingDelete ? (
              <Button type="button" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            ) : (
              <>
                <Button type="button" variant="destructive" className="h-8" disabled={working} onClick={handleDelete}>
                  Confirm
                </Button>
                <Button type="button" variant="ghost" className="h-8" disabled={working} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ))}
        </div>
      </div>

      {group.capabilityKeys.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {group.capabilityKeys.map((key) => {
            const cap = capByKey.get(key)
            return (
              <span key={key} className="rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs text-ink/60" title={cap ? CATEGORY_LABEL[cap.category] : undefined}>
                {cap?.label ?? key}
              </span>
            )
          })}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
