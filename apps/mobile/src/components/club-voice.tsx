import { Linking, Pressable, Text, View } from "react-native"
import { Image } from "expo-image"

import type { ClubNewsCard, ClubNotice, ClubTheme } from "@ovalball/contracts"

import { BookOpen, ChevronRight, ExternalLink, Megaphone } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHAT THE CLUB HAS SAID.
 *
 * A home screen that shows the week's rugby and nothing the club has told anyone
 * is half a home screen -- the owner's point, and the website's club desk has
 * carried both since the Club Digital Home landed. The two are deliberately
 * different things and are drawn differently:
 *
 *   NOTICES are short, dated and often urgent: a pitch change, a cancelled
 *   session, a subs deadline. They are read at a glance and they expire. They
 *   lead, and an URGENT one leads them, because a club that has said something
 *   important should not have it third.
 *
 *   NEWS is a story the club chose to publish. It keeps its picture and its
 *   byline, and it opens on the club's own page rather than being reproduced
 *   here -- a news reader is its own product and this is a home screen.
 *
 * AN EMPTY SECTION COLLAPSES. Most clubs have nothing pinned most weeks, and the
 * web's own desk made this correction after a club with nothing to say was told
 * so three times in one column. Absence is rendered as absence.
 *
 * NOTHING IS DECIDED HERE. Which notices are live is the shared reader's
 * question -- PUBLISHED, started, unexpired -- and who may see a members-only
 * one is RLS's. This draws what it was handed.
 */

/** Priority is never carried by colour alone: each level has its own WORD, from the canonical vocabulary. */
const PRIORITY_PAINT: Record<ClubNotice["priority"], { edge: string; wash: string; text: string }> = {
  URGENT: { edge: "rgba(193,34,27,0.35)", wash: "#fdf2f2", text: "#8f1a15" },
  IMPORTANT: { edge: "rgba(217,155,10,0.38)", wash: "#fdf6e7", text: "#8a5a00" },
  NORMAL: { edge: colour.line, wash: colour.surface, text: colour.inkMuted },
}

export function ClubNotices({ notices }: { notices: ClubNotice[] }) {
  if (notices.length === 0) return null
  return (
    <View>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>
        CLUB NOTICES
      </Text>
      <View style={{ gap: space.sm }}>
        {notices.map((notice) => {
          const paint = PRIORITY_PAINT[notice.priority]
          const body = (
            <View
              style={{
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: paint.edge,
                backgroundColor: paint.wash,
                padding: space.lg,
                gap: space.xs,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Megaphone size={15} color={paint.text} />
                {/* The priority in WORDS, and only when it is not the ordinary
                    one -- labelling every notice "Normal" is labelling nothing. */}
                {notice.priority !== "NORMAL" && (
                  <Text style={[type.caption, { color: paint.text, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6 }]}>
                    {notice.priorityLabel.toUpperCase()}
                  </Text>
                )}
                {notice.teamName && <Text style={[type.caption, { color: colour.inkMuted }]}>{notice.teamName}</Text>}
              </View>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{notice.title}</Text>
              {!!notice.body && (
                <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={3}>
                  {notice.body}
                </Text>
              )}
              {notice.link && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs }}>
                  <ExternalLink size={13} color={colour.forest800} />
                  <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>{notice.link.label}</Text>
                </View>
              )}
            </View>
          )

          // A notice with a link is pressable; one without is not a button that
          // does nothing when tapped.
          return notice.link ? (
            <Pressable
              key={notice.id}
              accessibilityRole="link"
              accessibilityLabel={`${notice.title}. ${notice.link.label}`}
              onPress={() => void Linking.openURL(notice.link!.href)}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, minHeight: TOUCH_TARGET })}
            >
              {body}
            </Pressable>
          ) : (
            <View key={notice.id}>{body}</View>
          )
        })}
      </View>
    </View>
  )
}

export function ClubNews({
  news,
  theme,
  onOpen,
}: {
  news: ClubNewsCard[]
  /** The club's own colours, so its news looks like its news. */
  theme: ClubTheme
  onOpen: (article: ClubNewsCard) => void
}) {
  if (news.length === 0) return null
  const [lead, ...rest] = news
  return (
    <View>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>
        CLUB NEWS
      </Text>

      {/* THE LEAD KEEPS ITS PICTURE. "Featured" is the club's own editorial
          decision rather than a date, so the story they chose to lead with leads
          -- and a story with a photograph is the one thing on this screen that
          looks like a club rather than like software. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lead.title}. ${lead.byline}`}
        onPress={() => onOpen(lead)}
        style={({ pressed }) => ({
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: colour.surface,
          overflow: "hidden",
          opacity: pressed ? 0.9 : 1,
        })}
      >
        {lead.heroUrl ? (
          <Image source={{ uri: lead.heroUrl }} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" transition={140} />
        ) : (
          // No photograph is a real state, not a gap to fill with a stock image.
          // It gets the club's own colour instead, which is more honest and
          // reads as the club's page rather than as a missing picture.
          <View style={{ width: "100%", aspectRatio: 16 / 5, backgroundColor: theme.hero.background }} />
        )}
        <View style={{ padding: space.lg, gap: space.xs }}>
          <Text style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>{lead.title}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {[lead.byline, publishedDate(lead.publishedAt)].filter(Boolean).join(", ")}
            {lead.membersOnly ? ", members only" : ""}
          </Text>
        </View>
      </Pressable>

      {rest.length > 0 && (
        <View
          style={{
            marginTop: space.sm,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colour.line,
            backgroundColor: colour.surface,
            overflow: "hidden",
          }}
        >
          {rest.map((article, index) => (
            <Pressable
              key={article.id}
              accessibilityRole="button"
              accessibilityLabel={`${article.title}. ${article.byline}`}
              onPress={() => onOpen(article)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.lg,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colour.line,
                backgroundColor: pressed ? colour.chalk : colour.surface,
              })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>
                  {article.title}
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]} numberOfLines={1}>
                  {[article.byline, publishedDate(article.publishedAt)].filter(Boolean).join(", ")}
                </Text>
              </View>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

/** The Rugby Hub band, in the club's own colour -- the same promotion the website's club desk carries. */
export function RugbyHubCard({ theme, onOpen }: { theme: ClubTheme; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Explore the Rugby Hub"
      onPress={onOpen}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.brand.solid,
        backgroundColor: `${theme.brand.solid}14`,
        padding: space.lg,
        gap: space.xs,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <BookOpen size={17} color={theme.brand.ink} />
        <Text style={[type.smallMedium, { color: theme.brand.ink, fontFamily: "Inter_600SemiBold" }]}>Rugby Hub</Text>
      </View>
      <Text style={[type.small, { color: colour.inkMuted }]}>
        The laws, positions and skills of the game, for players, parents, coaches and supporters.
      </Text>
    </Pressable>
  )
}

/** "14 September 2026" -- parsed as a plain instant and formatted in UK English, matching the web's own byline. */
function publishedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d)
}
