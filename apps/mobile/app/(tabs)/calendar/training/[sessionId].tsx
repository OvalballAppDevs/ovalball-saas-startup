import { useCallback, useEffect, useState } from "react"
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  NO_ANSWER_YET,
  availabilityEventLabel,
  availabilityQuestion,
  availabilitySubject,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"

import { supabase } from "../../../../src/auth/supabase"
import {
  cancelTrainingSession,
  loadMyTrainingAvailability,
  loadTrainingRegister,
  loadTrainingSession,
  overrideTrainingSession,
  type TrainingAvailability,
  type TrainingResult,
  type TrainingSession,
} from "../../../../src/agenda/training"
import { respondToTraining } from "../../../../src/match-centre/respond"
import { AvailabilityChoice } from "../../../../src/components/availability-choice"
import { AvailabilityRegister, type RegisterEntry } from "../../../../src/components/availability-register"
import { loadPitchOptions, loadVenueOptions, type PitchOption, type VenueOption } from "../../../../src/agenda/fixture-detail"
import { exactDate, relativeDate, restOfDate } from "../../../../src/agenda/presentation"
import { todayIso } from "../../../../src/agenda/load"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { CancelSheet, ChoiceSheet, DateSheet, TextSheet, TimeSheet } from "../../../../src/components/field-sheet"
import { ChevronRight, MapPin, Users } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

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
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const id = String(sessionId ?? "")
  const today = todayIso()

  const [session, setSession] = useState<TrainingSession | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [pitches, setPitches] = useState<PitchOption[]>([])
  const [mine, setMine] = useState<TrainingAvailability[]>([])
  const [register, setRegister] = useState<RegisterEntry[]>([])
  const [editing, setEditing] = useState<null | "date" | "start" | "venue" | "pitch" | "agenda" | "notes" | "cancel">(null)
  const [saving, setSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)

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
      /*
        THE SAME FOUR QUESTIONS THE WEBSITE'S TRAINING CENTRE ASKS, asked
        together. `loadMyTrainingAvailability` and `loadTrainingRegister` are the
        canonical RPCs -- the register one REFUSES rather than filtering, so an
        empty array here means "not staff" and the section simply is not drawn.
      */
      const [venueOptions, pitchOptions, myAvailability, sessionRegister] = await Promise.all([
        loadVenueOptions(supabase, loaded.clubId),
        loadPitchOptions(supabase, loaded.clubId, loaded.venueId),
        loadMyTrainingAvailability(supabase, id),
        loaded.canViewRegister ? loadTrainingRegister(supabase, id) : Promise.resolve([] as RegisterEntry[]),
      ])
      setVenues(venueOptions)
      setPitches(pitchOptions)
      setMine(myAvailability)
      setRegister(sessionRegister)
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

  async function save(action: () => Promise<TrainingResult>) {
    if (saving) return
    setSaving(true)
    setSheetProblem(null)
    const result = await action()
    if (!result.ok) {
      setSaving(false)
      setSheetProblem(result.message)
      return
    }
    await load()
    setSaving(false)
    setEditing(null)
  }

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
    await load()
    return true
  }

  if (missing) {
    return (
      <Shell title="Training" onBack={() => router.back()} insets={insets}>
        <EmptyState
          title="This session isn't available"
          body="It may have been removed, or it may not be one you have access to."
          icon={<Users size={24} color={colour.inkSubtle} />}
        />
      </Shell>
    )
  }

  const cancelled = Boolean(session?.cancelledAt)
  const canEdit = Boolean(session?.canManage) && !cancelled

  return (
    <Shell
      title={session?.teamLabel ?? "Training"}
      subtitle={session ? relativeDate(session.date, today) : undefined}
      onBack={() => router.back()}
      insets={insets}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true)
        await load()
        setRefreshing(false)
      }}
    >
      {problem && <ErrorState message={problem} onRetry={load} />}
      {!problem && !session && (
        <>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </>
      )}

      {!!session && (
        <>
          {/* THE SESSION CARD, WITH THE VIEWER'S OWN ANSWER INSIDE IT.
              The invitation and the reply to it are one object -- the website's
              Training Centre puts the same control in the same place, inside the
              same hero, for the same reason. Detached below it reads as an
              administrative form about the session rather than the answer to it. */}
          <View style={{ backgroundColor: colour.forest800, borderRadius: radius.lg, overflow: "hidden" }}>
            <View style={{ padding: space.lg, gap: space.xs }}>
              <Text style={[type.overline, { color: colour.onForestMuted }]}>TRAINING</Text>
              <Text accessibilityRole="header" style={[type.title, { color: colour.onForest }]}>
                {session.teamLabel ?? "Session"}
              </Text>
              <Text style={[type.small, { color: colour.onForestMuted }]}>
                {relativeDate(session.date, today)}
                {restOfDate(session.date, today) ? ` · ${restOfDate(session.date, today)}` : ""}
                {session.startTime ? ` · ${session.startTime}` : ""}
                {session.venueName ? ` · ${session.venueName}` : ""}
              </Text>
            </View>

            {mine.length > 0 && (
              <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.15)" }}>
                {mine.map((entry, index) => (
                  <View
                    key={entry.playerId}
                    style={{ padding: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.10)" }}
                  >
                    {entry.canRespond ? (
                      <>
                        <AvailabilityChoice
                          question={availabilityQuestion("training", entry.isSelf, entry.firstName)}
                          subject={availabilitySubject(entry.isSelf, entry.firstName)}
                          what={availabilityEventLabel("training", relativeDate(session.date, today))}
                          committed={entry.response}
                          disabled={false}
                          onChoose={(status) => answerTraining(entry, status)}
                        />
                        {entry.response === null && (
                          <Text style={[type.small, { color: colour.onForestMuted, marginTop: space.sm }]}>{NO_ANSWER_YET}</Text>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={[type.smallMedium, { color: colour.onForest }]}>
                          {availabilityQuestion("training", entry.isSelf, entry.firstName)}
                        </Text>
                        {/* THE DATABASE'S OWN SENTENCE. A 16-year-old without
                            recorded guardian consent reads the rule rather than
                            learning it from a red error after tapping -- which is
                            exactly what Match Centre does for the same person
                            under the same policy. */}
                        <Text style={[type.small, { color: colour.onForestMuted, marginTop: space.xs }]}>
                          {entry.cannotRespondReason ?? "You cannot respond for this player."}
                        </Text>
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {cancelled && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: 2 }}>
              <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.danger }]}>
                This session is cancelled
              </Text>
              {!!session.cancellationReason && (
                <Text style={[type.small, { color: colour.danger }]}>{session.cancellationReason}</Text>
              )}
            </View>
          )}

          <Group title="When">
            <Row
              label="Date"
              value={exactDate(session.date)}
              editable={canEdit}
              onPress={() => setEditing("date")}
            />
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
              last={!session.venueName}
            />
            {!!session.venueName && (
              <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Directions to ${session.venueName}`}
                  onPress={() => void openDirections(session.venueName!)}
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    minHeight: TOUCH_TARGET,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colour.lineStrong,
                    backgroundColor: colour.surface,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <MapPin size={16} color={colour.forest800} strokeWidth={2} />
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>Directions</Text>
                </Pressable>
              </View>
            )}
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

          {/* WHO'S TRAINING. The same section Match Centre draws, with the one
              word that differs, from the same component -- so a coach reading a
              matchday register and a training register is reading one design.
              Nothing at all without the capability: a parent is not shown a
              locked panel, because they are not missing a feature.

              WHAT THIS REPLACED. A line reading "Your response: Going / Can't go
              / Unsure" -- a THIRD first-person vocabulary for the three states
              the shared control calls "I'm Available / Not Available / Unsure"
              and the register calls "Attending / Can't attend / Unsure". It was a
              placeholder, and a placeholder that invents wording is how a product
              ends up with four names for one answer. */}
          {session.canViewRegister && (
            <AvailabilityRegister
              title="Who's Training"
              entries={register}
              emptyBody="No players are on this team yet, so there is nobody to expect at training."
            />
          )}

          {session.canManage && !cancelled && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel this training session"
              onPress={() => {
                setSheetProblem(null)
                setEditing("cancel")
              }}
              style={({ pressed }) => ({
                marginTop: space.lg,
                minHeight: TOUCH_TARGET + 6,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: colour.danger,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Cancel Session</Text>
            </Pressable>
          )}

          <DateSheet
            visible={editing === "date"}
            value={session.date}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(date) => void save(() => overrideTrainingSession(supabase, id, { date }))}
          />
          <TimeSheet
            visible={editing === "start"}
            title="Start time"
            value={session.startTime}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(startTime) => void save(() => overrideTrainingSession(supabase, id, { startTime }))}
          />
          <ChoiceSheet
            visible={editing === "venue"}
            title="Venue"
            hint="Your club's grounds."
            options={venues.map((venue) => ({ id: venue.id, name: venue.name, detail: venue.town }))}
            value={session.venueId}
            emptyMessage="Your club has no grounds recorded in Ovalball yet. They are added in Club Admin on the web."
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(venueId) => void save(() => overrideTrainingSession(supabase, id, { venueId }))}
          />
          <ChoiceSheet
            visible={editing === "pitch"}
            title="Pitch"
            hint="Playing areas at this ground."
            options={pitches.map((pitch) => ({ id: pitch.id, name: pitch.name }))}
            value={session.pitchId}
            emptyMessage={
              session.venueId
                ? "This ground has no playing areas recorded."
                : "Choose a ground first — a pitch belongs to one."
            }
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(pitchId) => void save(() => overrideTrainingSession(supabase, id, { pitchId, venueId: session.venueId }))}
          />
          <TextSheet
            visible={editing === "agenda"}
            title="Agenda"
            hint="What the session is working on."
            placeholder="Scrum shape, defensive line speed"
            value={session.agenda ?? ""}
            multiline
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(agenda) => void save(() => overrideTrainingSession(supabase, id, { agenda: agenda.trim() || null }))}
          />
          <TextSheet
            visible={editing === "notes"}
            title="Notes"
            hint="Anything the squad needs to know."
            placeholder="Bring a gumshield"
            value={session.furtherNotes ?? ""}
            multiline
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(notes) => void save(() => overrideTrainingSession(supabase, id, { furtherNotes: notes.trim() || null }))}
          />
          <CancelSheet
            visible={editing === "cancel"}
            summary={{
              teams: session.teamLabel ?? "Training",
              when: `${exactDate(session.date)}${session.startTime ? ` · ${session.startTime}` : ""}`,
            }}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onConfirm={(reason) => void save(() => cancelTrainingSession(supabase, id, reason))}
          />
        </>
      )}
    </Shell>
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

function Shell({
  title,
  subtitle,
  onBack,
  insets,
  children,
  refreshing,
  onRefresh,
}: {
  title: string
  subtitle?: string
  onBack: () => void
  insets: { top: number; bottom: number }
  children: React.ReactNode
  refreshing?: boolean
  onRefresh?: () => void
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Calendar"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
            {title}
          </Text>
          {!!subtitle && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  )
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
