import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { AvailabilityStatus, WeatherResult } from "@ovalball/contracts"
import {
  attendanceMomentCopy,
  openFixtureAttendance,
  readMatchCentreAttendance,
  type AttendanceAnswer,
  type MatchCentreAttendance,
} from "@ovalball/contracts/match-centre/attendance"
import { readCommunicationCounts, readFixtureAnnouncements, type CommunicationCounts, type FixtureAnnouncement } from "@ovalball/contracts/match-centre/communications"
import { readMatchRewards, readPlayerRecognition, type MatchRewards, type PlayerRecognition } from "@ovalball/contracts/match-centre/rewards"
import {
  MATCH_CENTRE_SECTIONS,
  parseMatchCentreSection,
  type MatchCentreSection,
} from "@ovalball/contracts/match-centre/sections"

import { supabase } from "../../auth/supabase"
import { useAppContexts } from "../../context/contexts"
import { useBackToSurface } from "../../links/back"
import { useCurrentStack, withinStack } from "../../links/stack"
import { loadMatchCentre, type MatchCentreSide, type MatchCentreView, type MyAvailability } from "../../match-centre/load"
import { loadFixtureForecast } from "../../match-centre/forecast"
import { respondToFixture } from "../../match-centre/respond"
import { loadFixtureDetail, loadOppositionContacts, type FixtureDetail, type OppositionContact } from "../../agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../../agenda/authority"
import { acceptKickoffChange, cancelFixture, rejectKickoffChange } from "../../agenda/mutations"
import { exactDate } from "../../agenda/presentation"
import { todayIso } from "../../agenda/load"
import { loadRecipients, openConversationWith } from "../../messages/recipients"
import { invalidateAttention } from "../../attention/cache"
import { OvalballDetailHeader } from "../../components/app-header"
import { CancelSheet } from "../../components/field-sheet"
import { CardSkeleton, EmptyState, ErrorState } from "../../components/ui"
import { Users } from "../../components/icons"
import { friendly, logDetail } from "../../errors/translate"
import { colour, space, type } from "../../design/tokens"

import { MatchCentreTabs } from "./tabs"
import { MatchHero } from "./hero"
import { OverviewSection } from "./overview-section"
import { ArenaSection } from "./arena-section"
import { MatchResultSection } from "./result-section"
import { AttendanceSection } from "./attendance-section"
import { AttendanceMoment } from "./attendance-moment"
import { ChangingRoomSection } from "./changing-room-section"
import { RewardsSection } from "./rewards-section"
import { MatchDetailsEditor } from "./details-editor"
import { ArrangementsEditor } from "./arrangements-editor"

/**
 * MATCH CENTRE -- THE ONE DESTINATION FOR A GAME (owner brief, 2026-10-03).
 *
 * The former Fixture Detail console, Edit Fixture and Match Result screens are now this one surface.
 * Every viewer sees the same hero and the same six sections -- Overview, Arena Details, Result,
 * Attendance, Changing Room, Rewards -- and what each section shows and offers is decided by the server
 * for this viewer: staff get their controls in place, families answer and read, the opposition sees
 * numbers rather than names, and an unrelated person cannot open the match at all.
 *
 * There is no parent, player, staff or opposition variant and no branch choosing between trees.
 * `?tab=` opens a section directly, which is how every notification lands on the exact thing it is
 * about; `?edit=details` opens the match details editor (where Edit Fixture's old address now leads).
 */
export function MatchCentre() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const stack = useCurrentStack()
  const back = useBackToSurface("/fixtures")
  const params = useLocalSearchParams<{ fixtureId: string; tab?: string; edit?: string }>()
  const { active, refreshUnread } = useAppContexts()
  const id = String(params.fixtureId ?? "")
  const today = todayIso()

  const [section, setSection] = useState<MatchCentreSection>(parseMatchCentreSection(params.tab))
  const [view, setView] = useState<MatchCentreView | null>(null)
  const [attendance, setAttendance] = useState<MatchCentreAttendance | null>(null)
  const [rewards, setRewards] = useState<MatchRewards | null>(null)
  const [announcements, setAnnouncements] = useState<FixtureAnnouncement[]>([])
  const [counts, setCounts] = useState<CommunicationCounts | null>(null)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [detail, setDetail] = useState<FixtureDetail | null>(null)
  const [contacts, setContacts] = useState<OppositionContact[]>([])
  const [recognition, setRecognition] = useState<Map<string, PlayerRecognition[]>>(new Map())
  const [weather, setWeather] = useState<WeatherResult>({ state: "PROVIDER_UNAVAILABLE", forecast: null })
  const [canReachSomebody, setCanReachSomebody] = useState(false)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [moment, setMoment] = useState<{ status: AttendanceAnswer; title: string; body: string } | null>(null)
  const [editing, setEditing] = useState<null | "details" | "arrangements">(params.edit === "details" ? "details" : null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelProblem, setCancelProblem] = useState<string | null>(null)
  const [responding, setResponding] = useState(false)
  const [opening, setOpening] = useState(false)
  const scroller = useRef<ScrollView>(null)

  // A LINK THAT NAMES A SECTION OPENS IT, every time it arrives -- not only the first.
  useEffect(() => {
    if (params.tab) setSection(parseMatchCentreSection(params.tab))
  }, [params.tab])
  useEffect(() => {
    if (params.edit === "details") setEditing("details")
  }, [params.edit])

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadMatchCentre(supabase, id, active?.kind ?? null)
      if (!loaded) {
        setMissing(true)
        return
      }
      setView(loaded)
      const [att, rw, ann] = await Promise.all([
        readMatchCentreAttendance(supabase, id).catch(() => null),
        readMatchRewards(supabase, id).catch(() => null),
        readFixtureAnnouncements(supabase, id).catch(() => [] as FixtureAnnouncement[]),
      ])
      setAttendance(att)
      setRewards(rw)
      setAnnouncements(ann)
      // RECOGNITION FOLLOWS THE PERSON: the badges for everybody whose name this page draws.
      const ids = [
        ...loaded.mine.map((m) => m.playerId),
        ...(att?.sides.flatMap((s) => (s.players ?? []).map((p) => p.playerId)) ?? []),
      ]
      void readPlayerRecognition(supabase, ids).then(setRecognition).catch(() => undefined)
      void loadFixtureForecast(supabase, id).then(setWeather)
      void loadRecipients(supabase)
        .then((people) => setCanReachSomebody(people.length > 0))
        .catch(() => setCanReachSomebody(false))
      if (loaded.canManageFixture) {
        void readCommunicationCounts(supabase, id).then(setCounts)
        void loadOppositionContacts(supabase, id).then(setContacts)
        void loadFixtureDetail(supabase, id, new Set()).then(setDetail).catch(() => setDetail(null))
      } else {
        setCounts(null)
        setContacts([])
        setDetail(null)
      }
    } catch (caught) {
      const failure = friendly(caught, "this Match Centre")
      logDetail("match centre", failure)
      setProblem(failure.message)
    }
  }, [id, active])

  useEffect(() => {
    let live = true
    void loadFixtureAuthority(supabase, active).then((result) => live && setAuthority(result))
    return () => {
      live = false
    }
  }, [active])

  // RE-READ ON EVERY ARRIVAL, and on pull. No second realtime channel: the website's Match Centre re-reads
  // on navigation, and the two clients must not disagree through a mobile-only one.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const canEdit = Boolean(view?.canManageFixture && authority?.edit)
  const canCancel = Boolean(view?.canManageFixture && authority?.cancel)

  function go(next: MatchCentreSection) {
    setSection(next)
    scroller.current?.scrollTo({ y: 0, animated: true })
  }

  function openClub(side: MatchCentreSide) {
    // Inside the stack this Match Centre was opened in -- Fixtures or Calendar -- so Back returns here
    // (the same pages the Clubhouse shows).
    if (side.directoryId) router.push(withinStack({ pathname: "/fixtures/club/[directoryId]", params: { directoryId: side.directoryId } }, stack) as never)
  }
  function openTeam(side: MatchCentreSide) {
    if (side.teamId) router.push(withinStack({ pathname: "/fixtures/team/[teamId]", params: { teamId: side.teamId } }, stack) as never)
  }

  async function answer(entry: MyAvailability, status: AvailabilityStatus): Promise<boolean> {
    const result = await respondToFixture(supabase, id, entry.playerId, status)
    if (!result.ok) {
      setProblem(result.message)
      return false
    }
    setProblem(null)
    invalidateAttention()
    void refreshUnread()
    if (view) {
      // THE MOMENT NAMES THE PLAYER AND THE OTHER SIDE -- from the player's own side, never the row's.
      const opponent = view.viewerSide === "home" ? view.away.clubName : view.viewerSide === "away" ? view.home.clubName : null
      const copy = attendanceMomentCopy({ status: status as AttendanceAnswer, firstName: entry.isSelf ? null : entry.firstName, opponent })
      setMoment({ status: status as AttendanceAnswer, ...copy })
    }
    await load()
    return true
  }

  async function openAttendanceNow() {
    setOpening(true)
    try {
      await openFixtureAttendance(supabase, id)
      await load()
    } catch (caught) {
      setProblem(friendly(caught, "attendance").message)
    } finally {
      setOpening(false)
    }
  }

  async function messageOpposition(contact: OppositionContact) {
    setOpening(true)
    const result = await openConversationWith(supabase, contact.userId)
    setOpening(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "direct", id: result.conversationId } })
  }

  async function decideKickoff(accept: boolean) {
    if (responding || !detail) return
    setResponding(true)
    const result = accept && detail.proposedKickoff
      ? await acceptKickoffChange(supabase, id, { date: detail.proposedKickoff.date, time: detail.proposedKickoff.time })
      : await rejectKickoffChange(supabase, id)
    setResponding(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await load()
  }

  async function confirmCancel(reason: string) {
    setCancelSaving(true)
    setCancelProblem(null)
    const result = await cancelFixture(supabase, id, reason)
    setCancelSaving(false)
    if (!result.ok) {
      setCancelProblem(result.message)
      return
    }
    setCancelOpen(false)
    await load()
  }

  const tabs = useMemo(() => MATCH_CENTRE_SECTIONS, [])

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Match Centre" onBack={back} />
        <View style={{ padding: space.lg }}>
          <EmptyState
            title="This match is not available"
            body="It may have been removed, or it may belong to a team you are not part of."
            icon={<Users size={26} color={colour.forest800} strokeWidth={1.8} />}
          />
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Match Centre" onBack={back} />
      {!view ? (
        <View style={{ padding: space.lg, gap: space.lg }}>{problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton lines={5} />}</View>
      ) : (
        <ScrollView
          ref={scroller}
          stickyHeaderIndices={[1]}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                void load().finally(() => setRefreshing(false))
              }}
              tintColor={colour.chalk}
            />
          }
        >
          <MatchHero view={view} onOpenClub={openClub} onOpenTeam={openTeam} onOpenVenue={() => go("arena")} />

          {/* THE SECTIONS, as one scrollable bar that stays at the top while the section scrolls. */}
          <MatchCentreTabs tabs={tabs} section={section} onSelect={go} />

          <View style={{ padding: space.lg, gap: space.lg }}>
            {problem && <ErrorState message={problem} onRetry={() => void load()} />}

            {section === "overview" && (
              <OverviewSection
                view={view}
                weather={weather}
                attendance={attendance}
                rewards={rewards}
                latest={announcements[0] ?? null}
                detail={detail}
                canEdit={canEdit}
                canCancel={canCancel}
                today={today}
                responding={responding}
                onEdit={() => setEditing("details")}
                onCancel={() => {
                  setCancelProblem(null)
                  setCancelOpen(true)
                }}
                onAcceptKickoff={() => void decideKickoff(true)}
                onDeclineKickoff={() => void decideKickoff(false)}
                onGo={go}
              />
            )}
            {section === "arena" && (
              <ArenaSection view={view} attendance={attendance} canEdit={canEdit} onEditVenue={() => setEditing("details")} onEditArrangements={() => setEditing("arrangements")} />
            )}
            {section === "result" && <MatchResultSection fixtureId={id} onChanged={() => void load()} />}
            {section === "attendance" && (
              <AttendanceSection
                view={view}
                attendance={attendance}
                counts={counts}
                recognition={recognition}
                today={today}
                onAnswer={answer}
                onOpenAttendance={() => void openAttendanceNow()}
                opening={opening}
                onChanged={() => void load()}
              />
            )}
            {section === "changing-room" && (
              <ChangingRoomSection
                fixtureId={id}
                canMessage={view.canMessage}
                canAnnounce={view.canManageFixture}
                canReachSomebody={canReachSomebody}
                counts={counts}
                contacts={contacts}
                announcements={announcements}
                opening={opening}
                onOpenConversation={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id } } as never)}
                onMessageOpposition={(c) => void messageOpposition(c)}
                onMessageStaff={() => router.push("/messages/new" as never)}
                onSent={() => void load()}
              />
            )}
            {section === "rewards" && <RewardsSection view={view} rewards={rewards} onChanged={() => void load()} />}
          </View>
        </ScrollView>
      )}

      {moment && <AttendanceMoment status={moment.status} title={moment.title} body={moment.body} onClose={() => setMoment(null)} />}
      {/* THE EDITORS EXIST ONLY FOR WHOEVER MAY EDIT. An older `/edit` link asks for the details sheet;
          for anybody else it simply is not drawn, and the database refuses the write regardless. */}
      {canEdit && editing === "details" && view && <MatchDetailsEditor fixtureId={id} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {canEdit && editing === "arrangements" && view && <ArrangementsEditor view={view} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {view && (
        <CancelSheet
          visible={cancelOpen}
          summary={{
            teams: `${view.home.teamName ?? view.home.clubName} v ${view.away.teamName ?? view.away.clubName}`,
            when: `${exactDate(view.date)}${view.kickoffTime ? ` · ${view.kickoffTime.slice(0, 5)}` : ""}`,
          }}
          onClose={() => setCancelOpen(false)}
          saving={cancelSaving}
          problem={cancelProblem}
          onConfirm={(reason) => void confirmCancel(reason)}
        />
      )}
    </View>
  )
}
