import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import type { UnreadCounts } from "@ovalball/contracts"

import { Bell, CircleHelp, MessageSquare } from "./icons"
import { projectHeaderUtilities, type HeaderUtility } from "../context/header-projection"
import { TOUCH_TARGET, colour, radius, type } from "../design/tokens"

/**
 * MESSAGES · NOTIFICATIONS · SUPPORT — the persistent utility cluster.
 *
 * THESE ARE UTILITIES, NOT DESTINATIONS, and that is why they are here rather
 * than in the bottom bar. Communication, alerts and help are needed from
 * wherever somebody already is; a product AREA is somewhere you go. Putting
 * Messages in the header makes it available on every screen, which is more
 * available than a tab, not less.
 *
 * The website's own header has carried exactly these three in exactly this order
 * since Support was built -- its component says so: "placed in the same header
 * row as Messages/Notifications … since every authenticated user can reach
 * Support regardless of role." The app is adopting a convention rather than
 * inventing one.
 *
 * THREE INDEPENDENT COUNTS, FROM ONE READ. `public.my_unread_counts()` returns
 * all three in a single round trip, and the split between them is decided in the
 * database from the notification registry's own topic. Nothing here derives one
 * badge from another, sums them, or counts locally: a bell that goes down
 * because somebody read a message is a bell nobody trusts.
 *
 * SUPPORT'S BADGE IS REAL. It is not decoration copied from its neighbours --
 * `my_unread_counts` returns a support figure because the Support product has an
 * unread concept, and the website's own Support control already shows it.
 *
 * COMPACT ON PURPOSE. Three icon actions, each with its own accessible sentence,
 * at the full touch target with the hit area extended beyond the glyph. Three
 * labelled buttons would take the row the context identity needs.
 */
export function HeaderUtilities({ unread }: { unread: UnreadCounts }) {
  const router = useRouter()
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {projectHeaderUtilities(unread).map((utility) => (
        <Utility
          key={utility.key}
          utility={utility}
          icon={ICON[utility.key]}
          onPress={() => router.push(utility.href as never)}
        />
      ))}
    </View>
  )
}

/**
 * The glyph for each, kept beside the projection rather than inside it: a
 * projection decides WHICH utilities exist and what each one says, and an icon is
 * not a fact about unread mail.
 */
const ICON: Record<string, (colourValue: string) => React.ReactNode> = {
  messages: (colourValue) => <MessageSquare size={20} color={colourValue} strokeWidth={1.9} />,
  notifications: (colourValue) => <Bell size={20} color={colourValue} strokeWidth={1.9} />,
  support: (colourValue) => <CircleHelp size={20} color={colourValue} strokeWidth={1.9} />,
}

function Utility({
  utility,
  icon,
  onPress,
}: {
  utility: HeaderUtility
  icon: (colour: string) => React.ReactNode
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={utility.accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: TOUCH_TARGET,
        height: TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        backgroundColor: pressed ? "rgba(16,21,18,0.06)" : "transparent",
      })}
    >
      {icon(colour.ink)}
      {utility.showBadge && <Badge text={utility.badgeText} wide={utility.count > 9} />}
    </Pressable>
  )
}

/**
 * The count itself, not a plain dot.
 *
 * "3" and "12" tell a parent whether to open it now; a dot only says something
 * happened. What it reads is decided by the projection, so that the rule can be
 * asserted without a renderer; this draws the text it is given.
 */
function Badge({ text, wide }: { text: string; wide: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 4,
        right: wide ? 0 : 4,
        minWidth: 17,
        height: 17,
        paddingHorizontal: wide ? 4 : 0,
        borderRadius: 9,
        backgroundColor: colour.pitch600,
        alignItems: "center",
        justifyContent: "center",
        // A ring in the header's own colour, so the badge reads as separate from
        // the glyph beneath it whatever the glyph is doing.
        borderWidth: 2,
        borderColor: colour.chalk,
      }}
    >
      <Text style={[type.caption, { color: colour.onForest, fontSize: 10, lineHeight: 13, fontFamily: "Inter_600SemiBold" }]}>
        {text}
      </Text>
    </View>
  )
}

/** The width the cluster occupies, so the identity area beside it can size itself honestly. */
export const HEADER_UTILITIES_WIDTH = TOUCH_TARGET * 3
