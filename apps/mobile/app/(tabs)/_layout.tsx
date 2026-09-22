import { Tabs } from "expo-router"
import { Text, View, type ColorValue } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppContexts } from "../../src/context/contexts"
import { projectTabs, type TabKey } from "../../src/context/tab-projection"
import { BookOpen, CalendarDays, Ellipsis, House, OvalIcon, Receipt } from "../../src/components/icons"
import { colour, type } from "../../src/design/tokens"

/**
 * THE BOTTOM BAR — the phone's own navigation, not the desktop sidebar compressed.
 *
 * FOREST, NOT CHROME GREY. The bar is the one piece of app furniture on every screen, so it is where
 * the brand lives; a default tab bar is the single fastest way to make a product look like a starter
 * template. The active cell is not colour alone -- it gains a pitch-green rule above it and a heavier
 * label -- because a colour-only active state fails for the people most likely to miss it.
 *
 * SAFE AREA IS ADDED, NOT ASSUMED. The home indicator's height is read from the device and added to
 * the bar's own height, so the labels sit above it on a notched iPhone and the bar is not needlessly
 * tall on a phone with a physical button.
 *
 * WHICH FIVE is `projectTabs`, which reads the active context and one server-answered capability.
 * Hiding a cell grants and protects nothing: every route re-checks its own authority.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const { active, canSeeTeamSubscriptions } = useAppContexts()
  const visible = projectTabs({ kind: active?.kind ?? null, canSeeTeamSubscriptions })
  const shown = new Set(visible.map((t) => t.key))

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colour.pitch400,
        tabBarInactiveTintColor: "rgba(255,255,255,0.62)",
        // THE CELL IS DRAWN HERE, GLYPH AND LABEL TOGETHER, and the library's own label slot is switched
        // off. It was not a styling preference: the library sizes that slot itself, and on a bar this
        // height it clipped the label out of sight while leaving it in the accessibility tree -- so the
        // bar LOOKED icon-only and tested as labelled, which is the worst of both. Owning the whole
        // cell means one layout that cannot be silently re-measured underneath us.
        //
        // 58pt, AND THE NUMBER IS THE TOUCH TARGET'S, not the artwork's. The content needs 40 (22 glyph
        // + 4 + 14 label), but a tab must be at least 44 tall to be comfortable -- measured at 39 on the
        // first attempt, which is how a bar ends up looking fine and feeling fiddly. 58 minus 6 above
        // and 6 below leaves each cell 46.
        //
        // The home indicator's height is ADDED rather than absorbed, so the labels clear it on a
        // notched iPhone and the bar stays short on a phone with a button.
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colour.forest950,
          borderTopColor: "rgba(255,255,255,0.08)",
          borderTopWidth: 1,
          height: 58 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 6,
        },
        tabBarItemStyle: { paddingVertical: 0, minHeight: 46 },
        // Immediate. A tab is a place, not a journey, and animating between places makes a phone feel
        // slower than the website it is meant to beat.
        animation: "none",
        lazy: true,
      }}
    >
      {ALL.map(({ key, title }) => (
        <Tabs.Screen
          key={key}
          name={key}
          options={{
            title: visible.find((t) => t.key === key)?.label ?? title,
            // `href: null` removes the cell from the bar while leaving the route addressable, which is
            // what keeps a deep link to a hidden destination working.
            href: shown.has(key) ? undefined : null,
            tabBarIcon: ({ color, focused }) => (
              <TabCell tab={key} label={visible.find((t) => t.key === key)?.label ?? title} color={color} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}

const ALL: { key: TabKey; title: string }[] = [
  { key: "index", title: "Home" },
  { key: "fixtures", title: "Fixtures" },
  { key: "calendar", title: "Calendar" },
  { key: "hub", title: "Rugby Hub" },
  { key: "subscriptions", title: "Subscriptions" },
  { key: "more", title: "More" },
]

/**
 * ONE CELL: the rule, the glyph and the word.
 *
 * Lucide throughout -- the website's own family -- except Fixtures, which is the brand's oval, because
 * Lucide has no rugby ball and a trophy or a flag says something Ovalball does not mean.
 *
 * THE ACTIVE STATE IS THREE THINGS, not a colour: a pitch-green rule above the glyph, a heavier stroke
 * on the glyph itself, and a heavier label. Colour alone fails the people most likely to need the cue.
 */
function TabCell({ tab, label, color, focused }: { tab: TabKey; label: string; color: ColorValue; focused: boolean }) {
  const tint = String(color)
  const size = 22
  const glyph =
    tab === "index" ? <House size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "fixtures" ? <OvalIcon size={size} color={tint} /> :
    tab === "calendar" ? <CalendarDays size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "hub" ? <BookOpen size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "subscriptions" ? <Receipt size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    <Ellipsis size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} />

  return (
    <View style={{ alignItems: "center", justifyContent: "flex-start", width: 64, gap: 4 }}>
      {focused && (
        <View
          style={{
            position: "absolute",
            top: -6,
            height: 2,
            width: 18,
            borderRadius: 2,
            backgroundColor: colour.pitch400,
          }}
        />
      )}
      {glyph}
      <Text
        numberOfLines={1}
        // Announced by the tab's own role and title; repeating it here would read the word twice.
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          type.caption,
          {
            fontSize: 11,
            lineHeight: 14,
            color: String(color),
            fontFamily: focused ? type.smallMedium.fontFamily : type.caption.fontFamily,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  )
}

/** Home is the tab a cold start lands on, whatever the last route happened to be. */
export const unstable_settings = { initialRouteName: "index" }
