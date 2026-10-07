import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  CALL_UP_STATUS_LABEL,
  canOpenGuardiansPlayers,
  decideClubCallUp,
  guardiansPlayersErrorMessage,
  previewMovementEligibility,
  readClubPlayerMoves,
  requestCallUp,
  sameAgeGroup,
  type ClubCallUp,
  type ClubPlayerMoves,
  type MovementEligibilityPreview,
} from "@ovalball/contracts/club/guardians-players"
import { DISPENSATION_NOT_A_GRANT, DISPENSATION_REASON_MAX, requestDispensation } from "@ovalball/contracts/team/dispensation"

import { AdminScreen } from "../../../../src/admin/screen"
import { todayIso, useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { ChoiceChips, Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { exactDate } from "../../../../src/agenda/presentation"
import { ArrowRightLeft, ShieldCheck, TriangleAlert } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { DispensationRows } from "../../../../src/dispensation/register"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PLAYER MOVES -- the website's /club/player-moves, natively (CA-M11.1).
 *
 * A CALL-UP borrows a player from another of the club's sides for one fixture; the SOURCE team (or
 * the club) decides it. A DISPENSATION lets a child play outside their age grade for one team and one
 * season: it is the one workflow (20270742000000), asked for here with a reason and decided ONCE, on
 * its own record, by the club's Safeguarding Officer or a Club Admin -- never by the person who asked.
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
        <Text style={[type.body, { color: colour.inkMuted }]}>
          Borrow a player for a single fixture, or ask for a player to play outside their age grade this season. A dispensation is an exception the club's Safeguarding Officer or a Club Admin decides.
        </Text>
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
              Dispensations
            </Text>
          </View>
          <Text style={[type.small, { color: colour.inkMuted }]}>A child outside a team's age grade can only be placed there with an approved dispensation, for that team and season.</Text>
          {caps.dispensationRequest && <DispensationRequestForm data={data} onAsk={setAsk} onDone={(text) => { setNotice({ tone: "ok", text }); void load() }} />}
          <DispensationRows records={data.dispensations} emptyTitle="No dispensations yet" emptyBody="A request appears here the moment somebody asks for one." />
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

function DispensationRequestForm({ data, onAsk, onDone }: { data: ClubPlayerMoves; onAsk: (ask: ReasonAsk) => void; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [targetTeamId, setTargetTeamId] = useState<string | null>(null)
  const [playerKey, setPlayerKey] = useState<string | null>(null)
  const eligible = useMemo(() => data.players.filter((p) => p.currentTeamId !== targetTeamId), [data.players, targetTeamId])
  const selected = eligible.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ?? null
  const targetTeam = data.teams.find((t) => t.id === targetTeamId) ?? null

  // THE REASON IS THE REQUEST: asked in the one sheet, sent with the one operation the website uses. Asking
  // is never a grant, and the sheet says so before anything is sent.
  function ask() {
    if (!selected || !targetTeam) return
    const player = selected
    const team = targetTeam
    onAsk({
      title: `Request a dispensation for ${player.playerName}?`,
      body: `For ${team.label} this season. ${DISPENSATION_NOT_A_GRANT} The club's Safeguarding Officer or a Club Admin decides.`,
      confirmLabel: "Send Request",
      reason: "required",
      fieldLabel: `Why Should ${player.playerName.split(" ")[0]} Play for ${team.label}?`,
      placeholder: "The people who decide read this",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (reason) => {
        await requestDispensation(supabase, { playerId: player.playerId, teamId: team.id, reason, sourceTeamId: player.currentTeamId })
        setPlayerKey(null)
        setOpen(false)
        onDone(`Request sent for ${player.playerName}. ${DISPENSATION_NOT_A_GRANT}`)
      },
    })
  }

  if (!open) return <Button label="Request a Dispensation" variant="secondary" onPress={() => setOpen(true)} />

  return (
    <Card style={{ gap: space.md }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        Request a Dispensation
      </Text>
      <ChoiceChips label="Which team?" options={data.teams.map((t) => ({ key: t.id, label: t.label }))} value={targetTeamId} onChange={(id) => { setTargetTeamId(id); setPlayerKey(null) }} />
      {targetTeamId && <ChoiceChips label="Player" options={eligible.map((p) => ({ key: `${p.playerId}:${p.currentTeamId}`, label: `${p.playerName} (${p.currentTeamName})` }))} value={playerKey} onChange={setPlayerKey} />}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button label="Continue" disabled={!selected} onPress={ask} style={{ flex: 2 }} />
      </View>
    </Card>
  )
}
