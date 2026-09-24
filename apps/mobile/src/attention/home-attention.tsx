import { Linking, Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import type { AttentionItem } from "@ovalball/contracts/attention"

import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { NeedsAttention, type AttentionItem as AttentionRow } from "../components/needs-attention"
import { ChevronRight } from "../components/icons"
import { colour, space, type } from "../design/tokens"
import { routeForAttentionItem } from "./routes"
import { useAttention } from "./use-attention"

const HOME_LIMIT = 3

/**
 * NEEDS ATTENTION ON HOME -- the first few of the shared projection, for the context this person is in.
 *
 * Drawn only when there is something: Home does not announce calm. The rest is one tap away on the
 * Notifications screen, which reads the same projection, so the two can never disagree about what is
 * waiting. A read that fails is silent here -- Home has its own error surface for the rugby, and a
 * failed attention read must not blank a page that otherwise works -- and the Notifications screen
 * says so in full.
 */
export function HomeAttention() {
  const router = useRouter()
  const { active } = useAppContexts()
  const { read } = useAttention()
  if (!read || read.coverage !== "native" || read.items.length === 0) return null

  const open = (item: AttentionItem) => {
    const route = routeForAttentionItem(item, active?.kind ?? null)
    if (route) router.push(route as never)
    else void Linking.openURL(`${webUrl}${item.href}`)
  }

  const rows: AttentionRow[] = read.items.slice(0, HOME_LIMIT).map((item) => ({
    key: item.id,
    label: item.title,
    detail: item.summary,
    urgent: item.priority === "urgent",
    onPress: () => open(item),
  }))
  const more = read.items.length - rows.length

  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
      <NeedsAttention items={rows} />
      {more > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${read.items.length} things that need your attention`}
          onPress={() => router.push("/notifications" as never)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, minHeight: 36, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{`${more} more`}</Text>
          <ChevronRight size={16} color={colour.forest800} />
        </Pressable>
      )}
    </View>
  )
}
