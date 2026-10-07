import { ScrollView, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  agendaDays,
  agendaRoundGroups,
  agendaTables,
  gamesByDay,
  type ParticipantContext,
  type ParticipantGame,
  type ParticipantPairing,
  type TournamentParticipantCentre,
} from "@ovalball/contracts/tournaments/participant-centre"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { CalendarDays, MapPin } from "../components/icons"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE TOURNAMENT AGENDA -- the published programme, read-only.
 *
 * AGENDA IS NOT PLANNING. Planning is the organiser's tool for building the day; this is the result of
 * it, as everybody else sees it. Nothing here edits, reorders or schedules anything, and there is no
 * control on this screen that writes.
 *
 * IT IS A PROJECTION, NEVER A SECOND SCHEDULE. Every game comes from `tournament_games` through the
 * one participant read. There is no local ordering rule, no derived kick-off and no inferred round: if
 * a fact is not in the canonical plan it does not appear here.
 *
 * NOTHING IS FABRICATED. A tournament whose organiser has not published a plan shows one clear
 * sentence saying exactly that. Placeholder games, greyed-out rows and "TBC v TBC" are all worse than
 * an honest empty state, because each of them reads as information.
 *
 * THE DAYS COME FROM THE TOURNAMENT, not from the games. A festival that runs Saturday and Sunday has
 * two days whether or not Sunday's programme exists yet, so a published Saturday does not make the
 * tournament look like a one-day event.
 *
 * COMPETITION-AWARE. The games shown are the selected age group's, because a U12 parent reading the
 * U16 programme is reading somebody else's day.
 */
export function TournamentAgendaTab({
  centre,
  context,
}: {
  centre: TournamentParticipantCentre
  context: ParticipantContext | null
}) {
  const tabBar = useTabBarHeight()
  // THE COMPETITION'S OWN DAYS once a plan is published -- the same days the Calendar counts, so the
  // Sunday of a Friday-to-Sunday festival that skips the Saturday is Day 2 of 2 on both surfaces
  // rather than Day 2 on one and Day 3 on the other.
  const days = agendaDays(context?.competitionDays ?? [], centre.startsOn, centre.endsOn)
  const multiDay = days.length > 1
  const scheduled = gamesByDay(context?.games ?? [])
  const pairings = context?.pairings ?? []
  // A DRAW RATHER THAN A SET OF TABLES is decided game by game below (a named knockout round, or a
  // table): the day grouping and the game row are shared, and a Hybrid's day holds both kinds.
  // A knockout's published plan may legitimately have no games yet -- every opening pairing scheduled
  // and nobody qualified -- so the empty state must not fire on an empty game list alone.
  const pairingsByDay = new Map<string, ParticipantPairing[]>()
  for (const p of pairings) {
    const list = pairingsByDay.get(p.gameDate) ?? []
    list.push(p)
    pairingsByDay.set(p.gameDate, list)
  }
  // A bye has no game, so it is said on the day its round is played -- the round's games' day, or its
  // reserved place's day before the round is paired.
  const byeDay = (round: number): string | null =>
    (context?.games ?? []).find((g) => g.round === round)?.gameDate ?? pairings.find((p) => p.roundName === `Round ${round}`)?.gameDate ?? null
  const dayKeys = Array.from(new Set([...scheduled.map((d) => d.date), ...pairingsByDay.keys()])).sort()

  if (!context || (context.games.length === 0 && pairings.length === 0)) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, paddingBottom: tabBar, gap: space.md }}>
        <View style={{ width: 64, height: 64, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line }}>
          <CalendarDays size={28} color={colour.inkSubtle} strokeWidth={1.8} />
        </View>
        {/* THE SENTENCE IS THE DESIGN. It says what is true -- nothing has been published -- and what
            will happen, so somebody who came looking for kick-off times knows to come back rather
            than wondering whether the screen is broken. */}
        <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 17, textAlign: "center", lineHeight: 24 }]}>
          No tournament plan{"\n"}has been published yet.
        </Text>
        <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", lineHeight: 21, maxWidth: 300 }]}>
          The organiser will publish fixtures, pitch allocations and timings here when they&rsquo;re ready.
        </Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.lg }}>
      {dayKeys.map((date) => (
        <View key={date} style={{ gap: space.sm }}>
          {/* DAY 1 / DAY 2 ONLY WHERE THERE IS MORE THAN ONE, numbered against the days this
              COMPETITION plays. A day it does not play is not one of its days. */}
          <Text style={[type.overline, { color: colour.inkSubtle }]}>
            {multiDay ? `DAY ${days.indexOf(date) + 1} · ${dayLabel(date)}` : dayLabel(date).toUpperCase()}
          </Text>
          {/* THE SAME HIERARCHY THE ORGANISER BUILT -- table, then round, then the games. Read-only:
              nothing on this screen writes, reorders or schedules anything. A tournament with no
              tables at all (hand-made fixtures) draws the games straight, with no empty chrome. */}
          {agendaTables(gamesOn(scheduled, date).filter((g) => g.roundName === null)).map((table, ti) => (
            <View key={table.tableName ?? `untabled-${ti}`} style={{ gap: space.xs }}>
              {/* A Tri-Fixture is three sides, not a table: its games are Game 1, 2 and 3. */}
              {!!table.tableName && centre.format !== "tri_fixture" && centre.format !== "swiss" && (
                <Text style={[type.smallMedium, { color: colour.ink, paddingTop: space.xs }]}>{table.tableName}</Text>
              )}
              {table.rounds.map((round, ri) => (
                <View key={round.round ?? `unrounded-${ri}`} style={{ gap: 4 }}>
                  {round.round !== null && (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>{centre.format === "tri_fixture" ? "Game" : "Round"} {round.round}</Text>
                  )}
                  <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
                    {round.games.map((g, i) => (
                      <GameRow key={g.id} game={g} first={i === 0} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
          {/* KNOCKOUT ROUNDS, named. A Hybrid's day can hold both: its group tables first, then the
              knockout stage after them -- each game drawn by what it is, never the day by its format. */}
          {agendaRoundGroups(gamesOn(scheduled, date).filter((g) => g.roundName !== null)).map((group, gi) => (
            <View key={group.roundName ?? `unnamed-${gi}`} style={{ gap: 4 }}>
              {!!group.roundName && (
                <Text style={[type.smallMedium, { color: colour.ink, paddingTop: space.xs }]}>{group.roundName}</Text>
              )}
              <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
                {group.games.map((g, i) => (
                  <GameRow key={g.id} game={g} first={i === 0} />
                ))}
              </View>
            </View>
          ))}

          {/* A SWISS BYE: the side sits the round out and is awarded a win. Said on the day of that round. */}
          {(context?.byes ?? []).filter((b) => byeDay(b.round) === date).map((b) => (
            <View key={`bye-${b.round}`} style={{ padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colour.lineStrong }}>
              <Text style={[type.small, { color: colour.ink, lineHeight: 20 }]}>{`Round ${b.round}: ${b.clubName} has a bye and is awarded a win.`}</Text>
            </View>
          ))}

          {/* SCHEDULED, BUT NOT YET A GAME. The organiser has booked the semi-final; nobody has
              qualified for it. The round name above and the time here are real and worth stating; who
              is playing in it is the bracket's own question, answered in Draw, never guessed at here.
              It is read-only and has no result, because it is not a game. */}
          {(pairingsByDay.get(date) ?? []).map((group, pi) => (
            <View key={group.pairingId} style={{ gap: 4, paddingTop: pi === 0 ? space.xs : 0 }}>
              {!!group.roundName && (
                <Text style={[type.smallMedium, { color: colour.ink }]}>{group.roundName}</Text>
              )}
              <PairingRow pairing={group} />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

/** That day's games out of the day grouping, which is shared with the round robin. */
function gamesOn(scheduled: { date: string; games: ParticipantGame[] }[], date: string): ParticipantGame[] {
  return scheduled.find((d) => d.date === date)?.games ?? []
}

/**
 * A PLACE IN THE DRAW THAT HAS A TIME BUT NOT YET TWO SIDES.
 *
 * Drawn deliberately quieter than a game and with a dashed edge, because it is not one: there is no
 * canonical fixture behind it, no result to come from it and nothing to tap into. What it carries is
 * real and useful -- when and where the semi-final is. WHO is playing in it is not Agenda's to say:
 * that is the bracket's own job, and lives in Draw. Agenda states only that the slot exists and when
 * it is scheduled, never a "Winner QF1" or "To be decided" guess at identity.
 */
function PairingRow({ pairing }: { pairing: ParticipantPairing }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: colour.lineStrong,
      }}
    >
      <Text style={[type.smallMedium, { color: colour.inkMuted }]}>
        {pairing.startTime ? pairing.startTime.slice(0, 5) : "Time to be confirmed"}
      </Text>
      {!!pairing.pitchName && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, flex: 1 }]}>{pairing.pitchName}</Text>
      )}
    </View>
  )
}

/**
 * ONE GAME. Time and pitch on the left, the two sides on the right, the score where one exists.
 *
 * NEITHER SIDE IS "OURS" BY POSITION. A tournament game is between any two participating sides, so
 * there is no home-and-away orientation to express and none is implied; the viewer's own side is
 * marked instead, which is the fact they are actually scanning for.
 */
function GameRow({ game, first }: { game: ParticipantGame; first: boolean }) {
  const played = game.sideA.score !== null && game.sideB.score !== null
  const cancelled = game.status === "CANCELLED"

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        opacity: cancelled ? 0.6 : 1,
      }}
    >
      <View style={{ width: 54 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{game.startTime ? String(game.startTime).slice(0, 5) : "--:--"}</Text>
        {!!game.pitchName && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <MapPin size={10} color={colour.inkMuted} />
            <Text numberOfLines={1} style={[type.caption, { flex: 1, color: colour.inkMuted, fontSize: 10 }]}>{game.pitchName}</Text>
          </View>
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <SideLine side={game.sideA} score={played ? game.sideA.score : null} />
        <SideLine side={game.sideB} score={played ? game.sideB.score : null} />
      </View>

      {cancelled && <Text style={[type.caption, { color: colour.danger, fontFamily: "Inter_600SemiBold" }]}>Cancelled</Text>}
    </View>
  )
}

function SideLine({ side, score }: { side: ParticipantGame["sideA"]; score: number | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <ClubCrest clubName={side.clubName} url={clubLogoUrlFromPath(supabase, side.crestPath)} size={20} />
      <Text
        numberOfLines={1}
        style={[
          side.isMine ? type.smallMedium : type.small,
          { flex: 1, color: side.isMine ? colour.ink : colour.inkMuted },
        ]}
      >
        {side.clubName}
      </Text>
      {score !== null && <Text style={[type.smallMedium, { color: colour.ink }]}>{score}</Text>}
    </View>
  )
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Saturday 7 Nov" -- the same shape the Calendar's own day heading uses. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${d} ${MONTHS[m - 1]}`
}
