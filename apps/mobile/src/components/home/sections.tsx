import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import type { ClubAccents, ClubNewsCard, ClubNotice, FamilySubscription } from "@ovalball/contracts"

import { ChevronRight, CircleAlert, Megaphone, Receipt } from "../icons"
import { TOUCH_TARGET, colour, onForest, radius, space, type } from "../../design/tokens"

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
          backgroundColor: accents.wash,
          overflow: "hidden",
        }}
      >
        {/* The club's own colour as an edge, and the priority carried in words. */}
        <View style={{ width: 4, backgroundColor: notice.priority === "URGENT" ? colour.danger : accents.primary }} />
        <View style={{ flex: 1, minWidth: 0, padding: space.lg, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Megaphone size={13} color={accents.primary} strokeWidth={2} />
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
        width: 196,
        borderRadius: radius.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: onForest.line,
        backgroundColor: accents.wash,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      {article.heroUrl ? (
        <Image source={{ uri: article.heroUrl }} style={{ width: "100%", height: 104 }} contentFit="cover" transition={140} />
      ) : (
        /* NO STOCK PHOTOGRAPH. A branded surface in the club's own colours is
           honest; a picture of somebody else's rugby on your club's news is not. */
        <View style={{ height: 104, backgroundColor: accents.primary, alignItems: "center", justifyContent: "center" }}>
          <Megaphone size={24} color={accents.onPrimary} strokeWidth={1.8} />
        </View>
      )}
      <View style={{ padding: space.md, gap: 4 }}>
        <Text style={[type.caption, { color: onForest.secondary, letterSpacing: 0.5 }]} numberOfLines={1}>
          {article.categoryLabel.toUpperCase()}
        </Text>
        <Text style={[type.smallMedium, { color: onForest.primary, fontSize: 14 }]} numberOfLines={2}>
          {article.title}
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
          backgroundColor: accents.wash,
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
            backgroundColor: attention ? colour.warningSurface : accents.primary,
          }}
        >
          {attention ? (
            <CircleAlert size={18} color={colour.warning} strokeWidth={2.2} />
          ) : (
            <Receipt size={18} color={accents.onPrimary} strokeWidth={2} />
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
          <Text style={[type.smallMedium, { color: accents.primary }]}>View all</Text>
        </Pressable>
      )}
    </View>
  )
}
