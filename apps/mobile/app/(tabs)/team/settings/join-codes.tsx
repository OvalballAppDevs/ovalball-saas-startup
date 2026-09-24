import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { issueTeamJoinCode, readTeamJoinCodes, revokeTeamJoinCode, type TeamJoinCode } from "@ovalball/contracts/team/requests"
import { teamPeopleErrorMessage } from "@ovalball/contracts/team/people"
import { invitationExpiryLabel, invitationJoinUrl, type InvitationShareData } from "@ovalball/contracts/invitations"
import { InvitationSharePanel } from "../../../../src/invitations/share-panel"
import { webUrl } from "../../../../src/config/environment"

import { supabase } from "../../../../src/auth/supabase"
import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { exactDate } from "../../../../src/agenda/presentation"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * JOIN CODES -- a code a family can use to ask to join this side (CA-M7).
 *
 * A code is an invitation of kind TEAM_JOIN_CODE, issued by `issue_invitation` (which asks
 * `team.join_code.manage` at the team or the club) and revoked by `revoke_invitation` with a reason.
 * REDEEMING A CODE GRANTS NOTHING: it creates a join request the club then reviews, so a code shared
 * too widely costs the club review work, never access. The plain code is shown ONCE, at issue; after
 * that only its hint is readable, here and on the website alike.
 */
export default function TeamJoinCodes() {
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [codes, setCodes] = useState<TeamJoinCode[] | null>(null)
  const [fresh, setFresh] = useState<InvitationShareData | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setCodes(await readTeamJoinCodes(supabase, teamId))
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load join codes. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setCodes(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function issue() {
    if (!teamId || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await issueTeamJoinCode(supabase, teamId)
      // THE SAME TRIPLE THE WEBSITE SHOWS: the link, the code and (in the panel) a QR of the link.
      if (result.token) setFresh({ url: invitationJoinUrl(result.token, webUrl), code: result.code, outcome: ["A request to join this side, for the club to decide"], expiresLabel: invitationExpiryLabel(result.expiresAt), sentTo: null })
      await load()
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "Couldn't issue a code."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TeamScreen section="Join Codes">
      {!authorityLoading && !authority.joinCodeManage && <NotForYou title="Join codes are not part of your job here" body="Codes for this side are issued by the people the club has given that job to." />}
      {authority.joinCodeManage && (
        <>
          <Text style={[type.small, { color: colour.inkMuted }]}>Give a code to a family who want to join this side. Using it asks to join; the club decides.</Text>
          {fresh && (
            <Card style={{ backgroundColor: colour.successSurface, borderColor: colour.pitch600 }}>
              <Text style={[type.caption, { color: colour.forest800, marginBottom: space.sm }]}>NEW CODE — shown once</Text>
              <InvitationSharePanel share={fresh} onDone={() => setFresh(null)} />
            </Card>
          )}
          <Button label="Issue a New Code" onPress={() => void issue()} busy={busy} />
        </>
      )}
      {problem && <ErrorState message={problem} onRetry={load} />}
      {!problem && codes === null && authority.joinCodeManage && <CardSkeleton lines={2} />}
      {codes && codes.length === 0 && authority.joinCodeManage && <EmptyState title="No live codes" body="Issue one when a family asks how to join." />}
      {codes && codes.length > 0 && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {codes.map((c, index) => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15, letterSpacing: 1 }]}>{c.codeHint || "••••"}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  Used {c.useCount}{c.maxUses > 0 ? ` of ${c.maxUses}` : ""}
                  {c.expiresAt ? ` · expires ${exactDate(c.expiresAt.slice(0, 10))}` : ""}
                </Text>
              </View>
              <Button
                label="Revoke"
                variant="quiet"
                onPress={() =>
                  setAsk({
                    title: "Revoke this code?",
                    body: "Anyone still holding it can no longer use it. Say why; the reason is recorded.",
                    confirmLabel: "Revoke",
                    destructive: true,
                    reason: "required",
                    onConfirm: async (reason) => {
                      await revokeTeamJoinCode(supabase, c.id, reason)
                      await load()
                    },
                  })
                }
              />
            </View>
          ))}
        </View>
      )}
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That could not be done.")} />
    </TeamScreen>
  )
}
