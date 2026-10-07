import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  type ParticipantAttendanceRow,
  type ParticipantContext,
  type TournamentParticipantCentre,
} from "@ovalball/contracts/tournaments/participant-centre"
import {
  attendanceConfirmation,
  availabilityQuestion,
  availabilitySubject,
  groupKeyForStatus,
  ATTENDANCE_GROUP_ORDER,
  ATTENDANCE_STATE_WORDS,
  type AttendanceGroupKey,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"

import { supabase } from "../auth/supabase"
import { AvailabilityChoice } from "../components/availability-choice"
import { ClubCrest, PersonAvatar } from "../components/identity"
import { Users } from "../components/icons"
import { EmptyState } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { exactDate } from "../agenda/presentation"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../design/tokens"

type RosterPlayer = {
  playerId: string
  firstName: string
  surname: string
  status: AvailabilityStatus | null
}

/**
 * WHO IS COMING -- and, for the people entitled to say, whether they are.
 *
 * THE PRIVACY BOUNDARY IS THE POINT OF THIS SCREEN, and it is enforced in the database rather than
 * here. `get_tournament_participant_centre` returns, for every club but the viewer's own, exactly one
 * attendance number: ATTENDING. How many of another club's players cannot attend, how many are unsure,
 * how many have not answered and which children they are never enter the payload. A screen that simply
 * declined to draw them would already have received them.
 *
 * WHY ATTENDING CROSSES THE BOUNDARY AT ALL. It is the number the day is organised around -- pitches,
 * timings, catering, how many are actually turning up. The rest is a club's own business.
 *
 * ONE ANSWER PER TOURNAMENT. Not per day and not per game. A two-day festival appears on both calendar
 * days and asks once, because a club takes one squad away for the weekend; the record is keyed on the
 * tournament, so answering from Saturday's entry is the same answer Sunday's entry shows.
 *
 * THE AUTHORITY IS THE ONE OVALBALL ALREADY HAS. `internal.resolve_attendance_response_source` decides
 * who may answer for whom -- an active guardian, an adult player for themselves, a 16- or 17-year-old
 * only with recorded consent, nobody under 16 -- and there is NO staff override here, exactly as there
 * is none for a fixture, a training session or a club event. `canRespond` only decides whether a
 * control is drawn; the write refuses on its own whether or not one was.
 */
export function TournamentAttendanceTab({
  centre,
  context,
  onChanged,
}: {
  centre: TournamentParticipantCentre
  context: ParticipantContext | null
  onChanged: () => Promise<void>
}) {
  const tabBar = useTabBarHeight()
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  /*
    MY TEAM FIRST. The design opens on the viewer's own side, because "are WE sorted" is the question
    somebody came for; the rest of the field is a deliberate second step rather than a list to scroll
    past. It is a VIEW filter and nothing else -- All Teams reveals no more about another club than
    My Team already did, because the payload never carried it.
  */
  const [view, setView] = useState<"mine" | "all">("mine")

  if (!context) {
    return <EmptyState title="Nothing to show" body="No competition is selected." icon={<Users size={24} color={colour.inkSubtle} />} />
  }

  const mine = context.attendance.filter((a) => a.isMine)
  const others = context.attendance.filter((a) => !a.isMine)
  // Only the players in THIS competition: a guardian with a child at U12 and another at U16 answers
  // for each in the context that child is actually playing in.
  const players = centre.myPlayers.filter((p) => p.ageGroup === context.ageGroup)

  async function answer(playerId: string, firstName: string, isSelf: boolean, status: AvailabilityStatus): Promise<boolean> {
    setProblem(null)
    const { error } = await supabase.rpc("respond_to_tournament_attendance", {
      p_tournament_id: centre.id,
      p_player_id: playerId,
      p_status: status,
    })
    if (error) {
      const failure = friendly(error, "this tournament")
      logDetail("tournament attendance", failure)
      setProblem(failure.message)
      return false
    }
    /*
      A STATEMENT ABOUT THE PERSON, not a report that a record was written -- the shared
      `attendanceConfirmation`, so the tournament half of the product says it in the same words as
      the fixture and training halves.
    */
    setConfirmation(
      attendanceConfirmation({
        status,
        subjectFirstName: isSelf ? null : firstName,
        kind: "tournament",
        whenLabel: exactDate(centre.startsOn),
        venueName: centre.venueName,
      })
    )
    await onChanged()
    return true
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      {/* The two views, where the viewer actually has a side of their own to distinguish from the
          rest. A club with nothing entered in this competition has only one thing to look at. */}
      {mine.length > 0 && others.length > 0 && (
        <View style={{ flexDirection: "row", backgroundColor: colour.chalk, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, padding: 3, gap: 3 }}>
          {([["mine", "My Team"], ["all", "All Teams"]] as const).map(([key, label]) => {
            const on = view === key
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={label}
                onPress={() => setView(key)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 38,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm,
                  backgroundColor: on ? colour.forest800 : "transparent",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {/* ---- OUR OWN SIDE, IN FULL ---------------------------------------------------------- */}
      {mine.map((row) => (
        <OwnSideCard key={row.participantId} row={row} tournamentId={centre.id} />
      ))}

      {/* ---- ANSWERING, for the people this viewer is entitled to answer for ------------------ */}
      {players.length > 0 && view === "mine" && (
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
          <Text style={[type.bodyMedium, { color: colour.ink }]}>Your Response</Text>
          {/* ONE ANSWER FOR THE WHOLE TOURNAMENT. Said out loud on a multi-day festival, because a
              parent looking at a Saturday-and-Sunday event will otherwise reasonably wonder which day
              they are answering for. */}
          {centre.endsOn && centre.endsOn !== centre.startsOn && (
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>
              This tournament runs over more than one day. Your answer covers the whole tournament.
            </Text>
          )}
          {players.map((p) => (
              <View key={p.playerId} style={{ gap: space.xs }}>
                {p.canRespond ? (
                  /* THE SHARED CONTROL, which carries its own question, its own three answers in their
                     canonical order and its own accessible names. Match Centre and the Training Centre
                     draw the same one; a tournament does not get a fourth vocabulary. */
                  <AvailabilityChoice
                    question={availabilityQuestion("tournament", p.isSelf, p.firstName)}
                    committed={p.status}
                    disabled={false}
                    ground="light"
                    subject={availabilitySubject(p.isSelf, p.firstName)}
                    what={`the tournament on ${exactDate(centre.startsOn)}`}
                    onChoose={(status) => answer(p.playerId, p.firstName, p.isSelf, status)}
                  />
                ) : (
                  /* NOT A FAILURE AND NOT A PROMPT TO ASK AN ADMINISTRATOR. The canonical rules say
                     who may answer; where this viewer may not, the screen says so plainly rather than
                     drawing a control that would be refused. */
                  <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>
                    You cannot answer for {p.firstName} yourself.
                  </Text>
                )}
              </View>
          ))}
          {!!confirmation && <Text style={[type.caption, { color: colour.forest800, lineHeight: 17 }]}>{confirmation}</Text>}
          {!!problem && (
            <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 17 }]}>{problem}</Text>
          )}
        </View>
      )}

      {/* ---- EVERY OTHER CLUB: THE NUMBER COMING, AND NOTHING ELSE ---------------------------- */}
      {others.length > 0 && (view === "all" || mine.length === 0) && (
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <Text style={[type.bodyMedium, { color: colour.ink, paddingBottom: space.xs }]}>Other Teams ({context.ageGroup})</Text>
          {others.map((row) => (
            <View key={row.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
              <ClubCrest clubName={row.clubName} url={clubLogoUrlFromPath(supabase, row.crestPath)} size={30} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{row.clubName}</Text>
                {/* THE ONE NUMBER. A side with no Ovalball TEAM behind it has nobody to ask, which is
                    said as such rather than reported as nought attending.

                    NOT "not on Ovalball": the club may be perfectly well known to Ovalball and simply
                    entered without a squad. Whether a club has signed up is a different question from
                    whether it has a team in this competition, and only the second one is being
                    reported here. */}
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                  {row.attending === null ? "No squad on Ovalball" : `${row.attending} attending`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {mine.length === 0 && others.length === 0 && (
        <EmptyState
          title="No attendance yet"
          body="Nobody in this competition has answered."
          icon={<Users size={24} color={colour.inkSubtle} />}
        />
      )}
    </ScrollView>
  )
}

const CHIP_TONE: Record<AttendanceGroupKey, { tint: string; ink: string }> = {
  ATTENDING: { tint: "#e8f6ed", ink: colour.forest800 },
  UNSURE: { tint: "#fdf4df", ink: "#8a6500" },
  CANNOT_ATTEND: { tint: "#fdeceb", ink: colour.danger },
  AWAITING: { tint: colour.chalk, ink: colour.inkMuted },
}

/**
 * OUR OWN SIDE: WHO, not just how many.
 *
 * A compact summary row carries the same four states, same order, same colours the Match Centre
 * register already uses -- a parent meets one idea rather than two. Beneath it, the actual roster,
 * fetched separately from `get_tournament_participant_roster`: a genuinely different read, gated by
 * its own staff-level authority, because the shared centre payload is deliberately counts-only for
 * every side including this one.
 */
function OwnSideCard({ row, tournamentId }: { row: ParticipantAttendanceRow; tournamentId: string }) {
  const [roster, setRoster] = useState<RosterPlayer[] | "loading" | "unauthorized" | "error">("loading")
  const [filter, setFilter] = useState<AttendanceGroupKey | null>(null)

  useEffect(() => {
    let cancelled = false
    setRoster("loading")
    supabase
      .rpc("get_tournament_participant_roster", { p_tournament_id: tournamentId, p_participant_id: row.participantId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // UNAUTHORIZED IS NOT A FAILURE TO EXPLAIN. The summary row above already carries the
          // counts everyone in this view is entitled to; a viewer without the staff-level grant for
          // player-by-player detail simply does not get the roster underneath it.
          setRoster(error.code === "42501" ? "unauthorized" : "error")
          return
        }
        setRoster((data ?? []).map((p) => ({ playerId: p.player_id, firstName: p.first_name, surname: p.surname, status: p.status as AvailabilityStatus | null })))
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId, row.participantId])

  const value: Record<AttendanceGroupKey, number | null> = {
    ATTENDING: row.attending,
    UNSURE: row.unsure,
    CANNOT_ATTEND: row.cannotAttend,
    AWAITING: row.awaiting,
  }
  const total = (row.attending ?? 0) + (row.unsure ?? 0) + (row.cannotAttend ?? 0) + (row.awaiting ?? 0)

  const grouped: Record<AttendanceGroupKey, RosterPlayer[]> = { ATTENDING: [], UNSURE: [], CANNOT_ATTEND: [], AWAITING: [] }
  if (Array.isArray(roster)) {
    for (const p of roster) grouped[groupKeyForStatus(p.status)].push(p)
  }

  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest clubName={row.clubName} url={clubLogoUrlFromPath(supabase, row.crestPath)} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink }]}>{row.clubName}</Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{row.label}</Text>
        </View>
      </View>

      <View>
        <Text style={[type.caption, { color: colour.inkMuted, paddingBottom: space.xs }]}>Attendance</Text>
        <Text style={[type.smallMedium, { color: colour.ink, paddingBottom: space.sm }]}>{total} {total === 1 ? "player" : "players"}</Text>
        {/* THE SUMMARY CAN ALSO FILTER, where the roster is actually showing. A tap narrows the list
            below to that state; tapping the same chip again clears it back to everyone, grouped. */}
        <View style={{ flexDirection: "row", gap: space.xs }}>
          {ATTENDANCE_GROUP_ORDER.map((key) => {
            const c = CHIP_TONE[key]
            const on = filter === key
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${value[key] ?? 0} ${ATTENDANCE_STATE_WORDS[key]}`}
                accessibilityState={{ selected: on }}
                disabled={!Array.isArray(roster)}
                onPress={() => setFilter(on ? null : key)}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: radius.md,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? c.ink : colour.line,
                  backgroundColor: c.tint,
                  paddingVertical: 6,
                  alignItems: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: c.ink }]}>{value[key] ?? 0}</Text>
                <Text numberOfLines={1} style={[type.caption, { color: c.ink, fontSize: 10 }]}>{ATTENDANCE_STATE_WORDS[key]}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {roster === "loading" && <Text style={[type.caption, { color: colour.inkMuted }]}>Loading the roster…</Text>}
      {roster === "error" && <Text style={[type.caption, { color: colour.inkMuted }]}>The roster could not be loaded.</Text>}
      {/* UNAUTHORIZED DRAWS NOTHING FURTHER. The counts above are what this viewer is entitled to; no
          sentence is needed to say so, the same way the fixture and training registers say nothing
          extra to somebody who can see a count but not a name. */}
      {Array.isArray(roster) && total === 0 && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>No players are currently linked to this side.</Text>
      )}
      {Array.isArray(roster) && total > 0 && (
        <View style={{ gap: space.sm }}>
          {(filter ? [filter] : ATTENDANCE_GROUP_ORDER).map((key) => {
            const players = grouped[key]
            if (players.length === 0) return null
            return (
              <View key={key} style={{ gap: 4 }}>
                {!filter && (
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>
                    {ATTENDANCE_STATE_WORDS[key].toUpperCase()} · {players.length}
                  </Text>
                )}
                <View style={{ backgroundColor: colour.chalk, borderRadius: radius.md, overflow: "hidden" }}>
                  {players.map((p, i) => (
                    <View
                      key={p.playerId}
                      style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}
                    >
                      <PersonAvatar name={`${p.firstName} ${p.surname}`} url={null} size={32} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>{p.firstName} {p.surname}</Text>
                        {!!filter && <Text style={[type.caption, { color: colour.inkMuted }]}>{ATTENDANCE_STATE_WORDS[key]}</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}
