import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  allocateFixtureOnPitch,
  clearFixturePitch,
  createAllocationProposal,
  discardAllocationProposal,
  getPitchAllocationBoard,
  nextHomeFixtureDate,
  pitchSuitable,
  readAllocationProposal,
  readPitchAllocationCapabilities,
  type AllocationFixture,
  type PitchAllocationBoard,
  type PitchAllocationCapabilities,
  type PitchOption,
  type ProposalItemView,
} from "@ovalball/contracts/pitch-allocation"
import { readClubVenues, type ClubVenue } from "@ovalball/contracts/club/venues"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, SectionHeading, StatusPill } from "../../../../src/components/ui"
import { ChevronLeft, ChevronRight, Settings2, TriangleAlert, X } from "../../../../src/components/icons"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { exactDate } from "../../../../src/agenda/presentation"
import { applyPending, groupByVenue, isValidTime, minutesToTime, pitchCards, previewPlacement, shiftDate, summarise, timeLabel, todayIso, trayReason, type PendingChange, type PitchCard, type PitchItem } from "../../../../src/pitch-allocation/model"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PITCH ALLOCATION ON THE PHONE (CA-M11.1) -- the website's board, one pitch at a time.
 *
 * The website lays a day out as a grid: pitches down, time across, cards dragged into place. A phone
 * has no room for that and no need of it. Here a day is a date at the top, the grounds as a filter,
 * each pitch as a card listing what is on it in time order (with warm-up and pack-up shown), and the
 * fixtures still needing a pitch in a tray underneath with the website's own reason for each.
 *
 * SAME OUTCOMES. Tap a fixture to MOVE it (a pitch and a kick-off time), to take it OFF its pitch, or
 * to open it. Moves are STAGED, not saved, exactly as the website stages them: badges recompute from
 * the same conflict detectors against the draft, and Save Changes sends one write per fixture through
 * the same atomic RPC -- so a fixture moved five times reaches the opposition once. Auto Allocate and
 * Recalculate All build the same proposal the website builds, reviewed in a sheet and staged, never
 * applied behind your back. A kick-off change on a shared fixture is PROPOSED to the other club, and
 * the board says so.
 *
 * SAME AUTHORITY. `venue.pitch_allocation.view` opens the board read-only; `.manage` draws the
 * controls. Neither is inferred from fixture edit, result recording or a role, and the server decides
 * every save regardless.
 */
export default function PitchAllocationScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const navigation = useNavigation()
  const { session } = useSession()
  const { clubId } = useAdminCentreAccess()
  const [dateIso, setDateIso] = useState<string | null>(null)
  const [board, setBoard] = useState<PitchAllocationBoard | null>(null)
  const [venues, setVenues] = useState<ClubVenue[]>([])
  const [caps, setCaps] = useState<PitchAllocationCapabilities>({ view: false, manage: false })
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [venueFilter, setVenueFilter] = useState<string | "all">("all")
  const [pending, setPending] = useState<Map<string, PendingChange>>(new Map())
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [moving, setMoving] = useState<AllocationFixture | null>(null)
  const [acting, setActing] = useState<AllocationFixture | null>(null)
  const [proposal, setProposal] = useState<{ id: string; items: ProposalItemView[] } | null>(null)
  const [leaveAsk, setLeaveAsk] = useState<(() => void) | null>(null)
  const autoTriggeredFor = useRef<string | null>(null)

  const load = useCallback(
    async (date: string | null) => {
      if (!clubId) return
      setError(null)
      try {
        const allowed = await readPitchAllocationCapabilities(supabase, clubId)
        setCaps(allowed)
        setCapsLoaded(true)
        if (!allowed.view && !allowed.manage) {
          setBoard(null)
          return
        }
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
    },
    [clubId]
  )

  useEffect(() => {
    setBoard(null)
    setPending(new Map())
    void load(null)
  }, [load])

  useFocusEffect(
    useCallback(() => {
      if (dateIso) void load(dateIso)
    }, [load, dateIso])
  )

  const isDirty = pending.size > 0

  // THE UNSAVED-CHANGES GUARD, as the website's: leaving with staged moves asks first.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!isDirty) return
      event.preventDefault()
      setLeaveAsk(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, isDirty])

  const draft = useMemo(() => (board ? applyPending(board, pending) : null), [board, pending])
  const cards = useMemo(() => (draft ? pitchCards(draft) : []), [draft])
  const summary = useMemo(() => (draft ? summarise(draft) : null), [draft])
  const groups = useMemo(() => groupByVenue(cards), [cards])
  const venueName = (id: string | null) => (id ? venues.find((v) => v.id === id)?.name ?? "Ground" : "No ground yet")
  const visibleGroups = venueFilter === "all" ? groups : groups.filter((g) => g.venueId === venueFilter)

  // THE WEBSITE'S AUTO-PROPOSAL ON OPEN: only when the club switched it on, only once per day viewed.
  useEffect(() => {
    if (!board || !dateIso || !caps.manage || !clubId || !session?.user) return
    if (!board.policy.autoAllocateHomeFixtures || board.unallocated.length === 0 || proposal || isDirty) return
    if (autoTriggeredFor.current === dateIso) return
    autoTriggeredFor.current = dateIso
    void propose(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, dateIso, caps.manage])

  function navigateTo(day: string) {
    const go = () => {
      setPending(new Map())
      setProposal(null)
      setNotice(null)
      setBoard(null)
      void load(day)
    }
    if (isDirty) setLeaveAsk(() => go)
    else go()
  }

  function stage(fixtureId: string, pitchId: string, kickoffTime: string) {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(fixtureId, { pitchId, kickoffTime })
      return next
    })
    setNotice("Staged. Press Save Changes to apply.")
  }

  async function saveChanges() {
    if (!clubId || pending.size === 0) return
    setBusy("save")
    setNotice(null)
    let saved = 0
    let proposed = 0
    const failures: string[] = []
    const remaining = new Map(pending)
    for (const [fixtureId, change] of pending) {
      const result = await allocateFixtureOnPitch(supabase, clubId, fixtureId, { pitchId: change.pitchId, kickoffTime: change.kickoffTime ?? undefined })
      if (result.ok) {
        saved += 1
        if (result.kickoffProposed) proposed += 1
        remaining.delete(fixtureId)
      } else {
        failures.push(friendly(new Error(result.error), "this fixture").message)
      }
    }
    setPending(remaining)
    setBusy(null)
    await load(dateIso)
    if (failures.length > 0) setNotice(`${saved} change${saved === 1 ? "" : "s"} saved. ${failures.length} could not be saved: ${failures[0]}`)
    else setNotice(proposed > 0 ? `Saved. ${proposed} kick-off change${proposed === 1 ? "" : "s"} sent to the opposing club for confirmation.` : "Saved.")
  }

  function discardChanges() {
    setPending(new Map())
    setNotice(null)
  }

  async function clearPitch(fixture: AllocationFixture) {
    setActing(null)
    setBusy(fixture.fixtureId)
    const result = await clearFixturePitch(supabase, fixture.fixtureId)
    setBusy(null)
    if (!result.ok) {
      setNotice(friendly(new Error(result.error), "this fixture").message)
      return
    }
    setPending((prev) => {
      const next = new Map(prev)
      next.delete(fixture.fixtureId)
      return next
    })
    await load(dateIso)
    setNotice("Pitch cleared.")
  }

  async function propose(recalculateAll: boolean) {
    if (!clubId || !dateIso || !session?.user) return
    setBusy("propose")
    setNotice(null)
    const result = await createAllocationProposal(supabase, clubId, dateIso, session.user.id, recalculateAll)
    if (!result.ok || !result.proposalId) {
      setBusy(null)
      setNotice(friendly(new Error(result.error ?? "Could not build a proposal."), "a proposal").message)
      return
    }
    try {
      const items = await readAllocationProposal(supabase, result.proposalId)
      setProposal({ id: result.proposalId, items })
    } catch (cause) {
      setNotice(friendly(cause, "the proposal").message)
    } finally {
      setBusy(null)
    }
  }

  async function stageProposal() {
    if (!proposal || !clubId) return
    const eligible = proposal.items.filter((it) => !it.isUnallocated && it.conflictSeverity !== "hard" && it.proposedPitchId && it.proposedKickoffTime)
    setPending((prev) => {
      const next = new Map(prev)
      for (const it of eligible) next.set(it.fixtureId, { pitchId: it.proposedPitchId, kickoffTime: it.proposedKickoffTime })
      return next
    })
    await discardAllocationProposal(supabase, clubId, proposal.id)
    setProposal(null)
    setNotice(`${eligible.length} placement${eligible.length === 1 ? "" : "s"} staged. Press Save Changes to apply.`)
  }

  async function dismissProposal() {
    if (!proposal || !clubId) return
    await discardAllocationProposal(supabase, clubId, proposal.id)
    setProposal(null)
  }

  const refresh = async () => {
    setRefreshing(true)
    await load(dateIso)
    setRefreshing(false)
  }

  const noAccess = capsLoaded && !caps.view && !caps.manage

  return (
    <AdminScreen section="Pitch Allocation" refreshing={refreshing} onRefresh={refresh}>
      {noAccess && <EmptyState title="Pitch allocation is not part of your job here" body="Deciding which side plays on which pitch is given to specific people by the club." />}
      {error && <ErrorState message={error} onRetry={() => void load(dateIso)} />}
      {!error && !noAccess && !draft && <CardSkeleton lines={3} />}

      {draft && dateIso && summary && (
        <>
          {/* THE DAY */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <DayArrow label="Previous day" onPress={() => navigateTo(shiftDate(dateIso, -1))} glyph={<ChevronLeft size={20} color={colour.ink} />} />
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{exactDate(dateIso)}</Text>
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: 2 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Today" onPress={() => navigateTo(todayIso())} hitSlop={8}>
                  <Text style={[type.caption, { color: colour.forest800, textDecorationLine: "underline" }]}>Today</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Next home fixture" onPress={() => void nextHomeFixtureDate(supabase, clubId!, shiftDate(dateIso, 1)).then(navigateTo)} hitSlop={8}>
                  <Text style={[type.caption, { color: colour.forest800, textDecorationLine: "underline" }]}>Next home fixture</Text>
                </Pressable>
              </View>
            </View>
            <DayArrow label="Next day" onPress={() => navigateTo(shiftDate(dateIso, 1))} glyph={<ChevronRight size={20} color={colour.ink} />} />
          </View>

          {/* THE SUMMARY STRIP -- the website's four numbers */}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Stat value={summary.total} label="Home fixtures" />
            <Stat value={summary.allocated} label="Allocated" />
            <Stat value={summary.needsAttention} label="Need attention" tone={summary.needsAttention > 0 ? "caution" : "neutral"} />
            <Stat value={summary.activePitches} label="Active pitches" />
          </View>

          {notice && (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: /could not|couldn't|not/i.test(notice) && !/Staged|Saved|staged|cleared/.test(notice) ? colour.danger : colour.forest800 }]}>
              {notice}
            </Text>
          )}

          {/* THE CONTROLS -- drawn only for the manage key; the server refuses regardless. */}
          {caps.manage && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <Button label="Auto Allocate" variant="secondary" onPress={() => void propose(false)} busy={busy === "propose"} disabled={isDirty || draft.unallocated.length === 0} />
              <Button label="Recalculate All" variant="secondary" onPress={() => void propose(true)} busy={busy === "propose"} disabled={isDirty || summary.total === 0} />
              <Button label="Settings" variant="quiet" onPress={() => router.push("/admin/pitch-allocation/settings" as never)} />
            </View>
          )}
          {isDirty && (
            <Card style={{ borderColor: colour.pitch600, gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{pending.size} staged change{pending.size === 1 ? "" : "s"} — nothing is saved yet.</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label={`Save Changes (${pending.size})`} onPress={() => void saveChanges()} busy={busy === "save"} style={{ flex: 1 }} />
                <Button label="Discard" variant="secondary" onPress={discardChanges} disabled={busy === "save"} />
              </View>
            </Card>
          )}

          {/* TOURNAMENTS TODAY */}
          {draft.tournaments.length > 0 && (
            <Card style={{ backgroundColor: colour.warningSurface, borderColor: colour.warning, gap: 4 }}>
              {Array.from(new Map(draft.tournaments.map((t) => [t.tournamentId, t])).values()).map((t) => (
                <Text key={t.tournamentId} style={[type.small, { color: colour.ink }]}>
                  {t.tournamentName}: {draft.tournaments.filter((x) => x.tournamentId === t.tournamentId).map((x) => `${x.pitchDisplayName ?? "a pitch"} ${timeLabel(x.startTime)}–${timeLabel(x.endTime)}`).join(", ")} — held for the tournament.
                </Text>
              ))}
            </Card>
          )}

          {/* THE TRAY: fixtures still needing a pitch, each with the website's reason */}
          <SectionHeading>{`Needs a pitch (${draft.unallocated.length})`}</SectionHeading>
          {draft.unallocated.length === 0 ? (
            <Text style={[type.small, { color: colour.inkMuted }]}>Every home fixture on this day has a pitch and a kick-off.</Text>
          ) : (
            draft.unallocated.map((f) => (
              <Card key={f.fixtureId} style={{ gap: 4 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{f.homeTeamLabel} v {f.opponentLabel}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{trayReason(f, draft.pitches)}{f.kickoffTime ? ` · Kick-off ${timeLabel(f.kickoffTime)}` : ""}</Text>
                {caps.manage && <Button label="Choose a Pitch" variant="secondary" onPress={() => setMoving(f)} style={{ marginTop: space.xs }} />}
              </Card>
            ))
          )}

          {/* THE GROUNDS */}
          {groups.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              <Chip label="All grounds" selected={venueFilter === "all"} onPress={() => setVenueFilter("all")} />
              {groups.map((g) => (
                <Chip key={g.venueId ?? "none"} label={venueName(g.venueId)} selected={venueFilter === (g.venueId ?? "none")} onPress={() => setVenueFilter(g.venueId ?? "none")} />
              ))}
            </ScrollView>
          )}

          {/* THE PITCHES */}
          {visibleGroups.map((g) => (
            <View key={g.venueId ?? "none"} style={{ gap: space.md }}>
              <SectionHeading>{venueName(g.venueId)}</SectionHeading>
              {g.pitches.map((card) => (
                <PitchCardView key={card.pitch.id} card={card} canManage={caps.manage} busyId={busy} onFixture={(f) => setActing(f)} onTraining={(id) => router.push({ pathname: "/calendar/training/[sessionId]", params: { sessionId: id } } as never)} />
              ))}
            </View>
          ))}
          {cards.length === 0 && <EmptyState title="No pitches yet" body="Add pitches to a ground under Grounds & Pitches, then allocate fixtures to them here." />}
        </>
      )}

      {/* A FIXTURE'S ACTIONS */}
      <Sheet visible={acting !== null} onClose={() => setActing(null)} title={acting ? `${acting.homeTeamLabel} v ${acting.opponentLabel}` : ""}>
        {acting && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {acting.kickoffTime ? `Kick-off ${timeLabel(acting.kickoffTime)}` : "No kick-off yet"}
              {acting.requiresOpponentAgreement ? " · a kick-off change is proposed to the other club, not applied" : ""}
            </Text>
            {caps.manage && <Button label="Move" onPress={() => { setMoving(acting); setActing(null) }} />}
            {caps.manage && acting.pitchId && <Button label="Clear Pitch" variant="secondary" onPress={() => void clearPitch(acting)} busy={busy === acting.fixtureId} />}
            <Button label="Open Fixture" variant="secondary" onPress={() => { setActing(null); router.push({ pathname: "/fixtures/[fixtureId]", params: { fixtureId: acting.fixtureId } } as never) }} />
          </View>
        )}
      </Sheet>

      {/* MOVE: a pitch and a time, staged */}
      {draft && moving && (
        <MoveSheet
          fixture={moving}
          board={draft}
          pending={pending}
          venueName={venueName}
          onClose={() => setMoving(null)}
          onStage={(pitchId, time) => { stage(moving.fixtureId, pitchId, time); setMoving(null) }}
        />
      )}

      {/* PROPOSAL REVIEW */}
      <Sheet visible={proposal !== null} onClose={() => void dismissProposal()} title="Proposed allocation">
        {proposal && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Review, then stage the placements that can go ahead. Nothing is saved until you press Save Changes.</Text>
            {proposal.items.map((it) => (
              <View key={it.fixtureId} style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm, gap: 2 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{it.homeTeamLabel} v {it.opponentLabel}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{it.isUnallocated ? "No suitable slot found" : `${it.proposedPitchName ?? "Pitch"} at ${timeLabel(it.proposedKickoffTime)}`}</Text>
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

      {/* LEAVE WITH STAGED CHANGES? */}
      <Sheet visible={leaveAsk !== null} onClose={() => setLeaveAsk(null)} title="Discard staged changes?">
        <Text style={[type.small, { color: colour.inkMuted }]}>You have {pending.size} staged change{pending.size === 1 ? "" : "s"} that have not been saved.</Text>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button label="Discard Changes and Leave" onPress={() => { const go = leaveAsk; setLeaveAsk(null); setPending(new Map()); go?.() }} />
          <Button label="Keep Editing" variant="secondary" onPress={() => setLeaveAsk(null)} />
        </View>
      </Sheet>
      <View style={{ height: insets.bottom }} />
    </AdminScreen>
  )
}

function DayArrow({ label, onPress, glyph }: { label: string; onPress: () => void; glyph: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: pressed ? colour.mint100 : "transparent" })}>
      {glyph}
    </Pressable>
  )
}

function Stat({ value, label, tone = "neutral" }: { value: number; label: string; tone?: "neutral" | "caution" }) {
  return (
    <View style={{ flex: 1, backgroundColor: colour.surface, borderRadius: radius.md, borderWidth: 1, borderColor: tone === "caution" ? colour.warning : colour.line, padding: space.sm, alignItems: "center" }}>
      <Text style={[type.heading, { color: colour.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]} numberOfLines={2}>{label}</Text>
    </View>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress} style={{ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? colour.forest800 : colour.line, backgroundColor: selected ? colour.forest800 : colour.surface, justifyContent: "center" }}>
      <Text style={[type.small, { color: selected ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

function PitchCardView({ card, canManage, busyId, onFixture, onTraining }: { card: PitchCard; canManage: boolean; busyId: string | null; onFixture: (f: AllocationFixture) => void; onTraining: (id: string) => void }) {
  const { pitch, items } = card
  return (
    <Card style={{ gap: space.sm, opacity: pitch.active ? 1 : 0.6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{pitch.displayName}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {pitch.sizeCategory ? `${pitch.sizeCategory} pitch` : "Size not set"}{pitch.laneCount > 1 ? ` · ${pitch.laneCount} at once` : ""}{pitch.active ? "" : " · inactive"}
          </Text>
        </View>
        {card.hardCount > 0 && <StatusPill label={`${card.hardCount} clash${card.hardCount === 1 ? "" : "es"}`} tone="caution" />}
        {card.hardCount === 0 && card.warningCount > 0 && <StatusPill label={`${card.warningCount} warning${card.warningCount === 1 ? "" : "s"}`} tone="caution" />}
      </View>
      {items.length === 0 && <Text style={[type.caption, { color: colour.inkSubtle }]}>Nothing on this pitch today.</Text>}
      {items.map((item) => (
        <ItemRow key={`${item.kind}:${item.kind === "fixture" ? item.fixture.fixtureId : item.id}`} item={item} canManage={canManage} busy={item.kind === "fixture" && busyId === item.fixture.fixtureId} onFixture={onFixture} onTraining={onTraining} />
      ))}
    </Card>
  )
}

function ItemRow({ item, canManage, busy, onFixture, onTraining }: { item: PitchItem; canManage: boolean; busy: boolean; onFixture: (f: AllocationFixture) => void; onTraining: (id: string) => void }) {
  const range = item.start !== null && item.end !== null ? `${minutesToTime(item.start)}–${minutesToTime(item.end)}` : "All day"
  if (item.kind === "fixture") {
    const severity = item.conflict?.severity ?? (item.trainingConflict ? "hard" : null)
    const reason = item.conflict?.reason ?? item.trainingConflict
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.fixture.homeTeamLabel} v ${item.fixture.opponentLabel}, kick-off ${timeLabel(item.fixture.kickoffTime)}${reason ? `, ${reason}` : ""}`}
        onPress={() => onFixture(item.fixture)}
        disabled={busy}
        style={({ pressed }) => ({ borderRadius: radius.md, borderWidth: 1, borderColor: severity === "hard" ? colour.danger : severity === "warning" ? colour.warning : colour.line, backgroundColor: severity === "hard" ? colour.dangerSurface : severity === "warning" ? colour.warningSurface : colour.mint100, padding: space.sm, gap: 2, opacity: pressed || busy ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={2}>{item.fixture.homeTeamLabel} v {item.fixture.opponentLabel}</Text>
          {canManage && <ChevronRight size={14} color={colour.inkSubtle} />}
        </View>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Kick-off {timeLabel(item.fixture.kickoffTime)} · pitch busy {range}
          {item.fixture.durationConfidence === "unresolved" ? " · duration estimated" : ""}
        </Text>
        {reason && (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <TriangleAlert size={14} color={severity === "hard" ? colour.danger : colour.warning} />
            <Text style={[type.caption, { color: severity === "hard" ? colour.danger : colour.warning, flex: 1 }]}>{reason}</Text>
          </View>
        )}
      </Pressable>
    )
  }
  if (item.kind === "training") {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.label} training, ${range}`} onPress={() => onTraining(item.id)} style={({ pressed }) => ({ borderRadius: radius.md, borderWidth: 1, borderColor: item.conflict ? colour.danger : colour.line, backgroundColor: "#e8eff7", padding: space.sm, gap: 2, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[type.small, { color: colour.ink }]}>{item.label} — training</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{range}</Text>
        {item.conflict && <Text style={[type.caption, { color: colour.danger }]}>{item.conflict}</Text>}
      </Pressable>
    )
  }
  if (item.kind === "event") {
    return (
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, gap: 2 }}>
        <Text style={[type.small, { color: colour.ink }]}>{item.label} — club event{item.isMultiDay ? " (several days)" : ""}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{range}</Text>
      </View>
    )
  }
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: item.conflict ? colour.danger : colour.warning, backgroundColor: colour.warningSurface, padding: space.sm, gap: 2 }}>
      <Text style={[type.small, { color: colour.ink }]}>{item.label} — tournament hold</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{range}{item.teamLabels.length > 0 ? ` · ${item.teamLabels.join(", ")}` : ""}</Text>
      {item.conflict && <Text style={[type.caption, { color: colour.danger }]}>{item.conflict}</Text>}
    </View>
  )
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]} numberOfLines={2}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/**
 * MOVE -- the website's Move dialog: active pitches only, a kick-off time, and the clash it would cause
 * computed from the same detectors against the draft before anything is staged.
 */
function MoveSheet({ fixture, board, pending, venueName, onClose, onStage }: { fixture: AllocationFixture; board: PitchAllocationBoard; pending: Map<string, PendingChange>; venueName: (id: string | null) => string; onClose: () => void; onStage: (pitchId: string, time: string) => void }) {
  const [pitchId, setPitchId] = useState<string | null>(fixture.pitchId)
  const [time, setTime] = useState<string>(fixture.kickoffTime ? fixture.kickoffTime.slice(0, 5) : "")
  const active = board.pitches.filter((p) => p.active)
  const suitable = (p: PitchOption) => pitchSuitable(p, fixture.requiredPitchSize)
  const ordered = [...active].sort((a, b) => Number(suitable(b)) - Number(suitable(a)))
  const preview = pitchId && isValidTime(time) ? previewPlacement(board, pending, fixture.fixtureId, pitchId, `${time}:00`) : null
  const ready = Boolean(pitchId) && isValidTime(time)
  return (
    <Sheet visible onClose={onClose} title={`${fixture.homeTeamLabel} v ${fixture.opponentLabel}`}>
      <View style={{ gap: space.md }}>
        <View style={{ gap: 6 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Kick-off Time</Text>
          <TextInput
            accessibilityLabel="Kick-off time"
            value={time}
            onChangeText={(v) => setTime(v.replace(/[^\d:]/g, "").slice(0, 5))}
            placeholder="14:00"
            placeholderTextColor={colour.inkSubtle}
            keyboardType="numbers-and-punctuation"
            style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, backgroundColor: colour.surface }]}
          />
          {fixture.requiresOpponentAgreement && time && fixture.kickoffTime && `${time}:00` !== fixture.kickoffTime && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>A new kick-off on this fixture is proposed to the other club for confirmation when you save.</Text>
          )}
        </View>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Pitch</Text>
        <View style={{ gap: space.xs }}>
          {ordered.map((p) => {
            const on = pitchId === p.id
            const ok = suitable(p)
            return (
              <Pressable
                key={p.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.displayName}, ${venueName(p.venueId)}${ok ? "" : ", too small for this age group"}`}
                onPress={() => setPitchId(p.id)}
                style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.line, backgroundColor: on ? colour.mint100 : colour.surface }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.small, { color: colour.ink }]}>{p.displayName}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{venueName(p.venueId)}{p.sizeCategory ? ` · ${p.sizeCategory}` : ""}{ok ? "" : " · too small for this age group"}</Text>
                </View>
              </Pressable>
            )
          })}
          {ordered.length === 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>No active pitches. Add one under Grounds & Pitches.</Text>}
        </View>
        {preview && (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <TriangleAlert size={14} color={preview.severity === "hard" ? colour.danger : colour.warning} />
            <Text style={[type.caption, { color: preview.severity === "hard" ? colour.danger : colour.warning, flex: 1 }]}>{preview.reason}</Text>
          </View>
        )}
        {ready && !preview && <Text style={[type.caption, { color: colour.forest800 }]}>No clash on this pitch at that time.</Text>}
        <Button label="Stage This Move" onPress={() => pitchId && onStage(pitchId, `${time}:00`)} disabled={!ready} />
      </View>
    </Sheet>
  )
}
