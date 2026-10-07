import { useCallback, useEffect, useMemo, useState } from "react"
import { AccessibilityInfo, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import { resolvePersonalAvatarUrl } from "@ovalball/contracts/personal-avatar"
import { CLUB_ACCESS_KEYS, COMMON_CLUB_TITLES, catalogueRole, canonicalRoleLabel, roleDisplayLabel, type ClubAccessKey } from "@ovalball/contracts/role-labels"
import { readInvitableTeams } from "@ovalball/contracts/club/invitations"
import {
  MEMBERSHIP_STATE_LABEL,
  endRoleAssignment,
  giveRole,
  peopleErrorMessage,
  personName,
  reactivateMembership,
  readAssignableRoles,
  readClubPerson,
  readPeopleCapabilities,
  reasonRuleFor,
  setClubAccess,
  setClubTitle,
  type ClubPerson,
  type PeopleCapabilities,
} from "@ovalball/contracts/club/people"
import { readAccessHistory, readPermissionCapabilities, type AccessHistoryEntry, type PermissionCapabilities } from "@ovalball/contracts/club/permissions"
import { accessEventSentence, accessReasonText } from "@ovalball/contracts/club/access-history"

import { supabase } from "../auth/supabase"
import { ReasonSheet, type ReasonAsk } from "../admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../admin/pending-intent"
import { PersonAvatar } from "../components/identity"
import { PhotoBottomShade } from "../components/photo-gradient"
import { BottomSheet } from "../components/bottom-sheet"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../components/ui"
import { ChevronRight, Info, Plus } from "../components/icons"
import { friendly, friendlyAction, logDetail, type FriendlyError } from "../errors/translate"
import { formatDate } from "../hub/ui"
import { libraryAsset } from "../media/stock-assets"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { Body, ButtonRow, ChoiceRow, FlowScreen, Note, SectionTitle, Tabs } from "./ui"
import { TeamRoleSelector, pickLabels, pickLabelsWithAccess, picksProblem, type TeamRolePicks } from "./team-roles"

const BAND = libraryAsset("matchday-floodlit-01")

/**
 * MEMBER DETAILS -- one person's relationship with this club, in one place (People & Invitations; it
 * rebuilds CA-M3's person screen).
 *
 *   OVERVIEW  the membership: club access, state, member since, their club title, what they do.
 *   ROLES     club access (exactly one), the club title (a description), club roles (Volunteer); the
 *             Safeguarding Officer is shown and appointed elsewhere.
 *   TEAMS     every team role they hold, ADDITIVELY: give more, end one, never a seat switch that quietly
 *             replaces the others; Team Admin is access added on top of a Coach or Team Manager role.
 *   ACTIVITY  the club's own access history for them.
 *
 * Every change is explicit, confirmed, reasoned where the shared list says the server requires it,
 * server-authorised and audited by the server. Deactivating and removing are their own full screens,
 * because each deserves to be read before it is done. A person never changes their own access here: the
 * server refuses self-suspension and the screen mirrors the website by not offering it.
 */
export function MemberDetails({ clubId, membershipId, onAccessChanged }: { clubId: string; membershipId: string; onAccessChanged?: () => void }) {
  const router = useRouter()
  const [tab, setTab] = useState<"overview" | "roles" | "teams" | "activity">("overview")
  const [person, setPerson] = useState<ClubPerson | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [caps, setCaps] = useState<PeopleCapabilities | null>(null)
  const [permCaps, setPermCaps] = useState<PermissionCapabilities | null>(null)
  const [teams, setTeams] = useState<{ id: string; displayName: string }[]>([])
  const [clubAssignable, setClubAssignable] = useState<string[]>([])
  const [history, setHistory] = useState<AccessHistoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Said aloud as well as shown: `accessibilityLiveRegion` is Android's, and on iOS a new notice is otherwise silent.
  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice)
  }, [notice])
  const { fontScale } = useWindowDimensions()
  const stackIdentity = fontScale > LARGE_TEXT_SCALE
  const [moreOpen, setMoreOpen] = useState(false)
  const [access, setAccess] = useState<ClubAccessKey | null>(null)
  const [title, setTitle] = useState("")
  const [addingTeam, setAddingTeam] = useState<string | null>(null)
  // Adding a team role is open before any team is chosen: the team is the person's first decision, never a
  // default they might not notice.
  const [addingOpen, setAddingOpen] = useState(false)
  const [teamAssignable, setTeamAssignable] = useState<string[]>([])
  const [picks, setPicks] = useState<TeamRolePicks>(new Map())
  const [teamProblem, setTeamProblem] = useState<string | null>(null)
  const pending = usePendingIntent(`person:${membershipId}`)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [p, allowed, perm, dir, roles] = await Promise.all([
        readClubPerson(supabase, clubId, membershipId),
        readPeopleCapabilities(supabase, clubId),
        readPermissionCapabilities(supabase, clubId),
        readInvitableTeams(supabase, clubId),
        readAssignableRoles(supabase, clubId),
      ])
      setPerson(p)
      setCaps(allowed)
      setPermCaps(perm)
      setTeams(dir)
      setClubAssignable(roles.map((r) => r.roleKey))
      setAccess(p?.access ?? null)
      setTitle(p?.clubTitle ?? "")
      setAvatarUrl(p?.avatarStoragePath ? await resolvePersonalAvatarUrl(supabase, p.avatarStoragePath) : null)
      if (p?.userId && (perm.explain || perm.manage)) {
        readAccessHistory(supabase, clubId, p.userId, 25).then(setHistory).catch(() => setHistory([]))
      } else setHistory([])
    } catch (cause) {
      const translated = friendly(cause, "this person")
      logDetail("people:member", translated)
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
      // Back from a step-up: the same question, the reason put back, and the server asked again.
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  useEffect(() => {
    if (!addingTeam) return
    void readAssignableRoles(supabase, clubId, addingTeam).then((r) => setTeamAssignable(r.map((x) => x.roleKey))).catch(() => setTeamAssignable([]))
  }, [addingTeam, clubId])

  const name = person ? personName(person) : "Member"
  const self = !!person?.isSelf
  const active = person?.state === "ACTIVE"
  const canClub = !!caps?.assignClub && !self && active
  const canTeams = !!caps?.assignTeam && !self && active
  const byTeam = useMemo(() => {
    const groups = new Map<string, { teamId: string; teamName: string; roles: ClubPerson["teamRoles"] }>()
    for (const r of person?.teamRoles ?? []) {
      const g = groups.get(r.teamId) ?? { teamId: r.teamId, teamName: r.teamDisplayName, roles: [] }
      g.roles.push(r)
      groups.set(r.teamId, g)
    }
    return [...groups.values()]
  }, [person])
  const volunteer = person?.additionalRoles.find((a) => a.roleKey === "VOLUNTEER" && a.state === "ACTIVE") ?? null
  const officer = person?.additionalRoles.find((a) => a.roleKey === "SAFEGUARDING_OFFICER") ?? null

  function confirmThen(question: Omit<ReasonAsk, "onConfirm">, op: (reason: string) => Promise<void>, done: string) {
    setAsk({
      ...question,
      onConfirm: async (reason) => {
        await op(reason)
        setNotice(done)
        onAccessChanged?.()
        await load()
      },
    })
  }

  async function giveTeamRoles(reason: string) {
    if (!person?.membershipId || !addingTeam) return
    const teamName = teams.find((t) => t.id === addingTeam)?.displayName ?? "the team"
    const held = new Set((person.teamRoles ?? []).filter((r) => r.teamId === addingTeam).map((r) => r.roleKey))
    const wanted = [...picks].filter(([k]) => !held.has(k))
    const succeeded: string[] = []
    const failed: string[] = []
    for (const [roleKey, roleTitle] of wanted) {
      try {
        await giveRole(supabase, person.membershipId, roleKey, addingTeam, reason, roleTitle)
        succeeded.push(roleKey)
      } catch (cause) {
        failed.push(`${roleDisplayLabel(roleKey, roleTitle)}: ${peopleErrorMessage(cause, "couldn't be given")}`)
      }
    }
    if (failed.length > 0) {
      setTeamProblem(succeeded.length > 0 ? `Gave ${succeeded.length} of ${wanted.length} roles. ${failed.join("; ")}` : failed.join("; "))
      await load()
      return
    }
    setAddingTeam(null)
    setAddingOpen(false)
    setPicks(new Map())
    setTeamProblem(null)
    setNotice(`${name} now has ${pickLabels(new Map(wanted)).join(", ")} for ${teamName}.`)
    await load()
  }

  const stateTone = person?.state === "SUSPENDED" ? "caution" : person?.state === "ACTIVE" ? "positive" : "neutral"

  return (
    <FlowScreen
      title="Member Details"
      footer={
        person && !self && (caps?.assignClub || caps?.suspend || caps?.revoke) ? (
          <ButtonRow>
            {active && caps?.assignClub && <Button label="Edit Member" variant="secondary" onPress={() => setTab("roles")} />}
            <Button label="More Actions" onPress={() => setMoreOpen(true)} />
          </ButtonRow>
        ) : undefined
      }
    >
      <View style={{ height: 120, backgroundColor: colour.forest900, overflow: "hidden" }}>
        <Image source={BAND} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <PhotoBottomShade strength={0.7} />
      </View>
      <View style={{ paddingHorizontal: space.lg, marginTop: -44, gap: space.md }}>
        {loading && !person && <CardSkeleton lines={4} />}
        {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
        {!loading && !loadError && !person && <ErrorState message="This person is not part of the club any more, or is not visible to you." />}
        {person && (
          <View style={{ flexDirection: stackIdentity ? "column" : "row", alignItems: "flex-start", gap: space.md }}>
            <View style={{ borderRadius: 48, borderWidth: 4, borderColor: colour.chalk }}>
              <PersonAvatar name={name} url={avatarUrl} size={88} />
            </View>
            {/* The avatar overlaps the photograph; the words start below it, on the page, where they can be read.
                At large text sizes they go beneath it, full width, so an email address is not broken mid-word. */}
            <View style={{ flex: stackIdentity ? undefined : 1, alignSelf: "stretch", minWidth: 0, gap: 4, paddingTop: stackIdentity ? 0 : 44 + space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                  {name}
                  {self ? <Text style={{ color: colour.inkMuted }}> (you)</Text> : null}
                </Text>
                <StatusPill label={MEMBERSHIP_STATE_LABEL[person.state]} tone={stateTone} />
              </View>
              {person.email && <Text style={[type.small, { color: colour.inkMuted }]}>{person.email}</Text>}
              {person.since && <Text style={[type.small, { color: colour.inkMuted }]}>Joined {formatDate(person.since)}</Text>}
            </View>
          </View>
        )}
      </View>

      {person && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
          <Tabs
            tabs={[
              { key: "overview", label: "Overview" },
              { key: "roles", label: "Roles" },
              { key: "teams", label: "Teams" },
              { key: "activity", label: "Activity" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>
      )}

      {person && (
        <Body>
          {notice && (
            <View accessibilityLiveRegion="polite" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
              <Text style={[type.small, { color: colour.forest800 }]}>{notice}</Text>
            </View>
          )}
          {person.state === "SUSPENDED" && (
            <Note tone="warning">
              {person.suspendedLevel === "SITE" ? "This membership was deactivated by Ovalball. Only Ovalball can reactivate it." : "This membership is deactivated: no access to the club, roles paused, history kept."}
            </Note>
          )}

          {tab === "overview" && (
            <View style={{ gap: space.xl }}>
              <View style={{ gap: space.md }}>
                <SectionTitle title="Club Membership" />
                <Card>
                  <Line label="Club Access" value={canonicalRoleLabel(person.access ?? "MEMBER")} />
                  <Line label="State" value={MEMBERSHIP_STATE_LABEL[person.state]} />
                  {person.since && <Line label="Member Since" value={formatDate(person.since)} />}
                  {person.clubTitle && <Line label="Role at the Club" value={person.clubTitle} />}
                  <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.chalk }}>
                    <Info size={16} color={colour.inkMuted} />
                    <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>Club access sets what they can do across the club. Team roles give access to one team each.</Text>
                  </View>
                </Card>
              </View>
              <View style={{ gap: space.md }}>
                <SectionTitle title="Team Roles" action={canTeams ? <LinkButton label="Add" onPress={() => setTab("teams")} /> : undefined} />
                <Card>
                  {person.teamRoles.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No team roles.</Text>}
                  {person.teamRoles.map((r) => (
                    <Line key={r.id} label={r.teamDisplayName} value={`${roleDisplayLabel(r.roleKey, r.title)}${r.state === "SUSPENDED" ? " (paused)" : ""}`} />
                  ))}
                </Card>
              </View>
              {(person.additionalRoles.length > 0 || person.playerTeams.length > 0) && (
                <View style={{ gap: space.md }}>
                  <SectionTitle title="Also" />
                  <Card>
                    {person.additionalRoles.map((a) => (
                      <Line key={a.id} label={a.label} value={a.roleKey === "SAFEGUARDING_OFFICER" ? (a.confirmationState === "CONFIRMED" ? "Confirmed" : "Awaiting confirmation") : a.state === "SUSPENDED" ? "Paused" : "Active"} />
                    ))}
                    {person.playerTeams.map((t) => (
                      <Line key={t.teamId} label="Player" value={t.teamDisplayName} />
                    ))}
                  </Card>
                </View>
              )}
            </View>
          )}

          {tab === "roles" && (
            <View style={{ gap: space.xl }}>
              <View style={{ gap: space.md }}>
                <SectionTitle title="Club Access" detail="What they can do across the whole club. Exactly one." />
                <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
                  {[...CLUB_ACCESS_KEYS].reverse().map((key) => (
                    <ChoiceRow key={key} kind="radio" checked={access === key} label={catalogueRole(key)?.label ?? key} description={catalogueRole(key)?.description} disabled={!canClub} onPress={() => setAccess(key)} />
                  ))}
                </View>
                {canClub && access && access !== person.access && (
                  <Button
                    label={`Make ${catalogueRole(access)?.label}`}
                    onPress={() =>
                      confirmThen(
                        { title: `Make ${name} ${catalogueRole(access)?.label}?`, body: access === "MEMBER" ? "They keep their team roles. Only their club-wide access changes." : `${catalogueRole(access)?.description} Their team roles stay as they are.`, confirmLabel: `Make ${catalogueRole(access)?.label}`, reason: reasonRuleFor("set_primary_club_role") },
                        (reason) => setClubAccess(supabase, person.membershipId!, access, reason),
                        `${name} is now ${catalogueRole(access)?.label}.`
                      )
                    }
                  />
                )}
                {self && <Text style={[type.small, { color: colour.inkMuted }]}>Your own access is changed by another Club Admin.</Text>}
              </View>

              <View style={{ gap: space.md }}>
                <SectionTitle title="Role at the Club" detail="What they do for the club, in your words. It gives no access." />
                <TextInput
                  accessibilityLabel="Role at the club"
                  value={title}
                  onChangeText={setTitle}
                  editable={canClub}
                  placeholder="e.g. Treasurer"
                  placeholderTextColor={colour.inkSubtle}
                  maxLength={80}
                  autoCapitalize="words"
                  style={[type.body, { minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, opacity: canClub ? 1 : 0.6 }]}
                />
                {canClub && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    {COMMON_CLUB_TITLES.slice(0, 8).map((t) => (
                      <Pressable key={t} accessibilityRole="button" accessibilityLabel={`Use ${t}`} onPress={() => setTitle(t)} style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: title === t ? colour.forest800 : colour.lineStrong, backgroundColor: title === t ? colour.mint100 : colour.surface, justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
                        <Text style={[type.small, { color: colour.ink }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {canClub && title.trim() !== (person.clubTitle ?? "") && (
                  <Button
                    label={title.trim() ? "Save Role at the Club" : "Clear Role at the Club"}
                    variant="secondary"
                    onPress={() =>
                      confirmThen(
                        { title: title.trim() ? `Describe ${name} as ${title.trim()}?` : `Clear ${name}'s role at the club?`, body: "A description only. Their access does not change.", confirmLabel: "Save", reason: "none" },
                        () => setClubTitle(supabase, person.membershipId!, title.trim() || null),
                        "Saved."
                      )
                    }
                  />
                )}
              </View>

              <View style={{ gap: space.md }}>
                <SectionTitle title="Club Roles" detail="What they do for the club as a whole." />
                {clubAssignable.includes("VOLUNTEER") || volunteer ? (
                  <ChoiceRow
                    kind="checkbox"
                    checked={!!volunteer}
                    label="Volunteer"
                    description={catalogueRole("VOLUNTEER")?.description}
                    disabled={!canClub}
                    onPress={() =>
                      volunteer
                        ? confirmThen({ title: `End ${name}'s Volunteer role?`, confirmLabel: "End Role", destructive: true, reason: reasonRuleFor("transition_role_assignment") }, (reason) => endRoleAssignment(supabase, volunteer.id, reason), "Volunteer role ended.")
                        : confirmThen({ title: `Make ${name} a Volunteer?`, body: "Volunteers see what members see, plus pitch allocations.", confirmLabel: "Make Volunteer", reason: reasonRuleFor("assign_role") }, (reason) => giveRole(supabase, person.membershipId!, "VOLUNTEER", null, reason).then(() => undefined), `${name} is now a Volunteer.`)
                    }
                  />
                ) : null}
                {officer && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Safeguarding Officer. ${officer.confirmationState === "CONFIRMED" ? "Confirmed" : "Awaiting confirmation"}. Managed in Safeguarding`} onPress={() => router.push("/admin/safeguarding" as never)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    <Text style={[type.bodyMedium, { color: colour.ink, flex: 1 }]}>Safeguarding Officer</Text>
                    <Text style={[type.small, { color: colour.inkMuted }]}>{officer.confirmationState === "CONFIRMED" ? "Confirmed" : "Awaiting confirmation"}</Text>
                    <ChevronRight size={17} color={colour.inkSubtle} />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {tab === "teams" && (
            <View style={{ gap: space.lg }}>
              {byTeam.length === 0 && !addingOpen && <Text style={[type.body, { color: colour.inkMuted }]}>{name} has no team roles yet.</Text>}
              {byTeam.map((g) => (
                <View key={g.teamId} style={{ gap: space.sm }}>
                  <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{g.teamName}</Text>
                  <Card>
                    {g.roles.map((r) => (
                      <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.bodyMedium, { color: colour.ink }]}>{roleDisplayLabel(r.roleKey, r.title)}</Text>
                          {(r.title || r.state === "SUSPENDED") && <Text style={[type.caption, { color: colour.inkMuted }]}>{[r.title ? canonicalRoleLabel(r.roleKey) : null, r.state === "SUSPENDED" ? "Paused" : null].filter(Boolean).join(" · ")}</Text>}
                        </View>
                        {canTeams && (
                          <Button label="End" variant="quiet" onPress={() => confirmThen({ title: `End ${name}'s ${roleDisplayLabel(r.roleKey, r.title)} role for ${g.teamName}?`, body: "Only this role ends. Their other roles stay as they are.", confirmLabel: "End Role", destructive: true, reason: reasonRuleFor("transition_role_assignment") }, (reason) => endRoleAssignment(supabase, r.id, reason), `${roleDisplayLabel(r.roleKey, r.title)} for ${g.teamName} ended.`)} />
                        )}
                      </View>
                    ))}
                    {canTeams && caps?.assignClub && g.roles.some((r) => r.roleKey === "COACH" || r.roleKey === "TEAM_MANAGER") && !g.roles.some((r) => r.roleKey === "TEAM_ADMINISTRATION") && (
                      <Button label="Give Team Admin Access" variant="secondary" onPress={() => confirmThen({ title: `Give ${name} Team Admin for ${g.teamName}?`, body: catalogueRole("TEAM_ADMINISTRATION")?.description, confirmLabel: "Give Team Admin", reason: reasonRuleFor("assign_role") }, (reason) => giveRole(supabase, person.membershipId!, "TEAM_ADMINISTRATION", g.teamId, reason).then(() => undefined), `${name} is now Team Admin for ${g.teamName}.`)} />
                    )}
                  </Card>
                </View>
              ))}

              {canTeams && !addingOpen && <Button label="Add Team Role" icon={<Plus size={18} color={colour.onForest} />} onPress={() => { setAddingOpen(true); setAddingTeam(null); setPicks(new Map()); setTeamProblem(null) }} />}
              {canTeams && addingOpen && (
                <View style={{ gap: space.md }}>
                  <SectionTitle title="Add Team Role" detail="Choose the team, then what they do for it." />
                  <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
                    {teams.map((t) => (
                      <ChoiceRow key={t.id} kind="radio" checked={addingTeam === t.id} label={t.displayName} onPress={() => { setAddingTeam(t.id); setPicks(new Map()) }} />
                    ))}
                  </View>
                  {addingTeam && <TeamRoleSelector assignable={teamAssignable} value={picks} onChange={setPicks} held={new Set(person.teamRoles.filter((r) => r.teamId === addingTeam && r.state === "ACTIVE").map((r) => r.roleKey))} />}
                  {addingTeam && picks.size > 0 && !!picksProblem(picks) && <Text style={[type.caption, { color: colour.inkMuted }]}>{picksProblem(picks)}</Text>}
                  {teamProblem && <Note tone="danger">{teamProblem}</Note>}
                  <ButtonRow weights={[1, 2]}>
                    <Button label="Cancel" variant="secondary" onPress={() => { setAddingOpen(false); setAddingTeam(null); setPicks(new Map()) }} />
                    <Button
                      label="Give Roles"
                      disabled={!addingTeam || !!picksProblem(picks)}
                      onPress={() => {
                        const teamName = teams.find((t) => t.id === addingTeam)?.displayName ?? "this team"
                        setAsk({ title: `Give ${name} ${pickLabelsWithAccess(picks).join(", ")} for ${teamName}?`, body: `Each role gives access to ${teamName} only.`, confirmLabel: "Give Roles", reason: reasonRuleFor("assign_role"), onConfirm: (reason) => giveTeamRoles(reason) })
                      }}
                    />
                  </ButtonRow>
                </View>
              )}
              {self && <Text style={[type.small, { color: colour.inkMuted }]}>Your own team roles are changed by another Club Admin or the team's Team Admin.</Text>}
            </View>
          )}

          {tab === "activity" && (
            <View style={{ gap: space.md }}>
              <SectionTitle title="Activity" detail="Changes to their membership and roles at this club." />
              {history === null && <CardSkeleton lines={3} />}
              {history !== null && history.length === 0 && <Text style={[type.body, { color: colour.inkMuted }]}>Nothing recorded yet.</Text>}
              {history !== null && history.length > 0 && (
                <Card>
                  {history.map((h, i) => (
                    <View key={`${h.at}-${i}`} style={{ gap: 2, paddingVertical: space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                      <Text style={[type.bodyMedium, { color: colour.ink }]}>{accessEventSentence(h.eventType, h.capabilityLabel, h.roleLabel ? canonicalRoleLabel(h.roleLabel) : null, h.teamName)}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{[formatDate(h.at), h.actorName ? `by ${h.actorName}` : null, accessReasonText(h.reason)].filter(Boolean).join(" · ")}</Text>
                    </View>
                  ))}
                </Card>
              )}
            </View>
          )}
        </Body>
      )}

      {person && (
        <BottomSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title="More Actions">
          <View style={{ gap: space.sm }}>
            {(permCaps?.manage || permCaps?.explain) && (
              <Button label="Permissions" variant="secondary" onPress={() => { setMoreOpen(false); router.push(`/admin/people/${membershipId}/permissions` as never) }} />
            )}
            {person.state === "ACTIVE" && caps?.suspend && (
              <Button label="Deactivate Membership" variant="danger" onPress={() => { setMoreOpen(false); router.push(`/admin/people/${membershipId}/deactivate` as never) }} />
            )}
            {person.state === "SUSPENDED" && caps?.suspend && person.suspendedLevel !== "SITE" && (
              <Button
                label="Reactivate Membership"
                onPress={() => {
                  setMoreOpen(false)
                  confirmThen({ title: `Reactivate ${name}?`, body: "Their access returns, with the roles they had. The reason is recorded.", confirmLabel: "Reactivate Membership", reason: reasonRuleFor("transition_club_membership", { actingOnSelf: self }) }, (reason) => reactivateMembership(supabase, person.membershipId!, reason), `${name} is active again.`)
                }}
              />
            )}
            {person.state !== "PENDING" && caps?.revoke && (
              <Button label="Remove from Club" variant="danger" onPress={() => { setMoreOpen(false); router.push(`/admin/people/${membershipId}/remove` as never) }} />
            )}
          </View>
        </BottomSheet>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void load()}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: `/admin/people/${membershipId}` } } as never)
        }}
        errorMessage={(cause) => peopleErrorMessage(cause, friendlyAction(cause, "save", "this change").message)}
      />
    </FlowScreen>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>{children}</View>
}

function Line({ label, value }: { label: string; value: string }) {
  // Side by side while both fit; at large text sizes, the label above its value, so a value is never split
  // mid-word into a narrow right-hand column.
  const { fontScale } = useWindowDimensions()
  if (fontScale > LARGE_TEXT_SCALE) {
    return (
      <View style={{ gap: 2 }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{value}</Text>
      </View>
    )
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.md, minHeight: 28, alignItems: "center" }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Text style={[type.smallMedium, { color: colour.forest800 }]}>{label}</Text>
    </Pressable>
  )
}
