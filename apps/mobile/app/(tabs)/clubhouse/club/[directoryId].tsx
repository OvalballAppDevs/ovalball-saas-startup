import { Children, useEffect, useMemo, useState } from "react"
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  distanceMiles,
  findDistanceOrigin,
  findFixtureWeekLabel,
  gameWeekRange,
  inviteClubToOvalball,
  otherWeekCommitmentsForOpponent,
  readClubDetail,
  readClubhouseMarkers,
  requestPartnership,
  respondToPartnership,
  revokePartnership,
  type CandidateAvailabilityBatchRow,
  type ClubDetail,
  type ClubMapMarker,
  type CompatibleTeam,
  type FindFixtureVenuePreference,
  type GameWeekCommitmentRow,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, sortTeamsInRugbyAgeOrder, summariseClubAgeGroups, type ClubTeam } from "@ovalball/contracts/club/teams"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { startClubConversation } from "../../../../src/messages/club-conversations"
import { CLAIMABLE_ROLES, submitClubClaim, type ClaimableRole } from "../../../../src/clubhouse/claims"
import { ChoiceField, Field, TextField } from "../../../../src/components/form"
import { BottomSheet } from "../../../../src/components/bottom-sheet"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { CalendarDays, ChevronRight, Globe, MapPin, Share2, Users } from "../../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"
import { webUrl } from "../../../../src/config/environment"
import { ClubCrest, ClubMetricRow } from "../../../../src/clubhouse/components"
import { createFixtureRequest } from "../../../../src/agenda/mutations"

/**
 * THE RICH CLUB PROFILE (mock-up reconciliation pass -- Screen 4/5 of the supplied visual specification
 * is now the acceptance reference, not merely inspiration), plus the DIRECTORY-ONLY presentation for a
 * club that has not joined Ovalball -- one route, one `directoryId`, converging exactly the way Match
 * Centre converges on one `fixture_id`: the server-derived `ClubDetail`/`ClubMapMarker` decide which body
 * renders, never a second implementation copied for "the unclaimed case."
 *
 * WHY THIS REBUILD: the previous pass fixed the profile's own-club data bug (no more nonsense "0
 * fixtures" stat) but left the page visually thin -- a hero, one "N active sides" line, and a mostly
 * empty page. This pass adds the information density the reference asks for: a real metric row, actual
 * team ROWS (not a bare count), an About/Club Details/Location composition in Overview, and a genuine
 * bottom action bar rather than buttons loose in the scrolling content.
 *
 * NO SINGLE-CLUB READ EXISTS YET, deliberately not added here: `readClubhouseMarkers` already fetches the
 * whole ~1,400-row directory client-side (the same trade-off the map screen already makes, at the same
 * real scale), so a fresh navigation (a deep link, a notification, a cold app-open on this route) reuses
 * that one canonical read rather than a new migration/RPC for a single row.
 */
export default function ClubProfile() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { directoryId, ffDate, ffTeamLabels, ffAvailability, ffWeekRows, ffTeamIds, ffVenuePreference, ffCompatibleTeams } = useLocalSearchParams<{
    directoryId: string
    ffDate?: string
    ffTeamLabels?: string
    ffAvailability?: string
    ffWeekRows?: string
    ffTeamIds?: string
    ffVenuePreference?: FindFixtureVenuePreference
    ffCompatibleTeams?: string
  }>()

  // FIND A FIXTURE SEARCH CONTEXT (Section B4, extended for the Request Fixtures handoff): present only
  // when this profile was opened from an FF-3 result card -- never fabricated when the club was reached
  // any other way (Clubhouse map, a fixture, a search). Reuses the EXACT rows FF-2 already computed;
  // nothing here re-derives availability. `teamIds`/`venuePreference` travel through untouched from FF-1's
  // own criteria so Request Fixtures can hand them to the composer -- never re-derived or guessed here.
  // `compatibleTeams` is THIS candidate's own opposition-team list, exactly as FF-3 already computed it --
  // never `detail.compatibleTeams` when this context exists, because that field answers a DIFFERENT
  // question (compatibility for the viewer's currently active app context, not for the actual search that
  // brought the viewer to this profile), and conflating the two was producing a false "0/0" here.
  const findFixtureContext = useMemo(() => {
    if (!ffDate) return null
    try {
      return {
        date: ffDate,
        teamLabels: ffTeamLabels ? (JSON.parse(ffTeamLabels) as string[]) : [],
        availability: ffAvailability ? (JSON.parse(ffAvailability) as CandidateAvailabilityBatchRow[]) : [],
        weekRows: ffWeekRows ? (JSON.parse(ffWeekRows) as GameWeekCommitmentRow[]) : [],
        teamIds: ffTeamIds ? (JSON.parse(ffTeamIds) as string[]) : [],
        venuePreference: (ffVenuePreference as FindFixtureVenuePreference | undefined) ?? "either",
        compatibleTeams: ffCompatibleTeams ? (JSON.parse(ffCompatibleTeams) as CompatibleTeam[]) : [],
      }
    } catch {
      return null
    }
  }, [ffDate, ffTeamLabels, ffAvailability, ffWeekRows, ffTeamIds, ffVenuePreference, ffCompatibleTeams])
  const { userId } = useSession()
  const { active } = useAppContexts()
  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClubDetail | null>(null)
  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)
  const [viewerTeams, setViewerTeams] = useState<ClubTeam[] | null>(null)
  const [clubFixtureRequests, setClubFixtureRequests] = useState<{ incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageSentFor, setMessageSentFor] = useState<string | null>(null)

  function loadMarkers() {
    void readClubhouseMarkers(supabase, viewerClubId, viewerTeamId)
      .then((rows) => setMarkers(rows))
      .catch(() => setError("Couldn't load this club. Check your connection and try again."))
  }

  useEffect(() => {
    let live = true
    setError(null)
    void readClubhouseMarkers(supabase, viewerClubId, viewerTeamId)
      .then((rows) => {
        if (live) setMarkers(rows)
      })
      .catch(() => {
        if (live) setError("Couldn't load this club. Check your connection and try again.")
      })
    return () => {
      live = false
    }
  }, [viewerClubId, viewerTeamId])

  const marker = useMemo(() => markers?.find((m) => m.directoryId === directoryId) ?? null, [markers, directoryId])
  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  function loadDetail() {
    if (!marker) return
    void readClubDetail(supabase, marker, viewerClubId, viewerTeamId).then(setDetail)
  }

  useEffect(() => {
    setDetail(null)
    loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loadDetail` closes over `marker`, which is already a dependency here.
  }, [marker, viewerClubId, viewerTeamId])

  useEffect(() => {
    setClubTeams(null)
    if (!marker?.clubId) return
    let live = true
    void readClubTeams(supabase, marker.clubId).then((d) => {
      if (live) setClubTeams(d.teams.filter((t) => t.active))
    })
    return () => {
      live = false
    }
  }, [marker?.clubId])

  // THE VIEWER'S OWN ROSTER + EXISTING REQUESTS AGAINST THIS CLUB (Section I/M): `readClubFixtureRequests`
  // is the SAME canonical read the Club/Team Requests screens already use, scoped here to the viewer's
  // own teams and then filtered client-side to this specific opponent -- never a second request domain.
  function loadFixtureRequests() {
    if (!viewerClubId) return
    void readClubTeams(supabase, viewerClubId).then((d) => {
      const teams = d.teams.filter((t) => t.active)
      setViewerTeams(teams)
      void readClubFixtureRequests(supabase, teams.map((t) => ({ id: t.id, name: t.displayName }))).then(setClubFixtureRequests)
    })
  }

  useEffect(() => {
    setViewerTeams(null)
    setClubFixtureRequests(null)
    loadFixtureRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loadFixtureRequests` closes over `viewerClubId`, already a dependency here.
  }, [viewerClubId])

  const isOtherClub = !!marker && marker.clubId !== null && !marker.isOwnClub
  const hasTeams = !!clubTeams && clubTeams.length > 0
  const hasHistory = isOtherClub && !!detail && (detail.fixturesTogetherThisSeason !== null || detail.fixturesTogetherAllTime !== null || !!detail.firstMetDate)
  const hasPartnershipContent =
    isOtherClub && !!detail && !!marker && (detail.actions.canPartner || detail.actions.canCancelOutgoingPartnerRequest || detail.actions.canRespondPartnerRequest || detail.actions.canRevokePartnership || marker.partnershipStatus !== "none")

  async function act(run: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true)
    setFeedback(null)
    setSuccessMessage(null)
    const result = await run()
    if (!result.ok) setFeedback(result.error ?? "That didn't work. Try again.")
    else {
      loadDetail()
      loadMarkers()
      if (result.message) setSuccessMessage(result.message)
    }
    setBusy(false)
  }

  // MESSAGE THIS CLUB (owner correction, Section C): the composer is a SHEET, not inline content inside
  // Overview, and a successful send DISMISSES it and shows a real acknowledgement naming the club --
  // never silently leaves the composer sitting there with no sign anything happened. `sendingMessage`
  // itself is the in-flight guard, since Button already disables its own press while `busy`.
  async function sendMessage() {
    if (!viewerClubId || !marker?.clubId || messageDraft === null || sendingMessage) return
    setSendingMessage(true)
    setFeedback(null)
    const result = await startClubConversation(supabase, viewerClubId, marker.clubId, messageDraft.trim())
    setSendingMessage(false)
    if (!result.ok || !result.conversationId) {
      setFeedback(result.error ?? "That didn't work. Try again.")
      return
    }
    setMessageDraft(null)
    setMessageSentFor(marker.name)
  }

  const [requestingTeamId, setRequestingTeamId] = useState<string | null>(null)

  /** ONE TEAM PER CANONICAL REQUEST (Section L): `createFixtureRequest` is mobile's own existing,
   * unmodified, single-team insert path (Section 8) -- never a new batched/grouped mutation invented for
   * this row. Selecting several compatible teams' rows means calling it once per pairing, each getting
   * its own real, independently trackable request. */
  async function requestFixturesForTeam(myTeamId: string, opponentTeamId: string) {
    if (!viewerClubId || !marker?.clubId || !findFixtureContext || requestingTeamId) return
    setRequestingTeamId(myTeamId)
    setFeedback(null)
    const result = await createFixtureRequest(supabase, {
      requestingClubId: viewerClubId,
      requestingTeamId: myTeamId,
      targetTeamId: opponentTeamId,
      opponentClubId: marker.clubId,
      opponentDirectoryId: marker.directoryId,
      rawOpponentText: marker.name,
      proposedDate: findFixtureContext.date,
      preferredKickoffTime: null,
      venuePreference: findFixtureContext.venuePreference,
      note: null,
    })
    setRequestingTeamId(null)
    if (!result.ok) {
      setFeedback(result.message)
      return
    }
    setSuccessMessage(`Fixture request sent to ${marker.name}.`)
    loadFixtureRequests()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <ProfileBackHeader onBack={() => router.back()} insets={insets} />

      {markers === null && !error && (
        <View style={{ padding: space.lg, gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}

      {error && (
        <View style={{ padding: space.lg }}>
          <ErrorState message={error} onRetry={() => setMarkers(null)} />
        </View>
      )}

      {markers !== null && !error && !marker && (
        <View style={{ padding: space.lg }}>
          <ErrorState message="This club couldn't be found. It may have been removed from the directory." />
        </View>
      )}

      {marker && marker.networkState === "not_on_ovalball" && (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }} showsVerticalScrollIndicator={false}>
          <ProfileHeroBlock marker={marker} origin={origin} />
          <DirectoryOnlyBody marker={marker} detail={detail} viewerClubId={viewerClubId} />
        </ScrollView>
      )}

      {marker && marker.networkState === "on_ovalball" && (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
            <ProfileHeroBlock marker={marker} origin={origin} coverUrl={detail?.coverUrl} />
            {(() => {
              const metrics = buildHeroMetrics({ clubTeams, findFixtureContext, marker })
              return metrics.length > 0 ? (
                <View style={{ paddingHorizontal: GUTTER, paddingTop: space.sm }}>
                  <ClubMetricRow metrics={metrics} variant="flat" />
                </View>
              ) : null
            })()}
            <OnOvalballBody
              marker={marker}
              detail={detail}
              clubTeams={clubTeams}
              hasTeams={hasTeams}
              hasHistory={hasHistory}
              hasPartnershipContent={hasPartnershipContent}
              findFixtureContext={findFixtureContext}
              isOtherClub={isOtherClub}
              busy={busy}
              feedback={feedback}
              successMessage={successMessage}
              onAct={act}
              viewerTeams={viewerTeams}
              existingRequests={clubFixtureRequests}
              requestingTeamId={requestingTeamId}
              onRequestFixtures={requestFixturesForTeam}
              onOpenRequestFixtures={() =>
                router.push({
                  pathname: "/fixtures/new",
                  params: {
                    opponentDirectoryId: marker.directoryId,
                    opponentClubId: marker.clubId ?? "",
                    date: findFixtureContext?.date ?? "",
                    teamId: findFixtureContext?.teamIds[0] ?? "",
                    targetTeamId: findFixtureContext?.compatibleTeams[0]?.teamId ?? "",
                    venuePreference: findFixtureContext?.venuePreference ?? "either",
                  },
                } as never)
              }
              onRequestPartnership={() =>
                void act(async () => {
                  if (!viewerClubId || !userId || !marker.clubId) return { ok: false, error: "You don't have fixture authority at a club." }
                  const result = await requestPartnership(supabase, viewerClubId, marker.clubId, userId)
                  return { ...result, message: result.ok ? `Partnership request sent to ${marker.name}.` : undefined }
                })
              }
            />
          </ScrollView>

          <BottomSheet visible={messageDraft !== null} onClose={() => setMessageDraft(null)} title="Message This Club">
            <TextInput
              accessibilityLabel="First message"
              value={messageDraft ?? ""}
              onChangeText={(v) => setMessageDraft(v)}
              placeholder="Write your message…"
              placeholderTextColor={colour.inkSubtle}
              multiline
              style={{ minHeight: 88, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk, color: colour.ink, textAlignVertical: "top" }}
            />
            {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}
            <Button label="Send" busy={sendingMessage} disabled={!messageDraft?.trim()} onPress={sendMessage} />
          </BottomSheet>

          <BottomSheet visible={!!messageSentFor} onClose={() => setMessageSentFor(null)} title="Message Sent" cancelLabel="Done">
            <Text style={[type.small, { color: colour.ink }]}>{`You've sent ${messageSentFor} a message.`}</Text>
          </BottomSheet>
          {/* THE BOTTOM ACTION BAR (visual-lock Job 2, Section 15): two buttons when this profile was
              reached from an FF-3 result card (a contextual secondary action plus the primary "Request
              Fixtures" CTA) -- NEVER a third button, and Request Fixtures never routes back into Find a
              Fixture's own search screen. Outside that context the bar keeps its previous, wider set of
              real actions (Make Partnership / Message Club / Request Fixtures), unchanged. */}
          {detail && (detail.actions.canFindFixture || detail.actions.canMessage || (marker.partnershipStatus === "none" && detail.actions.canPartner)) && (
            <ProfileActionBar insetsBottom={insets.bottom}>
              {findFixtureContext ? (
                <>
                  {detail.actions.canMessage && <Button variant="secondary" label="Message Club" onPress={() => setMessageDraft((d) => (d === null ? "" : d))} />}
                  {detail.actions.canFindFixture && (
                    <Button
                      label="Request Fixtures"
                      style={{ backgroundColor: colour.pitch600, borderColor: colour.pitch600 }}
                      onPress={() =>
                        router.push({
                          pathname: "/fixtures/new",
                          params: {
                            opponentDirectoryId: marker.directoryId,
                            opponentClubId: marker.clubId ?? "",
                            date: findFixtureContext.date,
                            teamId: findFixtureContext.teamIds[0] ?? "",
                            targetTeamId: findFixtureContext.compatibleTeams[0]?.teamId ?? detail.compatibleTeams?.[0]?.teamId ?? "",
                            venuePreference: findFixtureContext.venuePreference,
                          },
                        } as never)
                      }
                    />
                  )}
                </>
              ) : (
                <>
                  {marker.partnershipStatus === "none" && detail.actions.canPartner && (
                    <Button
                      variant="secondary"
                      label="Make Partnership"
                      busy={busy}
                      onPress={() =>
                        void act(async () => {
                          if (!viewerClubId || !userId || !marker.clubId) return { ok: false, error: "You don't have fixture authority at a club." }
                          return requestPartnership(supabase, viewerClubId, marker.clubId, userId)
                        })
                      }
                    />
                  )}
                  {detail.actions.canMessage && <Button variant="secondary" label="Message Club" onPress={() => setMessageDraft((d) => (d === null ? "" : d))} />}
                  {detail.actions.canFindFixture && (
                    <Button
                      label="Request Fixtures"
                      style={{ backgroundColor: colour.pitch600, borderColor: colour.pitch600 }}
                      onPress={() => router.push({ pathname: "/fixtures/new", params: { opponentDirectoryId: marker.directoryId, opponentClubId: marker.clubId ?? "" } } as never)}
                    />
                  )}
                </>
              )}
            </ProfileActionBar>
          )}
        </>
      )}
    </View>
  )
}

/** Which of a candidate opposition team's dates are genuinely clear -- the ONE calculation the
 * Availability tab and the hero's own search-context metric both need, computed once here so the
 * tab's per-row label and the metric's count can never quietly disagree. */
function candidateTeamWeekLabel(teamId: string, findFixtureContext: FindFixtureProfileContext, partnershipStatus: ClubMapMarker["partnershipStatus"]) {
  const exact = findFixtureContext.availability.find((r) => r.opponent_team_id === teamId && r.the_date === findFixtureContext.date)
  const dateState = exact ? (exact.status === "busy" ? "busy" : "tentative") : partnershipStatus === "active" ? "no_known_clash" : "unknown"
  const otherWeekCommitments = otherWeekCommitmentsForOpponent(teamId, findFixtureContext.date, findFixtureContext.weekRows)
  return findFixtureWeekLabel({ dateState, otherWeekCommitments })
}

/** WHICH OF THE VIEWER'S OWN TEAMS PLAYS THIS OPPONENT (Section G): real rugby-natural matching --
 * same age grade and gender for a youth side, same gender alone for a senior side (both sides' own
 * `ageGroup` is null there) -- never a guess, the exact rule the server's own compatibility check
 * already applies. Returns null only if the viewer's roster hasn't loaded yet. */
function pairViewerTeam(opponent: CompatibleTeam, viewerTeams: ClubTeam[] | null): ClubTeam | null {
  if (!viewerTeams) return null
  if (opponent.ageGroup) return viewerTeams.find((t) => t.ageGroup === opponent.ageGroup && t.gender === opponent.gender) ?? null
  return viewerTeams.find((t) => t.category === "senior" && t.gender === opponent.gender) ?? null
}

/** A REAL, ALREADY-OUTSTANDING fixture request for this exact team against this exact club (Section I)
 * -- checked before ever offering a second Request action, which the canonical duplicate-request guard
 * would refuse anyway. `sent`/`counter_proposed` are the two "still live, waiting on somebody" states. */
function existingRequestFor(viewerTeamId: string, clubName: string, requests: { incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] } | null): ClubFixtureRequest | null {
  if (!requests) return null
  return [...requests.outgoing, ...requests.incoming].find((r) => r.ourTeamId === viewerTeamId && r.otherClub === clubName && (r.status === "sent" || r.status === "counter_proposed")) ?? null
}

function buildHeroMetrics({
  clubTeams,
  findFixtureContext,
  marker,
}: {
  clubTeams: ClubTeam[] | null
  findFixtureContext: FindFixtureProfileContext | null
  marker: ClubMapMarker
}): { value: string; label: string; icon?: React.ReactNode }[] {
  const metrics: { value: string; label: string; icon?: React.ReactNode }[] = []
  if (clubTeams && clubTeams.length > 0) {
    metrics.push({ value: String(clubTeams.length), label: clubTeams.length === 1 ? "Team" : "Teams", icon: <Users size={16} color={colour.inkMuted} /> })
    const ages = summariseClubAgeGroups(clubTeams)
    if (ages) metrics.push({ value: ages, label: "Age Groups", icon: <CalendarDays size={16} color={colour.inkMuted} /> })
  }
  // THE SEARCH-CONTEXT METRIC (visual-lock Job 2, Section 8): only rendered when this profile was
  // opened from an FF-3 result card -- never fabricated on a generic visit with no search behind it.
  // `compatibleTeams` here is FF-3's OWN candidate data (see `FindFixtureProfileContext`), never
  // `detail.compatibleTeams` -- that field answered a different, narrower question and was the actual
  // cause of a false "0/0" here.
  if (findFixtureContext) {
    const compatible = findFixtureContext.compatibleTeams
    const clear = compatible.filter((t) => candidateTeamWeekLabel(t.teamId, findFixtureContext, marker.partnershipStatus).primary === "No known clash").length
    metrics.push({ value: `${clear}/${compatible.length}`, label: "Teams Available", icon: <Users size={16} color={colour.inkMuted} /> })
  }
  return metrics
}

function ProfileBackHeader({ onBack, insets }: { onBack: () => void; insets: { top: number } }) {
  return (
    <View
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.md,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colour.forest950,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.onForest} />
        </View>
      </Pressable>
      {/* Never the club name here -- it is already anchored to the cover below, and a repeated name in
          a second header was one of the owner's own named defects (visual-lock Job 2, Section 3). No
          right-side action exists for this route yet, so none is added rather than inventing one. */}
      <Text numberOfLines={1} accessibilityRole="header" style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>
        Club Detail
      </Text>
    </View>
  )
}

/** ONE page-level horizontal margin (owner correction, Section 17): every section below -- crest,
 * identity row, metrics, tab bar, body, bottom actions -- anchors to this SAME gutter, never its own
 * separately-chosen inset. */
const GUTTER = space.xl
const CREST_SIZE = 96
const CREST_OVERLAP = CREST_SIZE / 2

/**
 * THE COVER (visual-lock Job 2, Sections 4-6): a real photograph when the club has uploaded one
 * (`clubs.cover_storage_path`), full-bleed and cover-cropped, with a dark gradient over its LOWER
 * portion only -- never a translucent box tinting the whole hero, which was the previous pass's own
 * named defect. Rounded top corners only (it sits flush against the forest header above and flows
 * straight into the white identity section below, never a floating card with rounded corners all
 * round). A club with no cover photo (the ~1,400 directory rows with no `clubs` row at all, or an
 * on-Ovalball club that has never uploaded one) gets the same forest-gradient ground `ClubhouseHero`
 * already uses elsewhere -- a real, honest surface, never a stock photo standing in for a club Ovalball
 * has never photographed. The crest overlaps the cover's own bottom edge, left-aligned, in a white
 * rounded backing with a subtle shadow -- real canonical crest artwork only, never kit or a stretched
 * fallback. The club name is anchored to the bottom of the cover in large bold white text, never
 * repeated in the header above.
 */
const COVER_HEIGHT = 208

/**
 * THE COVER PHOTO on its own -- clipped to rounded top corners, no crest inside it. The crest is
 * deliberately NOT a child here: see `ProfileHeroBlock` below for why.
 */
function ProfileCoverPhoto({ marker, coverUrl }: { marker: ClubMapMarker; coverUrl?: string | null }) {
  return (
    <View style={{ height: COVER_HEIGHT, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest900 }}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      ) : (
        <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
          <Defs>
            <LinearGradient id="clubProfileNoPhotoGround" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colour.forest800} stopOpacity="1" />
              <Stop offset="1" stopColor={colour.forest950} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#clubProfileNoPhotoGround)" />
        </Svg>
      )}
      <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="clubProfileCoverShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.45" stopColor={colour.forest950} stopOpacity="0" />
            <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.8" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#clubProfileCoverShade)" />
      </Svg>
      <View style={{ position: "absolute", left: GUTTER + CREST_SIZE + 16, right: GUTTER, bottom: 20 }}>
        {/* Bold Inter, never the condensed display face -- that face's own glyphs read as all-caps,
            which the reference's club name never does. A club's real name is a proper noun, not a
            section heading, so it keeps its ordinary mixed-case form here. */}
        <Text numberOfLines={2} accessibilityRole="header" style={{ fontFamily: type.title.fontFamily, fontSize: 26, lineHeight: 30, color: colour.onForest }}>
          {marker.name}
        </Text>
      </View>
    </View>
  )
}

/**
 * THE COVER + IDENTITY SECTION + CREST, composed together on purpose (fixed defect: the crest used to
 * be painted BEFORE the white identity section below it in sibling order, so that section's own opaque
 * background painted over the crest's lower half even after it was no longer being clipped -- an
 * absolutely-positioned element that escapes its parent's bounds still respects ordinary paint order
 * against LATER siblings, and "later" here meant the identity section). The crest is now the LAST child
 * of this shared wrapper, positioned from the wrapper's own TOP (a stable, known offset -- the cover is
 * always exactly `COVER_HEIGHT`), so it paints on top of both the cover photo and the identity section
 * and is never obscured by either one.
 */
function ProfileHeroBlock({ marker, origin, coverUrl }: { marker: ClubMapMarker; origin: ClubMapMarker | null; coverUrl?: string | null }) {
  return (
    <View style={{ position: "relative" }}>
      <ProfileCoverPhoto marker={marker} coverUrl={coverUrl} />
      <ProfileIdentitySection marker={marker} origin={origin} />
      <View
        style={{
          position: "absolute",
          left: GUTTER,
          top: COVER_HEIGHT - CREST_OVERLAP,
          width: CREST_SIZE,
          height: CREST_SIZE,
          borderRadius: radius.lg,
          backgroundColor: colour.surface,
          alignItems: "center",
          justifyContent: "center",
          ...elevation.card,
        }}
      >
        <ClubCrest url={marker.logoUrl} size={CREST_SIZE - 16} />
      </View>
    </View>
  )
}

/**
 * THE IDENTITY SECTION (visual-lock Job 2, Section 4-7, owner corrections): on plain white, directly
 * below the cover -- the two badges the reference shows, `[On Ovalball] [Partner]`, only when each is
 * canonically true, plus whichever real pending/unknown partnership state genuinely applies (never
 * invented for the reference, but never silently dropped either -- a club with a pending or unknown
 * relationship still gets a truthful pill here, matching the same rule FF-3's own result cards keep).
 * Then "Town, County · N miles away" immediately beneath, on the same white background.
 *
 * LEFT-ALIGNED, indented to `crest right + 16pt` -- the SAME horizontal anchor the club name uses in
 * the cover above, so the crest and this row read as one composed unit rather than two separately
 * stacked components. `paddingTop` is minimal: this row sits BESIDE the crest, not below it, so it
 * doesn't need to wait for the crest's own overlap to clear vertically.
 *
 * "Approximate location" is deliberately NOT a status badge here (owner correction): it is metadata
 * about the location's own precision, not a network/relationship fact, and competed visually with
 * "On Ovalball" when treated as a sibling pill. It is omitted from this compact identity row entirely.
 */
function ProfileIdentitySection({ marker, origin }: { marker: ClubMapMarker; origin: ClubMapMarker | null }) {
  const miles = origin && marker.hasLocation && !marker.isOwnClub ? distanceMiles(origin, marker) : null
  return (
    <View style={{ backgroundColor: colour.chalk, paddingTop: space.xs, paddingLeft: GUTTER + CREST_SIZE + 16, paddingRight: GUTTER, paddingBottom: space.sm, gap: space.xs }}>
      {/* "On Ovalball" and "Partner" are the two named badges from the reference, each with its OWN
          distinct colour (green identity vs. red/pink relationship) rather than sharing one generic
          "positive" tone -- StatusPill's shared tones stay untouched for every other screen; these two
          are deliberately bespoke to this identity row. */}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", alignItems: "center" }}>
        {marker.networkState === "on_ovalball" && (
          <View style={{ backgroundColor: "rgba(50,166,101,0.18)", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
            <Text style={[type.smallMedium, { color: colour.forest950 }]}>On Ovalball</Text>
          </View>
        )}
        {marker.partnershipStatus === "active" && (
          <View style={{ backgroundColor: colour.dangerSurface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
            <Text style={[type.smallMedium, { color: colour.danger }]}>Partner</Text>
          </View>
        )}
        {marker.partnershipStatus === "pending_incoming" && <StatusPill label="Wants to partner" tone="caution" />}
        {marker.partnershipStatus === "pending_outgoing" && <StatusPill label="Request sent" tone="neutral" />}
        {marker.partnershipStatus === "unknown" && <StatusPill label="Relationship unknown" tone="neutral" />}
        {marker.networkState === "not_on_ovalball" && <StatusPill label="Not on Ovalball" tone="caution" />}
      </View>
      <Text numberOfLines={1} style={[type.small, { color: colour.inkMuted }]}>
        {[marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "" : "Location not yet known")}
        {miles !== null ? ` · ${Math.round(miles)} miles away` : ""}
      </Text>
    </View>
  )
}

/** "Sat 26 Sep 2026" -- rugby-friendly, never a raw ISO string. */
function longDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

/** "Mar 2024" -- a real recorded fixture date, never a guess. */
function monthYearLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View>
      <Text style={[type.title, { color: colour.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}

function SectionHeader({ label }: { label: string }) {
  return <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
}

function ProfileCard({ children }: { children: React.ReactNode }) {
  return <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...elevation.card }}>{children}</View>
}

/** THE BOTTOM ACTION BAR (mock-up reconciliation): a deliberate action area, not buttons loose in the
 * scrolling content -- a sibling of the ScrollView, so it stays put while the profile scrolls under it. */
function ProfileActionBar({ children, insetsBottom }: { children: React.ReactNode; insetsBottom: number }) {
  // FIXED DEFECT (owner correction, Section 14): the caller passes its conditional buttons wrapped in a
  // `<>...</>` fragment, which is ONE React element, not an array -- `[children].flat()` never actually
  // flattened it, so every button ended up sharing a SINGLE flex:1 wrapper and stacked vertically inside
  // it (a plain View's default flexDirection is "column"). `Children.toArray` recurses into fragments
  // properly, giving each button its OWN flex:1 sibling in this row.
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: GUTTER,
        paddingTop: 10,
        paddingBottom: insetsBottom > 0 ? insetsBottom : 10,
        backgroundColor: colour.surface,
        borderTopWidth: 1,
        borderTopColor: colour.line,
      }}
    >
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={{ flex: 1 }}>
          {child}
        </View>
      ))}
    </View>
  )
}

// FOUR FLAT TABS (visual-lock Job 2, Section 11) -- "Fixtures" is deliberately not one of them; the
// all-time/this-season history stat it used to show now lives inside Partnership (Section 14), since
// fixture history together is itself a fact about the two clubs' relationship, not a separate concern.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "teams", label: "Teams" },
  { key: "availability", label: "Availability" },
  { key: "partnership", label: "Partnership" },
] as const
type TabKey = (typeof TABS)[number]["key"]

export interface FindFixtureProfileContext {
  date: string
  teamLabels: string[]
  availability: CandidateAvailabilityBatchRow[]
  weekRows: GameWeekCommitmentRow[]
  /** The viewer's own originally-selected team ids, from FF-1's own criteria -- travels through
   * untouched so Request Fixtures can hand the composer a real starting team, never a guess. */
  teamIds: string[]
  venuePreference: FindFixtureVenuePreference
  /** THIS candidate's own opposition-team list, exactly as FF-3 already computed it -- the answer to
   * "which of this specific club's teams are compatible with the search," never re-derived from the
   * viewer's currently active app context, which is a different, narrower question. */
  compatibleTeams: CompatibleTeam[]
}

/**
 * ON-OVALBALL BODY: Overview / Teams / Availability / Fixtures / Partnership, a tab never renders when
 * its content would be empty -- Teams is hidden with no active sides on file, Availability is hidden
 * unless this profile was opened from an FF-3 result card (never fabricated otherwise), Fixtures is
 * hidden for the viewer's own club (a club has no fixture history against itself) and for any
 * opposition club with no shared history yet, Partnership is hidden for the viewer's own club and for
 * any club where nothing partnership-shaped is true yet.
 *
 * TEAMS IS THE CLUB'S OWN REAL ROSTER (`readClubTeams`, `teams_select` RLS: any signed-in viewer may
 * read any club's ACTIVE teams -- age grade, rugby code, category, never a player), not the narrower
 * `compatible_opponent_teams` list `ClubDetail.compatibleTeams` carries. AVAILABILITY reuses that same
 * narrower list (the teams FF-3 itself found compatible) joined against the exact rows FF-2 already
 * computed -- never a second availability calculation.
 */
function OnOvalballBody({
  marker,
  detail,
  clubTeams,
  hasTeams,
  hasHistory,
  hasPartnershipContent,
  findFixtureContext,
  isOtherClub,
  busy,
  feedback,
  successMessage,
  onAct,
  viewerTeams,
  existingRequests,
  requestingTeamId,
  onRequestFixtures,
  onOpenRequestFixtures,
  onRequestPartnership,
}: {
  marker: ClubMapMarker
  detail: ClubDetail | null
  clubTeams: ClubTeam[] | null
  hasTeams: boolean
  hasHistory: boolean
  hasPartnershipContent: boolean
  findFixtureContext: FindFixtureProfileContext | null
  isOtherClub: boolean
  busy: boolean
  feedback: string | null
  successMessage: string | null
  onAct: (run: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void
  viewerTeams: ClubTeam[] | null
  existingRequests: { incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] } | null
  requestingTeamId: string | null
  onRequestFixtures: (myTeamId: string, opponentTeamId: string) => void
  onOpenRequestFixtures: () => void
  onRequestPartnership: () => void
}) {
  const [tab, setTab] = useState<TabKey>(() => (findFixtureContext ? "availability" : "overview"))
  const visibleTabs = TABS.filter(
    (t) =>
      t.key === "overview" ||
      (t.key === "teams" && hasTeams) ||
      (t.key === "availability" && isOtherClub) ||
      (t.key === "partnership" && (hasPartnershipContent || hasHistory))
  )

  if (!detail) {
    return (
      <View style={{ padding: space.lg, gap: space.md }}>
        <CardSkeleton lines={3} />
      </View>
    )
  }

  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: space.sm, gap: space.sm }}>
      {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}
      {successMessage && <Text style={[type.caption, { color: colour.forest800 }]}>{successMessage}</Text>}

      {/* A FLAT, FULL-WIDTH TAB ROW (owner correction, Section 11): no surrounding capsule, no
          selected-tab pill -- four equal segments, a bright green underline on the selected one, and a
          single subtle divider beneath the whole row. Content starts immediately after it. */}
      {visibleTabs.length > 1 && (
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colour.line }}>
          {visibleTabs.map((t) => {
            const on = tab === t.key
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(t.key)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 14,
                  alignItems: "center",
                  borderBottomWidth: 2,
                  borderBottomColor: on ? colour.pitch600 : "transparent",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text numberOfLines={1} style={[type.smallMedium, { color: on ? colour.forest900 : colour.inkMuted }]}>
                  {t.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {/* OVERVIEW, FLATTENED (visual-lock Job 2, Section 12-13): "About" heading, plain bio text on
          white, plus a bordered "Visit Website" row -- no floating cards. Club Details (rugby
          code/location) already lives in the identity section above the tabs; Network Relationship's
          own content already lives in Partnership, so neither is repeated here a second time. */}
      {tab === "overview" && (
        <View style={{ gap: space.sm }}>
          {detail.bio && (
            <>
              <SectionHeader label="About" />
              <Text style={[type.small, { color: colour.ink }]}>{detail.bio}</Text>
            </>
          )}
          {detail.website && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open club website"
              onPress={() => void Linking.openURL(detail.website as string)}
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong }}
            >
              <Globe size={16} color={colour.pitch600} />
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.pitch600, flex: 1 }]}>
                Visit Website
              </Text>
              <ChevronRight size={16} color={colour.inkSubtle} />
            </Pressable>
          )}
        </View>
      )}

      {/* TEAMS, FLAT (owner correction, Section 12): a heading and dense divided rows, never a second
          huge rounded card -- the flat tab row above it already draws the section's own boundary. */}
      {tab === "teams" && hasTeams && (
        <View style={{ gap: space.xs }}>
          <SectionHeader label="Teams" />
          {clubTeams && sortTeamsInRugbyAgeOrder(clubTeams).map((t) => <TeamRow key={t.id} team={t} />)}
        </View>
      )}

      {/* AVAILABILITY, OPERATIONAL (owner correction, Section F-J): the Monday-Sunday game week named
          up front, one card per real compatible pairing (our team vs their team), a truthful week
          status -- never "Available", only ever "No known clash" -- an existing pending request shown
          instead of a second Request action where one is already outstanding, and the same canonical
          Request Fixtures CTA the bottom bar offers, also reachable from inside this tab's own content. */}
      {tab === "availability" && (
        <View style={{ gap: space.sm }}>
          <SectionHeader label="Availability" />
          {!findFixtureContext && (
            <Text style={[type.small, { color: colour.inkMuted }]}>Choose dates in Find a Fixture to check this club's known availability.</Text>
          )}
          {findFixtureContext && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                Game week: {longDateLabel(gameWeekRange(findFixtureContext.date).start)} – {longDateLabel(gameWeekRange(findFixtureContext.date).end)}
              </Text>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                {findFixtureContext.compatibleTeams.length} compatible {findFixtureContext.compatibleTeams.length === 1 ? "team" : "teams"}
              </Text>
              <View style={{ gap: space.sm, marginTop: space.xs }}>
                {findFixtureContext.compatibleTeams.map((opponentTeam) => {
                  const ourTeam = pairViewerTeam(opponentTeam, viewerTeams)
                  const existing = ourTeam ? existingRequestFor(ourTeam.id, marker.name, existingRequests) : null
                  const label = candidateTeamWeekLabel(opponentTeam.teamId, findFixtureContext, marker.partnershipStatus)
                  const positive = label.primary === "No known clash"
                  const neutral = label.primary === "Availability unknown"
                  return (
                    <View key={opponentTeam.teamId} style={{ borderWidth: 1, borderColor: colour.line, borderRadius: radius.md, padding: space.md, gap: space.xs }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                          {ourTeam ? ourTeam.displayName : "Your team"}
                        </Text>
                        <Text style={[type.caption, { color: colour.inkSubtle }]}>vs</Text>
                        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1, textAlign: "right" }]}>
                          {opponentTeam.displayName}
                        </Text>
                      </View>
                      <Text style={[type.caption, { color: colour.inkSubtle }]}>{longDateLabel(findFixtureContext.date)}</Text>
                      {existing ? (
                        <StatusPill label={existing.direction === "incoming" ? "Request received" : "Request pending"} tone="caution" />
                      ) : (
                        <>
                          <StatusPill label={label.primary === "Busy this week" ? "Fixture booked this week" : label.primary} tone={positive ? "positive" : neutral ? "neutral" : "caution"} />
                          {label.detail && <Text style={[type.caption, { color: colour.inkSubtle }]}>{longDateLabel(label.detail)}</Text>}
                        </>
                      )}
                      {!existing && ourTeam && detail.actions.canFindFixture && (
                        <Button
                          variant="secondary"
                          label="Request Fixture"
                          busy={requestingTeamId === ourTeam.id}
                          onPress={() => onRequestFixtures(ourTeam.id, opponentTeam.teamId)}
                        />
                      )}
                    </View>
                  )
                })}
                {findFixtureContext.compatibleTeams.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No compatible teams to check availability for.</Text>}
              </View>
              {detail.actions.canFindFixture && <Button label="Request Fixtures" style={{ backgroundColor: colour.pitch600, borderColor: colour.pitch600 }} onPress={onOpenRequestFixtures} />}
            </>
          )}
        </View>
      )}

      {/* PARTNERSHIP, CONSOLIDATED (visual-lock Job 2, Section 14): every canonical relationship state
          -- Partner / Pending outgoing / Pending incoming / Not yet partnered -- plus, when the two
          clubs have a real shared fixture history, that history too (moved here from the old separate
          "Fixtures" tab, which this profile no longer has). */}
      {/* PARTNERSHIP, OPERATIONAL (owner correction, Section D/E): every canonical relationship state
          genuinely acted on here, not just described -- Request Partnership for `none`, and an explicit
          `unknown` state that never collapses into `none` and never offers a CTA it cannot honour. */}
      {tab === "partnership" && (hasPartnershipContent || hasHistory) && (
        <ProfileCard>
          <SectionHeader label="Partnership" />
          {marker.partnershipStatus === "pending_outgoing" && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>Waiting for {marker.name} to respond.</Text>
              {detail.actions.canCancelOutgoingPartnerRequest && marker.partnershipId && (
                <Button
                  variant="quiet"
                  label="Withdraw Request"
                  busy={busy}
                  onPress={() => onAct(async () => ({ ...(await revokePartnership(supabase, marker.partnershipId as string)), message: "Partnership request withdrawn." }))}
                />
              )}
            </>
          )}
          {marker.partnershipStatus === "pending_incoming" && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>{marker.name} would like to partner with your club.</Text>
              {detail.actions.canRespondPartnerRequest && marker.partnershipId && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="secondary"
                      label="Decline"
                      busy={busy}
                      onPress={() => onAct(async () => ({ ...(await respondToPartnership(supabase, marker.partnershipId as string, false)), message: undefined }))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Accept Partnership"
                      busy={busy}
                      onPress={() => onAct(async () => ({ ...(await respondToPartnership(supabase, marker.partnershipId as string, true)), message: `You are now partnered with ${marker.name}.` }))}
                    />
                  </View>
                </View>
              )}
            </>
          )}
          {marker.partnershipStatus === "active" && (
            <>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Partner Club</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>Your clubs are connected on the Ovalball Rugby Network.</Text>
              {detail.actions.canRevokePartnership && marker.partnershipId && (
                <Button variant="quiet" label="End Partnership" busy={busy} onPress={() => onAct(async () => ({ ...(await revokePartnership(supabase, marker.partnershipId as string)), message: undefined }))} />
              )}
            </>
          )}
          {marker.partnershipStatus === "none" && (
            <>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Not partnered yet</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>Partner clubs can quickly find each other and coordinate future fixtures.</Text>
              {detail.actions.canPartner && <Button label="Request Partnership" busy={busy} onPress={onRequestPartnership} />}
            </>
          )}
          {/* UNKNOWN IS NEVER SHOWN AS NONE (Section D, critical): no CTA is offered here, because this
              viewer's own authority context cannot even confirm what the real relationship is. */}
          {marker.partnershipStatus === "unknown" && <Text style={[type.small, { color: colour.inkMuted }]}>Partnership status unavailable.</Text>}
          {hasHistory && (
            <View style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line, gap: space.xs }}>
              <SectionHeader label="Fixture History" />
              <View style={{ flexDirection: "row", gap: space.xl }}>
                {detail.fixturesTogetherThisSeason !== null && (
                  <Stat value={detail.fixturesTogetherThisSeason} label={detail.fixturesTogetherThisSeason === 1 ? "fixture this season" : "fixtures this season"} />
                )}
                {detail.fixturesTogetherAllTime !== null && detail.fixturesTogetherAllTime !== detail.fixturesTogetherThisSeason && (
                  <Stat value={detail.fixturesTogetherAllTime} label={detail.fixturesTogetherAllTime === 1 ? "fixture all time" : "fixtures all time"} />
                )}
              </View>
              {detail.firstMetDate && <Text style={[type.caption, { color: colour.inkSubtle }]}>First met {monthYearLabel(detail.firstMetDate)}</Text>}
            </View>
          )}
        </ProfileCard>
      )}
    </View>
  )
}

/** "Under 12 Boys · Rugby Union" -- a real team row, never a bare pill hiding the roster behind a count. */
/** "Senior Men"/"Senior Women"/"Age Grade" -- Find a Fixture's own category vocabulary (visual-lock Job
 * 2, Section 13), never a redundant "Union"/"League" repeated on every row of a club whose entire
 * roster plays one code (Union/League isolation already means it always does). */
function teamCategoryVocabulary(team: Pick<ClubTeam, "category" | "gender">): string {
  if (team.category === "senior") return team.gender === "womens" ? "Senior Women" : team.gender === "mens" ? "Senior Men" : "Senior"
  if (team.category === "colts") return "Colts"
  return "Age Grade"
}

function TeamRow({ team }: { team: ClubTeam }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colour.line }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{team.ageGroup ?? (team.gender === "womens" ? "W" : team.gender === "mens" ? "M" : "•")}</Text>
      </View>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
        {team.fullLabel}
      </Text>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>{teamCategoryVocabulary(team)}</Text>
    </View>
  )
}

/**
 * DIRECTORY-ONLY BODY: deliberately a different presentation, not a greyed-out copy of the one above --
 * "Not on Ovalball yet" said plainly, only what is actually known (crest/location/website, when the
 * directory itself carries them), an Invite panel, and a SEPARATE Claim This Club action so inviting
 * someone else there is never confused with claiming it yourself.
 */
function DirectoryOnlyBody({ marker, detail, viewerClubId }: { marker: ClubMapMarker; detail: ClubDetail | null; viewerClubId: string | null }) {
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [claimForm, setClaimForm] = useState<{ role: ClaimableRole; declaration: string } | null>(null)
  const [claimSubmitting, setClaimSubmitting] = useState(false)
  const [claimSubmitted, setClaimSubmitted] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  return (
    <View style={{ padding: space.lg, gap: space.lg }}>
      {/* THE INVITE PANEL (mock-up reconciliation): a tinted card, not a neutral pill-and-paragraph --
          `mint100` is the existing informational surface this brand already uses (`invite-club-dialog`
          on web), never an invented blue outside the design system. The plain-language caveat about
          what the directory knows moves in here too, so the whole "not on Ovalball yet" story is one
          card rather than two saying overlapping things. */}
      <View style={{ backgroundColor: colour.mint100, borderRadius: radius.lg, padding: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.6)", alignItems: "center", justifyContent: "center" }}>
            <Users size={16} color={colour.forest800} />
          </View>
          <Text style={[type.smallMedium, { color: colour.forest800, flex: 1 }]}>This club isn&apos;t on Ovalball yet</Text>
        </View>
        <Text style={[type.small, { color: colour.forest800 }]}>
          Invite them to join and help grow the rugby community. What you see here is what the Club Directory already knows -- nothing else is guessed or invented.
        </Text>
      </View>

      {detail?.actions.canInviteToOvalball && (
        <ProfileCard>
          <SectionHeader label="Invite This Club" />
          <Text style={[type.small, { color: colour.inkMuted }]}>
            An invitation lets someone at {marker.name} create their own Ovalball account -- it does not give you or anyone else ownership of the club.
          </Text>
          {!inviteLink && (
            <>
              {invite === null ? (
                <Button variant="secondary" label="Invite to Ovalball" onPress={() => setInvite({ name: "", email: "" })} />
              ) : (
                <View style={{ gap: space.sm }}>
                  <TextInput
                    accessibilityLabel="Contact name"
                    value={invite.name}
                    onChangeText={(name) => setInvite({ ...invite, name })}
                    placeholder="Contact name at this club"
                    placeholderTextColor={colour.inkSubtle}
                    style={sheetInputStyle}
                  />
                  <TextInput
                    accessibilityLabel="Contact email"
                    value={invite.email}
                    onChangeText={(email) => setInvite({ ...invite, email })}
                    placeholder="Contact email"
                    placeholderTextColor={colour.inkSubtle}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={sheetInputStyle}
                  />
                  {inviteError && <Text style={[type.caption, { color: colour.warning }]}>{inviteError}</Text>}
                  <Button
                    label="Send Invitation"
                    busy={inviteBusy}
                    disabled={!invite.name.trim() || !invite.email.trim()}
                    onPress={async () => {
                      if (!viewerClubId) {
                        setInviteError("You don't have fixture authority at a club.")
                        return
                      }
                      setInviteBusy(true)
                      setInviteError(null)
                      const result = await inviteClubToOvalball(supabase, webUrl, viewerClubId, marker.directoryId, invite.name.trim(), invite.email.trim())
                      setInviteBusy(false)
                      if (!result.ok) {
                        setInviteError(result.error)
                        return
                      }
                      setInviteLink(result.inviteLink)
                    }}
                  />
                </View>
              )}
            </>
          )}
          {inviteLink && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Invitation sent. Share the link yourself too, if useful:</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share invitation link"
                onPress={() => void Share.share({ message: inviteLink })}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, minHeight: TOUCH_TARGET, borderRadius: radius.md, backgroundColor: colour.forest800 }}
              >
                <Share2 size={16} color={colour.onForest} />
                <Text style={[type.smallMedium, { color: colour.onForest }]}>Share Invitation</Text>
              </Pressable>
            </View>
          )}
        </ProfileCard>
      )}

      <ProfileCard>
        <SectionHeader label="Claim This Club" />
        {!claimSubmitted ? (
          <>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Claiming is different from inviting -- it is how YOU get authority to manage {marker.name} on Ovalball. A Site Admin reviews every claim by hand before it takes effect.
            </Text>
            {claimForm === null ? (
              <Button variant="secondary" label="Claim This Club" onPress={() => setClaimForm({ role: "Committee Member", declaration: "" })} />
            ) : (
              <View style={{ gap: space.sm }}>
                <Field label="Your Role at This Club">
                  <ChoiceField label="Your role at this club" value={claimForm.role} onChange={(role) => setClaimForm({ ...claimForm, role })} options={CLAIMABLE_ROLES.map((r) => ({ value: r, label: r }))} />
                </Field>
                <Field label={`Why You Can Act for ${marker.name}`}>
                  <TextField
                    label="Why can you act for this club"
                    value={claimForm.declaration}
                    onChange={(declaration) => setClaimForm({ ...claimForm, declaration })}
                    placeholder="e.g. I was elected Club Secretary at the AGM and I'm the point of contact for fixtures."
                    multiline
                  />
                </Field>
                {claimError && <Text style={[type.caption, { color: colour.warning }]}>{claimError}</Text>}
                <Button
                  label="Submit Claim"
                  busy={claimSubmitting}
                  disabled={claimForm.declaration.trim().length < 20}
                  onPress={async () => {
                    setClaimSubmitting(true)
                    setClaimError(null)
                    const result = await submitClubClaim(supabase, marker.directoryId, claimForm.role, claimForm.declaration)
                    setClaimSubmitting(false)
                    if (!result.ok) {
                      setClaimError(result.error)
                      return
                    }
                    setClaimSubmitted(true)
                  }}
                />
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Claim sent</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              A Site Admin reviews every claim by hand -- this is not an automatic sign-up. Ovalball will contact you once it has been reviewed.
            </Text>
          </>
        )}
      </ProfileCard>

      {detail?.website && (
        <ProfileCard>
          <SectionHeader label="Website" />
          <Pressable accessibilityRole="link" accessibilityLabel="Open club website" onPress={() => void Linking.openURL(detail.website as string)} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Globe size={15} color={colour.pitch600} />
            <Text style={[type.small, { color: colour.pitch600 }]} numberOfLines={1}>
              {detail.website}
            </Text>
          </Pressable>
        </ProfileCard>
      )}

      <ProfileCard>
        <SectionHeader label="Club Details" />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <MapPin size={16} color={colour.inkSubtle} style={{ marginTop: 2 }} />
          <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>
            {marker.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}
            {"\n"}
            {[marker.town, marker.county].filter(Boolean).join(", ") || "Location not yet known"}
          </Text>
        </View>
      </ProfileCard>
    </View>
  )
}

const sheetInputStyle = {
  minHeight: TOUCH_TARGET,
  paddingHorizontal: space.md,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colour.lineStrong,
  backgroundColor: colour.surface,
  color: colour.ink,
}
