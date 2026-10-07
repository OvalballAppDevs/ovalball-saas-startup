import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"
import { layoutAreaCount, layoutLabel, physicalSizeCategoryLabel } from "@ovalball/contracts/pitch-allocation"

import { supabase } from "../../auth/supabase"
import { ChevronRight, Info } from "../../components/icons"
import { Button } from "../../components/ui"
import { colour, elevation, radius, space, type } from "../../design/tokens"
import { useTrainingPlanDraft } from "./draft-context"
import { WizardHero } from "./wizard-hero"
import { WizardStepIndicator } from "./step-indicator"
import { coverPhotoSource, libraryAsset } from "../../media/stock-assets"

// REUSED, not regenerated (Section 16's own instruction: "Only use Higgsfield if the library
// genuinely doesn't contain a suitable image"). Venue & Pitch's own hero is about arriving at the
// training ground -- venue/cover-library.ts's "Clubhouse, early evening" already communicates exactly
// that, and reusing it means one fewer unreviewed generation.
const heroPhoto = libraryAsset("clubhouse-evening-01")

/**
 * CREATE TRAINING PLAN -- STEP 3: VENUE & PITCH.
 *
 * Venue and Pitch are real `venues`/`club_pitches` rows (`select-venue-screen.tsx`/
 * `select-pitch-screen.tsx`, both reading `loadVenuesAndPitchesForClub` -- the same canonical source
 * Arena Planning and Pitch Allocation use), never free text. Their ids are exactly what
 * `training_plans.preferred_venue_id`/`preferred_pitch_id` already require (both NOT NULL foreign keys,
 * `20261011000000_training_management_schema.sql`) -- Review & Create (not built in this pass) can pass
 * this screen's selection straight to `save_training_plan` with no translation step.
 *
 * PITCH INFORMATION shows only fields the schema actually has (`physicalSizeCategory`, `layout`,
 * `laneCount`). Floodlights/changing rooms/showers, shown in the reference mock-up, have no column
 * anywhere on `club_pitches` -- confirmed absent by reading `packages/contracts/src/club/venues.ts`'s
 * own `ClubPitch` interface -- so they are not fabricated here; see the Page 4 report's own "missing
 * model field" note.
 */
export function VenueAndPitchScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { draft } = useTrainingPlanDraft()

  const onBack = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))
  const canContinue = draft.venue !== null && draft.pitch !== null

  const venueCover = draft.venue ? coverPhotoSource("VENUE", resolveVenueCover({ supabase, coverImagePath: draft.venue.coverImagePath, coverStockKey: draft.venue.coverStockKey }), draft.venue.id) : null
  const pitchCover = draft.pitch ? coverPhotoSource("PITCH", resolvePitchCover({ supabase, coverImagePath: draft.pitch.coverImagePath, coverStockKey: draft.pitch.coverStockKey }), draft.pitch.id) : null

  const sharedPitchAllowed = draft.pitch ? layoutAreaCount(draft.pitch.layout) > 1 : false

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 + 96 }} showsVerticalScrollIndicator={false}>
        <WizardHero heroPhoto={heroPhoto} heading="Venue & Pitch" onClose={onBack} />

        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg, gap: space.lg }}>
          <WizardStepIndicator currentStep={3} />

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>VENUE</Text>
            <SelectorField
              image={venueCover}
              label={draft.venue?.name ?? "Select a venue"}
              onPress={() => router.push("/admin/training-planning/create/select-venue" as never)}
            />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCH</Text>
            <SelectorField
              image={pitchCover}
              label={draft.pitch?.displayName ?? (draft.venue ? "Select a pitch" : "Choose a venue first")}
              onPress={() => draft.venue && router.push("/admin/training-planning/create/select-pitch" as never)}
              disabled={!draft.venue}
            />
          </View>

          {sharedPitchAllowed && (
            <View style={{ flexDirection: "row", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.mint100, padding: space.md }}>
              <Info size={18} color={colour.forest800} />
              <Text style={[type.small, { color: colour.forest800, flex: 1 }]}>Multiple teams can train on the same pitch at the same time.</Text>
            </View>
          )}

          {draft.pitch && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCH INFORMATION</Text>
              <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, overflow: "hidden", ...elevation.card }}>
                {pitchCover && <Image source={pitchCover} accessible={false} contentFit="cover" style={{ width: "100%", height: 140 }} />}
                <View style={{ padding: space.md, gap: 4 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.pitch.displayName}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{physicalSizeCategoryLabel(draft.pitch.physicalSizeCategory)}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    {draft.pitch.layout === "full_only" ? "Whole pitch only" : `Splits into ${layoutAreaCount(draft.pitch.layout)} areas (${layoutLabel(draft.pitch.layout).toLowerCase()})`}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, paddingBottom: space.lg + insets.bottom, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <View style={{ flex: 1 }}>
          <Button label="Back" variant="secondary" onPress={onBack} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Next" variant="primary" disabled={!canContinue} onPress={() => router.push("/admin/training-planning/create/times" as never)} />
        </View>
      </View>
    </View>
  )
}

function SelectorField({ image, label, onPress, disabled }: { image: { uri: string } | number | null; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        padding: space.sm,
        backgroundColor: colour.surface,
        opacity: disabled ? 0.5 : pressed ? 0.92 : 1,
        ...elevation.card,
      })}
    >
      {image ? <Image source={image} accessible={false} contentFit="cover" style={{ width: 44, height: 44, borderRadius: radius.sm }} /> : <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colour.line }} />}
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      <ChevronRight size={18} color={colour.inkMuted} />
    </Pressable>
  )
}
