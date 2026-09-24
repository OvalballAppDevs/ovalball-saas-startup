import { useCallback, useMemo, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import {
  PLAYER_FILTERS,
  clearPlayerPlacement,
  markGraduatingPlayerLeft,
  matchesPlayerFilter,
  placeGraduatingPlayer,
  planMissingPlacementTeam,
  plannedPlacementVerdict,
  playerStatusLabel,
  playerStatusTone,
  readPlacementOptions,
  selectedPlacementText,
  setPlayerPlacement,
  setPlayerPlannedPlacement,
  type GraduationQueueRow,
  type PlayerFilter,
  type PlayerProposalRow,
  type PlayerStatusTone,
} from "@ovalball/contracts/club/handover"

import { AdminScreen } from "../../../../src/admin/screen"
import { HandoverSeasonLine, Notice, handoverProblem, useHandoverBoard } from "../../../../src/admin/handover"
import { GraduationSheet, PlacementSheet, type GraduationAsk, type PlacementAsk } from "../../../../src/admin/handover-sheets"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronDown, ChevronRight, GraduationCap, Search } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, SectionHeading } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PLAYERS -- where each player goes next season (CA-M11.1).
 *
 * Two things this deliberately does NOT do. It does not show a date of birth: the server reads one to
 * resolve an age grade and returns the DECISION, and that decision is all this needs. And it does not
 * decide anything itself -- every verdict shown here came back from the server, which classifies a
 * squad change against an age-grade change, runs the canonical movement resolver for the latter, and
 * refuses what it will not allow. The status word, its precedence and the filters are the shared
 * contract's, so this screen says exactly what the website says about the same row.
 *
 * Nothing here moves a child. Every control records a placement DECISION, and the memberships change
 * when the handover is applied -- which is why a placement can be changed back right up to that point.
 * The graduation queue below is the one exception the website also makes: placing a graduating player
 * ends a real membership, gated server-side by the governing-body approval rule.
 */
export default function HandoverPlayers() {
  const { loading, clubId, board, error, reload } = useHandoverBoard()
  const [filter, setFilter] = useState<PlayerFilter>("all")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null)
  const [placementAsk, setPlacementAsk] = useState<PlacementAsk | null>(null)
  const [graduationAsk, setGraduationAsk] = useState<GraduationAsk | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const problem = useCallback((cause: unknown) => handoverProblem(cause, "this placement"), [])
  const rows = board?.playerProposals ?? []

  const visible = useMemo(() => rows.filter((r) => matchesPlayerFilter(r, filter) && r.playerName.toLowerCase().includes(query.trim().toLowerCase())), [rows, filter, query])
  const attentionCount = rows.filter((r) => r.reviewState !== "READY").length

  // Anything needing a decision opens already expanded: a consequence a club has to act on should not
  // be behind a disclosure. Rows are keyed by playerId, not proposal id, because refreshing the
  // undecided proposals regenerates them and their ids churn; the player is the stable handle.
  const isOpen = (r: PlayerProposalRow) => expanded.has(r.playerId) || (r.reviewState !== "READY" && !expanded.has(`closed:${r.playerId}`))
  function toggle(r: PlayerProposalRow) {
    setExpanded((prev) => {
      const next = new Set(prev)
      const open = isOpen(r)
      next.delete(r.playerId)
      next.delete(`closed:${r.playerId}`)
      next.add(open ? `closed:${r.playerId}` : r.playerId)
      return next
    })
  }

  function changePlacement(row: PlayerProposalRow) {
    setPlacementAsk({
      playerName: row.playerName,
      loadOptions: () => readPlacementOptions(supabase, row.proposalId),
      onChoose: async (o) => {
        if (o.plannedId) {
          await setPlayerPlannedPlacement(supabase, row.proposalId, o.plannedId)
          setNotice({ tone: "ok", text: `${o.displayName} will be created when this handover is applied.` })
          return plannedPlacementVerdict(o.displayName, row.playerName)
        }
        if (!o.teamId) throw new Error("That team cannot be chosen.")
        const verdict = await setPlayerPlacement(supabase, row.proposalId, o.teamId)
        setNotice({ tone: verdict.reviewState === "BLOCKED" ? "error" : "ok", text: verdict.reason ?? "Placement updated." })
        return verdict
      },
    })
  }

  function runMissingTeam(row: PlayerProposalRow) {
    setAsk({
      title: `Run ${row.regulatoryAgeLabel ? `a ${row.regulatoryAgeLabel} side` : "this team"} next season?`,
      body: `The club runs no team at the age grade ${row.playerName.split(" ")[0]} belongs in. Recording that it will run one lets the handover place them there; the team itself is created when the handover is applied.`,
      confirmLabel: "Run This Team Next Season",
      reason: "none",
      onConfirm: async () => {
        await planMissingPlacementTeam(supabase, row.proposalId)
        setNotice({ tone: "ok", text: "The club will run that team next season. It is created when the handover is applied." })
        await reload()
      },
    })
  }

  function undoChoice(row: PlayerProposalRow) {
    setAsk({
      title: `Put ${row.playerName} back to their normal placement?`,
      body: "The chosen placement is withdrawn and the club's decisions say where they go.",
      confirmLabel: "Undo This Choice",
      reason: "none",
      onConfirm: async () => {
        await clearPlayerPlacement(supabase, row.proposalId)
        setNotice({ tone: "ok", text: `${row.playerName} is back to their normal placement.` })
        await reload()
      },
    })
  }

  function place(row: GraduationQueueRow) {
    if (!board) return
    setGraduationAsk({
      playerName: row.playerName,
      previousTeamName: row.previousTeamName,
      targets: board.graduationTargets,
      onPlace: async (teamId) => {
        await placeGraduatingPlayer(supabase, row.id, teamId)
        setNotice({ tone: "ok", text: `${row.playerName} placed on ${board.graduationTargets.find((t) => t.id === teamId)?.displayName ?? "the selected team"}.` })
        await reload()
      },
    })
  }

  function left(row: GraduationQueueRow) {
    setAsk({
      title: `Record that ${row.playerName} has left the club?`,
      body: "They leave the holding list and no team is assigned. This ends their place at the club.",
      confirmLabel: "Left the Club",
      destructive: true,
      reason: "none",
      onConfirm: async () => {
        await markGraduatingPlayerLeft(supabase, row.id)
        setNotice({ tone: "ok", text: `${row.playerName} recorded as not continuing at this club.` })
        await reload()
      },
    })
  }

  return (
    <AdminScreen section="Season Handover · Players" onRefresh={() => void reload()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Players
        </Text>
        {board && <HandoverSeasonLine board={board} />}
        {board && rows.length > 0 && (
          <Text style={[type.body, { color: colour.inkMuted }]}>
            {rows.length} player{rows.length === 1 ? "" : "s"} reviewed for {board.nextSeason?.name ?? "next season"}. {attentionCount === 0 ? "Every player has somewhere to go." : `${attentionCount} need${attentionCount === 1 ? "s" : ""} a decision.`}
          </Text>
        )}
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void reload()} offline={error.retryable} />}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Season Handover works on the club you are viewing." />}
      {notice && <Notice tone={notice.tone} text={notice.text} />}

      {board && rows.length === 0 && <EmptyState title="No players are affected by this handover yet" body="Players appear here once their teams have proposals." />}

      {board && rows.length > 0 && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput accessibilityLabel="Search players" value={query} onChangeText={setQuery} placeholder="Search players" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel="Filter players by status" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {PLAYER_FILTERS.map((f) => {
              const on = filter === f.key
              return (
                <Pressable key={f.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={f.label} onPress={() => setFilter(f.key)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                  <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {visible.length === 0 ? (
            <EmptyState title="No players match" body="Try a different name or filter." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {visible.map((row, i) => (
                <PlayerRow key={row.playerId} row={row} first={i === 0} open={isOpen(row)} onToggle={() => toggle(row)} onChange={() => changePlacement(row)} onRunTeam={() => runMissingTeam(row)} onUndo={() => undoChoice(row)} canPlace={board.capabilities.place} canPrepare={board.capabilities.prepare} />
              ))}
            </Card>
          )}
        </>
      )}

      {board && board.graduationQueue.length > 0 && (
        <View style={{ gap: space.sm }}>
          <SectionHeading action={<GraduationCap size={18} color={colour.forest800} />}>Graduating Players</SectionHeading>
          <Text style={[type.caption, { color: colour.inkMuted }]}>Players from a graduated cohort wait here until you place them on a team or record that they've left the club.</Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {board.graduationQueue.map((g, i) => (
              <View key={g.id} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{g.playerName}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Previous team: {g.previousTeamName}</Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Place on a Team" onPress={() => place(g)} disabled={!board.capabilities.place} style={{ flex: 2 }} />
                  <Button label="Left the Club" variant="secondary" onPress={() => left(g)} disabled={!board.capabilities.place} style={{ flex: 1 }} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      <PlacementSheet ask={placementAsk} onClose={() => setPlacementAsk(null)} onChanged={() => void reload()} errorMessage={problem} />
      <GraduationSheet ask={graduationAsk} onClose={() => setGraduationAsk(null)} errorMessage={(cause) => handoverProblem(cause, "this player")} />
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void reload()} errorMessage={problem} />
    </AdminScreen>
  )
}

const TONE: Record<PlayerStatusTone, { bg: string; fg: string }> = {
  positive: { bg: colour.successSurface, fg: colour.forest800 },
  caution: { bg: colour.warningSurface, fg: colour.warning },
  neutral: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted },
  negative: { bg: colour.dangerSurface, fg: colour.danger },
}

function PlayerRow({ row, first, open, onToggle, onChange, onRunTeam, onUndo, canPlace, canPrepare }: { row: PlayerProposalRow; first: boolean; open: boolean; onToggle: () => void; onChange: () => void; onRunTeam: () => void; onUndo: () => void; canPlace: boolean; canPrepare: boolean }) {
  const label = playerStatusLabel(row)
  const tone = TONE[playerStatusTone(row)]
  const selected = selectedPlacementText(row)
  const firstName = row.playerName.split(" ")[0]

  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${row.playerName}. ${row.currentTeamName} to ${selected.text}. ${label}`} onPress={onToggle} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{row.playerName}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {row.currentTeamName} → {selected.text}
            {selected.planned ? " (planned)" : ""}
          </Text>
        </View>
        <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
          <Text style={[type.caption, { color: tone.fg }]}>{label}</Text>
        </View>
        {open ? <ChevronDown size={17} color={colour.inkSubtle} /> : <ChevronRight size={17} color={colour.inkSubtle} />}
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
          <View style={{ gap: 2 }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Normal next: {row.normalPlacementName ?? "Not available"}</Text>
            {row.regulatoryAgeLabel && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {row.regulatoryAgeLabel} is {firstName}'s age group for this season.
              </Text>
            )}
          </View>
          {/* Once the handover has run the stored reason is in the wrong tense, so the applied row states what happened instead. */}
          {row.placementApplied ? (
            <Text style={[type.small, { color: colour.ink }]}>
              {firstName} was placed in {row.selectedPlacementName ?? row.plannedTeamName ?? row.normalPlacementName ?? "their new team"} by this handover.
            </Text>
          ) : (
            !!row.reason && <Text style={[type.small, { color: colour.ink }]}>{row.reason}</Text>
          )}
          {!row.placementApplied && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <Button label="Change Placement" variant="secondary" onPress={onChange} disabled={!canPlace} />
              {row.normalTeamMissing && !row.plannedTeamName && <Button label="Run This Team Next Season" variant="secondary" onPress={onRunTeam} disabled={!canPrepare} />}
              {row.placementChosen && <Button label="Undo This Choice" variant="quiet" onPress={onUndo} disabled={!canPlace} />}
            </View>
          )}
        </View>
      )}
    </View>
  )
}
