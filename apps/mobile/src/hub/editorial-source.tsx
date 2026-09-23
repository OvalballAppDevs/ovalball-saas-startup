import { Pressable, Text, View } from "react-native"

import { ExternalLink } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"
import { openExternal } from "./routes"
import { formatDate } from "./ui"

/**
 * "Source: … · Retrieved …" for an editorial fact -- a competition's current
 * structure, a team's summary. Restrained on purpose, and never phrased like
 * a regulatory citation: this is where the wording came from, not a law.
 */
export function EditorialSource({ note, url, retrievedOn }: { note: string | null; url: string | null; retrievedOn: string | null }) {
  if (!note && !url) return null
  const label = note ?? "Official source"
  const body = (
    <Text style={[type.small, { color: "rgba(16,21,18,0.6)", flex: 1 }]}>
      <Text style={{ color: url ? colour.forest800 : "rgba(16,21,18,0.7)", fontFamily: "Inter_500Medium", textDecorationLine: url ? "underline" : "none" }}>{label}</Text>
      {retrievedOn ? ` · Retrieved ${formatDate(retrievedOn)}` : ""}
    </Text>
  )
  const shape = { flexDirection: "row" as const, gap: 6, alignItems: "flex-start" as const, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk, paddingHorizontal: space.md, paddingVertical: space.sm + 2 }
  if (!url) {
    return (
      <View style={shape}>
        <ExternalLink size={14} color={colour.inkMuted} style={{ marginTop: 3 }} />
        {body}
      </View>
    )
  }
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Source: ${label}. Opens in your browser`} onPress={() => openExternal(url)} style={({ pressed }) => [shape, { opacity: pressed ? 0.7 : 1 }]}>
      <ExternalLink size={14} color={colour.forest800} style={{ marginTop: 3 }} />
      {body}
    </Pressable>
  )
}
