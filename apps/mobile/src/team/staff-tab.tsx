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
import { Check, ChevronRight, Info, Search, UserPlus, Users } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

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
  identity: { id: string; clubId: string }
  rosterVisible: boolean
  /** `people.role.assign_team` -- the exact authority assign_role/transition_role_assignment already
   * re-check, asked with this team's own explicit id (Section 5/26), never inferred from a role name. */
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

/**
 * THE ONE ROLE CATALOGUE, shared by Add Staff Member and Manage Staff Member (Section 4 addendum,
 * Section 5/8: "Do not maintain separate role vocabulary"). TEAM_ADMINISTRATION is a senior,
 * rarely-delegated role (`visible: false` in the canonical catalogue -- "do not expose arbitrary
 * platform roles") and is deliberately never offered here. TEAM_MANAGER/COACH/FIRST_AIDER/
 * TEAM_SAFEGUARDING_LEAD all share the identical `assignable_by` ceiling ({SITE, CLUB, TEAM_ADMIN}),
 * confirmed against the live `role_definitions` rows, so nothing here decides per-role assignability
 * beyond the one `canManageRoles` gate that already re-asks that exact authority server-side.
 *
 * Display order follows the owner's own suggested order (Team Manager, then the coaching family, then
 * First Aider, then Team Safeguarding Lead); the underlying `roles[]` array a person carries stays
 * canonical and never depends on this order.
 */
const ROLE_LABEL: Record<(typeof TEAM_STAFF_ROLE_KEYS)[number], string> = {
  TEAM_ADMINISTRATION: "Team Administration",
  TEAM_MANAGER: "Team Manager",
  COACH: "Coach",
  FIRST_AIDER: "First Aider",
  TEAM_SAFEGUARDING_LEAD: "Team Safeguarding Lead",
}
const ROLE_DESCRIPTION: Record<(typeof TEAM_STAFF_ROLE_KEYS)[number], string> = {
  TEAM_ADMINISTRATION: "",
  TEAM_MANAGER: "Manages day-to-day team operations.",
  COACH: "Leads or supports the team's coaching.",
  FIRST_AIDER: "Provides team first-aid support.",
  TEAM_SAFEGUARDING_LEAD: "Team-level safeguarding contact.",
}
const GRANTABLE_ROLES: (typeof TEAM_STAFF_ROLE_KEYS)[number][] = ["TEAM_MANAGER", "COACH", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD"]
const COACH_TITLE_DESCRIPTION: Record<Exclude<CoachTitle, null> | "plain", string> = {
  HEAD_COACH: "Lead coaching role.",
  plain: "Coaching role.",
  ASSISTANT_COACH: "Supports coaching delivery.",
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/**
 * ONE SELECTABLE ROLE CARD -- a checkbox, the role's own label and a one-line description, reused for
 * every role and by both Add and Manage (Section 4 addendum Section 5: "polished selectable
 * cards/check rows"). Coach nests its own coaching-title picker directly underneath when checked,
 * rather than exposing Head Coach/Coach/Assistant Coach as three separate top-level checkboxes --
 * canonical authority is always exactly one COACH assignment, and this shape makes that structurally
 * impossible to violate from the UI (never "Head Coach + Coach + Assistant Coach" simultaneously).
 */
function RoleSelector({
  selected,
  onToggle,
  coachTitle,
  onSetCoachTitle,
  lockedKeys,
  disabled,
}: {
  selected: Set<string>
  onToggle: (key: string) => void
  coachTitle: CoachTitle
  onSetCoachTitle: (t: CoachTitle) => void
  lockedKeys?: Set<string>
  disabled?: boolean
}) {
  return (
    <View style={{ gap: space.sm }}>
      {GRANTABLE_ROLES.map((key) => {
        const locked = lockedKeys?.has(key) ?? false
        const on = selected.has(key)
        return (
          <View key={key}>
            <RoleCard
              label={ROLE_LABEL[key]}
              description={ROLE_DESCRIPTION[key]}
              checked={on}
              disabled={disabled || locked}
              suffix={locked ? "(already held)" : undefined}
              onPress={() => onToggle(key)}
            />
            {key === "COACH" && on && (
              <View style={{ marginLeft: space.xl, marginTop: space.xs, gap: 2 }}>
                {(["HEAD_COACH", null, "ASSISTANT_COACH"] as CoachTitle[]).map((t) => (
                  <TitleRadio
                    key={t ?? "plain"}
                    label={t ? COACH_TITLE_LABEL[t] : "Coach"}
                    description={COACH_TITLE_DESCRIPTION[t ?? "plain"]}
                    checked={coachTitle === t}
                    disabled={disabled}
                    onPress={() => onSetCoachTitle(t)}
                  />
                ))}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

function RoleCard({
  label,
  description,
  checked,
  disabled,
  suffix,
  onPress,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  suffix?: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={`${label}${suffix ? ` ${suffix}` : ""}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: checked ? colour.forest800 : colour.line,
        backgroundColor: checked ? "rgba(16,61,44,0.06)" : colour.surface,
        opacity: pressed && !disabled ? 0.8 : disabled ? 0.6 : 1,
      })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, marginTop: 1, borderWidth: 1.5, borderColor: checked ? colour.forest800 : colour.lineStrong, backgroundColor: checked ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
        {checked && <Check size={15} color={colour.onForest} strokeWidth={3} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: disabled ? colour.inkSubtle : colour.ink }]}>{label}{suffix ? ` ${suffix}` : ""}</Text>
        {!!description && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{description}</Text>}
      </View>
    </Pressable>
  )
}

function TitleRadio({
  label,
  description,
  checked,
  disabled,
  onPress,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: TOUCH_TARGET - 8, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: disabled ? 0.6 : 1 }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: checked ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
        {checked && <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: colour.forest800 }} />}
      </View>
      <Text style={[type.small, { color: colour.ink }]}>{label} <Text style={{ color: colour.inkMuted }}>· {description}</Text></Text>
    </Pressable>
  )
}

type AddStep = "method" | "invite-gap" | "search" | "roles" | "confirm"

/**
 * ADD STAFF MEMBER -- choose an existing club person or (for now, honestly) find that inviting a new
 * one is not yet a real flow; search existing club people (Section 17: never a new identity); choose
 * role(s) (Section 20); review before mutating (Section 4 addendum Section 7 -- never mutate straight
 * from the checkbox screen).
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
  const [step, setStep] = useState<AddStep>("method")
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<ClubPerson[] | null>(null)
  const [picked, setPicked] = useState<ClubPerson | null>(null)
  const [roles, setRoles] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState<CoachTitle>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (step !== "search") return
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
  }, [clubId, query, step])

  const already = picked ? existingStaff.find((m) => m.membershipId === picked.membershipId) : null
  const alreadyHeld = new Set((already?.roles ?? []).map((r) => r.roleKey))
  const fullName = picked ? `${picked.firstName ?? ""} ${picked.surname ?? ""}`.trim() || "Ovalball member" : ""
  const newRoles = [...roles].filter((k) => !alreadyHeld.has(k))

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
    if (!picked?.membershipId || newRoles.length === 0) return
    setBusy(true)
    setProblem(null)
    const succeeded: string[] = []
    const failed: string[] = []
    for (const roleKey of newRoles) {
      try {
        await grantTeamStaffRole(supabase, picked.membershipId, roleKey, teamId, `Added from Team Profile Staff (${roleKey})`)
        succeeded.push(roleKey)
      } catch (caught) {
        failed.push(`${ROLE_LABEL[roleKey as keyof typeof ROLE_LABEL] ?? roleKey}: ${teamStaffErrorMessage(caught, "couldn't be added")}`)
      }
    }
    // A coaching title only ever applies once Coach itself is genuinely held. For a Coach role granted
    // in THIS call, assign_role returns no assignment id, so the fresh roster is re-read to find it --
    // closing a gap the original Add flow had, where a title picked alongside a brand-new Coach grant
    // was silently dropped rather than ever being set.
    if (title && succeeded.includes("COACH")) {
      try {
        const fresh = await readTeamStaff(supabase, teamId)
        const coachAssignment = fresh.find((m) => m.membershipId === picked.membershipId)?.roles.find((r) => r.roleKey === "COACH")
        if (coachAssignment) await setCoachTitle(supabase, coachAssignment.assignmentId, title)
      } catch {
        // Non-fatal: the role itself is granted; the title is cosmetic and can be set from Manage.
      }
    } else if (title && alreadyHeld.has("COACH")) {
      const existingCoach = already?.roles.find((r) => r.roleKey === "COACH")
      if (existingCoach) {
        try {
          await setCoachTitle(supabase, existingCoach.assignmentId, title)
        } catch {
          // Non-fatal, as above.
        }
      }
    }
    setBusy(false)
    if (failed.length === 0) {
      onDone()
      return
    }
    // HONEST PARTIAL FAILURE (Section 20): never reported as a plain success once anything failed.
    setProblem(succeeded.length > 0 ? `Added ${succeeded.length} of ${newRoles.length} roles. ${failed.join("; ")}` : failed.join("; "))
  }

  return (
    <BottomSheet visible onClose={onClose} title={step === "confirm" ? "Confirm" : step === "roles" ? "Assign Roles" : step === "invite-gap" ? "Invite a New Staff Member" : "Add Staff Member"}>
      {step === "method" && (
        <View style={{ gap: space.md }}>
          <MethodCard
            label="Select from Club People"
            description="Choose an existing parent, player or member from your club."
            onPress={() => setStep("search")}
          />
          <MethodCard
            label="Invite a New Staff Member"
            description="Share a QR code or invite code for someone to join and then assign their role."
            onPress={() => setStep("invite-gap")}
          />
        </View>
      )}

      {step === "invite-gap" && (
        <View style={{ gap: space.md }}>
          <View style={{ borderRadius: radius.md, backgroundColor: colour.chalk, padding: space.md, flexDirection: "row", gap: space.sm }}>
            <Info size={16} color={colour.inkMuted} />
            <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>
              Inviting someone who is not yet on Ovalball is not available from the app yet -- it needs a
              dedicated team-staff invitation, which does not exist in the platform today. Add this
              person once they have joined the club another way, or invite them from the club's own
              invitation tools on the website.
            </Text>
          </View>
          <Button label="Select from Club People Instead" onPress={() => setStep("search")} />
          <Button label="Back" variant="secondary" onPress={() => setStep("method")} />
        </View>
      )}

      {step === "search" && (
        <View style={{ gap: space.md, minHeight: 320 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput
              accessibilityLabel="Search people"
              value={query}
              onChangeText={setQuery}
              placeholder="Search club members..."
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
                  onPress={() => {
                    setPicked(p)
                    setRoles(new Set())
                    setTitle(null)
                    setProblem(null)
                    setStep("roles")
                  }}
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
      )}

      {step === "roles" && picked && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <PersonAvatar name={fullName} url={null} size={44} />
            <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{fullName}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose someone else" onPress={() => { setPicked(null); setRoles(new Set()); setStep("search") }} hitSlop={8}>
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

          <View>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Select Team Role(s)</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>You can assign multiple roles.</Text>
          </View>

          <RoleSelector selected={roles} onToggle={toggleRole} coachTitle={title} onSetCoachTitle={setTitle} lockedKeys={alreadyHeld} />

          <Button label="Continue" onPress={() => setStep("confirm")} disabled={newRoles.length === 0} />
        </View>
      )}

      {step === "confirm" && picked && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <PersonAvatar name={fullName} url={null} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{fullName}</Text>
              {already && <Text style={[type.caption, { color: colour.inkMuted }]}>Already on this team: {already.roles.map((r) => r.label).join(" · ")}</Text>}
            </View>
          </View>

          <Text style={[type.smallMedium, { color: colour.ink }]}>Roles to be assigned</Text>
          <View style={{ gap: 6 }}>
            {newRoles.map((k) => (
              <Text key={k} style={[type.small, { color: colour.ink }]}>
                {k === "COACH" && title ? COACH_TITLE_LABEL[title] : ROLE_LABEL[k as keyof typeof ROLE_LABEL]}
              </Text>
            ))}
          </View>

          <View style={{ borderRadius: radius.md, backgroundColor: colour.chalk, padding: space.md, flexDirection: "row", gap: space.sm }}>
            <Info size={16} color={colour.inkMuted} />
            <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
              {fullName} will be added to this team with the selected role(s). They will have the
              appropriate team access based on these roles.
            </Text>
          </View>

          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

          <Button label="Confirm and Add" onPress={submit} busy={busy} />
        </View>
      )}
    </BottomSheet>
  )
}

function MethodCard({ label, description, onPress }: { label: string; description: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : colour.surface,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center" }}>
        <Users size={20} color={colour.forest800} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{description}</Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

/**
 * MANAGE STAFF MEMBER -- role changes are staged locally and applied together behind one "Save Changes"
 * (Section 4 addendum Section 3), rather than each checkbox firing its own permanent mutation the
 * instant it is tapped. Only the roles that actually changed are granted/revoked -- every role the
 * person already held and kept is left completely alone -- and the sheet always ends up showing exactly
 * what the server holds, never a role the server rejected.
 */
function ManageStaffSheet({
  teamId,
  member,
  onClose,
  onChanged,
}: {
  teamId: string
  member: TeamStaffMember
  onClose: () => void
  onChanged: () => void
}) {
  const initialKeys = useMemo(() => new Set(member.roles.map((r) => r.roleKey)), [member.membershipId])
  const initialCoach = useMemo(() => member.roles.find((r) => r.roleKey === "COACH")?.title ?? null, [member.membershipId])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialKeys))
  const [title, setTitle] = useState<CoachTitle>(initialCoach)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const hasChanges = !setsEqual(selected, initialKeys) || (selected.has("COACH") && title !== initialCoach)

  function toggle(key: string) {
    setProblem(null)
    setSelected((prior) => {
      const next = new Set(prior)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function save() {
    setBusy(true)
    setProblem(null)
    const currentKeys = new Set(member.roles.map((r) => r.roleKey))
    const toGrant = [...selected].filter((k) => !currentKeys.has(k))
    const toRevoke = member.roles.filter((r) => !selected.has(r.roleKey))
    const failures: string[] = []

    for (const key of toGrant) {
      try {
        await grantTeamStaffRole(supabase, member.membershipId, key, teamId, `Set from Team Profile Staff (${key})`)
      } catch (caught) {
        failures.push(`${ROLE_LABEL[key as keyof typeof ROLE_LABEL] ?? key}: ${teamStaffErrorMessage(caught, "couldn't be added")}`)
      }
    }
    for (const role of toRevoke) {
      try {
        await revokeTeamStaffRole(supabase, role.assignmentId, `Removed from Team Profile Staff (${role.roleKey})`)
      } catch (caught) {
        failures.push(`${ROLE_LABEL[role.roleKey as keyof typeof ROLE_LABEL] ?? role.roleKey}: ${teamStaffErrorMessage(caught, "couldn't be removed")}`)
      }
    }

    let fresh: TeamStaffMember[] = []
    try {
      fresh = await readTeamStaff(supabase, teamId)
    } catch {
      fresh = []
    }
    let freshMember = fresh.find((m) => m.membershipId === member.membershipId) ?? null
    const freshCoach = freshMember?.roles.find((r) => r.roleKey === "COACH")
    if (selected.has("COACH") && freshCoach && freshCoach.title !== title) {
      try {
        await setCoachTitle(supabase, freshCoach.assignmentId, title)
        freshMember = { ...freshMember!, roles: freshMember!.roles.map((r) => (r.roleKey === "COACH" ? { ...r, title } : r)) }
      } catch (caught) {
        failures.push(`Coaching title: ${teamStaffErrorMessage(caught, "couldn't be set")}`)
      }
    }

    setBusy(false)
    onChanged()

    if (failures.length > 0) {
      setProblem(failures.join("; "))
      // Never leave the sheet showing a role the server rejected -- re-sync to exactly what it holds.
      const settled = freshMember ?? member
      setSelected(new Set(settled.roles.map((r) => r.roleKey)))
      setTitle(settled.roles.find((r) => r.roleKey === "COACH")?.title ?? null)
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
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {member.roles.map((r) => (r.roleKey === "COACH" && r.title ? COACH_TITLE_LABEL[r.title] : r.label)).join(" · ") || "No roles held"}
            </Text>
          </View>
        </View>

        <Text style={[type.smallMedium, { color: colour.ink }]}>Team Roles</Text>
        <RoleSelector selected={selected} onToggle={toggle} coachTitle={title} onSetCoachTitle={setTitle} disabled={busy} />

        {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

        <Button label="Save Changes" onPress={save} busy={busy} disabled={!hasChanges} />

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
