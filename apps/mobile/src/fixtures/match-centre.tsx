import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"

import { useBackToSurface } from "../links/back"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  NO_ANSWER_YET,
  availabilityEventLabel,
  availabilityQuestion,
  availabilitySubject,
  matchStatusPresentation,
  type AvailabilityStatus,
  type MatchStatusIcon,
  type WeatherResult,
} from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { loadMatchCentre, type MatchCentreSide, type MatchCentreView, type MyAvailability } from "../match-centre/load"
import { loadFixtureForecast } from "../match-centre/forecast"
import { respondToFixture } from "../match-centre/respond"
import { loadAudienceCounts, type AudienceCounts } from "../match-centre/announce"
import { loadOppositionContacts, type OppositionContact } from "../agenda/fixture-detail"
import { loadRecipients, openConversationWith } from "../messages/recipients"
import { routeForIntent } from "../links/destinations"
import { exactDate, kickoffLabel, relativeDate } from "../agenda/presentation"
import { todayIso } from "../agenda/load"
import { AnnounceSheet } from "../components/announce-sheet"
import { AvailabilityChoice } from "../components/availability-choice"
import { AvailabilityRegister } from "../components/availability-register"
import { MatchConditions } from "../components/match-conditions"
import { ClubCrest } from "../components/identity"
import { KitPlaceholder, RugbyKit } from "../components/rugby-kit"
import {
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Check as CircleCheckIcon,
  Clock,
  Megaphone,
  MessageSquare,
  Users,
} from "../components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * MATCH CENTRE -- ONE FIXTURE, ONE PAGE, EVERY ROLE.
 *
 * ONE SHARED SURFACE, and that is the architecture rather than a slogan. There is
 * no parent, player, staff or admin variant of this screen and no branch choosing
 * between trees. Everybody who can open this fixture sees the same structure in
 * the same order; CAPABILITY decides which sections their data and actions put in
 * front of them, and capability is resolved server-side through the canonical
 * RPCs -- never from a role name on a device somebody else owns.
 *
 * THE SHAPE IS THE WEBSITE'S SHAPE, section for section, because the owner's
 * review of the web Match Centre on a phone said "this is exactly how I want it
 * to look". So this is not a native reinterpretation:
 *
 *   1. the matchday card -- the status, the two clubs as CREST AND KIT either
 *      side of a V, home or away in words, the three facts a parent came for,
 *      and the viewer's own answer INSIDE the same card, because the invitation
 *      and the reply to it are one object
 *   2. match conditions -- the ground, the sky and the pitch: one question, one
 *      section, the same component Training Centre uses with one word changed
 *   3. who's in -- the squad and its counts together, staff-gated, rendering
 *      nothing at all without the capability
 *   4. the conversation -- the canonical fixture thread, with the staff announce
 *      folded into the same section as an action
 *
 * WHAT IS NATIVE RATHER THAN COPIED. Three things, each recorded as a deliberate
 * difference rather than an omission: the web embeds an OpenStreetMap pin and
 * this offers DIRECTIONS, which hands the address to the device's own maps app
 * and its live traffic; the web's conversation composer is inline and this opens
 * the canonical thread, because a text field inside a long ScrollView fights the
 * keyboard and the scroll position on a phone; and the announce composer is a
 * bottom sheet rather than a disclosure. The information architecture, the
 * wording and the order are identical.
 *
 * ANSWERING IS NOT SELECTION. Saying "I'm Available" tells the club you are free.
 * It does not put you in the team, and the wording stays on the right side of
 * that -- there is no team sheet on Ovalball yet, on either client.
 */

/** The pill's paint. The word and the icon are the shared contract's. */
const STATUS_ICON: Record<MatchStatusIcon, typeof CircleDashed> = {
  "circle-check": CircleCheckIcon,
  "circle-dashed": CircleDashed,
  "circle-alert": CircleAlert,
}
const STATUS_PAINT: Record<string, { edge: string; wash: string; text: string }> = {
  positive: { edge: "rgba(90,203,131,0.45)", wash: "rgba(90,203,131,0.15)", text: "#bff0d1" },
  caution: { edge: "rgba(251,191,36,0.45)", wash: "rgba(251,191,36,0.15)", text: "#fde8b0" },
  negative: { edge: "rgba(248,113,113,0.50)", wash: "rgba(239,68,68,0.20)", text: "#fecaca" },
  neutral: { edge: "rgba(255,255,255,0.20)", wash: "rgba(255,255,255,0.10)", text: "rgba(255,255,255,0.85)" },
}

export function MatchCentre() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  /*
    WHICH HAT THIS PERSON IS WEARING, not merely who they are.

    One person holds several roles on Ovalball -- a club admin whose daughter plays
    Under 12 -- and the switcher exists so they can say which they are operating
    as. Read as a parent, this page is the parent's Match Centre.
  */
  const { active } = useAppContexts()
  const id = String(fixtureId ?? "")
  const today = todayIso()

  const [view, setView] = useState<MatchCentreView | null>(null)
  const [weather, setWeather] = useState<WeatherResult>({ state: "PROVIDER_UNAVAILABLE", forecast: null })
  const [audience, setAudience] = useState<AudienceCounts>({ team: null, attending: null, outstanding: null })
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [announcing, setAnnouncing] = useState(false)
  const [contacts, setContacts] = useState<OppositionContact[]>([])
  const [opening, setOpening] = useState(false)
  /**
   * WHETHER THERE IS ANYBODY THIS PERSON MAY MESSAGE AT ALL.
   *
   * The count comes from `my_direct_message_candidates()`, which is the canonical
   * recipient resolver and applies `internal.may_direct_message` to its own output
   * -- adulthood first and unconditionally, then blocks, then policy, then
   * relationship. So this is not a client deciding who a guardian may talk to; it
   * is asking the one authority whether the offer is real.
   *
   * Zero means no row. An under-18 player, somebody blocked in either direction and
   * a club with messaging turned off all produce zero, and none of them is told
   * which -- an interface that explained the absence would disclose exactly what
   * the rule protects.
   */
  const [canReachSomebody, setCanReachSomebody] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      // THE HAT, NOT JUST THE PERSON. A club admin reading their daughter's match
      // as a parent gets the parent's Match Centre; switching back to their club
      // context gets their controls back, because they really are a club admin.
      const loaded = await loadMatchCentre(supabase, id, active?.kind ?? null)
      if (!loaded) {
        setMissing(true)
        return
      }
      setView(loaded)
      /*
        THE FORECAST AND THE AUDIENCE COUNTS ARE ASKED FOR SEPARATELY AND
        CANNOT FAIL THE PAGE. Weather is derived data -- a fixture is complete
        and correct without it -- and the counts are null for anybody without
        fixture-communication authority, which is a real answer rather than an
        error. Neither is awaited before the fixture renders.
      */
      void loadFixtureForecast(supabase, id).then(setWeather)
      /*
        OPPOSITION CONTACTS ARE A FIXTURE-ORGANISING FACILITY, so they are asked for
        only by somebody organising the fixture.

        `fixture_opposition_contacts` already refuses a participant -- it was proved
        returning zero rows for a guardian -- and the rows were therefore never drawn.
        But a read a family context never makes cannot leak, and asking a question a
        participant has no business asking is the shape that eventually gets it
        wrong. Opposition information may be VISIBLE; an opposition RELATIONSHIP is
        never created, and a contact is a relationship.
      */
      if (loaded.canManageFixture) {
        void loadOppositionContacts(supabase, id).then(setContacts)
        void loadAudienceCounts(supabase, id).then(setAudience)
      }
      // Whether a "Message Team Staff" row is a real offer, asked of the canonical
      // recipient resolver rather than assumed from a role.
      void loadRecipients(supabase)
        .then((people) => setCanReachSomebody(people.length > 0))
        .catch(() => setCanReachSomebody(false))
    } catch (caught) {
      const failure = friendly(caught, "this Match Centre")
      logDetail("match centre", failure)
      setProblem(failure.message)
    }
  }, [id, active])

  useEffect(() => {
    void load()
  }, [load])

  /*
    REFRESH ON FOCUS, plus pull-to-refresh, and deliberately no second realtime
    system. The website's Match Centre is force-dynamic and re-reads on
    navigation; availability has no Realtime subscription there, so building one
    here would be a mobile-only channel the two clients would then disagree
    through. A coach returning to this screen after reading a message gets the
    current counts, which is the case that actually matters.
  */
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  /**
   * CONTACTING THE OTHER SIDE is a communication action, so it sits with the
   * messaging section rather than among the fixture controls -- the same place
   * the website puts it.
   *
   * `open_direct_conversation` is the canonical opener and it DECIDES: it
   * re-applies the same eligibility rule rather than trusting that the caller
   * only ever arrived from a legitimate list. One conversation per pair, so
   * asking twice returns the same thread rather than a second one.
   */
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

  async function answer(entry: MyAvailability, status: AvailabilityStatus): Promise<boolean> {
    const result = await respondToFixture(supabase, id, entry.playerId, status)
    if (!result.ok) {
      setProblem(result.message)
      return false
    }
    setProblem(null)
    /*
      THE SERVER'S ANSWER IS WHAT MOVES THE CONTROL, and the register and the
      counts are re-read rather than adjusted locally. Incrementing "Attending"
      by one here would be a second implementation of the summary living on a
      phone, and it would be wrong the moment somebody else answered at the same
      time.
    */
    await load()
    return true
  }

  if (missing) {
    return (
      <Shell insets={insets} router={router} subtitle={null}>
        <View style={{ padding: space.lg }}>
          <EmptyState
            title="This fixture is not available"
            body="It may have been removed, or it may belong to a team you are not part of."
            icon={<Users size={26} color={colour.forest800} strokeWidth={1.8} />}
          />
        </View>
      </Shell>
    )
  }

  if (!view) {
    return (
      <Shell insets={insets} router={router} subtitle={null}>
        <View style={{ padding: space.lg, gap: space.lg }}>
          {problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton lines={4} />}
        </View>
      </Shell>
    )
  }

  const status = matchStatusPresentation(view.status)
  const StatusIcon = STATUS_ICON[status.icon]
  const paint = STATUS_PAINT[status.tone]
  const weAreHome = view.homeAway !== "Away"
  const home = weAreHome ? view.us : view.them
  const away = weAreHome ? view.them : view.us
  const homeScore = view.result ? view.result.homeScore : null
  const awayScore = view.result ? view.result.awayScore : null
  const what = availabilityEventLabel("fixture", relativeDate(view.date, today))

  return (
    <Shell insets={insets} router={router} subtitle={`${view.us.clubName} v ${view.them.clubName}`}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
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
        {/* ============================================================
            1. THE MATCHDAY CARD
            ============================================================ */}
        <View
          style={{
            borderRadius: radius.lg,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: colour.forest900,
            // A cancelled fixture is visibly, immediately different rather than
            // merely carrying a small red badge -- the web desaturates the same
            // card for the same reason.
            opacity: view.cancelled ? 0.92 : 1,
          }}
        >
          {/* Mown stripes, the way a pitch lies after the mower has been up and
              down it. The one piece of atmosphere on the page, kept low enough
              that it never competes with a crest, a kit or a word. Purely
              decorative. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.035)" : "transparent" }} />
            ))}
          </View>

          <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs + 2,
                  paddingHorizontal: space.md,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: paint.edge,
                  backgroundColor: paint.wash,
                }}
              >
                <StatusIcon size={13} color={paint.text} strokeWidth={2.4} />
                <Text style={[type.caption, { color: paint.text, fontFamily: "Inter_500Medium" }]}>{status.label}</Text>
              </View>
              {/* THE CLASSIFICATION, THE SAME WORD EVERYWHERE. `fixtures.game_type` verbatim, as the Fixtures list,
                  the Calendar card and the Team Home show it; the competition name follows where there is one. */}
              {(view.matchType || view.competitionName) && (
                <Text numberOfLines={1} style={[type.caption, { color: colour.onForestMuted, flexShrink: 1 }]}>
                  {[view.matchType, view.competitionName].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
          </View>

          {/* THE V COMPOSITION. Crest and kit at the SAME size beside each
              other: a child recognises the shirt they are about to put on far
              faster than a club badge, and two clubs in the same league often
              have similar crests and never similar kits. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.xs,
              paddingHorizontal: space.md,
              paddingTop: space.lg,
            }}
          >
            <SideColumn side={home} />
            <View style={{ alignItems: "center", paddingTop: 26, gap: space.xs }}>
              {view.result ? (
                <Text
                  accessibilityLabel={`Final score: ${home.clubName} ${homeScore}, ${away.clubName} ${awayScore}`}
                  style={[type.displaySmall, { color: colour.chalk }]}
                >
                  {homeScore}–{awayScore}
                </Text>
              ) : (
                <Text style={[type.displaySmall, { color: colour.onForestMuted, fontSize: 17, letterSpacing: 2 }]}>VS</Text>
              )}
              <View style={{ width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.10)" }} />
            </View>
            <SideColumn side={away} />
          </View>

          {/* Home or away, stated in words rather than left to be inferred from
              column order -- a parent needs to know whether to travel. */}
          {(view.homeAway === "Home" || view.homeAway === "Away") && (
            <Text
              style={[
                type.caption,
                {
                  color: colour.onForestMuted,
                  textAlign: "center",
                  letterSpacing: 0.8,
                  paddingHorizontal: space.lg,
                  paddingTop: space.md,
                },
              ]}
            >
              {(view.homeAway === "Home" ? "HOME FIXTURE" : "AWAY FIXTURE") + (view.venueName ? ` · ${view.venueName.toUpperCase()}` : "")}
            </Text>
          )}

          {/* THE THREE FACTS A PARENT CAME FOR. Meet time is given equal weight
              to kick-off, because it is the one they actually have to act on.
              DISPLAY ONLY -- all three are set in the Fixture Console, which
              owns the record. */}
          <View
            style={{
              flexDirection: "row",
              marginTop: space.md,
              borderTopWidth: 1,
              borderTopColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Fact Icon={CalendarDays} label="DATE" value={compactDate(view.date)} />
            <Fact Icon={Users} label="MEET" value={kickoffLabel(view.meetTime) ?? "Not set"} muted={!view.meetTime} divider />
            <Fact Icon={Clock} label="KICK-OFF" value={kickoffLabel(view.kickoffTime) ?? "TBC"} muted={!view.kickoffTime} divider />
          </View>

          {view.cancelled && (
            <Text accessibilityRole="alert" style={[type.small, { color: "#fecaca", padding: space.lg, paddingTop: space.md }]}>
              <Text style={{ fontFamily: "Inter_600SemiBold" }}>Cancelled. </Text>
              {view.cancellationReason ?? "This fixture is not going ahead."}
            </Text>
          )}

          {/* THE VIEWER'S OWN AVAILABILITY, inside the card. Absent entirely for
              somebody with nobody to answer for -- a coach is not shown an
              empty control. */}
          {view.mine.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.15)" }}>
              {view.mine.map((entry, index) => (
                <View
                  key={entry.playerId}
                  style={{ padding: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.10)" }}
                >
                  {entry.canRespond ? (
                    <>
                      <AvailabilityChoice
                        question={availabilityQuestion("fixture", entry.isSelf, entry.firstName)}
                        subject={availabilitySubject(entry.isSelf, entry.firstName)}
                        what={what}
                        committed={entry.response}
                        disabled={false}
                        onChoose={(next) => answer(entry, next)}
                      />
                      {entry.response === null && (
                        <Text style={[type.small, { color: colour.onForestMuted, marginTop: space.sm }]}>{NO_ANSWER_YET}</Text>
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={[type.smallMedium, { color: colour.chalk }]}>
                        {availabilityQuestion("fixture", entry.isSelf, entry.firstName)}
                      </Text>
                      {/* THE DATABASE'S OWN SENTENCE. A sixteen-year-old without
                          recorded guardian consent reads the rule rather than
                          learning it from a red error after tapping. */}
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

        {problem && <ErrorState message={problem} onRetry={() => void load()} />}

        {/* ============================================================
            2. WHERE, AND WHAT IT WILL BE LIKE THERE
            ============================================================ */}
        <MatchConditions
          venueName={view.venueName}
          postcode={view.venuePostcode}
          // The whole address, for Directions. The panel prints the NAME.
          addressLines={view.venueAddressLines}
          pitchName={view.pitchName}
          weather={weather}
        />

        {/* ============================================================
            3. THE SQUAD. Nothing at all without the capability -- a viewer who
               cannot see the roster is not missing a feature, they are simply
               not staff, and telling them so on every fixture is noise.
            ============================================================ */}
        {view.canViewRegister && (
          <AvailabilityRegister
            title="Who's In"
            entries={view.register}
            emptyBody="No participants recorded yet."
          />
        )}

        {/* ============================================================
            4. THE CONVERSATION, and the announcement beside it.

               THEY ARE NOT THE SAME THING and are not merged into one control:
               posting in the thread reaches whoever comes and reads it, while an
               announcement is a NOTIFICATION delivered through the
               safeguarding-aware recipient model, so it reaches a guardian who
               never opens the app. Collapsing the second into the first would
               quietly stop families being told things.
            ============================================================ */}
        {/* ============================================================
              A PARTICIPANT'S OWN WAY OF ASKING SOMEBODY.

              `can_message` is `internal.can_access_fixture_conversation` -- the
              CLUB-TO-CLUB thread about arranging this match -- and a guardian does
              not hold it, correctly. So without this block a parent reached the
              Match Centre and had no way to ask a question about their child's
              Saturday, which is the single most ordinary thing a parent wants to do.

              IT IS A SHORTCUT INTO THE CANONICAL CHOOSER, NOT A SECOND ROUTE.
              `/messages/new` is built on `my_direct_message_candidates()`, which
              applies `internal.may_direct_message` to its own output; this row saves
              two taps and changes nothing about who may be reached. There is no
              Match Centre recipient resolution, no recipient id constructed here,
              and no fixture-derived authority: participating in a fixture has never
              been a reason anybody may message anybody.

              WHICH IS WHY IT SAYS "YOUR CLUB" AND NOT "THE OPPOSITION". The people
              the canonical list offers a guardian are their own club's -- proved in
              P1, where a parent's list was eight people, every one of them at their
              own club, and an opposition admin named by id was refused. The offer is
              absent entirely when the list is empty, which is what an under-18
              player gets.
           ============================================================ */}
        {!view.canMessage && canReachSomebody && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Message somebody at your club"
              onPress={() => router.push("/messages/new")}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.lg,
                backgroundColor: pressed ? colour.chalk : colour.surface,
              })}
            >
              <MessageSquare size={18} color={colour.forest800} />
              <View style={{ flex: 1 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Message Team Staff</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                  Ask a question about this match. Who you can reach is set by your club.
                </Text>
              </View>
              <ChevronRight size={18} color={colour.inkSubtle} />
            </Pressable>
          </View>
        )}

        {view.canMessage && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderBottomWidth: 1,
                borderBottomColor: colour.line,
                backgroundColor: colour.chalk,
              }}
            >
              <MessageSquare size={14} color={colour.inkMuted} />
              <Text accessibilityRole="header" style={[type.overline, { color: colour.inkMuted }]}>
                CONVERSATION
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the fixture conversation"
              onPress={() => router.push(`/messages/fixture/${id}`)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.lg,
                backgroundColor: pressed ? colour.chalk : colour.surface,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Open the conversation</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                  This is where the team talks about this match.
                </Text>
              </View>
              <ChevronRight size={18} color={colour.inkSubtle} />
            </Pressable>

            {/* MESSAGE OPPOSITION EXISTS ONLY WHERE THERE IS SOMEBODY TO
                MESSAGE. `fixture_opposition_contacts` returns nothing when the
                opponent is not an Ovalball team, when the viewer is not
                involved, or when the safeguarding rules say no -- so an empty
                list means the row is simply absent. No disabled button, and
                nothing that fails after being tapped. Most fixtures name their
                opponent from the Club Directory, where there is no account to
                message at all. */}
            {contacts.map((contact) => (
              <Pressable
                key={contact.userId}
                accessibilityRole="button"
                accessibilityLabel={`Message ${contact.displayName}`}
                accessibilityState={{ disabled: opening }}
                disabled={opening}
                onPress={() => void messageOpposition(contact)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderTopWidth: 1,
                  borderTopColor: colour.line,
                  backgroundColor: pressed ? colour.chalk : colour.surface,
                  opacity: opening ? 0.6 : 1,
                })}
              >
                <MessageSquare size={18} color={colour.forest800} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>
                    {contacts.length === 1 ? "Message Opposition" : `Message ${contact.displayName}`}
                  </Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                    {[contact.displayName, contact.clubLabel].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <ChevronRight size={18} color={colour.inkSubtle} />
              </Pressable>
            ))}

            {/* ANNOUNCE, for staff only. The counts come back null for anybody
                without fixture-communication authority, so the row is absent
                rather than showing a confident zero. */}
            {view.canManageFixture && (audience.team !== null || audience.attending !== null) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Announce to the squad"
                onPress={() => setAnnouncing(true)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderTopWidth: 1,
                  borderTopColor: colour.line,
                  backgroundColor: pressed ? colour.chalk : colour.surface,
                })}
              >
                <Megaphone size={18} color={colour.forest800} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Announce to the Squad</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>Notifies families, not just this thread</Text>
                </View>
                <ChevronRight size={18} color={colour.inkSubtle} />
              </Pressable>
            )}
          </View>
        )}

        {/* THE ROUTE TO THE RECORD, FOR THE PEOPLE WHOSE JOB IT IS.
            Match Centre owns people; the Fixture Console owns when, where and who
            to contact -- moving a kick-off, changing a pitch, cancelling, reaching
            the opposition. That is administration.

            It used to be offered to everybody on the grounds that the console is
            itself capability-aware, and that was the wrong test. Every control in
            there is correctly refused to a guardian, but the SCREEN is still
            fixture administration, and a parent who taps their child's match should
            not arrive at one -- the product rule is that a fixture card is an
            entrance to Match Centre, not to the console. So the offer follows the
            canonical `can_manage_fixture` capability the server already resolved
            for this viewer and this fixture. */}
        {view.canManageFixture && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fixture details"
          // Through the one destination table, to the canonical address -- which for
          // this viewer resolves to the console precisely because the server said
          // they may manage this fixture.
          onPress={() => {
            const route = routeForIntent({ kind: "FIXTURE", fixtureId: id })
            if (route) router.push(route as never)
          }}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colour.line,
            backgroundColor: pressed ? colour.chalk : colour.surface,
          })}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Fixture Details</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>When, where and who to contact</Text>
          </View>
          <ChevronRight size={18} color={colour.inkSubtle} />
        </Pressable>
        )}
      </ScrollView>

      {announcing && (
        <AnnounceSheet
          fixtureId={id}
          counts={audience}
          onClose={() => setAnnouncing(false)}
        />
      )}
    </Shell>
  )
}

/**
 * ONE SIDE OF THE FIXTURE.
 *
 * Crest and kit at the same size beside each other, which is what a matchday
 * programme does and what a club recognises -- the web's hero made the same
 * change after the crest, at a third of the kit's height, read as a caption on
 * the shirt rather than as the club's own mark.
 *
 * Club names WRAP rather than truncate. "Ashton-under-Lyne Rugby Football Club"
 * cut to "Ashton-un…" on a 390pt screen is worse than two lines.
 */
function SideColumn({ side }: { side: MatchCentreSide }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center", gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs }}>
        <ClubCrest clubName={side.clubName} url={side.crestUrl} size={56} />
        {side.kit ? (
          <RugbyKit kit={side.kit} clubName={side.clubName} size={56} />
        ) : (
          // A club with no structured kit is a real and common state -- an
          // unclaimed opposition almost always is. It gets a deliberate,
          // finished placeholder rather than an empty box.
          <KitPlaceholder size={56} />
        )}
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={[type.displaySmall, { color: colour.chalk, fontSize: 15, lineHeight: 18, textAlign: "center" }]}>
          {side.clubName.toUpperCase()}
        </Text>
        {side.teamName && (
          <Text style={[type.small, { color: colour.onForestMuted, textAlign: "center", marginTop: 2 }]}>{side.teamName}</Text>
        )}
        {!side.onOvalball && (
          <Text style={[type.caption, { color: colour.onForestMuted, fontSize: 10, letterSpacing: 0.6, textAlign: "center", marginTop: 3 }]}>
            NOT YET ON OVALBALL
          </Text>
        )}
      </View>
    </View>
  )
}

function Fact({
  Icon,
  label,
  value,
  muted = false,
  divider = false,
}: {
  Icon: typeof CalendarDays
  label: string
  value: string
  muted?: boolean
  divider?: boolean
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        gap: space.xs,
        paddingVertical: space.lg,
        paddingHorizontal: space.sm,
        borderLeftWidth: divider ? 1 : 0,
        borderLeftColor: "rgba(255,255,255,0.10)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Icon size={13} color={colour.onForestMuted} />
        <Text style={[type.caption, { color: colour.onForestMuted, fontSize: 11, letterSpacing: 0.6 }]}>{label}</Text>
      </View>
      <Text style={[type.displaySmall, { color: muted ? colour.onForestMuted : colour.chalk, fontSize: 16, lineHeight: 19, textAlign: "center" }]}>
        {value.toUpperCase()}
      </Text>
    </View>
  )
}

/**
 * "SUN 27 SEPT" -- for the three-across facts strip, where the long form wraps to
 * three lines inside a narrow column on a phone and stops being scannable. The
 * weekday survives, because "which Sunday" is the thing a parent is placing.
 *
 * Parsed as a PLAIN CALENDAR DATE. A fixture's date is the club's local day, and
 * letting the device's timezone shift it is how a Sunday match shows up as
 * Saturday for somebody abroad.
 */
function compactDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  )
}

function Shell({
  insets,
  router,
  subtitle,
  children,
}: {
  insets: { top: number }
  router: ReturnType<typeof useRouter>
  subtitle: string | null
  children: React.ReactNode
}) {
  const back = useBackToSurface("/fixtures")
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
          accessibilityLabel="Back to the fixture"
          onPress={back}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
            Match Centre
          </Text>
          {subtitle && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      {children}
    </View>
  )
}
