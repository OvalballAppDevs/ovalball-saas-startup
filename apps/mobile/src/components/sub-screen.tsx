import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChevronLeft } from "./icons"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/** The header a screen under a tab wears: a back control and its title. One shape, used everywhere. */
export function SubScreenHeader({ title, fallback = "/(tabs)/more" }: { title: string; fallback?: string }) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colour.chalk }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <ChevronLeft size={22} color={colour.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
        {title}
      </Text>
    </View>
  )
}
