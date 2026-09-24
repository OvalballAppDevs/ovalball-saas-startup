import { useCallback, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  bulkConfirmCandidates,
  createNextSeasonGroup,
  decideMixedBoundary,
  decideTeamProposal,
  groupProposalsByAgeGrade,
  mixedBoundaryLabel,
  nextSeasonGroupTag,
  noAutomaticSuccessor,
  prepareHandover,
  resolveGroupFlag,
  teamDecisionLabel,
  undoTeamDecision,
  type MiniRugbyGroupRow,
  type RolloverBatch,
  type RolloverGroupFlagRow,
  type RolloverTeamProposalRow,
} from "@ovalball/contracts/club/handover"

import { AdminScreen } from "../../../../src/admin/screen"
import { HandoverSeasonLine, Notice, handoverProblem, shortDate, useHandoverBoard } from "../../../../src/admin/handover"
import { GroupCompositionSheet, MixedBoundarySheet, TeamDecisionSheet, type GroupCompositionAsk, type MixedBoundaryAsk, type TeamDecisionAsk, type TeamDecisionDraft } from "../../../../src/admin/handover-sheets"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { holdIntent, takeIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ChevronRight, CircleCheck, TriangleAlert, Undo2 } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, SectionHeading } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const INTENT_KEY = "rollover:teams"
interface HeldDecision {
  proposalId: string
  draft: TeamDecisionDraft
}

/**
 * TEAMS -- prepare the handover and decide each side (CA-M11.1).
 *
 * Every control here records a DECISION. None of them changes a team: the club's teams are exactly
 * what they were until the handover is applied, which is what makes "Confirmed" mean "decided" rather
 * than "already done" -- and what makes Undo possible at all.
 *
 * The target season is chosen from the canonical register (the upcoming seasons for the club's own
 * code) and never typed or computed. The proposed age grade, whether a choice is required and whether
 * a Mixed side stands at its structural boundary all came from the server with the proposal.
 *
 * A fold or a graduation is held to `team.lifecycle.manage`, declared recent-authenticator: a "code
 * first" refusal holds the draft in memory, steps up, and re-opens the same sheet on return -- the
 * person confirms again and the server decides again.
 */
export default function HandoverTeams() {
  const router = useRouter()
  const { loading, clubId, board, error, reload } = useHandoverBoard()
  const [toSeasonId, setToSeasonId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null)
  const [decisionAsk, setDecisionAsk] = useState<TeamDecisionAsk | null>(null)
  const [mixedAsk, setMixedAsk] = useState<MixedBoundaryAsk | null>(null)
  const [groupAsk, setGroupAsk] = useState<GroupCompositionAsk | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const problem = useCallback((cause: unknown) => handoverProblem(cause, "this decision"), [])

  const openDecision = useCallback(
    (proposal: RolloverTeamProposalRow, initialDraft?: TeamDecisionDraft, note?: string) => {
      setDecisionAsk({
        proposal,
        initialDraft,
        note,
        onConfirm: async (draft) => {
          await decideTeamProposal(supabase, { proposalId: proposal.id, ...draft })
          setNotice({ tone: "ok", text: `${proposal.teamDisplayName}: decision recorded. Nothing has changed yet — apply the handover to carry it out.` })
          await reload()
        },
      })
    },
    [reload]
  )

  // Back from a step-up: the held draft re-opens the same sheet, and only Confirm records it.
  useFocusEffect(
    useCallback(() => {
      const held = takeIntent<HeldDecision>(INTENT_KEY)
      if (!held || !board) return
      const proposal = board.batches.flatMap((b) => b.proposals).find((p) => p.id === held.proposalId)
      if (proposal) openDecision(proposal, held.draft, "Verified. Confirm to continue.")
    }, [board, openDecision])
  )

  const selectedSeason = board ? (board.upcomingSeasons.find((s) => s.id === toSeasonId) ?? board.upcomingSeasons[0] ?? null) : null

  function prepare() {
    if (!board || !selectedSeason) return
    setAsk({
      title: `Prepare the handover to ${selectedSeason.name}?`,
      body: `Reads every active ${board.club.rugbyCode === "union" ? "Union" : "League"} youth team and proposes what it becomes next season. Preparing changes nothing, and neither does deciding — your club runs exactly what it runs today until the handover is applied.`,
      confirmLabel: "Prepare Handover",
      reason: "none",
      onConfirm: async () => {
        setPreparing(true)
        try {
          await prepareHandover(supabase, board.club.id, board.club.rugbyCode, selectedSeason.id)
          setNotice({ tone: "ok", text: `Prepared for ${selectedSeason.name}. Decide each team below.` })
          await reload()
        } finally {
          setPreparing(false)
        }
      },
    })
  }

  function bulkConfirm(batch: RolloverBatch) {
    const candidates = bulkConfirmCandidates(batch.proposals)
    if (candidates.length === 0) return
    setAsk({
      title: `Confirm ${candidates.length} straightforward team${candidates.length === 1 ? "" : "s"}?`,
      body: `Records the proposed next age grade for ${candidates.map((c) => c.teamDisplayName).join(", ")}. Anything exceptional — a Mixed split, a cohort with no automatic successor — is left for you to answer. Nothing changes until the handover is applied.`,
      confirmLabel: "Confirm Teams",
      reason: "none",
      onConfirm: async () => {
        let done = 0
        const failures: string[] = []
        for (const p of candidates) {
          try {
            await decideTeamProposal(supabase, { proposalId: p.id, action: "confirm", ageGroup: p.proposedAgeGroup, squadDesignation: null, foldReason: null })
            done += 1
          } catch (cause) {
            logDetail("admin:rollover:bulk-confirm", friendly(cause, "this decision"))
            failures.push(`${p.teamDisplayName}: ${problem(cause)}`)
          }
        }
        await reload()
        setNotice(
          failures.length === 0
            ? { tone: "ok", text: `${done} team${done === 1 ? "" : "s"} recorded. Nothing has changed yet — apply the handover to carry these out.` }
            : { tone: "error", text: `${done} recorded, ${failures.length} could not be: ${failures[0]}` }
        )
      },
    })
  }

  function undo(proposal: RolloverTeamProposalRow) {
    setAsk({
      title: `Undo the decision for ${proposal.teamDisplayName}?`,
      body: "The team returns to undecided. Possible because deciding changed nothing.",
      confirmLabel: "Undo",
      reason: "none",
      onConfirm: async () => {
        await undoTeamDecision(supabase, proposal.id)
        setNotice({ tone: "ok", text: `${proposal.teamDisplayName} is undecided again.` })
        await reload()
      },
    })
  }

  function markResolved(flag: RolloverGroupFlagRow) {
    setAsk({
      title: `Mark the ${flag.displayTag} flag resolved?`,
      body: flag.reason,
      confirmLabel: "Mark Resolved",
      reason: "none",
      onConfirm: async () => {
        await resolveGroupFlag(supabase, flag.id)
        await reload()
      },
    })
  }

  function openMixed(proposal: RolloverTeamProposalRow) {
    setMixedAsk({
      proposal,
      onConfirm: async (createGirlsTeam, girlsSquadDesignation) => {
        await decideMixedBoundary(supabase, { proposalId: proposal.id, createGirlsTeam, boysSquadDesignation: null, girlsSquadDesignation })
        setNotice({ tone: "ok", text: `${proposal.teamDisplayName}: structural transition decided.` })
        await reload()
      },
    })
  }

  function createGroupSame(group: MiniRugbyGroupRow) {
    if (!board?.nextSeason) return
    const season = board.nextSeason
    const teamIds = group.teams.map((t) => t.teamId)
    setAsk({
      title: `Create the ${season.name} group for ${group.alias ?? group.displayTag}?`,
      body: `A new Mini-Rugby Group for ${season.name} with the same teams: ${group.teams.map((t) => t.displayName).join(", ")}. This season's group is never changed.`,
      confirmLabel: "Create Next-Season Group",
      reason: "none",
      onConfirm: async () => {
        await createNextSeasonGroup(supabase, { sourceGroupId: group.id, toSeasonId: season.id, teamIds, alias: group.alias })
        setNotice({ tone: "ok", text: `${group.alias ?? group.displayTag} continues into ${season.name} as ${nextSeasonGroupTag(group, teamIds)}.` })
        await reload()
      },
    })
  }

  function editGroup(group: MiniRugbyGroupRow) {
    if (!board?.nextSeason) return
    const season = board.nextSeason
    setGroupAsk({
      group,
      toSeasonName: season.name,
      onCreate: async (teamIds, alias) => {
        await createNextSeasonGroup(supabase, { sourceGroupId: group.id, toSeasonId: season.id, teamIds, alias })
        setNotice({ tone: "ok", text: `${group.alias ?? group.displayTag} continues into ${season.name} as ${nextSeasonGroupTag(group, teamIds)}.` })
        await reload()
      },
    })
  }

  return (
    <AdminScreen section="Season Handover · Teams" onRefresh={() => void reload()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Teams
        </Text>
        {board && <HandoverSeasonLine board={board} />}
        <Text style={[type.body, { color: colour.inkMuted }]}>What each side becomes next season. Every control here records a decision; nothing changes until the handover is applied.</Text>
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void reload()} offline={error.retryable} />}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Season Handover works on the club you are viewing." />}
      {notice && <Notice tone={notice.tone} text={notice.text} />}

      {board && (
        <>
          <Card style={{ gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Prepare a handover</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                Reads every active {board.club.rugbyCode === "union" ? "Union" : "League"} youth team and proposes what it becomes next season. Preparing changes nothing, and neither does deciding.
              </Text>
            </View>
            {board.upcomingSeasons.length === 0 ? (
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {board.currentSeason ? `The season after ${board.currentSeason.name} hasn't been added yet — ask a Site Admin to create it under Seasons.` : "Ask a Site Admin to add next season under Seasons first."}
              </Text>
            ) : (
              <>
                <View accessibilityRole="radiogroup" accessibilityLabel="Target season" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {board.upcomingSeasons.map((s) => {
                    const on = selectedSeason?.id === s.id
                    return (
                      <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={s.name} onPress={() => setToSeasonId(s.id)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                        <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{s.name}</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <Button label={preparing ? "Preparing…" : "Prepare Handover"} onPress={prepare} busy={preparing} disabled={!selectedSeason || !board.capabilities.prepare} />
              </>
            )}
          </Card>

          {board.batches.length === 0 && <EmptyState title="No handover has been prepared yet" body="Prepare one above to see what each team becomes next season." />}

          {board.batches.map((batch) => (
            <BatchCard key={batch.id} batch={batch} onBulk={() => bulkConfirm(batch)} onDecide={(p) => openDecision(p)} onMixed={openMixed} onUndo={undo} onResolve={markResolved} />
          ))}

          {board.miniRugbyGroups.length > 0 && (
            <View style={{ gap: space.sm }}>
              <SectionHeading>Mini-Rugby Groups — Next Season</SectionHeading>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {board.nextSeason
                  ? `Decide how each shared Mini-Rugby Group should continue into ${board.nextSeason.name}. Skipping leaves it for later — nothing here changes this season's group.`
                  : "A next season must be configured before a Mini-Rugby Group can be progressed."}
              </Text>
              {board.miniRugbyGroups.map((g) => (
                <Card key={g.id} style={{ gap: space.sm }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{g.alias ?? g.displayTag}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    Currently {g.displayTag} — {g.teams.map((t) => t.displayName).join(", ")}
                  </Text>
                  {g.alreadyCreatedTag ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                      <CircleCheck size={16} color={colour.pitch600} />
                      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
                        Continues into {board.nextSeason?.name} as <Text style={type.smallMedium}>{g.alreadyCreatedTag}</Text>.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Button label="Create Next-Season Group" onPress={() => createGroupSame(g)} disabled={!board.nextSeason || !board.capabilities.miniRugbyGroups} style={{ flex: 3 }} />
                      <Button label="Edit" variant="secondary" onPress={() => editGroup(g)} disabled={!board.nextSeason || !board.capabilities.miniRugbyGroups} style={{ flex: 1 }} accessibilityHint="Edit the composition, then create" />
                    </View>
                  )}
                </Card>
              ))}
            </View>
          )}

          <Button label="Players" variant="quiet" onPress={() => router.push("/admin/rollover/players" as never)} accessibilityHint="Continue to where each player goes next season" />
        </>
      )}

      <TeamDecisionSheet
        ask={decisionAsk}
        onClose={() => setDecisionAsk(null)}
        onStepUp={(draft) => {
          if (decisionAsk) holdIntent<HeldDecision>(INTENT_KEY, { proposalId: decisionAsk.proposal.id, draft })
          setDecisionAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/rollover/teams" } } as never)
        }}
        errorMessage={problem}
      />
      <MixedBoundarySheet ask={mixedAsk} onClose={() => setMixedAsk(null)} errorMessage={problem} />
      <GroupCompositionSheet ask={groupAsk} onClose={() => setGroupAsk(null)} errorMessage={(cause) => handoverProblem(cause, "this Mini-Rugby Group")} />
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void reload()} errorMessage={problem} />
    </AdminScreen>
  )
}

function BatchCard({
  batch,
  onBulk,
  onDecide,
  onMixed,
  onUndo,
  onResolve,
}: {
  batch: RolloverBatch
  onBulk: () => void
  onDecide: (p: RolloverTeamProposalRow) => void
  onMixed: (p: RolloverTeamProposalRow) => void
  onUndo: (p: RolloverTeamProposalRow) => void
  onResolve: (f: RolloverGroupFlagRow) => void
}) {
  const groups = groupProposalsByAgeGrade(batch.proposals)
  const candidates = bulkConfirmCandidates(batch.proposals)

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>
          {batch.fromSeasonName ?? "—"} → {batch.toSeasonName}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Prepared {shortDate(batch.createdAt)}
          {batch.isApplied && " · applied"}
        </Text>
      </View>

      {!batch.isApplied && candidates.length > 0 && <Button label={`Confirm ${candidates.length} Straightforward Team${candidates.length === 1 ? "" : "s"}`} variant="secondary" onPress={onBulk} />}

      {batch.groupFlags.map((f) => (
        <View key={f.id} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: radius.md, backgroundColor: f.resolved ? "rgba(16,21,18,0.05)" : colour.warningSurface }}>
          <TriangleAlert size={16} color={f.resolved ? colour.inkMuted : colour.warning} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.smallMedium, { color: f.resolved ? colour.inkMuted : colour.warning }]}>{f.displayTag} Mini-Rugby Group requires reconfiguration</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{f.reason}</Text>
            {!f.resolved && <Button label="Mark Resolved" variant="quiet" onPress={() => onResolve(f)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />}
          </View>
          {f.resolved && <CircleCheck size={16} color={colour.forest800} />}
        </View>
      ))}

      {groups.map((group) => (
        <View key={group.age} style={{ gap: space.xs }}>
          <Text style={[type.overline, { color: colour.inkSubtle, marginTop: space.xs }]}>{group.age.toUpperCase()}</Text>
          {group.rows.some((r) => r.teamSquadDesignation) && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              Each squad is decided on its own — confirming {group.age} does not decide{" "}
              {group.rows
                .filter((r) => r.teamSquadDesignation)
                .map((r) => `${group.age} ${r.teamSquadDesignation}`)
                .join(" or ")}
              .
            </Text>
          )}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {group.rows.map((p, i) => (
              <ProposalRow key={p.id} proposal={p} first={i === 0} onDecide={() => (p.isMixedBoundary ? onMixed(p) : onDecide(p))} onUndo={() => onUndo(p)} />
            ))}
          </Card>
        </View>
      ))}
    </View>
  )
}

function ProposalRow({ proposal: p, first, onDecide, onUndo }: { proposal: RolloverTeamProposalRow; first: boolean; onDecide: () => void; onUndo: () => void }) {
  const pending = p.decision === "pending"
  const noSuccessor = noAutomaticSuccessor(p)
  const summary = p.isMixedBoundary
    ? pending
      ? `Mixed → ${p.proposedAgeGroup} structural transition`
      : mixedBoundaryLabel(p, p.createGirlsTeam)
    : pending
      ? `${p.currentAgeGroup} → ${noSuccessor ? "no automatic successor" : p.requiresManualChoice ? "needs an explicit choice" : (p.proposedAgeGroup ?? "")}`
      : teamDecisionLabel(p.decision, p.decidedAgeGroup, p.applied)
  const attention = pending && (p.isMixedBoundary || p.requiresManualChoice)
  const tone = pending ? (attention ? colour.warning : colour.inkMuted) : p.decision === "deferred" ? colour.warning : colour.forest800

  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{p.teamDisplayName}</Text>
        <Text style={[type.caption, { color: tone }]}>{summary}</Text>
      </View>
      {pending ? (
        <ChevronRight size={17} color={colour.inkSubtle} />
      ) : (
        !p.applied && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Undo the decision for ${p.teamDisplayName}`} onPress={onUndo} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Undo2 size={18} color={colour.forest800} />
          </Pressable>
        )
      )}
    </>
  )

  const shape = { minHeight: TOUCH_TARGET + 12, flexDirection: "row" as const, alignItems: "center" as const, gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }
  if (pending) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${p.teamDisplayName}. ${summary}. Decide`} onPress={onDecide} style={({ pressed }) => ({ ...shape, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
        {body}
      </Pressable>
    )
  }
  return <View style={shape}>{body}</View>
}
