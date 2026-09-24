import { Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import type { AnnouncementCard, ArticleCard } from "@ovalball/contracts/club/content"

import { relativeTime } from "./links"
import { editorial } from "../components/home/editorial"
import { Megaphone } from "../components/icons"
import { StatusPill } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE TWO CARDS OF NEWS & ANNOUNCEMENTS.
 *
 * An ANNOUNCEMENT is operational information: a compact row with the priority in words, the club or
 * team it concerns, the title, two lines of the notice and when it was posted. The club's colour is a
 * narrow rule down the left -- URGENT alone borrows the danger red for that rule, and even then the
 * word carries the meaning. A NEWS story is editorial: a 16:9 picture (the story's own, or one of the
 * app's four rugby photographs chosen by category -- never a fabricated news image), a headline, a
 * summary and a byline that is always the club, the team or Ovalball, never a person.
 */

export function AnnouncementRow({ item, accent, onPress, first = false, showClub = false }: { item: AnnouncementCard; accent: string; onPress: () => void; first?: boolean; /** A family reading several clubs at once is told whose notice each is. */ showClub?: boolean }) {
  const rule = item.priority === "URGENT" ? colour.danger : accent
  const context = `${showClub ? `${item.clubName} · ` : ""}${item.teamName ?? "Whole club"}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.priorityLabel} announcement for ${context}. ${item.title}. ${relativeTime(item.startsAt)}`}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", minHeight: TOUCH_TARGET + 20, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <View style={{ width: 4, backgroundColor: rule }} />
      <View style={{ flex: 1, minWidth: 0, paddingVertical: space.md, paddingHorizontal: space.lg, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          <Megaphone size={13} color={rule} strokeWidth={2} />
          <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.6, flexShrink: 1 }]} numberOfLines={1}>
            {item.priorityLabel.toUpperCase()} · {context.toUpperCase()}
          </Text>
          {item.membersOnly && <StatusPill label="Members" tone="neutral" />}
        </View>
        <Text style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={2}>
          {item.title}
        </Text>
        {!!item.body && (
          <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={2}>
            {item.body}
          </Text>
        )}
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{relativeTime(item.startsAt)}</Text>
      </View>
    </Pressable>
  )
}

export function fallbackImageFor(categoryLabel: string) {
  const c = categoryLabel.toLowerCase()
  if (/match|fixture|result/.test(c)) return editorial.news.matchday
  if (/train/.test(c)) return editorial.news.training
  if (/club|community|social|event/.test(c)) return editorial.news.community
  return editorial.news.general
}

/** A 16:9 picture: the story's own with its alt text, or the app-owned editorial fallback (decorative). */
export function HeroImage({ item, radiusTop = true }: { item: Pick<ArticleCard, "heroUrl" | "heroAlt" | "categoryLabel" | "title">; radiusTop?: boolean }) {
  const fallback = fallbackImageFor(item.categoryLabel)
  const shape = { width: "100%" as const, aspectRatio: 16 / 9, backgroundColor: colour.forest900, borderTopLeftRadius: radiusTop ? radius.lg : 0, borderTopRightRadius: radiusTop ? radius.lg : 0, overflow: "hidden" as const }
  if (item.heroUrl) {
    return <Image source={{ uri: item.heroUrl }} style={shape} contentFit="cover" transition={140} accessible accessibilityLabel={item.heroAlt || item.title} />
  }
  if (fallback) return <Image source={fallback} style={shape} contentFit="cover" accessible={false} />
  return (
    <View style={[shape, { alignItems: "center", justifyContent: "center" }]}>
      <Megaphone size={26} color={colour.onForestMuted} strokeWidth={1.8} />
    </View>
  )
}

export function NewsCard({ item, accent, onPress }: { item: ArticleCard; accent: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.categoryLabel}. ${item.title}. ${item.byline}, ${relativeTime(item.publishedAt)}`}
      onPress={onPress}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden", opacity: pressed ? 0.94 : 1 })}
    >
      <HeroImage item={item} />
      <View style={{ padding: space.lg, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
          <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.5, flexShrink: 1 }]} numberOfLines={1}>
            {item.categoryLabel.toUpperCase()} · {relativeTime(item.publishedAt)}
          </Text>
          {item.membersOnly && <StatusPill label="Members" tone="neutral" />}
        </View>
        <Text style={[type.title, { color: colour.ink, fontSize: 18, lineHeight: 24 }]} numberOfLines={3}>
          {item.title}
        </Text>
        {!!item.excerpt && (
          <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={3}>
            {item.excerpt}
          </Text>
        )}
        <Text style={[type.caption, { color: colour.inkSubtle }]}>
          {item.byline} · {item.readingMinutes} min read
        </Text>
      </View>
    </Pressable>
  )
}
