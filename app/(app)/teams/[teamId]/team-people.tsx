"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"

import {
  approveTeamJoinRequest,
  archivePlayerMembership,
  assignTeamMember,
  declineTeamJoinRequest,
  removeTeamMember,
  restorePlayerMembership,
} from "./actions"

/**
 * TEAM PEOPLE
 *
 * Who is in this team. Three groups a club actually thinks in -- Coaches,
 * Parents/Guardians, Players -- plus the people waiting to be let in, which
 * used to have no team-facing home at all.
 *
 * The same component serves a Club Admin and a coach. A coach assigned to this
 * team sees exactly this roster; what changes is whether the actions are there,
 * not whether the people are. The old version showed a coach an empty box above
 * an "Assign an existing club member" dropdown, which is an administrator's
 * tool answering a question a coach was not asking.
 *
 * STATUS IS NEVER COLOUR ALONE. The dot is the quick read; the word next to it
 * is the actual answer, because a green circle and a red circle are the same
 * circle to a colourblind reader and to a screen reader they are nothing.
 */

export type TeamPersonKind = "coach" | "guardian" | "player"
export type TeamPersonStatus = "active" | "archived" | "requested"

export interface TeamPersonRow {
  kind: TeamPersonKind
  /** The row an action addresses: a team_permissions id, a guardians id, or a player_team_memberships id. */
  rowId: string
  personId: string | null
  name: string
  /** A coach's role, or the player a guardian is here for. */
  detail: string | null
  status: TeamPersonStatus
  requestedAt: string | null
}

export interface ClubMemberOption {
  membershipId: string
  name: string
}

/** Kept for the assignment control, which still speaks in single permissions. */
const PERMISSION_OPTIONS = [
  { value: "team_admin", label: "Team Admin" },
  { value: "coach", label: "Coach" },
  { value: "manager", label: "Manager" },
  { value: "view_only", label: "Parent or player access" },
] as const

type TabKey = "coach" | "guardian" | "player" | "requests"

const TABS: { key: TabKey; label: string; empty: string }[] = [
  { key: "coach", label: "Coaches", empty: "No coaches or managers assigned to this team yet." },
  { key: "guardian", label: "Parents & Guardians", empty: "No parents or guardians are linked to this team's players yet." },
  { key: "player", label: "Players", empty: "No players in this team yet." },
  { key: "requests", label: "Requests", empty: "Nothing waiting. Requests to join this team appear here." },
]

function StatusDot({ status }: { status: TeamPersonStatus }) {
  const tone =
    status === "active" ? "bg-pitch-600" : status === "requested" ? "bg-amber-500" : "bg-destructive-text"
  const word = status === "active" ? "Active" : status === "requested" ? "Awaiting review" : "Archived"
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${tone}`} />
      <span className="text-xs font-medium text-ink-muted">{word}</span>
    </span>
  )
}

export function TeamPeople({
  teamId,
  people,
  clubMembers,
  canManage,
}: {
  teamId: string
  people: TeamPersonRow[]
  clubMembers: ClubMemberOption[]
  canManage: boolean
}) {
  const [rows, setRows] = useState(people)
  const [tab, setTab] = useState<TabKey>("coach")
  const [pendingRowId, setPendingRowId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [assigning, setAssigning] = useState(false)
  const [selectedMembership, setSelectedMembership] = useState("")
  const [selectedPermission, setSelectedPermission] = useState<(typeof PERMISSION_OPTIONS)[number]["value"]>("coach")

  const requests = useMemo(() => rows.filter((r) => r.status === "requested"), [rows])
  const byTab = useMemo(() => {
    if (tab === "requests") return requests
    return rows.filter((r) => r.kind === tab && r.status !== "requested")
  }, [rows, tab, requests])

  const assignedPersonIds = new Set(rows.filter((r) => r.kind === "coach").map((r) => r.personId))
  const available = clubMembers.filter((m) => !assignedPersonIds.has(m.membershipId))

  async function run(rowId: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk: () => void) {
    setPendingRowId(rowId)
    setError(null)
    const result = await fn()
    setPendingRowId(null)
    if (result.ok) onOk()
    else setError(result.error)
  }

  async function handleAssign() {
    if (!selectedMembership) return
    setAssigning(true)
    setError(null)
    const result = await assignTeamMember(teamId, selectedMembership, selectedPermission)
    setAssigning(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const member = clubMembers.find((m) => m.membershipId === selectedMembership)
    const label = PERMISSION_OPTIONS.find((p) => p.value === selectedPermission)?.label ?? "Coach"
    setRows((prev) => [
      ...prev.filter((r) => !(r.kind === "coach" && r.personId === selectedMembership)),
      {
        kind: "coach",
        rowId: result.teamPermissionId,
        personId: selectedMembership,
        name: member?.name ?? "Member",
        detail: label,
        status: "active",
        requestedAt: null,
      },
    ])
    setSelectedMembership("")
    setTab("coach")
  }

  return (
    <div className="mt-8">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team people</p>

      <div className="mt-3 flex flex-wrap gap-1 border-b border-ink/10" role="tablist" aria-label="Team people">
        {TABS.map((t) => {
          const count = t.key === "requests" ? requests.length : rows.filter((r) => r.kind === t.key && r.status !== "requested").length
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`min-h-11 border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                active ? "-mb-px border-forest-800 text-forest-950" : "border-transparent text-ink/50 hover:text-ink/80"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs ${active ? "text-forest-800" : "text-ink-muted"}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

      {byTab.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-center text-sm text-ink-muted">
          {TABS.find((t) => t.key === tab)?.empty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-ink/8 overflow-hidden rounded-lg border border-ink/10 bg-white">
          {byTab.map((person) => (
            <li key={person.rowId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{person.name}</p>
                {person.detail && <p className="truncate text-xs text-ink-muted">{person.detail}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusDot status={person.status} />
                {canManage && person.status === "requested" && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={pendingRowId === person.rowId}
                      onClick={() =>
                        run(person.rowId, () => approveTeamJoinRequest(teamId, person.rowId), () =>
                          setRows((prev) => prev.map((r) => (r.rowId === person.rowId ? { ...r, status: "active", requestedAt: null } : r)))
                        )
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      disabled={pendingRowId === person.rowId}
                      onClick={() =>
                        run(person.rowId, () => declineTeamJoinRequest(teamId, person.rowId), () =>
                          setRows((prev) => prev.filter((r) => r.rowId !== person.rowId))
                        )
                      }
                    >
                      Decline
                    </Button>
                  </div>
                )}
                {canManage && person.kind === "player" && person.status === "active" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-ink-muted"
                    disabled={pendingRowId === person.rowId}
                    onClick={() =>
                      run(person.rowId, () => archivePlayerMembership(teamId, person.rowId), () =>
                        setRows((prev) => prev.map((r) => (r.rowId === person.rowId ? { ...r, status: "archived" } : r)))
                      )
                    }
                  >
                    Archive
                  </Button>
                )}
                {canManage && person.kind === "player" && person.status === "archived" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={pendingRowId === person.rowId}
                    onClick={() =>
                      run(person.rowId, () => restorePlayerMembership(teamId, person.rowId), () =>
                        setRows((prev) => prev.map((r) => (r.rowId === person.rowId ? { ...r, status: "active" } : r)))
                      )
                    }
                  >
                    Restore
                  </Button>
                )}
                {canManage && person.kind === "coach" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-ink-muted"
                    disabled={pendingRowId === person.rowId}
                    onClick={() =>
                      run(person.rowId, () => removeTeamMember(teamId, person.rowId), () =>
                        setRows((prev) => prev.filter((r) => r.rowId !== person.rowId))
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        Archiving a player takes them out of this team, not out of the club --
        said plainly here rather than inside a confirmation nobody reads twice.
      */}
      {canManage && tab === "player" && (
        <p className="mt-2 text-xs text-ink-muted">
          Archiving a player ends their place in this team. Their fixtures, attendance and history stay exactly as
          they are, and they can be restored here.
        </p>
      )}

      {canManage && tab === "coach" && (
        <div className="mt-4 rounded-lg border border-dashed border-ink/15 p-4">
          <p className="text-sm font-medium text-ink/80">Assign an existing club member</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selectedMembership}
              onChange={(e) => setSelectedMembership(e.target.value)}
              aria-label="Club member"
              className="h-10 min-w-[12rem] rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <option value="">Select a person…</option>
              {available.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              value={selectedPermission}
              onChange={(e) => setSelectedPermission(e.target.value as (typeof PERMISSION_OPTIONS)[number]["value"])}
              aria-label="Role in this team"
              className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {PERMISSION_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button type="button" className="h-10" disabled={!selectedMembership || assigning} onClick={handleAssign}>
              {assigning ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
