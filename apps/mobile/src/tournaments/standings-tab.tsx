import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  pointsExplanation,
  readTournamentStandings,
  resultScoreLine,
  tableStatus,
  tableStatusLabel,
  tieBreakerExplanation,
  type StandingsTable,
  type TournamentStandings,
} from "@ovalball/contracts/tournaments/standings"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { ChevronRight, Trophy } from "../components/icons"
import { CardSkeleton, EmptyState, ErrorState, InfoNote } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../design/tokens"

import { CompetitionChooser, longDate } from "./detail-chrome"

/**
 * THE TABLE, FOR EVERYBODY WHO MAY SEE IT.
 *
 * ONE IMPLEMENTATION, TWO AUDIENCES. The club running the festival and the parent standing on the
 * touchline read the same table from the same component: a competition's standings are a fact about
 * the competition, not a view of it, and a second organiser-flavoured table would be the first place
 * the two could start disagreeing. The server already decides what each of them is allowed to see.
 *
 * NOTHING HERE CALCULATES ANYTHING. Not the points, not the order, not the positions. The standings
 * arrive calculated and ordered by `internal.tournament_table_ordered`, which applies the organiser's
 * own tie-breakers -- so the number in the Pts column and the row it sits in are the database's answer,
 * drawn. A client that re-sorted would be a second opinion about who is top.
 *
 * AND IT SAYS HOW IT GOT THERE. The scoring system and the tie-break order are printed under the
 * table, because a table nobody can check is a table somebody will argue with.
 */
export function TournamentStandingsTab({
  tournamentId,
  ageGroup,
  ageGroups,
  canManage = false,
  onViewTable,
}: {
  tournamentId: string
  /**
   * THE COMPETITION, WHERE THE SCREEN ABOVE ALREADY ESTABLISHED IT. The participant Centre has its own
   * context switcher in the chrome, so this tab follows it rather than offering a second one.
   */
  ageGroup: string | null
  /** The competitions to choose between, where the screen above has no chooser of its own. */
  ageGroups: readonly string[]
  /** The organiser gets the route through to the games; a participant reads the Agenda instead. */
  canManage?: boolean
  /**
   * THROUGH TO THE GAMES BEHIND A TABLE. A callback rather than a route, because the destination is
   * the Results tab of the screen this tab is already in -- and a second screen listing the same games
   * would be a second place for a game's state to be described.
   */
  onViewTable?: (tableId: string, ageGroup: string) => void
}) {
  const tabBar = useTabBarHeight()
  const [grade, setGrade] = useState<string | null>(ageGroup ?? ageGroups[0] ?? null)
  const competition = ageGroup ?? grade
  const [standings, setStandings] = useState<TournamentStandings | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tableId, setTableId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!competition) {
      setStandings(null)
      setLoading(false)
      return
    }
    try {
      setProblem(null)
      const next = await readTournamentStandings(supabase, tournamentId, competition)
      setStandings(next)
      setTableId((current) => {
        if (current && next?.tables.some((t) => t.id === current)) return current
        return next?.tables[0]?.id ?? null
      })
    } catch (caught) {
      const failure = friendly(caught, "this table")
      logDetail("tournament standings", failure)
      setProblem(failure.message)
    } finally {
      setLoading(false)
    }
  }, [tournamentId, competition])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // THE CHOOSER SITS ABOVE EVERY STATE, including the empty ones. An organiser whose U12 table is not
  // published yet must still be able to reach the U16 one, and a chooser that disappears with its
  // content strands them on the competition they did not want.
  const chooser = ageGroup ? null : (
    <CompetitionChooser
      ageGroups={ageGroups}
      selected={competition}
      onSelect={setGrade}
      labelFor={(g) => `Show the ${g} table`}
    />
  )

  if (loading) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
        {chooser}
        <CardSkeleton lines={4} />
      </View>
    )
  }

  if (problem) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
        {chooser}
        <ErrorState message={problem} onRetry={() => void load()} />
      </View>
    )
  }

  // WHAT THE READER MAY SEE, SAID PLAINLY. Three different nothings, and conflating them is how a
  // parent decides the app is broken when the club simply has not published yet.
  if (!standings) {
    return (
      <Nothing chooser={chooser} title="No table to show"
        body={competition
          ? "This competition's results are not available to you."
          : "This tournament has no competitions yet."} />
    )
  }
  if (standings.restricted) {
    return (
      <Nothing chooser={chooser} title="Results are for participants"
        body="The organiser has kept this competition's results to the clubs taking part." />
    )
  }
  if (!standings.published) {
    return (
      <Nothing chooser={chooser} title="No table yet"
        body="The organiser has not published the programme for this competition. A table appears once they do." />
    )
  }
  if (standings.tables.length === 0) {
    return (
      <Nothing chooser={chooser} title="No tables in this competition"
        body="The published programme does not divide this competition into tables." />
    )
  }

  const table = standings.tables.find((t) => t.id === tableId) ?? standings.tables[0]

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.md, paddingBottom: tabBar + space.lg, gap: space.md }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            void load().finally(() => setRefreshing(false))
          }}
          tintColor={colour.forest800}
        />
      }
    >
      {chooser}

      {/* WHICH TABLE. Only where there is more than one: a control with a single option is furniture. */}
      {standings.tables.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
          {standings.tables.map((t) => {
            const on = t.id === table.id
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.name}
                onPress={() => setTableId(t.id)}
                style={({ pressed }) => ({
                  minHeight: 34,
                  paddingHorizontal: space.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.pill,
                  backgroundColor: on ? colour.forest800 : colour.surface,
                  borderWidth: 1,
                  borderColor: on ? colour.forest800 : colour.line,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{t.name}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      <StandingsCard table={table} />

      <View style={{ gap: 4, paddingHorizontal: space.xs }}>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{pointsExplanation(standings.points)}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{tieBreakerExplanation(standings.tieBreakers)}</Text>
      </View>

      <RecentResultsCard
        table={table}
        onViewTable={canManage && onViewTable ? () => onViewTable(table.id, standings.ageGroup) : null}
      />
    </ScrollView>
  )
}

function Nothing({
  title,
  body,
  chooser,
}: {
  title: string
  body: string
  chooser?: ReactNode
}) {
  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      {chooser}
      <EmptyState title={title} body={body} icon={<Trophy size={24} color={colour.inkSubtle} />} />
    </View>
  )
}

/**
 * THE WIDTHS OF THE NUMERIC COLUMNS, declared once so the header and every row line up by construction.
 *
 * THEY ARE AS NARROW AS THE NUMBERS ALLOW, and that is the whole design problem of this card. Nine
 * columns and a club name do not fit across a phone, and rugby club names are long -- "Clitheroe Rugby
 * Football Club" is an ordinary name, not an unusual one. Every point taken from a numeric column is a
 * point given to the name, so the stats sit at caption size with the tightest gap the figures stay
 * legible at, and the NAME IS ALLOWED TO WRAP rather than being cut off. A truncated club is a club a
 * parent has to guess at.
 */
const COL = { pos: 14, stat: 15, points: 21, pd: 25, pts: 24, gap: 3 } as const

function StandingsCard({ table }: { table: StandingsTable }) {
  const status = tableStatus(table)

  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }}>
        <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{table.name}</Text>
        {/*
          "LIVE" MEANS THE TABLE LOOKS AFTER ITSELF -- it is a projection that moves as results are
          agreed, with nothing to publish and nothing to recalculate. It deliberately does NOT claim a
          game is in progress: Ovalball does not know that. Once every game is settled the table is not
          live, it is FINAL, which is the more useful thing to be told.
        */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: space.sm,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor:
              status === "live" ? colour.successSurface : status === "complete" ? colour.mint100 : colour.chalk,
            borderWidth: 1,
            borderColor: status === "awaiting" ? colour.line : "transparent",
          }}
        >
          {status === "live" && (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.pitch600 }} />
          )}
          <Text style={[type.caption, { color: status === "awaiting" ? colour.inkMuted : colour.forest800, fontSize: 11 }]}>
            {tableStatusLabel(status)}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.sm,
          paddingBottom: 6,
          gap: COL.gap,
        }}
      >
        <Text style={[type.caption, { width: COL.pos, color: colour.inkSubtle }]}>#</Text>
        <Text style={[type.caption, { flex: 1, color: colour.inkSubtle }]}>Team</Text>
        {(["P", "W", "D", "L"] as const).map((h) => (
          <Text key={h} style={[type.caption, { width: COL.stat, textAlign: "center", color: colour.inkSubtle, fontSize: 11 }]}>
            {h}
          </Text>
        ))}
        {(["PF", "PA"] as const).map((h) => (
          <Text key={h} style={[type.caption, { width: COL.points, textAlign: "center", color: colour.inkSubtle }]}>
            {h}
          </Text>
        ))}
        <Text style={[type.caption, { width: COL.pd, textAlign: "center", color: colour.inkSubtle }]}>PD</Text>
        <Text style={[type.caption, { width: COL.pts, textAlign: "right", color: colour.inkSubtle }]}>Pts</Text>
      </View>

      {table.rows.map((row, index) => (
        <View
          key={row.participantId}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: COL.gap,
            paddingHorizontal: space.sm,
            paddingVertical: space.sm,
            borderTopWidth: 1,
            borderTopColor: colour.line,
            backgroundColor: index % 2 === 1 ? colour.chalk : colour.surface,
          }}
        >
          <Text style={[type.caption, { width: COL.pos, color: colour.inkMuted }]}>{row.position}</Text>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5 }}>
            {/* A REAL CREST, NEVER TINTED OR SUBSTITUTED. */}
            <ClubCrest clubName={row.clubName} url={clubLogoUrlFromPath(supabase, row.crestPath)} size={22} />
            <View style={{ flex: 1 }}>
              {/*
                TEAM IDENTITY IS THE COLUMN THAT MATTERS after the position, so it keeps the app's own
                small body size rather than being shrunk to buy room for figures. The numbers are the
                ones that compress: a two-digit score is still legible at 11, a club's name is not.
              */}
              <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink, lineHeight: 17 }]}>
                {row.clubName}
              </Text>
              {/*
                AND THE SIDE BENEATH IT, because a club may bring more than one. Four indistinguishable
                Wigan rows is the failure this line prevents.
              */}
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>
                {row.label}
              </Text>
            </View>
          </View>
          {[row.played, row.won, row.drawn, row.lost].map((v, i) => (
            <Text key={i} style={[type.caption, { width: COL.stat, textAlign: "center", color: colour.inkMuted, fontSize: 11 }]}>
              {v}
            </Text>
          ))}
          <Text style={[type.caption, { width: COL.points, textAlign: "center", color: colour.inkMuted, fontSize: 11 }]}>{row.pointsFor}</Text>
          <Text style={[type.caption, { width: COL.points, textAlign: "center", color: colour.inkMuted, fontSize: 11 }]}>{row.pointsAgainst}</Text>
          <Text style={[type.caption, { width: COL.pd, textAlign: "center", color: colour.inkMuted, fontSize: 11 }]}>
            {/* THE SIGN IS THE POINT of a points difference, so a positive one carries its plus. */}
            {row.pointsDifference > 0 ? `+${row.pointsDifference}` : row.pointsDifference}
          </Text>
          <Text style={[type.smallMedium, { width: COL.pts, textAlign: "right", color: colour.forest800 }]}>{row.points}</Text>
        </View>
      ))}

      {table.rows.length === 0 && (
        <View style={{ paddingHorizontal: space.sm, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colour.line }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>No sides have been placed in this table yet.</Text>
        </View>
      )}
    </View>
  )
}

function RecentResultsCard({
  table,
  onViewTable,
}: {
  table: StandingsTable
  onViewTable: (() => void) | null
}) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
      <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 6 }}>
        <Text style={[type.heading, { color: colour.ink }]}>Recent Results</Text>
      </View>

      {table.recentResults.length === 0 ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
          <InfoNote>
            Nothing is settled yet. A score appears here once both sides agree it, or the organiser
            settles it.
          </InfoNote>
        </View>
      ) : (
        table.recentResults.map((result) => (
          <View
            key={result.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderTopWidth: 1,
              borderTopColor: colour.line,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                {result.sideA.clubName}
              </Text>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                {result.sideB.clubName}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{resultScoreLine(result)}</Text>
              <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>
                {result.round ? `Round ${result.round} · ` : ""}
                {longDate(result.date)}
              </Text>
            </View>
          </View>
        ))
      )}

      {/*
        THROUGH TO THE GAMES THEMSELVES -- the organiser's Results list, where every game in the table
        is, settled or not. A participant has the Agenda for that and is not sent to a surface that
        would refuse them.
      */}
      {!!onViewTable && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View all fixtures for ${table.name}`}
          onPress={onViewTable}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderTopWidth: 1,
            borderTopColor: colour.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={[type.smallMedium, { flex: 1, color: colour.forest800 }]}>
            View all fixtures for {table.name}
          </Text>
          <ChevronRight size={16} color={colour.forest800} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  )
}
