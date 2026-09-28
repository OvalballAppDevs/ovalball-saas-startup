import { Tabs, usePathname } from "expo-router"
import { Text, View, type ColorValue } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppContexts } from "../../src/context/contexts"
import { projectTabs, type TabKey } from "../../src/context/tab-projection"
import { BookOpen, CalendarDays, Ellipsis, House, MapPin, MessageSquare, OvalIcon, Receipt } from "../../src/components/icons"
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
  const { active } = useAppContexts()
  const visible = projectTabs({ kind: active?.kind ?? null })
  const shown = new Set(visible.map((t) => t.key))
  const pathname = usePathname()
  const onFocusedConfirmationScreen = pathname === "/fixtures/request-fixtures" || pathname === "/fixtures/request-sent"

  // NAMED, NOT INLINE, because one nested screen (Request Fixtures' own Request Sent confirmation,
  // below) needs to explicitly restore this exact style -- `options.tabBarStyle` is not deep-merged
  // with `screenOptions.tabBarStyle`, so setting it to `undefined` for "every other screen" would
  // silently blank the bar everywhere else instead of falling back to this default.
  const defaultTabBarStyle = {
    backgroundColor: colour.forest950,
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    height: 58 + insets.bottom,
    paddingTop: 6,
    paddingBottom: insets.bottom > 0 ? insets.bottom : 6,
  }

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
        tabBarStyle: defaultTabBarStyle,
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
            // NO UNREAD IN THE BAR ANY MORE. Messages moved to the global header, where its badge
            // lives beside Notifications and Support -- three independent counts from one canonical
            // read. A bar cell carrying a fourth copy of one of them is how they come to disagree.
            tabBarAccessibilityLabel: visible.find((t) => t.key === key)?.label ?? title,
            // `href: null` removes the cell from the bar while leaving the route addressable, which is
            // what keeps a deep link to a hidden destination working.
            href: shown.has(key) ? undefined : null,
            // THE ONE DELIBERATE EXCEPTION: Request Fixtures and its own Request Sent confirmation are a
            // focused, modal-feeling flow (owner correction, Section 20's own supplied mockup shows no
            // tab bar at all), not "a place inside Fixtures" the way the agenda or a fixture's own detail
            // page is -- so the bar hides for exactly those two nested screens and only those two,
            // leaving every other screen already nested under this tab (Add Fixture, a fixture's own
            // detail) with its existing, already-accepted persistent-bar behaviour untouched.
            tabBarStyle: key === "fixtures" && onFocusedConfirmationScreen ? { display: "none" } : defaultTabBarStyle,
            tabBarIcon: ({ color, focused }) => (
              <TabCell
                tab={key}
                label={visible.find((t) => t.key === key)?.label ?? title}
                color={color}
                focused={focused}
                badge={0}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}

/**
 * Every route the tab group owns, whether or not it has a cell.
 *
 * `notifications` and `support` are deliberately here with no cell: they belong
 * to the GLOBAL HEADER, which reaches them from every screen, and `href: null`
 * below removes the cell while leaving the route addressable -- which is what
 * keeps a header tap and a deep link working.
 */
const ALL: { key: TabKey; title: string }[] = [
  { key: "index", title: "Home" },
  { key: "fixtures", title: "Fixtures" },
  { key: "calendar", title: "Calendar" },
  { key: "messages", title: "Messages" },
  { key: "hub", title: "Rugby Hub" },
  { key: "clubhouse", title: "Clubhouse" },
  { key: "notifications", title: "Notifications" },
  { key: "support", title: "Support" },
  { key: "subscriptions", title: "Subscriptions" },
  { key: "admin", title: "Admin Centre" },
  { key: "team", title: "Team" },
  { key: "family", title: "Family" },
  { key: "profile", title: "Profile" },
  { key: "club", title: "Club" },
  { key: "teams", title: "Teams" },
  { key: "security", title: "Security" },
  // EVERY ROUTE GROUP UNDER THE TAB FOLDER MUST BE DECLARED HERE, hidden or not. An undeclared group is
  // auto-registered by the router with the library's "missing icon" glyph -- which is exactly the two
  // stray arrow cells the owner saw beside More (CA-M11.1). News and Announcements are reached from
  // Home and More, never from the bar.
  { key: "news", title: "News" },
  { key: "announcements", title: "Announcements" },
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
function TabCell({ tab, label, color, focused, badge = 0 }: { tab: TabKey; label: string; color: ColorValue; focused: boolean; badge?: number }) {
  const tint = String(color)
  const size = 22
  const glyph =
    tab === "index" ? <House size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "fixtures" ? <OvalIcon size={size} color={tint} /> :
    tab === "calendar" ? <CalendarDays size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "messages" ? <MessageSquare size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "hub" ? <BookOpen size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
    tab === "clubhouse" ? <MapPin size={size} color={tint} strokeWidth={focused ? 2.4 : 1.9} /> :
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
      <View>
        {glyph}
        {/*
          THE BADGE IS A REAL COUNT OR IT IS NOT THERE. It comes from the same rows the inbox lists,
          so the bar and the list can never disagree, and it is bounded at 9+ because the exact number
          past nine changes nothing a person would do. The spoken label carries the number in words --
          a coloured dot says nothing to a screen reader.
        */}
        {badge > 0 && (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              position: "absolute",
              top: -4,
              right: -8,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: 8,
              backgroundColor: colour.pitch600,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: colour.forest950,
            }}
          >
            <Text style={{ color: colour.onForest, fontSize: 9, fontFamily: type.smallMedium.fontFamily, lineHeight: 11 }}>
              {badge > 9 ? "9+" : String(badge)}
            </Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        // "Clubhouse" is the longest label this bar carries, and on a 320pt-wide iPhone the cell
        // itself is only 64pt -- exactly the width below, no wider, because five cells must fit.
        // Rather than let the fixed size clip it to "Clubhou...", the label is allowed to scale
        // itself down a little (never below 85%, so it never reads as a typo-sized afterthought)
        // before the OS would otherwise truncate it. Every shorter label renders at the full size.
        adjustsFontSizeToFit
        minimumFontScale={0.85}
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
