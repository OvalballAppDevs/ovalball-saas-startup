import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import { parseArticleBody, type Inline } from "@ovalball/contracts/club/markup"

import { openContentLink } from "./links"
import { colour, font, space } from "../design/tokens"

/**
 * THE ONE NATIVE ARTICLE RENDERER.
 *
 * The website renders an article through components/club-home/article-body.tsx from the tree that
 * packages/contracts/src/club/markup.ts parses; this is the same tree drawn with React Native text.
 * Nothing a club typed is ever interpreted as markup by anything but that parser -- no HTML, no
 * WebView, no sanitiser to keep current. Headings, paragraphs, lists, bold, italic, line breaks and
 * links are the whole vocabulary, exactly as on the web.
 *
 * READABLE AT LENGTH. Body text is Inter at 17 on 27, headings step down from the screen title, and
 * nothing here fixes a height, so Dynamic Type scales the column rather than clipping it.
 */
const BODY = { fontFamily: font.body, fontSize: 17, lineHeight: 27, color: colour.ink } as const
const H2 = { fontFamily: font.bodySemi, fontSize: 22, lineHeight: 28, color: colour.ink } as const
const H3 = { fontFamily: font.bodySemi, fontSize: 18, lineHeight: 24, color: colour.ink } as const

function Inlines({ nodes, bold = false }: { nodes: Inline[]; bold?: boolean }) {
  const router = useRouter()
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Text key={i}>{n.text}</Text>
          case "break":
            return <Text key={i}>{"\n"}</Text>
          case "strong":
            return (
              <Text key={i} style={{ fontFamily: font.bodySemi }}>
                <Inlines nodes={n.children} bold />
              </Text>
            )
          case "em":
            return (
              <Text key={i} style={{ fontStyle: "italic" }}>
                <Inlines nodes={n.children} bold={bold} />
              </Text>
            )
          case "link":
            return (
              <Text
                key={i}
                accessibilityRole="link"
                accessibilityHint={n.external ? "Opens in your browser" : "Opens in Ovalball"}
                onPress={() => openContentLink(router, n.href, n.external)}
                style={{ color: colour.rugby700, textDecorationLine: "underline", fontFamily: bold ? font.bodySemi : font.bodyMedium }}
              >
                <Inlines nodes={n.children} bold={bold} />
              </Text>
            )
        }
      })}
    </>
  )
}

export function ArticleBody({ body }: { body: string }) {
  const blocks = parseArticleBody(body)
  return (
    <View style={{ gap: space.md }}>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return (
            <Text key={i} accessibilityRole="header" style={[b.level === 2 ? H2 : H3, { marginTop: i === 0 ? 0 : space.sm }]}>
              <Inlines nodes={b.children} bold />
            </Text>
          )
        }
        if (b.type === "list") {
          return (
            <View key={i} style={{ gap: 6, paddingLeft: space.xs }} accessibilityRole="list">
              {b.items.map((item, j) => (
                <View key={j} style={{ flexDirection: "row", gap: space.sm }}>
                  <Text style={[BODY, { width: b.ordered ? 24 : 16, color: colour.rugby700 }]}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <Text style={[BODY, { flex: 1 }]}>
                    <Inlines nodes={item} />
                  </Text>
                </View>
              ))}
            </View>
          )
        }
        return (
          <Text key={i} style={BODY}>
            <Inlines nodes={b.children} />
          </Text>
        )
      })}
    </View>
  )
}
