import { Text, View } from "react-native"
import { parseArticleBody, type Inline } from "@ovalball/contracts/club/markup"

import { colour, space, type } from "../../design/tokens"

/**
 * WHAT THE EDITOR IS ABOUT TO PUBLISH -- the club's markup through the one shared parser, drawn as
 * native text. Minimal on purpose: the reading screens own the real renderer; this shows a writer
 * that a heading is a heading and a list is a list before they press Publish. Links are shown as
 * their text (a preview is not a place to leave the app).
 */
function inlineText(nodes: Inline[]): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text
      case "break":
        return "\n"
      case "strong":
        return (
          <Text key={i} style={{ fontFamily: "Inter_600SemiBold" }}>
            {inlineText(n.children)}
          </Text>
        )
      case "em":
        return (
          <Text key={i} style={{ fontStyle: "italic" }}>
            {inlineText(n.children)}
          </Text>
        )
      case "link":
        return (
          <Text key={i} style={{ color: colour.forest800, textDecorationLine: "underline" }}>
            {inlineText(n.children)}
          </Text>
        )
    }
  })
}

export function BodyPreview({ body }: { body: string }) {
  const blocks = parseArticleBody(body)
  if (blocks.length === 0) return <Text style={[type.small, { color: colour.inkMuted }]}>Nothing written yet.</Text>
  return (
    <View style={{ gap: space.md }}>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return (
            <Text key={i} accessibilityRole="header" style={[b.level === 2 ? type.title : type.heading, { color: colour.ink }]}>
              {inlineText(b.children)}
            </Text>
          )
        }
        if (b.type === "list") {
          return (
            <View key={i} style={{ gap: 4 }}>
              {b.items.map((item, j) => (
                <View key={j} style={{ flexDirection: "row", gap: space.sm }}>
                  <Text style={[type.body, { color: colour.inkMuted, minWidth: 18 }]}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <Text style={[type.body, { color: colour.ink, flex: 1 }]}>{inlineText(item)}</Text>
                </View>
              ))}
            </View>
          )
        }
        return (
          <Text key={i} style={[type.body, { color: colour.ink }]}>
            {inlineText(b.children)}
          </Text>
        )
      })}
    </View>
  )
}
