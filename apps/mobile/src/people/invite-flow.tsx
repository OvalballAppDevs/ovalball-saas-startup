import { useCallback, useEffect, useMemo, useState } from "react"
import { AccessibilityInfo, Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { inviteClubStaff, readInvitableTeams, readStaffRoleOptions, resendInvitation, type StaffRoleOption } from "@ovalball/contracts/club/invitations"
import { invitationExpiryLabel, invitationJoinUrl, type InvitationShareData } from "@ovalball/contracts/invitations"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"
import { peopleErrorMessage } from "@ovalball/contracts/club/people"
import { CLUB_ACCESS_KEYS, COMMON_TEAM_ROLES, CUSTOM_ROLE_BASE, catalogueRole, canonicalRoleLabel, type ClubAccessKey } from "@ovalball/contracts/role-labels"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { holdIntent, takeIntent } from "../admin/pending-intent"
import { friendly, friendlyAction, logDetail } from "../errors/translate"
import { ShareView } from "../sharing/share-view"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { ChevronDown, ChevronUp, Search } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { Body, ButtonRow, ChoiceRow, FlowScreen, Note, SectionTitle, Steps } from "./ui"
import { TeamRoleSelector, pickLabels, pickLabelsWithAccess, picksProblem, picksToInvitation, type TeamRolePicks } from "./team-roles"

/**
 * INVITE SOMEBODY NEW -- the one invitation flow, whichever door it was opened from (People & Invitations).
 *
 * Home's Add to Club, People, Access Control and a team's Staff tab all arrive here; what they know is
 * passed in and never asked again. From a team, the team is chosen and the flow is Details -> Role ->
 * Review -> Send. From the club, the roles step offers club access, Volunteer and any teams.
 *
 * It issues ONE KIND of invitation -- CLUB_STAFF, through `issue_invitation` -- and the server decides
 * everything: whether this person may invite, which roles an invitation may carry, that a team belongs to
 * the club, and what accepting grants. Nothing here writes a membership or a role. An invitation creates
 * no person: the invitee's own account is created by them, and accepting it attaches what was offered.
 * The phone sends no email itself: the link is handed to the person's own WhatsApp, Messages or mail.
 */
export type InvitePreset = "staff" | "admin" | "member"

/**
 * A ROLE TO START FROM -- Add Staff Members' common-role chips. One of the catalogue's common team roles
 * (a title of `""` is a custom role still to be named); anything else is ignored rather than trusted, and
 * the server decides whether it may be given either way.
 */
export interface StartRole {
  roleKey: string
  title: string | null
}

export function startRoleFrom(role: string | undefined, title: string | undefined): StartRole | null {
  if (!role || !COMMON_TEAM_ROLES.some((r) => r.roleKey === role)) return null
  if (title === undefined) return { roleKey: role, title: null }
  // A Volunteer may carry the club's own words ("" is a custom role still to be named); any other role only its own titles.
  if (role === CUSTOM_ROLE_BASE) return { roleKey: role, title }
  return { roleKey: role, title: COMMON_TEAM_ROLES.some((r) => r.roleKey === role && r.title === title) ? title : null }
}

interface InviteForm {
  email: string
  name: string
  clubTitle: string
  access: ClubAccessKey
  volunteer: boolean
  picks: [string, [string, string | null][]][]
}

type Step = "details" | "roles" | "review" | "send"
const STEP_LABELS = ["Details", "Roles", "Review", "Send"]

export function InviteFlow({ clubId, preset = "staff", teamId, teamName, returnTo, startRole = null }: { clubId: string; preset?: InvitePreset; teamId?: string | null; teamName?: string | null; returnTo: string; startRole?: StartRole | null }) {
  const router = useRouter()
  const { club } = useAppContexts()
  const [step, setStep] = useState<Step>("details")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [clubTitle, setClubTitle] = useState("")
  const [access, setAccess] = useState<ClubAccessKey>(preset === "admin" ? "CLUB_ADMIN" : "MEMBER")
  const [volunteer, setVolunteer] = useState(false)
  // A team starts with the role the person chose to start from, if any: the team they came from at once,
  // and from the club, each team as it is ticked.
  const startPicks = (): TeamRolePicks => (startRole ? new Map([[startRole.roleKey, startRole.title]]) : new Map())
  const [picks, setPicks] = useState<Map<string, TeamRolePicks>>(() => (teamId ? new Map([[teamId, startPicks()]]) : new Map()))
  const [teams, setTeams] = useState<{ id: string; displayName: string }[] | null>(null)
  const [options, setOptions] = useState<StaffRoleOption[] | null>(null)
  const [teamQuery, setTeamQuery] = useState("")
  const [showAccess, setShowAccess] = useState(!teamId)
  const [problem, setProblem] = useState<string | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState<InvitationShareData | null>(null)
  const [existing, setExisting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadProblem(null)
    try {
      const [t, o] = await Promise.all([readInvitableTeams(supabase, clubId), readStaffRoleOptions(supabase)])
      setTeams(t)
      setOptions(o)
    } catch (cause) {
      const failure = friendly(cause, "the invitation form")
      logDetail("invite:load", failure)
      setLoadProblem(failure.message)
    }
  }, [clubId])
  useEffect(() => void load(), [load])

  // A FORM HELD ACROSS A STEP-UP comes back filled, at Review, for the person to confirm again.
  useFocusEffect(
    useCallback(() => {
      const held = takeIntent<InviteForm>(`invite:${clubId}:${teamId ?? "club"}`)
      if (!held) return
      setEmail(held.email)
      setName(held.name)
      setClubTitle(held.clubTitle)
      setAccess(held.access)
      setVolunteer(held.volunteer)
      setPicks(new Map(held.picks.map(([t, p]) => [t, new Map(p)])))
      setStep("review")
    }, [clubId, teamId])
  )

  // MOVING BETWEEN STEPS clears what the last attempt said: a refusal belongs to the attempt that earned it,
  // and left on screen after the person has corrected the form it would only contradict them.
  function go(next: Step) {
    setProblem(null)
    setExisting(null)
    setStep(next)
  }

  // A refusal is said aloud as well as shown: on iOS a sentence appearing below the fold is otherwise silent.
  useEffect(() => {
    if (problem) AccessibilityInfo.announceForAccessibility(problem)
  }, [problem])

  const index = STEP_LABELS.indexOf(step === "details" ? "Details" : step === "roles" ? "Roles" : step === "review" ? "Review" : "Send")
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Step ${index + 1} of 4: ${STEP_LABELS[index]}`)
  }, [index])

  const teamNames = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t.displayName])), [teams])
  const teamLabel = (id: string) => (id === teamId && teamName ? teamName : (teamNames.get(id) ?? "A team"))
  const allowedAtTeam = useMemo(() => (options ?? []).filter((o) => o.allowedAtTeam).map((o) => o.roleKey), [options])
  const chosenTeams = [...picks].filter(([, p]) => p.size > 0)
  // A TICKED TEAM WITH NO ROLE would be dropped from the invitation without a word, so it holds Continue
  // until it has one or is unticked. (The team a flow opened from may stay empty: its access can be enough.)
  const teamWithoutRole = [...picks].find(([id, p]) => id !== teamId && p.size === 0)?.[0] ?? null
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  // STARTED FROM A ROLE (Add Staff's common roles) the invitation is for that role, so it needs the team it is
  // held at: skipping the team would quietly send a plain Member invitation instead. A plain Volunteer may be
  // club-wide, which the Club Role tick answers just as well.
  const startNeedsTeam = !!startRole && !teamId && chosenTeams.length === 0 && !(startRole.roleKey === "VOLUNTEER" && startRole.title === null && volunteer)
  const pickIssue = chosenTeams.map(([, p]) => picksProblem(p)).find((m) => m !== null) ?? null
  const rolesOk = !teamWithoutRole && !startNeedsTeam && !pickIssue && (access !== "MEMBER" || volunteer || chosenTeams.length > 0 || preset === "member" || !teamId)
  const clubRoles = [access, ...(volunteer ? ["VOLUNTEER"] : [])]

  /**
   * What they are invited as, in the fewest words, for the message and the poster: club administration first
   * when it is given (an invitation to run the club is about that, whatever else it carries), else the first
   * team role, else Volunteer. The Review step and the outcome list say everything it gives.
   */
  const roleLine = (() => {
    if (access !== "MEMBER") return canonicalRoleLabel(access)
    const first = chosenTeams[0]
    if (first) return pickLabels(first[1])[0] ?? null
    if (volunteer) return canonicalRoleLabel("VOLUNTEER")
    return "a Member"
  })()
  const placeName = access === "MEMBER" && chosenTeams[0] ? teamLabel(chosenTeams[0][0]) : null
  const outcome = [
    ...clubRoles.filter((r) => r !== "MEMBER" || clubRoles.length === 1).map((r) => `${canonicalRoleLabel(r)} at the club`),
    ...chosenTeams.map(([id, p]) => `${pickLabelsWithAccess(p).join(", ")} · ${teamLabel(id)}`),
  ]

  async function create() {
    setBusy(true)
    setProblem(null)
    setExisting(null)
    try {
      const issued = await inviteClubStaff(supabase, {
        clubId,
        email: email.trim(),
        inviteeName: name.trim() || null,
        declaredRole: clubTitle.trim() || null,
        clubRoles,
        teamRoles: chosenTeams.map(([id, p]) => picksToInvitation(id, p)),
      })
      if (issued.alreadyExisted || !issued.token) {
        setExisting(issued.invitationId)
        return
      }
      setShare({ url: invitationJoinUrl(issued.token, webUrl), code: issued.code, outcome, expiresLabel: invitationExpiryLabel(issued.expiresAt), sentTo: null })
      setStep("send")
    } catch (cause) {
      // AN R OPERATION: the server wants a recent second factor. The form is held in memory and the person
      // is taken to the step-up; verification never issues the invitation -- they confirm again at Review.
      if (isRecentAuthRefusal(cause)) {
        holdIntent<InviteForm>(`invite:${clubId}:${teamId ?? "club"}`, { email, name, clubTitle, access, volunteer, picks: [...picks].map(([t, p]) => [t, [...p]]) })
        router.push({ pathname: "/step-up", params: { returnTo } } as never)
        return
      }
      // The server's own sentence when it refuses on purpose ("\"Club Admin\" is reserved for a role…"),
      // otherwise what was being done, in its own verb.
      const failure = friendlyAction(cause, "create", "this invitation")
      logDetail("invite:issue", failure)
      setProblem(peopleErrorMessage(cause, failure.message))
    } finally {
      setBusy(false)
    }
  }

  async function reissue() {
    if (!existing) return
    setBusy(true)
    setProblem(null)
    try {
      const next = await resendInvitation(supabase, existing)
      if (!next.token) {
        setProblem("That invitation could not be reissued. Try again.")
        return
      }
      setShare({ url: invitationJoinUrl(next.token, webUrl), code: next.code, outcome, expiresLabel: invitationExpiryLabel(next.expiresAt), sentTo: null, replacesPrevious: true })
      setExisting(null)
      setStep("send")
    } catch (cause) {
      const failure = friendlyAction(cause, "reissue", "this invitation")
      logDetail("invite:reissue", failure)
      setProblem(peopleErrorMessage(cause, failure.message))
    } finally {
      setBusy(false)
    }
  }

  const title = preset === "admin" ? "Invite a Club Administrator" : teamId ? "Invite a New Staff Member" : "Invite Person"
  const visibleTeams = (teams ?? []).filter((t) => !teamQuery.trim() || t.displayName.toLowerCase().includes(teamQuery.trim().toLowerCase()))
  const poster = club.clubId === clubId && club.name ? { identity: { clubName: club.name, crestUrl: club.crestUrl }, subject: { variant: "INVITATION" as const, role: roleLine === "a Member" ? "Member" : roleLine, teamName: placeName } } : undefined

  const footer =
    step === "details" ? (
      <View style={{ gap: space.xs }}>
        {!emailOk && email.length > 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>Enter their whole email address to continue.</Text>}
        <Button label="Continue" onPress={() => go("roles")} disabled={!emailOk} />
      </View>
    ) : step === "roles" ? (
      <View style={{ gap: space.xs }}>
        {!rolesOk && <Text style={[type.caption, { color: colour.inkMuted }]}>{teamWithoutRole ? `Choose what they do for ${teamLabel(teamWithoutRole)}, or untick it.` : startNeedsTeam ? "Choose the team this role is for." : (pickIssue ?? "Choose at least one role for them.")}</Text>}
        <ButtonRow weights={[1, 2]}>
          <Button label="Back" variant="secondary" onPress={() => go("details")} />
          <Button label="Continue" onPress={() => go("review")} disabled={!rolesOk} />
        </ButtonRow>
      </View>
    ) : step === "review" ? (
      <ButtonRow weights={[1, 2]}>
        <Button label="Back" variant="secondary" onPress={() => go("roles")} />
        <Button label="Create Invitation" onPress={() => void create()} busy={busy} />
      </ButtonRow>
    ) : undefined

  return (
    <FlowScreen title={title} footer={footer} onBack={step === "roles" ? () => go("details") : step === "review" ? () => go("roles") : undefined}>
      <Body>
        <Steps labels={STEP_LABELS} current={index} />

        {loadProblem && <ErrorState message={loadProblem} onRetry={() => void load()} />}

        {step === "details" && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Who Are You Inviting?" detail="They accept with their own Ovalball account. Nothing is created until they do." />
            <Field label="Email Address" required value={email} onChange={setEmail} placeholder="name@example.com" keyboard="email" />
            <Field label="Their Name (Optional)" value={name} onChange={setName} placeholder="e.g. Emma Taylor" hint="Only used to greet them and to show who is invited." />
            <Field label="Their Role at the Club (Optional)" value={clubTitle} onChange={setClubTitle} placeholder={teamId ? "e.g. Under 12s coach" : "e.g. Treasurer, Kit Manager"} hint="In their own words. It describes what they do and gives no access." />
          </View>
        )}

        {step === "roles" && (options === null || teams === null) && !loadProblem && <CardSkeleton lines={4} />}

        {step === "roles" && options !== null && teams !== null && (
          <View style={{ gap: space.xl }}>
            {teamId && (
              <View style={{ gap: space.md }}>
                <SectionTitle title={`Role for ${teamLabel(teamId)}`} detail="Choose one or more. Each gives access to this team only." />
                <TeamRoleSelector assignable={allowedAtTeam} value={picks.get(teamId) ?? new Map()} onChange={(next) => setPicks(new Map(picks).set(teamId, next))} />
              </View>
            )}

            <View style={{ gap: space.md }}>
              {teamId ? (
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAccess }} accessibilityLabel={`Club access: ${canonicalRoleLabel(access)}. ${showAccess ? "Hide" : "Change"}`} onPress={() => setShowAccess((v) => !v)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[type.bodyMedium, { color: colour.ink, flex: 1 }]}>Club Access: {canonicalRoleLabel(access)}</Text>
                  {showAccess ? <ChevronUp size={18} color={colour.forest800} /> : <ChevronDown size={18} color={colour.forest800} />}
                </Pressable>
              ) : (
                <SectionTitle title="Club Access" detail="What they can do across the whole club. Everyone has exactly one." />
              )}
              {showAccess && (
                <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
                  {[...CLUB_ACCESS_KEYS].reverse().map((key) => {
                    const role = catalogueRole(key)
                    return <ChoiceRow key={key} kind="radio" checked={access === key} label={role?.label ?? key} description={role?.description} onPress={() => setAccess(key)} />
                  })}
                </View>
              )}
            </View>

            {(options ?? []).some((o) => o.roleKey === "VOLUNTEER") && (
              <View style={{ gap: space.md }}>
                <SectionTitle title="Club Role" detail="What they do for the club as a whole." />
                <ChoiceRow kind="checkbox" checked={volunteer} label="Volunteer" description={catalogueRole("VOLUNTEER")?.description} onPress={() => setVolunteer((v) => !v)} />
              </View>
            )}

            {!teamId && (
              <View style={{ gap: space.md }}>
                <SectionTitle
                  title="Team Roles (Optional)"
                  detail={startRole ? `Each team you tick starts with ${startRole.title === "" ? "a custom role to name" : (pickLabels(new Map([[startRole.roleKey, startRole.title]]))[0] ?? "that role")}. Each gives access to that team only.` : "Choose a team, then what they do for it. Each gives access to that team only."}
                />
                {(teams?.length ?? 0) > 6 && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
                    <Search size={18} color={colour.inkSubtle} />
                    <TextInput accessibilityLabel="Search teams" value={teamQuery} onChangeText={setTeamQuery} placeholder="Search teams" placeholderTextColor={colour.inkSubtle} style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
                  </View>
                )}
                {visibleTeams.map((t) => {
                  const on = picks.has(t.id)
                  return (
                    <ChoiceRow
                      key={t.id}
                      kind="checkbox"
                      checked={on}
                      label={t.displayName}
                      description={on && (picks.get(t.id)?.size ?? 0) > 0 ? pickLabels(picks.get(t.id)!).join(", ") : null}
                      onPress={() => {
                        const next = new Map(picks)
                        if (on) next.delete(t.id)
                        else next.set(t.id, startPicks())
                        setPicks(next)
                      }}
                    >
                      {on && (
                        <View style={{ marginLeft: space.lg, marginTop: space.sm }}>
                          <TeamRoleSelector assignable={allowedAtTeam} value={picks.get(t.id) ?? new Map()} onChange={(nextPicks) => setPicks(new Map(picks).set(t.id, nextPicks))} />
                        </View>
                      )}
                    </ChoiceRow>
                  )
                })}
                {teams?.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>The club has no teams yet.</Text>}
              </View>
            )}
          </View>
        )}

        {step === "review" && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Check the Invitation" detail="This is exactly what accepting gives them." />
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
              <ReviewLine label="Person" value={name.trim() || email.trim()} detail={name.trim() ? email.trim() : null} />
              {!!clubTitle.trim() && <ReviewLine label="Their Role at the Club" value={clubTitle.trim()} />}
              <ReviewLine label="Club Access" value={canonicalRoleLabel(access)} />
              {volunteer && <ReviewLine label="Club Role" value="Volunteer" />}
              {chosenTeams.map(([id, p]) => (
                <ReviewLine key={id} label={teamLabel(id)} value={pickLabelsWithAccess(p).join(", ")} />
              ))}
            </View>
            <Note>It works only for {email.trim() || "their email address"} and stays open for 7 days. You share it next.</Note>
            {existing && (
              <View style={{ gap: space.sm }}>
                <Note tone="warning">There is already an open invitation for this email address at the club. Reissue it to get a new link; the old one stops working.</Note>
                <Button label="Reissue Invitation" variant="secondary" onPress={() => void reissue()} busy={busy} />
              </View>
            )}
            {problem && <Note tone="danger">{problem}</Note>}
          </View>
        )}

        {step === "send" && share && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Invitation Ready" detail={`Send it to ${name.trim() || email.trim()} however suits you.`} />
            <ShareView
              share={share}
              subject={{ kind: "INVITATION", clubName: club.clubId === clubId && club.name ? club.name : "Your club", roleLine: roleLine === "a Member" ? null : roleLine, placeName, inviteeName: name.trim() || null }}
              poster={poster}
              email={email.trim()}
              explainer={`When ${name.trim() || "they"} accept${name.trim() ? "s" : ""}, they join with exactly these roles. The link only works for ${email.trim()}.`}
              onDone={() => (router.canGoBack() ? router.back() : router.dismissTo("/admin/people" as never))}
            />
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}

function Field({ label, value, onChange, placeholder, hint, required = false, keyboard }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; required?: boolean; keyboard?: "email" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}{required ? <Text style={{ color: colour.danger }}> *</Text> : null}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        keyboardType={keyboard === "email" ? "email-address" : "default"}
        textContentType={keyboard === "email" ? "emailAddress" : "none"}
        autoComplete={keyboard === "email" ? "email" : "off"}
        autoCapitalize={keyboard === "email" ? "none" : "words"}
        autoCorrect={false}
        maxLength={keyboard === "email" ? 254 : 80}
        style={[type.body, { minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
      />
      {!!hint && <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>}
    </View>
  )
}

function ReviewLine({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: colour.ink }]}>{value}</Text>
      {!!detail && <Text style={[type.small, { color: colour.inkMuted }]}>{detail}</Text>}
    </View>
  )
}
