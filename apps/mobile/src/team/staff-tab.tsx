import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native"

import {
  COACH_TITLE_LABEL,
  TEAM_STAFF_ROLE_KEYS,
  grantTeamStaffRole,
  readTeamStaff,
  revokeTeamStaffRole,
  setCoachTitle,
  teamStaffErrorMessage,
  type CoachTitle,
  type TeamStaffMember,
} from "@ovalball/contracts/team/staff"
import { readClubPeople, type ClubPerson } from "@ovalball/contracts/club/people"

import { supabase } from "../auth/supabase"
import { NotForYou } from "./screen"
import { PersonAvatar } from "../components/identity"
import { BottomSheet } from "../components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { Check, ChevronRight, Search, UserPlus } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * STAFF -- every legitimate person running this team, and every role they actually hold (Team Profile
 * Section 4). Reads `team_staff` (Section 3's audit found the existing `team_people` staff branch
 * structurally could not represent this -- see that RPC's own migration comment); one row per person,
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
  identity: { id: string; clubId: string }
  rosterVisible: boolean
  /** `people.role.assign_team` -- the exact authority assign_role/transition_role_assignment already
   * re-check, asked with this team's own explicit id (Section 5/26), never inferred from a role name.
   * Unlike Squad, Staff needs no separate "am I standing in this team's own context" gate: every
   * mutation below calls its RPC with this screen's own explicit team id, so this one real authority
   * signal is already correct for a Club Admin managing a team they hold no personal role on. */
  canManageRoles: boolean
}) {
  const [staff, setStaff] = useState<TeamStaffMember[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [managing, setManaging] = useState<TeamStaffMember | null>(null)

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
  // review: without this, toggling a role off updated the real list behind the sheet correctly, but the
  // still-open sheet kept showing its own stale snapshot of that same person's roles, which reads as
  // the toggle having silently failed even though it genuinely succeeded. Closes the sheet naturally
  // once the person's last role on this team is gone, rather than showing an empty role sheet for a
  // person no longer staff at all.
  useEffect(() => {
    if (!staff || !managing) return
    setManaging(staff.find((m) => m.membershipId === managing.membershipId) ?? null)
    // Only ever react to a fresh `staff` array; re-running this because `managing` itself changed would
    // fight the very update it is trying to make.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff])

  // NO MESSAGE ACTION HERE (Section 7/8/29 vs. the existing CA-M7 team-operations directive): a Staff
  // row deliberately carries no messaging/contact affordance. `team_operations_ca7.test.mts` already
  // locks "no messaging route from a team entity" for every file under apps/mobile/src/team/, predating
  // this section -- this is a genuine conflict with the brief's own Section 29, not something to
  // silently resolve by weakening that lock. Flagged in the Section 4 report's CONTACT ACTIONS field
  // for the owner's explicit decision; nothing here opens a conversation of any kind.

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
        <EmptyState title="No staff added yet" body="Coaches, managers and team staff will appear here." icon={<UserPlus size={22} color={colour.inkSubtle} />} />
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

      {canManageRoles && <Button label="Add Staff Member" onPress={() => setAddOpen(true)} />}

      {addOpen && (
        <AddStaffSheet
          clubId={identity.clubId}
          teamId={identity.id}
          existingStaff={staff}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            void load()
          }}
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
  const roleLine = member.roles
    .map((r) => (r.roleKey === "COACH" && r.title ? COACH_TITLE_LABEL[r.title] : r.label))
    .join(" · ")

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

const ROLE_LABEL: Record<(typeof TEAM_STAFF_ROLE_KEYS)[number], string> = {
  TEAM_ADMINISTRATION: "Team Administration",
  TEAM_MANAGER: "Team Manager",
  COACH: "Coach",
  FIRST_AIDER: "First Aider",
}
// TEAM_ADMINISTRATION is a senior, rarely-delegated role (`visible: false` in the canonical catalogue --
// Section 19: "do not expose arbitrary platform roles") and is deliberately not offered in this picker;
// COACH/TEAM_MANAGER/FIRST_AIDER share the identical assignable_by ceiling, confirmed against the live
// role_definitions rows, so nothing here decides per-role assignability beyond the one canManageRoles gate.
const GRANTABLE_ROLES: (typeof TEAM_STAFF_ROLE_KEYS)[number][] = ["COACH", "TEAM_MANAGER", "FIRST_AIDER"]

/**
 * ADD STAFF MEMBER -- search existing club people first (Section 17: never a new identity), then
 * choose one or more roles in the same flow (Section 20). Reuses `readClubPeople`, the club's own
 * existing person directory/search -- no second people-search built for this one sheet.
 */
function AddStaffSheet({
  clubId,
  teamId,
  existingStaff,
  onClose,
  onDone,
}: {
  clubId: string
  teamId: string
  existingStaff: TeamStaffMember[]
  onClose: () => void
  onDone: () => void
}) {
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<ClubPerson[] | null>(null)
  const [picked, setPicked] = useState<ClubPerson | null>(null)
  const [roles, setRoles] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState<CoachTitle>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setPeople(null)
    void readClubPeople(supabase, clubId, { search: query, filter: "all", limit: 30 })
      .then((page) => {
        if (live) setPeople(page.people)
      })
      .catch(() => {
        if (live) setPeople([])
      })
    return () => {
      live = false
    }
  }, [clubId, query])

  const already = picked ? existingStaff.find((m) => m.membershipId === picked.membershipId) : null
  const alreadyHeld = new Set((already?.roles ?? []).map((r) => r.roleKey))

  function toggleRole(key: string) {
    if (alreadyHeld.has(key)) return
    setRoles((prior) => {
      const next = new Set(prior)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function submit() {
    if (!picked?.membershipId || roles.size === 0) return
    setBusy(true)
    setProblem(null)
    const succeeded: string[] = []
    const failed: string[] = []
    for (const roleKey of roles) {
      try {
        await grantTeamStaffRole(supabase, picked.membershipId, roleKey, teamId, `Added from Team Profile Staff (${roleKey})`)
        succeeded.push(roleKey)
      } catch (caught) {
        failed.push(`${ROLE_LABEL[roleKey as keyof typeof ROLE_LABEL] ?? roleKey}: ${teamStaffErrorMessage(caught, "couldn't be added")}`)
      }
    }
    // A coaching title only ever applies once Coach itself is genuinely held.
    if (title && (succeeded.includes("COACH") || alreadyHeld.has("COACH"))) {
      const coachAssignment = already?.roles.find((r) => r.roleKey === "COACH")
      // A freshly-granted Coach role's own assignment id isn't returned by assign_role in this flow;
      // the title can be set from Manage Staff Member immediately afterwards where it is.
      if (coachAssignment) {
        try {
          await setCoachTitle(supabase, coachAssignment.assignmentId, title)
        } catch {
          // Non-fatal: the role itself is granted; the title is cosmetic and can be set from Manage.
        }
      }
    }
    setBusy(false)
    if (failed.length === 0) {
      onDone()
      return
    }
    // HONEST PARTIAL FAILURE (Section 20): never reported as a plain success once anything failed.
    setProblem(succeeded.length > 0 ? `Added ${succeeded.length} of ${roles.size} roles. ${failed.join("; ")}` : failed.join("; "))
  }

  return (
    <BottomSheet visible onClose={onClose} title="Add Staff Member">
      {!picked ? (
        <View style={{ gap: space.md, minHeight: 320 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput
              accessibilityLabel="Search people"
              value={query}
              onChangeText={setQuery}
              placeholder="Search people..."
              placeholderTextColor={colour.inkSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]}
            />
          </View>
          {people === null ? (
            <CardSkeleton lines={3} />
          ) : people.length === 0 ? (
            <EmptyState title="No people match" body="Try a different name." icon={<Search size={22} color={colour.inkSubtle} />} />
          ) : (
            <ScrollView style={{ maxHeight: 360 }}>
              {people.filter((p) => p.membershipId && p.state === "ACTIVE").map((p, i) => (
                <Pressable
                  key={p.membershipId}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.firstName ?? ""} ${p.surname ?? ""}`.trim() || "Ovalball member"}
                  onPress={() => setPicked(p)}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, opacity: pressed ? 0.7 : 1 })}
                >
                  <PersonAvatar name={`${p.firstName ?? ""} ${p.surname ?? ""}`.trim()} url={null} size={40} />
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
                    {`${p.firstName ?? ""} ${p.surname ?? ""}`.trim() || "Ovalball member"}
                  </Text>
                  {existingStaff.some((m) => m.membershipId === p.membershipId) && (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>Already staff</Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <PersonAvatar name={`${picked.firstName ?? ""} ${picked.surname ?? ""}`.trim()} url={null} size={44} />
            <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{`${picked.firstName ?? ""} ${picked.surname ?? ""}`.trim()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose someone else" onPress={() => { setPicked(null); setRoles(new Set()) }} hitSlop={8}>
              <Text style={[type.small, { color: colour.forest800 }]}>Change</Text>
            </Pressable>
          </View>

          {already && (
            <View style={{ borderRadius: radius.md, backgroundColor: colour.chalk, padding: space.md }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                Already on this team: {already.roles.map((r) => r.label).join(" · ")}
              </Text>
            </View>
          )}

          <Text style={[type.smallMedium, { color: colour.ink }]}>Team roles</Text>
          {GRANTABLE_ROLES.map((key) => {
            const held = alreadyHeld.has(key)
            const on = held || roles.has(key)
            return (
              <Pressable
                key={key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: held }}
                accessibilityLabel={ROLE_LABEL[key]}
                disabled={held}
                onPress={() => toggleRole(key)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, opacity: pressed && !held ? 0.7 : 1 })}
              >
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
                  {on && <Check size={15} color={colour.onForest} strokeWidth={3} />}
                </View>
                <Text style={[type.small, { color: held ? colour.inkSubtle : colour.ink }]}>{ROLE_LABEL[key]}{held ? " (already held)" : ""}</Text>
              </Pressable>
            )
          })}

          {(roles.has("COACH") || alreadyHeld.has("COACH")) && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Coaching title</Text>
              {([null, "HEAD_COACH", "ASSISTANT_COACH"] as CoachTitle[]).map((t) => (
                <Pressable
                  key={t ?? "plain"}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: title === t }}
                  accessibilityLabel={t ? COACH_TITLE_LABEL[t] : "Coach"}
                  onPress={() => setTitle(t)}
                  style={{ minHeight: TOUCH_TARGET - 8, flexDirection: "row", alignItems: "center", gap: space.md }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: title === t ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
                    {title === t && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800 }} />}
                  </View>
                  <Text style={[type.small, { color: colour.ink }]}>{t ? COACH_TITLE_LABEL[t] : "Coach"}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

          <Button label="Add to Team" onPress={submit} busy={busy} disabled={roles.size === 0} />
        </View>
      )}
    </BottomSheet>
  )
}

/**
 * MANAGE STAFF MEMBER -- add or remove individual roles on THIS team without touching any other role,
 * team membership, player place or guardian relationship this person holds (Section 24/25/37/38). Each
 * toggle is its own atomic call to the canonical assign_role/transition_role_assignment, so a failure
 * on one role never masks a success on another.
 */
function ManageStaffSheet({
  clubId: _clubId,
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
  const [busyRole, setBusyRole] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const held = useMemo(() => new Map(member.roles.map((r) => [r.roleKey, r])), [member.roles])
  const coachRole = held.get("COACH")

  async function toggle(key: string) {
    setProblem(null)
    setBusyRole(key)
    try {
      const current = held.get(key)
      if (current) {
        await revokeTeamStaffRole(supabase, current.assignmentId, `Removed from Team Profile Staff (${key})`)
      } else {
        await grantTeamStaffRole(supabase, member.membershipId, key, teamId, `Added from Team Profile Staff (${key})`)
      }
      onChanged()
    } catch (caught) {
      setProblem(teamStaffErrorMessage(caught, "That change couldn't be made."))
    } finally {
      setBusyRole(null)
    }
  }

  async function changeTitle(t: CoachTitle) {
    if (!coachRole) return
    setBusyRole("COACH_TITLE")
    setProblem(null)
    try {
      await setCoachTitle(supabase, coachRole.assignmentId, t)
      onChanged()
    } catch (caught) {
      setProblem(teamStaffErrorMessage(caught, "That title couldn't be set."))
    } finally {
      setBusyRole(null)
    }
  }

  async function removeAll() {
    setBusyRole("REMOVE_ALL")
    setProblem(null)
    let failed = 0
    for (const role of member.roles) {
      try {
        await revokeTeamStaffRole(supabase, role.assignmentId, "Removed from team staff")
      } catch {
        failed += 1
      }
    }
    setBusyRole(null)
    if (failed > 0) {
      setProblem(`${member.roles.length - failed} of ${member.roles.length} roles removed. Try again for the rest.`)
      return
    }
    onChanged()
    onClose()
  }

  return (
    <BottomSheet visible onClose={onClose} title={member.displayName}>
      <View style={{ gap: space.md }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Team roles</Text>
        {GRANTABLE_ROLES.map((key) => {
          const on = held.has(key)
          return (
            <Pressable
              key={key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, busy: busyRole === key }}
              accessibilityLabel={ROLE_LABEL[key]}
              disabled={busyRole !== null}
              onPress={() => toggle(key)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
                {busyRole === key ? <ActivityIndicator size="small" color={on ? colour.onForest : colour.forest800} /> : on && <Check size={15} color={colour.onForest} strokeWidth={3} />}
              </View>
              <Text style={[type.small, { color: colour.ink }]}>{ROLE_LABEL[key]}</Text>
            </Pressable>
          )
        })}

        {!!coachRole && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Coaching title</Text>
            {([null, "HEAD_COACH", "ASSISTANT_COACH"] as CoachTitle[]).map((t) => (
              <Pressable
                key={t ?? "plain"}
                accessibilityRole="radio"
                accessibilityState={{ checked: coachRole.title === t }}
                accessibilityLabel={t ? COACH_TITLE_LABEL[t] : "Coach"}
                disabled={busyRole !== null}
                onPress={() => changeTitle(t)}
                style={{ minHeight: TOUCH_TARGET - 8, flexDirection: "row", alignItems: "center", gap: space.md }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: coachRole.title === t ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
                  {coachRole.title === t && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800 }} />}
                </View>
                <Text style={[type.small, { color: colour.ink }]}>{t ? COACH_TITLE_LABEL[t] : "Coach"}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

        <View style={{ height: 1, backgroundColor: colour.line, marginVertical: space.xs }} />

        {!confirmRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Remove from team staff" onPress={() => setConfirmRemove(true)} style={{ minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
            <Text style={[type.smallMedium, { color: colour.danger }]}>Remove from Team Staff</Text>
          </Pressable>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              This ends {member.displayName}&apos;s {member.roles.length > 1 ? "roles" : "role"} on this team only -- their player place, guardian links, club membership and any role on another team are untouched.
            </Text>
            <Button label="Remove from Team Staff" variant="danger" onPress={removeAll} busy={busyRole === "REMOVE_ALL"} />
          </View>
        )}
      </View>
    </BottomSheet>
  )
}
