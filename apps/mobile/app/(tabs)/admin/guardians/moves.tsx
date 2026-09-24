import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  CALL_UP_STATUS_LABEL,
  canOpenGuardiansPlayers,
  decideClubCallUp,
  decideDispensation,
  DISPENSATION_STATUS_LABEL,
  guardiansPlayersErrorMessage,
  previewMovementEligibility,
  readClubPlayerMoves,
  requestCallUp,
  requestDispensation,
  revokeDispensation,
  sameAgeGroup,
  type ClubCallUp,
  type ClubDispensation,
  type ClubPlayerMoves,
  type DispensationStage,
  type MovementEligibilityPreview,
} from "@ovalball/contracts/club/guardians-players"

import { AdminScreen } from "../../../../src/admin/screen"
import { todayIso, useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { ChoiceChips, Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { exactDate } from "../../../../src/agenda/presentation"
import { ArrowRightLeft, ShieldCheck, TriangleAlert } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PLAYER MOVES -- the website's /club/player-moves, natively (CA-M11.1).
 *
 * A CALL-UP borrows a player from another of the club's sides for one fixture; the SOURCE team (or
 * the club) decides it. A DISPENSATION is a longer-term move outside ordinary age-grade eligibility
 * for the canonical season, approved in stages -- source team, club, governing body -- none of which
 * can be skipped: each control appears only when the record is actually at that stage, and the final
 * stage only RECORDS a governing-body reference the club holds. Ovalball never grants that approval.
 *
 * The player picker offers players ordinarily eligible for the target side; a player from another
 * age grade sits behind an explicit disclosure and previews the real computed requirement before
 * anything is requested. Every action is judged again by the operation it calls; the season is the
 * register's, never a computed cutoff.
 */
export default function PlayerMoves() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps, refresh: refreshAccess } = useGuardiansPlayersAccess()
  const [data, setData] = useState<ClubPlayerMoves | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "warning"; text: string } | null>(null)
  const pending = usePendingIntent("guardians:moves")
  const generation = useRef(0)

  const anyCallUp = caps.callupRequest || caps.callupApprove
  const anyDispensation = caps.dispensationRequest || caps.dispensationApproveClub
  const may = canOpenGuardiansPlayers(caps) || anyCallUp || anyDispensation

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !(anyCallUp || anyDispensation)) return
    const gen = ++generation.current
    setError(null)
    try {
      const moves = await readClubPlayerMoves(supabase, clubId, caps, todayIso())
      if (gen === generation.current) setData(moves)
    } catch (cause) {
      const translated = friendly(cause, "player moves")
      logDetail("admin:guardians:moves", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, accessLoading, caps, anyCallUp, anyDispensation])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

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

  return (
    <AdminScreen section="Player Moves" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Player Moves
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Borrow a player for a single fixture, or move one onto a different side for the season. Both need the source team's consent first.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="Player moves are raised and decided by the people the club has given that job to." />}
      {may && !anyCallUp && !anyDispensation && !accessLoading && <EmptyState title="Not yours to decide" body="Raising or deciding a call-up or dispensation needs the club's fixture permissions." />}
      {notice && <Notice tone={notice.tone} text={notice.text} />}
      {(anyCallUp || anyDispensation) && error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {(anyCallUp || anyDispensation) && !error && data === null && <CardSkeleton lines={4} />}

      {data && anyCallUp && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <ArrowRightLeft size={18} color={colour.forest800} />
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Fixture Call-Ups
            </Text>
          </View>
          <Text style={[type.small, { color: colour.inkMuted }]}>Borrow a player from another side at this club for one fixture. The source team must approve before the player is eligible to play.</Text>
          {caps.callupRequest && <CallUpRequestForm data={data} onAsk={setAsk} onDone={(text) => { setNotice({ tone: "ok", text }); void load() }} />}
          {data.callUps.length === 0 ? (
            <EmptyState title="No call-ups yet" body="Requests between the club's sides appear here." />
          ) : (
            data.callUps.map((row) => <CallUpRow key={row.id} row={row} canApprove={caps.callupApprove} onDecide={(action) => decideCallUp(row, action)} />)
          )}
        </View>
      )}

      {data && anyDispensation && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <ShieldCheck size={18} color={colour.forest800} />
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Team Dispensations
            </Text>
          </View>
          <Text style={[type.small, { color: colour.inkMuted }]}>A longer-term move outside ordinary age-grade eligibility for {data.season?.name ?? "the current season"}. Ovalball records each approval stage; it never grants governing-body approval itself.</Text>
          {caps.dispensationRequest && !data.season && <Notice tone="warning" text="Needs attention: no season in the Seasons register covers today for this club's code, so a dispensation cannot be requested until Site Admin records one." />}
          {caps.dispensationRequest && data.season && <DispensationRequestForm data={data} seasonId={data.season.id} onAsk={setAsk} onDone={(text) => { setNotice({ tone: "ok", text }); void load() }} />}
          {data.dispensations.length === 0 ? (
            <EmptyState title="No dispensations yet" body="Requests for a season-long move appear here." />
          ) : (
            data.dispensations.map((row) => <DispensationRow key={row.id} row={row} canDecideClub={caps.dispensationApproveClub} onDecide={(stage, approve, ref) => decideStage(row, stage, approve, ref)} onRevoke={() => revoke(row)} />)
          )}
        </View>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => { void refreshAccess(); void load() }}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/guardians/moves" } } as never)
        }}
        errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this move").message)}
      />
    </AdminScreen>
  )

  function decideCallUp(row: ClubCallUp, action: "approve" | "reject" | "revoke") {
    const when = row.fixtureDate ? exactDate(row.fixtureDate) : "the date requested"
    const question: Omit<ReasonAsk, "onConfirm"> =
      action === "approve"
        ? { title: `Let ${row.playerName} play for ${row.targetTeamName}?`, body: `For the fixture on ${when}. Their parents or guardians are told.`, confirmLabel: "Approve", reason: "optional" }
        : action === "reject"
          ? { title: `Keep ${row.playerName} with ${row.sourceTeamName}?`, body: "The other side is told. A reason helps them plan.", confirmLabel: "Reject", destructive: true, reason: "optional" }
          : { title: `Revoke ${row.playerName}'s call-up?`, body: `They are no longer eligible to play for ${row.targetTeamName} on ${when}.`, confirmLabel: "Revoke", destructive: true, reason: "optional" }
    confirmThen(question, (reason) => decideClubCallUp(supabase, row.id, action, reason), action === "approve" ? "Call-up approved." : action === "reject" ? "Call-up rejected." : "Call-up revoked.")
  }

  function decideStage(row: ClubDispensation, stage: DispensationStage, approve: boolean, governingBodyReference: string | null) {
    const stageWord = stage === "source_team" ? "as the source team" : stage === "club" ? "as the club" : "the governing body's approval"
    const question: Omit<ReasonAsk, "onConfirm"> = approve
      ? { title: stage === "governing_body" ? `Record ${stageWord} for ${row.playerName}?` : `Approve ${row.playerName}'s dispensation ${stageWord}?`, body: stage === "governing_body" ? `Reference ${governingBodyReference ?? ""}. Ovalball records the approval the club holds; it does not grant it.` : `${row.sourceTeamName} to ${row.targetTeamName} for ${row.seasonName}. The next stage then waits.`, confirmLabel: stage === "governing_body" ? "Record Approval" : "Approve", reason: "none" }
      : { title: `Reject ${row.playerName}'s dispensation?`, body: "Any linked call-up is blocked. A reason is kept with the decision.", confirmLabel: "Reject", destructive: true, reason: "optional" }
    confirmThen(question, (reason) => decideDispensation(supabase, row.id, stage, approve, governingBodyReference, reason || null), approve ? "Dispensation stage recorded." : "Dispensation rejected.")
  }

  function revoke(row: ClubDispensation) {
    confirmThen({ title: `Revoke ${row.playerName}'s dispensation?`, body: "Any call-up relying on it is blocked. The reason is recorded.", confirmLabel: "Revoke", destructive: true, reason: "required" }, (reason) => revokeDispensation(supabase, row.id, reason), "Dispensation revoked.")
  }
}

// ---------------------------------------------------------------------------------------------------
// Raising a call-up
// ---------------------------------------------------------------------------------------------------

function CallUpRequestForm({ data, onAsk, onDone }: { data: ClubPlayerMoves; onAsk: (ask: ReasonAsk) => void; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [targetTeamId, setTargetTeamId] = useState<string | null>(null)
  const [fixtureId, setFixtureId] = useState<string | null>(null)
  const [playerKey, setPlayerKey] = useState<string | null>(null)
  const [showOtherAges, setShowOtherAges] = useState(false)
  const [eligibility, setEligibility] = useState("")
  const [preview, setPreview] = useState<{ key: string; data: MovementEligibilityPreview | null } | null>(null)

  const targetTeam = data.teams.find((t) => t.id === targetTeamId) ?? null
  const teamFixtures = useMemo(() => data.fixtures.filter((f) => f.owningTeamId === targetTeamId), [data.fixtures, targetTeamId])
  const others = useMemo(() => data.players.filter((p) => p.currentTeamId !== targetTeamId), [data.players, targetTeamId])
  const sameAge = useMemo(() => (targetTeam ? others.filter((p) => sameAgeGroup(p, targetTeam)) : []), [others, targetTeam])
  const otherAge = useMemo(() => (targetTeam ? others.filter((p) => !sameAgeGroup(p, targetTeam)) : []), [others, targetTeam])
  const selected = others.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ?? null
  const previewKey = selected && targetTeam && !sameAgeGroup(selected, targetTeam) ? `${selected.playerId}:${targetTeam.id}` : null
  const shown = preview?.key === previewKey ? preview.data : null
  const previewLoading = previewKey !== null && preview?.key !== previewKey

  useEffect(() => {
    if (!previewKey || !selected || !targetTeamId) return
    let live = true
    void previewMovementEligibility(supabase, selected.playerId, selected.currentTeamId, targetTeamId).then((result) => {
      if (live) setPreview({ key: previewKey, data: result })
    })
    return () => {
      live = false
    }
  }, [previewKey, selected, targetTeamId])

  function submit() {
    if (!targetTeam || !fixtureId || !selected || !eligibility.trim()) return
    const fixture = teamFixtures.find((f) => f.id === fixtureId)
    const needsApproval = shown?.requirement === "external_approval_required"
    const player = selected
    const team = targetTeam
    onAsk({
      title: `Request ${player.playerName} for ${team.label}?`,
      body: `${fixture ? `${exactDate(fixture.kickoffDate)} v ${fixture.opponentLabel}. ` : ""}${needsApproval ? `This needs an age-grade approval before ${player.currentTeamName} can decide it.` : `${player.currentTeamName} must approve it before kick-off.`}`,
      confirmLabel: needsApproval ? "Draft Request" : "Request Call-Up",
      reason: "none",
      onConfirm: async () => {
        await requestCallUp(supabase, { fixtureId, playerId: player.playerId, sourceTeamId: player.currentTeamId, targetTeamId: team.id, eligibilityRuleReference: eligibility })
        setEligibility("")
        setPlayerKey(null)
        setFixtureId(null)
        setOpen(false)
        onDone(needsApproval ? `Requested for ${player.playerName}. It waits for an age-grade approval before ${player.currentTeamName} decides.` : `Call-up requested for ${player.playerName}. ${player.currentTeamName} must approve it before kick-off.`)
      },
    })
  }

  if (!open) return <Button label="Request a Call-Up" variant="secondary" onPress={() => setOpen(true)} />

  return (
    <Card style={{ gap: space.md }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>REQUEST A CALL-UP</Text>
      <ChoiceChips label="Which side needs a player?" options={data.teams.map((t) => ({ key: t.id, label: t.label }))} value={targetTeamId} onChange={(id) => { setTargetTeamId(id); setFixtureId(null); setPlayerKey(null); setShowOtherAges(false) }} />
      {targetTeamId && <ChoiceChips label="Fixture" hint={teamFixtures.length === 0 ? "This side has no upcoming fixture." : undefined} options={teamFixtures.map((f) => ({ key: f.id, label: `${exactDate(f.kickoffDate)} v ${f.opponentLabel}` }))} value={fixtureId} onChange={setFixtureId} />}
      {targetTeamId && <ChoiceChips label="Player" hint="Players ordinarily eligible for this side's age grade." options={sameAge.map((p) => ({ key: `${p.playerId}:${p.currentTeamId}`, label: `${p.playerName} (${p.currentTeamName})` }))} value={sameAge.some((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ? playerKey : null} onChange={setPlayerKey} />}
      {targetTeamId && !showOtherAges && otherAge.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel="Need a player from another age group?" onPress={() => setShowOtherAges(true)} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Need a player from another age group?</Text>
        </Pressable>
      )}
      {showOtherAges && (
        <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.caption, { color: colour.warning }]}>Requests are limited to players normally eligible for this age grade. Picking someone from another age grade may need additional governing-body approval; Ovalball tells you exactly what is required.</Text>
          <ChoiceChips label="Player from another age group" options={otherAge.map((p) => ({ key: `${p.playerId}:${p.currentTeamId}`, label: `${p.playerName} (${p.currentTeamName})` }))} value={otherAge.some((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ? playerKey : null} onChange={setPlayerKey} />
        </View>
      )}
      {previewLoading && <Text style={[type.caption, { color: colour.inkMuted }]}>Checking eligibility...</Text>}
      {shown?.requirement === "not_permitted" && (
        <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
          <TriangleAlert size={18} color={colour.danger} />
          <Text style={[type.small, { color: colour.danger, flex: 1 }]}>{shown.reason}</Text>
        </View>
      )}
      {shown?.requirement === "external_approval_required" && (
        <View style={{ gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.smallMedium, { color: colour.warning }]}>Additional approval required</Text>
          <Text style={[type.small, { color: colour.warning }]}>{shown.reason}</Text>
          {shown.restrictions && <Text style={[type.smallMedium, { color: colour.warning }]}>Restriction on record: {shown.restrictions}</Text>}
          <Text style={[type.caption, { color: colour.warning }]}>Ovalball records {shown.governingBody ?? "the governing body's"} approval; it does not grant it. The request can be drafted now and waits for that approval before the source team decides it.</Text>
        </View>
      )}
      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Eligibility Rule Reference</Text>
        <TextInput accessibilityLabel="Eligibility rule reference" value={eligibility} onChangeText={setEligibility} placeholder='e.g. "RFU age-grade continuum" or "GOVERNING-BODY CONFIRMATION REQUIRED"' placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button label={shown?.requirement === "external_approval_required" ? "Draft Request" : "Request Call-Up"} disabled={!fixtureId || !selected || !eligibility.trim() || shown?.requirement === "not_permitted"} onPress={submit} style={{ flex: 2 }} />
      </View>
    </Card>
  )
}

function CallUpRow({ row, canApprove, onDecide }: { row: ClubCallUp; canApprove: boolean; onDecide: (action: "approve" | "reject" | "revoke") => void }) {
  const tone = row.status === "approved" ? "positive" : row.status === "requested" || row.status === "awaiting_eligibility" ? "caution" : "neutral"
  const may = canApprove && row.canDecide
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{row.playerName}</Text>
        <StatusPill label={CALL_UP_STATUS_LABEL[row.status]} tone={tone} />
      </View>
      <Text style={[type.small, { color: colour.ink }]}>
        {row.sourceTeamName} → {row.targetTeamName}
      </Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {row.fixtureDate ? exactDate(row.fixtureDate) : "Date to be confirmed"}
        {row.fixtureOpponent ? ` v ${row.fixtureOpponent}` : ""} · {row.eligibilityRuleReference}
      </Text>
      {row.status === "awaiting_eligibility" && <Text style={[type.caption, { color: colour.inkMuted }]}>Waiting on the club to record the required age-grade approval before this can be decided.</Text>}
      {may && row.status === "requested" && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Reject" variant="secondary" onPress={() => onDecide("reject")} style={{ flex: 1 }} />
          <Button label="Approve" onPress={() => onDecide("approve")} style={{ flex: 1 }} />
        </View>
      )}
      {may && row.status === "awaiting_eligibility" && <Button label="Withdraw" variant="secondary" onPress={() => onDecide("reject")} />}
      {may && row.status === "approved" && <Button label="Revoke" variant="quiet" onPress={() => onDecide("revoke")} />}
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------------
// Dispensations
// ---------------------------------------------------------------------------------------------------

function DispensationRequestForm({ data, seasonId, onAsk, onDone }: { data: ClubPlayerMoves; seasonId: string; onAsk: (ask: ReasonAsk) => void; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [targetTeamId, setTargetTeamId] = useState<string | null>(null)
  const [playerKey, setPlayerKey] = useState<string | null>(null)
  const [eligibility, setEligibility] = useState("")
  const eligible = useMemo(() => data.players.filter((p) => p.currentTeamId !== targetTeamId), [data.players, targetTeamId])
  const selected = eligible.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ?? null
  const targetTeam = data.teams.find((t) => t.id === targetTeamId) ?? null

  function submit() {
    if (!selected || !targetTeam || !eligibility.trim()) return
    const player = selected
    const team = targetTeam
    onAsk({
      title: `Request a dispensation for ${player.playerName}?`,
      body: `Onto ${team.label} for ${data.season?.name ?? "the season"}. ${player.currentTeamName} must approve first, then the club, then the governing body's approval is recorded.`,
      confirmLabel: "Request Dispensation",
      reason: "none",
      onConfirm: async () => {
        await requestDispensation(supabase, { playerId: player.playerId, sourceTeamId: player.currentTeamId, targetTeamId: team.id, seasonId, eligibilityRuleReference: eligibility })
        setEligibility("")
        setPlayerKey(null)
        setOpen(false)
        onDone(`Dispensation requested for ${player.playerName}. ${player.currentTeamName} must approve first.`)
      },
    })
  }

  if (!open) return <Button label="Request a Dispensation" variant="secondary" onPress={() => setOpen(true)} />

  return (
    <Card style={{ gap: space.md }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>REQUEST A DISPENSATION</Text>
      <ChoiceChips label="Onto which side?" options={data.teams.map((t) => ({ key: t.id, label: t.label }))} value={targetTeamId} onChange={(id) => { setTargetTeamId(id); setPlayerKey(null) }} />
      {targetTeamId && <ChoiceChips label="Player" options={eligible.map((p) => ({ key: `${p.playerId}:${p.currentTeamId}`, label: `${p.playerName} (${p.currentTeamName})` }))} value={playerKey} onChange={setPlayerKey} />}
      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Eligibility Rule Reference</Text>
        <TextInput accessibilityLabel="Eligibility rule reference" value={eligibility} onChangeText={setEligibility} placeholder='e.g. "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified' placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button label="Request Dispensation" disabled={!selected || !eligibility.trim()} onPress={submit} style={{ flex: 2 }} />
      </View>
    </Card>
  )
}

function DispensationRow({ row, canDecideClub, onDecide, onRevoke }: { row: ClubDispensation; canDecideClub: boolean; onDecide: (stage: DispensationStage, approve: boolean, governingBodyReference: string | null) => void; onRevoke: () => void }) {
  const [govRef, setGovRef] = useState("")
  const tone = row.status === "approved" ? "positive" : row.status.endsWith("approved") || row.status === "requested" ? "caution" : "neutral"
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{row.playerName}</Text>
        <StatusPill label={DISPENSATION_STATUS_LABEL[row.status]} tone={tone} />
      </View>
      <Text style={[type.small, { color: colour.ink }]}>
        {row.sourceTeamName} → {row.targetTeamName}
      </Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {row.seasonName} · {row.eligibilityRuleReference}
        {row.governingBodyReference ? ` · Ref: ${row.governingBodyReference}` : ""}
      </Text>
      {canDecideClub && row.canDecideSourceTeam && row.status === "requested" && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Reject" variant="secondary" onPress={() => onDecide("source_team", false, null)} style={{ flex: 1 }} />
          <Button label="Approve as Source Team" onPress={() => onDecide("source_team", true, null)} style={{ flex: 2 }} />
        </View>
      )}
      {canDecideClub && row.status === "source_team_approved" && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Reject" variant="secondary" onPress={() => onDecide("club", false, null)} style={{ flex: 1 }} />
          <Button label="Approve as Club" onPress={() => onDecide("club", true, null)} style={{ flex: 2 }} />
        </View>
      )}
      {canDecideClub && row.status === "club_approved" && (
        <View style={{ gap: space.sm }}>
          <TextInput accessibilityLabel="Governing-body reference" value={govRef} onChangeText={setGovRef} placeholder="Governing-body reference or certificate number" placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink }]} />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Reject" variant="secondary" onPress={() => onDecide("governing_body", false, null)} style={{ flex: 1 }} />
            <Button label="Record Governing-Body Approval" disabled={!govRef.trim()} onPress={() => onDecide("governing_body", true, govRef.trim())} style={{ flex: 2 }} />
          </View>
        </View>
      )}
      {canDecideClub && row.status === "approved" && <Button label="Revoke" variant="quiet" onPress={onRevoke} />}
    </Card>
  )
}
