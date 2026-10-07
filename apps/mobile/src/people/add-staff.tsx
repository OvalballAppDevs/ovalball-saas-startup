import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"

import { readInvitableTeams } from "@ovalball/contracts/club/invitations"
import { readAssignableRoles, readPeopleCapabilities } from "@ovalball/contracts/club/people"
import { grantTeamStaffRole, readTeamStaffCandidates, teamStaffErrorMessage, type StaffCandidate } from "@ovalball/contracts/team/staff"
import { resolvePersonalAvatarUrls } from "@ovalball/contracts/personal-avatar"
import { COMMON_TEAM_ROLES, CUSTOM_ROLE_BASE, roleDisplayLabel } from "@ovalball/contracts/role-labels"

import { supabase } from "../auth/supabase"
import { libraryAsset } from "../media/stock-assets"
import { PersonAvatar } from "../components/identity"
import { Button, CardSkeleton, EmptyState } from "../components/ui"
import { Plus, Search, UserPlus, Users } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { ActionGroup, ActionRow, Body, ChoiceRow, FlowScreen, Note, PhotoHero, SectionTitle } from "./ui"
import { TeamRoleSelector, pickLabelsWithAccess, picksProblem, type TeamRolePicks } from "./team-roles"
import type { StartRole } from "./invite-flow"

const HERO = libraryAsset("training-coaching-01")

/** The roles a club reaches for most, as quick starts: Coach's own titles are chosen inside the flow. */
const QUICK_ROLES = COMMON_TEAM_ROLES.filter((r) => !(r.roleKey === "COACH" && r.title !== null))

/** The invitation route, carrying the role to start from. */
function withStartRole(url: string, start: StartRole | null): string {
  if (!start) return url
  const title = start.title === null ? "" : `&title=${encodeURIComponent(start.title)}`
  return `${url}${url.includes("?") ? "&" : "?"}role=${encodeURIComponent(start.roleKey)}${title}`
}

/**
 * ADD STAFF MEMBERS -- one front door for coaches, managers and volunteers, from Home's Add to Club or a
 * team's Staff tab (People & Invitations; it replaces the Staff tab's own Add sheet and its "invitations
 * don't exist" message).
 *
 *   INVITE A NEW STAFF MEMBER  the one invitation flow (CLUB_STAFF), with this team already chosen.
 *   ADD EXISTING PERSON        somebody already in the club: choose them, choose what they do here, confirm.
 *
 * NEVER A SWITCHED CONTEXT, NEVER A NEW IDENTITY. Every grant carries this screen's own explicit team id to
 * `assign_role`, whose authority (`internal.team_people_level(club, team)`) is the team's own -- so a Club
 * Admin with no personal role here and the team's own Team Admin both work, and nobody else does. People
 * are chosen from `team_staff_candidates`, the club's active members by name with no contact details: an
 * existing person is never re-created. Nothing is granted from the role screen -- Confirm sits between.
 */
type Step = "start" | "team" | "search" | "roles" | "confirm"

export function AddStaff({ clubId, teamId: givenTeamId, teamName: givenTeamName, inviteRoute, onFinished }: { clubId: string; teamId?: string | null; teamName?: string | null; inviteRoute: (teamId: string | null, teamName: string | null) => string; onFinished: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("start")
  const [canInvite, setCanInvite] = useState<boolean | null>(null)
  const [teams, setTeams] = useState<{ id: string; displayName: string }[] | null>(null)
  const [teamId, setTeamId] = useState<string | null>(givenTeamId ?? null)
  const [teamName, setTeamName] = useState<string | null>(givenTeamName ?? null)
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<StaffCandidate[] | null>(null)
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map())
  const [searchProblem, setSearchProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<StaffCandidate | null>(null)
  const [assignable, setAssignable] = useState<string[]>([])
  const [roles, setRoles] = useState<TeamRolePicks>(new Map())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [startRole, setStartRole] = useState<StartRole | null>(null)

  useEffect(() => {
    let live = true
    void readPeopleCapabilities(supabase, clubId).then((c) => live && setCanInvite(c.invite)).catch(() => live && setCanInvite(false))
    if (!givenTeamId) void readInvitableTeams(supabase, clubId).then((t) => live && setTeams(t)).catch(() => live && setTeams([]))
    return () => {
      live = false
    }
  }, [clubId, givenTeamId])

  // THE SEARCH IS THE SERVER'S: the club's active members by name, for whoever may give a role at this team.
  useEffect(() => {
    if (step !== "search" || !teamId) return
    let live = true
    const t = setTimeout(() => {
      setSearchProblem(null)
      readTeamStaffCandidates(supabase, teamId, query, 30)
        .then(async (rows) => {
          if (!live) return
          setPeople(rows)
          const urls = await resolvePersonalAvatarUrls(supabase, rows.map((r) => r.avatarStoragePath))
          if (live) setAvatars(urls)
        })
        .catch((cause) => {
          if (!live) return
          setPeople([])
          setSearchProblem(teamStaffErrorMessage(cause, "Couldn't search the club's people."))
        })
    }, query ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [teamId, query, step])

  const loadAssignable = useCallback(async () => {
    if (!teamId) return
    try {
      setAssignable((await readAssignableRoles(supabase, clubId, teamId)).map((r) => r.roleKey))
    } catch {
      setAssignable([])
    }
  }, [clubId, teamId])
  useEffect(() => void loadAssignable(), [loadAssignable])

  const alreadyHeld = new Set((picked?.rolesHere ?? []).map((r) => r.roleKey))

  // A QUICK START: someone who may invite starts an invitation with the role chosen; anyone else chooses an
  // existing member, with the role waiting for them on the next step.
  function startWith(start: StartRole) {
    if (canInvite) {
      router.push(withStartRole(inviteRoute(teamId, teamName), start) as never)
      return
    }
    setStartRole(start)
    setStep(givenTeamId ? "search" : "team")
  }
  const newRoles = [...roles.keys()].filter((k) => !alreadyHeld.has(k))

  async function submit() {
    if (!picked || !teamId || newRoles.length === 0) return
    setBusy(true)
    setProblem(null)
    const succeeded: string[] = []
    const failed: string[] = []
    for (const roleKey of newRoles) {
      try {
        await grantTeamStaffRole(supabase, picked.membershipId, roleKey, teamId, "Added from Add Staff Members", roles.get(roleKey) ?? null)
        succeeded.push(roleKey)
      } catch (caught) {
        failed.push(`${roleDisplayLabel(roleKey, roles.get(roleKey))}: ${teamStaffErrorMessage(caught, "couldn't be added")}`)
      }
    }
    setBusy(false)
    if (failed.length === 0) {
      onFinished()
      return
    }
    // HONEST PARTIAL FAILURE: never reported as a plain success once anything failed.
    setProblem(succeeded.length > 0 ? `Added ${succeeded.length} of ${newRoles.length} roles. ${failed.join("; ")}` : failed.join("; "))
  }

  const back = step === "team" || step === "search" ? () => setStep(givenTeamId ? "start" : step === "search" ? "team" : "start") : step === "roles" ? () => setStep("search") : step === "confirm" ? () => setStep("roles") : undefined

  return (
    <FlowScreen title={step === "start" ? "Add Staff Members" : step === "confirm" ? "Confirm" : "Add Existing Person"} onBack={back}>
      {step === "start" && <PhotoHero image={HERO} title="Invite Staff Members" body="Coaches, managers, volunteers and anyone else who helps run the team." />}
      <Body>
        {step === "start" && (
          <View style={{ gap: space.xl }}>
            <ActionGroup>
              <ActionRow
                first
                icon={<UserPlus size={20} color={colour.forest800} />}
                title="Invite a New Staff Member"
                caption={canInvite === false ? "Only a Club Admin can invite someone new to the club." : "Send an invitation by link, QR code or WhatsApp."}
                disabled={canInvite !== true}
                onPress={canInvite ? () => router.push(inviteRoute(teamId, teamName) as never) : undefined}
              />
              <ActionRow icon={<Users size={20} color={colour.forest800} />} title="Add Existing Person" caption="Choose someone who is already in the club." onPress={() => setStep(givenTeamId ? "search" : "team")} />
            </ActionGroup>
            {canInvite !== null && (
              <View style={{ gap: space.md }}>
                <SectionTitle title="Common Staff Roles" detail={canInvite ? "Start an invitation with the role already chosen." : "Choose someone already in the club, with the role already chosen."} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {QUICK_ROLES.map((r) => (
                    <Pressable
                      key={r.id}
                      accessibilityRole="button"
                      accessibilityLabel={canInvite ? `Invite as ${r.label}` : `Add as ${r.label}`}
                      onPress={() => startWith({ roleKey: r.roleKey, title: r.title })}
                      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: pressed ? colour.mint100 : colour.surface })}
                    >
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create a custom role"
                  accessibilityHint="Name what they do. It gives the same access as Volunteer."
                  onPress={() => startWith({ roleKey: CUSTOM_ROLE_BASE, title: "" })}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, alignSelf: "flex-start", opacity: pressed ? 0.7 : 1 })}
                >
                  <Plus size={18} color={colour.forest800} />
                  <Text style={[type.bodyMedium, { color: colour.forest800 }]}>Create a Custom Role</Text>
                </Pressable>
              </View>
            )}
            <Note>Staff accept with their own Ovalball account. You can give one or more roles, and each gives access to that team only.</Note>
          </View>
        )}

        {step === "team" && (
          <View style={{ gap: space.md }}>
            <SectionTitle title="Which Team?" detail="Staff roles are held for a team." />
            {teams === null ? (
              <CardSkeleton lines={3} />
            ) : (
              <View style={{ gap: space.sm }}>
                {teams.map((t) => (
                  <ChoiceRow key={t.id} kind="link" checked={false} label={t.displayName} onPress={() => { setTeamId(t.id); setTeamName(t.displayName); setPeople(null); setStep("search") }} />
                ))}
              </View>
            )}
          </View>
        )}

        {step === "search" && (
          <View style={{ gap: space.md }}>
            <SectionTitle title={`Add to ${teamName ?? "the Team"}`} detail="Choose someone who is already a member of the club." />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
              <Search size={18} color={colour.inkSubtle} />
              <TextInput accessibilityLabel="Search club members" value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={colour.inkSubtle} autoCapitalize="words" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
            </View>
            {searchProblem && <Note tone="warning">{searchProblem}</Note>}
            {people === null && !searchProblem && <CardSkeleton lines={3} />}
            {people !== null && people.length === 0 && !searchProblem && <EmptyState title="No members match" body={query ? "Try a different name." : "The club has no members to choose from yet."} icon={<Search size={22} color={colour.inkSubtle} />} />}
            {people !== null && people.length > 0 && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {people.map((p, i) => {
                  const here = p.rolesHere.map((r) => roleDisplayLabel(r.roleKey, r.title)).join(", ")
                  return (
                    <Pressable
                      key={p.membershipId}
                      accessibilityRole="button"
                      accessibilityLabel={here ? `${p.name}, already ${here}` : p.name}
                      onPress={() => {
                        setPicked(p)
                        setRoles(startRole && assignable.includes(startRole.roleKey) && !p.rolesHere.some((r) => r.roleKey === startRole.roleKey) ? new Map([[startRole.roleKey, startRole.title]]) : new Map())
                        setProblem(null)
                        setStep("roles")
                      }}
                      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                    >
                      <PersonAvatar name={p.name} url={p.avatarStoragePath ? (avatars.get(p.avatarStoragePath) ?? null) : null} size={40} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.bodyMedium, { color: colour.ink }]}>{p.name}</Text>
                        {!!here && <Text style={[type.caption, { color: colour.inkMuted }]}>Already {here}</Text>}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </View>
        )}

        {step === "roles" && picked && (
          <View style={{ gap: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <PersonAvatar name={picked.name} url={picked.avatarStoragePath ? (avatars.get(picked.avatarStoragePath) ?? null) : null} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.heading, { color: colour.ink }]}>{picked.name}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>{teamName}</Text>
              </View>
            </View>
            <SectionTitle title="What Do They Do?" detail="Choose one or more. You can change this later." />
            <TeamRoleSelector assignable={assignable} value={roles} onChange={setRoles} held={alreadyHeld} />
            {newRoles.length > 0 && !!picksProblem(new Map([...roles].filter(([k]) => !alreadyHeld.has(k)))) && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>{picksProblem(new Map([...roles].filter(([k]) => !alreadyHeld.has(k))))}</Text>
            )}
            <Button label="Continue" onPress={() => setStep("confirm")} disabled={newRoles.length === 0 || !!picksProblem(new Map([...roles].filter(([k]) => !alreadyHeld.has(k))))} />
          </View>
        )}

        {step === "confirm" && picked && (
          <View style={{ gap: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <PersonAvatar name={picked.name} url={picked.avatarStoragePath ? (avatars.get(picked.avatarStoragePath) ?? null) : null} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.heading, { color: colour.ink }]}>{picked.name}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>{teamName}</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Roles to Give</Text>
              {pickLabelsWithAccess(new Map([...roles].filter(([k]) => !alreadyHeld.has(k)))).map((label) => (
                <Text key={label} style={[type.body, { color: colour.ink }]}>{label}</Text>
              ))}
            </View>
            <Note>{`${picked.name} gets access to ${teamName ?? "this team"} that comes with these roles, and nothing more. Their other roles are untouched.`}</Note>
            {!!problem && <Note tone="danger">{problem}</Note>}
            <Button label="Confirm and Add" onPress={submit} busy={busy} />
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
