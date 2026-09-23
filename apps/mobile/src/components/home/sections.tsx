import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import type { ClubAccents, ClubNewsCard, ClubNotice, FamilySubscription } from "@ovalball/contracts"

import { ChevronRight, CircleAlert, Megaphone, Receipt } from "../icons"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../../design/tokens"

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

/**
 * WHAT THE CLUB HAS SAID, WHAT IS NEW, AND WHETHER THE MEMBERSHIP IS IN ORDER.
 *
 * The three things beneath the hero, and every one of them appears ONLY where the
 * canonical product has something to show. A club with nothing pinned gets no
 * Announcements heading; a club with no published article gets no Latest News; a
 * club that does not collect subscriptions through Ovalball gets no membership
 * card. A mock-up shows what a full screen looks like -- it does not authorise
 * furniture for an empty one.
 */

/**
 * ONE ANNOUNCEMENT, NOT THREE.
 *
 * `club_announcements`, read through the canonical `listLiveClubNotices` and
 * scoped by the table's own SELECT policies -- published, inside its window, and
 * visible to this viewer. The audience is the database's; nothing is fetched
 * broadly and filtered here.
 */
export function AnnouncementPreview({
  notices,
  accents,
  onViewAll,
}: {
  notices: ClubNotice[]
  accents: ClubAccents
  onViewAll?: () => void
}) {
  const notice = notices[0]
  if (!notice) return null

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeading title="Announcements" accents={accents} onAction={notices.length > 1 ? onViewAll : undefined} />
      <View
        style={{
          marginHorizontal: space.lg,
          flexDirection: "row",
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: onForest.line,
          // A DARK ELEVATED SURFACE, one step up from the page, with chalk text.
          // The first version painted this the lifted kit colour -- pale grey --
          // and then wrote white on it. The club is present as the edge and the
          // icon, which is all a notice needs of it.
          backgroundColor: surface.forestRaised,
          overflow: "hidden",
        }}
      >
        <View style={{ width: 4, backgroundColor: notice.priority === "URGENT" ? colour.danger : accents.highlight }} />
        <View style={{ flex: 1, minWidth: 0, padding: space.lg, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Megaphone size={13} color={accents.highlight} strokeWidth={2} />
            <Text style={[type.caption, { color: onForest.secondary, letterSpacing: 0.6 }]} numberOfLines={1}>
              {notice.priorityLabel.toUpperCase()}
              {notice.teamName ? ` · ${notice.teamName.toUpperCase()}` : ""}
            </Text>
          </View>
          <Text style={[type.bodyMedium, { color: onForest.primary, fontSize: 16 }]} numberOfLines={2}>
            {notice.title}
          </Text>
          <Text style={[type.small, { color: onForest.secondary }]} numberOfLines={2}>
            {notice.body}
          </Text>
        </View>
      </View>
    </View>
  )
}

/**
 * LATEST NEWS — the club's own published articles, and nothing invented.
 *
 * `club_articles` through `listClubNews`. An article with no picture gets a
 * branded surface in the club's colours rather than a stock photograph of
 * somebody else's rugby.
 */
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
      <SectionHeading title="Latest News" accents={accents} onAction={news.length > 1 ? onViewAll : undefined} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
      >
        {news.map((article) => (
          <NewsCard key={article.id} article={article} accents={accents} onPress={() => onOpen(article)} />
        ))}
      </ScrollView>
    </View>
  )
}

function NewsCard({
  article,
  accents,
  onPress,
}: {
  article: ClubNewsCard
  accents: ClubAccents
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${article.categoryLabel}. ${article.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 176,
        borderRadius: radius.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: onForest.line,
        backgroundColor: surface.forestRaised,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      {article.heroUrl ? (
        <Image source={{ uri: article.heroUrl }} style={{ width: "100%", height: 96 }} contentFit="cover" transition={140} />
      ) : (
        /* NO STOCK PHOTOGRAPH, AND NO "IMAGE FAILED TO LOAD" EITHER. The first
           fallback was a flat grey block with a megaphone in it, which looked like
           a picture that had not arrived. This is designed: the club's dark tint,
           two bars of their colours cut across the corner, and the category. */
        <View style={{ height: 96, backgroundColor: accents.heroDeep, overflow: "hidden", justifyContent: "flex-end", padding: space.md }}>
          <View style={{ position: "absolute", right: -30, top: -10, width: 22, height: 150, backgroundColor: accents.highlight, transform: [{ rotate: "28deg" }], opacity: 0.9 }} />
          <View style={{ position: "absolute", right: 6, top: -10, width: 10, height: 150, backgroundColor: accents.primary, transform: [{ rotate: "28deg" }], opacity: 0.55 }} />
          <Text style={[type.caption, { color: onForest.secondary, letterSpacing: 0.8 }]} numberOfLines={1}>
            {article.categoryLabel.toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ padding: space.md, gap: 4 }}>
        {!!article.heroUrl && (
          <Text style={[type.caption, { color: onForest.secondary, letterSpacing: 0.5 }]} numberOfLines={1}>
            {article.categoryLabel.toUpperCase()}
          </Text>
        )}
        <Text style={[type.smallMedium, { color: onForest.primary, fontSize: 14 }]} numberOfLines={2}>
          {article.title}
        </Text>
        <Text style={[type.caption, { color: onForest.faint }]} numberOfLines={1}>
          {relativeDay(article.publishedAt)}
        </Text>
      </View>
    </Pressable>
  )
}

/**
 * THE FAMILY'S MEMBERSHIP, from the one payment domain.
 *
 * `get_enrolment_eligibility` and the GoCardless records behind it -- the same ones
 * the parent's own subscription page reads on the website, reconciled by the same
 * webhooks. There is no local status here and nothing to synchronise.
 *
 * A PROVIDER PROCESSING STATE IS NOT A TASK. "Submitted to your bank" is
 * GoCardless doing its job; only a genuine absence or a genuine failure is drawn
 * as something to act on.
 */
export function SubscriptionStatusCard({
  subscription,
  accents,
  onPress,
}: {
  subscription: FamilySubscription
  accents: ClubAccents
  onPress: () => void
}) {
  const attention = subscription.attention !== "none"
  const statusText = attention
    ? subscription.attention === "failed"
      ? "Action required"
      : "Setup required"
    : (subscription.statusLabel ?? "Set up")

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeading title="Subscription" accents={accents} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${subscription.programmeName} for ${subscription.playerName}. ${statusText}.${subscription.detail ? ` ${subscription.detail}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => ({
          marginHorizontal: space.lg,
          minHeight: TOUCH_TARGET + 18,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: attention ? colour.warning : onForest.line,
          backgroundColor: surface.forestRaised,
          opacity: pressed ? 0.94 : 1,
        })}
      >
        <View
          accessible={false}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: attention ? colour.warningSurface : accents.highlight,
          }}
        >
          {attention ? (
            <CircleAlert size={18} color={colour.warning} strokeWidth={2.2} />
          ) : (
            <Receipt size={18} color={accents.onHighlight} strokeWidth={2} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: onForest.primary, fontSize: 15 }]} numberOfLines={1}>
            {subscription.programmeName}
          </Text>
          <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={2}>
            {subscription.detail ?? `${subscription.playerName} · ${statusText}`}
          </Text>
        </View>
        <ChevronRight size={18} color={onForest.secondary} />
      </Pressable>
    </View>
  )
}

function SectionHeading({
  title,
  accents,
  onAction,
}: {
  title: string
  accents: ClubAccents
  onAction?: () => void
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: space.lg,
        gap: space.sm,
      }}
    >
      <Text accessibilityRole="header" style={[type.title, { color: onForest.primary, fontSize: 19 }]}>
        {title}
      </Text>
      {!!onAction && (
        <Pressable accessibilityRole="button" accessibilityLabel={`View all ${title.toLowerCase()}`} onPress={onAction} hitSlop={8}>
          <Text style={[type.smallMedium, { color: accents.highlight }]}>View all</Text>
        </Pressable>
      )}
    </View>
  )
}
