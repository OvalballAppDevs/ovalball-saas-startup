import { useCallback, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"

import { readRegenerationCost, readTournamentPlan, type TournamentPlanContext } from "@ovalball/contracts/tournaments/planning"
import {
  releaseTournamentPitch,
  reserveTournamentPitch,
  scheduleTournamentPlan,
} from "@ovalball/contracts/tournaments/readiness"
import { setTournamentPitchAreas } from "@ovalball/contracts/tournaments/schedule"

import { supabase } from "../../../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../../../src/components/app-header"
import { TimeField } from "../../../../../../src/components/form"
import { CalendarSync, MapPin, Plus, Trash2 } from "../../../../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState, InfoNote } from "../../../../../../src/components/ui"
import { friendlyRefusal, logDetail } from "../../../../../../src/errors/translate"
import { useTabBarHeight } from "../../../../../../src/navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../../../../../../src/design/tokens"
import { ReadinessPanel } from "../../../../../../src/tournaments/readiness-panel"
import { Sheet } from "../../../../../../src/pitch-allocation/sheets"

/**
 * COMPLETE SCHEDULING -- VENUE & PITCHES.
 *
 * WHERE A GENERATED PLAN GETS ITS TIMES. Games get a kick-off and a pitch from the pitches reserved for
 * the tournament on its playing days, inside the competition's playing hours: that is the scheduler's
 * whole input (internal.tournament_plan_slots). Before this screen existed the Generated Draft Plan said
 * "reserve pitches for this tournament and generate again" and the phone had nowhere to do it -- the
 * reservations lived only on the website -- so an organiser went round the wizard and back to the same
 * unscheduled draft.
 *
 * NOTHING NEW IS INVENTED HERE. Reservations are the existing tournament_pitches rows, written through
 * reserve_tournament_pitch / release_tournament_pitch (the same authority and the same host-club,
 * in-range checks the website uses), and the pitches offered are the host club's own pitches -- at the
 * tournament's venue when it has one. "Schedule Games" re-places the generated games WITHOUT re-pairing
 * anybody and never moves a game that already has a result (schedule_tournament_plan).
 *
 * A PITCH TAKES WHAT IT IS MARKED OUT FOR (20270736). Several games share a kick-off on different
 * pitches; one pitch takes one game at a time when it is used whole, two when it is marked out as two
 * halves, four as quarters -- the layout the club recorded in Grounds & Pitches -- and the next game waits
 * for the changeover. Schedule Games places only where there is room, keeps every game the organiser
 * placed by hand unless asked to place them again, and never moves a game with a result.
 */

type Reservation = { id: string; pitch_id: string; reserved_on: string; start_time: string; end_time: string; playing_areas: number | null }
type PitchOption = { id: string; display_name: string; venue_id: string | null; lane_count: number | null }

export default function VenueAndPitches() {
  const router = useRouter()
  const tabBar = useTabBarHeight()
  const { tournamentId, ageGroup } = useLocalSearchParams<{ tournamentId: string; ageGroup?: string }>()
  const id = String(tournamentId ?? "")
  const grade = String(ageGroup ?? "")

  const [context, setContext] = useState<TournamentPlanContext | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [pitches, setPitches] = useState<PitchOption[]>([])
  const [venueId, setVenueId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // HOW MANY GAMES THE ORGANISER PLACED BY HAND -- Schedule Games asks before it moves any of them.
  const [handPlaced, setHandPlaced] = useState(0)
  const [askSchedule, setAskSchedule] = useState(false)
  // HOW THE PITCH BEING RESERVED IS MARKED OUT FOR THE DAY (owner's rule, 20270736): null is the club's layout.
  const [areas, setAreas] = useState<number | null>(null)
  // A reservation whose marking is being changed.
  const [marking, setMarking] = useState<Reservation | null>(null)

  const [pitch, setPitch] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [until, setUntil] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id || !grade) return
    setProblem(null)
    try {
      const ctx = await readTournamentPlan(supabase, id, grade)
      setContext(ctx)
      const { data: t, error: te } = await supabase.from("tournaments").select("host_club_id, venue_id").eq("id", id).maybeSingle()
      if (te) throw te
      setVenueId(t?.venue_id ?? null)
      const [{ data: r, error: re }, { data: p, error: pe }] = await Promise.all([
        supabase.from("tournament_pitches").select("id, pitch_id, reserved_on, start_time, end_time, playing_areas").eq("tournament_id", id).order("reserved_on").order("start_time"),
        t?.host_club_id
          ? supabase.from("club_pitches").select("id, display_name, venue_id, lane_count").eq("club_id", t.host_club_id).eq("active", true).order("sort_order")
          : Promise.resolve({ data: [] as PitchOption[], error: null }),
      ])
      if (re) throw re
      if (pe) throw pe
      setReservations((r ?? []) as Reservation[])
      setPitches((p ?? []) as PitchOption[])
      if (ctx?.plan && ctx.plan.gameCount > 0) {
        const cost = await readRegenerationCost(supabase, ctx.plan.id)
        setHandPlaced(cost.handPlacedCount ?? 0)
      }
      if (ctx?.plan) {
        setFrom((f) => f ?? String(ctx.plan!.dayStartTime).slice(0, 5))
        setUntil((u) => u ?? String(ctx.plan!.dayEndTime).slice(0, 5))
        setDay((d) => d ?? ctx.plan!.days[0] ?? null)
      }
    } catch (caught) {
      const failure = friendlyRefusal(caught, "this tournament's pitches")
      logDetail("tournament pitches", failure)
      setProblem(failure.message)
    }
  }, [id, grade])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  // THE PITCHES THAT CAN HOST IT: the host club's own, at the tournament's venue when it has one.
  const offered = useMemo(() => (venueId ? pitches.filter((p) => p.venue_id === venueId) : pitches), [pitches, venueId])
  const pitchName = useMemo(() => new Map(pitches.map((p) => [p.id, p.display_name])), [pitches])
  const pitchAreas = useMemo(() => new Map(pitches.map((p) => [p.id, p.lane_count ?? 1])), [pitches])
  const planDays = context?.plan?.days ?? []

  async function reserve() {
    if (!pitch || !day || !from || !until) return
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      await reserveTournamentPitch(supabase, { tournamentId: id, pitchId: pitch, day, startTime: from, endTime: until, playingAreas: areas })
      const n = areas ?? pitchAreas.get(pitch) ?? 1
      setNotice(`${pitchName.get(pitch) ?? "Pitch"} reserved on ${longDay(day)}, ${from}–${until}, for ${n === 1 ? "one game" : `${n} games`} at a time.`)
      await load()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "that reservation")
      logDetail("reserve tournament pitch", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  /** Marks a reserved pitch out differently; the server refuses a marking the games on it would not fit. */
  async function mark(r: Reservation, n: number | null) {
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      await setTournamentPitchAreas(supabase, r.id, n)
      setMarking(null)
      const effective = n ?? pitchAreas.get(r.pitch_id) ?? 1
      setNotice(`${pitchName.get(r.pitch_id) ?? "Pitch"} on ${longDay(r.reserved_on)} now takes ${effective === 1 ? "one game" : `${effective} games`} at a time.`)
      await load()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "that pitch")
      logDetail("tournament pitch areas", failure)
      setMarking(null)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function release(r: Reservation) {
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      await releaseTournamentPitch(supabase, r.id)
      setNotice(`${pitchName.get(r.pitch_id) ?? "Pitch"} released on ${longDay(r.reserved_on)}.`)
      await load()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "that reservation")
      logDetail("release tournament pitch", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function schedule(keepHandPlaced = true) {
    if (!context?.plan) return
    setAskSchedule(false)
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      await scheduleTournamentPlan(supabase, context.plan.id, keepHandPlaced)
      // BACK TO THE DRAFT, which re-reads its readiness on arrival: the forward route, not a loop.
      router.back()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "the schedule")
      logDetail("schedule tournament plan", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <OvalballDetailHeader
      title="Venue & Pitches"
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments" as never))}
    />
  )

  if (!context) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        {header}
        <View style={{ padding: space.lg }}>{problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton />}</View>
      </View>
    )
  }

  const plan = context.plan
  const readiness = plan?.readiness ?? null
  const hasGames = (plan?.gameCount ?? 0) > 0

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.xl, gap: space.md }}>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{context.tournamentName} · {grade}</Text>
        {!!readiness && hasGames && (
          <ReadinessPanel
            readiness={readiness}
            stage="publish"
            onAction={(a) => {
              if (a === "schedule") (handPlaced > 0 ? setAskSchedule(true) : void schedule())
              else if (a === "schedule_settings" || a === "days" || a === "tables" || a === "teams" || a === "draw")
                router.push({ pathname: "/admin/tournaments/plan/[tournamentId]", params: { tournamentId: id, ageGroup: grade, step: a === "schedule_settings" ? "2" : a === "tables" || a === "draw" ? "1" : "0" } } as never)
            }}
          />
        )}

        <Card style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Venue</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <MapPin size={16} color={colour.inkMuted} />
            <Text style={[type.small, { flex: 1, color: colour.ink }]}>{context.venueName ?? "No venue recorded"}</Text>
          </View>
          {!context.venueName && (
            <InfoNote>Choose the venue on the tournament's Overview, so teams know where to go. Any of your club's pitches can still be reserved.</InfoNote>
          )}
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Reserved Pitches</Text>
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            Games are placed on these pitches inside the playing hours ({String(plan?.dayStartTime ?? "").slice(0, 5)}–{String(plan?.dayEndTime ?? "").slice(0, 5)}). Each pitch takes as many games at once as you mark it out for, as long as each game's RFU pitch fits: a full-size pitch fits three U10 games but only two U12.
          </Text>
          {planDays.length === 0 && <InfoNote>Choose this competition's playing days in Planning first.</InfoNote>}
          {planDays.map((d) => {
            // In pitch order, then by time: the same pitch is always in the same place on the list.
            const onDay = reservations
              .filter((r) => r.reserved_on === d)
              .sort((a, b) => (pitchName.get(a.pitch_id) ?? "").localeCompare(pitchName.get(b.pitch_id) ?? "", undefined, { numeric: true }) || a.start_time.localeCompare(b.start_time))
            return (
              <View key={d} style={{ gap: space.xs, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colour.line }}>
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>{longDay(d)}</Text>
                {onDay.length === 0 ? (
                  <Text style={[type.caption, { color: colour.warning }]}>No pitch reserved on this day.</Text>
                ) : (
                  onDay.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.small, { color: colour.ink }]}>{pitchName.get(r.pitch_id) ?? "Pitch"}</Text>
                        <Text style={[type.caption, { color: colour.inkMuted }]}>
                          {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} · {gamesAtOnce(r.playing_areas ?? pitchAreas.get(r.pitch_id) ?? 1)}
                          {r.playing_areas == null ? " (club layout)" : ""}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Change how ${pitchName.get(r.pitch_id) ?? "the pitch"} is marked out on ${longDay(d)}`}
                        hitSlop={8}
                        disabled={busy}
                        onPress={() => setMarking(r)}
                        style={({ pressed }) => ({ paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Mark Out</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Release ${pitchName.get(r.pitch_id) ?? "pitch"} on ${longDay(d)}`}
                        hitSlop={8}
                        disabled={busy}
                        onPress={() => void release(r)}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Trash2 size={15} color={colour.danger} strokeWidth={2} />
                        <Text style={[type.smallMedium, { color: colour.danger }]}>Release</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            )
          })}
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Reserve a Pitch</Text>
          {offered.length === 0 ? (
            <InfoNote>{venueId ? "The tournament's venue has no active pitches. Add one to the venue first." : "Your club has no active pitches to reserve."}</InfoNote>
          ) : (
            <>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>Pitch</Text>
              <Chips options={offered.map((p) => ({ id: p.id, label: p.display_name }))} value={pitch} onChange={setPitch} />
              <Text style={[type.caption, { color: colour.inkSubtle }]}>Day</Text>
              <Chips options={planDays.map((d) => ({ id: d, label: shortDay(d) }))} value={day} onChange={setDay} />
              <Text style={[type.caption, { color: colour.inkSubtle }]}>Games at Once</Text>
              <Chips
                options={[1, 2, 3, 4].map((n) => ({ id: String(n), label: n === 1 ? "1 Game" : `${n} Games` }))}
                value={String(areas ?? (pitch ? pitchAreas.get(pitch) ?? 1 : 1))}
                onChange={(v) => setAreas(Number(v))}
              />
              <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
                How the pitch is marked out on the day. It starts at the club's own layout; each game still has to fit its age grade's RFU pitch.
              </Text>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>From</Text>
                  <TimeField label="From" value={from} clearable={false} onChange={(v) => setFrom(v ?? from)} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>Until</Text>
                  <TimeField label="Until" value={until} clearable={false} onChange={(v) => setUntil(v ?? until)} />
                </View>
              </View>
              <Button
                label="Reserve Pitch"
                variant="secondary"
                busy={busy}
                disabled={!pitch || !day || !from || !until}
                icon={<Plus size={17} color={colour.forest800} strokeWidth={2.2} />}
                onPress={() => void reserve()}
              />
            </>
          )}
        </Card>

        <Card style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Playing Hours</Text>
          <Text style={[type.small, { color: colour.ink }]}>
            {String(plan?.dayStartTime ?? "").slice(0, 5)} to {String(plan?.dayEndTime ?? "").slice(0, 5)} · {plan?.gameDurationMinutes} min games · {plan?.changeoverMinutes} min changeover
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change Playing Hours"
            hitSlop={8}
            onPress={() => router.push({ pathname: "/admin/tournaments/plan/[tournamentId]", params: { tournamentId: id, ageGroup: grade, step: "2" } } as never)}
            style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Change Playing Hours</Text>
          </Pressable>
        </Card>

        {!!notice && <InfoNote>{notice}</InfoNote>}
        {!!problem && (
          <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>
        )}

        {hasGames && (
          <Button
            label="Schedule Games"
            busy={busy}
            disabled={reservations.length === 0}
            icon={<CalendarSync size={18} color={colour.onForest} strokeWidth={2} />}
            accessibilityHint="Gives every unplayed game a kick-off time and pitch from the reserved pitches, without changing who plays whom"
            style={{ minHeight: 52 }}
            onPress={() => (handPlaced > 0 ? setAskSchedule(true) : void schedule())}
          />
        )}
      </ScrollView>

      {/* MARK OUT: how a reserved pitch is marked out for the day, changed on its own. */}
      <Sheet visible={!!marking} onClose={() => setMarking(null)} title="Mark Out Pitch">
        {!!marking && (
          <View style={{ gap: space.md }}>
            <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>
              {pitchName.get(marking.pitch_id) ?? "This pitch"} on {longDay(marking.reserved_on)}, {marking.start_time.slice(0, 5)}–{marking.end_time.slice(0, 5)}. How many games can play on it at once? Each game still has to fit its RFU pitch, and the games already on it have to fit too.
            </Text>
            <Chips
              options={[1, 2, 3, 4].map((n) => ({ id: String(n), label: n === 1 ? "1 Game" : `${n} Games` }))}
              value={String(marking.playing_areas ?? pitchAreas.get(marking.pitch_id) ?? 1)}
              onChange={(v) => void mark(marking, Number(v))}
            />
            {marking.playing_areas != null && (
              <Button label="Use the Club's Layout" variant="secondary" busy={busy} onPress={() => void mark(marking, null)} />
            )}
          </View>
        )}
      </Sheet>

      {/* SCHEDULE GAMES SAYS WHAT IT WILL DO to the organiser's own placements before it does it. */}
      <Sheet visible={askSchedule} onClose={() => setAskSchedule(false)} title="Schedule Games">
        <View style={{ gap: space.md }}>
          <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>
            {handPlaced === 1 ? "1 game was" : `${handPlaced} games were`} placed by hand. Ovalball can keep {handPlaced === 1 ? "it" : "them"} where {handPlaced === 1 ? "it is" : "they are"} and place every other game around {handPlaced === 1 ? "it" : "them"}, or place every game again from the start. Games with a result never move.
          </Text>
          <Button label="Keep Games Placed by Hand" busy={busy} onPress={() => void schedule(true)} />
          <Button label="Place Every Game Again" variant="danger" busy={busy} onPress={() => void schedule(false)} />
          <Button label="Cancel" variant="secondary" onPress={() => setAskSchedule(false)} />
        </View>
      </Sheet>
    </View>
  )
}

function Chips({ options, value, onChange }: { options: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => ({
              paddingHorizontal: space.md,
              minHeight: 40,
              justifyContent: "center",
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: on ? colour.rugby700 : colour.lineStrong,
              backgroundColor: on ? colour.rugby700 : colour.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function gamesAtOnce(n: number): string {
  return n === 1 ? "one game at a time" : `${n} games at once`
}

function longDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}
