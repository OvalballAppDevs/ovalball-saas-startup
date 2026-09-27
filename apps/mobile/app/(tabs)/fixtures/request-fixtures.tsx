import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { buildSentRequestSummary, type RequestFixturePairing } from "@ovalball/contracts/clubhouse"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { createFixtureRequestBatch } from "../../../src/agenda/mutations"
import { ChoiceField } from "../../../src/components/form"
import { Button } from "../../../src/components/ui"
import { ClubCrest } from "../../../src/clubhouse/components"
import { ChevronRight } from "../../../src/components/icons"
import { colour, elevation, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"

/**
 * REQUEST FIXTURES -- THE DEDICATED MULTI-TEAM COMPOSER (owner correction pass, Sections 2/3/K).
 *
 * ROOT CAUSE THIS SCREEN FIXES: the Public Club Profile's own "Request Fixtures" CTA used to hand off
 * to the general single-opponent `/fixtures/new` screen with exactly one `teamId`/`targetTeamId` pair --
 * that screen was built for "pick one opponent, then one of our own sides," never "here are several
 * already-known compatible pairings, send some or all of them." Every pairing but the first one was
 * silently discarded at that handoff, not lost anywhere upstream (the Availability tab itself already
 * showed every real pairing correctly).
 *
 * This screen receives the FULL, already-computed pairing list (`buildRequestFixturePairings` in the
 * profile screen -- the SAME array the Availability tab itself renders, never a second calculation) and
 * lets the viewer select any subset of the genuinely available ones. `createFixtureRequest` is called
 * once per SELECTED pairing -- still the existing, unmodified, single-team canonical insert path
 * (Section 8); this screen only adds the ability to confirm several of them as one composed action, it
 * never invents a new persistence model.
 *
 * A pairing that is not genuinely "clear" (busy this week, a request already pending) is shown, never
 * hidden, but cannot be selected -- with the real reason stated plainly, matching the same rule the
 * Availability tab itself already applies.
 */
type VenueChoice = "Home" | "Away" | "Either"

export default function RequestFixturesComposer() {
  const router = useRouter()
  const { active } = useAppContexts()
  const viewerClubId = active?.clubId ?? null

  const params = useLocalSearchParams<{
    opponentDirectoryId?: string
    opponentClubId?: string
    clubName: string
    clubTown?: string
    clubCounty?: string
    clubLogoUrl?: string
    milesAway?: string
    partnershipStatus?: string
    date: string
    venuePreference?: "home" | "away" | "either"
    pairings?: string
  }>()

  const pairings: RequestFixturePairing[] = useMemo(() => {
    try {
      return params.pairings ? (JSON.parse(params.pairings) as RequestFixturePairing[]) : []
    } catch {
      return []
    }
  }, [params.pairings])

  const defaultVenue: VenueChoice = params.venuePreference === "home" ? "Home" : params.venuePreference === "away" ? "Away" : "Either"

  // CLEAR PAIRINGS ARE PRE-SELECTED (a real starting point, never an empty form for a search that
  // already found real matches), everything else starts unselected because it cannot be selected at all.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pairings.filter((p) => p.status === "clear").map((p) => p.myTeamId)))
  const [venueByTeam, setVenueByTeam] = useState<Record<string, VenueChoice>>(() => Object.fromEntries(pairings.map((p) => [p.myTeamId, defaultVenue])))
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(teamId: string, disabled: boolean) {
    if (disabled) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  /** ONE createFixtureRequestBatch CALL (owner correction, Section 1 audit finding): the web composer's
   * own established createFixtureRequest server action already creates ONE fixture_request_groups row
   * plus one fixture_requests row per team in a single multi-row insert -- the real canonical batch
   * mechanism this module previously reinvented as N separate single-team calls (N separate groups).
   * Mirrors that exact shape instead. The requests insert is one Postgres statement, so it is either
   * every selected team or none -- there is no genuine partial-success outcome to reconcile. */
  async function send() {
    if (!viewerClubId || selected.size === 0 || sending) return
    setSending(true)
    setError(null)
    const selectedPairings = pairings.filter((p) => selected.has(p.myTeamId))
    const result = await createFixtureRequestBatch(supabase, {
      requestingClubId: viewerClubId,
      opponentClubId: params.opponentClubId || null,
      opponentDirectoryId: params.opponentDirectoryId || null,
      rawOpponentText: params.clubName,
      proposedDate: params.date,
      note: message.trim() || null,
      teams: selectedPairings.map((p) => ({
        requestingTeamId: p.myTeamId,
        targetTeamId: p.opponentTeamId,
        venuePreference: (venueByTeam[p.myTeamId] ?? defaultVenue) === "Home" ? "home" : (venueByTeam[p.myTeamId] ?? defaultVenue) === "Away" ? "away" : "either",
        preferredKickoffTime: null,
      })),
    })
    setSending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    // THE REQUEST SENT SCREEN IS DRIVEN BY THE SERVER'S OWN RETURNED ROWS (Section 2/19-10), never by
    // the client's own selection state -- `buildSentRequestSummary` (contracts, permanently tested)
    // matches `result.requests` -- exactly which teams the insert actually created -- back to their own
    // pairing's display labels; a pairing the server did not confirm is never included regardless of
    // what the composer showed beforehand. `venue` is zipped in afterwards by team id: it is not
    // something the server echoes back, but it is exactly what THIS same request was submitted with, so
    // carrying it forward here is not "reconstructing from optimistic state" in the sense Section 2 warns
    // against -- it never overrides what the server actually created, only labels it.
    const summary = buildSentRequestSummary(selectedPairings, result.requests)
    const sentItems = summary.map((s) => ({ ...s, venue: venueByTeam[s.myTeamId] ?? defaultVenue }))
    router.replace({
      pathname: "/fixtures/request-sent",
      params: {
        clubName: params.clubName,
        clubTown: params.clubTown ?? "",
        clubCounty: params.clubCounty ?? "",
        clubLogoUrl: params.clubLogoUrl ?? "",
        date: params.date,
        items: JSON.stringify(sentItems),
      },
    } as never)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <RequestFixturesHeader onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Selected Club</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.md, ...elevation.card }}>
            <ClubCrest url={params.clubLogoUrl || null} size={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                {params.clubName}
              </Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                {[params.clubTown, params.clubCounty].filter(Boolean).join(", ")}
                {params.milesAway ? ` · ${params.milesAway} miles away` : ""}
              </Text>
            </View>
            {params.partnershipStatus === "active" && (
              <View style={{ backgroundColor: colour.dangerSurface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
                <Text style={[type.smallMedium, { color: colour.danger }]}>Partner</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>
            Your Request ({selected.size} {selected.size === 1 ? "team" : "teams"})
          </Text>
          <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, ...elevation.card }}>
            {pairings.map((p, i) => {
              const disabled = p.status !== "clear"
              const on = selected.has(p.myTeamId)
              return (
                <View key={p.myTeamId} style={{ padding: space.md, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled }}
                    disabled={disabled}
                    onPress={() => toggle(p.myTeamId, disabled)}
                    style={{ flexDirection: "row", alignItems: "center", gap: space.sm, opacity: disabled ? 0.55 : 1 }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: on ? colour.forest800 : colour.lineStrong,
                        backgroundColor: on ? colour.forest800 : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {on && <Text style={{ color: colour.onForest, fontSize: 14, fontWeight: "700" }}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{p.myTeamLabel}</Text>
                      <Text style={[type.caption, { color: colour.inkSubtle }]}>{p.myTeamCategory}</Text>
                    </View>
                  </Pressable>
                  {disabled ? (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>
                      {p.status === "busy" ? (p.detail ?? "Fixture booked this week") : p.status === "pending" ? (p.detail ?? "Request already pending") : "Availability unknown"}
                    </Text>
                  ) : (
                    <ChoiceField
                      label={`${p.myTeamLabel} venue preference`}
                      value={venueByTeam[p.myTeamId] ?? defaultVenue}
                      onChange={(v) => setVenueByTeam((prev) => ({ ...prev, [p.myTeamId]: v }))}
                      options={[
                        { value: "Home", label: "Home" },
                        { value: "Away", label: "Away" },
                        { value: "Either", label: "Either" },
                      ]}
                    />
                  )}
                </View>
              )
            })}
            {pairings.length === 0 && <Text style={[type.small, { color: colour.inkMuted, padding: space.md }]}>No compatible teams to request.</Text>}
          </View>
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Message to {params.clubName} (optional)</Text>
          <TextInput
            accessibilityLabel="Message about your fixture requirements"
            value={message}
            onChangeText={setMessage}
            placeholder="Add a message about your fixture requirements…"
            placeholderTextColor={colour.inkSubtle}
            multiline
            style={{ minHeight: 72, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlignVertical: "top" }}
          />
        </View>

        {error && <Text style={[type.caption, { color: colour.warning }]}>{error}</Text>}

        <Button label="Send Fixture Request" busy={sending} disabled={selected.size === 0} onPress={() => void send()} style={{ backgroundColor: colour.pitch600, borderColor: colour.pitch600 }} />
      </ScrollView>
    </View>
  )
}

function RequestFixturesHeader({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", backgroundColor: colour.forest950 }}>
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
      <Text numberOfLines={1} accessibilityRole="header" style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>
        Request Fixtures
      </Text>
    </View>
  )
}
