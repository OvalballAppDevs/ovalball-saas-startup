import { useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  heroActionLabel,
  heroKindLabel,
  sideLabel,
  type ClubAccents,
  type HeroPage,
} from "@ovalball/contracts"

import { ClubBall } from "./club-ball"
import { ChildMark } from "../child-mark"
import { ClubCrest } from "../identity"
import { CalendarDays, ChevronRight, Clock, MapPin, Users } from "../icons"
import { TOUCH_TARGET, colour, onForest, radius, space, type } from "../../design/tokens"

/**
 * WHAT IS NEXT FOR THIS FAMILY — the strongest thing on Parent Home.
 *
 * A HERO, NOT A BILLBOARD. It carries what a parent is planning around -- who,
 * when, where, and whether they still owe an answer -- and then stops, so that the
 * club's announcement beneath it is on the same screen. The old Home led with a
 * greeting and a plain "Next Up" row; this leads with the rugby.
 *
 * SWIPED, NEVER SPUN. The next match and the next session are both worth a page,
 * and a parent reading one must not have it taken away mid-sentence, so nothing
 * auto-rotates. The dots say there is more and the gesture is the ordinary one.
 *
 * EVERY WORD IS CANONICAL. The sides, the crests, the kick-off, the meet time, the
 * ground and the classification all come from `projectParticipantMatch` -- the same
 * projection behind the Calendar's card -- so the hero cannot say a different
 * kick-off from the card two taps away. Training comes from its twin.
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

      {/* ONE DOT PER PAGE, and none at all for a family with one thing on. */}
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
                backgroundColor: i === index ? accents.highlight : onForest.faint,
              }}
            />
          ))}
        </View>
      )}
    </View>
  )
}

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

  /*
    ONE IDENTITY, SAID ONCE. A match is "home side / vs away side / our team". A
    session is "Training / our team". The first version put the team on the title
    line AND on the line beneath it for training, so the card read "Training /
    Under 12 Boys / Under 12 Boys". Each line now carries a different fact.
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
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: accents.heroBase,
        borderWidth: 1,
        borderColor: accents.edge,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      {/* THE GROUND: forest pulled toward the club's own kit colour and kept
          dark, deepening toward the corner the ball sits in. Chalk text reads on
          every point of it by construction -- the projection clamps the tint
          before it could ever lighten past 4.5:1. This replaces a pale-grey
          rectangle that white text could not be read on. */}
      <Svg style={{ position: "absolute", inset: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroGround" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={accents.heroBase} />
            <Stop offset="1" stopColor={accents.heroDeep} />
          </LinearGradient>
          <LinearGradient id="heroGlow" x1="1" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={accents.highlight} stopOpacity="0.22" />
            <Stop offset="0.55" stopColor={accents.highlight} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGround)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)" />
      </Svg>

      {/* THE CLUB'S OWN BALL, whole and composed into the corner rather than
          escaping it -- drawn from their canonical kit colours, never an image. */}
      <View style={{ position: "absolute", right: space.md, bottom: space.md, opacity: 0.92 }}>
        <ClubBall accents={accents} size={124} />
      </View>

      <View style={{ padding: space.lg, gap: space.md }}>
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

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingRight: 96 }}>
          {/* THE CREST ON A PLATE, so it holds its own colours whatever the
              hero's tint is -- a crest drawn straight onto dark forest loses its
              dark quarters. The canonical resolver decides what it is. */}
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
              time; a session STARTS and, where a club has set one, has an arrival
              time. The first version put "KO 18:00 | 18:00" on a training card,
              which is what happens when two presentations share a label as
              carelessly as they share a model. */}
          <Fact icon={<Clock size={15} color={onForest.secondary} />} text={timeLine(page)} />
          {!!(match?.venue ?? training?.venue) && (
            <Fact icon={<MapPin size={15} color={onForest.secondary} />} text={(match?.venue ?? training?.venue)!} />
          )}
        </View>

        {/* WHOSE RUGBY, where a family has more than one child to tell apart. */}
        {!!child && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingRight: 96 }}>
            <ChildMark member={child} size={22} tone="forest" />
            {/* THE ANSWER, ASKED WHERE THE EVENT IS. "Here is your next training --
                tell us if Ava can attend" beats an abstract task somewhere else. */}
            {page.needsAnswer && (
              <View
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: accents.highlight,
                }}
              >
                <Text style={[type.caption, { color: accents.onHighlight, fontFamily: "Inter_600SemiBold" }]}>
                  Availability needed
                </Text>
              </View>
            )}
          </View>
        )}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: 6,
            minHeight: TOUCH_TARGET - 8,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            backgroundColor: accents.highlight,
          }}
        >
          <Text style={[type.smallMedium, { color: accents.onHighlight }]}>{heroActionLabel(page.kind)}</Text>
          <ChevronRight size={16} color={accents.onHighlight} strokeWidth={2.4} />
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

