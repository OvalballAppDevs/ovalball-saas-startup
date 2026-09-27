import { useEffect, useMemo, useState } from "react"
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  distanceMiles,
  findDistanceOrigin,
  findFixtureWeekLabel,
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
  type FindFixtureVenuePreference,
  type GameWeekCommitmentRow,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, sortTeamsInRugbyAgeOrder, summariseClubAgeGroups, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { startClubConversation } from "../../../../src/messages/club-conversations"
import { CLAIMABLE_ROLES, submitClubClaim, type ClaimableRole } from "../../../../src/clubhouse/claims"
import { ChoiceField, Field, TextField } from "../../../../src/components/form"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { CalendarDays, ChevronRight, Globe, MapPin, Share2, Users } from "../../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"
import { webUrl } from "../../../../src/config/environment"
import { ClubCrest, ClubMetricRow } from "../../../../src/clubhouse/components"

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
  const { directoryId, ffDate, ffTeamLabels, ffAvailability, ffWeekRows, ffTeamIds, ffVenuePreference } = useLocalSearchParams<{
    directoryId: string
    ffDate?: string
    ffTeamLabels?: string
    ffAvailability?: string
    ffWeekRows?: string
    ffTeamIds?: string
    ffVenuePreference?: FindFixtureVenuePreference
  }>()

  // FIND A FIXTURE SEARCH CONTEXT (Section B4, extended for the Request Fixtures handoff): present only
  // when this profile was opened from an FF-3 result card -- never fabricated when the club was reached
  // any other way (Clubhouse map, a fixture, a search). Reuses the EXACT rows FF-2 already computed;
  // nothing here re-derives availability. `teamIds`/`venuePreference` travel through untouched from FF-1's
  // own criteria so Request Fixtures can hand them to the composer -- never re-derived or guessed here.
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
      }
    } catch {
      return null
    }
  }, [ffDate, ffTeamLabels, ffAvailability, ffWeekRows, ffTeamIds, ffVenuePreference])
  const { userId } = useSession()
  const { active } = useAppContexts()
  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClubDetail | null>(null)
  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)

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

  const isOtherClub = !!marker && marker.clubId !== null && !marker.isOwnClub
  const hasTeams = !!clubTeams && clubTeams.length > 0
  const hasHistory = isOtherClub && !!detail && (detail.fixturesTogetherThisSeason !== null || detail.fixturesTogetherAllTime !== null || !!detail.firstMetDate)
  const hasPartnershipContent =
    isOtherClub && !!detail && !!marker && (detail.actions.canPartner || detail.actions.canCancelOutgoingPartnerRequest || detail.actions.canRespondPartnerRequest || detail.actions.canRevokePartnership || marker.partnershipStatus !== "none")

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setFeedback(null)
    const result = await run()
    if (!result.ok) setFeedback(result.error ?? "That didn't work. Try again.")
    else loadDetail()
    setBusy(false)
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
          <ProfileCoverHero marker={marker} />
          <ProfileIdentitySection marker={marker} origin={origin} />
          <DirectoryOnlyBody marker={marker} detail={detail} viewerClubId={viewerClubId} />
        </ScrollView>
      )}

      {marker && marker.networkState === "on_ovalball" && (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
            <ProfileCoverHero marker={marker} coverUrl={detail?.coverUrl} />
            <ProfileIdentitySection marker={marker} origin={origin} />
            {(() => {
              const metrics = buildHeroMetrics({ clubTeams, detail, findFixtureContext, marker })
              return metrics.length > 0 ? (
                <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
                  <ClubMetricRow metrics={metrics} />
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
              messageDraft={messageDraft}
              sendingMessage={sendingMessage}
              onSetMessageDraft={setMessageDraft}
              onSendMessage={async () => {
                if (!viewerClubId || !marker.clubId || messageDraft === null) return
                setSendingMessage(true)
                setFeedback(null)
                const result = await startClubConversation(supabase, viewerClubId, marker.clubId, messageDraft.trim())
                setSendingMessage(false)
                if (!result.ok || !result.conversationId) {
                  setFeedback(result.error ?? "That didn't work. Try again.")
                  return
                }
                router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "club", id: result.conversationId } } as never)
              }}
              onAct={act}
            />
          </ScrollView>
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
                            targetTeamId: detail.compatibleTeams?.[0]?.teamId ?? "",
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

function buildHeroMetrics({
  clubTeams,
  detail,
  findFixtureContext,
  marker,
}: {
  clubTeams: ClubTeam[] | null
  detail: ClubDetail | null
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
  if (findFixtureContext && detail) {
    const compatible = detail.compatibleTeams ?? []
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
function ProfileCoverHero({ marker, coverUrl }: { marker: ClubMapMarker; coverUrl?: string | null }) {
  return (
    // NOT overflow:hidden at this level (fixed defect: the crest was being clipped to only its top
    // half). Only the cover PHOTO itself needs clipping for its rounded top corners -- the crest is a
    // SIBLING positioned below it, free to overlap into the white section beneath without being cut by
    // the photo's own clip boundary.
    <View style={{ position: "relative" }}>
      <View style={{ height: 240, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest900 }}>
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
        <View style={{ position: "absolute", left: space.lg + CREST_SIZE + space.md, right: space.lg, bottom: space.md }}>
          {/* Bold Inter, never the condensed display face -- that face's own glyphs read as all-caps,
              which the reference's club name never does. A club's real name is a proper noun, not a
              section heading, so it keeps its ordinary mixed-case form here. */}
          <Text numberOfLines={2} accessibilityRole="header" style={{ fontFamily: type.title.fontFamily, fontSize: 22, lineHeight: 26, color: colour.onForest }}>
            {marker.name}
          </Text>
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          left: space.lg,
          bottom: -CREST_OVERLAP,
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
 * THE IDENTITY SECTION (visual-lock Job 2, Section 7): on plain white, directly below the cover -- the
 * two badges the reference shows, `[On Ovalball] [Partner]`, only when each is canonically true, plus
 * whichever real pending/unknown partnership state genuinely applies (never invented for the reference,
 * but never silently dropped either -- a club with a pending or unknown relationship still gets a
 * truthful pill here, matching the same rule FF-3's own result cards keep). Then "Town, County · N miles
 * away" on the same white background. `paddingTop` clears the crest's own overlap into this section, so
 * the crest floats above this text rather than colliding with it.
 */
function ProfileIdentitySection({ marker, origin }: { marker: ClubMapMarker; origin: ClubMapMarker | null }) {
  const miles = origin && marker.hasLocation && !marker.isOwnClub ? distanceMiles(origin, marker) : null
  return (
    <View style={{ backgroundColor: colour.chalk, paddingTop: CREST_OVERLAP + space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.xs }}>
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
        {marker.locationPrecision === "postcode" && <StatusPill label="Approximate location" tone="neutral" />}
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
  return (
    <View
      style={{
        flexDirection: "row",
        gap: space.sm,
        padding: space.md,
        paddingBottom: insetsBottom > 0 ? insetsBottom : space.md,
        backgroundColor: colour.surface,
        borderTopWidth: 1,
        borderTopColor: colour.line,
      }}
    >
      {[children].flat().map((child, i) => (
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
  messageDraft,
  sendingMessage,
  onSetMessageDraft,
  onSendMessage,
  onAct,
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
  messageDraft: string | null
  sendingMessage: boolean
  onSetMessageDraft: (updater: (d: string | null) => string | null) => void
  onSendMessage: () => void
  onAct: (run: () => Promise<{ ok: boolean; error?: string }>) => void
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
    <View style={{ padding: space.lg, gap: space.lg }}>
      {messageDraft !== null && (
        <ProfileCard>
          <SectionHeader label="Message This Club" />
          <TextInput
            accessibilityLabel="First message"
            value={messageDraft}
            onChangeText={(v) => onSetMessageDraft(() => v)}
            placeholder="Write your message…"
            placeholderTextColor={colour.inkSubtle}
            multiline
            style={{ minHeight: 88, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk, color: colour.ink, textAlignVertical: "top" }}
          />
          <Button label="Send" busy={sendingMessage} disabled={!messageDraft.trim()} onPress={onSendMessage} />
        </ProfileCard>
      )}

      {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}

      {/* A FULL-WIDTH SEGMENTED CONTROL, not a left-aligned underline row: each tab claims an equal
          share of the page width, the active segment gets a solid forest pill rather than a thin
          underline, and every segment reports real press feedback -- a more deliberate, interactive
          treatment than a quiet text-only row. */}
      {visibleTabs.length > 1 && (
        <View style={{ flexDirection: "row", backgroundColor: colour.chalk, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, padding: 4, gap: 4 }}>
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
                  minHeight: 38,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.sm,
                  backgroundColor: on ? colour.forest800 : "transparent",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text numberOfLines={1} style={[type.smallMedium, { color: on ? colour.onForest : colour.inkMuted }]}>
                  {t.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {/* OVERVIEW, FLATTENED (visual-lock Job 2, Section 12): plain About text on white, plus a bordered
          "Visit Website" row -- no floating cards. Club Details (rugby code/location) already lives in
          the identity section above the tabs; Network Relationship's own content already lives in
          Partnership, so neither is repeated here a second time. */}
      {tab === "overview" && (
        <View style={{ gap: space.md }}>
          {detail.bio && <Text style={[type.small, { color: colour.ink }]}>{detail.bio}</Text>}
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

      {tab === "teams" && hasTeams && (
        <ProfileCard>
          <SectionHeader label="Teams" />
          <View style={{ gap: space.xs }}>
            {clubTeams && sortTeamsInRugbyAgeOrder(clubTeams).map((t) => <TeamRow key={t.id} team={t} />)}
          </View>
        </ProfileCard>
      )}

      {tab === "availability" && (
        <ProfileCard>
          <SectionHeader label="Availability" />
          {!findFixtureContext && (
            <Text style={[type.small, { color: colour.inkMuted }]}>Choose dates in Find a Fixture to check this club's known availability.</Text>
          )}
          {findFixtureContext && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                Your search: {findFixtureContext.teamLabels.length > 0 ? findFixtureContext.teamLabels.join(", ") : "your selected teams"} on {longDateLabel(findFixtureContext.date)}.
              </Text>
              <View style={{ gap: space.sm }}>
                {(detail?.compatibleTeams ?? []).map((t) => {
                  const label = candidateTeamWeekLabel(t.teamId, findFixtureContext, marker.partnershipStatus)
                  return (
                    <View key={t.teamId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                      <Text numberOfLines={1} style={[type.small, { color: colour.ink, flex: 1 }]}>
                        {t.displayName}
                      </Text>
                      <View style={{ alignItems: "flex-end" }}>
                        <StatusPill label={label.primary} tone={label.primary === "No known clash" ? "positive" : label.primary === "Availability unknown" ? "neutral" : "caution"} />
                        {label.detail && <Text style={[type.caption, { color: colour.inkSubtle, marginTop: 2 }]}>{longDateLabel(label.detail)}</Text>}
                      </View>
                    </View>
                  )
                })}
                {(detail?.compatibleTeams ?? []).length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No compatible teams to check availability for.</Text>}
              </View>
            </>
          )}
        </ProfileCard>
      )}

      {/* PARTNERSHIP, CONSOLIDATED (visual-lock Job 2, Section 14): every canonical relationship state
          -- Partner / Pending outgoing / Pending incoming / Not yet partnered -- plus, when the two
          clubs have a real shared fixture history, that history too (moved here from the old separate
          "Fixtures" tab, which this profile no longer has). */}
      {tab === "partnership" && (hasPartnershipContent || hasHistory) && (
        <ProfileCard>
          <SectionHeader label="Partnership" />
          {marker.partnershipStatus === "pending_outgoing" && (
            <>
              <StatusPill label="Request sent" tone="neutral" />
              {detail.actions.canCancelOutgoingPartnerRequest && marker.partnershipId && (
                <Button variant="quiet" label="Cancel Partner Request" busy={busy} onPress={() => onAct(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
            </>
          )}
          {marker.partnershipStatus === "pending_incoming" && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>{marker.name} wants to partner with your club.</Text>
              {detail.actions.canRespondPartnerRequest && marker.partnershipId && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="secondary" label="Decline" busy={busy} onPress={() => onAct(() => respondToPartnership(supabase, marker.partnershipId as string, false))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Accept" busy={busy} onPress={() => onAct(() => respondToPartnership(supabase, marker.partnershipId as string, true))} />
                  </View>
                </View>
              )}
            </>
          )}
          {marker.partnershipStatus === "active" && (
            <>
              <StatusPill label="Partner" tone="positive" />
              {detail.actions.canRevokePartnership && marker.partnershipId && (
                <Button variant="quiet" label="End Partnership" busy={busy} onPress={() => onAct(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
            </>
          )}
          {marker.partnershipStatus === "none" && (
            <Text style={[type.small, { color: colour.inkMuted }]}>Partnering shares calendars and opens direct messaging between the two clubs -- use Make Partnership below.</Text>
          )}
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
