import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  acceptFixtureOpportunityResponse,
  cancelFixtureOpportunity,
  declineFixtureOpportunityResponse,
  distanceMiles,
  findDistanceOrigin,
  publishFixtureOpportunity,
  readClubhouseMarkers,
  readFixtureOpportunities,
  readFixtureOpportunityResponses,
  resolveClubLocation,
  respondToFixtureOpportunity,
  withdrawFixtureOpportunityResponse,
  type ClubMapMarker,
  type FixtureOpportunity,
  type FixtureOpportunityResponseRow,
} from "@ovalball/contracts/clubhouse"
import { fullTeamLabel } from "@ovalball/contracts/teams/compact-label"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { Button, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { ChoiceField, DateField, Field, TextField, TimeField } from "../../../src/components/form"
import { ChevronRight, Search } from "../../../src/components/icons"
import { ClubhouseEmptyState } from "../../../src/clubhouse/components"
import { colour, radius, space, TOUCH_TARGET, type } from "../../../src/design/tokens"

const GAME_TYPE_OPTIONS = ["Friendly", "League Fixture", "Cup Fixture", "Scheduled Match"] as const

/**
 * CLUBHOUSE PROGRAMME SECTIONS 15/16 -- LOOKING FOR OPPOSITION / OPPORTUNITY MATCHING, mobile.
 *
 * Same shared contracts as web (packages/contracts/src/clubhouse/opportunities.ts) -- one domain, two
 * presentations. Distance is computed here from the same markers population + resolveClubLocation/
 * distanceMiles the ordinary Clubhouse map already uses; partnership state is read directly off the
 * marker (already resolved by readClubhouseMarkers) -- never a second calculation.
 */
export default function LookingForOpposition() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ highlight?: string; tab?: string }>()
  const { active } = useAppContexts()

  const contextTeamId = active?.kind === "team" ? active.id : null
  const clubContext = active?.kind === "club" ? active.clubId : null

  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)
  const [chosenTeamId, setChosenTeamId] = useState<string | null>(null)
  const teamId = contextTeamId ?? chosenTeamId

  const [opportunities, setOpportunities] = useState<FixtureOpportunity[] | null>(null)
  const [markers, setMarkers] = useState<ClubMapMarker[]>([])
  // "Post an Opportunity" (Find a Fixture's own secondary link) hands off with tab=mine, since
  // publishing a listing is what My Listings is for -- "Browse Opportunities" hands off with no
  // param at all and lands on the default Discover tab. Never a third, separate publish screen.
  const [tab, setTab] = useState<"discover" | "mine">(params.tab === "mine" ? "mine" : "discover")
  const [publishOpen, setPublishOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clubContext) return
    void readClubTeams(supabase, clubContext).then((d) => {
      setClubTeams(d.teams)
      if (d.teams.length === 1) setChosenTeamId(d.teams[0]!.id)
    })
  }, [clubContext])

  const load = useCallback(async () => {
    if (!teamId) return
    const myClubId = clubContext ?? markers.find((m) => m.isOwnClub)?.clubId ?? null
    const [opps, mks] = await Promise.all([readFixtureOpportunities(supabase, teamId), readClubhouseMarkers(supabase, myClubId, teamId)])
    setOpportunities(opps)
    setMarkers(mks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, clubContext])

  useEffect(() => {
    setOpportunities(null)
    void load()
  }, [load])

  const origin = findDistanceOrigin(markers)
  const discoverList = (opportunities ?? []).filter((o) => !o.isMine)
  const mineList = (opportunities ?? []).filter((o) => o.isMine)
  const chosenTeam = clubTeams?.find((t) => t.id === chosenTeamId) ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Looking for Opposition
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }} showsVerticalScrollIndicator={false}>
        {!teamId && clubTeams === null && <CardSkeleton lines={2} />}

        {!teamId && clubTeams !== null && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Which team is looking for opposition?</Text>
            {clubTeams.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                onPress={() => setChosenTeamId(t.id)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.surface : "transparent" })}
              >
                <Text style={[type.smallMedium, { color: colour.ink }]}>{t.fullLabel}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {teamId && (
          <>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Discover" variant={tab === "discover" ? "primary" : "secondary"} onPress={() => setTab("discover")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={`My Listings${mineList.length > 0 ? ` (${mineList.length})` : ""}`} variant={tab === "mine" ? "primary" : "secondary"} onPress={() => setTab("mine")} />
              </View>
            </View>

            <Button label="Publish a Listing" onPress={() => setPublishOpen(true)} />

            {error && <ErrorState message={error} onRetry={() => setError(null)} />}

            {publishOpen && (
              <PublishForm
                teamId={teamId}
                teamLabel={chosenTeam ? chosenTeam.fullLabel : "your team"}
                onClose={() => setPublishOpen(false)}
                onPublished={async () => {
                  setPublishOpen(false)
                  await load()
                  setTab("mine")
                }}
                onError={setError}
              />
            )}

            {opportunities === null && <CardSkeleton lines={3} />}

            {opportunities !== null && tab === "discover" && (
              <View style={{ gap: space.md }}>
                {/* No action button here -- "Publish a Listing" is already the persistent button just
                    above the tabs, so a second one inside the empty state would be a duplicate CTA. */}
                {discoverList.length === 0 && (
                  <ClubhouseEmptyState
                    icon={<Search size={22} color={colour.forest800} strokeWidth={2} />}
                    title="Nothing to discover yet"
                    body="No compatible club is currently looking for opposition on a date your team could play. Check back, or publish your own listing."
                  />
                )}
                {discoverList.map((o) => (
                  <DiscoverCard
                    key={o.id}
                    opportunity={o}
                    origin={origin}
                    markers={markers}
                    teamId={teamId}
                    highlighted={o.id === params.highlight}
                    onChanged={load}
                    onError={setError}
                  />
                ))}
              </View>
            )}

            {opportunities !== null && tab === "mine" && (
              <View style={{ gap: space.md }}>
                {mineList.length === 0 && (
                  <ClubhouseEmptyState
                    icon={<Search size={22} color={colour.forest800} strokeWidth={2} />}
                    title="No listings yet"
                    body="Publish a date your team is free and any compatible club can respond."
                  />
                )}
                {mineList.map((o) => (
                  <MineCard key={o.id} opportunity={o} highlighted={o.id === params.highlight} onChanged={load} onError={setError} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function statusLabel(status: FixtureOpportunity["myResponseStatus"]): string {
  switch (status) {
    case "pending":
      return "Response sent — waiting to hear back"
    case "accepted":
      return "Accepted"
    case "declined":
      return "Declined"
    case "withdrawn":
      return "Withdrawn"
    case "superseded":
      return "No longer available — filled elsewhere"
    default:
      return ""
  }
}

function opportunityStatusLabel(o: FixtureOpportunity): "open" | "expired" {
  return new Date(o.proposedDate) < new Date(new Date().toDateString()) ? "expired" : "open"
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

function DiscoverCard({
  opportunity,
  origin,
  markers,
  teamId,
  highlighted,
  onChanged,
  onError,
}: {
  opportunity: FixtureOpportunity
  origin: ClubMapMarker | null
  markers: ClubMapMarker[]
  teamId: string
  highlighted: boolean
  onChanged: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [respondOpen, setRespondOpen] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const location = resolveClubLocation(
    { latitude: opportunity.publishingClubDirectoryLatitude, longitude: opportunity.publishingClubDirectoryLongitude, geocodeSuccess: opportunity.publishingClubDirectoryGeocodeStatus === "success" },
    null
  )
  const miles = origin ? distanceMiles(origin, { latitude: location.latitude, longitude: location.longitude }) : null
  const marker = markers.find((m) => m.clubId === opportunity.publishingClubId)
  const isPartner = marker?.partnershipStatus === "active"

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: highlighted ? 2 : 1, borderColor: highlighted ? colour.pitch600 : colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
            {opportunity.publishingClubName}
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {fullTeamLabel({
              category: opportunity.publishingTeamCategory,
              ageGroup: opportunity.publishingTeamAgeGroup,
              gender: opportunity.publishingTeamGender,
              squadDesignation: opportunity.publishingTeamSquadDesignation,
              rugbyCode: opportunity.publishingTeamRugbyCode,
              alias: null,
            })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, justifyContent: "flex-end" }}>
          {miles !== null && (
            <Text style={[type.caption, { color: colour.inkMuted, backgroundColor: colour.chalk, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }]}>{Math.round(miles)} mi</Text>
          )}
          {isPartner && (
            <Text style={[type.caption, { color: colour.forest800, backgroundColor: colour.mint100, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }]}>Partner</Text>
          )}
        </View>
      </View>

      <Text style={[type.small, { color: colour.ink }]}>
        {shortDate(opportunity.proposedDate)}
        {opportunity.kickoffTime ? ` · ${opportunity.kickoffTime.slice(0, 5)}` : ""}
        {" · Looking for: "}
        {opportunity.venuePreference === "home" ? "away fixture" : opportunity.venuePreference === "away" ? "home fixture" : "home or away"}
        {opportunity.gameType ? ` · ${opportunity.gameType}` : ""}
      </Text>
      {opportunity.myTeamAvailability === "busy" && <Text style={[type.caption, { color: colour.warning }]}>You have a clash that day</Text>}
      {opportunity.myTeamAvailability === "no_known_clash" && <Text style={[type.caption, { color: colour.inkSubtle }]}>No known clash</Text>}
      {!!opportunity.note && <Text style={[type.caption, { color: colour.inkMuted }]}>“{opportunity.note}”</Text>}

      {opportunity.myResponseStatus ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{statusLabel(opportunity.myResponseStatus)}</Text>
          {opportunity.myResponseStatus === "pending" && opportunity.myResponseId && (
            <Button
              label="Withdraw"
              variant="quiet"
              busy={busy}
              onPress={async () => {
                setBusy(true)
                onError(null)
                try {
                  await withdrawFixtureOpportunityResponse(supabase, opportunity.myResponseId as string)
                  await onChanged()
                } catch (caught) {
                  onError(caught instanceof Error ? caught.message : "Could not withdraw this response.")
                } finally {
                  setBusy(false)
                }
              }}
            />
          )}
        </View>
      ) : respondOpen ? (
        <View style={{ gap: space.sm }}>
          <TextField label="Note" value={note} onChange={setNote} placeholder="Optional note" />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Send Response"
                busy={busy}
                onPress={async () => {
                  setBusy(true)
                  onError(null)
                  try {
                    await respondToFixtureOpportunity(supabase, opportunity.id, teamId, note || null)
                    setRespondOpen(false)
                    await onChanged()
                  } catch (caught) {
                    onError(caught instanceof Error ? caught.message : "Could not send this response.")
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={() => setRespondOpen(false)} />
            </View>
          </View>
        </View>
      ) : (
        <Button label="Respond" onPress={() => setRespondOpen(true)} />
      )}
    </View>
  )
}

function MineCard({
  opportunity,
  highlighted,
  onChanged,
  onError,
}: {
  opportunity: FixtureOpportunity
  highlighted: boolean
  onChanged: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [responsesOpen, setResponsesOpen] = useState(false)
  const [responses, setResponses] = useState<FixtureOpportunityResponseRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const status = opportunityStatusLabel(opportunity)

  async function toggleResponses() {
    const next = !responsesOpen
    setResponsesOpen(next)
    if (next && responses === null) {
      try {
        setResponses(await readFixtureOpportunityResponses(supabase, opportunity.id))
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : "Could not load responses.")
      }
    }
  }

  async function decide(responseId: string, decision: "accept" | "decline") {
    setBusy(true)
    onError(null)
    try {
      if (decision === "accept") {
        const result = await acceptFixtureOpportunityResponse(supabase, responseId, opportunity.updatedAt)
        if (!result.ok) {
          onError(result.isDuplicateRequest ? `${result.message} You already have an open request for this date with them.` : result.message)
          return
        }
      } else {
        await declineFixtureOpportunityResponse(supabase, responseId)
      }
      setResponses(null)
      setResponsesOpen(false)
      await onChanged()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not decide this response.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: highlighted ? 2 : 1, borderColor: highlighted ? colour.pitch600 : colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View>
          <Text style={[type.small, { color: colour.ink }]}>
            {shortDate(opportunity.proposedDate)}
            {opportunity.kickoffTime ? ` · ${opportunity.kickoffTime.slice(0, 5)}` : ""}
          </Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {opportunity.venuePreference === "home" ? "Looking for an away fixture" : opportunity.venuePreference === "away" ? "Looking for a home fixture" : "Home or away"}
            {opportunity.gameType ? ` · ${opportunity.gameType}` : ""}
          </Text>
        </View>
        <Text
          style={[
            type.caption,
            {
              color: status === "open" ? colour.forest800 : colour.inkMuted,
              backgroundColor: status === "open" ? colour.mint100 : colour.chalk,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
            },
          ]}
        >
          {opportunity.myResponseId ? "" : status === "open" ? "Open" : "Expired"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={responsesOpen ? "Hide Responses" : "Review Responses"} variant="secondary" onPress={toggleResponses} />
        </View>
        {status === "open" && (
          <View style={{ flex: 1 }}>
            <Button
              label="Cancel Listing"
              variant="quiet"
              busy={busy}
              onPress={async () => {
                setBusy(true)
                onError(null)
                try {
                  await cancelFixtureOpportunity(supabase, opportunity.id, opportunity.updatedAt)
                  await onChanged()
                } catch (caught) {
                  onError(caught instanceof Error ? caught.message : "Could not cancel this listing.")
                } finally {
                  setBusy(false)
                }
              }}
            />
          </View>
        )}
      </View>

      {responsesOpen && (
        <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm }}>
          {responses === null && <Text style={[type.caption, { color: colour.inkMuted }]}>Loading…</Text>}
          {responses?.length === 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>No responses yet.</Text>}
          {responses?.map((r) => (
            <View key={r.id} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, padding: space.sm, gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>
                {r.respondingClubName ?? "A club"} ·{" "}
                {fullTeamLabel({
                  category: r.respondingTeamCategory,
                  ageGroup: r.respondingTeamAgeGroup,
                  gender: r.respondingTeamGender,
                  squadDesignation: r.respondingTeamSquadDesignation,
                  rugbyCode: r.respondingTeamRugbyCode,
                  alias: null,
                })}
              </Text>
              {!!r.note && <Text style={[type.caption, { color: colour.inkMuted }]}>“{r.note}”</Text>}
              {r.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Accept" busy={busy} onPress={() => decide(r.id, "accept")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Decline" variant="secondary" busy={busy} onPress={() => decide(r.id, "decline")} />
                  </View>
                </View>
              ) : (
                <Text style={[type.caption, { color: colour.inkMuted }]}>{statusLabel(r.status)}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function PublishForm({
  teamId,
  teamLabel,
  onClose,
  onPublished,
  onError,
}: {
  teamId: string
  teamLabel: string
  onClose: () => void
  onPublished: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [kickoff, setKickoff] = useState<string | null>(null)
  const [venue, setVenue] = useState<"Home" | "Away" | "TBD">("TBD")
  const [gameType, setGameType] = useState<(typeof GAME_TYPE_OPTIONS)[number] | "">("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <View style={{ gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>Publish a listing for {teamLabel}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>Visible to any compatible club across the Ovalball network, not just partners.</Text>

      <Field label="Date">
        <DateField label="Date" value={date} onChange={setDate} />
      </Field>
      <Field label="Kick-Off" hint="Leave it clear if the time is not agreed yet.">
        <TimeField label="Kick-off time" value={kickoff} onChange={setKickoff} />
      </Field>
      <Field label="Venue">
        <ChoiceField
          label="Venue"
          value={venue}
          onChange={setVenue}
          options={[
            { value: "Home", label: "Looking for away" },
            { value: "Away", label: "Looking for home" },
            { value: "TBD", label: "Either" },
          ]}
        />
      </Field>
      <Field label="Fixture Type" hint="Optional.">
        <ChoiceField
          label="Fixture type"
          value={gameType || "Friendly"}
          onChange={(v) => setGameType(v as (typeof GAME_TYPE_OPTIONS)[number])}
          options={GAME_TYPE_OPTIONS.map((g) => ({ value: g, label: g }))}
        />
      </Field>
      <Field label="Note" hint="Optional.">
        <TextField label="Note" value={note} onChange={setNote} placeholder="Anything a compatible club should know." />
      </Field>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Publish Listing"
            busy={busy}
            onPress={async () => {
              setBusy(true)
              onError(null)
              try {
                await publishFixtureOpportunity(supabase, {
                  teamId,
                  date,
                  kickoffTime: kickoff,
                  venuePreference: venue === "Home" ? "home" : venue === "Away" ? "away" : "either",
                  gameType: gameType || null,
                  note: note || null,
                })
                await onPublished()
              } catch (caught) {
                onError(caught instanceof Error ? caught.message : "Could not publish this listing.")
              } finally {
                setBusy(false)
              }
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </View>
  )
}
