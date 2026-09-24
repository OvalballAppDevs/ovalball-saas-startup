import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../src/auth/supabase"
import { webUrl } from "../../../src/config/environment"
import { useAppContexts } from "../../../src/context/contexts"
import { loadFamilyScreen, type FamilyScreenData } from "../../../src/family/data"
import { PersonAvatar } from "../../../src/components/identity"
import { ChevronRight, ExternalLink, UserPlus } from "../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * CHILDREN / FAMILY (CA-M9): who this person looks after, and who they are, in the words a family uses.
 *
 * Each row is a person: their picture, their name, the sides they play for and the club those sides
 * belong to, and whether they have their own login. No date of birth, no relationship record, no
 * provenance. Adding a child, asking to be linked to one, or inviting another guardian are the
 * website's flows -- they need a date of birth and a club search, which are desk work -- and the
 * screen says so and opens them rather than rebuilding them.
 */
export default function FamilyScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext } = useAppContexts()
  const [data, setData] = useState<FamilyScreenData | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!sessionContext) return
    setProblem(null)
    try {
      setData(await loadFamilyScreen(supabase, sessionContext))
    } catch (caught) {
      const failure = friendly(caught, "your family")
      logDetail("family", failure)
      setProblem(failure.message)
    }
  }, [sessionContext])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Children & Family
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}
      >
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : data === null ? (
          <CardSkeleton lines={3} />
        ) : data.rows.length === 0 ? (
          <EmptyState title="No children linked yet" body="Add a child or ask to be linked to one on the Ovalball website, and they appear here." icon={<UserPlus size={24} color={colour.inkSubtle} />} />
        ) : (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {data.rows.map((row, index) => (
              <Pressable
                key={row.playerId}
                accessibilityRole="button"
                accessibilityLabel={`${row.fullName}. ${row.relationshipLabel === "You" ? "You" : "Your child"}. ${row.teams.map((t) => `${t.teamName} at ${t.clubName}`).join(", ") || "No team yet"}. ${row.hasLogin ? "Has their own login" : "No login"}`}
                onPress={() => router.push({ pathname: "/family/[playerId]", params: { playerId: row.playerId } } as never)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 20, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
              >
                <PersonAvatar name={row.fullName} url={row.avatarUrl} initials={row.initials} size={46} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[type.caption, { color: colour.inkSubtle, letterSpacing: 0.6 }]}>{row.relationshipLabel.toUpperCase()}</Text>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{row.fullName}</Text>
                  {row.teams.length > 0 ? (
                    row.teams.map((t) => (
                      <Text key={t.teamId} style={[type.caption, { color: colour.inkMuted }]}>{`${t.teamName} · ${t.clubName}`}</Text>
                    ))
                  ) : (
                    <Text style={[type.caption, { color: colour.inkMuted }]}>Awaiting a team from the club</Text>
                  )}
                </View>
                <ChevronRight size={18} color={colour.inkSubtle} />
              </Pressable>
            ))}
          </View>
        )}

        {data && data.pending.length > 0 && (
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Waiting</Text>
            {data.pending.map((p) => (
              <Card key={p.requestId}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{p.awaitingMyAnswer ? "Somebody has asked you to be a guardian" : p.kind === "ADDITIONAL_GUARDIAN" ? "Another guardian invited" : "Link request with the club"}</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{[p.childLabel, p.clubName].filter(Boolean).join(" · ") || "Awaiting a decision"}</Text>
                {p.awaitingMyAnswer && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Answer on the Ovalball website" onPress={() => void Linking.openURL(`${webUrl}/parent/children`)} style={{ marginTop: space.sm, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[type.smallMedium, { color: colour.forest800 }]}>Answer on the website</Text>
                    <ExternalLink size={14} color={colour.forest800} />
                  </Pressable>
                )}
              </Card>
            ))}
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>On the website</Text>
          <Card onPress={() => void Linking.openURL(`${webUrl}/parent/children`)} accessibilityLabel="Add a child, ask to be linked to one, or invite another guardian. Opens the Ovalball website">
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <UserPlus size={20} color={colour.forest800} strokeWidth={1.9} />
              <View style={{ flex: 1 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Add a child, link a child, or invite another guardian</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>These need a date of birth and a club search, so they stay on the website.</Text>
              </View>
              <ExternalLink size={16} color={colour.inkSubtle} />
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  )
}
