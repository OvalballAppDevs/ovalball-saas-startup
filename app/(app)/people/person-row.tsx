"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { revokeMembership, updateMembershipRole } from "./actions"

const CLUB_ROLE_LABEL: Record<string, string> = {
  BASIC_USER: "Member",
  CLUB_ADMIN: "Club Admin",
  FIXTURE_SECRETARY: "Fixture Secretary",
}

export interface PersonRowData {
  membershipId: string
  userId: string
  name: string
  email: string
  clubRole: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY"
  teamRoles: { teamName: string; permission: string }[]
}

export function PersonRow({ person, isSelf }: { person: PersonRowData; isSelf: boolean }) {
  const [clubRole, setClubRole] = useState(person.clubRole)
  const [saving, setSaving] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRoleChange(role: PersonRowData["clubRole"]) {
    setSaving(true)
    setError(null)
    const result = await updateMembershipRole(person.membershipId, role)
    setSaving(false)
    if (result.ok) setClubRole(role)
    else setError(result.error)
  }

  async function handleRemove() {
    setSaving(true)
    setError(null)
    const result = await revokeMembership(person.membershipId)
    setSaving(false)
    setConfirmingRemove(false)
    if (result.ok) setRemoved(true)
    else setError(result.error)
  }

  if (removed) {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3.5 text-sm text-ink/50">
        {person.name} &mdash; removed from the club.
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {person.name}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-ink/40">(you)</span>}
          </p>
          <p className="truncate text-xs text-ink/45">{person.email}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label={`Club-wide role for ${person.name}`}
            value={clubRole}
            disabled={saving || isSelf}
            onChange={(e) => handleRoleChange(e.target.value as PersonRowData["clubRole"])}
            className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-60"
          >
            {(Object.keys(CLUB_ROLE_LABEL) as PersonRowData["clubRole"][]).map((r) => (
              <option key={r} value={r}>
                {CLUB_ROLE_LABEL[r]}
              </option>
            ))}
          </select>

          {!isSelf && (
            <Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
              <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-9 text-destructive" />}>
                Remove
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove {person.name} from the club?</DialogTitle>
                  <DialogDescription>
                    They lose club-wide and team access immediately. This can be undone by inviting them again.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter showCloseButton>
                  <Button variant="destructive" className="h-9" disabled={saving} onClick={handleRemove}>
                    {saving ? "Removing…" : "Remove access"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {person.teamRoles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {person.teamRoles.map((r, i) => (
            <span key={i} className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink/60">
              {r.teamName} — {r.permission}
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </li>
  )
}
