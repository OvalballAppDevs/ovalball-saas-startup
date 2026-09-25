import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native"
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import DateTimePicker from "@react-native-community/datetimepicker"

import {
  allocateFixtureOnPitch,
  clearFixturePitch,
  createAllocationProposal,
  discardAllocationProposal,
  fixtureOccupiedWindow,
  getPitchAllocationBoard,
  nextHomeFixtureDate,
  readAllocationProposal,
  readPitchAllocationCapabilities,
  type AllocationFixture,
  type PitchAllocationBoard,
  type PitchAllocationCapabilities,
  type ProposalItemView,
} from "@ovalball/contracts/pitch-allocation"
import { readClubVenues, type ClubVenue } from "@ovalball/contracts/club/venues"

import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { useReduceMotion } from "../../../../src/a11y/reduce-motion"
import { ClubCrest } from "../../../../src/components/identity"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Ellipsis, LayoutGrid, Maximize2, Minimize2, RefreshCw, Save, Sparkles, TriangleAlert } from "../../../../src/components/icons"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { exactDate } from "../../../../src/agenda/presentation"
import { PitchBoard, type DragPreview } from "../../../../src/pitch-allocation/board"
import { FixtureDetailSheet, LeaveSheet, MoveSheet, Sheet } from "../../../../src/pitch-allocation/sheets"
import { minutesToTime, type BoardScale } from "../../../../src/pitch-allocation/geometry"
import { shiftDate, summarise, todayIso, trayReason } from "../../../../src/pitch-allocation/model"
import { draftBoard, fixtureById, isNoOp, placementPreview, savePayload, stageMove, stageRemoval, unstage, type StagedChanges } from "../../../../src/pitch-allocation/staging"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PITCH ALLOCATION (CA-M11.2) -- a purpose-built rugby operations tool for a phone.
 *
 * The board is the screen. Above it, only what an operator needs on a Saturday morning: the club, the
 * day and its four numbers; below it, the one loud control (Save Changes) and an overflow for the rest.
 * Everything a person does here stages a change against the same shared engine the website and the
 * server use; Save re-asks the server for authority and writes one canonical operation per fixture.
 */
export default function PitchAllocationScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const navigation = useNavigation()
  const { session } = useSession()
  const { club } = useAppContexts()
  const { clubId } = useAdminCentreAccess()
  const reduceMotion = useReduceMotion()
  const [dateIso, setDateIso] = useState<string | null>(null)
  const [board, setBoard] = useState<PitchAllocationBoard | null>(null)
  const [venues, setVenues] = useState<ClubVenue[]>([])
  const [caps, setCaps] = useState<PitchAllocationCapabilities>({ view: false, manage: false })
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<StagedChanges>(new Map())
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [scale, setScale] = useState<BoardScale>("comfortable")
  const [fullScreen, setFullScreen] = useState(false)
  const [detail, setDetail] = useState<AllocationFixture | null>(null)
  const [moving, setMoving] = useState<AllocationFixture | null>(null)
  const [actions, setActions] = useState(false)
  const [proposal, setProposal] = useState<{ id: string; items: ProposalItemView[]; recalculated: boolean } | null>(null)
  const [leave, setLeave] = useState<(() => void) | null>(null)
  const [datePicker, setDatePicker] = useState(false)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  // A KICK-OFF CHANGE ON A SHARED FIXTURE MAY BE A PROPOSAL, NOT A FACT (the server's own either-side
  // negotiation, unchanged by CA-M11.2): update_fixture_schedule can return kickoffProposed=true, meaning
  // the fixture's canonical kickoff_time was NOT moved -- only kickoff_amendment_proposed_* was. The board
  // always redraws from the refreshed canonical row, so it never shows a false confirmed time; this set
  // only adds the honest, session-local "still awaiting the other club" line to that same true state.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<Set<string>>(new Set())
  const autoTriggeredFor = useRef<string | null>(null)

  const load = useCallback(async (date: string | null) => {
    if (!clubId) return
    setError(null)
    try {
      const allowed = await readPitchAllocationCapabilities(supabase, clubId)
      setCaps(allowed)
      setCapsLoaded(true)
      if (!allowed.view && !allowed.manage) { setBoard(null); return }
      const day = date ?? (await nextHomeFixtureDate(supabase, clubId, todayIso()))
      const [next, grounds] = await Promise.all([getPitchAllocationBoard(supabase, clubId, day), readClubVenues(supabase, clubId)])
      setDateIso(day)
      setBoard(next)
      setVenues(grounds.venues)
    } catch (cause) {
      const failure = friendly(cause, "pitch allocation")
      logDetail("pitch-allocation", failure)
      setError(failure.message)
    }
  }, [clubId])

  useEffect(() => { setBoard(null); setPending(new Map()); void load(null) }, [load])
  useFocusEffect(useCallback(() => { if (dateIso && pending.size === 0) void load(dateIso) }, [load, dateIso, pending.size]))

  const isDirty = pending.size > 0
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!isDirty) return
      event.preventDefault()
      setLeave(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, isDirty])

  const draft = useMemo(() => (board ? draftBoard(board, pending) : null), [board, pending])
  const summary = useMemo(() => (draft ? summarise(draft) : null), [draft])
  const conflictCount = draft ? new Set([...draft.conflicts.map((c) => c.fixtureId), ...draft.fixtureConflictsFromTraining.map((c) => c.fixtureId)]).size : 0
  const pitchName = useCallback((id: string | null) => (id ? board?.pitches.find((p) => p.id === id)?.displayName ?? "Pitch" : null), [board])
  const venueName = useCallback((id: string | null) => (id ? venues.find((v) => v.id === id)?.name ?? "Ground" : "No ground yet"), [venues])
  const previewFor = useCallback((fixtureId: string, pitchId: string, minutes: number) => (board ? placementPreview(board, pending, fixtureId, pitchId, `${minutesToTime(minutes)}:00`) : null), [board, pending])

  const stage = useCallback((fixtureId: string, pitchId: string, minutes: number) => {
    if (!board) return
    const change = { pitchId, kickoffTime: `${minutesToTime(minutes)}:00` }
    setPending((prev) => (isNoOp(board, fixtureId, change) ? unstage(prev, fixtureId) : stageMove(prev, fixtureId, pitchId, change.kickoffTime)))
    setNotice({ text: "Staged. Press Save Changes to apply.", tone: "ok" })
  }, [board])

  // THE WEBSITE'S AUTO-PROPOSAL ON OPEN: only when the club switched it on, once per day viewed.
  useEffect(() => {
    if (!board || !dateIso || !caps.manage || !session?.user) return
    if (!board.policy.autoAllocateHomeFixtures || board.unallocated.length === 0 || proposal || isDirty) return
    if (autoTriggeredFor.current === dateIso) return
    autoTriggeredFor.current = dateIso
    void propose(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, dateIso, caps.manage])

  function navigateTo(day: string) {
    const go = () => { setPending(new Map()); setProposal(null); setNotice(null); setAwaitingConfirmation(new Set()); setBoard(null); void load(day) }
    if (isDirty) setLeave(() => go)
    else go()
  }

  async function saveChanges(): Promise<boolean> {
    if (!clubId || pending.size === 0 || !board) return false
    setBusy("save")
    setNotice(null)
    // AUTHORITY IS RE-ASKED BEFORE A SINGLE WRITE: a staged position is not a permission.
    const allowed = await readPitchAllocationCapabilities(supabase, clubId)
    setCaps(allowed)
    if (!allowed.manage) {
      setBusy(null)
      setPending(new Map())
      setNotice({ text: "Your pitch allocation access has changed, so nothing was saved. The board has been refreshed.", tone: "warn" })
      await load(dateIso)
      return false
    }
    let saved = 0, proposed = 0
    const failures: string[] = []
    const remaining = new Map(pending)
    const nowAwaiting = new Set<string>()
    for (const item of savePayload(pending)) {
      const { fixtureId } = item
      // ONE CANONICAL OPERATION PER FIXTURE: place through update_fixture_schedule, clear through update_fixture_pitch.
      const result = item.op === "place" ? await allocateFixtureOnPitch(supabase, clubId, fixtureId, { pitchId: item.pitchId, kickoffTime: item.kickoffTime }) : await clearFixturePitch(supabase, fixtureId)
      if (result.ok) {
        saved += 1
        if ("kickoffProposed" in result && result.kickoffProposed) { proposed += 1; nowAwaiting.add(fixtureId) }
        remaining.delete(fixtureId)
      } else {
        failures.push(friendly(new Error(result.error), "this fixture").message)
      }
    }
    setPending(remaining)
    setAwaitingConfirmation(nowAwaiting)
    setBusy(null)
    await load(dateIso)
    if (failures.length > 0) setNotice({ text: `${saved} change${saved === 1 ? "" : "s"} saved. ${failures.length} could not be saved and ${failures.length === 1 ? "stays" : "stay"} staged: ${failures[0]}`, tone: "warn" })
    else setNotice({ text: proposed > 0 ? `Saved. ${proposed} kick-off change${proposed === 1 ? "" : "s"} sent to the opposing club for confirmation.` : "Saved.", tone: "ok" })
    return failures.length === 0
  }

  function discardChanges() { setPending(new Map()); setNotice(null) }

  async function propose(recalculateAll: boolean) {
    if (!clubId || !dateIso || !session?.user) return
    setActions(false)
    setBusy("propose")
    setNotice(null)
    const result = await createAllocationProposal(supabase, clubId, dateIso, session.user.id, recalculateAll)
    if (!result.ok || !result.proposalId) { setBusy(null); setNotice({ text: friendly(new Error(result.error ?? "Could not build a proposal."), "a proposal").message, tone: "warn" }); return }
    try { setProposal({ id: result.proposalId, items: await readAllocationProposal(supabase, result.proposalId), recalculated: recalculateAll }) } catch (cause) { setNotice({ text: friendly(cause, "the proposal").message, tone: "warn" }) } finally { setBusy(null) }
  }
  async function stageProposal() {
    if (!proposal || !clubId) return
    const eligible = proposal.items.filter((it) => !it.isUnallocated && it.conflictSeverity !== "hard" && it.proposedPitchId && it.proposedKickoffTime)
    setPending((prev) => { let next = prev; for (const it of eligible) next = stageMove(next, it.fixtureId, it.proposedPitchId!, it.proposedKickoffTime!); return next })
    await discardAllocationProposal(supabase, clubId, proposal.id)
    setProposal(null)
    setNotice({ text: `${eligible.length} placement${eligible.length === 1 ? "" : "s"} staged. Press Save Changes to apply.`, tone: "ok" })
  }
  async function dismissProposal() { if (proposal && clubId) await discardAllocationProposal(supabase, clubId, proposal.id); setProposal(null) }

  const noAccess = capsLoaded && !caps.view && !caps.manage
  const stagedIds = useMemo(() => new Set(pending.keys()), [pending])
  const detailConflict = detail && draft ? (draft.conflicts.find((c) => c.fixtureId === detail.fixtureId) ?? (draft.fixtureConflictsFromTraining.find((c) => c.fixtureId === detail.fixtureId) ? { fixtureId: detail.fixtureId, severity: "hard" as const, reason: draft.fixtureConflictsFromTraining.find((c) => c.fixtureId === detail.fixtureId)!.reason } : null)) : null
  const detailSaved = detail && board ? fixtureById(board, detail.fixtureId) : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* THE TOP BAR: back, the club, the screen, full screen. Compact on purpose. */}
      <View style={{ paddingTop: insets.top + 4, paddingBottom: 4, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.dismissTo("/admin"))} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent" })}>
          <ChevronLeft size={24} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
        {!fullScreen && <ClubCrest clubName={club.name} url={club.crestUrl} size={28} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          {!fullScreen && <Text style={[type.caption, { color: colour.forest800, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>{club.name ?? "Admin Centre"}</Text>}
          <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>Pitch Allocation{fullScreen && dateIso ? ` · ${exactDate(dateIso)}` : ""}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={fullScreen ? "Leave full screen" : "Full screen board"} onPress={() => setFullScreen((v) => !v)} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          {fullScreen ? <Minimize2 size={20} color={colour.forest800} /> : <Maximize2 size={20} color={colour.forest800} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={() => setActions(true)} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <Ellipsis size={22} color={colour.forest800} />
        </Pressable>
      </View>

      {noAccess && <View style={{ padding: space.lg }}><EmptyState title="Pitch allocation is not part of your job here" body="Deciding which side plays on which pitch is given to specific people by the club." /></View>}
      {error && <View style={{ padding: space.lg }}><ErrorState message={error} onRetry={() => void load(dateIso)} /></View>}
      {!error && !noAccess && !draft && <View style={{ padding: space.lg }}><CardSkeleton lines={4} /></View>}

      {draft && dateIso && summary && (
        <>
          {/* THE DAY, in one line */}
          {!fullScreen && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => navigateTo(shiftDate(dateIso, -1))} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}><ChevronLeft size={20} color={colour.ink} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Choose a date, currently ${exactDate(dateIso)}`} onPress={() => setDatePicker(true)} style={{ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
                <Text style={[type.heading, { color: colour.ink }]}>{exactDate(dateIso)}</Text>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  {dateIso !== todayIso() && <Pressable accessibilityRole="button" accessibilityLabel="Today" onPress={() => navigateTo(todayIso())} hitSlop={8}><Text style={[type.caption, { color: colour.forest800, textDecorationLine: "underline" }]}>Today</Text></Pressable>}
                  <Pressable accessibilityRole="button" accessibilityLabel="Next home fixture" onPress={() => void nextHomeFixtureDate(supabase, clubId!, shiftDate(dateIso, 1)).then(navigateTo)} hitSlop={8}><Text style={[type.caption, { color: colour.forest800, textDecorationLine: "underline" }]}>Next home fixture</Text></Pressable>
                </View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => navigateTo(shiftDate(dateIso, 1))} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}><ChevronRight size={20} color={colour.ink} /></Pressable>
            </View>
          )}
          {/* BUG FOUND LIVE ON DEVICE: `display="inline"` renders a whole month grid PERMANENTLY IN
              THE PAGE FLOW, not as a dismissable overlay -- it pushed the entire board down by most of
              a screen, which was a real chunk of "the calendar is massive and doesn't fit on one page".
              A native picker belongs in a sheet the operator can dismiss, never inserted into the layout. */}
          <Sheet visible={datePicker && Platform.OS !== "web"} onClose={() => setDatePicker(false)} title="Choose a Date">
            <DateTimePicker value={new Date(`${dateIso}T12:00:00`)} mode="date" display="inline" onChange={(_e, next) => { setDatePicker(false); if (next) navigateTo(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`) }} />
          </Sheet>

          {/* THE FOUR NUMBERS, and the conflict count when there is one */}
          {!fullScreen && (
            <View accessible accessibilityLabel={`${summary.total} home fixtures, ${summary.allocated} allocated, ${summary.activePitches} active pitches${conflictCount > 0 ? `, ${conflictCount} clash${conflictCount === 1 ? "" : "es"}` : ""}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm }}>
              <Stat n={summary.total} label={summary.total === 1 ? "home fixture" : "home fixtures"} icon={CalendarDays} />
              <Stat n={summary.allocated} label="allocated" icon={CircleCheck} />
              <Stat n={summary.activePitches} label={summary.activePitches === 1 ? "active pitch" : "active pitches"} icon={LayoutGrid} />
              {conflictCount > 0 && <Stat n={conflictCount} label={conflictCount === 1 ? "clash" : "clashes"} icon={TriangleAlert} tone="warn" />}
              {conflictCount === 0 && draft.unallocated.length > 0 && <Stat n={draft.unallocated.length} label={draft.unallocated.length === 1 ? "unallocated" : "unallocated"} icon={TriangleAlert} tone="warn" />}
            </View>
          )}

          {/* THE DAY'S MAIN JOBS -- Auto Allocate and Recalculate All build a proposal to review;
              Save Changes is the one write. Given equal weight on the board itself, not hidden in an
              overflow menu, matching the reference design's own layout. */}
          {!fullScreen && caps.manage && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm }}>
              <ActionPill label="Auto Allocate" icon={Sparkles} onPress={() => void propose(false)} busy={busy === "propose"} disabled={isDirty || draft.unallocated.length === 0} />
              <ActionPill label="Recalculate All" icon={RefreshCw} onPress={() => void propose(true)} busy={busy === "propose"} disabled={isDirty || summary?.total === 0} />
              <ActionPill label={isDirty ? `Save Changes (${pending.size})` : "Save Changes"} icon={Save} solid onPress={() => void saveChanges()} busy={busy === "save"} disabled={!isDirty} />
            </View>
          )}

          {notice && (
            <Text accessibilityLiveRegion="polite" style={[type.caption, { color: notice.tone === "warn" ? colour.danger : colour.forest800, paddingHorizontal: space.md, paddingBottom: 4 }]}>{notice.text}</Text>
          )}

          {/* THE BOARD */}
          <View style={{ flex: 1 }}>
            <PitchBoard
              board={draft}
              scale={scale}
              canManage={caps.manage}
              reduceMotion={reduceMotion}
              staged={stagedIds}
              todayIso={todayIso()}
              dateIso={dateIso}
              onOpen={setDetail}
              onDrop={stage}
              previewFor={previewFor}
              onPreview={setDragPreview}
              reasonFor={(f) => trayReason(f, draft.pitches)}
            />
          </View>

          {/* THE DRAG STRIP: what letting go would mean, said before it happens */}
          {dragPreview && (() => {
            const f = fixtureById(draft, dragPreview.fixtureId)
            // THE SHARED ENGINE SAYS WHEN THE PITCH IS RESERVED; the strip only reads it back.
            const occupied = f && dragPreview.pitchId ? fixtureOccupiedWindow({ ...f, kickoffTime: minutesToTime(dragPreview.minutes) }, { warmUpMinutes: draft.policy.warmUpMinutes, packUpMinutes: draft.policy.packUpMinutes }) : null
            const w = occupied ? { kickoff: minutesToTime(dragPreview.minutes), warm: minutesToTime(occupied.start), end: minutesToTime(occupied.end) } : null
            const bad = dragPreview.conflict?.severity === "hard"
            return (
              <View accessibilityLiveRegion="polite" style={{ marginHorizontal: space.sm, marginBottom: 4, padding: space.sm, borderRadius: radius.md, backgroundColor: bad ? colour.dangerSurface : dragPreview.conflict ? colour.warningSurface : colour.forest950, borderWidth: 1, borderColor: bad ? colour.danger : dragPreview.conflict ? colour.warning : colour.forest950 }}>
                {dragPreview.pitchId && w ? (
                  <>
                    <Text style={[type.smallMedium, { color: bad || dragPreview.conflict ? colour.ink : colour.onForest }]}>{pitchName(dragPreview.pitchId)} · kick-off {w.kickoff}</Text>
                    <Text style={[type.caption, { color: bad || dragPreview.conflict ? colour.inkMuted : colour.onForestMuted }]}>Warm-up from {w.warm} · pitch clear at {w.end}</Text>
                    {dragPreview.conflict && (
                      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 2 }}>
                        <TriangleAlert size={14} color={bad ? colour.danger : colour.warning} />
                        <Text style={[type.caption, { color: bad ? colour.danger : colour.warning, flex: 1 }]}>{dragPreview.conflict.reason}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={[type.small, { color: colour.onForest }]}>Drag onto a pitch lane to place it. Let go elsewhere to cancel.</Text>
                )}
              </View>
            )
          })()}

          {/* Save Changes itself now lives in the action row above, alongside Auto Allocate and
              Recalculate All; this stays as the one reachable-with-a-thumb Discard, only while dirty. */}
          {caps.manage && isDirty && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
              <Button label="Discard Changes" variant="secondary" onPress={() => (pending.size > 1 ? setLeave(() => discardChanges) : discardChanges())} disabled={busy === "save"} style={{ flex: 1 }} />
            </View>
          )}
        </>
      )}

      {/* FIXTURE DETAIL */}
      <FixtureDetailSheet
        fixture={detail}
        board={draft ?? { fixtures: [], unallocated: [], pitches: [], policy: { weekdayEarliestKickoff: "18:00", weekendYouthEarliest: "09:00", weekendYouthLatest: "13:00", weekendSeniorEarliest: "13:00", weekendSeniorLatest: "17:30", turnaroundMinutes: 15, autoAllocateHomeFixtures: false, warmUpMinutes: 0, packUpMinutes: 0 }, conflicts: [], rugbyCode: null, tournaments: [], tournamentConflicts: [], trainingSessions: [], trainingConflicts: [], fixtureConflictsFromTraining: [], clubEvents: [], bufferSource: "platform" }}
        conflict={detailConflict}
        pitchName={detail ? pitchName(detail.pitchId) : null}
        staged={detail ? stagedIds.has(detail.fixtureId) : false}
        savedPosition={detailSaved ? { pitchName: pitchName(detailSaved.pitchId), kickoffTime: detailSaved.kickoffTime } : null}
        awaitingConfirmation={detail ? awaitingConfirmation.has(detail.fixtureId) : false}
        canManage={caps.manage}
        onClose={() => setDetail(null)}
        onMove={() => { setMoving(detail); setDetail(null) }}
        onRemove={() => { if (detail) { setPending((prev) => (board && !fixtureById(board, detail.fixtureId)?.pitchId ? unstage(prev, detail.fixtureId) : stageRemoval(prev, detail.fixtureId))); setNotice({ text: "Removal staged. Press Save Changes to apply.", tone: "ok" }) } setDetail(null) }}
        onUndo={() => { if (detail) setPending((prev) => unstage(prev, detail.fixtureId)); setDetail(null) }}
        onOpenFixture={() => { const id = detail?.fixtureId; setDetail(null); if (id) router.push({ pathname: "/fixtures/[fixtureId]", params: { fixtureId: id } } as never) }}
      />
      {draft && moving && (
        <MoveSheet fixture={moving} board={draft} pitchName={venueName} previewFor={previewFor} onClose={() => setMoving(null)} onStage={(pitchId, minutes) => { stage(moving.fixtureId, pitchId, minutes); setMoving(null) }} />
      )}

      {/* ACTIONS */}
      <Sheet visible={actions} onClose={() => setActions(false)} title="Board actions">
        <View style={{ gap: space.sm }}>
          {/* Auto Allocate and Recalculate All now live in the action row on the board itself, next
              to Save Changes -- this keeps only what belongs in a settings/overflow menu. */}
          {caps.manage && draft && (
            <>
              <Button label="Discard Changes" variant="secondary" onPress={() => { setActions(false); discardChanges() }} disabled={!isDirty} />
              <Button label="Allocation Settings" variant="secondary" onPress={() => { setActions(false); router.push("/admin/pitch-allocation/settings" as never) }} />
            </>
          )}
          <Button label={scale === "comfortable" ? "Compact Timeline" : "Comfortable Timeline"} variant="quiet" onPress={() => { setScale((s) => (s === "comfortable" ? "compact" : "comfortable")); setActions(false) }} accessibilityHint="Changes how much of the day fits across the screen; the times do not change" />
          <Button label={fullScreen ? "Leave Full Screen" : "Full Screen Board"} variant="quiet" onPress={() => { setFullScreen((v) => !v); setActions(false) }} />
        </View>
      </Sheet>

      {/* PROPOSAL REVIEW */}
      <Sheet visible={proposal !== null} onClose={() => void dismissProposal()} title={proposal?.recalculated ? "Proposed re-plan of the day" : "Proposed allocation"}>
        {proposal && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Review, then stage the placements that can go ahead. Nothing is saved until you press Save Changes.</Text>
            {proposal.items.map((it) => (
              <View key={it.fixtureId} style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm, gap: 2 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{it.homeTeamLabel} v {it.opponentLabel}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{it.isUnallocated ? "No suitable slot found" : `${it.proposedPitchName ?? "Pitch"} at ${(it.proposedKickoffTime ?? "").slice(0, 5)}`}</Text>
                {it.conflictReason && (
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                    <TriangleAlert size={14} color={it.conflictSeverity === "hard" ? colour.danger : colour.warning} />
                    <Text style={[type.caption, { color: it.conflictSeverity === "hard" ? colour.danger : colour.warning, flex: 1 }]}>{it.conflictReason}</Text>
                  </View>
                )}
              </View>
            ))}
            <Button label="Stage Eligible Placements" onPress={() => void stageProposal()} disabled={!proposal.items.some((it) => !it.isUnallocated && it.conflictSeverity !== "hard")} style={{ marginTop: space.sm }} />
            <Button label="Discard Proposal" variant="quiet" onPress={() => void dismissProposal()} />
          </View>
        )}
      </Sheet>

      <LeaveSheet visible={leave !== null} count={pending.size} onSave={async () => { const go = leave; setLeave(null); if (await saveChanges()) go?.() }} onDiscard={() => { const go = leave; setLeave(null); setPending(new Map()); go?.() }} onStay={() => setLeave(null)} />
    </View>
  )
}

function Stat({ n, label, icon: Icon, tone = "ok" }: { n: number; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; tone?: "ok" | "warn" }) {
  const fg = tone === "warn" ? colour.danger : colour.forest800
  return (
    <View style={{ flexGrow: 1, minWidth: 84, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: tone === "warn" ? colour.warning : colour.line, backgroundColor: tone === "warn" ? colour.warningSurface : colour.surface }}>
      <Icon size={18} color={fg} />
      <View>
        <Text style={[type.smallMedium, { color: fg, fontFamily: "Inter_700Bold" }]}>{n}</Text>
        <Text style={[type.caption, { color: tone === "warn" ? colour.danger : colour.inkMuted }]} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  )
}

/**
 * AN ACTION PILL -- Auto Allocate, Recalculate All and Save Changes, given the same visual weight
 * a Fixture Secretary would expect for the day's main jobs, without touching the shared Button
 * primitive every other screen in the app also uses (a Pitch-Allocation-local look, not a platform one).
 */
function ActionPill({ label, icon: Icon, onPress, busy, disabled, solid, style }: { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void; busy?: boolean; disabled?: boolean; solid?: boolean; style?: object }) {
  const inactive = disabled || busy
  const fg = solid ? colour.onForest : colour.forest800
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: inactive, busy: Boolean(busy) }} disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [{ flexGrow: solid ? 1 : 0, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: solid ? colour.forest800 : colour.lineStrong, backgroundColor: solid ? colour.forest800 : colour.surface, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon size={16} color={fg} />}
      <Text style={[type.smallMedium, { color: fg, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}
