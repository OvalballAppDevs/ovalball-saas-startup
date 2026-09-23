import { useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  heroActionLabel,
  heroKindLabel,
  sideLabel,
  type ClubAccents,
  type HeroPage,
} from "@ovalball/contracts"

import { editorial } from "./editorial"
import { ChildMark } from "../child-mark"
import { ClubCrest } from "../identity"
import { CalendarDays, ChevronRight, Clock, MapPin, Users } from "../icons"
import { TOUCH_TARGET, colour, onForest, radius, space, type } from "../../design/tokens"

/**
 * WHAT IS NEXT FOR THIS FAMILY — the one dark feature on a light Home.
 *
 * THE FOREST IS A FEATURE HERE, NOT THE PAGE. Home is chalk, its cards are white,
 * and this is the single place the brand ground appears: the same shape the
 * Calendar makes with its forest plate above a white sheet, so the two screens
 * read as one product. Everything else on Home is quiet so that this can be loud.
 *
 * A PHOTOGRAPH, NOT A DRAWING. The ground is an editorial photograph of rugby
 * union -- posts, a pitch, an evening -- owned by the app and bundled with it,
 * chosen once per kind of event. It carries no words, no crest and no face, so
 * nothing in it can contradict the canonical facts laid over it: the sides, the
 * crest, the kick-off and the ground all come from the same projection as the
 * Calendar's card. A card that has no artwork yet (a kind not yet approved) gets
 * the club-tinted forest instead of a broken picture.
 *
 * THE OVERLAY IS CONTROLLED, not a mood. It darkens toward the bottom, where the
 * words are, and lifts toward the top, where the picture is, and the chalk type
 * reads at every point over it. The club is present as an ACCENT -- the kind
 * chip, the availability chip, the active dot -- never as the ground.
 *
 * SWIPED, NEVER SPUN. The next match and the next session are both worth a page,
 * and a parent reading one must not have it taken away mid-sentence.
 *
 * THE WHOLE CARD IS THE ACTION. One target, one destination, and it names it:
 * "View Match Centre" for a parent, never a fixture console.
 */
export function RugbyHero({
  pages,
  accents,
  crestUrl,
  clubName,
  onOpen,
}: {
  pages: HeroPage[]
  accents: ClubAccents
  crestUrl: string | null
  clubName: string | null
  onOpen: (page: HeroPage) => void
}) {
  const { width } = useWindowDimensions()
  const [index, setIndex] = useState(0)
  const cardWidth = width - space.lg * 2
  const scroller = useRef<ScrollView>(null)

  if (pages.length === 0) return null

  return (
    <View style={{ gap: space.sm }}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + space.md}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        onMomentumScrollEnd={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / (cardWidth + space.md)))
        }
      >
        {pages.map((page) => (
          <HeroCard
            key={page.key}
            page={page}
            accents={accents}
            crestUrl={crestUrl}
            clubName={clubName}
            width={cardWidth}
            onPress={() => onOpen(page)}
          />
        ))}
      </ScrollView>

      {/* ONE DOT PER PAGE, and none at all for a family with one thing on. On the
          chalk page the resting dots are ink, and the active one is the club. */}
      {pages.length > 1 && (
        <View
          accessible
          accessibilityLabel={`Page ${index + 1} of ${pages.length}`}
          style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}
        >
          {pages.map((page, i) => (
            <View
              key={page.key}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? accents.highlightOnLight : colour.inkSubtle,
                opacity: i === index ? 1 : 0.4,
              }}
            />
          ))}
        </View>
      )}
    </View>
  )
}

/**
 * THE HERO STANDS THIS TALL so the photograph keeps its subject. The artwork is
 * 3:4 and the card is nearly square: at 348 the cover crop threw away a quarter
 * of the picture, and the gear or the scrum that makes it a training or a match
 * picture sat in that quarter. Taller, centred, it keeps both the sky the chips
 * sit on and the subject the words sit over.
 */
export const HERO_HEIGHT = 396

function HeroCard({
  page,
  accents,
  crestUrl,
  clubName,
  width,
  onPress,
}: {
  page: HeroPage
  accents: ClubAccents
  crestUrl: string | null
  clubName: string | null
  width: number
  onPress: () => void
}) {
  const match = page.match
  const training = page.training
  const child = match?.child ?? training?.child ?? null
  const artwork = page.kind === "match" ? editorial.heroMatch : editorial.heroTraining

  /*
    ONE IDENTITY, SAID ONCE. A match is "home side / vs away side / our team". A
    session is "Training / our team". Each line carries a different fact.
  */
  const title = match ? sideLabel(match.home) : "Training"
  const subtitle = match ? `vs ${sideLabel(match.away)}` : null
  const teamLine = match ? (match.home?.isOurs ? match.home.teamName : match.away?.teamName) : training?.teamName

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${heroKindLabel(page.kind)}. ${match?.spoken ?? training?.spoken ?? ""}`}
      accessibilityHint={heroActionLabel(page.kind)}
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        height: HERO_HEIGHT,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: accents.heroBase,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      {/* THE ARTWORK, decorative by declaration: the words over it say
          everything a screen reader needs, and the picture says nothing that
          could be wrong. Cropped from the centre so the subject survives. */}
      {artwork ? (
        <Image
          source={artwork}
          accessible={false}
          contentFit="cover"
          contentPosition="center"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : (
        <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
          <Defs>
            <LinearGradient id="heroGround" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={accents.heroBase} />
              <Stop offset="1" stopColor={accents.heroDeep} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGround)" />
        </Svg>
      )}

      {/* THE OVERLAY. A transparent forest that thins where the picture lives
          and deepens where the words do; the club's accent breathes in at the
          foot, faintly, so the card is the club's without being painted in it. */}
      <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.42" />
            <Stop offset="0.38" stopColor={colour.forest950} stopOpacity="0.18" />
            <Stop offset="0.62" stopColor={colour.forest950} stopOpacity="0.62" />
            <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.94" />
          </LinearGradient>
          <LinearGradient id="heroAccent" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={accents.highlight} stopOpacity="0.16" />
            <Stop offset="0.3" stopColor={accents.highlight} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroShade)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroAccent)" />
      </Svg>

      <View style={{ flex: 1, padding: space.lg, justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: space.md,
              paddingVertical: 5,
              borderRadius: radius.pill,
              backgroundColor: accents.highlight,
            }}
          >
            {page.kind === "training" ? (
              <Users size={12} color={accents.onHighlight} strokeWidth={2.4} />
            ) : (
              <CalendarDays size={12} color={accents.onHighlight} strokeWidth={2.4} />
            )}
            <Text style={[type.caption, { color: accents.onHighlight, fontSize: 10, letterSpacing: 0.8 }]}>
              {heroKindLabel(page.kind)}
            </Text>
          </View>

          {/* THE CANONICAL MATCH TYPE, from `fixtures.game_type`. Absent where
              nothing is recorded, because a fixture with none is not "Friendly". */}
          {!!match?.matchType && (
            <View
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 5,
                borderRadius: radius.pill,
                backgroundColor: "rgba(7,28,20,0.45)",
                borderWidth: 1,
                borderColor: onForest.line,
              }}
            >
              <Text numberOfLines={1} style={[type.caption, { color: onForest.primary }]}>
                {match.matchType}
              </Text>
            </View>
          )}
        </View>

        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            {/* THE CREST ON A PLATE, so it holds its own colours whatever the
                photograph beneath it is doing. The canonical resolver decides
                what it is. */}
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: colour.chalk,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ClubCrest clubName={clubName} url={crestUrl} size={40} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={2} style={[type.title, { color: onForest.primary, fontSize: 22, lineHeight: 26 }]}>
                {title}
              </Text>
              {!!subtitle && (
                <Text numberOfLines={2} style={[type.bodyMedium, { color: onForest.primary, fontSize: 15 }]}>
                  {subtitle}
                </Text>
              )}
              {!!teamLine && (
                <Text numberOfLines={1} style={[type.small, { color: onForest.secondary }]}>
                  {teamLine}
                </Text>
              )}
            </View>
          </View>

          <View style={{ gap: space.xs }}>
            <Fact icon={<CalendarDays size={15} color={onForest.secondary} />} text={longDate(page.item.date)} />
            {/* THE SAME TRUTH, THE RIGHT WORDS. A match KICKS OFF and has a MEET
                time; a session STARTS and, where a club has set one, has an
                arrival time. */}
            <Fact icon={<Clock size={15} color={onForest.secondary} />} text={timeLine(page)} />
            {!!(match?.venue ?? training?.venue) && (
              <Fact icon={<MapPin size={15} color={onForest.secondary} />} text={(match?.venue ?? training?.venue)!} />
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            {/* WHOSE RUGBY, where a family has more than one child to tell
                apart -- and the answer asked where the event is. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 }}>
              {!!child && <ChildMark member={child} size={22} tone="forest" />}
              {page.needsAnswer && (
                <View
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    backgroundColor: accents.highlight,
                  }}
                >
                  <Text numberOfLines={1} style={[type.caption, { color: accents.onHighlight, fontFamily: "Inter_600SemiBold" }]}>
                    Availability needed
                  </Text>
                </View>
              )}
            </View>

            {/* THE CALL TO ACTION, refined: a chalk pill with forest ink, which
                reads on every club's photograph and every club's tint. The
                club's colour is spent on the chips above it, not on a large
                painted button. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                minHeight: TOUCH_TARGET - 10,
                paddingLeft: space.lg,
                paddingRight: space.md,
                borderRadius: radius.pill,
                backgroundColor: colour.chalk,
              }}
            >
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.forest800 }]}>
                {heroActionLabel(page.kind)}
              </Text>
              <ChevronRight size={16} color={colour.forest800} strokeWidth={2.4} />
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {icon}
      <Text numberOfLines={1} style={[type.small, { color: onForest.primary, flex: 1 }]}>
        {text}
      </Text>
    </View>
  )
}

/**
 * KO and Meet for a match; Starts / a window and Arrive for a session. Training
 * does not kick off, and a card that says it does is describing the wrong thing.
 */
function timeLine(page: HeroPage): string {
  const start = page.item.time ? page.item.time.slice(0, 5) : null
  if (page.kind === "match") {
    return [start ? `KO ${start}` : null, page.item.meetTime ? `Meet ${page.item.meetTime.slice(0, 5)}` : null]
      .filter(Boolean)
      .join("  ·  ") || "Kick-off to be confirmed"
  }
  if (page.training?.window) return page.training.window
  return start ? `Starts ${start}` : "Time to be confirmed"
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]

/** "Friday 2 October 2026" — read at midday so no timezone moves the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  return `${DAYS[at.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`
}
