"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

import { changeAccessProfile, getClubTeams, type ClubTeamSummary, type TeamGroupAssignment } from "../../clubs/[directoryId]/actions"
import { getPermissionGroups } from "../../permissions/actions"
import type { PermissionGroup } from "../../permissions/types"

/**
 * Selects directly from Permission Management's own groups -- no
 * hard-coded duplicate dropdown logic. The only thing this form still
 * decides locally is which currently-assigned group a membership's
 * current role/team_permissions rows most closely match, for the initial
 * selection.
 */
function currentClubGroupId(role: string, groups: PermissionGroup[]): string | undefined {
  const mapsToRole = role === "CLUB_ADMIN" ? "CLUB_ADMIN" : role === "FIXTURE_SECRETARY" ? "FIXTURE_SECRETARY" : "BASIC_USER"
  return groups.find((g) => g.scopeType === "club" && g.mapsToRole === mapsToRole && g.isActive)?.id
}

function previewCapabilities(
  clubGroupId: string,
  teamAssignments: TeamGroupAssignment[],
  clubGroups: PermissionGroup[],
  teamGroups: PermissionGroup[],
  teams: ClubTeamSummary[]
): { can: string[]; cannot: string[] } {
  const clubGroup = clubGroups.find((g) => g.id === clubGroupId)
  const activeTeamAssignments = teamAssignments.filter((t) => t.groupId)

  if (clubGroup?.mapsToRole === "CLUB_ADMIN") {
    return {
      can: ["manage this club's profile and public page", "invite and manage people", "manage all teams", "create/edit fixtures and calendar-sharing partnerships"],
      cannot: ["access Site Admin controls", "manage any other club"],
    }
  }
  if (clubGroup?.mapsToRole === "FIXTURE_SECRETARY") {
    return {
      can: ["send/receive fixture requests and manage calendar-sharing partnerships club-wide", "message about fixtures club-wide"],
      cannot: [
        "create or edit a fixture directly for a team they aren't separately given team-level access to",
        "manage the club profile or invite people",
        "grant or change anyone's access",
        "access Site Admin controls",
      ],
    }
  }
  if (activeTeamAssignments.length > 0) {
    const names = activeTeamAssignments
      .map((t) => teams.find((team) => team.id === t.teamId)?.displayName)
      .filter((n): n is string => Boolean(n))
    return {
      can: names.map((n) => `manage ${n}`),
      cannot: ["manage the club club-wide", "invite or manage Club Admins", "access teams not assigned above", "access Site Admin controls"],
    }
  }
  return {
    can: ["view this club's information they already have access to"],
    cannot: ["administer the club or any team", "create or edit fixtures", "invite or manage people", "access Site Admin controls"],
  }
}

export function ChangeAccessForm({
  membershipId,
  directoryId,
  userId,
  userName,
  clubId,
  clubName,
  currentRole,
  currentTeamRoles,
  onDone,
}: {
  membershipId: string
  directoryId: string
  userId: string
  userName: string
  clubId: string
  clubName: string
  currentRole: string
  currentTeamRoles: { teamId: string; teamName: string; permission: string }[]
  onDone: () => void
}) {
  const [teams, setTeams] = useState<ClubTeamSummary[]>([])
  const [allGroups, setAllGroups] = useState<PermissionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [clubGroupId, setClubGroupId] = useState<string>("")
  const [assignments, setAssignments] = useState<TeamGroupAssignment[]>([])
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getClubTeams(clubId), getPermissionGroups()]).then(([teamResult, groupResult]) => {
      if (cancelled) return
      setTeams(teamResult)
      setAllGroups(groupResult)
      setClubGroupId(currentClubGroupId(currentRole, groupResult) ?? "")
      const teamGroupList = groupResult.filter((g) => g.scopeType === "team" && g.isActive)
      setAssignments(
        currentTeamRoles.map((t) => ({
          teamId: t.teamId,
          groupId: teamGroupList.find((g) => g.mapsToTeamPermission === t.permission)?.id ?? null,
        }))
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs when the membership being edited changes
  }, [clubId])

  const clubGroups = allGroups.filter((g) => g.scopeType === "club" && g.isActive)
  const teamGroups = allGroups.filter((g) => g.scopeType === "team" && g.isActive)

  function setTeamGroup(teamId: string, groupId: string | null) {
    setAssignments((prev) => {
      const without = prev.filter((a) => a.teamId !== teamId)
      return groupId ? [...without, { teamId, groupId }] : without
    })
  }

  async function handleApply() {
    setApplying(true)
    setError(null)
    const result = await changeAccessProfile({ membershipId, directoryId, userId, clubGroupId, teamAssignments: assignments })
    setApplying(false)
    if (result.ok) onDone()
    else setError(result.error)
  }

  if (loading) {
    return <div className="rounded-lg border border-pitch-600/30 bg-pitch-600/[0.03] p-4 text-sm text-ink/50">Loading permission groups&hellip;</div>
  }

  const preview = previewCapabilities(clubGroupId, assignments, clubGroups, teamGroups, teams)

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-pitch-600/30 bg-pitch-600/[0.03] p-4">
      <div>
        <p className="text-sm font-medium text-ink">Change Ovalball access &mdash; {clubName}</p>
        <p className="mt-0.5 text-xs text-ink/50">This never affects global Site Admin access, which is managed separately.</p>
      </div>

      <label className="text-sm text-ink/80">
        Club-wide access
        <select
          value={clubGroupId}
          onChange={(e) => setClubGroupId(e.target.value)}
          className="mt-1.5 h-10 w-full max-w-sm rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          {clubGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      {clubGroupId && clubGroups.find((g) => g.id === clubGroupId)?.mapsToRole === "BASIC_USER" && teams.length > 0 && (
        <div>
          <p className="text-sm text-ink/70">Team assignments (optional)</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {teams.map((team) => {
              const current = assignments.find((a) => a.teamId === team.id)?.groupId ?? ""
              return (
                <div key={team.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-3 py-2">
                  <span className="text-sm text-ink">{team.displayName}</span>
                  <select
                    value={current}
                    onChange={(e) => setTeamGroup(team.id, e.target.value || null)}
                    className="h-8 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    <option value="">No team access</option>
                    {teamGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <p className="text-sm font-medium text-ink">{userName} will be able to:</p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {preview.can.map((c) => (
            <li key={c} className="text-sm text-forest-800">
              &bull; {c}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-medium text-ink">{userName} will NOT be able to:</p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {preview.cannot.map((c) => (
            <li key={c} className="text-sm text-ink/55">
              &bull; {c}
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="button" className="h-9" disabled={applying || !clubGroupId} onClick={handleApply}>
          {applying ? "Applying…" : "Apply changes"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" disabled={applying} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
