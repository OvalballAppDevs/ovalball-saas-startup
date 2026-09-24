import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { shiftDays, type AgendaItem } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { readAgenda, todayIso } from "../../../../src/agenda/load"
import { kickoffLabel, opponentLine, relativeDate, restOfDate } from "../../../../src/agenda/presentation"
import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { AVAILABILITY_GROUPS } from "../../../../src/availability/presentation"
import { HomeAwayBadge } from "../../../../src/components/agenda-row"
import { homeAwayLabel } from "../../../../src/agenda/presentation"
import { ChevronRight, Dumbbell, OvalIcon } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * AVAILABILITY -- every upcoming event, with how many have answered (CA-M7).
 *
 * The events are the canonical agenda for the team you are standing in (the same `readAgenda` the
 * Fixtures tab and the Calendar read), and the counts are `fixture_availability_summary`, the one
 * server read that answers only somebody holding `team.attendance.view` -- a fixture the server
 * declines to count is shown without counts, never with zeroes. Training carries no batched summary
 * on the platform; its register is read on the session itself.
 *
 * A read-only persona without attendance authority is told so, once, rather than shown a list of
 * events with no numbers on them.
 */
const HORIZON_DAYS = 60

interface Row {
  item: AgendaItem
  counts: { squad: number; attending: number; unavailable: number; unsure: number; awaiting: number } | null
}

export default function TeamAvailability() {
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const { authority, loading: authorityLoading } = useTeamAuthority()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const today = todayIso()

  const load = useCallback(async () => {
    if (!sessionContext || !active || active.kind !== "team") return
    setProblem(null)
    try {
      const agenda = await readAgenda(supabase, sessionContext, active, { range: { start: today, end: shiftDays(today, HORIZON_DAYS) }, includeTraining: true, today })
      const on = agenda.items.filter((i) => i.status !== "Cancelled")
      const fixtureIds = on.filter((i) => i.kind === "fixture").map((i) => i.eventId)
      const { data } = fixtureIds.length > 0 ? await supabase.rpc("fixture_availability_summary", { p_fixture_ids: fixtureIds }) : { data: [] }
      const byFixture = new Map((data ?? []).map((r) => [r.fixture_id, r]))
      setRows(
        on.map((item) => {
          const c = item.kind === "fixture" ? byFixture.get(item.eventId) : undefined
          return { item, counts: c ? { squad: c.squad_count ?? 0, attending: c.attending_count ?? 0, unavailable: c.unavailable_count ?? 0, unsure: c.unsure_count ?? 0, awaiting: c.awaiting_count ?? 0 } : null }
        })
      )
    } catch (caught) {
      const failure = friendly(caught, "availability")
      logDetail("team availability", failure)
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [sessionContext, active, today])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  return (
    <TeamScreen section="Availability" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && !authority.attendanceView && (
        <NotForYou title="The register is not part of your view" body="Who has answered for a match is shown to the people who run the side. You can still open each event to see what has been arranged." />
      )}
      {problem && !rows && <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />}
      {!problem && rows === null && (
        <>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </>
      )}
      {rows?.length === 0 && <EmptyState title="Nothing coming up" body={`No matches or training in the next ${HORIZON_DAYS} days.`} icon={<OvalIcon size={22} color={colour.inkSubtle} />} />}
      {rows && rows.length > 0 && (
        <View style={{ gap: space.sm }}>
          {rows.map(({ item, counts }) => {
            const training = item.kind === "training"
            const home = homeAwayLabel(item.homeAway)
            const answered = counts ? counts.squad - counts.awaiting : null
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${relativeDate(item.date, today)}, ${training ? "Training" : opponentLine(item)}${counts ? `. ${answered} of ${counts.squad} answered, ${counts.awaiting} awaiting` : ""}. Opens the register.`}
                onPress={() => router.push({ pathname: "/team/availability/[kind]/[eventId]", params: { kind: item.kind, eventId: item.eventId } } as never)}
                style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm, opacity: pressed ? 0.94 : 1 })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <View style={{ width: 38, height: 38, borderRadius: radius.md, backgroundColor: training ? "#e8eff7" : colour.mint100, alignItems: "center", justifyContent: "center" }}>
                    {training ? <Dumbbell size={18} color={colour.messengerBlue} strokeWidth={2} /> : <OvalIcon size={18} color={colour.forest800} />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>
                      {training ? "Training" : opponentLine(item)}
                    </Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      {relativeDate(item.date, today)} · {restOfDate(item.date, today)}
                      {kickoffLabel(item.time) ? ` · ${kickoffLabel(item.time)}` : ""}
                    </Text>
                  </View>
                  {!training && !!home && <HomeAwayBadge home={home} />}
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </View>
                {counts && (
                  <View style={{ flexDirection: "row", gap: space.xs }}>
                    {AVAILABILITY_GROUPS.map((g) => {
                      const n = g.key === "ATTENDING" ? counts.attending : g.key === "UNSURE" ? counts.unsure : g.key === "CANNOT_ATTEND" ? counts.unavailable : counts.awaiting
                      return (
                        <View key={g.key} accessible={false} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: g.wash, minHeight: 28 }}>
                          <g.Icon size={12} color={g.text} strokeWidth={2.5} />
                          <Text style={[type.caption, { color: g.text, fontFamily: "Inter_600SemiBold" }]}>{n}</Text>
                        </View>
                      )
                    })}
                  </View>
                )}
                {!counts && !training && authority.attendanceView && (
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>Counts are not available for this fixture.</Text>
                )}
              </Pressable>
            )
          })}
        </View>
      )}
      <View style={{ minHeight: TOUCH_TARGET }} />
    </TeamScreen>
  )
}
