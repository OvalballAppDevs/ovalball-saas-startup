import { forwardRef } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChevronLeft, Search } from "../components/icons"
import { useBackToSurface } from "../links/back"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * THE HUB'S INNER SCREEN — one bar, one scroll, one set of insets.
 *
 * The landing keeps the app's canonical header (who I am, what I am operating
 * as, what needs me) exactly as Fixtures and Calendar do. Everything beneath
 * it is READING, and reading wants the bar out of the way: a back chevron, the
 * name of the section the article belongs to, and search -- which on the
 * website sits in the Hub's own header on every page, so it sits in this one.
 *
 * BACK GOES TO WHERE THIS SCREEN WAS OPENED FROM, and when it was opened from
 * outside the tab -- Home, a notification, a shared link -- it goes to the Hub
 * landing rather than bouncing out to another tab. Same stack-aware rule as
 * the Training Centre, for the same measured reason.
 */
export const HubScreen = forwardRef<ScrollView, {
  section: string
  children: React.ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  contentStyle?: StyleProp<ViewStyle>
  /** True on the search screen, whose bar has no search glyph because it IS search. */
  isSearch?: boolean
}>(function HubScreen({ section, children, refreshing = false, onRefresh, contentStyle, isSearch = false }, ref) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const back = useBackToSurface("/hub")
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.xs,
          paddingBottom: space.xs,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          backgroundColor: colour.chalk,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent" })}>
          <ChevronLeft size={24} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.forest800, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Inter_600SemiBold" }]}>Rugby Hub</Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {section}
          </Text>
        </View>
        {!isSearch && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search Rugby Hub"
            onPress={() => router.push("/hub/search")}
            hitSlop={6}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent" })}
          >
            <Search size={22} color={colour.forest800} strokeWidth={2} />
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[{ paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: insets.bottom + space.xxl, gap: space.xl }, contentStyle]}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  )
})
