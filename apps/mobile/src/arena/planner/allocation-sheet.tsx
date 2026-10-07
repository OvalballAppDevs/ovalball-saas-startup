import { useEffect, useMemo, useState } from "react"
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native"
import DateTimePicker from "@react-native-community/datetimepicker"

import { activityLabel, clock, toMinutes, type ArenaDay, type ArenaPitch, type ArenaRoom, type PreferencePurpose } from "@ovalball/contracts/arena"

import { Button } from "../../components/ui"
import { ChevronDown, ChevronUp, DoorOpen, Sparkles, TriangleAlert } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { Sheet } from "../../pitch-allocation/sheets"
import { longDate } from "../style"
import { plannedParts, type Allocatable, type PlanParts } from "./plan"
import { fixturePitchWindow, fixtureRoomWindow, pitchClash, pitchUnits, recommendRooms, recommendTrainingRoom, roomClash, trainingMinutes, trainingRoomWindow } from "./rules"
import type { DayPlanner } from "./use-day-planner"
import { boardOpponent } from "./words"

type Choice = { id: string; name: string; detail: string | null; rank: number | null; unavailable: { title: string; reason: string } | null; recommended: boolean }
type Side = "HOME" | "AWAY" | "OFFICIALS"
const SIDE_WORD: Record<Side, string> = { HOME: "Home", AWAY: "Away", OFFICIALS: "Officials" }

const sizeWord = (p: ArenaPitch) =>
  p.size === "full" ? "Full size" : p.size === "three_quarter" ? "¾ size" : p.size === "half" ? "Half size" : pitchUnits(p) >= 4 ? "Custom, full" : "Custom size"

/**
 * ALLOCATE, AS WORDS -- everything a drag does, without one, and read the way a person would say it: who and
 * when; the pitch (Ovalball's recommendation first); the changing rooms that go with it -- a match's home, away and
 * officials rooms, a session's own room when its team asked for one; the times. A time is chosen here only where
 * its owner lets Arena move it (`activity.time`); otherwise the sheet says where it is changed. Add to Plan puts the
 * whole thing in the day's plan beside anything dragged, and Save sends it to the server like any other change.
 */
export function AllocationSheet({ day, planner, activity: a, preferPitchId, onClose, onStaged }: {
  day: ArenaDay
  planner: DayPlanner
  activity: Allocatable | null
  /** A pitch the person started from (free time on it): chosen first, still checked like any other. */
  preferPitchId?: string | null
  onClose: () => void
  onStaged: (message: string) => void
}) {
  const fixture = a?.kind === "FIXTURE" ? a : null
  const session = a?.kind === "TRAINING" ? a : null
  const [kickoff, setKickoff] = useState<number | null>(null)
  const [venueId, setVenueId] = useState<string | null>(null)
  const [pitchId, setPitchId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Record<Side, string | null>>({ HOME: null, AWAY: null, OFFICIALS: null })
  const [roomNote, setRoomNote] = useState<string | null>(null)
  const [openSide, setOpenSide] = useState<Side | null>(null)
  const stacked = useWindowDimensions().fontScale > 1.35
  const [morePitches, setMorePitches] = useState(false)

  const teamId = a?.team?.id ?? null
  const rankIn = (purpose: PreferencePurpose, id: string) => {
    const i = planner.preferred(teamId, purpose).indexOf(id)
    return i === -1 ? null : i + 1
  }

  // Opening the sheet starts from where the plan has it (or the pitch the person came from).
  useEffect(() => {
    if (!a) return
    const p = plannedParts(planner.plan, a)
    const start = preferPitchId ? day.pitches.find((x) => x.id === preferPitchId) : p.pitchId ? day.pitches.find((x) => x.id === p.pitchId) : undefined
    const primary = day.venues.find((v) => v.isDefault)?.id ?? day.venues[0]?.id ?? null
    setKickoff(toMinutes(p.kickoff))
    setVenueId(start?.venueId ?? p.venueId ?? primary)
    setPitchId(start?.id ?? p.pitchId)
    setRooms({ HOME: p.homeRoomId, AWAY: p.awayRoomId, OFFICIALS: p.officialsRoomId })
    setRoomNote(null)
    setOpenSide(null)
    setMorePitches(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening the sheet, not every change to the plan
  }, [a?.id, preferPitchId])

  const venue = day.venues.find((v) => v.id === venueId) ?? null
  const meet = fixture ? toMinutes(fixture.meetTime) : null
  const roomWindow = (side: Side) => (fixture && kickoff !== null ? fixtureRoomWindow(kickoff, fixture.playMinutes, meet, side, day.policy)
    : session ? trainingRoomWindow(session, kickoff, day.policy) : null)

  // ------------------------------------------------------------------ pitches at the chosen venue
  const pitchChoices = useMemo(() => {
    if (!a || !venueId) return { open: [] as Choice[], closed: [] as Choice[] }
    const purpose: PreferencePurpose = a.kind === "FIXTURE" ? "MATCH_PITCH" : "TRAINING_PITCH"
    const here = day.pitches.filter((p) => p.active && p.venueId === venueId).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))
    const all: Choice[] = here.map((p) => {
      const clash = kickoff === null ? null : pitchClash(day, planner.draft, a, p.id, kickoff)
      const lanes = Math.max(1, p.lanes)
      return { id: p.id, name: p.name, detail: [sizeWord(p), lanes > 1 ? `${lanes} at once` : null].filter(Boolean).join(" · "), rank: rankIn(purpose, p.id), unavailable: clash ? clash.short : null, recommended: false }
    })
    const open = all.filter((c) => !c.unavailable).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99))
    if (open[0]) open[0] = { ...open[0], recommended: true }
    return { open, closed: all.filter((c) => !!c.unavailable) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, venueId, kickoff, planner.draft, planner.preferred, day.pitches])

  // ------------------------------------------------------------------ changing rooms at the chosen venue
  const teamRooms = useMemo(() => day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType !== "match_officials").sort((x, y) => x.sortOrder - y.sortOrder), [day.rooms, venueId])
  const officialsRooms = useMemo(() => day.rooms.filter((r) => r.venueId === venueId && r.active && r.roomType === "match_officials").sort((x, y) => x.sortOrder - y.sortOrder), [day.rooms, venueId])
  // A match's rooms where it plays; a session's one room only when its team asked for one.
  const roomsApply = venue?.changingRoomsAvailable !== false && teamRooms.length > 0
    && (fixture ? fixture.home && !fixture.noChangingRooms : !!session && (session.needsRoom || !!rooms.HOME))
  const sides: Side[] = session ? ["HOME"] : (["HOME", "AWAY", "OFFICIALS"] as Side[]).filter((side) => side === "HOME" || (side === "AWAY" ? teamRooms.length >= 2 || !!rooms.AWAY : officialsRooms.length > 0 || !!rooms.OFFICIALS))
  const sideWord = (side: Side) => (session ? "Room" : SIDE_WORD[side])
  const roomUnavailable = (r: ArenaRoom, side: Side): { title: string; reason: string } | null => {
    const other = (Object.entries(rooms) as [Side, string | null][]).find(([k, id]) => k !== side && id === r.id)
    if (other) return { title: `${r.name} chosen`, reason: other[0] === "HOME" ? "Chosen for the home side" : other[0] === "AWAY" ? "Chosen for the visitors" : "Chosen for the officials" }
    const w = roomWindow(side)
    return w && a ? roomClash(day, planner.draft, a.id, r.id, w)?.short ?? null : null
  }
  const recommended = useMemo(() => {
    if (!venueId || kickoff === null || !roomsApply) return null
    if (fixture) return recommendRooms(day, planner.draft, fixture, venueId, kickoff, { home: planner.preferred(teamId, "HOME_ROOM"), away: planner.preferred(teamId, "AWAY_ROOM") })
    if (session && session.needsRoom) {
      const rec = recommendTrainingRoom(day, planner.draft, session, venueId, kickoff, planner.preferred(teamId, "HOME_ROOM"))
      return { homeRoomId: rec.roomId, awayRoomId: null, note: rec.note }
    }
    return null
  }, [fixture, session, venueId, kickoff, roomsApply, day, planner, teamId])

  // ROOMS GO WITH THE PITCH: a move to another venue or time that leaves a chosen room elsewhere, or no longer
  // free, takes the recommended rooms instead -- and says so. A room the person picked that still works stays.
  useEffect(() => {
    if (!recommended) return
    const bad = (id: string | null, side: Side) => {
      if (!id) return side === "HOME" || (!session && side === "AWAY" && teamRooms.length >= 2)
      const r = day.rooms.find((x) => x.id === id)
      return !r || r.venueId !== venueId || !!roomUnavailable(r, side)
    }
    const next = { ...rooms }
    let moved = false
    if (bad(rooms.HOME, "HOME") && recommended.homeRoomId !== rooms.HOME) { next.HOME = recommended.homeRoomId; moved = true }
    if (bad(rooms.AWAY, "AWAY") && recommended.awayRoomId !== rooms.AWAY && recommended.awayRoomId !== next.HOME) { next.AWAY = recommended.awayRoomId; moved = true }
    if (rooms.OFFICIALS && day.rooms.find((x) => x.id === rooms.OFFICIALS)?.venueId !== venueId) { next.OFFICIALS = null; moved = true }
    if (moved) {
      setRooms(next)
      setRoomNote(recommended.note && (next.HOME || next.AWAY) ? "Changing rooms follow the pitch." : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when where or when changes
  }, [recommended])

  if (!a) return <Sheet visible={false} onClose={onClose} title="">{null}</Sheet>

  const saved = plannedParts(planner.plan, a)
  const pitchWindow = fixture && kickoff !== null ? fixturePitchWindow(kickoff, fixture.playMinutes, day.policy) : null
  const chosenPitch = [...pitchChoices.open, ...pitchChoices.closed].find((c) => c.id === pitchId) ?? null
  const roomBlock = roomsApply ? sides.map((side) => {
    const id = rooms[side]
    const r = id ? day.rooms.find((x) => x.id === id) : null
    const u = r ? roomUnavailable(r, side) : null
    return u ? `${u.title}: ${u.reason.toLowerCase()}.` : null
  }).find(Boolean) ?? null : null
  const blocker = kickoff === null ? (fixture ? "Choose a kick-off time first." : "This session has no time yet: set it in the Training Centre.")
    : !pitchId ? "Choose a pitch."
      : chosenPitch?.unavailable ? `${chosenPitch.unavailable.title}: ${chosenPitch.unavailable.reason.toLowerCase()}.`
        : roomBlock
  const parts: PlanParts = a.kind === "TRAINING"
    ? { pitchId, venueId: pitchId ? day.pitches.find((p) => p.id === pitchId)?.venueId ?? venueId : saved.venueId, kickoff: kickoff === null ? saved.kickoff : clock(kickoff), homeRoomId: rooms.HOME }
    : { venueId, pitchId, kickoff: kickoff === null ? null : clock(kickoff), homeRoomId: rooms.HOME, awayRoomId: rooms.AWAY, officialsRoomId: rooms.OFFICIALS }
  const changed = Object.entries(parts).some(([k, v]) => (saved as Record<string, unknown>)[k] !== v)
  const kickoffMoved = !!fixture && kickoff !== null && toMinutes(fixture.kickoff) !== kickoff
  const shownOpen = morePitches ? pitchChoices.open : pitchChoices.open.slice(0, 4)
  const roomName = (id: string | null) => (id ? day.rooms.find((r) => r.id === id)?.name ?? "Room" : null)

  function addToPlan() {
    if (!a || blocker) return
    const pitchName = pitchId ? day.pitches.find((p) => p.id === pitchId)?.name ?? "the pitch" : "no pitch"
    planner.setParts(a, parts, roomNote ? [roomNote] : [])
    onStaged(`${activityLabel(a)}: ${pitchName}${kickoff !== null ? ` at ${clock(kickoff)}` : ""} added to the plan.`)
  }

  const title = a.kind === "FIXTURE" ? a.team?.displayName ?? activityLabel(a) : `${a.team?.displayName ?? a.groupLabel ?? "Team"} Training`
  const when = a.kind === "FIXTURE" ? (kickoff !== null ? clock(kickoff) : "Kick-off not set") : kickoff !== null ? `${clock(kickoff)}–${clock(kickoff + trainingMinutes(a))}` : "No time yet"
  const timePicker = (label: string) => Platform.OS === "web" || !a.time.editable ? (
    <Text style={[type.bodyMedium, { color: colour.onForest }]}>{kickoff === null ? "Not set" : clock(kickoff)}</Text>
  ) : (
    <DateTimePicker
      value={(() => { const d = new Date(); const m = kickoff ?? 14 * 60; d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d })()}
      mode="time" minuteInterval={15} display={Platform.OS === "ios" ? "compact" : "default"} accessibilityLabel={label} themeVariant="dark"
      style={{ alignSelf: "flex-start", marginLeft: -8 }}
      onChange={(_e, next) => { if (next) setKickoff(Math.round((next.getHours() * 60 + next.getMinutes()) / 15) * 15) }} />
  )

  return (
    <Sheet visible onClose={onClose} title={title}>
      <View style={{ gap: space.lg }}>
        {/* WHO AND WHEN */}
        <View style={{ gap: 2 }}>
          {a.kind === "FIXTURE" && <Text accessibilityLabel={`versus ${a.opponentName}`} style={[type.body, { color: colour.ink }]}>{`v ${boardOpponent(a.opponentName)}`}</Text>}
          <Text style={[type.small, { color: colour.inkMuted }]}>{`${longDate(day.date).replace(",", "").replace(/ \d{4}$/, "")} · ${when}`}</Text>
        </View>

        {/* PITCH */}
        <Section title="Pitch">
          {day.venues.length > 1 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginBottom: space.xs }}>
              {day.venues.map((v) => {
                const on = v.id === venueId
                const rank = rankIn("VENUE", v.id)
                return (
                  <Pressable key={v.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${v.name}${rank ? `, preferred choice ${rank}` : ""}`}
                    onPress={() => { setVenueId(v.id); setMorePitches(false); if (pitchId && day.pitches.find((p) => p.id === pitchId)?.venueId !== v.id) setPitchId(null) }}
                    style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: on ? 2 : 1, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, opacity: pressed ? 0.85 : 1 })}>
                    <Text style={[type.smallMedium, { color: colour.forest800 }]}>{v.name}</Text>
                  </Pressable>
                )
              })}
            </View>
          )}
          {pitchChoices.open.length === 0 && pitchChoices.closed.length === 0 && (
            <Text style={[type.small, { color: colour.inkMuted }]}>{`${venue?.name ?? "This venue"} has no pitches switched on.`}</Text>
          )}
          {pitchChoices.open.length === 0 && pitchChoices.closed.length > 0 && (
            <Text style={[type.small, { color: colour.warning }]}>No pitch here is free then. Try another time or venue.</Text>
          )}
          {shownOpen.map((c) => <ChoiceRow key={c.id} choice={c} selected={pitchId === c.id} onPress={() => setPitchId(c.id)} />)}
          {!morePitches && pitchChoices.open.length > shownOpen.length && (
            <Fold label={`${pitchChoices.open.length - shownOpen.length} more available`} open={false} onPress={() => setMorePitches(true)} />
          )}
          <NotAvailable choices={pitchChoices.closed} selectedId={pitchId} noun={["pitch", "pitches"]} />
        </Section>

        {/* CHANGING ROOMS: one line a side, the room it has; open a side to change it */}
        {roomsApply && (
          <Section title="Changing Rooms">
            {sides.map((side) => {
              const list = side === "OFFICIALS" ? officialsRooms : teamRooms
              const purpose: PreferencePurpose = side === "HOME" ? "HOME_ROOM" : side === "AWAY" ? "AWAY_ROOM" : "OFFICIALS_ROOM"
              const rec = side === "HOME" ? recommended?.homeRoomId : side === "AWAY" ? recommended?.awayRoomId : null
              const choices: Choice[] = list.map((r) => ({ id: r.id, name: r.name, detail: r.roomType === "smaller" ? "Smaller room" : null, rank: rankIn(purpose, r.id), unavailable: roomUnavailable(r, side), recommended: r.id === rec }))
              const free = choices.filter((c) => !c.unavailable)
              const chosen = roomName(rooms[side])
              const open = openSide === side
              const none = !chosen && free.length === 0
              return (
                <View key={side} style={{ gap: space.xs }}>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${session ? "Changing room" : `${SIDE_WORD[side]} changing room`}: ${chosen ?? (none ? "none free then" : "not chosen")}. ${open ? "Hide the choices" : "Change"}`}
                    onPress={() => setOpenSide(open ? null : side)}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
                    <Text style={[type.small, { color: colour.inkMuted, width: 76 }]}>{sideWord(side)}</Text>
                    <Text style={[type.smallMedium, { color: chosen ? colour.ink : none ? colour.warning : colour.inkMuted, flex: 1 }]}>{chosen ?? (none ? "None free then" : side === "OFFICIALS" ? "None" : "Not chosen")}</Text>
                    {open ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
                  </Pressable>
                  {open && (
                    <View style={{ gap: space.xs, paddingLeft: space.md }}>
                      {free.map((c) => (
                        <ChoiceRow key={c.id} choice={c} selected={rooms[side] === c.id} onPress={() => { setRooms((prev) => ({ ...prev, [side]: c.id })); setRoomNote(null); setOpenSide(null) }} />
                      ))}
                      <NotAvailable choices={choices.filter((c) => !!c.unavailable)} selectedId={rooms[side]} noun={side === "OFFICIALS" ? ["room", "rooms"] : ["changing room", "changing rooms"]} />
                      <ChoiceRow choice={{ id: "none", name: side === "OFFICIALS" ? "No officials room" : side === "AWAY" ? "No away room" : session ? "No room yet" : "No changing room yet", detail: null, rank: null, unavailable: null, recommended: false }} plain
                        selected={rooms[side] === null} onPress={() => { setRooms((prev) => ({ ...prev, [side]: null })); setOpenSide(null) }} />
                    </View>
                  )}
                </View>
              )
            })}
            {roomNote && (
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <DoorOpen size={13} color={colour.forest800} />
                <Text style={[type.caption, { color: colour.forest800, flex: 1 }]}>{roomNote}</Text>
              </View>
            )}
          </Section>
        )}
        {fixture?.home && fixture.noChangingRooms && <Text style={[type.small, { color: colour.inkMuted }]}>Played without changing rooms.</Text>}
        {session && !roomsApply && (
          <Section title="Changing Room">
            <Text style={[type.small, { color: colour.inkMuted }]}>{session.needsRoom ? `${venue?.name ?? "This venue"} has no changing rooms to give.` : "No changing room asked for. A team asks for one in the Training Centre."}</Text>
          </Section>
        )}

        {/* TIMINGS */}
        <Section title="Timings">
          {fixture ? (
            <>
              {/* Side by side normally; one under another at large text sizes, so no word or time is ever broken. */}
              <View style={{ flexDirection: stacked ? "column" : "row", alignItems: "stretch", gap: space.xs }}>
                <Timing label="Warm-up" value={pitchWindow ? clock(pitchWindow.from) : "—"} stacked={stacked} />
                <View style={{ flex: stacked ? undefined : 1.3, minHeight: 60, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.forest800, justifyContent: "center", gap: 2, ...(stacked ? { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" } : null) }}>
                  <Text style={[type.caption, { color: colour.mint300 }]}>Kick-off</Text>
                  {timePicker("Kick-off time")}
                </View>
                <Timing label="Clear by" value={pitchWindow ? clock(pitchWindow.until) : "—"} stacked={stacked} />
              </View>
              {kickoff === null && fixture.time.editable && <Text style={[type.small, { color: colour.warning }]}>No kick-off yet. Choose one to place it on a pitch.</Text>}
              {!fixture.time.editable && fixture.time.reason && <Text style={[type.small, { color: colour.inkMuted }]}>{fixture.time.reason}</Text>}
              {kickoffMoved && fixture.requiresOpponentAgreement && (
                <Text style={[type.small, { color: colour.inkMuted }]}>{`${fixture.opponentName} is asked to agree the new kick-off. Until they do, it stays at ${fixture.kickoff ?? "its time"}.`}</Text>
              )}
            </>
          ) : session ? (
            <>
              <View style={{ flexDirection: stacked ? "column" : "row", alignItems: "stretch", gap: space.xs }}>
                <View style={{ flex: stacked ? undefined : 1.3, minHeight: 60, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.forest800, justifyContent: "center", gap: 2, ...(stacked ? { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" } : null) }}>
                  <Text style={[type.caption, { color: colour.mint300 }]}>Starts</Text>
                  {timePicker("Start time")}
                </View>
                <Timing label="Ends" value={kickoff !== null ? clock(kickoff + trainingMinutes(session)) : "—"} stacked={stacked} />
              </View>
              <Text style={[type.small, { color: colour.inkMuted }]}>{session.time.editable ? "Moving the start keeps the session's length. Save changes it in the Training Centre, and the team is told." : session.time.reason ?? ""}</Text>
            </>
          ) : null}
        </Section>

        {changed && blocker && (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", padding: space.sm, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
            <TriangleAlert size={14} color={colour.warning} />
            <Text style={[type.small, { color: colour.warning, flex: 1 }]}>{blocker}</Text>
          </View>
        )}
        <Button label="Add to Plan" onPress={addToPlan} disabled={!changed || !!blocker || !day.canManage} accessibilityHint="Adds this to the day's unsaved changes. Save sends them to Ovalball." />
        {!changed && day.canManage && <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>{session ? "Choose a different pitch, room or start time to add a change." : "Choose a different pitch, changing room or kick-off to add a change."}</Text>}
      </View>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.inkMuted, fontFamily: type.heading.fontFamily, fontSize: 13, lineHeight: 18 }]}>{title}</Text>
      {children}
    </View>
  )
}

function Timing({ label, value, stacked }: { label: string; value: string; stacked: boolean }) {
  return (
    <View style={{ flex: stacked ? undefined : 1, minHeight: 60, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.mint100, justifyContent: stacked ? "space-between" : "center", gap: 2, ...(stacked ? { flexDirection: "row", alignItems: "center", flexWrap: "wrap" } : null) }}>
      <Text style={[type.caption, { color: colour.forest800 }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: colour.forest800, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  )
}

function Fold({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: pressed ? colour.chalk : "transparent" })}>
      <Text style={[type.small, { color: colour.forest800, flex: 1, fontFamily: type.smallMedium.fontFamily }]}>{label}</Text>
      {open ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
    </Pressable>
  )
}

/**
 * WHAT IS NOT AVAILABLE THEN, folded into one line that opens to every reason -- so the choices that can be made
 * lead the sheet. One that is chosen but no longer works is always shown, with its reason, outside the fold.
 */
function NotAvailable({ choices, selectedId, noun }: { choices: Choice[]; selectedId: string | null; noun: [string, string] }) {
  const [open, setOpen] = useState(false)
  const chosen = choices.find((c) => c.id === selectedId) ?? null
  const rest = choices.filter((c) => c.id !== selectedId)
  return (
    <>
      {chosen && <ChoiceRow choice={chosen} selected onPress={() => undefined} />}
      {rest.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${rest.length} ${rest.length === 1 ? noun[0] : noun[1]} not available then. ${open ? "Hide" : "Show"} why`} onPress={() => setOpen((v) => !v)}
          style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: pressed ? colour.chalk : "transparent" })}>
          <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>{`${rest.length} ${rest.length === 1 ? noun[0] : noun[1]} not available then`}</Text>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{open ? "Hide" : "Why"}</Text>
          {open ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.forest800} />}
        </Pressable>
      )}
      {open && rest.map((c) => <ChoiceRow key={c.id} choice={c} selected={false} onPress={() => undefined} />)}
    </>
  )
}

/** One choice: a free one says whether it is recommended or preferred; a taken one says why, and cannot be picked. */
function ChoiceRow({ choice: c, selected, onPress, plain }: { choice: Choice; selected: boolean; onPress: () => void; plain?: boolean }) {
  const blocked = !!c.unavailable
  const badge = blocked ? null : c.recommended ? "Recommended" : c.rank ? `Preferred ${c.rank}` : null
  const detail = blocked ? c.unavailable!.reason : [plain ? null : "Available", c.detail].filter(Boolean).join(" · ")
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled: blocked }} disabled={blocked && !selected}
      accessibilityLabel={`${c.name}. ${blocked ? `Not available: ${c.unavailable!.reason}` : [badge, detail].filter(Boolean).join(", ")}`} onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: selected ? 2 : 1, borderColor: selected ? (blocked ? colour.warning : colour.pitch600) : colour.line, backgroundColor: blocked ? colour.chalk : selected ? "rgba(220,247,229,0.45)" : colour.surface, opacity: pressed ? 0.85 : 1, flexDirection: "row", alignItems: "center", gap: space.sm })}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: selected ? (blocked ? colour.warning : colour.pitch600) : colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
        {selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: blocked ? colour.warning : colour.pitch600 }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: blocked ? colour.inkMuted : colour.ink }]}>{c.name}</Text>
        {!!detail && <Text style={[type.caption, { color: blocked ? (selected ? colour.warning : colour.inkSubtle) : colour.inkMuted }]}>{detail}</Text>}
      </View>
      {badge && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.recommended ? colour.forest800 : colour.mint100 }}>
          {c.recommended && <Sparkles size={11} color={colour.mint300} />}
          <Text style={[type.caption, { color: c.recommended ? colour.onForest : colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{badge}</Text>
        </View>
      )}
    </Pressable>
  )
}
