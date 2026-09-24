import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  APPLY_AUTHORITY_SENTENCE,
  APPLY_IRREVERSIBLE_SENTENCE,
  applyConfirmationLines,
  applyOutcomeSentence,
  applySeasonHandover,
  consequenceCounts,
  handoverEventWord,
} from "@ovalball/contracts/club/handover"

import { AdminScreen } from "../../../../src/admin/screen"
import { CountRow, HandoverSeasonLine, Notice, handoverProblem, longDate, shortDateTime, useHandoverBoard } from "../../../../src/admin/handover"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { CircleCheck, TriangleAlert } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, SectionHeading } from "../../../../src/components/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * APPLY & AUDIT -- the single mutation boundary, and the record of what was decided (CA-M11.1).
 *
 * Everything above the button is the exact consequence summary -- the same server-computed lines the
 * Overview shows -- because "these reviewed decisions will now update the club" is only a fair thing
 * to say if the reviewer can see what those decisions are. The confirmation sheet restates each
 * consequence in words, says that it cannot be undone from the board, and only its Confirm calls
 * `apply_season_handover` -- with the revision the reviewer had in front of them, so a decision changed
 * by somebody else in the meantime is refused rather than applied unreviewed.
 *
 * AUTHORITY IS THE SERVER'S. The control is offered on `team.handover.apply` -- the key the server
 * judges -- and a person who may review but not run the handover reads why instead of a dead control.
 *
 * RECENT AUTHENTICATOR. Apply is declared recent-auth in the catalogue. When the server answers that a
 * code must be entered first, the sheet's intent is held in memory, the person steps up, and the SAME
 * sheet re-opens on return for them to confirm again. Verification never performs the mutation; a
 * cancelled step-up discards the intent.
 */
const INTENT_KEY = "rollover:apply"

export default function HandoverApply() {
  const router = useRouter()
  const { loading, clubId, board, error, reload } = useHandoverBoard()
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const pending = usePendingIntent(INTENT_KEY)

  // Back from a step-up: the held sheet re-opens with a note. Nothing runs until Confirm.
  useFocusEffect(
    useCallback(() => {
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [pending])
  )

  const rollover = board?.rollover ?? null
  const isApplied = !!rollover?.appliedAt
  const blockerCount = board?.blockers.length ?? 0
  const counts = board ? consequenceCounts(board.consequences) : null
  const seasonName = board?.nextSeason?.name ?? "next season"

  function confirmApply() {
    if (!board || !rollover || !counts || blockerCount > 0) return
    const rolloverId = rollover.id
    const expectedRevision = rollover.decisionsRevision
    setAsk({
      title: `Apply handover to ${seasonName}?`,
      body: `These reviewed decisions will now update the club for the new season.\n\n${applyConfirmationLines(counts)
        .map((l) => `• ${l}`)
        .join("\n")}\n\n${APPLY_IRREVERSIBLE_SENTENCE}`,
      confirmLabel: "Apply Handover",
      reason: "none",
      onConfirm: async () => {
        const result = await applySeasonHandover(supabase, rolloverId, expectedRevision)
        setOutcome(applyOutcomeSentence(result))
        await reload()
      },
    })
  }

  return (
    <AdminScreen section="Season Handover · Apply & Audit" onRefresh={() => void reload()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Apply & Audit
        </Text>
        {board && <HandoverSeasonLine board={board} />}
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void reload()} offline={error.retryable} />}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Season Handover works on the club you are viewing." />}

      {board && !rollover && <EmptyState title="No handover to apply" body="Prepare one from Teams first." />}

      {board && rollover && counts && (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.lg, borderBottomWidth: 1, borderBottomColor: colour.line }}>
              {isApplied || blockerCount === 0 ? <CircleCheck size={20} color={colour.forest800} /> : <TriangleAlert size={20} color={colour.warning} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{isApplied ? `Applied${rollover.appliedAt ? ` on ${longDate(rollover.appliedAt)}` : ""}` : blockerCount > 0 ? "Not ready to apply" : "Ready to apply"}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>
                  {isApplied
                    ? `Your club now runs the ${seasonName} season structure. Correcting anything from here is an ordinary team or player change, not a handover decision.`
                    : blockerCount > 0
                      ? `${blockerCount} item${blockerCount === 1 ? " still needs" : "s still need"} a decision. Nothing about your club has changed, and nothing will until every one of them is settled.`
                      : "Every decision is recorded and still valid. Applying carries all of them out at once."}
                </Text>
              </View>
            </View>
            <CountRow first label={isApplied ? "Teams progressed" : "Teams progressing"} value={counts.progressing} />
            <CountRow label="Teams created or reactivated" value={counts.creating} />
            <CountRow label={isApplied ? "Cohorts that completed the youth pathway" : "Cohorts completing the youth pathway"} value={counts.graduating} />
            <CountRow label={isApplied ? "Teams that did not continue" : "Teams not continuing"} value={counts.folding} />
          </Card>

          {!isApplied && (
            <View style={{ gap: space.sm }}>
              {board.capabilities.apply ? (
                <Button label={`Apply Handover to ${seasonName}`} onPress={confirmApply} disabled={blockerCount > 0} accessibilityHint={blockerCount > 0 ? `${blockerCount} outstanding items must be decided first` : "Opens a confirmation before anything changes"} />
              ) : (
                <Notice tone="info" text={APPLY_AUTHORITY_SENTENCE} />
              )}
              {blockerCount > 0 && (
                <Button label={`See What Needs a Decision (${blockerCount})`} variant="secondary" onPress={() => router.push("/admin/rollover/attention" as never)} />
              )}
            </View>
          )}

          {outcome && <Notice tone="ok" text={outcome} />}

          <View style={{ gap: space.sm }}>
            <SectionHeading>Audit</SectionHeading>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Every decision and every consequence, in the order they happened.</Text>
            {board.audit.length === 0 ? (
              <EmptyState title="Nothing recorded yet" body="Decisions appear here as they are made." />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {board.audit.map((a, i) => (
                  <View key={`${a.at}-${i}`} style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <Text style={[type.small, { color: colour.ink }]}>{handoverEventWord(a.event)}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      {a.actorName} · {shortDateTime(a.at)}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
          </View>
        </>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void reload()}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/rollover/apply" } } as never)
        }}
        errorMessage={(cause) => handoverProblem(cause, "this handover")}
      />
    </AdminScreen>
  )
}
