import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { resolveTeamCover } from "@ovalball/contracts"

import { supabase } from "../../auth/supabase"
import { useAdminCentreAccess } from "../../admin/access"
import { friendly, logDetail } from "../../errors/translate"
import { ChevronLeft, Check } from "../../components/icons"
import { CardSkeleton, ErrorState, EmptyState } from "../../components/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"
import { loadOrderedClubTeams, type OrderedTeamOption } from "../data"
import { useTrainingPlanDraft } from "./draft-context"
import { teamCoverSource } from "../../media/stock-assets"

/**
 * SELECT TEAM -- reads the exact same canonical, rugby-ordered list Training Planning Home uses
 * (`loadOrderedClubTeams`), never a mock or duplicated team dataset. Presented as a modal sheet
 * (`create/_layout.tsx`) rather than a full wizard step, per the correction brief's own instruction
 * that a resource selector is not a principal screen.
 */
export function SelectTeamScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const { draft, setTeam } = useTrainingPlanDraft()
  const [teams, setTeams] = useState<OrderedTeamOption[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!clubId) return
    loadOrderedClubTeams(supabase, clubId)
      .then(setTeams)
      .catch((caught) => {
        const failure = friendly(caught, "your teams")
        logDetail("training-planning select-team", failure)
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
        <Text style={[type.smallMedium, { color: colour.chalk }]}>Select Team</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {problem && (
          <View style={{ padding: space.lg }}>
            <ErrorState message={problem} onRetry={() => setProblem(null)} />
          </View>
        )}
        {!problem && !teams && (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </View>
        )}
        {!problem && teams && teams.length === 0 && <EmptyState title="No teams yet" body="Active teams at this club will appear here." />}
        {teams &&
          teams.map((t, i) => (
            <TeamOptionRow
              key={t.teamId}
              team={t}
              selected={draft.team?.teamId === t.teamId}
              showDivider={i < teams.length - 1}
              onPress={() => {
                setTeam(t)
                onClose()
              }}
            />
          ))}
      </ScrollView>
    </View>
  )
}

function TeamOptionRow({ team, selected, showDivider, onPress }: { team: OrderedTeamOption; selected: boolean; showDivider: boolean; onPress: () => void }) {
  const cover = resolveTeamCover({ supabase, coverImagePath: team.coverImagePath, coverStockKey: team.coverStockKey, crestUrl: null })
  const source = teamCoverSource(cover, { category: team.category, ageGroup: team.ageGroup, gender: team.gender, active: true })

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={team.teamLabel}
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
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
        {team.teamLabel}
      </Text>
      {selected && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
    </Pressable>
  )
}
