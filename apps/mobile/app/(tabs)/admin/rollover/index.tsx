import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { consequenceSentence, handoverIntroSentence, readinessSentence, splitConsequences } from "@ovalball/contracts/club/handover"

import { AdminScreen } from "../../../../src/admin/screen"
import { CountRow, HandoverSeasonLine, HandoverSectionRow, longDate, useHandoverBoard } from "../../../../src/admin/handover"
import { CalendarSync } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * SEASON HANDOVER -- THE OVERVIEW (CA-M11.1).
 *
 * PREPARE -> DECIDE -> REVIEW -> APPLY, as five screens over one shared board. This one is the
 * website's Overview: the seasons, the handover's state, the product sentence, the readiness line,
 * the way into each section, and the transition ledger -- one plain statement per consequence, in the
 * FUTURE tense until the handover runs, because the server decides the tense.
 *
 * Nothing here computes anything. The current and next season are the register's; the state,
 * readiness and consequences are the server's; the words are the shared contract's.
 */
export default function HandoverOverview() {
  const router = useRouter()
  const { loading, clubId, board, error, reload } = useHandoverBoard()

  return (
    <AdminScreen section="Season Handover" onRefresh={() => void reload()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <CalendarSync size={18} color={colour.forest800} />
          <Text style={[type.overline, { color: colour.forest800 }]}>CLUB</Text>
        </View>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Season Handover
        </Text>
        {board && <HandoverSeasonLine board={board} />}
        {board?.nextSeason?.preSeasonStartsOn && <Text style={[type.caption, { color: colour.inkMuted }]}>Runs from {longDate(board.nextSeason.preSeasonStartsOn)}</Text>}
        {board && <Text style={[type.body, { color: colour.inkMuted }]}>{handoverIntroSentence(board)}</Text>}
        {board?.readiness && <Text style={[type.small, { color: colour.inkMuted }]}>{readinessSentence(board.readiness)}</Text>}
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void reload()} offline={error.retryable} />}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Season Handover works on the club you are viewing. Switch to a club context from the header." />}

      {board && (
        <>
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            <HandoverSectionRow first section="teams" caption={board.readiness ? `${board.readiness.teamsDecided} of ${board.readiness.teamsTotal} teams decided` : "Prepare the handover and decide each team"} />
            <HandoverSectionRow section="players" caption={board.readiness ? `${board.readiness.playersTotal} players reviewed` : "Where every player goes next season"} />
            <HandoverSectionRow section="attention" caption={board.rollover ? (board.blockers.length === 0 ? "Nothing outstanding" : "Decisions still needed before Apply") : "Prepare a handover first"} badge={board.blockers.length} />
            <HandoverSectionRow section="apply" caption={board.rollover ? (board.readiness?.isApplied ? "Applied — what happened is recorded" : board.blockers.length === 0 ? "Ready to apply" : "Not ready to apply") : "Nothing to apply yet"} />
          </View>

          {board.consequences.length === 0 ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Nothing prepared yet</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                Once a handover is prepared, everything it will do to {board.nextSeason ? `your club for ${board.nextSeason.name}` : "your club"} is listed here before any of it happens.
              </Text>
              <Button label="Prepare Handover" variant="secondary" onPress={() => router.push("/admin/rollover/teams" as never)} />
            </Card>
          ) : (
            <Ledger board={board} />
          )}
        </>
      )}
    </AdminScreen>
  )
}

function Ledger({ board }: { board: NonNullable<ReturnType<typeof useHandoverBoard>["board"]> }) {
  const { teamLines, newLines } = splitConsequences(board.consequences)
  const undecided = teamLines.filter((c) => c.kind === "undecided").length
  const isApplied = board.readiness?.isApplied ?? false
  const r = board.readiness

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>TEAMS ALREADY AT THE CLUB</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {isApplied
            ? "What this handover did to each cohort."
            : undecided > 0
              ? `What this handover will do to each cohort when you apply it. ${undecided} still ${undecided === 1 ? "needs" : "need"} a decision.`
              : "What this handover will do to each cohort when you apply it."}
        </Text>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {teamLines.length === 0 && (
            <Text style={[type.small, { color: colour.inkMuted, padding: space.lg }]}>No team decisions recorded yet.</Text>
          )}
          {teamLines.map((c, i) => (
            <ConsequenceLine key={`${c.kind}-${c.fromLabel}-${i}`} c={c} first={i === 0} />
          ))}
        </Card>
      </View>

      {newLines.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>{isApplied ? "TEAMS THE CLUB NOW RUNS" : "TEAMS THE CLUB WILL RUN"}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {isApplied ? "Sides this handover created." : "Planned, not created. Each of these takes an identity that a current cohort only gives up when the handover runs."}
          </Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {newLines.map((c, i) => (
              <ConsequenceLine key={`new-${c.toLabel}-${i}`} c={c} first={i === 0} />
            ))}
          </Card>
        </View>
      )}

      {r && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>PEOPLE</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <CountRow first label="Players reviewed" value={r.playersTotal} />
            <CountRow label="Need a decision" value={r.playersNeedsAttention + r.playersBlocked} />
            <CountRow label="Reaching the end of the youth pathway" value={r.playersClubHolding} />
            <CountRow label="Awaiting governing-body approval" value={r.dispensationsPending} />
            <CountRow label="Teams still undecided" value={r.teamsPending} />
          </Card>
        </View>
      )}
    </View>
  )
}

function ConsequenceLine({ c, first }: { c: Parameters<typeof consequenceSentence>[0]; first: boolean }) {
  const s = consequenceSentence(c)
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Text style={[type.small, { color: colour.ink }]}>
        <Text style={type.smallMedium}>{s.subject}</Text>
        <Text style={{ color: colour.inkMuted }}> {s.verb} </Text>
        {!!s.object && <Text style={type.smallMedium}>{s.object}</Text>}
      </Text>
      {s.needsDecision && (
        <View style={{ alignSelf: "flex-start", backgroundColor: colour.warningSurface, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
          <Text style={[type.caption, { color: colour.warning }]}>Needs a decision</Text>
        </View>
      )}
      {!!c.note && <Text style={[type.caption, { color: colour.inkMuted }]}>{c.note}</Text>}
    </View>
  )
}
