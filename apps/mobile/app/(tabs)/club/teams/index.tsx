import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { loadClubOverview, type ClubOverview } from "@ovalball/contracts/club/overview"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { todayIso } from "../../../../src/agenda/load"
import { relativeDate } from "../../../../src/agenda/presentation"
import { ChevronRight, Users } from "../../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * THE CLUB'S SIDES (CA-M10): every active side the club runs, what it has next and who is in it.
 *
 * Operational, not administrative: the Team Directory administration (adding a side, folding one,
 * an alias) is the Admin Centre's, reached from a row where the person holds `team.team.manage`. The
 * name is the canonical display name; the row carries no kit and no crest.
 */
export default function ClubTeams() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active, club } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [overview, setOverview] = useState<ClubOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      setOverview(await loadClubOverview(supabase, clubId, club.name ?? active?.label ?? "Club", todayIso()))
    } catch (caught) {
      const failure = friendly(caught, "the club's teams")
      logDetail("club teams", failure)
      setProblem(failure.message)
    }
  }, [clubId, club.name, active?.label])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )
  const today = todayIso()

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Teams</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}>
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : overview === null ? (
          <CardSkeleton lines={4} />
        ) : overview.teams.length === 0 ? (
          <EmptyState title="No sides yet" body="When the club adds a side from the Team Directory, it appears here." icon={<Users size={22} color={colour.inkSubtle} />} />
        ) : (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {overview.teams.map((row, index) => (
              <Pressable
                key={row.team.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.team.displayName}. ${row.players} players, ${row.staff} staff. ${row.nextFixture ? `Next: ${relativeDate(row.nextFixture.date, today)} v ${row.nextFixture.them?.clubName ?? "TBC"}` : "No fixture scheduled"}`}
                onPress={() => router.push({ pathname: "/club/teams/[teamId]", params: { teamId: row.team.id } } as never)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : "transparent" })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{row.team.displayName}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{[row.team.ageGroup, row.team.category === "senior" ? "Senior" : row.team.category === "colts" ? "Colts" : null].filter(Boolean).join(" · ") || row.team.compactLabel}</Text>
                  <Text style={[type.caption, { color: row.nextFixture ? colour.forest800 : colour.inkSubtle }]}>{row.nextFixture ? `${relativeDate(row.nextFixture.date, today)} · v ${[row.nextFixture.them?.clubName, row.nextFixture.them?.teamName].filter(Boolean).join(" ") || "TBC"}` : "No fixture scheduled"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{row.players}</Text>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{`players · ${row.staff} staff`}</Text>
                </View>
                <ChevronRight size={16} color={colour.inkSubtle} />
              </Pressable>
            ))}
          </View>
        )}
        {overview?.authority.teamManage && <Button label="Team Directory" variant="secondary" onPress={() => router.push("/admin/teams" as never)} accessibilityHint="Add, fold or rename a side in the Admin Centre" />}
      </ScrollView>
    </View>
  )
}
