"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { assignTeamMember, removeTeamMember } from "./actions"

const PERMISSION_GROUPS = [
  { value: "team_admin", label: "Team Admin" },
  { value: "coach", label: "Coaches" },
  { value: "manager", label: "Managers" },
  { value: "view_only", label: "Parents / Players" },
] as const

export interface TeamMemberRow {
  teamPermissionId: string
  membershipId: string
  name: string
  permission: (typeof PERMISSION_GROUPS)[number]["value"]
}

export interface ClubMemberOption {
  membershipId: string
  name: string
}

export function TeamPeople({
  teamId,
  members,
  clubMembers,
  canManage,
}: {
  teamId: string
  members: TeamMemberRow[]
  clubMembers: ClubMemberOption[]
  canManage: boolean
}) {
  const [rows, setRows] = useState(members)
  const [assigning, setAssigning] = useState(false)
  const [selectedMembership, setSelectedMembership] = useState("")
  const [selectedPermission, setSelectedPermission] = useState<TeamMemberRow["permission"]>("coach")
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const assignedMembershipIds = new Set(rows.map((r) => r.membershipId))
  const available = clubMembers.filter((m) => !assignedMembershipIds.has(m.membershipId))

  async function handleAssign() {
    if (!selectedMembership) return
    setAssigning(true)
    setError(null)
    const result = await assignTeamMember(teamId, selectedMembership, selectedPermission)
    setAssigning(false)
    if (result.ok) {
      const member = clubMembers.find((m) => m.membershipId === selectedMembership)
      setRows((prev) => [
        ...prev.filter((r) => r.membershipId !== selectedMembership),
        { teamPermissionId: result.teamPermissionId, membershipId: selectedMembership, name: member?.name ?? "Member", permission: selectedPermission },
      ])
      setSelectedMembership("")
    } else {
      setError(result.error)
    }
  }

  async function handleRemove(row: TeamMemberRow) {
    setRemovingId(row.teamPermissionId)
    setError(null)
    const result = await removeTeamMember(teamId, row.teamPermissionId)
    setRemovingId(null)
    if (result.ok) {
      setRows((prev) => prev.filter((r) => r.teamPermissionId !== row.teamPermissionId))
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="mt-8">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Team people</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">No one assigned to this team yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {PERMISSION_GROUPS.map((group) => {
            const groupRows = rows.filter((r) => r.permission === group.value)
            if (groupRows.length === 0) return null
            return (
              <div key={group.value}>
                <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">{group.label}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {groupRows.map((row) => (
                    <li key={row.teamPermissionId} className="flex items-center justify-between rounded-lg border border-ink/10 bg-white px-3.5 py-2.5">
                      <span className="text-sm text-ink">{row.name}</span>
                      {canManage && (
                        <button
                          type="button"
                          disabled={removingId === row.teamPermissionId}
                          onClick={() => handleRemove(row)}
                          className="text-xs font-medium text-destructive outline-none hover:text-destructive/80 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
                        >
                          {removingId === row.teamPermissionId ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {canManage && (
        <div className="mt-5 rounded-lg border border-dashed border-ink/15 bg-white/60 p-4">
          <p className="text-sm font-medium text-ink/70">Assign an existing club member</p>
          {available.length === 0 ? (
            <p className="mt-2 text-sm text-ink/45">
              Every active club member is already assigned here, or there&apos;s no one to assign yet &mdash; invite
              someone from People first.
            </p>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <select
                aria-label="Club member"
                value={selectedMembership}
                onChange={(e) => setSelectedMembership(e.target.value)}
                className="h-10 min-w-40 flex-1 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                <option value="">Select a person…</option>
                {available.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Role on this team"
                value={selectedPermission}
                onChange={(e) => setSelectedPermission(e.target.value as TeamMemberRow["permission"])}
                className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                {PERMISSION_GROUPS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.value === "view_only" ? "Parent/Player (view only)" : g.label}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" className="h-10" disabled={!selectedMembership || assigning} onClick={handleAssign}>
                {assigning ? "Assigning…" : "Assign"}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  )
}
