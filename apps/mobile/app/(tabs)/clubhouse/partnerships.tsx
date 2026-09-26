import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readClubhouseMarkers, respondToPartnership, revokePartnership, type ClubMapMarker } from "@ovalball/contracts/clubhouse"
import { readClubTeamSummaries, type ClubTeamSummary } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { ClubCrest, ClubhouseEmptyState } from "../../../src/clubhouse/components"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../../../src/components/ui"
import { ChevronRight, HeartHandshake } from "../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"

/**
 * PARTNERSHIPS (Section 12 of the visual blueprint): the dedicated screen Clubhouse Home's own
 * "Partner Clubs" tile always meant to reach -- it used to hand off to the general map pre-filtered to
 * Partners, which is the map's own job (discovery), not this one (managing relationships that already
 * exist). No new read model: the exact same `readClubhouseMarkers` the map/Find a Fixture already call
 * carries every partner club's real status (`partnershipStatus`/`partnershipId`), bucketed into three
 * tabs here rather than a second partnership query.
 */
export default function Partnerships() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const viewerTeamId = active?.kind === "team" ? active.id : null

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"active" | "incoming" | "outgoing">("active")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await readClubhouseMarkers(supabase, viewerClubId, viewerTeamId)
      setMarkers(rows)
    } catch {
      setError("Couldn't load your partnerships. Check your connection and try again.")
    }
  }, [viewerClubId, viewerTeamId])

  useEffect(() => {
    setMarkers(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  // ONE BATCHED READ (mock-up reconciliation): the same `readClubTeamSummaries` the map/list already
  // use, never a per-row fetch -- a partnerships list is small by construction (every real relationship
  // the viewer's club has), but the pattern stays consistent regardless of scale.
  const [teamSummaryByClubId, setTeamSummaryByClubId] = useState<Map<string, ClubTeamSummary>>(new Map())
  useEffect(() => {
    const clubIds = Array.from(new Set((markers ?? []).map((m) => m.clubId).filter((id): id is string => !!id)))
    if (clubIds.length === 0) return
    let live = true
    void readClubTeamSummaries(supabase, clubIds).then((summaries) => {
      if (live) setTeamSummaryByClubId(summaries)
    })
    return () => {
      live = false
    }
  }, [markers])

  const active_ = useMemo(() => markers?.filter((m) => m.partnershipStatus === "active") ?? [], [markers])
  const incoming = useMemo(() => markers?.filter((m) => m.partnershipStatus === "pending_incoming") ?? [], [markers])
  const outgoing = useMemo(() => markers?.filter((m) => m.partnershipStatus === "pending_outgoing") ?? [], [markers])

  const shown = tab === "active" ? active_ : tab === "incoming" ? incoming : outgoing

  async function act(partnershipId: string, run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(partnershipId)
    setFeedback(null)
    const result = await run()
    if (!result.ok) setFeedback(result.error ?? "That didn't work. Try again.")
    else void load()
    setBusyId(null)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <PartnershipsHeader onBack={() => router.back()} insets={insets} />

      <View style={{ padding: space.lg, gap: space.lg, flex: 1 }}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <TabChip label="My Partners" count={active_.length} active={tab === "active"} onPress={() => setTab("active")} />
          <TabChip label="Received" count={incoming.length} active={tab === "incoming"} onPress={() => setTab("incoming")} />
          <TabChip label="Sent" count={outgoing.length} active={tab === "outgoing"} onPress={() => setTab("outgoing")} />
        </View>

        {error && <ErrorState message={error} onRetry={() => void load()} />}

        {!error && markers === null && (
          <View style={{ gap: space.md }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}

        {feedback && <Text style={[type.caption, { color: colour.warning }]}>{feedback}</Text>}

        {!error && markers !== null && shown.length === 0 && (
          <ClubhouseEmptyState
            icon={<HeartHandshake size={22} color={colour.forest800} strokeWidth={2} />}
            title={tab === "active" ? "Build your rugby network" : tab === "incoming" ? "No requests waiting" : "No requests sent"}
            body={
              tab === "active"
                ? "Partner clubs can compare schedules, arrange fixtures and keep club-to-club communication together."
                : tab === "incoming"
                  ? "A club that wants to partner with you will appear here."
                  : "A request you've sent that hasn't been answered yet will appear here."
            }
            action={tab === "active" ? { label: "Find Clubs", onPress: () => router.push("/clubhouse/map" as never) } : undefined}
          />
        )}

        {!error &&
          markers !== null &&
          shown.map((marker) => (
            <PartnerRow
              key={marker.directoryId}
              marker={marker}
              teamSummary={marker.clubId ? teamSummaryByClubId.get(marker.clubId) : undefined}
              busy={busyId === marker.partnershipId}
              onView={() => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: marker.directoryId } } as never)}
              onAccept={marker.partnershipId ? () => void act(marker.partnershipId as string, () => respondToPartnership(supabase, marker.partnershipId as string, true)) : undefined}
              onDecline={marker.partnershipId ? () => void act(marker.partnershipId as string, () => respondToPartnership(supabase, marker.partnershipId as string, false)) : undefined}
              onCancelOrEnd={marker.partnershipId ? () => void act(marker.partnershipId as string, () => revokePartnership(supabase, marker.partnershipId as string)) : undefined}
              cancelLabel={tab === "outgoing" ? "Cancel Request" : "End Partnership"}
            />
          ))}

        {/* Only alongside a real, already-populated list -- the empty "My Partners" state above carries
            its own "Find Clubs" action, so this never doubles up with it. */}
        {tab === "active" && shown.length > 0 && (
          <View style={{ marginTop: space.sm }}>
            <Button variant="secondary" label="Find More Clubs" onPress={() => router.push("/clubhouse/map" as never)} />
          </View>
        )}
      </View>
    </View>
  )
}

function TabChip({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${count > 0 ? `, ${count}` : ""}`}
      onPress={onPress}
      style={{ flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: active ? colour.forest800 : colour.surface, borderWidth: active ? 0 : 1, borderColor: colour.lineStrong }}
    >
      <Text style={[type.caption, { color: active ? colour.onForest : colour.ink, fontFamily: type.smallMedium.fontFamily }]}>
        {label}
        {count > 0 ? ` (${count})` : ""}
      </Text>
    </Pressable>
  )
}

function PartnerRow({
  marker,
  teamSummary,
  busy,
  onView,
  onAccept,
  onDecline,
  onCancelOrEnd,
  cancelLabel,
}: {
  marker: ClubMapMarker
  teamSummary?: ClubTeamSummary
  busy: boolean
  onView: () => void
  onAccept?: () => void
  onDecline?: () => void
  onCancelOrEnd?: () => void
  cancelLabel: string
}) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${marker.name}`} onPress={onView} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={marker.logoUrl} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
            {marker.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {[marker.town, marker.county].filter(Boolean).join(", ") || "Location unavailable"}
          </Text>
          {teamSummary && teamSummary.teamCount > 0 && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>
              {teamSummary.teamCount} {teamSummary.teamCount === 1 ? "team" : "teams"}
              {teamSummary.ageRangeLabel ? ` · ${teamSummary.ageRangeLabel}` : ""}
            </Text>
          )}
        </View>
        <ChevronRight size={18} color={colour.inkSubtle} />
      </Pressable>

      {marker.partnershipStatus === "active" && <StatusPill label="Partner" tone="positive" />}
      {marker.partnershipStatus === "pending_incoming" && <StatusPill label="Wants to partner" tone="caution" />}
      {marker.partnershipStatus === "pending_outgoing" && <StatusPill label="Request sent" tone="neutral" />}

      {onAccept && onDecline && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="Decline" busy={busy} onPress={onDecline} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Accept" busy={busy} onPress={onAccept} />
          </View>
        </View>
      )}

      {marker.partnershipStatus !== "pending_incoming" && onCancelOrEnd && <Button variant="quiet" label={cancelLabel} busy={busy} onPress={onCancelOrEnd} />}
    </View>
  )
}

function PartnershipsHeader({ onBack, insets }: { onBack: () => void; insets: { top: number } }) {
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Clubhouse"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
        Partnerships
      </Text>
    </View>
  )
}
