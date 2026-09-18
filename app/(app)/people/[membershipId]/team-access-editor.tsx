"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { TEAM_STAFF_PERMISSION_OPTIONS } from "@/lib/permissions/role-labels"

import { grantTeamAccess, removeTeamAssignment } from "../actions"

export interface HeldTeamRole {
  id: string
  teamId: string
  teamName: string
  permissionLabel: string
}

const FIELD =
  "h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-60"

/**
 * TEAM ACCESS, FINALLY EDITABLE.
 *
 * Both halves existed already and neither could be reached from here.
 * `remove_team_access` was wired to a server action on this route whose only
 * caller would have had to pass an id the people list never carried, so the
 * button could not be drawn at all; and `set_team_access` could only be reached
 * from one team's own page. So a Club Admin holding the whole club's access in
 * front of them could read somebody's team roles and change none of them,
 * having to work out which team page to visit for each one instead.
 *
 * Neither control decides anything, and neither is hidden on your own record.
 * `set_team_access` refuses self-assignment from a Site Admin or a Team Admin
 * and deliberately allows it from a Club Admin, who already holds authority over
 * every team in the club -- putting their own name against the U14s records who
 * is doing the job rather than widening what they may do. Guessing at that here
 * would either forbid something the club is entitled to do or promise something
 * the database will refuse, so the form is offered and the answer comes back
 * from the authority, in its own words.
 */
export function TeamAccessEditor({
  membershipId,
  personName,
  held,
  teams,
}: {
  membershipId: string
  personName: string
  held: HeldTeamRole[]
  teams: { id: string; displayName: string }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState("")
  const [permission, setPermission] = useState(TEAM_STAFF_PERMISSION_OPTIONS[1].value as string)
  const [reason, setReason] = useState("")

  async function handleRemove(id: string) {
    setBusy(id)
    setError(null)
    const result = await removeTeamAssignment(id)
    setBusy(null)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  async function handleAdd() {
    setBusy("add")
    setError(null)
    const result = await grantTeamAccess(membershipId, teamId, permission, reason)
    setBusy(null)
    if (result.ok) {
      setTeamId("")
      setReason("")
      router.refresh()
    } else setError(result.error)
  }

  return (
    <section className="mt-8" aria-labelledby="person-team-access">
      <h2 id="person-team-access" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
        Team Access
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        What {personName} does at individual teams. A team role is separate from the club-wide role and does not replace it.
      </p>

      {held.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink-muted">
          No team roles. {personName} can see the club, but does not run any of its sides.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {held.map((role) => (
            <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{role.teamName}</p>
                <p className="text-xs text-ink-muted">{role.permissionLabel}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-destructive-text"
                disabled={busy !== null}
                onClick={() => handleRemove(role.id)}
              >
                {busy === role.id ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {teams.length > 0 && (
        <div className="mt-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
          <p className="text-sm font-medium text-ink">Give {personName} a Team Role</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="team-access-team">Team</Label>
              <select id="team-access-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={FIELD}>
                <option value="">Choose a team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="team-access-role">Role</Label>
              <select id="team-access-role" value={permission} onChange={(e) => setPermission(e.target.value)} className={FIELD}>
                {TEAM_STAFF_PERMISSION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="team-access-reason">Reason</Label>
            <input
              id="team-access-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className={FIELD}
            />
            <p className="text-xs text-ink-muted">Kept in the club&apos;s records. Required for some roles.</p>
          </div>
          <Button type="button" className="mt-3 h-9" disabled={busy !== null || !teamId} onClick={handleAdd}>
            {busy === "add" ? "Saving…" : "Give Team Role"}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </section>
  )
}
