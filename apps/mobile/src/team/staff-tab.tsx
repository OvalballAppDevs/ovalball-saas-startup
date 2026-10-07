import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import {
  grantTeamStaffRole,
  readTeamStaff,
  revokeTeamStaffRole,
  setStaffTitle,
  teamStaffErrorMessage,
  type TeamStaffMember,
} from "@ovalball/contracts/team/staff"
import { readAssignableRoles } from "@ovalball/contracts/club/people"
import { roleDisplayLabel } from "@ovalball/contracts/role-labels"

import { supabase } from "../auth/supabase"
import { NotForYou } from "./screen"
import { PersonAvatar } from "../components/identity"
import { BottomSheet } from "../components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { ChevronRight, UserPlus } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { TeamRoleSelector, type TeamRolePicks } from "../people/team-roles"

/**
 * STAFF -- every legitimate person running this team, and every role they actually hold (Team Profile
 * Section 4, extended by the Section 4 owner-review addendum). Reads `team_staff`; one row per person,
 * however many roles.
 *
 * MANAGEMENT NEVER NEEDS A CONTEXT SWITCH (Section 26). Every mutation here (`assign_role`,
 * `transition_role_assignment`, `set_team_role_title`) is called with this screen's own explicit
 * `clubId`/`teamId`, exactly the way those RPCs already ask their own authority
 * (`internal.team_people_level(club, team)`, never the caller's active context) -- so a Club Admin
 * managing a team they hold no personal role on works correctly here without pretending to join it.
 */
export function StaffTab({
  identity,
  rosterVisible,
  canManageRoles,
}: {
  identity: { id: string; clubId: string; teamName: string }
  rosterVisible: boolean
  /** `people.role.assign_team` -- the exact authority assign_role/transition_role_assignment already
   * re-check, asked with this team's own explicit id (Section 5/26), never inferred from a role name. */
  canManageRoles: boolean
}) {
  const [staff, setStaff] = useState<TeamStaffMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [managing, setManaging] = useState<TeamStaffMember | null>(null)
  const router = useRouter()

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setStaff(await readTeamStaff(supabase, identity.id))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        setRefused(true)
        setStaff([])
        return
      }
      setProblem(teamStaffErrorMessage(caught, "Couldn't load team staff. Try again."))
    }
  }, [identity.id])

  useEffect(() => {
    setStaff(null)
    setProblem(null)
    setRefused(false)
    void load()
  }, [load])

  // KEEP THE OPEN MANAGE SHEET IN SYNC WITH WHATEVER load() JUST REFETCHED -- found live, by physical
  // review: without this, a successful role change updated the real list behind the sheet correctly, but
  // the still-open sheet kept showing its own stale snapshot of that same person's roles. Closes the
  // sheet naturally once the person's last role on this team is gone.
  useEffect(() => {
    if (!staff || !managing) return
    setManaging(staff.find((m) => m.membershipId === managing.membershipId) ?? null)
    // Only ever react to a fresh `staff` array; re-running this because `managing` itself changed would
    // fight the very update it is trying to make.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff])

  // NO MESSAGE ACTION HERE (Section 7/8/29 vs. the existing CA-M7 team-operations directive, reaffirmed
  // by the owner in the Section 4 review pass): a Staff row deliberately carries no messaging/contact
  // affordance. `team_operations_ca7.test.mts` already locks "no messaging route from a team entity" for
  // every file under apps/mobile/src/team/. Nothing here opens a conversation of any kind.

  if (!rosterVisible || refused) {
    return <NotForYou title="Staff isn&apos;t part of your view" body="Who runs the side is shown to the people who run it." />
  }
  if (problem && !staff) {
    return <ErrorState message={problem} onRetry={load} />
  }
  if (staff === null) {
    return (
      <View style={{ gap: space.md }}>
        <CardSkeleton lines={1} />
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {[0, 1, 2].map((i) => (
            <StaffRowSkeleton key={i} first={i === 0} />
          ))}
        </View>
      </View>
    )
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Staff</Text>
        <Text accessibilityLabel={`${staff.length} staff`} style={[type.title, { color: colour.ink }]}>{staff.length}</Text>
      </View>

      {staff.length === 0 ? (
        <EmptyState title="No staff yet" body="Coaches, managers and team staff appear here once they are added." icon={<UserPlus size={22} color={colour.inkSubtle} />} />
      ) : (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {staff.map((member, i) => (
            <StaffRow
              key={member.membershipId}
              member={member}
              first={i === 0}
              canManage={canManageRoles}
              onManage={() => setManaging(member)}
            />
          ))}
        </View>
      )}

      {/* ADD STAFF MEMBERS IS THE ONE FRONT DOOR (People & Invitations): the same screen Home's Add to Club
          opens, with this team chosen -- invite somebody new (the one staff invitation) or add an existing
          person. Explicit ids from this profile, never the switched context. */}
      {canManageRoles && (
        <Button
          label="Add Staff Members"
          onPress={() => router.push({ pathname: "/team/add-staff", params: { clubId: identity.clubId, teamId: identity.id, teamName: identity.teamName } } as never)}
        />
      )}

      {managing && (
        <ManageStaffSheet
          clubId={identity.clubId}
          teamId={identity.id}
          member={managing}
          onClose={() => setManaging(null)}
          onChanged={() => void load()}
        />
      )}
    </View>
  )
}

function StaffRow({
  member,
  first,
  canManage,
  onManage,
}: {
  member: TeamStaffMember
  first: boolean
  canManage: boolean
  onManage: () => void
}) {
  const roleLine = member.roles.map((r) => r.displayLabel).join(" · ")

  return (
    <Pressable
      accessibilityRole={canManage ? "button" : undefined}
      accessibilityLabel={`${member.displayName}, ${roleLine || "team staff"}`}
      onPress={canManage ? onManage : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: canManage && pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <PersonAvatar name={member.displayName} url={member.avatarUrl} size={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>{member.displayName}</Text>
        {!!roleLine && (
          <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted }]}>{roleLine}</Text>
        )}
      </View>
      {canManage && <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}

function StaffRowSkeleton({ first }: { first: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colour.line, opacity: 0.5 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 14, width: "50%", borderRadius: 4, backgroundColor: colour.line, opacity: 0.5 }} />
        <View style={{ height: 11, width: "35%", borderRadius: 4, backgroundColor: colour.line, opacity: 0.35 }} />
      </View>
    </View>
  )
}

function sameRoles(a: TeamRolePicks, b: TeamRolePicks): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (!b.has(k) || (b.get(k) ?? null) !== (v ?? null)) return false
  return true
}

/**
 * MANAGE STAFF MEMBER -- role changes are staged locally and applied together behind one "Save Changes"
 * (Section 4 addendum Section 3), rather than each checkbox firing its own permanent mutation the
 * instant it is tapped. Only the roles that actually changed are granted/revoked -- every role the
 * person already held and kept is left completely alone -- and the sheet always ends up showing exactly
 * what the server holds, never a role the server rejected.
 */
function ManageStaffSheet({
  clubId,
  teamId,
  member,
  onClose,
  onChanged,
}: {
  clubId: string
  teamId: string
  member: TeamStaffMember
  onClose: () => void
  onChanged: () => void
}) {
  // Team Admin is access on top of a role, managed from the person's own record: it is never staged here,
  // and Save never touches it.
  const roles = useMemo(() => member.roles.filter((r) => r.roleKey !== "TEAM_ADMINISTRATION"), [member])
  const initial = useMemo<TeamRolePicks>(() => new Map(roles.map((r) => [r.roleKey, r.title])), [roles])
  const [selected, setSelected] = useState<TeamRolePicks>(() => new Map(initial))
  const [assignable, setAssignable] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void readAssignableRoles(supabase, clubId, teamId).then((r) => live && setAssignable(r.map((x) => x.roleKey))).catch(() => live && setAssignable([]))
    return () => {
      live = false
    }
  }, [clubId, teamId])

  const hasChanges = !sameRoles(selected, initial)

  async function save() {
    setBusy(true)
    setProblem(null)
    const currentKeys = new Set(roles.map((r) => r.roleKey))
    const toGrant = [...selected.keys()].filter((k) => !currentKeys.has(k))
    const toRevoke = roles.filter((r) => !selected.has(r.roleKey))
    const toRetitle = roles.filter((r) => selected.has(r.roleKey) && (selected.get(r.roleKey) ?? null) !== (r.title ?? null))
    const failures: string[] = []

    for (const key of toGrant) {
      try {
        await grantTeamStaffRole(supabase, member.membershipId, key, teamId, "Set on the team's Staff tab", selected.get(key) ?? null)
      } catch (caught) {
        failures.push(`${roleDisplayLabel(key, selected.get(key))}: ${teamStaffErrorMessage(caught, "couldn't be added")}`)
      }
    }
    for (const role of toRevoke) {
      try {
        await revokeTeamStaffRole(supabase, role.assignmentId, "Removed on the team's Staff tab")
      } catch (caught) {
        failures.push(`${role.displayLabel}: ${teamStaffErrorMessage(caught, "couldn't be removed")}`)
      }
    }
    for (const role of toRetitle) {
      try {
        await setStaffTitle(supabase, role.assignmentId, selected.get(role.roleKey) ?? null)
      } catch (caught) {
        failures.push(`${role.displayLabel} title: ${teamStaffErrorMessage(caught, "couldn't be set")}`)
      }
    }

    setBusy(false)
    onChanged()

    if (failures.length > 0) {
      setProblem(failures.join("; "))
      // Never leave the sheet showing a role the server rejected -- re-sync to exactly what it holds.
      try {
        const fresh = (await readTeamStaff(supabase, teamId)).find((m) => m.membershipId === member.membershipId)
        setSelected(new Map((fresh?.roles ?? []).filter((r) => r.roleKey !== "TEAM_ADMINISTRATION").map((r) => [r.roleKey, r.title])))
      } catch {
        setSelected(new Map(initial))
      }
      return
    }
    onClose()
  }

  async function removeAll() {
    setBusy(true)
    setProblem(null)
    let failed = 0
    for (const role of member.roles) {
      try {
        await revokeTeamStaffRole(supabase, role.assignmentId, "Removed from team staff")
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    if (failed > 0) {
      onChanged()
      setProblem(`${member.roles.length - failed} of ${member.roles.length} roles removed. Try again for the rest.`)
      return
    }
    onChanged()
    onClose()
  }

  return (
    <BottomSheet visible onClose={onClose} title={member.displayName}>
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <PersonAvatar name={member.displayName} url={member.avatarUrl} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{member.displayName}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{member.roles.map((r) => r.displayLabel).join(" · ") || "No roles held"}</Text>
          </View>
        </View>

        <Text style={[type.smallMedium, { color: colour.ink }]}>Team Roles</Text>
        <TeamRoleSelector assignable={assignable} value={selected} onChange={setSelected} disabled={busy} />

        {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

        <Button label="Save Changes" onPress={save} busy={busy} disabled={!hasChanges || [...selected.values()].some((t) => t !== null && t.trim() === "")} />

        <View style={{ height: 1, backgroundColor: colour.line, marginVertical: space.xs }} />

        {!confirmRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Remove from team staff" disabled={busy} onPress={() => setConfirmRemove(true)} style={{ minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
            <Text style={[type.smallMedium, { color: colour.danger }]}>Remove from Team Staff</Text>
          </Pressable>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              This ends {member.displayName}&apos;s {member.roles.length > 1 ? "roles" : "role"} on this team only -- their player place, guardian links, club membership and any role on another team are untouched.
            </Text>
            <Button label="Remove from Team Staff" variant="danger" onPress={removeAll} busy={busy} />
          </View>
        )}
      </View>
    </BottomSheet>
  )
}
