import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { friendly, logDetail } from "../../errors/translate"
import { ChevronLeft, Check } from "../../components/icons"
import { CardSkeleton, ErrorState, EmptyState } from "../../components/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"
import { loadSeasonsForClub, type CanonicalSeason } from "../data"
import { useTrainingPlanDraft } from "./draft-context"

/**
 * SELECT SEASON -- every canonical season for this club's own rugby code (`loadSeasonsForClub`), never
 * a hardcoded list and never a Training-specific season table. Correction brief Section 1: "Do not
 * fabricate example seasons if they do not exist" -- if this club/sport genuinely has one season on
 * record, that is the only row shown, honestly.
 */
export function SelectSeasonScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setSeason } = useTrainingPlanDraft()
  const [seasons, setSeasons] = useState<CanonicalSeason[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!clubId) return
    loadSeasonsForClub(supabase, clubId)
      .then((r) => setSeasons(r.seasons))
      .catch((caught) => {
        const failure = friendly(caught, "the club's seasons")
        logDetail("training-planning select-season", failure)
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
        <Text style={[type.heading, { color: colour.chalk }]}>Select Season</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {problem && (
          <View style={{ padding: space.lg }}>
            <ErrorState message={problem} onRetry={() => setProblem(null)} />
          </View>
        )}
        {!problem && !seasons && (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}
        {!problem && seasons && seasons.length === 0 && <EmptyState title="No seasons yet" body="Ask a Site Admin to add this club's rugby code to the Seasons register." />}
        {seasons &&
          seasons.map((s, i) => (
            <SeasonOptionRow
              key={s.id}
              season={s}
              selected={draft.season?.id === s.id}
              showDivider={i < seasons.length - 1}
              onPress={() => {
                setSeason(s)
                onClose()
              }}
            />
          ))}
      </ScrollView>
    </View>
  )
}

function SeasonOptionRow({ season, selected, showDivider, onPress }: { season: CanonicalSeason; selected: boolean; showDivider: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${season.name}, ${formatDate(season.startsOn)} to ${formatDate(season.endsOn)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: selected ? colour.mint100 : pressed ? "rgba(16,21,18,0.03)" : "transparent",
        borderBottomWidth: showDivider ? 1 : 0,
        borderBottomColor: colour.line,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{season.name}</Text>
        <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>
          {formatDate(season.startsOn)} – {formatDate(season.endsOn)}
        </Text>
      </View>
      {selected && <Check size={20} color={colour.forest800} strokeWidth={2.4} />}
    </Pressable>
  )
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
