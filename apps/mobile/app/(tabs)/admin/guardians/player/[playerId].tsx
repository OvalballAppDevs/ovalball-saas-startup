import { useCallback, useEffect, useRef, useState } from "react"
import { Modal, Pressable, Share, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
import {
  askGuardianForGender,
  canOpenGuardiansPlayers,
  guardiansPlayersErrorMessage,
  movePlayerTeamPlace,
  readClubPlayerDirectory,
  removeGuardianRelationship,
  replacementInvitationLink,
  sendReplacementGuardianInvitation,
  type ClubTeam,
  type DirectoryPlayer,
  type PlayerPlace,
} from "@ovalball/contracts/club/guardians-players"
import { archiveTeamPlayer, restoreTeamPlayer } from "@ovalball/contracts/team/people"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../../src/admin/pending-intent"
import { ChoiceChips, Notice } from "../../../../../src/admin/chips"
import { supabase } from "../../../../../src/auth/supabase"
import { webUrl } from "../../../../../src/config/environment"
import { Copy, Share2, TriangleAlert } from "../../../../../src/components/icons"
import { PersonAvatar } from "../../../../../src/components/identity"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * ONE PLAYER, AS THE CLUB MAY SEE THEM (CA-M11.1).
 *
 * WHAT IS HERE: the name and the age grade the platform resolved (never a date of birth); whether they
 * are an adult and hold a login; whether a gender is recorded (never which); their place on each of the
 * club's sides; and the adults responsible for them, with an email only where the server's directory
 * operation supplies one (family.relationship.approve at the club).
 *
 * WHAT MAY BE DONE, each drawn only for a capability the server confirmed and refused there again:
 * archive, restore or move a place (team.roster.manage -- move is `move_player_team_membership`, a
 * canonical operation the website has no control for); remove a guardian with a mandatory reason
 * (family.relationship.remove); send a replacement guardian invitation (family.relationship.approve);
 * ask a guardian to record the player's gender (player.pathway.request). A "code first" refusal holds
 * the intent, steps up, and re-asks on return -- the server authorises again, never the code.
 */
export default function PlayerScreen() {
  const router = useRouter()
  const { playerId } = useLocalSearchParams<{ playerId: string }>()
  const { loading: accessLoading, clubId, caps, refresh: refreshAccess } = useGuardiansPlayersAccess()
  const [player, setPlayer] = useState<DirectoryPlayer | null | undefined>(undefined)
  const [teams, setTeams] = useState<ClubTeam[]>([])
  const [error, setError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "warning"; text: string } | null>(null)
  const [moving, setMoving] = useState<PlayerPlace | null>(null)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [invitePlace, setInvitePlace] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<{ email: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const pending = usePendingIntent(`guardians:player:${playerId}`)
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || !playerId || accessLoading || !canOpenGuardiansPlayers(caps)) return
    const gen = ++generation.current
    setError(null)
    try {
      const directory = await readClubPlayerDirectory(supabase, clubId, caps, { includeEnded: true })
      if (gen !== generation.current) return
      setTeams(directory.teams)
      setPlayer(directory.players.find((p) => p.playerId === playerId) ?? null)
    } catch (cause) {
      const translated = friendly(cause, "this player")
      logDetail("admin:guardians:player", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, playerId, accessLoading, caps])

  useEffect(() => {
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

  const may = canOpenGuardiansPlayers(caps)
  const name = player?.name ?? "Player"
  const activePlaces = player?.places.filter((p) => p.status === "active") ?? []
  const guardiansShown = player?.guardians ?? []

  function confirmThen(question: Omit<ReasonAsk, "onConfirm">, op: (reason: string) => Promise<void>, done: string) {
    setAsk({
      ...question,
      onConfirm: async (reason) => {
        await op(reason)
        setNotice({ tone: "ok", text: done })
        await load()
      },
    })
  }

  function removeGuardian(g: { guardianId: string; name: string }) {
    setAsk({
      title: `Remove ${g.name} as guardian?`,
      body: `This ends their access to ${name}'s data and consent controls. It is recorded and cannot be undone. If they were the only guardian, ${name} is flagged as needing a new one.`,
      confirmLabel: "Remove Guardian",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        const result = await removeGuardianRelationship(supabase, g.guardianId, reason)
        setNotice(result.orphaned && player && !player.isAdult ? { tone: "warning", text: `${g.name} removed. ${name} now has no active guardian: send a replacement invitation below.` } : { tone: "ok", text: `${g.name} removed as guardian.` })
        await load()
      },
    })
  }

  function startMove(place: PlayerPlace) {
    setMoving(place)
    setMoveTarget(null)
  }

  function confirmMove() {
    if (!moving || !moveTarget) return
    const target = teams.find((t) => t.id === moveTarget)
    if (!target) return
    const from = moving
    setMoving(null)
    confirmThen(
      {
        title: `Move ${name} to ${target.fullLabel}?`,
        body: `Their place on ${from.teamLabel} ends and a place on ${target.fullLabel} opens, in one step. The reason is recorded.`,
        confirmLabel: "Move to Another Side",
        reason: "required",
      },
      (reason) => movePlayerTeamPlace(supabase, from.membershipId, target.id, reason).then(() => undefined),
      `${name} is now on ${target.fullLabel}.`
    )
  }

  function sendInvitation() {
    if (!inviteEmail.trim() || !player) return
    const teamId = invitePlace ?? activePlaces[0]?.teamId
    if (!teamId) return
    const email = inviteEmail.trim()
    setInviteOpen(false)
    setAsk({
      title: `Invite ${email} as a replacement guardian?`,
      body: `The invitation is bound to ${name} on ${activePlaces.find((p) => p.teamId === teamId)?.teamLabel ?? "this side"}. Whoever accepts it becomes ${name}'s guardian. The phone does not send the email: you will be shown the link once to pass on.`,
      confirmLabel: "Create Invitation",
      reason: "none",
      onConfirm: async () => {
        const result = await sendReplacementGuardianInvitation(supabase, player.playerId, teamId, email)
        setInviteLink({ email, link: replacementInvitationLink(webUrl, result.token) })
        setInviteEmail("")
        setCopied(false)
      },
    })
  }

  function askForGender() {
    if (!player) return
    setAsk({
      title: `Ask ${name}'s guardian to record their gender?`,
      body: "The club may ask; it may not record it. Each active guardian receives a request to add it from Your Children.",
      confirmLabel: "Ask Guardian",
      reason: "none",
      onConfirm: async () => {
        const sent = await askGuardianForGender(supabase, player.playerId)
        setNotice({ tone: sent > 0 ? "ok" : "warning", text: sent > 0 ? `Asked ${sent === 1 ? "their guardian" : `their ${sent} guardians`}.` : `${player.firstName} has no guardian on Ovalball to ask yet.` })
      },
    })
  }

  const otherSides = teams.filter((t) => t.active && !activePlaces.some((p) => p.teamId === t.id))

  return (
    <AdminScreen section={name} onRefresh={() => void load()} refreshing={false}>
      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="A player's guardians are managed by the people the club has given that job to." />}
      {may && error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {may && !error && player === undefined && <CardSkeleton lines={4} />}
      {may && !error && player === null && <EmptyState title="Not at this club" body="This player holds no place on one of the club's sides, or is not visible to you." />}

      {may && player && (
        <>
          <View style={{ alignItems: "center", gap: space.sm }}>
            <PersonAvatar name={player.name} url={null} size={72} />
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink, textAlign: "center" }]}>
              {player.name}
            </Text>
            <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>{activePlaces.map((p) => p.compactTeamLabel).join(" · ") || "No current place"}</Text>
          </View>

          {notice && <Notice tone={notice.tone} text={notice.text} />}

          {player.needsGuardian && (
            <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
              <TriangleAlert size={18} color={colour.danger} />
              <Text style={[type.small, { color: colour.danger, flex: 1 }]}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>Guardian required. </Text>
                This player has no active guardian, so their account has no consented access to anything. Send a replacement invitation below.
              </Text>
            </View>
          )}

          <Section title="Player">
            <Fact label="Age Grade" value={player.ageGrade ?? "Not resolved yet"} />
            <Fact label="Adult" value={player.isAdult ? "Yes" : "No"} />
            <Fact label="Ovalball Account" value={player.hasLogin ? "Yes" : "No"} />
            <Fact label="Gender" value={player.needsGender ? "Not recorded" : "Recorded"} />
            {caps.pathwayRequest && player.needsGender && !player.isAdult && <Button label="Ask Guardian for Gender" variant="secondary" onPress={askForGender} />}
            <Text style={[type.caption, { color: colour.inkSubtle }]}>A date of birth and a recorded gender stay with the player and their family; the club sees the age grade the platform resolved.</Text>
          </Section>

          <Section title="Places">
            {player.places.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No places.</Text>}
            {player.places.map((place) => (
              <View key={place.membershipId} style={{ gap: space.sm, paddingVertical: space.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 }}>
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{place.teamLabel}</Text>
                  <StatusPill label={place.status === "active" ? "Active" : "Archived"} tone={place.status === "active" ? "positive" : "neutral"} />
                </View>
                {caps.rosterManage && place.status === "active" && (
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button label="Archive" variant="secondary" style={{ flex: 1 }} onPress={() => confirmThen({ title: `Archive ${name} from ${place.teamLabel}?`, body: "They leave this side's roster and register. Nothing about them is deleted, and the club can restore them.", confirmLabel: "Archive", destructive: true, reason: "none" }, () => archiveTeamPlayer(supabase, place.membershipId), `${name} archived from ${place.teamLabel}.`)} />
                    {otherSides.length > 0 && <Button label="Move to Another Side" variant="secondary" style={{ flex: 1 }} onPress={() => startMove(place)} />}
                  </View>
                )}
                {caps.rosterManage && place.status === "ended" && !activePlaces.some((p) => p.teamId === place.teamId) && (
                  <Button label="Restore to This Side" variant="secondary" onPress={() => confirmThen({ title: `Restore ${name} to ${place.teamLabel}?`, body: "They return to this side's roster and register.", confirmLabel: "Restore", reason: "none" }, () => restoreTeamPlayer(supabase, place.membershipId), `${name} restored to ${place.teamLabel}.`)} />
                )}
              </View>
            ))}
            {moving && (
              <View style={{ gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }}>
                <ChoiceChips label={`Move from ${moving.teamLabel} to`} hint="Nothing is chosen until you choose it." options={otherSides.map((t) => ({ key: t.id, label: t.fullLabel }))} value={moveTarget} onChange={setMoveTarget} />
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Cancel" variant="secondary" onPress={() => setMoving(null)} style={{ flex: 1 }} />
                  <Button label="Continue" disabled={!moveTarget} onPress={confirmMove} style={{ flex: 2 }} />
                </View>
              </View>
            )}
            {!caps.rosterManage && <Text style={[type.caption, { color: colour.inkSubtle }]}>Changing this player's places needs the club's roster permission.</Text>}
          </Section>

          <Section title="Parents and Guardians">
            {guardiansShown.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>{player.isAdult ? "None. An adult manages their own account." : "No active guardian."}</Text>}
            {guardiansShown.map((g) => (
              <View key={g.guardianId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET }}>
                <PersonAvatar name={g.name} url={null} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  {g.email ? (
                    <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1} selectable>
                      {g.email}
                    </Text>
                  ) : (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>Contact details need the club's guardian permission.</Text>
                  )}
                </View>
                {caps.relationshipRemove && <Button label="Remove" variant="quiet" onPress={() => removeGuardian(g)} />}
              </View>
            ))}
            {caps.relationshipApprove && activePlaces.length > 0 && !inviteLink && <Button label="Replacement Invitation" variant="secondary" onPress={() => { setInvitePlace(activePlaces[0]?.teamId ?? null); setInviteOpen(true) }} />}
            {inviteLink && (
              <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>Replacement invitation created for {inviteLink.email}.</Text>
                <Text style={[type.caption, { color: colour.forest800 }]}>No email was sent from the phone. Pass this link on yourself; it is shown once, and whoever opens it and accepts becomes {name}'s guardian.</Text>
                <Text selectable style={[type.caption, { color: colour.ink, fontFamily: "Menlo" }]}>
                  {inviteLink.link}
                </Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={copied ? "Link copied" : "Copy Link"} onPress={() => void Clipboard.setStringAsync(inviteLink.link).then(() => setCopied(true))} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.7 : 1 })}>
                    <Copy size={16} color={colour.ink} />
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{copied ? "Copied" : "Copy Link"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Share Link" onPress={() => void Share.share({ message: inviteLink.link })} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.7 : 1 })}>
                    <Share2 size={16} color={colour.ink} />
                    <Text style={[type.smallMedium, { color: colour.ink }]}>Share Link</Text>
                  </Pressable>
                </View>
                <Button label="Done" variant="quiet" onPress={() => setInviteLink(null)} />
              </View>
            )}
          </Section>
        </>
      )}

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setInviteOpen(false)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, gap: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Replacement Invitation</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>An invitation bound to {name}: whoever accepts it becomes their guardian rather than creating a new player.</Text>
            <TextInput accessibilityLabel="Email address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="new-guardian@example.com" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
            {activePlaces.length > 1 && <ChoiceChips label="Side" options={activePlaces.map((p) => ({ key: p.teamId, label: p.teamLabel }))} value={invitePlace} onChange={setInvitePlace} />}
            <Button label="Continue" onPress={sendInvitation} disabled={!inviteEmail.trim() || (activePlaces.length > 1 && !invitePlace)} />
          </Pressable>
        </Pressable>
      </Modal>

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => { void refreshAccess(); void load() }}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: `/admin/guardians/player/${playerId}` } } as never)
        }}
        errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this change").message)}
      />
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, minHeight: 28, alignItems: "center" }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
