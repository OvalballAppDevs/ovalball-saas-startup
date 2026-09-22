import { Tabs } from "expo-router"
import { Text, type ColorValue } from "react-native"

import { colour, type } from "../../src/design/tokens"

/**
 * THE BOTTOM BAR — the phone's own navigation, not the desktop sidebar compressed.
 *
 * Five destinations, which is the practical ceiling before cells become too narrow to label and the
 * labels are what make a bar usable. Home, Fixtures, Calendar, Rugby Hub, More. The website's grouped
 * sidebar is a different shape for a different input device, and translating it would produce a
 * disclosure triangle on a touchscreen.
 *
 * WHAT IS NOT HERE YET IS SAID SO. Calendar and Rugby Hub are real destinations in the platform and
 * are not built in this mobile foundation; each one says that in its own words rather than showing an
 * empty list, and More points at the website for the jobs that are deliberately web-only.
 *
 * Icons are the tab label's companion, never its replacement: every cell keeps a visible word, so the
 * bar is readable without knowing what a shape means.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colour.pitch400,
        tabBarInactiveTintColor: "rgba(255,255,255,0.65)",
        tabBarStyle: {
          backgroundColor: colour.forest950,
          borderTopColor: "rgba(255,255,255,0.10)",
        },
        tabBarLabelStyle: { ...type.caption, marginBottom: 2 },
        // 44pt minimum per cell, and the label always renders.
        tabBarItemStyle: { minHeight: 44 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <Glyph glyph="⌂" color={color} /> }} />
      <Tabs.Screen name="fixtures" options={{ title: "Fixtures", tabBarIcon: ({ color }) => <Glyph glyph="◍" color={color} /> }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar", tabBarIcon: ({ color }) => <Glyph glyph="▤" color={color} /> }} />
      <Tabs.Screen name="hub" options={{ title: "Rugby Hub", tabBarIcon: ({ color }) => <Glyph glyph="▥" color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color }) => <Glyph glyph="⋯" color={color} /> }} />
    </Tabs>
  )
}

/** A placeholder glyph set, deliberately: a real icon set is a design decision, not a foundation one. */
function Glyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color, fontSize: 18 }}>{glyph}</Text>
}
