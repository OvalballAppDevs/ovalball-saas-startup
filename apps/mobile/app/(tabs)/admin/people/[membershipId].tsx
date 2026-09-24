import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { resolvePersonalAvatarUrl } from "@ovalball/contracts/personal-avatar"
import { CLUB_ROLE_OPTIONS, TEAM_STAFF_PERMISSION_OPTIONS, type ClubRole, type TeamStaffPermission } from "@ovalball/contracts/role-labels"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"
import {
  assignAdditionalRole,
  clubRoleLabel,
  endRoleAssignment,
  MEMBERSHIP_STATE_LABEL,
  peopleErrorMessage,
  personName,
  readAssignableRoles,
  readClubPerson,
  readPeopleCapabilities,
  reasonRuleFor,
  removeTeamAccess,
  setPrimaryClubRole,
  setTeamAccess,
  teamPermissionLabel,
  transitionMembership,
  type AssignableRole,
  type ClubPerson,
  type PeopleCapabilities,
} from "@ovalball/contracts/club/people"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { supabase } from "../../../../src/auth/supabase"
import { PersonAvatar } from "../../../../src/components/identity"
import { Button, Card, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { formatDate } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ONE PERSON'S RELATIONSHIP WITH THIS CLUB, natively (CA-M3).
 *
 * Sections, each canonical and each only where the server says the viewer may act: Identity (the
 * PERSON's avatar and name; email only under people.member.view_contact); Club Membership (the
 * primary club role -- Club Admin, Fixture Secretary, Member -- and the membership's state);
 * Team Roles (Team Admin / Manager / Coach on the club's sides, referencing canonical teams by id
 * from the club's own list); Additional Roles (Volunteer; a Safeguarding Officer is shown and is
 * appointed elsewhere); Access (Suspend, Restore, Remove).
 *
 * EVERY CHANGE is explicit, confirmed, reasoned where the shared list says the server requires it,
 * server-authorised and audited by the server. Nothing here is a permission editor: roles remain
 * default authority bundles, and what a person may DO is CA-M4's. Site Admin facts, other clubs,
 * safeguarding records and family relationships are not read here.
 *
 * SELF: the server lets a Club Admin change their own seat and remove themselves, refuses
 * self-suspension, and refuses any change that would leave the club without a Club Admin. The
 * screen mirrors the website: it does not offer a person their own role change or removal.
 */
export default function PersonScreen() {
  const router = useRouter()
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const [person, setPerson] = useState<ClubPerson | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [caps, setCaps] = useState<PeopleCapabilities | null>(null)
  const [teams, setTeams] = useState<ClubTeam[]>([])
  const [assignable, setAssignable] = useState<AssignableRole[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [picking, setPicking] = useState<"role" | "team" | "extra" | null>(null)
  const [pickedTeam, setPickedTeam] = useState<string | null>(null)
  const [pickedPermission, setPickedPermission] = useState<TeamStaffPermission>("coach")
  const [gone, setGone] = useState(false)

  const load = useCallback(async () => {
    if (!clubId || !membershipId) {
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const [p, allowed, dir, roles] = await Promise.all([readClubPerson(supabase, clubId, membershipId), readPeopleCapabilities(supabase, clubId), readClubTeams(supabase, clubId), readAssignableRoles(supabase, clubId)])
      setPerson(p)
      setCaps(allowed)
      setTeams(dir.teams.filter((t) => t.active))
      setAssignable(roles)
      setAvatarUrl(p?.avatarStoragePath ? await resolvePersonalAvatarUrl(supabase, p.avatarStoragePath) : null)
    } catch (cause) {
      const translated = friendly(cause, "this person")
      logDetail("admin:person", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId, membershipId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const name = person ? personName(person) : "Person"
  const canManageMembership = !!caps?.assignClub
  const canSuspend = canManageMembership && !!caps?.suspend
  const canRevoke = canManageMembership && !!caps?.revoke
  const canTeams = !!caps?.assignTeam

  function confirmThen(ask: Omit<ReasonAsk, "onConfirm">, op: (reason: string) => Promise<void>, done: string) {
    setAsk({
      ...ask,
      onConfirm: async (reason) => {
        await op(reason)
        setNotice(done)
        await load()
      },
    })
  }

  return (
    <AdminScreen section={name} onRefresh={() => void load()} refreshing={false}>
      {loading && !person && <CardSkeleton lines={4} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {!loading && !loadError && !person && !gone && <ErrorState message="This person is not part of the club any more, or is not visible to you." />}
      {gone && <ErrorState message={`${name} has been removed from the club. Their membership is kept as history.`} onRetry={() => router.back()} />}

      {person && !gone && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <PersonAvatar name={name} url={avatarUrl} size={72} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                {name}
                {person.isSelf ? <Text style={{ color: colour.inkMuted }}> (you)</Text> : null}
              </Text>
              {person.email ? <Text style={[type.small, { color: colour.inkMuted }]}>{person.email}</Text> : <Text style={[type.caption, { color: colour.inkSubtle }]}>Contact details need the club's contact permission.</Text>}
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                <StatusPill label={clubRoleLabel(person.role)} tone="neutral" />
                <StatusPill label={MEMBERSHIP_STATE_LABEL[person.state]} tone={person.state === "ACTIVE" ? "positive" : person.state === "SUSPENDED" ? "caution" : "neutral"} />
              </View>
            </View>
          </View>

          {notice && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
              <Text style={[type.small, { color: colour.forest800 }]}>{notice}</Text>
            </View>
          )}

          <Section title="Club Membership">
            <Row label="Club Role" value={clubRoleLabel(person.role)} />
            <Row label="State" value={MEMBERSHIP_STATE_LABEL[person.state]} />
            {person.since && <Row label="Member Since" value={formatDate(person.since)} />}
            {canManageMembership && !person.isSelf && person.state !== "PENDING" && (
              <>
                {picking !== "role" && <Button label="Change Club Role" variant="secondary" onPress={() => setPicking("role")} />}
                {picking === "role" && (
                  <View style={{ gap: space.sm }}>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>The role sets what they can do by default. Fixture Secretary and Club Admin are club-wide.</Text>
                    {CLUB_ROLE_OPTIONS.filter((o) => o.value !== person.role).map((o) => (
                      <Button
                        key={o.value}
                        label={o.label}
                        variant="secondary"
                        onPress={() =>
                          confirmThen(
                            { title: `Make ${name} ${o.label}?`, body: o.value === "CLUB_ADMIN" ? "They will be able to run the club." : undefined, confirmLabel: `Make ${o.label}`, reason: reasonRuleFor("set_primary_club_role") },
                            (reason) => setPrimaryClubRole(supabase, person.membershipId!, o.value as ClubRole, reason),
                            `${name} is now ${o.label}.`
                          )
                        }
                      />
                    ))}
                    <Button label="Cancel" variant="quiet" onPress={() => setPicking(null)} />
                  </View>
                )}
              </>
            )}
            {person.isSelf && <Text style={[type.caption, { color: colour.inkMuted }]}>Your own role and access are changed by another Club Admin.</Text>}
          </Section>

          <Section title="Team Roles">
            {person.teamRoles.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No team roles.</Text>}
            {person.teamRoles.map((t) => (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{t.teamDisplayName}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{teamPermissionLabel(t.permission)}</Text>
                </View>
                {canTeams && !person.isSelf && (
                  <Button label="Remove" variant="quiet" onPress={() => confirmThen({ title: `Remove ${name} from ${t.teamDisplayName}?`, body: `Ends their ${teamPermissionLabel(t.permission)} role on this side. Nothing else changes.`, confirmLabel: "Remove Team Role", destructive: true, reason: reasonRuleFor("remove_team_access") }, (reason) => removeTeamAccess(supabase, t.id, reason), `Removed from ${t.teamDisplayName}.`)} />
                )}
              </View>
            ))}
            {canTeams && !person.isSelf && person.state === "ACTIVE" && picking !== "team" && <Button label="Add Team Role" variant="secondary" onPress={() => { setPicking("team"); setPickedTeam(null) }} />}
            {picking === "team" && (
              <View style={{ gap: space.md }}>
                <Choice label="Team">
                  {teams.map((t) => {
                    const on = pickedTeam === t.id
                    return (
                      <Pressable key={t.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t.fullLabel} onPress={() => setPickedTeam(t.id)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                        <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{t.fullLabel}</Text>
                      </Pressable>
                    )
                  })}
                </Choice>
                <Choice label="Role">
                  {TEAM_STAFF_PERMISSION_OPTIONS.map((o) => {
                    const on = pickedPermission === o.value
                    return (
                      <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label} onPress={() => setPickedPermission(o.value as TeamStaffPermission)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                        <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
                      </Pressable>
                    )
                  })}
                </Choice>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Cancel" variant="secondary" onPress={() => setPicking(null)} style={{ flex: 1 }} />
                  <Button
                    label="Give Team Role"
                    disabled={!pickedTeam}
                    onPress={() => {
                      const team = teams.find((t) => t.id === pickedTeam)
                      if (!team) return
                      setPicking(null)
                      confirmThen({ title: `Make ${name} ${teamPermissionLabel(pickedPermission)} of ${team.fullLabel}?`, confirmLabel: "Give Team Role", reason: reasonRuleFor("set_team_access") }, (reason) => setTeamAccess(supabase, person.membershipId!, team.id, pickedPermission, reason), `${name} is now ${teamPermissionLabel(pickedPermission)} of ${team.fullLabel}.`)
                    }}
                    style={{ flex: 2 }}
                  />
                </View>
              </View>
            )}
          </Section>

          <Section title="Additional Roles">
            {person.additionalRoles.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>None.</Text>}
            {person.additionalRoles.map((a) => (
              <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{a.label}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{a.roleKey === "SAFEGUARDING_OFFICER" ? (a.confirmationState === "CONFIRMED" ? "Appointed and confirmed. Changed through the club's safeguarding settings." : "Nominated, awaiting confirmation.") : a.state === "SUSPENDED" ? "Suspended" : "Active"}</Text>
                </View>
                {canManageMembership && !person.isSelf && a.roleKey !== "SAFEGUARDING_OFFICER" && (
                  <Button label="End" variant="quiet" onPress={() => confirmThen({ title: `End ${name}'s ${a.label} role?`, confirmLabel: "End Role", destructive: true, reason: reasonRuleFor("transition_role_assignment") }, (reason) => endRoleAssignment(supabase, a.id, reason), `${a.label} role ended.`)} />
                )}
              </View>
            ))}
            {canManageMembership && !person.isSelf && person.state === "ACTIVE" && assignable.some((r) => !person.additionalRoles.some((a) => a.roleKey === r.roleKey)) && picking !== "extra" && <Button label="Add Role" variant="secondary" onPress={() => setPicking("extra")} />}
            {picking === "extra" && (
              <View style={{ gap: space.sm }}>
                {assignable
                  .filter((r) => !person.additionalRoles.some((a) => a.roleKey === r.roleKey))
                  .map((r) => (
                    <Button key={r.roleKey} label={r.label} variant="secondary" onPress={() => { setPicking(null); confirmThen({ title: `Make ${name} a ${r.label}?`, body: "A default set of what they may do comes with the role; nothing beyond it.", confirmLabel: `Make ${r.label}`, reason: reasonRuleFor("assign_role") }, (reason) => assignAdditionalRole(supabase, person.membershipId!, r.roleKey, reason), `${name} is now a ${r.label}.`) }} />
                  ))}
                <Button label="Cancel" variant="quiet" onPress={() => setPicking(null)} />
              </View>
            )}
          </Section>

          {!person.isSelf && (canSuspend || canRevoke) && person.state !== "PENDING" && (
            <Section title="Access">
              {person.state === "ACTIVE" && canSuspend && <Button label="Suspend Membership" variant="secondary" onPress={() => confirmThen({ title: `Suspend ${name}?`, body: "They keep their membership but lose access until it is restored. The reason is recorded.", confirmLabel: "Confirm Suspension", destructive: true, reason: reasonRuleFor("transition_club_membership", { actingOnSelf: person.isSelf }) }, (reason) => transitionMembership(supabase, person.membershipId!, "SUSPENDED", reason), `${name} is suspended.`)} />}
              {person.state === "SUSPENDED" && canSuspend && <Button label="Restore Membership" onPress={() => confirmThen({ title: `Restore ${name}?`, body: "Their access returns as it was. The reason is recorded.", confirmLabel: "Restore", reason: reasonRuleFor("transition_club_membership", { actingOnSelf: person.isSelf }) }, (reason) => transitionMembership(supabase, person.membershipId!, "ACTIVE", reason), `${name} is restored.`)} />}
              {canRevoke && (
                <Button
                  label="Remove From Club"
                  variant="quiet"
                  onPress={() =>
                    setAsk({
                      title: `Remove ${name} from the club?`,
                      body: "They lose club-wide and team access immediately. Their membership is kept as history; to bring them back, invite them again and they join as a new member.",
                      confirmLabel: "Remove Access",
                      destructive: true,
                      reason: reasonRuleFor("transition_club_membership", { actingOnSelf: person.isSelf }),
                      onConfirm: async (reason) => {
                        await transitionMembership(supabase, person.membershipId!, "REVOKED", reason)
                        setGone(true)
                      },
                    })
                  }
                />
              )}
            </Section>
          )}

          {!canManageMembership && <Text style={[type.caption, { color: colour.inkMuted }]}>You can see this person's membership but not change it: that needs the club's people permission.</Text>}
        </>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => { void refreshAccess(); void load() }} errorMessage={(cause) => peopleErrorMessage(cause, friendly(cause, "this change").message)} />
    </AdminScreen>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
        {title}
      </Text>
      <Card style={{ gap: space.md }}>{children}</Card>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, minHeight: 28, alignItems: "center" }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {children}
      </View>
    </View>
  )
}
