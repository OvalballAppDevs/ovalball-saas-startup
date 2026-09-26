import { useEffect, useMemo, useState } from "react"
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  distanceMiles,
  findDistanceOrigin,
  inviteClubToOvalball,
  readClubDetail,
  readClubhouseMarkers,
  requestPartnership,
  respondToPartnership,
  revokePartnership,
  type ClubDetail,
  type ClubMapMarker,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { startClubConversation } from "../../../../src/messages/club-conversations"
import { CLAIMABLE_ROLES, submitClubClaim, type ClaimableRole } from "../../../../src/clubhouse/claims"
import { ChoiceField, Field, TextField } from "../../../../src/components/form"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { ChevronRight, Globe, Share2 } from "../../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"
import { webUrl } from "../../../../src/config/environment"
import { ClubCrest, NetworkPill } from "../../../../src/clubhouse/components"

/**
 * THE RICH CLUB PROFILE (Section 8 of the visual blueprint), plus the DIRECTORY-ONLY presentation for a
 * club that has not joined Ovalball -- one route, one `directoryId`, converging exactly the way Match
 * Centre converges on one `fixture_id`: the server-derived `ClubDetail`/`ClubMapMarker` decide which body
 * renders, never a second implementation copied for "the unclaimed case."
 *
 * REACHED FROM the map/list sheet's own simplified "View Club" button (`ClubSheet` in `../map.tsx`, which
 * used to carry every one of these actions itself, stacked eight deep) -- this screen is where Message
 * Club, Make Partnership, Invite to Ovalball and Claim This Club now live instead, each still calling the
 * exact same shared contracts the sheet always called (`requestPartnership`, `startClubConversation`,
 * `inviteClubToOvalball`, `submitClubClaim`) -- never a second write path.
 *
 * NO SINGLE-CLUB READ EXISTS YET, deliberately not added here: `readClubhouseMarkers` already fetches the
 * whole ~1,400-row directory client-side (the same trade-off the map screen already makes, at the same
 * real scale), so a fresh navigation (a deep link, a notification, a cold app-open on this route) reuses
 * that one canonical read rather than a new migration/RPC for a single row -- exactly the instruction
 * for this pass ("do not add a migration/RPC unless a visible flow literally cannot function without one").
 */
export default function ClubProfile() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { directoryId } = useLocalSearchParams<{ directoryId: string }>()
  const { userId } = useSession()
  const { active } = useAppContexts()
  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClubDetail | null>(null)

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

  useEffect(() => {
    setDetail(null)
    if (!marker) return
    let live = true
    void readClubDetail(supabase, marker, viewerClubId, viewerTeamId).then((d) => {
      if (live) setDetail(d)
    })
    return () => {
      live = false
    }
  }, [marker, viewerClubId, viewerTeamId])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <ProfileBackHeader title={marker?.name ?? "Club"} onBack={() => router.back()} insets={insets} />

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

      {marker && (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }} showsVerticalScrollIndicator={false}>
          <ProfileHero marker={marker} origin={origin} />
          {marker.networkState === "not_on_ovalball" ? (
            <DirectoryOnlyBody marker={marker} detail={detail} viewerClubId={viewerClubId} />
          ) : (
            <OnOvalballBody marker={marker} detail={detail} viewerClubId={viewerClubId} userId={userId} onChanged={() => void readClubDetail(supabase, marker, viewerClubId, viewerTeamId).then(setDetail)} />
          )}
        </ScrollView>
      )}
    </View>
  )
}

function ProfileBackHeader({ title, onBack, insets }: { title: string; onBack: () => void; insets: { top: number } }) {
  return (
    <View
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        backgroundColor: colour.chalk,
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
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <Text numberOfLines={1} accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
        {title}
      </Text>
    </View>
  )
}

/**
 * CREST-FORWARD, NEVER INVENTED PHOTOGRAPHY (Section 8). No per-club photo exists for ~1,400 directory
 * rows, so the hero is the same forest-gradient identity treatment `ClubhouseHero` already uses on
 * Clubhouse Home -- a real ground, not a stock image standing in for a club Ovalball has never
 * photographed -- with the club's own crest as the one piece of real imagery.
 */
function ProfileHero({ marker, origin }: { marker: ClubMapMarker; origin: ClubMapMarker | null }) {
  const miles = origin && marker.hasLocation && !marker.isOwnClub ? distanceMiles(origin, marker) : null
  return (
    <View style={{ backgroundColor: colour.forest900, paddingTop: space.lg, paddingBottom: space.lg, paddingHorizontal: space.lg, overflow: "hidden" }}>
      <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="clubProfileHeroShade" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.15" />
            <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.55" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#clubProfileHeroShade)" />
      </Svg>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={marker.logoUrl} size={72} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[type.display, { color: colour.onForest, fontSize: 22, lineHeight: 26 }]}>
            {marker.name}
          </Text>
          <Text style={[type.small, { color: colour.onForestMuted, marginTop: 2 }]}>{marker.rugbyCode === "union" ? "Rugby Union" : "Rugby League"}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={[type.small, { color: colour.onForestMuted, marginTop: space.md }]}>
        {[marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "" : "Location not yet known")}
        {miles !== null ? ` · ${Math.round(miles)} mi away` : ""}
      </Text>
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", marginTop: space.sm }}>
        <NetworkPill marker={marker} />
        {marker.partnershipStatus === "pending_incoming" && <StatusPill label="Wants to partner" tone="caution" />}
        {marker.partnershipStatus === "pending_outgoing" && <StatusPill label="Request sent" tone="neutral" />}
        {marker.locationPrecision === "postcode" && <StatusPill label="Approximate location" tone="neutral" />}
      </View>
    </View>
  )
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

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "teams", label: "Teams" },
  { key: "history", label: "Fixtures" },
  { key: "partnership", label: "Partnership" },
] as const
type TabKey = (typeof TABS)[number]["key"]

/**
 * ON-OVALBALL BODY: Overview / Teams / Fixtures / Partnership (owner correction pass), a tab never
 * renders when its content would be empty -- Teams is hidden with no active sides on file, Fixtures is
 * hidden for the viewer's own club (a club has no fixture history against itself -- see the
 * `readClubDetail` fix this same pass made) and for any opposition club with no shared history yet,
 * Partnership is hidden for the viewer's own club and for any club where nothing partnership-shaped is
 * true yet.
 *
 * TEAMS IS THE CLUB'S OWN REAL ROSTER (`readClubTeams`, `teams_select` RLS: any signed-in viewer may
 * read any club's ACTIVE teams -- age grade, rugby code, category, never a player), not the narrower
 * `compatible_opponent_teams` list `ClubDetail.compatibleTeams` carries -- that RPC needs a team
 * context and answers "which of MY teams could play THEM", a different, narrower question than "what
 * sides does this club run", and it also returns nothing at all for a club-context viewer or for the
 * viewer's own club. Never a second implementation of Find a Fixture's own compatibility check --
 * this tab reads the same canonical `teams` table, just unfiltered by any opponent.
 */
function OnOvalballBody({
  marker,
  detail,
  viewerClubId,
  userId,
  onChanged,
}: {
  marker: ClubMapMarker
  detail: ClubDetail | null
  viewerClubId: string | null
  userId: string | null
  onChanged: () => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("overview")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)

  useEffect(() => {
    setClubTeams(null)
    if (!marker.clubId) return
    let live = true
    void readClubTeams(supabase, marker.clubId).then((d) => {
      if (live) setClubTeams(d.teams.filter((t) => t.active))
    })
    return () => {
      live = false
    }
  }, [marker.clubId])

  const isOtherClub = marker.clubId !== null && !marker.isOwnClub
  const hasHistory = isOtherClub && !!detail && (detail.fixturesTogetherThisSeason !== null || detail.fixturesTogetherAllTime !== null || !!detail.firstMetDate)
  const hasTeams = !!clubTeams && clubTeams.length > 0
  const hasPartnershipContent = isOtherClub && !!detail && (detail.actions.canPartner || detail.actions.canCancelOutgoingPartnerRequest || detail.actions.canRespondPartnerRequest || detail.actions.canRevokePartnership || marker.partnershipStatus !== "none")
  const visibleTabs = TABS.filter(
    (t) => t.key === "overview" || (t.key === "teams" && hasTeams) || (t.key === "history" && hasHistory) || (t.key === "partnership" && hasPartnershipContent)
  )

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setFeedback(null)
    const result = await run()
    if (!result.ok) setFeedback(result.error ?? "That didn't work. Try again.")
    else onChanged()
    setBusy(false)
  }

  if (!detail) {
    return (
      <View style={{ padding: space.lg, gap: space.md }}>
        <CardSkeleton lines={3} />
      </View>
    )
  }

  return (
    <View style={{ padding: space.lg, gap: space.lg }}>
      {(detail.actions.canFindFixture || detail.actions.canMessage) && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {detail.actions.canFindFixture && (
            <View style={{ flex: 1 }}>
              <Button
                label="Find a Fixture"
                onPress={() => router.push({ pathname: "/clubhouse/find-fixture", params: { opponentDirectoryId: marker.directoryId, opponentClubId: marker.clubId ?? "" } } as never)}
              />
            </View>
          )}
          {detail.actions.canMessage && (
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Message Club" onPress={() => setMessageDraft((d) => (d === null ? "" : d))} />
            </View>
          )}
        </View>
      )}

      {messageDraft !== null && (
        <ProfileCard>
          <SectionHeader label="Message This Club" />
          <TextInput
            accessibilityLabel="First message"
            value={messageDraft}
            onChangeText={setMessageDraft}
            placeholder="Write your message…"
            placeholderTextColor={colour.inkSubtle}
            multiline
            style={{ minHeight: 88, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk, color: colour.ink, textAlignVertical: "top" }}
          />
          <Button
            label="Send"
            busy={sendingMessage}
            disabled={!messageDraft.trim()}
            onPress={async () => {
              if (!viewerClubId || !marker.clubId) {
                setFeedback("You don't have fixture authority at a club.")
                return
              }
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
          />
        </ProfileCard>
      )}

      {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}

      {visibleTabs.length > 1 && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {visibleTabs.map((t) => {
            const on = tab === t.key
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(t.key)}
                style={{ paddingHorizontal: space.md, minHeight: 34, borderRadius: radius.pill, justifyContent: "center", backgroundColor: on ? colour.forest800 : colour.surface, borderWidth: on ? 0 : 1, borderColor: colour.lineStrong }}
              >
                <Text style={[type.caption, { color: on ? colour.onForest : colour.ink }]}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {tab === "overview" && (
        <View style={{ gap: space.lg }}>
          {detail.website && (
            <ProfileCard>
              <SectionHeader label="About" />
              <Pressable accessibilityRole="link" accessibilityLabel="Open club website" onPress={() => void Linking.openURL(detail.website as string)} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Globe size={15} color={colour.pitch600} />
                <Text style={[type.small, { color: colour.pitch600 }]} numberOfLines={1}>
                  {detail.website}
                </Text>
              </Pressable>
            </ProfileCard>
          )}
          {/* A CLUB PROFILE IS NEVER JUST ONE HALF-EMPTY CARD (owner correction pass): even before any
              shared history exists, Overview still says something real -- the club's own team count
              (the same fact the Teams tab expands on) and, for an opposition club, the actual
              relationship in plain words rather than only the hero's own pill. */}
          {hasTeams && (
            <ProfileCard>
              <SectionHeader label="Teams" />
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {clubTeams?.length} active {clubTeams?.length === 1 ? "side" : "sides"}
                {isOtherClub ? " -- see the Teams tab for the full list." : "."}
              </Text>
            </ProfileCard>
          )}
          {isOtherClub && (
            <ProfileCard>
              <SectionHeader label="Network Relationship" />
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {marker.partnershipStatus === "active"
                  ? `${marker.name} is a partner club -- calendars are shared and direct messaging is open.`
                  : marker.partnershipStatus === "pending_incoming"
                    ? `${marker.name} wants to partner with your club.`
                    : marker.partnershipStatus === "pending_outgoing"
                      ? `A partnership request is waiting on ${marker.name}.`
                      : `${marker.name} is on Ovalball, with no partnership between your clubs yet.`}
              </Text>
            </ProfileCard>
          )}
          {!detail.website && !hasTeams && !isOtherClub && (
            <Text style={[type.small, { color: colour.inkMuted }]}>Nothing else recorded for this club yet.</Text>
          )}
        </View>
      )}

      {tab === "teams" && hasTeams && (
        <ProfileCard>
          <SectionHeader label="Teams" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {clubTeams?.map((team) => (
              <View key={team.id} style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk, justifyContent: "center" }}>
                <Text style={[type.caption, { color: colour.ink }]}>{team.fullLabel}</Text>
              </View>
            ))}
          </View>
        </ProfileCard>
      )}

      {tab === "history" && hasHistory && (
        <ProfileCard>
          <SectionHeader label="Our History" />
          <View style={{ flexDirection: "row", gap: space.xl }}>
            {detail.fixturesTogetherThisSeason !== null && (
              <Stat value={detail.fixturesTogetherThisSeason} label={detail.fixturesTogetherThisSeason === 1 ? "fixture this season" : "fixtures this season"} />
            )}
            {detail.fixturesTogetherAllTime !== null && detail.fixturesTogetherAllTime !== detail.fixturesTogetherThisSeason && (
              <Stat value={detail.fixturesTogetherAllTime} label={detail.fixturesTogetherAllTime === 1 ? "fixture all time" : "fixtures all time"} />
            )}
          </View>
          {detail.firstMetDate && <Text style={[type.caption, { color: colour.inkSubtle }]}>First met {monthYearLabel(detail.firstMetDate)}</Text>}
        </ProfileCard>
      )}

      {tab === "partnership" && hasPartnershipContent && (
        <ProfileCard>
          <SectionHeader label="Partnership" />
          {marker.partnershipStatus === "none" && detail.actions.canPartner && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>Partnering shares calendars and opens direct messaging between the two clubs.</Text>
              <Button
                label="Make Partnership"
                busy={busy}
                onPress={() =>
                  void act(async () => {
                    if (!viewerClubId || !userId || !marker.clubId) return { ok: false, error: "You don't have fixture authority at a club." }
                    return requestPartnership(supabase, viewerClubId, marker.clubId, userId)
                  })
                }
              />
            </>
          )}
          {marker.partnershipStatus === "pending_outgoing" && (
            <>
              <StatusPill label="Request sent" tone="neutral" />
              {detail.actions.canCancelOutgoingPartnerRequest && marker.partnershipId && (
                <Button variant="quiet" label="Cancel Partner Request" busy={busy} onPress={() => void act(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
            </>
          )}
          {marker.partnershipStatus === "pending_incoming" && (
            <>
              <Text style={[type.small, { color: colour.inkMuted }]}>{marker.name} wants to partner with your club.</Text>
              {detail.actions.canRespondPartnerRequest && marker.partnershipId && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="secondary" label="Decline" busy={busy} onPress={() => void act(() => respondToPartnership(supabase, marker.partnershipId as string, false))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Accept" busy={busy} onPress={() => void act(() => respondToPartnership(supabase, marker.partnershipId as string, true))} />
                  </View>
                </View>
              )}
            </>
          )}
          {marker.partnershipStatus === "active" && (
            <>
              <StatusPill label="Partner" tone="positive" />
              {detail.actions.canRevokePartnership && marker.partnershipId && (
                <Button variant="quiet" label="End Partnership" busy={busy} onPress={() => void act(() => revokePartnership(supabase, marker.partnershipId as string))} />
              )}
            </>
          )}
        </ProfileCard>
      )}
    </View>
  )
}

/**
 * DIRECTORY-ONLY BODY (Section 9): deliberately a different presentation, not a greyed-out copy of the
 * one above -- "Not on Ovalball yet" said plainly, only what is actually known (crest/location/website,
 * when the directory itself carries them), an Invite panel, and a SEPARATE Claim This Club action so
 * inviting someone else there is never confused with claiming it yourself.
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
      <ProfileCard>
        <StatusPill label="Not on Ovalball yet" tone="caution" />
        <Text style={[type.small, { color: colour.inkMuted }]}>
          This club has not joined Ovalball. What you see here is what the Club Directory already knows -- nothing else is guessed or invented.
        </Text>
        {detail?.website && (
          <Pressable accessibilityRole="link" accessibilityLabel="Open club website" onPress={() => void Linking.openURL(detail.website as string)} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Globe size={15} color={colour.pitch600} />
            <Text style={[type.small, { color: colour.pitch600 }]} numberOfLines={1}>
              {detail.website}
            </Text>
          </Pressable>
        )}
      </ProfileCard>

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
