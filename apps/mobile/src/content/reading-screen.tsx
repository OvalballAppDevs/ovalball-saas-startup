import { Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChevronLeft } from "../components/icons"
import { ClubCrest } from "../components/identity"
import { useAppContexts } from "../context/contexts"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * THE READING SCREEN for what a club has published -- the same quiet bar the Rugby Hub and the Admin
 * Centre use: a back chevron, the club's crest and name (the canonical identity the context resolved,
 * never a kit and never a person), and the section. Back returns to wherever this was opened from, and
 * to the News & Announcements list when it was opened from outside it -- Home, a link, a notification.
 */
export function ReadingScreen({ section, clubName, clubCrestUrl, children, refreshing = false, onRefresh, contentStyle }: { section: string; /** The content's own club, when the screen knows it -- a family or a deep link may be standing in no club. */ clubName?: string | null; /** The content's own crest (canonical resolver), when known. */ clubCrestUrl?: string | null; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; contentStyle?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const navigation = useNavigation()
  const { club } = useAppContexts()
  const back = () => {
    const state = navigation.getState()
    if (state && state.index > 0) router.back()
    else router.dismissTo("/news" as never)
  }
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.xs, paddingBottom: space.xs, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colour.chalk, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent" })}>
          <ChevronLeft size={24} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
        <ClubCrest clubName={clubName ?? club.name} url={clubCrestUrl ?? club.crestUrl} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.forest800, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {clubName ?? club.name ?? "Ovalball"}
          </Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {section}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[{ paddingBottom: insets.bottom + space.xxl, gap: space.xl }, contentStyle]}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  )
}
