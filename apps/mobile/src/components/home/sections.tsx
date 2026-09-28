import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import type { ClubAccents, ClubNewsCard, ClubNotice, FamilySubscription } from "@ovalball/contracts"

import { editorial } from "./editorial"
import { ChevronRight, CircleAlert, Megaphone, Receipt } from "../icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../design/tokens"

/**
 * WHAT THE CLUB HAS SAID, WHAT IS NEW, AND WHETHER THE MEMBERSHIP IS IN ORDER.
 *
 * LIGHT CARDS ON THE CHALK PAGE, the same surfaces the Calendar's sheet is made
 * of: white, a hairline, the product's radius, dark type. The club is present as
 * an ACCENT -- a rule down the left of a notice, a category colour on a story --
 * and the forest is present as ink and icons. Neither is a background here.
 *
 * Every section appears ONLY where the canonical product has something to show.
 * A club with nothing pinned gets no Announcements heading; a club with no
 * published article gets no Latest News; a club that does not collect through
 * Ovalball gets no membership card. A mock-up shows a full screen -- it does not
 * authorise furniture for an empty one.
 */

export function AnnouncementPreview({
  notices,
  accents,
  onOpen,
  onViewAll,
  showClub = false,
}: {
  notices: ClubNotice[]
  accents: ClubAccents
  /** True when the notices were heard from more than one club (a family), so each says whose it is. */
  showClub?: boolean
  /** Opens the notice natively. The preview is a button, not a summary you have to go elsewhere to read. */
  onOpen?: (notice: ClubNotice) => void
  onViewAll?: () => void
}) {
  const notice = notices[0]
  if (!notice) return null
  const rule = notice.priority === "URGENT" ? colour.danger : accents.highlightOnLight

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeading title="Announcements" onAction={notices.length > 1 ? onViewAll : undefined} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notice.priorityLabel} announcement${notice.teamName ? ` for ${notice.teamName}` : ""}. ${notice.title}`}
        onPress={onOpen ? () => onOpen(notice) : undefined}
        style={({ pressed }) => [card, { flexDirection: "row", overflow: "hidden", opacity: pressed ? 0.94 : 1 }]}
      >
        {/* The club's own colour as a narrow rule; the priority carried in words. */}
        <View style={{ width: 4, backgroundColor: rule }} />
        <View style={{ flex: 1, minWidth: 0, padding: space.lg, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Megaphone size={13} color={rule} strokeWidth={2} />
            <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.6 }]} numberOfLines={1}>
              {notice.priorityLabel.toUpperCase()}
              {showClub ? ` · ${notice.clubName.toUpperCase()}` : ""}
              {notice.teamName ? ` · ${notice.teamName.toUpperCase()}` : ""}
            </Text>
          </View>
          <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 16 }]} numberOfLines={2}>
            {notice.title}
          </Text>
          <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={2}>
            {notice.body}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

export function NewsRail({
  news,
  accents,
  onOpen,
  onViewAll,
}: {
  news: ClubNewsCard[]
  accents: ClubAccents
  onOpen: (article: ClubNewsCard) => void
  onViewAll?: () => void
}) {
  if (news.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      <SectionHeading title="Latest News" onAction={news.length > 1 ? onViewAll : undefined} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}>
        {news.map((article) => (
          <NewsCard key={article.id} article={article} accents={accents} onPress={() => onOpen(article)} />
        ))}
      </ScrollView>
    </View>
  )
}

/**
 * An editorial card: the picture, then the words.
 *
 * THE PICTURE IS THE ARTICLE'S OWN where it has one. Where it does not, one of
 * four app-owned editorial photographs stands in, chosen by the story's category
 * -- rugby union, no text, no crest, no person as a subject. It is a designed
 * fallback, never a fake news photograph and never a picture that has "failed to
 * load".
 */
function NewsCard({ article, accents, onPress }: { article: ClubNewsCard; accents: ClubAccents; onPress: () => void }) {
  const fallback = fallbackFor(article.categoryLabel)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${article.categoryLabel}. ${article.title}`}
      onPress={onPress}
      style={({ pressed }) => [card, { width: 188, overflow: "hidden", opacity: pressed ? 0.94 : 1 }]}
    >
      <View style={{ height: 112, backgroundColor: colour.forest900 }}>
        {article.heroUrl ? (
          <Image source={{ uri: article.heroUrl }} style={{ width: "100%", height: 112 }} contentFit="cover" transition={140} />
        ) : fallback ? (
          <Image source={fallback} style={{ width: "100%", height: 112 }} contentFit="cover" accessible={false} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Megaphone size={22} color={colour.onForestMuted} strokeWidth={1.8} />
          </View>
        )}
      </View>
      <View style={{ padding: space.md, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accents.highlightOnLight }} />
          <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.5, flexShrink: 1 }]} numberOfLines={1}>
            {article.categoryLabel.toUpperCase()} · {relativeDay(article.publishedAt)}
          </Text>
        </View>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>
          {article.title}
        </Text>
      </View>
    </Pressable>
  )
}

/** Exported so Club Admin Home's own News & Announcements rail falls back to the same photography by
 * category, rather than a second fallback rule invented for one more screen. */
export function fallbackFor(categoryLabel: string) {
  const c = categoryLabel.toLowerCase()
  if (/match|fixture|result/.test(c)) return editorial.news.matchday
  if (/train/.test(c)) return editorial.news.training
  if (/club|community|social|event/.test(c)) return editorial.news.community
  return editorial.news.general
}

/**
 * THE FAMILY'S MEMBERSHIP, from the one payment domain.
 *
 * A white card; the STATE carries the only colour -- green healthy, amber to act
 * on, red a genuine problem -- as a small chip and an icon disc, never the card.
 * The words are the provider's own; only a genuine absence or failure is drawn
 * as something to do.
 */
export function SubscriptionStatusCard({ subscription, onPress }: { subscription: FamilySubscription; accents: ClubAccents; onPress: () => void }) {
  const tone =
    subscription.attention === "failed"
      ? { chip: colour.dangerSurface, ink: colour.danger, label: "Action required" }
      : subscription.attention === "setup_required"
        ? { chip: colour.warningSurface, ink: colour.warning, label: "Setup required" }
        : { chip: colour.successSurface, ink: colour.forest800, label: subscription.statusLabel ?? "Set up" }

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeading title="Subscription" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${subscription.programmeName} for ${subscription.playerName}. ${tone.label}.${subscription.detail ? ` ${subscription.detail}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => [card, { minHeight: TOUCH_TARGET + 18, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, opacity: pressed ? 0.94 : 1 }]}
      >
        <View accessible={false} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: tone.chip }}>
          {subscription.attention === "none" ? <Receipt size={18} color={tone.ink} strokeWidth={2} /> : <CircleAlert size={18} color={tone.ink} strokeWidth={2.2} />}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15, flexShrink: 1 }]} numberOfLines={1}>
              {subscription.programmeName}
            </Text>
            <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone.chip }}>
              <Text style={[type.caption, { color: tone.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                {tone.label}
              </Text>
            </View>
          </View>
          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
            {subscription.detail ?? subscription.playerName}
          </Text>
        </View>
        <ChevronRight size={18} color={colour.inkSubtle} />
      </Pressable>
    </View>
  )
}

const card = {
  marginHorizontal: space.lg,
  borderRadius: radius.lg,
  backgroundColor: surface.card,
  borderWidth: 1,
  borderColor: colour.line,
} as const

function SectionHeading({ title, onAction }: { title: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.title, { color: colour.ink, fontSize: 19 }]}>
        {title}
      </Text>
      {!!onAction && (
        <Pressable accessibilityRole="button" accessibilityLabel={`View all ${title.toLowerCase()}`} onPress={onAction} hitSlop={8}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>View all</Text>
        </Pressable>
      )}
    </View>
  )
}

/** "Today", "Yesterday", "3 days ago" -- the only date a news card needs. */
function relativeDay(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`
}
