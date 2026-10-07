import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChevronLeft } from "../components/icons"
import { ClubCrest } from "../components/identity"
import { useAppContexts } from "../context/contexts"
import { useOriginBack } from "../links/origin"
import { tabBarHeight } from "../navigation/tab-bar-height"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * THE ADMIN CENTRE'S INNER SCREEN -- the club's own identity in the bar, then the work.
 *
 * The bar carries the club's crest and name (the canonical identity the header resolves for the
 * selected context -- never a kit, never a team) and the section's name, so a person always knows
 * WHOSE club they are administering. Back goes to where this screen was opened from, and to the
 * Admin Centre landing when it was opened from outside.
 */
export function AdminScreen({ section, children, refreshing = false, onRefresh, footer, fallback = "/admin" }: { section: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; footer?: React.ReactNode; fallback?: string }) {
  const insets = useSafeAreaInsets()
  const { club } = useAppContexts()
  // An opener in another tab (More) says where it is with `returnTo`; otherwise Back pops, or lands on the Admin Centre.
  const back = useOriginBack(fallback)
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* THE HEADER, in the brand's own forest ground -- the same dark green as the bottom bar and the
          launch screen, deliberately made app-wide (not a one-screen change) so every Club Admin
          section reads as one product rather than a light bar on some screens and a dark one on others. */}
      <StatusBar style="light" />
      <View
        style={{
          paddingTop: insets.top + space.xs,
          paddingBottom: space.sm,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          backgroundColor: colour.forest950,
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={6} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(255,255,255,0.08)" : "transparent" })}>
          <ChevronLeft size={24} color={colour.onForest} strokeWidth={2.2} />
        </Pressable>
        <ClubCrest clubName={club.name} url={club.crestUrl} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.onForestMuted, textTransform: "uppercase", letterSpacing: 1, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {club.name ?? "Admin Centre"}
          </Text>
          <Text style={[type.smallMedium, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {section}
          </Text>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // THE BOTTOM NAVIGATION IS ABSOLUTE, SO ITS HEIGHT HAS TO BE RESERVED HERE. Padding by the
        // safe-area inset alone leaves the last row under the bar -- which on Tournaments hid "Create
        // New Tournament" entirely, so the screen's primary action could not be reached at all.
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: tabBarHeight(insets.bottom) + space.lg + (footer ? 72 : 0), gap: space.xl }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}
