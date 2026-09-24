import { useState } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import * as Linking from "expo-linking"
import { askGuardianForPlayingInformation, askGuardianSentence, blockerDestination, type HandoverBlocker } from "@ovalball/contracts/club/handover"

import { AdminScreen } from "../../../../src/admin/screen"
import { HandoverSeasonLine, handoverProblem, useHandoverBoard } from "../../../../src/admin/handover"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { supabase } from "../../../../src/auth/supabase"
import { webUrl } from "../../../../src/config/environment"
import { CircleCheck } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * NEEDS ATTENTION -- everything standing between this handover and Apply, in one queue (CA-M11.1).
 *
 * The rows come from `handover_apply_blockers` -- the same function Apply itself runs before it touches
 * anything -- so this list cannot say the handover is clear while Apply refuses it, or the reverse.
 * Each row opens the section that owns the decision; the item also stays visible in its own section.
 *
 * One blocker the club cannot clear itself: a missing playing pathway. Gender is protected identity
 * information, and running a team is not the authority to record it -- so the action offered is to ASK
 * the people who hold that relationship. A "season" blocker belongs to Site Admin's register, a desk
 * job on the website, and opens there.
 */
export default function HandoverAttention() {
  const router = useRouter()
  const { loading, clubId, board, error, reload } = useHandoverBoard()

  return (
    <AdminScreen section="Season Handover · Needs Attention" onRefresh={() => void reload()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Needs Attention
        </Text>
        {board && <HandoverSeasonLine board={board} />}
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void reload()} offline={error.retryable} />}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Season Handover works on the club you are viewing." />}

      {board && !board.rollover && <EmptyState title="Nothing to review yet" body="Prepare a handover from Teams first. What it needs from you appears here." />}

      {board && board.rollover && board.blockers.length === 0 && (
        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <CircleCheck size={20} color={colour.forest800} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Nothing outstanding</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>Every team has a decision and every player has somewhere to go. The handover can be applied from Apply & Audit.</Text>
            </View>
          </View>
          <Button label="Apply & Audit" variant="secondary" onPress={() => router.push("/admin/rollover/apply" as never)} />
        </Card>
      )}

      {board && board.blockers.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>
            {board.blockers.length} {board.blockers.length === 1 ? "item needs" : "items need"} a decision
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>Nothing about your club has changed. The handover holds here until each of these is settled, rather than moving some cohorts and leaving others.</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {board.blockers.map((b, i) => (
              <BlockerRow key={`${b.kind}-${b.subject}-${i}`} blocker={b} first={i === 0} />
            ))}
          </Card>
        </View>
      )}

      {board && board.plannedResolved.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Resolved by a decision to add a team</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>These were gaps. The club has decided to run the missing side, so they no longer hold the handover — the team is created when it is applied.</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {board.plannedResolved.map((p, i) => (
              <View key={p.label} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                <CircleCheck size={16} color={colour.forest800} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{p.label}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{p.note}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}
    </AdminScreen>
  )
}

function BlockerRow({ blocker: b, first }: { blocker: HandoverBlocker; first: boolean }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const destination = blockerDestination(b.kind)

  function go() {
    if (destination.section === "seasons") {
      // Site Admin's season register is a desk job on the website, opened there -- never a WebView.
      void Linking.openURL(`${webUrl}/admin/seasons`)
      return
    }
    router.push(`/admin/rollover/${destination.section}` as never)
  }

  async function askGuardian() {
    if (!b.subjectId) return
    setAsking(true)
    try {
      setMessage(askGuardianSentence(await askGuardianForPlayingInformation(supabase, b.subjectId), b.subject))
    } catch (cause) {
      logDetail("admin:rollover:ask-guardian", friendly(cause, "this request"))
      setMessage(handoverProblem(cause, "this request"))
    } finally {
      setAsking(false)
    }
  }

  return (
    <View style={{ padding: space.lg, gap: space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{b.subject}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{b.detail}</Text>
      </View>
      {b.needsPlayerInformation && b.subjectId ? (
        <>
          <Button label={asking ? "Asking…" : "Ask Their Guardian"} variant="secondary" onPress={() => void askGuardian()} busy={asking} disabled={message !== null} accessibilityHint="The club may ask for this information but not record it" />
          {message && <Text style={[type.caption, { color: colour.inkMuted }]}>{message}</Text>}
        </>
      ) : (
        <Button label={destination.label} variant="secondary" onPress={go} accessibilityHint={destination.section === "seasons" ? "Opens the Ovalball website" : undefined} />
      )}
    </View>
  )
}
