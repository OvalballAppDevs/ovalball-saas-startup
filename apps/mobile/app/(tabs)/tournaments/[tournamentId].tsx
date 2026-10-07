import { useCallback, useEffect, useState } from "react"
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  initialContext,
  readTournamentParticipantCentre,
  type ParticipantContext,
  type TournamentParticipantCentre,
} from "@ovalball/contracts/tournaments/participant-centre"

import { supabase } from "../../../src/auth/supabase"
import { useCurrentStack, withinStack } from "../../../src/links/stack"
import {
  PARTICIPANT_TOURNAMENT_TABS,
  TournamentHeaderChrome,
  dateRange,
  participantTournamentTabsFor,
  type ParticipantTournamentTab,
} from "../../../src/tournaments/detail-chrome"
import { TournamentStandingsTab } from "../../../src/tournaments/standings-tab"
import { TournamentResultsTab } from "../../../src/tournaments/results-tab"
import { TournamentDrawTab } from "../../../src/tournaments/draw-tab"
import { TournamentAgendaTab } from "../../../src/tournaments/participant-agenda"
import { TournamentAttendanceTab } from "../../../src/tournaments/participant-attendance"
import { ClubCrest } from "../../../src/components/identity"
import { CalendarDays, ChevronRight, Clock, MapPin, Trophy, Users } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { useTabBarHeight } from "../../../src/navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../../../src/design/tokens"

/**
 * THE TOURNAMENT CENTRE, FOR SOMEBODY GOING TO THE TOURNAMENT.
 *
 * ONE ADDRESS, ONE RECORD, SEVERAL AUDIENCES. `/tournaments/<id>` is where the Calendar row, a shared
 * link and a notification all land, whoever taps them. What differs is what the server returns and,
 * for an organiser, which surface this route hands off to -- not the identity of the thing being
 * looked at.
 *
 * IT IS NOT A SECOND MANAGEMENT DASHBOARD, and must never become one. The hosting club's experience
 * -- Overview, Teams, Requests, Planning, and every editing control in them -- already exists at
 * `/admin/tournaments/<id>`, and a viewer the server says may MANAGE this tournament is sent straight
 * there. Nothing on this screen edits anything.
 *
 * ONE TOURNAMENT, SEVERAL COMPETITION CONTEXTS. A club with a U12 and a U16 side at one festival is at
 * one festival in two competitions. Those do not mix -- telling a U12 parent which clubs are in the
 * U16 field is describing a different day's rugby -- so an age group is chosen with the segmented
 * control the app already uses, and everything below follows it. There is no second tournament record
 * and no second Centre: the context is a lens.
 *
 * THE DESIGN IS INHERITED, NOT INVENTED. The header, the hero cover, the private/public pill, the tab
 * bar, the cards, the crests and the spacing are the ones the organiser's tournament screen and Match
 * Centre already use.
 */
export default function TournamentCentre() {
  const router = useRouter()
  const stack = useCurrentStack()
  const { tournamentId, ageGroup, tab: tabParam } = useLocalSearchParams<{ tournamentId: string; ageGroup?: string; tab?: string }>()
  const id = String(tournamentId ?? "")

  const [centre, setCentre] = useState<TournamentParticipantCentre | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // A link may open a named section -- a family sent here from a game opens on the Agenda that lists it.
  const [tab, setTab] = useState<ParticipantTournamentTab>(
    (PARTICIPANT_TOURNAMENT_TABS as readonly string[]).includes(String(tabParam ?? "")) ? (String(tabParam) as ParticipantTournamentTab) : "Overview",
  )
  const [grade, setGrade] = useState<string | null>(ageGroup ? String(ageGroup) : null)

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await readTournamentParticipantCentre(supabase, id)
      if (!loaded) {
        setMissing(true)
        return
      }
      /*
        AN ORGANISER GOES TO THE SURFACE THEY ALREADY HAVE.

        `canManage` is the SERVER'S answer, not a role read on the device. A host tapping their own
        festival in the Calendar wants the thing they build the day with, and drawing a read-only
        participant view for them would be a second, poorer Overview of a tournament they manage.

        `replace`, not `push`: the management screen is where they meant to be, so Back should take
        them to the Calendar rather than to a participant view they never asked for -- and it is the
        organiser's screen AT THIS STACK'S ADDRESS (`withinStack`). Replacing with the Admin route itself
        jumped tabs, and Back then landed on whatever the Admin stack last showed.
      */
      if (loaded.canManage) {
        router.replace(withinStack({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: id } }, stack) as never)
        return
      }
      setCentre(loaded)
      setGrade((current) => current ?? initialContext(loaded.contexts, ageGroup ? String(ageGroup) : null)?.ageGroup ?? null)
    } catch (caught) {
      const failure = friendly(caught, "this tournament")
      logDetail("tournament centre", failure)
      setProblem(failure.message)
    }
  }, [id, ageGroup, router, stack])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <TournamentHeaderChrome
          name="Tournament unavailable"
          coverImagePath={null}
          coverStockKey={null}
          startsOn={new Date().toISOString().slice(0, 10)}
          endsOn={null}
          venueName={null}
          visibility="private"
          backTo="/calendar"
          tabs={[]}
          tab=""
          onTab={() => {}}
        />
        <EmptyState
          title="This tournament isn't available"
          body="It may have been removed, or it may not be one you have access to."
          icon={<Trophy size={24} color={colour.inkSubtle} />}
        />
      </View>
    )
  }

  if (!centre) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, padding: space.lg, gap: space.md }}>
        {problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton />}
      </View>
    )
  }

  const context = centre.contexts.find((c) => c.ageGroup === grade) ?? centre.contexts[0] ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <TournamentHeaderChrome
        name={centre.name}
        coverImagePath={centre.coverImagePath}
        coverStockKey={centre.coverStockKey}
        startsOn={centre.startsOn}
        endsOn={centre.endsOn}
        venueName={centre.venueName}
        visibility={centre.visibility}
        contextLine={context ? `Tournament · ${context.ageGroup}` : "Tournament"}
        backTo="/calendar"
        tabs={participantTournamentTabsFor(centre.format, context?.canRecordResults ?? false, context?.keepsStandings)}
        tab={tab}
        onTab={(t) => setTab(t as ParticipantTournamentTab)}
      />

      {/* THE COMPETITION BEING LOOKED AT, where the viewer genuinely has more than one. A club with a
          single side has nothing to choose between, and a control with one option is furniture. */}
      {centre.contexts.length > 1 && (
        <ContextSwitcher
          contexts={centre.contexts}
          selected={context?.ageGroup ?? null}
          onSelect={(g) => setGrade(g)}
        />
      )}

      {tab === "Overview" && <OverviewTab centre={centre} context={context} onRefresh={load} refreshing={refreshing} setRefreshing={setRefreshing} />}
      {tab === "Teams" && <TeamsTab context={context} onRefresh={load} />}
      {tab === "Agenda" && <TournamentAgendaTab centre={centre} context={context} />}
      {tab === "Attendance" && <TournamentAttendanceTab centre={centre} context={context} onChanged={load} />}
      {/*
        THE SAME TABLE THE ORGANISER READS, from the same component. A competition's standings are a
        fact about the competition, not a view of it -- so there is one implementation, and the server
        decides what this viewer is allowed to see of it.
      */}
      {/*
        THE SAME RESULTS LIST THE ORGANISER READS. The server narrows it to this club's own games and
        says so in the payload, so there is one component and one shape rather than a club-flavoured
        copy. Offered only to somebody who could actually record a result.
      */}
      {tab === "Results" && context && (
        <TournamentResultsTab
          tournamentId={id}
          ageGroups={[context.ageGroup]}
          submissionEnabled={centre.resultsSubmissionEnabled ?? true}
        />
      )}
      {tab === "Draw" && (
        <TournamentDrawTab tournamentId={id} ageGroup={context?.ageGroup ?? null} ageGroups={[]} />
      )}
      {tab === "Tables" && (
        <TournamentStandingsTab
          tournamentId={id}
          ageGroup={context?.ageGroup ?? null}
          ageGroups={[]}
          canManage
          /*
            THROUGH TO THE GAMES, VIA THE PROJECTION THAT ALREADY EXISTS. A participant's list of a
            competition's fixtures is the AGENDA -- published, read-only, already grouped by day and by
            table. Building a second one under the table would be a second description of the same
            games. The organiser's equivalent is their Results tab, and both are reached from the same
            line on the same card.
          */
          onViewTable={() => setTab("Agenda")}
        />
      )}
    </View>
  )
}

/**
 * WHICH COMPETITION. The segmented pill row the app already uses for a short set of mutually exclusive
 * choices -- the same control the create wizard offers age groups with, so choosing one here reads as
 * the same idea rather than a new one.
 */
function ContextSwitcher({
  contexts,
  selected,
  onSelect,
}: {
  contexts: ParticipantContext[]
  selected: string | null
  onSelect: (ageGroup: string) => void
}) {
  return (
    <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: space.sm, gap: space.xs }}>
        {contexts.map((c) => {
          const on = c.ageGroup === selected
          return (
            <Pressable
              key={c.ageGroup}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${c.ageGroup} competition`}
              onPress={() => onSelect(c.ageGroup)}
              style={({ pressed }) => ({
                minHeight: 34,
                paddingHorizontal: space.md,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.pill,
                backgroundColor: on ? colour.forest800 : colour.chalk,
                borderWidth: 1,
                borderColor: on ? colour.forest800 : colour.line,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{c.ageGroup}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function OverviewTab({
  centre,
  context,
  onRefresh,
  refreshing,
  setRefreshing,
}: {
  centre: TournamentParticipantCentre
  context: ParticipantContext | null
  onRefresh: () => Promise<void>
  refreshing: boolean
  setRefreshing: (v: boolean) => void
}) {
  const tabBar = useTabBarHeight()
  const hours = timeRange(centre.kickoffTime, centre.endsAt)
  const mine = context?.sides.filter((s) => s.isMine) ?? []

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true)
            await onRefresh()
            setRefreshing(false)
          }}
        />
      }
    >
      {/* WHAT THE DAY IS. The facts somebody needs before they decide whether they can go, in the order
          they ask for them: when, how long, where, what shape, which competition. */}
      <Card title="Tournament Details">
        <Fact icon={<CalendarDays size={15} color={colour.inkMuted} />} text={dateRange(centre.startsOn, centre.endsOn)} />
        {!!hours && <Fact icon={<Clock size={15} color={colour.inkMuted} />} text={hours} />}
        {!!centre.venueName && <Fact icon={<MapPin size={15} color={colour.inkMuted} />} text={centre.venueName} />}
        {!!formatLabel(centre.format, centre.swissRounds) && (
          <Fact icon={<Trophy size={15} color={colour.inkMuted} />} text={formatLabel(centre.format, centre.swissRounds)!} />
        )}
        {!!context && <Fact icon={<Users size={15} color={colour.inkMuted} />} text={`${context.ageGroup} Competition`} />}
      </Card>

      {/* WHO IS RUNNING IT. A club, with its real crest -- never tinted, never substituted. */}
      {!!centre.hostClubName && (
        <Card title="Hosted by">
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs }}>
            <ClubCrest clubName={centre.hostClubName} url={clubLogoUrlFromPath(supabase, centre.hostCrestPath)} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink }]}>{centre.hostClubName}</Text>
              {!!centre.hostTown && (
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{centre.hostTown}</Text>
              )}
            </View>
          </View>
        </Card>
      )}

      {/* THE VIEWER'S OWN SIDE. Said plainly, because "which of our teams is this about" is the first
          thing a club administrator with two sides at one festival needs to know. */}
      {mine.length > 0 && (
        <Card title={mine.length > 1 ? "Your Sides" : "Your Side"}>
          {mine.map((s) => (
            <View key={s.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs }}>
              <ClubCrest clubName={s.clubName} url={clubLogoUrlFromPath(supabase, s.crestPath)} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{s.clubName}</Text>
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{s.label}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* THE FIELD, IN THIS COMPETITION ONLY. */}
      {!!context && (
        <Card title={`Participating Clubs (${context.ageGroup})`} trailing={`${context.sides.length} ${context.sides.length === 1 ? "team" : "teams"}`}>
          {context.sides.map((s) => (
            <View key={s.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
              <ClubCrest clubName={s.clubName} url={clubLogoUrlFromPath(supabase, s.crestPath)} size={30} />
              <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.ink }]}>{s.clubName}</Text>
              {s.isHost && <Badge text="Host" />}
              {s.isMine && !s.isHost && <Badge text="You" />}
            </View>
          ))}
        </Card>
      )}

      {centre.contexts.length === 0 && (
        <EmptyState
          title="You're not in this tournament"
          body="You can see the tournament, but none of your teams is entered in it."
          icon={<Trophy size={24} color={colour.inkSubtle} />}
        />
      )}
    </ScrollView>
  )
}

/** THE FIELD, at more room than Overview gives it: every side, with the team each club is bringing. */
function TeamsTab({ context, onRefresh }: { context: ParticipantContext | null; onRefresh: () => Promise<void> }) {
  const tabBar = useTabBarHeight()
  if (!context) return <EmptyState title="Nothing to show" body="No competition is selected." icon={<Users size={24} color={colour.inkSubtle} />} />

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      <Card title={`${context.ageGroup} Competition`} trailing={`${context.sides.length} ${context.sides.length === 1 ? "team" : "teams"}`}>
        {context.sides.map((s) => (
          <View key={s.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
            <ClubCrest clubName={s.clubName} url={clubLogoUrlFromPath(supabase, s.crestPath)} size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{s.clubName}</Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{s.label}</Text>
            </View>
            {s.isHost && <Badge text="Host" />}
            {s.isMine && !s.isHost && <Badge text="You" />}
          </View>
        ))}
      </Card>
    </ScrollView>
  )
}

/* ------------------------------------------------------------------ pieces */

export function Card({ title, trailing, children }: { title: string; trailing?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: space.xs }}>
        <Text style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>{title}</Text>
        {!!trailing && <Text style={[type.caption, { color: colour.inkMuted }]}>{trailing}</Text>}
      </View>
      {children}
    </View>
  )
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 }}>
      {icon}
      <Text style={[type.small, { flex: 1, color: colour.ink }]}>{text}</Text>
    </View>
  )
}

export function Badge({ text }: { text: string }) {
  return (
    <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colour.mint100 }}>
      <Text style={[type.caption, { color: colour.forest800, fontSize: 11 }]}>{text}</Text>
    </View>
  )
}

/** "09:00 – 14:30", or just the start. Never a finish nobody recorded. */
export function timeRange(start: string | null, end: string | null): string | null {
  const s = start ? String(start).slice(0, 5) : null
  const e = end ? String(end).slice(0, 5) : null
  if (!s) return null
  return e ? `${s} – ${e}` : s
}

/** The competition shape in the product's own words. Null where none is recorded. */
export function formatLabel(format: string | null, swissRounds: number | null): string | null {
  switch (format) {
    case "round_robin":
      return "Round Robin"
    case "knockout":
      return "Knockout"
    case "league":
      return "League"
    case "swiss":
      return swissRounds ? `Swiss · ${swissRounds} rounds` : "Swiss"
    case "hybrid":
      return "Hybrid"
    default:
      return null
  }
}
