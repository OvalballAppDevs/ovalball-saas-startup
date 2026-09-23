import { useCallback, useEffect, useState } from "react"
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"

import { useBackToSurface } from "../../../../src/links/back"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  NO_ANSWER_YET,
  attendanceConfirmation,
  availabilityEventLabel,
  availabilityQuestion,
  availabilitySubject,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"

import { supabase } from "../../../../src/auth/supabase"
import {
  loadMyTrainingAvailability,
  loadTrainingRegister,
  loadTrainingSession,
  type TrainingAvailability,
  type TrainingSession,
} from "../../../../src/agenda/training"
import {
  CancelSessionButton,
  TrainingOperations,
  type TrainingEdit,
} from "../../../../src/training/training-operations"
import { respondToTraining } from "../../../../src/match-centre/respond"
import { loadRecipients } from "../../../../src/messages/recipients"
import { AvailabilityChoice } from "../../../../src/components/availability-choice"
import { AvailabilityRegister, type RegisterEntry } from "../../../../src/components/availability-register"
import {
  EventHero,
  ParticipantActionCard,
  ParticipantSheet,
} from "../../../../src/components/participant/event-hero"
import { exactDate, relativeDate, restOfDate } from "../../../../src/agenda/presentation"
import { todayIso } from "../../../../src/agenda/load"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { CalendarDays, ChevronRight, ClipboardList, Clock, MapPin, MessageSquare, Users } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../../../../src/design/tokens"

/**
 * TRAINING CENTRE.
 *
 * The same console idea as a fixture, for the other half of a rugby week. A training session is a
 * domain object with its own destination -- which is why the Calendar routes here rather than opening a
 * calendar-flavoured copy of something that already exists.
 *
 * IT IS NOT A FIXTURE AND IS NOT DRAWN AS ONE. No opposition, no home or away, no result: a squad, a
 * ground, a time and a plan. Giving it a fake opponent to reuse a layout would be describing it wrongly
 * for the sake of a component.
 *
 * EDITING IS AN OVERRIDE ON THIS OCCURRENCE. Ovalball materialises training from a plan, so moving next
 * Tuesday to a different pitch changes next Tuesday -- not every Tuesday for the rest of the season,
 * which is what editing the plan would do and almost never what somebody means.
 *
 * THE VENUE AND THE PITCH ARE THE SAME CANONICAL RECORDS the fixture console uses, and the same rule
 * applies: a pitch belongs to a ground, so the choice is scoped to the ground this session is at. What
 * may be changed at all is `can_manage`, which is the server's answer.
 */
export default function TrainingCentre() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const back = useBackToSurface("/calendar")
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const id = String(sessionId ?? "")
  const today = todayIso()

  const [session, setSession] = useState<TrainingSession | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mine, setMine] = useState<TrainingAvailability[]>([])
  /**
   * WHETHER THERE IS ANYBODY THIS PERSON MAY MESSAGE AT ALL.
   *
   * The same question, and the same one answer, as Match Centre:
   * `my_direct_message_candidates()` applies `internal.may_direct_message` to its
   * own output -- adulthood first and unconditionally, then blocks, then policy,
   * then relationship. Zero means no row, which is what an under-18 player gets.
   */
  const [canReachSomebody, setCanReachSomebody] = useState(false)
  /** The one sentence shown after an answer lands. Cleared on every re-read. */
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [register, setRegister] = useState<RegisterEntry[]>([])
  /**
   * WHICH FIELD A COACH IS EDITING.
   *
   * Held here so the read-only rows can say which one is open, but the sheets that
   * do the editing live in `TrainingOperations`, which is mounted only where the
   * server said this viewer may manage the session. A participant can set this
   * state to nothing, because they are offered no press target to set it with --
   * and even if they could, nothing is mounted to read it.
   */
  const [editing, setEditing] = useState<TrainingEdit>(null)

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadTrainingSession(supabase, id)
      if (!loaded) {
        setMissing(true)
        return
      }
      setSession(loaded)
      setConfirmation(null)
      /*
        WHAT THIS VIEWER IS ACTUALLY ENTITLED TO ASK.

        `loadMyTrainingAvailability` is everybody's -- it returns this person's own
        family, and only theirs. The REGISTER is asked for only where the server
        already said `can_view_register`; the RPC refuses rather than filtering, so
        an empty array would mean "not staff" either way, and not asking is the
        better half of that.

        The GROUNDS AND PITCHES are gone from here entirely. They exist to fill an
        edit control, so they are now read by `TrainingOperations` when it mounts --
        which happens only for somebody the server said may edit.
      */
      const [myAvailability, sessionRegister, people] = await Promise.all([
        loadMyTrainingAvailability(supabase, id),
        loaded.canViewRegister ? loadTrainingRegister(supabase, id) : Promise.resolve([] as RegisterEntry[]),
        loadRecipients(supabase).catch(() => []),
      ])
      setMine(myAvailability)
      setRegister(sessionRegister)
      setCanReachSomebody(people.length > 0)
    } catch (caught) {
      const failure = friendly(caught, "this training session")
      logDetail("training centre", failure)
      setProblem(failure.message)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  /**
   * THE SERVER'S ANSWER IS WHAT MOVES THE CONTROL. `respondToTraining` calls the
   * canonical `respond_to_training_attendance`, which refuses a cancelled session
   * and resolves the safeguarding rule itself. On success the whole session is
   * re-read rather than the local answer being adjusted, so the register and the
   * counts can never drift from what the database holds.
   */
  async function answerTraining(entry: TrainingAvailability, status: AvailabilityStatus): Promise<boolean> {
    const result = await respondToTraining(supabase, id, entry.playerId, status)
    if (!result.ok) {
      setProblem(result.message)
      return false
    }
    setProblem(null)
    /*
      A STATEMENT ABOUT THE CHILD, from canonical values only.

      Owner decision O-4: the confirmation says what is now true of the person --
      "Pippa can attend training on Saturday 18 October at Prairie Playing
      Fields" -- rather than reporting that a record was written. The words come
      from the shared `attendanceConfirmation`, so the fixture half and the
      training half of the same product say the same thing.

      AND IT DOES NOT CLAIM ANYBODY HAS BEEN TOLD. Turning an availability answer
      into a notification for the coach is a real platform gap, owner-scheduled
      for P5; a confirmation that implied it had happened would be the app
      inventing the feature in words.
    */
    setConfirmation(
      session
        ? attendanceConfirmation({
            status,
            subjectFirstName: entry.isSelf ? null : entry.firstName,
            kind: "training",
            whenLabel: exactDate(session.date),
            venueName: session.venueName,
          })
        : null
    )
    await load()
    return true
  }

  if (missing) {
    return (
      /* THE SAME SURFACE, even when there is nothing on it. A session that was
         removed and one that is not this person's are deliberately the same
         answer -- the difference is not ours to reveal -- and it is said on the
         screen it would have been said on, not on a different-looking one. */
      <View style={{ flex: 1, backgroundColor: surface.forest }}>
        <EventHero
          surfaceName="Training Centre"
          // NOT "Not available": that is the canonical word for an availability
          // ANSWER, and a hero saying it about the session itself would be the same
          // two words meaning two different things on one screen.
          title="Session unavailable"
          eyebrow="Training"
          mark={<Users size={26} color={colour.pitch400} strokeWidth={1.9} />}
          facts={[]}
          onBack={back}
        />
        <ParticipantSheet>
          <View style={{ paddingTop: space.lg }}>
            <EmptyState
              title="This session isn't available"
              body="It may have been removed, or it may not be one you have access to."
              icon={<Users size={24} color={colour.inkSubtle} />}
            />
          </View>
        </ParticipantSheet>
      </View>
    )
  }

  const cancelled = Boolean(session?.cancelledAt)
  const canEdit = Boolean(session?.canManage) && !cancelled
  const child = mine.length === 1 && !mine[0].isSelf ? mine[0].firstName : null

  return (
    <View style={{ flex: 1, backgroundColor: surface.forest }}>
      {/* ============================================================
            THE HERO — what this is, whose it is, and the three facts a parent
            came for. Forest rather than a stock photograph: Ovalball has no
            picture of this club's training, and somebody else's rugby on a page
            about your child is worse than none.
         ============================================================ */}
      <EventHero
        surfaceName="Training Centre"
        title="Training Session"
        eyebrow={[session?.teamLabel, child].filter(Boolean).join(" · ") || "Training"}
        status={
          cancelled
            ? { label: "Cancelled", tone: "danger" }
            : session
              ? { label: session.date >= today ? "Upcoming" : "Finished", tone: "calm" }
              : null
        }
        mark={<Users size={26} color={colour.pitch400} strokeWidth={1.9} />}
        facts={
          session
            ? [
                { icon: <CalendarDays size={17} color={onForest.secondary} />, label: exactDate(session.date) },
                {
                  icon: <Clock size={17} color={onForest.secondary} />,
                  label: [session.startTime, session.endTime].filter(Boolean).join(" – ") || "Time to be confirmed",
                  /*
                    NO ARRIVAL TIME HERE, and that is a finding rather than an
                    omission. The reference design shows "Arrive from 17:45" and
                    Ovalball has no such field for training: `meet_time` exists on a
                    FIXTURE and there is no column, no RPC and no product concept
                    for it on `training_sessions`. Inventing one -- by subtracting a
                    quarter of an hour, say -- would put a time on a parent's screen
                    that no coach ever set, which is worse than not showing one.
                  */
                  detail: null,
                },
                {
                  icon: <MapPin size={17} color={onForest.secondary} />,
                  label: session.venueName ?? "Venue to be confirmed",
                  detail: session.venueName ? "View on map" : null,
                  onPress: session.venueName ? () => void openDirections(session.venueName!) : undefined,
                },
              ]
            : []
        }
        onBack={back}
      />

      <ParticipantSheet>
        <ScrollView
          contentContainerStyle={{ paddingTop: space.md, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                await load()
                setRefreshing(false)
              }}
              tintColor={colour.forest800}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {!!problem && (
            <View style={{ paddingHorizontal: space.lg }}>
              <ErrorState message={problem} onRetry={load} />
            </View>
          )}
          {!problem && !session && (
            <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}

          {!!session && (
            <>
              {!!confirmation && (
                <View
                  accessibilityRole="alert"
                  style={{
                    marginHorizontal: space.lg,
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: colour.successSurface,
                  }}
                >
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>{confirmation}</Text>
                </View>
              )}

              {cancelled && (
                <View
                  style={{
                    marginHorizontal: space.lg,
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: colour.dangerSurface,
                    gap: 2,
                  }}
                >
                  <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.danger }]}>
                    This session is cancelled
                  </Text>
                  {!!session.cancellationReason && (
                    <Text style={[type.small, { color: colour.danger }]}>{session.cancellationReason}</Text>
                  )}
                </View>
              )}

              {/* ============================================================
                    THE ANSWER, AS THE FIRST THING ON THE SHEET.

                    It is the one action a parent came to take, so it is the one
                    that does not have to be looked for. The control is the shared
                    canonical one -- the same three answers, words, order and icons
                    as Match Centre and as the website -- on its light ground.
                 ============================================================ */}
              {mine.length > 0 && (
                <View
                  style={{
                    marginHorizontal: space.lg,
                    padding: space.lg,
                    borderRadius: radius.lg,
                    backgroundColor: surface.card,
                    borderWidth: 1,
                    borderColor: colour.line,
                    gap: space.md,
                  }}
                >
                  {mine.map((entry) => (
                    <View key={entry.playerId} style={{ gap: space.sm }}>
                      {entry.canRespond ? (
                        <>
                          <AvailabilityChoice
                            ground="light"
                            question={availabilityQuestion("training", entry.isSelf, entry.firstName)}
                            subject={availabilitySubject(entry.isSelf, entry.firstName)}
                            what={availabilityEventLabel("training", relativeDate(session.date, today))}
                            committed={entry.response}
                            disabled={false}
                            onChoose={(status) => answerTraining(entry, status)}
                          />
                          {entry.response === null && (
                            <Text style={[type.caption, { color: colour.inkMuted }]}>{NO_ANSWER_YET}</Text>
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={[type.smallMedium, { color: colour.ink }]}>
                            {availabilityQuestion("training", entry.isSelf, entry.firstName)}
                          </Text>
                          {/* THE DATABASE'S OWN SENTENCE. A 16-year-old without
                              recorded guardian consent reads the rule rather than
                              learning it from a red error after tapping. */}
                          <Text style={[type.small, { color: colour.inkMuted }]}>
                            {entry.cannotRespondReason ?? "You cannot respond for this player."}
                          </Text>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* ============================================================
                    WHAT ELSE A PARTICIPANT MAY DO OR READ.

                    Uniform cards, no administrative variant. The communication one
                    is the canonical chooser's shortcut and is absent when
                    `may_direct_message` offers nobody -- which is what an under-18
                    player gets.
                 ============================================================ */}
              {!session.canManage && canReachSomebody && (
                <ParticipantActionCard
                  icon={<MessageSquare size={18} color={colour.forest800} strokeWidth={1.9} />}
                  title="Message Team Staff"
                  detail="Ask a question about this session. Who you can reach is set by your club."
                  onPress={() => router.push("/messages/new")}
                />
              )}

              {(!!session.agenda || !!session.furtherNotes || !!session.notes) && (
                <ParticipantActionCard
                  icon={<ClipboardList size={18} color={colour.forest800} strokeWidth={1.9} />}
                  title="Training Information"
                  detail={session.agenda ?? session.furtherNotes ?? session.notes ?? undefined}
                />
              )}

              {!!session.venueName && (
                <ParticipantActionCard
                  icon={<MapPin size={18} color={colour.forest800} strokeWidth={1.9} />}
                  title="Location"
                  detail={[session.venueName, session.pitchName].filter(Boolean).join(" · ")}
                  onPress={() => void openDirections(session.venueName!)}
                />
              )}

              {/* WHO'S TRAINING. Nothing at all without the capability: a parent is
                  not shown a locked panel, because they are not missing a feature. */}
              {session.canViewRegister && (
                <AvailabilityRegister
                  title="Who's Training"
                  entries={register}
                  emptyBody="No players are on this team yet, so there is nobody to expect at training."
                />
              )}

              {/* ============================================================
                    RUNNING THE SESSION — mounted only on the server's own answer.

                    Every sheet that edits this session, the two reads that fill
                    them, and the cancel control live in `TrainingOperations`, which
                    renders only where `session.canManage` is true -- the value
                    `get_training_session_card` returns from
                    `internal.can_manage_training`.

                    Before P4 all of it was in this tree for EVERY viewer. Nothing
                    was drawn, because each row's press target is gated and a
                    non-editable row renders no chevron -- but the administrative
                    components were MOUNTED, and the grounds and pitches were
                    fetched, for a parent whose screen had nowhere to put them. The
                    URL still does not grant the surface, and now it does not
                    assemble it either.
                 ============================================================ */}
              {session.canManage && (
                <>
                  <Group title="When">
                    <Row label="Date" value={exactDate(session.date)} editable={canEdit} onPress={() => setEditing("date")} />
                    <Row
                      label="Start"
                      value={session.startTime ?? "Not set"}
                      muted={!session.startTime}
                      editable={canEdit}
                      onPress={() => setEditing("start")}
                    />
                    <Row
                      label="Ends"
                      value={session.endTime ?? (session.durationMinutes ? `${session.durationMinutes} minutes` : "Not set")}
                      muted={!session.endTime && !session.durationMinutes}
                      last
                    />
                  </Group>

                  <Group title="Where">
                    <Row
                      label="Venue"
                      value={session.venueName ?? "Not set"}
                      muted={!session.venueName}
                      editable={canEdit}
                      onPress={() => setEditing("venue")}
                    />
                    <Row
                      label="Pitch"
                      value={session.pitchName ?? "Not set"}
                      muted={!session.pitchName}
                      editable={canEdit}
                      onPress={() => setEditing("pitch")}
                      last
                    />
                  </Group>

                  <Group title="The Session">
                    <Row
                      label="Agenda"
                      value={session.agenda ?? "None"}
                      muted={!session.agenda}
                      editable={canEdit}
                      onPress={() => setEditing("agenda")}
                    />
                    <Row
                      label="Notes"
                      value={session.furtherNotes ?? session.notes ?? "None"}
                      muted={!session.furtherNotes && !session.notes}
                      editable={canEdit}
                      onPress={() => setEditing("notes")}
                      last
                    />
                  </Group>

                  {!cancelled && <CancelSessionButton onPress={() => setEditing("cancel")} />}
                  <TrainingOperations
                    session={session}
                    editing={editing}
                    onClose={() => setEditing(null)}
                    onSaved={load}
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      </ParticipantSheet>
    </View>
  )
}

async function openDirections(place: string): Promise<void> {
  const query = encodeURIComponent(place)
  const native = Platform.OS === "ios" ? `maps://?daddr=${query}` : `geo:0,0?q=${query}`
  try {
    if (await Linking.canOpenURL(native)) {
      await Linking.openURL(native)
      return
    }
    await Linking.openURL(`https://maps.google.com/?q=${query}`)
  } catch {
    Alert.alert("Directions", "This device can't open a map for that address.")
  }
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  )
}

function Row({
  label,
  value,
  editable,
  onPress,
  muted,
  last,
}: {
  label: string
  value: string
  editable?: boolean
  onPress?: () => void
  muted?: boolean
  last?: boolean
}) {
  const content = (
    <View
      style={{
        minHeight: TOUCH_TARGET + 4,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colour.line,
      }}
    >
      <Text style={[type.small, { color: colour.inkMuted, width: 78 }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: muted ? colour.inkSubtle : colour.ink, fontSize: 15, flex: 1 }]}>{value}</Text>
      {editable && <ChevronRight size={17} color={colour.inkSubtle} />}
    </View>
  )
  if (!editable || !onPress) return content
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Change`}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      {content}
    </Pressable>
  )
}
