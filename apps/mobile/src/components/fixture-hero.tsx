import { useEffect, useRef } from "react"
import { Animated, Easing, Pressable, Text, View } from "react-native"

import { ClubCrest } from "./identity"
import { ChevronDown } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE FIXTURE, AS A FIXTURE.
 *
 * HOME ON THE LEFT, AWAY ON THE RIGHT, AND A V BETWEEN THEM. That is how a fixture is written on every
 * programme, every league table and every whiteboard in every clubhouse, and it carries the
 * orientation without a word: a manager reading "Preston Grasshoppers v Ovalball UAT" knows who is
 * travelling because of where the names are. The previous header put our side first whatever the
 * answer and then had to explain itself with a letter in a circle.
 *
 * SO THE LAYOUT IS THE INFORMATION. `homeAway` decides which side of the V each club sits on, and the
 * word underneath -- HOME or AWAY -- says which one is OURS, because from the left-hand position alone
 * you cannot tell whose fixture you are looking at. Two signals for one fact, neither of them colour.
 *
 * INTERACTIVE WHERE IT IS AUTHORISED. Tapping it opens the home/away editor, which is a real decision
 * with real consequences -- the venue and the pitch belong to whichever club is at home, so the
 * platform clears them, and the opposing club is notified. The control says so before it is used.
 *
 * THE SWAP IS ANIMATED, and only when the value actually changes. The two crests cross over, which
 * makes a change that is otherwise two words moving feel like something happened -- and which tells
 * somebody who tapped by accident exactly what they have just done.
 */
export function FixtureHero({
  us,
  them,
  homeAway,
  onOvalball,
  result,
  editable,
  onEdit,
}: {
  us: { clubName: string; teamName: string | null; crestUrl: string | null }
  them: { clubName: string; teamName: string | null; crestUrl: string | null }
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  onOvalball: boolean
  result: { ourScore: number; theirScore: number } | null
  editable: boolean
  onEdit: () => void
}) {
  const weAreHome = homeAway !== "Away"
  const home = weAreHome ? us : them
  const away = weAreHome ? them : us
  const homeScore = result ? (weAreHome ? result.ourScore : result.theirScore) : null
  const awayScore = result ? (weAreHome ? result.theirScore : result.ourScore) : null

  // THE CROSSOVER, driven by which side we are on. It runs on a change rather than on mount, so opening
  // the console is still. `useNativeDriver` keeps it on the UI thread: a 250ms animation that stutters
  // is worse than none.
  const swap = useRef(new Animated.Value(weAreHome ? 0 : 1)).current
  const first = useRef(true)
  useEffect(() => {
    const target = weAreHome ? 0 : 1
    if (first.current) {
      first.current = false
      swap.setValue(target)
      return
    }
    Animated.timing(swap, { toValue: target, duration: 260, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start()
  }, [weAreHome, swap])

  const lift = swap.interpolate({ inputRange: [0, 1], outputRange: [0, -6] })

  const body = (
    <View
      style={{
        backgroundColor: colour.forest800,
        borderRadius: radius.lg,
        paddingVertical: space.lg,
        paddingHorizontal: space.md,
        gap: space.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <Side club={home} score={homeScore} isUs={weAreHome} lift={lift} />

        <View style={{ alignItems: "center", paddingTop: 14, gap: 2 }}>
          <Text style={[type.display, { color: colour.onForestMuted, fontSize: 26, lineHeight: 28 }]}>V</Text>
        </View>

        <Side club={away} score={awayScore} isUs={!weAreHome} lift={lift} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, flexWrap: "wrap" }}>
        {/* WHICH ONE IS US, said in words. The position carries home and away; this carries whose
            fixture it is, and the two together mean nobody has to decode anything. */}
        <Tag
          label={homeAway === "Home" ? "WE'RE AT HOME" : homeAway === "Away" ? "WE'RE AWAY" : homeAway === "TBD" ? "VENUE NOT AGREED" : "NEUTRAL"}
          strong
        />
        <Tag label={onOvalball ? "ON OVALBALL" : "NOT ON OVALBALL"} />
        {editable && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Text style={[type.caption, { color: colour.onForestMuted, fontSize: 10 }]}>CHANGE</Text>
            <ChevronDown size={12} color={colour.onForestMuted} strokeWidth={2.4} />
          </View>
        )}
      </View>
    </View>
  )

  if (!editable) {
    return (
      <View
        accessible
        accessibilityLabel={spoken(home, away, us, them, homeAway, result)}
        accessibilityRole="summary"
      >
        {body}
      </View>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${spoken(home, away, us, them, homeAway, result)} Change home or away.`}
      accessibilityHint="Changing this clears the ground and the pitch, and tells the other club"
      onPress={onEdit}
      style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
    >
      {body}
    </Pressable>
  )
}

function Side({
  club,
  score,
  isUs,
  lift,
}: {
  club: { clubName: string; teamName: string | null; crestUrl: string | null }
  score: number | null
  isUs: boolean
  lift: Animated.AnimatedInterpolation<number>
}) {
  return (
    <Animated.View style={{ flex: 1, alignItems: "center", gap: space.sm, transform: [{ translateY: isUs ? lift : 0 }] }}>
      <View>
        <ClubCrest clubName={club.clubName} url={club.crestUrl} size={56} />
        {/* OUR SIDE IS MARKED, quietly. A manager scanning a list of fixtures should not have to read
            two club names to find their own. */}
        {isUs && (
          <View
            style={{
              position: "absolute",
              bottom: -3,
              alignSelf: "center",
              backgroundColor: colour.pitch600,
              borderRadius: radius.pill,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={[type.overline, { color: colour.forest950, fontSize: 8, letterSpacing: 0.6 }]}>US</Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: "center", gap: 1 }}>
        <Text numberOfLines={2} style={[type.smallMedium, { color: colour.onForest, textAlign: "center", fontSize: 13 }]}>
          {club.clubName}
        </Text>
        {!!club.teamName && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.onForestMuted, textAlign: "center", fontSize: 11 }]}>
            {club.teamName}
          </Text>
        )}
      </View>

      {score !== null && (
        <Text style={[type.display, { color: colour.onForest, fontSize: 30, lineHeight: 32 }]}>{score}</Text>
      )}
    </Animated.View>
  )
}

function Tag({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: strong ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.10)",
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
        paddingVertical: 3,
      }}
    >
      <Text style={[type.overline, { color: strong ? colour.onForest : colour.onForestMuted, fontSize: 9, letterSpacing: 0.8 }]}>
        {label}
      </Text>
    </View>
  )
}

/** One sentence, in the order somebody would say it, so the hero makes sense when spoken. */
function spoken(
  home: { clubName: string; teamName: string | null },
  away: { clubName: string; teamName: string | null },
  us: { clubName: string; teamName: string | null },
  them: { clubName: string; teamName: string | null },
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null,
  result: { ourScore: number; theirScore: number } | null
): string {
  const name = (club: { clubName: string; teamName: string | null }) =>
    club.teamName ? `${club.clubName} ${club.teamName}` : club.clubName
  const where =
    homeAway === "Home"
      ? "We are at home."
      : homeAway === "Away"
        ? "We are away."
        : homeAway === "TBD"
          ? "The venue is not agreed."
          : "Neutral ground."
  const score = result ? ` Result: ${name(us)} ${result.ourScore}, ${name(them)} ${result.theirScore}.` : ""
  return `${name(home)} versus ${name(away)}. ${where}${score}`
}
