import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { ClubPitch } from "@ovalball/contracts/club/venues"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"
import { pitchConfigurationSummary } from "@ovalball/contracts/pitch-allocation"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { friendly, logDetail } from "../../errors/translate"
import { ChevronLeft, Check } from "../../components/icons"
import { CardSkeleton, ErrorState, EmptyState } from "../../components/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"
import { loadVenuesAndPitchesForClub } from "../data"
import { useTrainingPlanDraft } from "./draft-context"
import { coverPhotoSource } from "../../media/stock-assets"


/**
 * SELECT PITCH -- pitches at the DRAFT'S OWN SELECTED VENUE ONLY, read from the same canonical
 * `loadVenuesAndPitchesForClub` Select Venue uses. Requires a venue to already be chosen -- this screen
 * is never reachable otherwise (Venue & Pitch's own Pitch field stays disabled until then).
 */
export function SelectPitchScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setPitch } = useTrainingPlanDraft()
  const [pitches, setPitches] = useState<ClubPitch[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!clubId || !draft.venue) return
    loadVenuesAndPitchesForClub(supabase, clubId)
      .then((all) => setPitches(all.pitches.filter((p) => p.venueId === draft.venue!.id)))
      .catch((caught) => {
        const failure = friendly(caught, "your pitches")
        logDetail("training-planning select-pitch", failure)
        setProblem(failure.message)
      })
  }, [clubId, draft.venue])

  const onClose = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.xs, paddingBottom: space.sm, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: surface.forest }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
        <Text style={[type.smallMedium, { color: colour.chalk }]}>Select Pitch{draft.venue ? ` -- ${draft.venue.name}` : ""}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {problem && (
          <View style={{ padding: space.lg }}>
            <ErrorState message={problem} onRetry={() => setProblem(null)} />
          </View>
        )}
        {!problem && !pitches && (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}
        {!problem && pitches && pitches.length === 0 && <EmptyState title="No pitches yet" body="Active pitches at this venue will appear here." />}
        {pitches &&
          pitches.map((p, i) => (
            <PitchOptionRow
              key={p.id}
              pitch={p}
              selected={draft.pitch?.id === p.id}
              showDivider={i < pitches.length - 1}
              onPress={() => {
                setPitch(p)
                onClose()
              }}
            />
          ))}
      </ScrollView>
    </View>
  )
}

function PitchOptionRow({ pitch, selected, showDivider, onPress }: { pitch: ClubPitch; selected: boolean; showDivider: boolean; onPress: () => void }) {
  const cover = resolvePitchCover({ supabase, coverImagePath: pitch.coverImagePath, coverStockKey: pitch.coverStockKey })
  const source = coverPhotoSource("PITCH", cover, pitch.id)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={pitch.displayName}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: selected ? colour.mint100 : pressed ? "rgba(16,21,18,0.03)" : "transparent",
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colour.line,
      })}
    >
      <Image source={source} style={{ width: 44, height: 44, borderRadius: radius.sm }} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
          {pitch.displayName}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
          {pitchConfigurationSummary(pitch)}
        </Text>
      </View>
      {selected && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
    </Pressable>
  )
}
