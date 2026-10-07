import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"

import { readInvitableTeams } from "@ovalball/contracts/club/invitations"
import { issueTeamJoinCode } from "@ovalball/contracts/team/requests"
import { peopleErrorMessage } from "@ovalball/contracts/club/people"
import { invitationExpiryLabel, invitationJoinUrl, type InvitationShareData } from "@ovalball/contracts/invitations"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { friendly, friendlyAction, logDetail } from "../errors/translate"
import { libraryAsset } from "../media/stock-assets"
import { ShareView } from "../sharing/share-view"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { ClipboardList, QrCode, UserPlus } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { ActionGroup, ActionRow, Body, ButtonRow, ChoiceRow, FlowScreen, Note, PhotoHero, SectionTitle } from "./ui"

const HERO = libraryAsset("training-player-ball-01")

/**
 * ADD PLAYERS -- the front door for players, from Home's Add to Club or a team's Squad (People & Invitations).
 *
 * Players join the way Ovalball already lets them, and this screen makes each way one tap:
 *
 *   INVITE A NEW PLAYER   a personal link for one player (or their parent): the team's own joining kind,
 *                         used once, with their name on it so the club sees who it went to.
 *   SHARE TEAM QR CODE    the team's shared joining code -- a poster for the touchline or the team chat.
 *   REQUESTS TO JOIN      people already on Ovalball who have asked; the club approves each one.
 *
 * Both links are `issue_invitation(TEAM_JOIN_CODE)` -- the existing governed kind, no new mechanism -- and
 * using either one OPENS A REQUEST somebody with authority decides; a link never places a player. Under 18s
 * are added by a parent or guardian through the family flows, which this screen does not bypass.
 */
export function AddPlayers({ clubId, teamId: givenTeamId, teamName: givenTeamName, mode, requestsRoute }: { clubId: string; teamId?: string | null; teamName?: string | null; mode?: "pass" | null; requestsRoute: string }) {
  const router = useRouter()
  const { club } = useAppContexts()
  const [teams, setTeams] = useState<{ id: string; displayName: string }[] | null>(givenTeamId ? [] : null)
  const [teamId, setTeamId] = useState<string | null>(givenTeamId ?? null)
  const [teamName, setTeamName] = useState<string | null>(givenTeamName ?? null)
  const [step, setStep] = useState<"choose" | "personal" | "share">("choose")
  const [inviteeName, setInviteeName] = useState("")
  const [share, setShare] = useState<{ data: InvitationShareData; personal: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const loadTeams = useCallback(async () => {
    if (givenTeamId) return
    try {
      setTeams(await readInvitableTeams(supabase, clubId))
    } catch (cause) {
      const failure = friendly(cause, "the club's teams")
      logDetail("add-players:teams", failure)
      setProblem(failure.message)
      setTeams([])
    }
  }, [clubId, givenTeamId])
  useEffect(() => void loadTeams(), [loadTeams])

  async function issue(personal: boolean) {
    if (!teamId) return
    setBusy(true)
    setProblem(null)
    try {
      const issued = await issueTeamJoinCode(supabase, teamId, personal ? { inviteeName: inviteeName.trim() } : {})
      if (!issued.token) {
        setProblem("That link could not be made. Try again.")
        return
      }
      setShare({
        data: { url: invitationJoinUrl(issued.token, webUrl), code: issued.code, outcome: [`A request to join ${teamName ?? "this team"}, for the club to decide`], expiresLabel: invitationExpiryLabel(issued.expiresAt), sentTo: null },
        personal,
      })
      setStep("share")
    } catch (cause) {
      const failure = friendlyAction(cause, "make", "this link")
      logDetail("add-players:issue", failure)
      setProblem(peopleErrorMessage(cause, failure.message))
    } finally {
      setBusy(false)
    }
  }

  const clubName = club.clubId === clubId && club.name ? club.name : null
  const poster = clubName && teamName ? { identity: { clubName, crestUrl: club.crestUrl }, subject: { variant: "TEAM_JOIN" as const, teamName } } : undefined

  return (
    <FlowScreen title={mode === "pass" ? "Share a Joining Pass" : "Add Players"}>
      {step === "choose" && <PhotoHero image={HERO} title={mode === "pass" ? "Share a Joining Pass" : "Invite Players"} body={mode === "pass" ? "A team's QR code and link, ready for the touchline or the team chat." : "Send a player a personal link, or share your team's QR code. The club approves each request."} />}
      <Body>
        {step === "choose" && (
          <View style={{ gap: space.xl }}>
            {!givenTeamId && (
              <View style={{ gap: space.md }}>
                <SectionTitle title="Which Team?" />
                {teams === null ? (
                  <CardSkeleton lines={3} />
                ) : teamId ? (
                  // CHOSEN: the list folds to the one team, so what to do next is in view without scrolling
                  // past every other side -- said as a fact with one way to change it, not a radio to untick.
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm, minHeight: TOUCH_TARGET + 12, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.forest800, backgroundColor: colour.surface }}>
                    <Text accessibilityRole="text" accessibilityLabel={`Team: ${teamName ?? "chosen"}`} style={[type.bodyMedium, { color: colour.ink, flexShrink: 1 }]}>{teamName}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Change Team" onPress={() => setTeamId(null)} hitSlop={6} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                      <Text style={[type.smallMedium, { color: colour.forest800 }]}>Change Team</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
                    {teams.map((t) => (
                      <ChoiceRow key={t.id} kind="radio" checked={teamId === t.id} label={t.displayName} onPress={() => { setTeamId(t.id); setTeamName(t.displayName) }} />
                    ))}
                    {teams.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>The club has no teams yet.</Text>}
                  </View>
                )}
              </View>
            )}

            <ActionGroup>
              {mode !== "pass" && (
                <ActionRow first icon={<UserPlus size={20} color={colour.forest800} />} title="Invite a New Player" caption="A personal link for one player or their parent." onPress={teamId ? () => setStep("personal") : undefined} disabled={!teamId} />
              )}
              <ActionRow first={mode === "pass"} icon={<QrCode size={20} color={colour.forest800} />} title="Share Team QR Code" caption="One code for the whole squad: print it or post it in the team chat." onPress={teamId ? () => void issue(false) : undefined} disabled={!teamId || busy} />
              {mode !== "pass" && (
                <ActionRow icon={<ClipboardList size={20} color={colour.forest800} />} title="Requests to Join" caption="People already on Ovalball who have asked to join." onPress={() => router.push(requestsRoute as never)} />
              )}
            </ActionGroup>
            {!teamId && !givenTeamId && <Text style={[type.caption, { color: colour.inkMuted }]}>Choose a team first.</Text>}
            {problem && <ErrorState message={problem} />}
            <Note>Players ask to join through the link and the club approves them. Under 18s are added by a parent or guardian.</Note>
          </View>
        )}

        {step === "personal" && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Invite a New Player" detail={`A personal link to ask to join ${teamName ?? "the team"}. It works once.`} />
            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Their Name<Text style={{ color: colour.danger }}> *</Text></Text>
              <TextInput
                accessibilityLabel="Their name"
                accessibilityHint="Shown to the club so it knows who the link went to"
                value={inviteeName}
                onChangeText={setInviteeName}
                placeholder="e.g. Sam Jones, or their parent's name"
                placeholderTextColor={colour.inkSubtle}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
                style={[type.body, { minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
              />
              <Text style={[type.caption, { color: colour.inkMuted }]}>Only so the club can see who it was sent to.</Text>
            </View>
            {problem && <Note tone="danger">{problem}</Note>}
            <ButtonRow weights={[1, 2]}>
              <Button label="Back" variant="secondary" onPress={() => setStep("choose")} />
              <Button label="Create Link" onPress={() => void issue(true)} busy={busy} disabled={!inviteeName.trim()} />
            </ButtonRow>
          </View>
        )}

        {step === "share" && share && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title={share.personal ? `Link for ${inviteeName.trim()}` : `${teamName ?? "Team"} Joining Pass`} detail={share.personal ? "It works once. Send it however suits you." : "Anyone with it can ask to join. The club decides."} />
            <ShareView
              share={share.data}
              subject={{ kind: "TEAM_JOIN", clubName: clubName ?? "Our club", teamName: teamName ?? "the team", inviteeName: share.personal ? inviteeName.trim() : null }}
              // A PERSONAL LINK HAS NO POSTER: it works once, so a printed copy would be spent by its first scan.
              poster={share.personal ? undefined : poster}
              explainer="Using it asks to join. The club approves each request before anyone is added to the squad."
              onDone={() => (router.canGoBack() ? router.back() : setStep("choose"))}
            />
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
