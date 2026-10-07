import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { FORMAT_ICON } from "../../../../src/tournaments/format-icon"
import { readTournamentCapabilities } from "@ovalball/contracts/club/tournaments"
import { resolveTournamentCover } from "@ovalball/contracts/tournament-cover"
import { TournamentPhotoControl, applyTournamentCoverChoice, type TournamentCoverChoice } from "../../../../src/tournaments/cover-control"
import { formatLabel } from "@ovalball/contracts/club/tournaments"
import {
  applicationCounts,
  readTournamentDetail,
  teamCountAtGrade,
  totalTeamCount,
  type TournamentDetail,
} from "@ovalball/contracts/club/tournament-detail"

import { supabase } from "../../../../src/auth/supabase"
import { useCurrentStack, withinStack } from "../../../../src/links/stack"
import { TournamentDetailHeader, dateRange, dayCount, type TournamentTab } from "../../../../src/tournaments/detail-chrome"
import { TournamentStandingsTab } from "../../../../src/tournaments/standings-tab"
import { TournamentResultsTab } from "../../../../src/tournaments/results-tab"
import { TournamentDrawTab } from "../../../../src/tournaments/draw-tab"
import { TournamentTeamsTab } from "../../../../src/tournaments/teams-tab"
import { TournamentRequestsTab } from "../../../../src/tournaments/requests-tab"
import { TournamentPlanningTab } from "../../../../src/tournaments/planning-home"
import { EditTournamentSheet } from "../../../../src/tournaments/edit-sheet"
import { ChevronRight, Clock, CalendarDays, Globe, Info, Layers, ListOrdered, Lock, MapPin, Shirt, Trophy, Users } from "../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"
import { useTabBarHeight } from "../../../../src/navigation/use-tab-bar-height"

/**
 * A TOURNAMENT, AFTER IT EXISTS.
 *
 * Four tabs over ONE loaded tournament. Overview is the management dashboard, Teams is the field,
 * Requests is who has asked to come, and Planning is the next phase and deliberately empty.
 *
 * ONE READ, RELOADED AFTER EVERY CHANGE. Every tab renders from the same `detail`, so a team added on
 * Teams changes the count on Overview without either screen telling the other. `reload` is what every
 * mutation calls when it finishes: the database is the state, and this is the view of it.
 */
export default function TournamentDetailScreen() {
  const router = useRouter()
  const stack = useCurrentStack()
  const { tournamentId, tab: tabParam } = useLocalSearchParams<{ tournamentId: string; tab?: string }>()
  const [tab, setTab] = useState<TournamentTab>("Overview")
  // A ROUTE THAT NAMES A TAB OPENS IT: Planning's "Add Another Team" promises the Teams tab.
  useEffect(() => {
    if (tabParam === "teams") setTab("Teams")
    else if (tabParam === "planning") setTab("Planning" as TournamentTab)
  }, [tabParam])
  const [detail, setDetail] = useState<TournamentDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState<null | "details" | "ageGroups">(null)
  const [canManage, setCanManage] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverProblem, setCoverProblem] = useState<string | null>(null)
  // WHERE THE TABLES TAB SENT THEM. A table's games are the Results tab filtered, not a third screen.
  const [resultsFocus, setResultsFocus] = useState<{ ageGroup: string; tableId: string } | null>(null)

  const reload = useCallback(async () => {
    if (!tournamentId) return
    try {
      const d = await readTournamentDetail(supabase, tournamentId)
      if (d) setDetail(d)
      else setMissing(true)
    } catch {
      setMissing(true)
    }
  }, [tournamentId])

  useEffect(() => {
    void reload()
  }, [reload])

  // CAN THIS PERSON MANAGE THIS TOURNAMENT'S HOSTING CLUB? Asked of the server, for the HOST club
  // rather than the club being viewed -- a club can see a public tournament another club runs, and
  // offering it a Change Photo control that is refused every time is a worse answer than not offering
  // one. The server still refuses regardless; this only stops the app proposing something it cannot do.
  useEffect(() => {
    if (!detail?.hostClubId) return
    let live = true
    void readTournamentCapabilities(supabase, detail.hostClubId)
      .then((c) => {
        if (!live) return
        setCanManage(c.manage)
        // THE ORGANISER'S SCREEN IS FOR THE ORGANISER -- the mirror of the Tournament Centre sending a
        // manager here. A club attending somebody else's tournament was shown Edit on every card, and the
        // host's Requests and Planning, all of which the server refuses; it belongs in the Tournament
        // Centre. Only on the server's ANSWER: silence is not "not allowed", and acting on it could send a
        // real organiser away. Both screens ask the same resolver, so they cannot hand a person back and forth.
        if (c.answered && !c.manage) {
          router.replace(withinStack({ pathname: "/tournaments/[tournamentId]", params: { tournamentId: detail.id } }, stack) as never)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [detail?.hostClubId, detail?.id, router, stack])

  /** CHANGES THIS TOURNAMENT, never creates one: `set_tournament_cover` is keyed on the id, and the
   * server re-checks `tournament.tournament.manage` at the hosting club before it writes anything. */
  const changeCover = useCallback(
    async (choice: TournamentCoverChoice) => {
      if (!detail?.hostClubId) return
      setCoverBusy(true)
      setCoverProblem(null)
      const problem = await applyTournamentCoverChoice(
        { supabase, clubId: detail.hostClubId, tournamentId: detail.id },
        choice,
      )
      setCoverProblem(problem)
      setCoverBusy(false)
      if (!problem) await reload()
    },
    [detail?.hostClubId, detail?.id, reload],
  )

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center", padding: space.xl }}>
        <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>
          That tournament could not be opened. It may have been cancelled, or it may not be one this club can see.
        </Text>
      </View>
    )
  }

  if (!detail) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colour.forest800} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <TournamentDetailHeader detail={detail} tab={tab} onTab={setTab} />

      {tab === "Overview" && (
        <OverviewTab
          detail={detail}
          onEdit={setEditing}
          onJumpToTeams={() => setTab("Teams")}
          canManage={canManage}
          onCover={changeCover}
          coverBusy={coverBusy}
          coverProblem={coverProblem}
        />
      )}
      {tab === "Teams" && <TournamentTeamsTab detail={detail} onChanged={reload} />}
      {tab === "Requests" && <TournamentRequestsTab detail={detail} onChanged={reload} />}
      {tab === "Planning" && <TournamentPlanningTab detail={detail} onEditDetails={() => setEditing("details")} />}
      {/*
        RESULTS AND TABLES, over the same loaded tournament as every other tab. Neither is a second
        Tournament Centre: Results is the list of games needing a human, Tables is the standings those
        results produce, and both pick their competition with the shared chooser.
      */}
      {tab === "Results" && (
        <TournamentResultsTab
          tournamentId={detail.id}
          ageGroups={detail.ageGroups}
          submissionEnabled={detail.resultsSubmissionEnabled}
          initialAgeGroup={resultsFocus?.ageGroup ?? null}
          initialTableId={resultsFocus?.tableId ?? null}
        />
      )}
      {tab === "Draw" && (
        <TournamentDrawTab tournamentId={detail.id} ageGroup={null} ageGroups={detail.ageGroups} />
      )}
      {tab === "Tables" && (
        <TournamentStandingsTab
          tournamentId={detail.id}
          ageGroup={null}
          ageGroups={detail.ageGroups}
          canManage
          onViewTable={(tableId, ageGroup) => {
            setResultsFocus({ tableId, ageGroup })
            setTab("Results")
          }}
        />
      )}

      <EditTournamentSheet
        detail={detail}
        section={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void reload()
        }}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------------------------------

function OverviewTab({
  detail,
  onEdit,
  onJumpToTeams,
  canManage,
  onCover,
  coverBusy,
  coverProblem,
}: {
  detail: TournamentDetail
  onEdit: (s: "details" | "ageGroups") => void
  onJumpToTeams: () => void
  canManage: boolean
  onCover: (choice: TournamentCoverChoice) => void
  coverBusy: boolean
  coverProblem: string | null
}) {
  const total = totalTeamCount(detail)
  const days = dayCount(detail.startsOn, detail.endsOn)
  const isPublic = detail.visibility === "public"
  const FormatIcon = FORMAT_ICON[detail.format]
  const tabBar = useTabBarHeight()

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      {/* THE PHOTOGRAPH, FIRST. It is the thing that tells this tournament apart from the others in
          the list, and changing it here EDITS THIS TOURNAMENT -- `set_tournament_cover` takes the id,
          so there is no path from this control to creating a second one. */}
      {canManage && (
        <Card title="Tournament Photo">
          <TournamentPhotoControl
            hideLabel
            current={resolveTournamentCover({ supabase, coverImagePath: detail.coverImagePath, coverStockKey: detail.coverStockKey })}
            onChoose={onCover}
            busy={coverBusy}
            problem={coverProblem}
          />
        </Card>
      )}

      <Card title="Tournament Details" onEdit={() => onEdit("details")}>
        <Row icon={<CalendarDays size={16} color={colour.rugby700} strokeWidth={1.9} />} value={dateRange(detail.startsOn, detail.endsOn)} secondary={days > 1 ? `${days} days` : null} />
        {!!detail.kickoffTime && <Row icon={<Clock size={16} color={colour.rugby700} strokeWidth={1.9} />} value={detail.kickoffTime} />}
        <Row icon={<MapPin size={16} color={colour.rugby700} strokeWidth={1.9} />} value={detail.venueName ?? "No venue"} secondary={detail.venueAddress} />
        <Row icon={<FormatIcon size={16} color={colour.rugby700} strokeWidth={1.9} />} value={formatLabel(detail.format, detail.swissRounds)} />
        <Row
          icon={isPublic ? <Globe size={16} color={colour.rugby700} strokeWidth={1.9} /> : <Lock size={16} color={colour.rugby700} strokeWidth={1.9} />}
          value={isPublic ? "Public" : "Private"}
          secondary={isPublic ? "Clubs can find this tournament and apply to enter." : "Invite only. It will not appear in public tournament search."}
        />
      </Card>

      <Card title="Age Groups" onEdit={() => onEdit("ageGroups")}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {detail.ageGroups.map((g) => (
            <View key={g} style={{ minHeight: 30, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: colour.forest800 }}>
              <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{g}</Text>
            </View>
          ))}
          {detail.ageGroups.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No age groups yet.</Text>}
        </View>
      </Card>

      <Card title="Teams Overview" onEdit={onJumpToTeams}>
        {detail.ageGroups.map((g) => (
          <Pressable
            key={g}
            accessibilityRole="button"
            accessibilityLabel={`${g}, ${teamsLabel(teamCountAtGrade(detail, g))}. Manage teams`}
            onPress={onJumpToTeams}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <Shirt size={17} color={colour.inkSubtle} strokeWidth={1.8} />
            <Text style={[type.small, { flex: 1, color: colour.ink }]}>{g}</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>{teamsLabel(teamCountAtGrade(detail, g))}</Text>
            <ChevronRight size={16} color={colour.inkSubtle} strokeWidth={1.9} />
          </Pressable>
        ))}

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
          <Users size={18} color={colour.rugby700} strokeWidth={1.9} />
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Total Teams</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              across {detail.ageGroups.length === 1 ? "1 age group" : `${detail.ageGroups.length} age groups`}
            </Text>
          </View>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{teamsLabel(total)}</Text>
        </View>
      </Card>
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------------------------------
// PLANNING -- deliberately a holding state.
// ---------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------

export function Card({ title, onEdit, editLabel = "Edit", children }: { title: string; onEdit?: () => void; editLabel?: string; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{title}</Text>
        {onEdit && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${editLabel} ${title}`} onPress={onEdit} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingLeft: space.sm })}>
            <Text style={[type.smallMedium, { color: colour.rugby700 }]}>{editLabel}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  )
}

function Row({ icon, value, secondary }: { icon: React.ReactNode; value: string; secondary?: string | null }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <View style={{ width: 18, alignItems: "center", paddingTop: 1 }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: colour.ink }]}>{value}</Text>
        {!!secondary && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1, lineHeight: 16 }]}>{secondary}</Text>}
      </View>
    </View>
  )
}

export function teamsLabel(n: number): string {
  return n === 1 ? "1 team" : `${n} teams`
}

export const OVERVIEW_INFO_ICON = Info
