import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { ClubVenue } from "@ovalball/contracts/club/venues"
import { resolveVenueCover } from "@ovalball/contracts/venue-cover"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { friendly, logDetail } from "../../errors/translate"
import { ChevronLeft, Check } from "../../components/icons"
import { CardSkeleton, ErrorState, EmptyState } from "../../components/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"
import { venueAddressLine } from "@ovalball/contracts/club/venues"
import { loadVenuesAndPitchesForClub } from "../data"
import { useTrainingPlanDraft } from "./draft-context"
import { coverPhotoSource } from "../../media/stock-assets"


/**
 * SELECT VENUE -- reads the exact same canonical venue list Arena Planning, Pitch Allocation and the
 * Venue Profile screen already read (`loadVenuesAndPitchesForClub`), never a training-only venue model.
 * Active venues only, matching Select Team's own "active only" rule.
 */
export function SelectVenueScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setVenue } = useTrainingPlanDraft()
  const [venues, setVenues] = useState<ClubVenue[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!clubId) return
    loadVenuesAndPitchesForClub(supabase, clubId)
      .then((all) => setVenues(all.venues))
      .catch((caught) => {
        const failure = friendly(caught, "your venues")
        logDetail("training-planning select-venue", failure)
        setProblem(failure.message)
      })
  }, [clubId])

  const onClose = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.xs, paddingBottom: space.sm, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: surface.forest }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
        <Text style={[type.smallMedium, { color: colour.chalk }]}>Select Venue</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {problem && (
          <View style={{ padding: space.lg }}>
            <ErrorState message={problem} onRetry={() => setProblem(null)} />
          </View>
        )}
        {!problem && !venues && (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}
        {!problem && venues && venues.length === 0 && <EmptyState title="No venues yet" body="Active venues at this club will appear here." />}
        {venues &&
          venues.map((v, i) => (
            <VenueOptionRow
              key={v.id}
              venue={v}
              selected={draft.venue?.id === v.id}
              showDivider={i < venues.length - 1}
              onPress={() => {
                setVenue(v)
                onClose()
              }}
            />
          ))}
      </ScrollView>
    </View>
  )
}

function VenueOptionRow({ venue, selected, showDivider, onPress }: { venue: ClubVenue; selected: boolean; showDivider: boolean; onPress: () => void }) {
  const cover = resolveVenueCover({ supabase, coverImagePath: venue.coverImagePath, coverStockKey: venue.coverStockKey })
  const source = coverPhotoSource("VENUE", cover, venue.id)
  const address = venueAddressLine(venue)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={venue.name}
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
          {venue.name}
        </Text>
        {!!address && (
          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
            {address}
          </Text>
        )}
      </View>
      {selected && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
    </Pressable>
  )
}
