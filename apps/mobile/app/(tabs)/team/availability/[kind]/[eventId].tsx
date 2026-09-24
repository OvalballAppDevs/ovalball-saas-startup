import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { countsFromResponses, groupKeyForStatus, summariseAvailability, type AttendanceGroupKey } from "@ovalball/contracts/availability"

import { supabase } from "../../../../../src/auth/supabase"
import { loadRegister } from "../../../../../src/match-centre/load"
import { loadTrainingRegister, loadTrainingSession, type TrainingSession } from "../../../../../src/agenda/training"
import { loadFixtureDetail, type FixtureDetail } from "../../../../../src/agenda/fixture-detail"
import { todayIso } from "../../../../../src/agenda/load"
import { exactDate, kickoffLabel, relativeDate } from "../../../../../src/agenda/presentation"
import { useTeamAuthority } from "../../../../../src/team/authority"
import { routeForIntent } from "../../../../../src/links/destinations"
import { NotForYou, TeamScreen } from "../../../../../src/team/screen"
import { AVAILABILITY_GROUPS } from "../../../../../src/availability/presentation"
import { AnnounceSheet } from "../../../../../src/components/announce-sheet"
import { loadAudienceCounts, type AudienceCounts } from "../../../../../src/match-centre/announce"
import type { RegisterEntry } from "../../../../../src/components/availability-register"
import { PersonAvatar } from "../../../../../src/components/identity"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../../src/components/ui"
import { friendly, logDetail } from "../../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * WHO HAS ANSWERED, FOR ONE EVENT -- the register as an operational screen (CA-M7).
 *
 * The four counts first, because "how many can I plan for" is the question a coach has before any
 * name matters; then a filter over the same four states so a manager arriving at "Awaiting 9" finds
 * WHICH nine without reading the whole squad; then the rows, one per player, each saying its state in a
 * word and an icon -- never a colour alone.
 *
 * THE ROWS ARE THE SERVER'S. A fixture register comes through `fixture_availability_summary` as the
 * authority probe and the RLS-protected attendance rows; a training register through
 * `get_training_register`, which refuses outright. Nobody here records an answer for anybody else:
 * the platform has no staff override, and this screen does not pretend otherwise. A coach who needs an
 * answer asks for it -- the announce sheet sends the canonical reminder to those still awaiting.
 *
 * INITIALS, NEVER PHOTOS. A register is not a gallery of other people's children.
 */
type FilterKey = "ALL" | AttendanceGroupKey

export default function TeamAvailabilityRegister() {
  const router = useRouter()
  const { kind, eventId } = useLocalSearchParams<{ kind: string; eventId: string }>()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const isTraining = kind === "training"
  const today = todayIso()

  const [entries, setEntries] = useState<RegisterEntry[] | null>(null)
  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>("ALL")
  const [announcing, setAnnouncing] = useState(false)
  const [audience, setAudience] = useState<AudienceCounts | null>(null)

  const load = useCallback(async () => {
    if (!eventId) return
    setProblem(null)
    try {
      if (isTraining) {
        const [rows, card] = await Promise.all([loadTrainingRegister(supabase, eventId), loadTrainingSession(supabase, eventId)])
        setEntries(rows)
        setSession(card)
      } else {
        // OUR side is the team we are standing in, so the detail flips home and away the way the agenda does.
        const [rows, detail] = await Promise.all([loadRegister(supabase, eventId), loadFixtureDetail(supabase, eventId, new Set(teamId ? [teamId] : []))])
        setEntries(rows)
        setFixture(detail)
      }
    } catch (caught) {
      const failure = friendly(caught, "the register")
      logDetail("team register", failure)
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [eventId, isTraining, teamId])

  useEffect(() => {
    setEntries(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    if (isTraining || !eventId || !authority.fixtureCommunicationSend) return
    void loadAudienceCounts(supabase, eventId).then(setAudience).catch(() => setAudience(null))
  }, [isTraining, eventId, authority.fixtureCommunicationSend])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const grouped = useMemo(() => {
    const byGroup: Record<AttendanceGroupKey, RegisterEntry[]> = { ATTENDING: [], UNSURE: [], CANNOT_ATTEND: [], AWAITING: [] }
    for (const e of entries ?? []) byGroup[groupKeyForStatus(e.status)].push(e)
    for (const k of Object.keys(byGroup) as AttendanceGroupKey[]) byGroup[k].sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName))
    return byGroup
  }, [entries])
  const summary = entries ? summariseAvailability(countsFromResponses(entries.map((e) => e.status))) : null

  const shown: { entry: RegisterEntry; group: AttendanceGroupKey }[] =
    filter === "ALL"
      ? (["AWAITING", "UNSURE", "CANNOT_ATTEND", "ATTENDING"] as AttendanceGroupKey[]).flatMap((g) => grouped[g].map((entry) => ({ entry, group: g })))
      : grouped[filter].map((entry) => ({ entry, group: filter }))

  const title = isTraining ? "Training" : fixture ? `v ${fixture.them.clubName}${fixture.them.teamName ? ` ${fixture.them.teamName}` : ""}` : "Fixture"
  const dateIso = isTraining ? (session?.date ?? null) : (fixture?.date ?? null)
  const time = isTraining ? (session?.startTime ?? null) : (fixture?.kickoff ?? null)
  const venue = isTraining ? (session?.venueName ?? null) : (fixture?.venue ?? null)
  const openEvent = () => {
    // THE ONE ROUTE TABLE decides where a fixture or a session opens; this screen only says which.
    const route = routeForIntent(isTraining ? { kind: "TRAINING", sessionId: eventId ?? "" } : { kind: "FIXTURE", fixtureId: eventId ?? "" })
    if (route) router.push(route as never)
  }

  return (
    <TeamScreen section="Who's In" refreshing={refreshing} onRefresh={refresh}>
      {/* THE EVENT, once, with the practical facts and a way to its own centre. */}
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          {title}
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          {dateIso ? `${relativeDate(dateIso, today)} · ${exactDate(dateIso)}` : ""}
          {kickoffLabel(time) ? ` · ${kickoffLabel(time)}` : ""}
          {venue ? ` · ${venue}` : ""}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={isTraining ? "Open the Training Centre" : "Open the fixture"} onPress={openEvent} style={{ minHeight: 32, justifyContent: "center", alignSelf: "flex-start" }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{isTraining ? "Open the Training Centre" : "Open the fixture"}</Text>
        </Pressable>
      </View>

      {!authorityLoading && !authority.attendanceView && <NotForYou title="The register is not part of your view" body="Who has answered is shown to the people who run the side." />}
      {problem && !entries && <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />}
      {!problem && entries === null && <CardSkeleton lines={4} />}

      {entries && entries.length === 0 && authority.attendanceView && <EmptyState title="Nobody to ask yet" body="The register fills as players join the side." />}

      {entries && entries.length > 0 && (
        <>
          {/* THE COUNTS ARE THE FILTER. One tap on a tile narrows the list to that state; tapping it
              again shows everyone. The tile says its number and its word, and its icon is the same one
              the row carries, so the same fact reads the same way twice. */}
          <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space.xs }}>
            {AVAILABILITY_GROUPS.map((g) => {
              const n = grouped[g.key].length
              const selected = filter === g.key
              return (
                <Pressable
                  key={g.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${n} ${g.label}`}
                  onPress={() => setFilter(selected ? "ALL" : g.key)}
                  style={{ flex: 1, minHeight: TOUCH_TARGET + 16, alignItems: "center", gap: 2, paddingVertical: space.sm, paddingHorizontal: 2, borderRadius: radius.md, borderWidth: selected ? 2 : 1, borderColor: selected ? g.text : g.edge, backgroundColor: g.wash }}
                >
                  <g.Icon size={14} color={g.text} strokeWidth={2.5} />
                  <Text style={[type.displaySmall, { color: g.text, fontSize: 22, lineHeight: 24 }]}>{n}</Text>
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, fontSize: 10 }]}>
                    {g.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{summary?.progress ?? ""}</Text>
            {filter !== "ALL" && (
              <Pressable accessibilityRole="button" accessibilityLabel="Show everyone" onPress={() => setFilter("ALL")} style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>Show everyone</Text>
              </Pressable>
            )}
          </View>

          {shown.length === 0 ? (
            <EmptyState title={filter === "AWAITING" ? "Everyone has answered" : "Nobody here"} body={filter === "AWAITING" ? "There is nobody left to chase for this one." : "Nobody has given that answer."} />
          ) : (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {shown.map(({ entry, group }, index) => {
                const g = AVAILABILITY_GROUPS.find((x) => x.key === group)!
                return (
                  <View key={entry.playerId} accessible accessibilityLabel={`${entry.firstName} ${entry.surname}, ${g.label}`} style={{ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <PersonAvatar name={`${entry.firstName} ${entry.surname}`} url={null} size={36} />
                    <Text style={[type.small, { color: colour.ink, flex: 1, minWidth: 0 }]} numberOfLines={1}>
                      {entry.firstName} {entry.surname}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: g.edge, backgroundColor: g.wash }}>
                      <g.Icon size={12} color={g.text} strokeWidth={2.5} />
                      <Text style={[type.caption, { color: g.text, fontFamily: "Inter_600SemiBold" }]}>{g.label}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          {/* ASKING, NOT ANSWERING. Nobody records a response for a player; the canonical reminder goes
              to those still awaiting, through the same operation the Match Centre's announce uses. */}
          {!isTraining && authority.fixtureCommunicationSend && audience && grouped.AWAITING.length > 0 && (
            <Button label={`Remind the ${grouped.AWAITING.length} Still Awaiting`} variant="secondary" onPress={() => setAnnouncing(true)} />
          )}
          <Text style={[type.caption, { color: colour.inkSubtle }]}>Answers are given by players and their parents or guardians. Staff can ask, not answer for them.</Text>
        </>
      )}

      {announcing && !isTraining && eventId && audience && <AnnounceSheet fixtureId={eventId} counts={audience} onClose={() => setAnnouncing(false)} />}
    </TeamScreen>
  )
}
