import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { oppositionPresenceLabel } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import {
  loadFixtureDetail,
  loadOppositionContacts,
  loadPitchOptions,
  loadVenueOptions,
  type FixtureDetail,
  type OppositionContact,
  type PitchOption,
  type VenueOption,
} from "../../../../src/agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../../../../src/agenda/authority"
import {
  cancelFixture,
  rejectKickoffChange,
  updateDetails,
  updateMeetTime,
  updateKickoff,
  updatePitch,
  updateVenue,
  type MutationResult,
} from "../../../../src/agenda/mutations"
import { exactDate, homeAwayLabel, relativeDate, statusTone } from "../../../../src/agenda/presentation"
import { todayIso } from "../../../../src/agenda/load"
import { openConversationWith } from "../../../../src/messages/recipients"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ClubCrest } from "../../../../src/components/identity"
import { CancelSheet, ChoiceSheet, DateSheet, TextSheet, TimeSheet } from "../../../../src/components/field-sheet"
import {
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  OvalIcon,
  Users,
} from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * THE FIXTURE CONSOLE.
 *
 * NOT A DETAIL PAGE WITH CARDS AND LINKS. This is where somebody opens one fixture and deals with it,
 * and the difference is not cosmetic: a page of boxed modules makes a manager read seven headings to
 * find the kick-off, then leave for a separate Edit screen to change it. A console shows the facts and
 * lets you touch them.
 *
 * ONE SCREEN FOR EVERYBODY. A coach with authority and a parent without get the SAME information in the
 * same order; capability decides which of it responds to a tap. There is no parent version of this
 * screen, because two versions is how they come to disagree about what a fixture is.
 *
 * THE DISPLAYED VALUE IS THE CONTROL. Tap the kick-off, a sheet with the system time picker comes up,
 * save, the console re-reads from the server. No permanent text fields, so the normal screen stays
 * something you read rather than something you fill in -- and no separate Edit destination, so there is
 * nothing to hunt for.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 *   AVAILABILITY. It belongs in Match Centre with the team sheet and match day, and a second
 *   availability surface here would be the drift Match Centre's whole architecture exists to prevent.
 *
 *   CLUB DOCUMENTS. Ovalball has a Club Documents product; pinning a club's library onto every fixture
 *   was a second, worse projection of it. Documents reach a fixture through MESSAGING, which is where
 *   sending one to somebody is an act rather than a list.
 *
 *   DELETE. `fixture.fixture.delete` is club-scoped and team staff never hold it. Cancelling is the
 *   team's action and it preserves the record.
 */
export default function FixtureConsole() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")
  const today = todayIso()

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [contacts, setContacts] = useState<OppositionContact[]>([])
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [pitches, setPitches] = useState<PitchOption[]>([])

  const [editing, setEditing] = useState<null | "date" | "kickoff" | "meet" | "venue" | "pitch" | "pitchText" | "notes" | "cancel">(null)
  const [saving, setSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const myTeamIds = useMemo(
    () =>
      new Set([
        ...(sessionContext?.teamPermissions ?? []).map((t) => t.teamId),
        ...(sessionContext?.guardianRelationships ?? []).map((g) => g.teamId),
        ...(sessionContext?.linkedPlayerTeams ?? []).map((p) => p.teamId),
      ]),
    [sessionContext]
  )

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadFixtureDetail(supabase, id, myTeamIds)
      if (!loaded) {
        setMissing(true)
        return
      }
      setFixture(loaded)
      // The grounds and playing areas come from the OWNING club and the fixture's own venue, which is
      // what the canonical pitch mutation will insist on.
      const [venueOptions, pitchOptions, oppositionContacts] = await Promise.all([
        loadVenueOptions(supabase, loaded.clubId),
        loadPitchOptions(supabase, loaded.clubId, loaded.venueId),
        loadOppositionContacts(supabase, id),
      ])
      setVenues(venueOptions)
      setPitches(pitchOptions)
      setContacts(oppositionContacts)
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("fixture console", failure)
      setProblem(failure.message)
    }
  }, [id, myTeamIds])

  useEffect(() => {
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    let live = true
    setAuthority(null)
    void loadFixtureAuthority(supabase, active).then((result) => live && setAuthority(result))
    return () => {
      live = false
    }
  }, [active])

  /**
   * One field, saved, then the console re-read from the server.
   *
   * NOT OPTIMISTIC. The canonical mutation answers first; a fixture that appeared to move and did not
   * is worse than one that took a moment. On failure the sheet stays open with the attempted value and
   * the reason, so the next attempt is a correction rather than a retype.
   */
  async function save(action: () => Promise<MutationResult>) {
    if (saving) return
    setSaving(true)
    setSheetProblem(null)
    const result = await action()
    if (!result.ok) {
      setSaving(false)
      setSheetProblem(result.message)
      return
    }
    // A SCHEDULE CHANGE AGAINST ANOTHER OVALBALL CLUB IS A PROPOSAL. Saying "saved" would be telling a
    // manager the kick-off had moved when the other club has not agreed -- and they would find out by
    // somebody turning up at the wrong time. The banner on the console says which it was.
    await load()
    setSaving(false)
    setEditing(null)
  }

  async function messageOpposition(contact: OppositionContact) {
    if (opening) return
    setOpening(true)
    const result = await openConversationWith(supabase, contact.userId)
    setOpening(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "direct", id: result.conversationId } })
  }

  if (missing) {
    return (
      <Shell title="Fixture" onBack={() => router.back()} insets={insets}>
        <EmptyState
          title="This fixture isn't available"
          body="It may have been removed, or it may not be one you have access to."
          icon={<OvalIcon size={24} color={colour.inkSubtle} />}
        />
      </Shell>
    )
  }

  const status = statusTone(fixture?.status ?? null)
  const cancelled = fixture?.status === "Cancelled"
  const home = homeAwayLabel(fixture?.homeAway ?? null)
  // A CANCELLED FIXTURE IS NOT EDITED AS THOUGH IT WERE LIVE. The database refuses it too, but showing
  // tappable values on a match that is off invites somebody to reschedule a thing that no longer exists.
  const canEditSchedule = Boolean(authority?.edit) && !cancelled && (fixture?.editable.schedule?.editable ?? false)
  const canEditMeet = Boolean(authority?.edit) && !cancelled && (fixture?.editable.meetTime?.editable ?? false)
  const canEditVenue = Boolean(authority?.edit) && !cancelled && (fixture?.editable.venue?.editable ?? false)
  const canEditDetails = Boolean(authority?.edit) && !cancelled && (fixture?.editable.details?.editable ?? false)
  // A NAMED PITCH IS A HOME FIXTURE'S BUSINESS. Away, the ground belongs to the other club and the
  // canonical mutation refuses a pitch id -- so the free-text fallback is what is offered instead.
  const namedPitch = fixture?.homeAway === "Home"

  return (
    <Shell
      title={fixture?.us.teamName ?? fixture?.us.clubName ?? "Fixture"}
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
      {!problem && !fixture && (
        <>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </>
      )}

      {!!fixture && (
        <>
          {/* IDENTITY -- who, against whom, where we are playing, and whether they are on Ovalball.
              Compact on purpose: this used to be a tall decorative block that pushed the kick-off below
              the fold on a normal iPhone. */}
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ClubCrest clubName={fixture.us.clubName} url={fixture.us.crestUrl} size={40} />
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                {fixture.homeAway === "Away" ? "away to" : fixture.homeAway === "Home" ? "at home to" : "against"}
              </Text>
              <ClubCrest clubName={fixture.them.clubName} url={fixture.them.crestUrl} size={40} />
            </View>

            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              {fixture.them.teamName ? `${fixture.them.clubName} ${fixture.them.teamName}` : fixture.them.clubName}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
              {/* HOME OR AWAY IN WORDS. "A" was too cryptic -- a manager should not have to decode a
                  letter for the fact that decides whether they are travelling. */}
              {!!home && (
                <Badge
                  label={home.spoken.toUpperCase()}
                  background={fixture.homeAway === "Home" ? colour.forest800 : fixture.homeAway === "Away" ? colour.messengerBlue : colour.lineStrong}
                  foreground={fixture.homeAway === "Home" || fixture.homeAway === "Away" ? colour.onForest : colour.inkMuted}
                />
              )}
              {/* ON OVALBALL, from canonical club and team linkage -- never from the name, the crest or
                  a string match. It tells a manager whether richer things are possible here. */}
              <Badge
                label={oppositionPresenceLabel(fixture.opposition).toUpperCase()}
                background={fixture.opposition.onOvalball ? colour.mint100 : "rgba(16,21,18,0.05)"}
                foreground={fixture.opposition.onOvalball ? colour.forest800 : colour.inkMuted}
              />
              {!!fixture.gameType && <Badge label={fixture.gameType.toUpperCase()} background="rgba(16,21,18,0.05)" foreground={colour.inkMuted} />}
            </View>

            {!!status && status.tone !== "confirmed" && !cancelled && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>{status.label}</Text>
            )}
            {!!fixture.result && (
              <Text style={[type.title, { color: colour.forest800 }]}>
                {fixture.result.ourScore}–{fixture.result.theirScore}
              </Text>
            )}
          </View>

          {/* ASKED FOR, NOT AGREED. Both times are shown: the one that is still true, and the one that
              has been proposed. Hiding either would leave somebody confident about the wrong one. */}
          {!!fixture.proposedKickoff && !cancelled && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, gap: space.xs }}>
              <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.warning }]}>
                {fixture.proposedKickoff.byUs ? "Change proposed — waiting for the other club" : "The other club has proposed a change"}
              </Text>
              <Text style={[type.small, { color: colour.warning }]}>
                {shortDate(fixture.proposedKickoff.date)}
                {fixture.proposedKickoff.time ? ` · ${fixture.proposedKickoff.time}` : ""}. Until they agree, this
                fixture stays at {fixture.kickoff ?? "the agreed time"}.
              </Text>
              {authority?.edit && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fixture.proposedKickoff.byUs ? "Withdraw the proposed change" : "Decline the proposed change"}
                  onPress={() => void save(() => rejectKickoffChange(supabase, id))}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={[type.smallMedium, { color: colour.warning }]}>
                    {fixture.proposedKickoff.byUs ? "Withdraw" : "Decline"}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {cancelled && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: 2 }}>
              <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.danger }]}>
                This fixture is cancelled
              </Text>
              {!!fixture.cancellationReason && (
                <Text style={[type.small, { color: colour.danger }]}>{fixture.cancellationReason}</Text>
              )}
            </View>
          )}

          {/* WHEN ------------------------------------------------------------------ */}
          <Group title="When">
            <Row
              label="Date"
              value={`${relativeDate(fixture.date, today)}${relativeDate(fixture.date, today) === exactDate(fixture.date) ? "" : ` · ${shortDate(fixture.date)}`}`}
              editable={canEditSchedule}
              reason={fixture.editable.schedule?.editable === false ? fixture.editable.schedule.reason : null}
              onPress={() => setEditing("date")}
            />
            {/* MEET TIME IS FIRST-CLASS, not a grey subtitle under the kick-off. It is when a side is
                expected at the ground, which for a parent is the time that actually governs the morning. */}
            <Row
              label="Meet"
              value={fixture.meetTime ?? "Not set"}
              muted={!fixture.meetTime}
              editable={canEditMeet}
              reason={fixture.editable.meetTime?.editable === false ? fixture.editable.meetTime.reason : null}
              onPress={() => setEditing("meet")}
            />
            <Row
              label="Kick-off"
              value={fixture.kickoff ?? "Not set"}
              muted={!fixture.kickoff}
              editable={canEditSchedule}
              reason={fixture.editable.schedule?.editable === false ? fixture.editable.schedule.reason : null}
              onPress={() => setEditing("kickoff")}
              last
            />
          </Group>

          {/* WHERE ----------------------------------------------------------------- */}
          <Group title="Where">
            <Row
              label="Venue"
              value={fixture.venue ?? "Not set"}
              muted={!fixture.venue}
              editable={canEditVenue}
              reason={fixture.editable.venue?.editable === false ? fixture.editable.venue.reason : null}
              onPress={() => setEditing("venue")}
            />
            <Row
              label="Pitch"
              value={fixture.pitch ?? "Not set"}
              muted={!fixture.pitch}
              editable={canEditVenue}
              reason={
                fixture.editable.venue?.editable === false
                  ? fixture.editable.venue.reason
                  : namedPitch || !fixture.venue
                    ? null
                    : "Away — the ground belongs to the other club, so the pitch is recorded as text."
              }
              onPress={() => setEditing(namedPitch ? "pitch" : "pitchText")}
            />
            {!!fixture.venueAddress && (
              <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>{fixture.venueAddress}</Text>
                {!!fixture.venueDirections && (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{fixture.venueDirections}</Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Directions to ${fixture.venue ?? "the ground"}`}
                  onPress={() => void openDirections(fixture.venueAddress!)}
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

          {/* MATCH CENTRE ---------------------------------------------------------- */}
          <Group title="Match Centre">
            <Action
              icon={<Users size={20} color={colour.forest800} strokeWidth={1.9} />}
              label="Match Centre"
              detail="Team sheet · Availability · Match day"
              onPress={() =>
                router.push({
                  pathname: "/fixtures/[fixtureId]/match-centre",
                  // THE TEAM TRAVELS WITH THE FIXTURE. A fixture has two sides and a person may be
                  // connected to either; Match Centre has to know whose availability it is showing
                  // rather than aggregating both.
                  params: { fixtureId: fixture.id, teamId: fixture.teamId },
                })
              }
              last
            />
          </Group>

          {/* COMMUNICATION --------------------------------------------------------- */}
          <Group title="Communication">
            <Action
              icon={<MessageSquare size={20} color={colour.forest800} strokeWidth={1.9} />}
              label="Fixture Messages"
              detail="The conversation for this fixture"
              onPress={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id: fixture.id } })}
              last={contacts.length === 0}
            />
            {/* MESSAGE OPPOSITION EXISTS ONLY WHERE THERE IS SOMEBODY TO MESSAGE.
                `fixture_opposition_contacts` returns nothing when the opponent is not an Ovalball team,
                when the viewer is not involved, or when the safeguarding rules say no -- so an empty
                list means the row is simply absent. No disabled button, and nothing that fails after
                being tapped. */}
            {contacts.map((contact, index) => (
              <Action
                key={contact.userId}
                icon={<ExternalLink size={20} color={colour.forest800} strokeWidth={1.9} />}
                label={contacts.length === 1 ? "Message Opposition" : `Message ${contact.displayName}`}
                detail={[contact.displayName, contact.clubLabel].filter(Boolean).join(" · ")}
                busy={opening}
                onPress={() => void messageOpposition(contact)}
                last={index === contacts.length - 1}
              />
            ))}
          </Group>

          {!!fixture.competitionName && (
            <Group title="Competition">
              <Row label="Competition" value={fixture.competitionName} last />
            </Group>
          )}

          <Group title="Notes">
            <Row
              label="Notes"
              value={fixture.notes ?? "None"}
              muted={!fixture.notes}
              editable={canEditDetails}
              reason={fixture.editable.details?.editable === false ? fixture.editable.details.reason : null}
              onPress={() => setEditing("notes")}
              last
            />
          </Group>

          {/* CANCEL ---------------------------------------------------------------- */}
          {/* AT THE BOTTOM, RED, AND NOWHERE NEAR THE TIME FIELDS. It is the one consequential action on
              the screen and it is separated by distance as well as by colour -- not buried in a menu,
              and not adjacent to something somebody taps every week. */}
          {authority?.cancel && !cancelled && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel this fixture"
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
              <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Cancel Fixture</Text>
            </Pressable>
          )}

          {/* ------------------------------------------------------------------ sheets */}
          <DateSheet
            visible={editing === "date"}
            value={fixture.date}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(iso) => void save(() => updateKickoff(supabase, id, { date: iso, time: fixture.kickoff }))}
          />
          <TimeSheet
            visible={editing === "kickoff"}
            title="Kick-off"
            hint="Leave it clear if the time is not agreed yet."
            value={fixture.kickoff}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(time) => void save(() => updateKickoff(supabase, id, { date: fixture.date, time }))}
          />
          <TimeSheet
            visible={editing === "meet"}
            title="Meet time"
            hint="When the side is expected at the ground."
            value={fixture.meetTime}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(time) => void save(() => updateMeetTime(supabase, id, time))}
          />
          <ChoiceSheet
            visible={editing === "venue"}
            title="Venue"
            hint="Your club's grounds."
            options={venues.map((venue) => ({ id: venue.id, name: venue.name, detail: venue.town }))}
            value={fixture.venueId}
            emptyMessage="Your club has no grounds recorded in Ovalball yet. They are added in Club Admin on the web."
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(venueId) => void save(() => updateVenue(supabase, id, venueId))}
          />
          <ChoiceSheet
            visible={editing === "pitch"}
            title="Pitch"
            hint="Playing areas at this ground."
            options={pitches.map((pitch) => ({ id: pitch.id, name: pitch.name }))}
            value={fixture.pitchId}
            emptyMessage={
              fixture.venueId
                ? "This ground has no playing areas recorded. They are added with the ground in Club Admin on the web."
                : "Choose a ground first — a pitch belongs to one."
            }
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(pitchId) => void save(() => updatePitch(supabase, id, { pitchId, pitchText: null }))}
          />
          <TextSheet
            visible={editing === "pitchText"}
            title="Pitch"
            hint="An away ground Ovalball has no record of — write what the other club called it."
            placeholder="Pitch 2"
            value={fixture.pitch ?? ""}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(text) => void save(() => updatePitch(supabase, id, { pitchId: null, pitchText: text }))}
          />
          <TextSheet
            visible={editing === "notes"}
            title="Notes"
            hint="Anything the side needs to know."
            placeholder="Meet at the clubhouse"
            value={fixture.notes ?? ""}
            multiline
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onSave={(text) => void save(() => updateDetails(supabase, id, { notes: text.trim() || null }))}
          />
          <CancelSheet
            visible={editing === "cancel"}
            summary={{
              teams: `${fixture.us.teamName ?? fixture.us.clubName} ${fixture.homeAway === "Away" ? "at" : "v"} ${fixture.them.teamName ?? fixture.them.clubName}`,
              when: `${exactDate(fixture.date)}${fixture.kickoff ? ` · ${fixture.kickoff}` : ""}`,
            }}
            onClose={() => setEditing(null)}
            saving={saving}
            problem={sheetProblem}
            onConfirm={(reason) => void save(() => cancelFixture(supabase, id, reason))}
          />
        </>
      )}
    </Shell>
  )
}

/**
 * A GROUP OF RELATED FACTS.
 *
 * A heading, a hairline, and rows -- not a rounded white card with a shadow. Seven boxed cards stacked
 * on a phone read as a generic dashboard; spacing and typography carry the same hierarchy and leave the
 * screen feeling like an operational tool.
 */
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

/**
 * ONE FACT, WHICH MAY ALSO BE A CONTROL.
 *
 * The same row either way, so a read-only viewer sees the fixture laid out exactly as an authorised one
 * does. Where it is editable it gains a chevron and responds to a tap; where a refusal has a reason the
 * database supplied, the reason is shown rather than implied by an inert control.
 */
function Row({
  label,
  value,
  editable,
  reason,
  onPress,
  muted,
  last,
}: {
  label: string
  value: string
  editable?: boolean
  reason?: string | null
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyMedium, { color: muted ? colour.inkSubtle : colour.ink, fontSize: 15 }]}>{value}</Text>
        {!!reason && <Text style={[type.caption, { color: colour.warning, marginTop: 2 }]}>{reason}</Text>}
      </View>
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

function Action({
  icon,
  label,
  detail,
  onPress,
  busy,
  last,
}: {
  icon: React.ReactNode
  label: string
  detail?: string
  onPress: () => void
  busy?: boolean
  last?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 10,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: busy ? 0.6 : 1,
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        {!!detail && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {detail}
          </Text>
        )}
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

function Badge({ label, background, foreground }: { label: string; background: string; foreground: string }) {
  return (
    <View style={{ backgroundColor: background, borderRadius: radius.sm, paddingHorizontal: space.sm + 2, paddingVertical: 4 }}>
      <Text style={[type.overline, { color: foreground, fontSize: 10, letterSpacing: 0.8 }]}>{label}</Text>
    </View>
  )
}

/** "25 September 2026" — the weekday is already on the line above it, so it is not said twice. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

/**
 * DIRECTIONS, IN THE PHONE'S OWN MAPS.
 *
 * Ovalball is not building a map product: the device already has one, it is better, and it knows about
 * traffic on the M65. The address is encoded rather than interpolated, so a ground called "St Mary's &
 * St John's" opens a map instead of breaking the URL.
 */
async function openDirections(address: string): Promise<void> {
  const query = encodeURIComponent(address)
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
  onBack,
  insets,
  children,
  refreshing,
  onRefresh,
}: {
  title: string
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
          accessibilityLabel="Back to Fixtures"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink, flex: 1 }]}>
          {title}
        </Text>
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
