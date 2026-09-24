import { useEffect, useState } from "react"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { inviteClubStaff, readInvitableTeams, readStaffRoleOptions, type StaffRoleOption } from "@ovalball/contracts/club/invitations"
import { describeIntendedOutcome, invitationExpiryLabel, invitationJoinUrl, outcomeLines, type InvitationShareData } from "@ovalball/contracts/invitations"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"

import { InvitationSharePanel } from "./share-panel"
import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { Button } from "../components/ui"
import { X } from "../components/icons"
import { friendly, logDetail } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * INVITE STAFF -- the website's `/people` invitation form, natively (CA-M11.1).
 *
 * The same inputs as the website: the email address (required -- a staff invitation is personal), their
 * real-world role in their own words (optional), ONE club-wide role (optional), and a role per team
 * (optional) -- a club role, a team role, or both. The same RPC (`issue_invitation`, CLUB_STAFF) with the
 * same intended outcome. And the same result: the moment the credential exists it is shown once as a
 * link, a code and a QR of the link. The website also emails the link; the phone has no mail sender and
 * says so, so nobody assumes an email went.
 */
/** What the person had typed, held across a step-up so it is not typed twice. Never stored. */
export interface InviteStaffForm {
  email: string
  declaredRole: string
  clubRole: string | null
  teamRoles: Record<string, string | null>
}

export function InviteStaffSheet({ clubId, visible, onClose, onIssued, initial, onRecentAuthRequired }: { clubId: string; visible: boolean; onClose: () => void; onIssued: () => void; initial?: InviteStaffForm | null; onRecentAuthRequired: (form: InviteStaffForm) => void }) {
  const insets = useSafeAreaInsets()
  const [roleOptions, setRoleOptions] = useState<StaffRoleOption[]>([])
  const [teams, setTeams] = useState<{ id: string; displayName: string }[]>([])
  const [email, setEmail] = useState(initial?.email ?? "")
  const [declaredRole, setDeclaredRole] = useState(initial?.declaredRole ?? "")
  const [clubRole, setClubRole] = useState<string | null>(initial?.clubRole ?? null)
  const [teamRoles, setTeamRoles] = useState<Record<string, string | null>>(initial?.teamRoles ?? {})
  const [resumed, setResumed] = useState(Boolean(initial))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [share, setShare] = useState<InvitationShareData | null>(null)

  // RESUMED AFTER A STEP-UP: the form comes back filled; the person confirms it again themselves.
  useEffect(() => {
    if (!initial) return
    setEmail(initial.email)
    setDeclaredRole(initial.declaredRole)
    setClubRole(initial.clubRole)
    setTeamRoles(initial.teamRoles)
    setResumed(true)
  }, [initial])

  useEffect(() => {
    if (!visible) return
    let live = true
    void Promise.all([readStaffRoleOptions(supabase), readInvitableTeams(supabase, clubId)])
      .then(([options, sides]) => {
        if (!live) return
        setRoleOptions(options)
        setTeams(sides)
      })
      .catch((cause) => {
        const failure = friendly(cause, "the roles you may give")
        logDetail("invite-staff:options", failure)
        if (live) setProblem(failure.message)
      })
    return () => {
      live = false
    }
  }, [visible, clubId])

  const clubRoleOptions = roleOptions.filter((o) => !o.heldAtTeam)
  const teamRoleOptions = roleOptions.filter((o) => o.heldAtTeam)
  const chosenTeams = Object.entries(teamRoles).filter(([, role]) => role).map(([id, role]) => ({ id, roles: [role as string] }))
  const canSubmit = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && (clubRole !== null || chosenTeams.length > 0)

  function reset() {
    setEmail("")
    setDeclaredRole("")
    setClubRole(null)
    setTeamRoles({})
    setProblem(null)
    setShare(null)
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setProblem(null)
    try {
      const issued = await inviteClubStaff(supabase, { clubId, email: email.trim(), declaredRole, clubRoles: clubRole ? [clubRole] : [], teamRoles: chosenTeams })
      if (issued.alreadyExisted || !issued.token) {
        setProblem("That person already has an invitation to this club waiting to be accepted.")
        return
      }
      const labels = new Map(roleOptions.map((o) => [o.roleKey, o.label]))
      const teamNames = new Map(teams.map((t) => [t.id, t.displayName]))
      setShare({
        url: invitationJoinUrl(issued.token, webUrl),
        code: issued.code,
        outcome: outcomeLines(describeIntendedOutcome({ roles: clubRole ? [clubRole] : [], teams: chosenTeams }, (id) => teamNames.get(id) ?? "A team", (key) => labels.get(key) ?? key)),
        expiresLabel: invitationExpiryLabel(issued.expiresAt),
        sentTo: null,
      })
      onIssued()
    } catch (cause) {
      // AN R OPERATION: the server wants a recent second factor. The form is held (in memory) and the
      // person is taken to the step-up; verification never issues the invitation -- they confirm again.
      if (isRecentAuthRefusal(cause)) {
        onRecentAuthRequired({ email, declaredRole, clubRole, teamRoles })
        return
      }
      const failure = friendly(cause, "this invitation")
      logDetail("invite-staff:issue", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, maxHeight: "88%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>{share ? "Invitation ready" : "Invite Staff"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {share ? (
              <InvitationSharePanel share={share} onDone={() => { reset(); onClose() }} />
            ) : (
              <View style={{ gap: space.md }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>A personal invitation to join the club with a role. The server decides which roles you may give; accepting is theirs to do.</Text>
                <Field label="Email Address" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Field label="Their Real-World Role (Optional)" value={declaredRole} onChange={setDeclaredRole} hint="In their own words, e.g. Under 12s coach. It grants nothing." />
                <Text style={[type.smallMedium, { color: colour.ink }]}>Club-Wide Role (Optional)</Text>
                <RoleChips options={clubRoleOptions} value={clubRole} onChange={setClubRole} label="Club-wide role" />
                {teams.length > 0 && teamRoleOptions.length > 0 && (
                  <>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>Team Roles (Optional)</Text>
                    {teams.map((team) => (
                      <View key={team.id} style={{ gap: 6 }}>
                        <Text style={[type.caption, { color: colour.inkMuted }]}>{team.displayName}</Text>
                        <RoleChips options={teamRoleOptions} value={teamRoles[team.id] ?? null} onChange={(role) => setTeamRoles((prev) => ({ ...prev, [team.id]: role }))} label={`${team.displayName} role`} />
                      </View>
                    ))}
                  </>
                )}
                {resumed && <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colour.forest800 }]}>Verified. Confirm to continue.</Text>}
                {problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
                <Button label="Create Invitation" onPress={() => void submit()} busy={busy} disabled={!canSubmit} />
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function Field({ label, value, onChange, hint, keyboardType, autoCapitalize }: { label: string; value: string; onChange: (v: string) => void; hint?: string; keyboardType?: "default" | "email-address"; autoCapitalize?: "none" | "sentences" }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType={keyboardType ?? "default"} autoCapitalize={autoCapitalize ?? "sentences"} autoCorrect={false} placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
      {!!hint && <Text style={[type.caption, { color: colour.inkSubtle }]}>{hint}</Text>}
    </View>
  )
}

function RoleChips({ options, value, onChange, label }: { options: StaffRoleOption[]; value: string | null; onChange: (role: string | null) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((r) => {
        const on = value === r.roleKey
        return (
          <Pressable key={r.roleKey} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={r.label} onPress={() => onChange(on ? null : r.roleKey)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
            <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{r.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
