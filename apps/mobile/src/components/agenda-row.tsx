import { Pressable, Text, View } from "react-native"
import type { AgendaItem } from "@ovalball/contracts"

import {
  homeAwayLabel,
  kickoffLabel,
  opponentLine,
  relativeDate,
  shortVenue,
  spokenAgendaItem,
  statusTone,
  type StatusTone,
} from "../agenda/presentation"
import { ClubCrest, PersonAvatar } from "./identity"
import { Clock, MapPin, OvalIcon, Users } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * ONE PIECE OF RUGBY, AS A ROW.
 *
 * THE SAME COMPONENT ON FIXTURES AND ON CALENDAR, on purpose. The two screens ask the agenda different
 * questions -- one about a team's season, one about a week -- but a fixture is the same fixture in
 * both, and drawing it twice is how they would come to disagree about which side is at home.
 *
 * WHAT IT SAYS, IN THE ORDER SOMEBODY ASKS. When, who, home or away, where, and what state it is in.
 * The crest comes from the canonical club-logo rule -- the club's own upload, then the Directory's
 * branding logo, then initials. Never a kit: a kit is what a side wears, not who they are.
 *
 * CANCELLED IS UNMISTAKABLE WITHOUT COLOUR. The opponent line is struck through, the row is dimmed, and
 * the pill says the word. Three signals, of which colour is the last, because somebody reading in
 * sunlight or with a colour vision difference is still entitled to know the match is off.
 *
 * IT IS ONE SPOKEN SENTENCE. VoiceOver reads a card as a label, not as eight fragments, so the whole
 * row carries a single sentence containing the same facts in the order a person would say them.
 */
export function AgendaRow({
  item,
  today,
  onPress,
  /** Shown in a family or club view, where a row needs to say whose rugby it is. */
  showOwner = false,
}: {
  item: AgendaItem
  today: string
  onPress?: () => void
  showOwner?: boolean
}) {
  const status = statusTone(item.status)
  const struck = status?.struck ?? false
  const home = homeAwayLabel(item.homeAway)
  const time = kickoffLabel(item.time)
  const training = item.kind === "training"

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={spokenAgendaItem(item, today)}
      accessibilityHint={onPress ? "Opens the details" : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 20,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: struck ? 0.62 : 1,
      })}
    >
      {/* THE TIME, NOT THE DATE. A row already sits under its own day heading, so repeating the date
          would be saying the same thing twice; the kick-off is the part that differs within a day. */}
      <View style={{ width: 52, alignItems: "flex-start" }}>
        <Text style={[type.smallMedium, { color: struck ? colour.inkMuted : colour.forest800 }]}>
          {time ?? "--:--"}
        </Text>
        {!!item.meetTime && (
          <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10 }]}>meet {item.meetTime}</Text>
        )}
      </View>

      {/* HOME OR AWAY, AS A MARK RATHER THAN A WORD. It decides whether somebody is travelling, which
          makes it one of the first things they need -- and as a word it sat in a line of grey metadata
          competing with the venue and the team name. Green H for home, blue A for away.

          IT IS NOT COLOUR ALONE: the letter carries it in greyscale, and the row's spoken label still
          says "Home" or "Away" in full, because a screen reader should hear the fact rather than a
          description of a badge. TBD and Not Applicable are real states and take a neutral mark rather
          than being quietly rendered as home. */}
      {!training && !!home && <HomeAwayBadge home={home} />}

      {training ? (
        <View
          accessible={false}
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            backgroundColor: colour.mint100,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Users size={19} color={colour.forest800} strokeWidth={1.9} />
        </View>
      ) : (
        <ClubCrest clubName={item.them?.clubName ?? null} url={item.them?.crestUrl ?? null} size={38} />
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={[
            type.bodyMedium,
            {
              color: colour.ink,
              fontSize: 15,
              // THE STRIKE-THROUGH IS THE SIGNAL, and it survives greyscale, sunlight and a screenshot.
              textDecorationLine: struck ? "line-through" : "none",
            },
          ]}
        >
          {training ? "Training" : opponentLine(item)}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          {showOwner && !!ownerLabel(item) && (
            <Meta icon={<OvalIcon size={12} color={colour.inkMuted} />} text={ownerLabel(item)!} />
          )}
          {!!shortVenue(item.venue) && <Meta icon={<MapPin size={12} color={colour.inkMuted} />} text={shortVenue(item.venue)!} />}
          {training && !!item.us.teamName && <Meta text={item.us.teamName} />}
        </View>
      </View>

      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {/* A RESULT REPLACES THE STATUS PILL. "Completed, 24–12" says the same thing twice and the
            scoreline is the part somebody came for. */}
        {item.result ? (
          <Text style={[type.bodyMedium, { color: colour.forest800, fontSize: 16 }]}>
            {item.result.ourScore}–{item.result.theirScore}
          </Text>
        ) : (
          status && status.tone !== "confirmed" && <Pill status={status} />
        )}
        {/* THE CHILD'S OWN ANSWER, where this row belongs to one. A guardian's agenda is about people,
            not just dates. */}
        {!!item.attendance && <Attendance value={item.attendance} />}
      </View>
    </Pressable>
  )
}

/** "Ava" or "Under 12 Boys" — whose rugby this row is, in a view that mixes several. */
function ownerLabel(item: AgendaItem): string | null {
  return item.childFirstName ?? item.us.teamName ?? null
}

export function HomeAwayBadge({
  home,
  size = 26,
  ringColour,
}: {
  home: NonNullable<ReturnType<typeof homeAwayLabel>>
  size?: number
  /** A ring, where the badge sits on a background close to its own colour. */
  ringColour?: string
}) {
  const known = home.short === "H" || home.short === "A"
  const background = home.short === "H" ? colour.forest800 : home.short === "A" ? colour.messengerBlue : colour.lineStrong
  return (
    <View
      // The row already says "Home" in its own sentence; repeating it here would have VoiceOver read
      // the fact twice, once as a word and once as a letter.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        borderWidth: ringColour ? 1.5 : 0,
        borderColor: ringColour,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={[
          type.smallMedium,
          { color: known ? colour.onForest : colour.inkMuted, fontSize: size * 0.48, lineHeight: size * 0.6 },
        ]}
      >
        {home.short}
      </Text>
    </View>
  )
}

function Meta({ icon, text, strong }: { icon?: React.ReactNode; text: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "100%" }}>
      {icon}
      <Text
        numberOfLines={1}
        style={[type.caption, { color: strong ? colour.forest800 : colour.inkMuted, fontSize: 11 }]}
      >
        {text}
      </Text>
    </View>
  )
}

function Pill({ status }: { status: StatusTone }) {
  const shades: Record<StatusTone["tone"], { bg: string; fg: string }> = {
    neutral: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted },
    confirmed: { bg: colour.successSurface, fg: colour.forest800 },
    warning: { bg: colour.warningSurface, fg: colour.warning },
    stopped: { bg: colour.dangerSurface, fg: colour.danger },
    done: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted },
  }
  const shade = shades[status.tone]
  return (
    <View style={{ backgroundColor: shade.bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
      <Text style={[type.caption, { color: shade.fg, fontSize: 10 }]}>{status.label}</Text>
    </View>
  )
}

/** One child's own answer, in words rather than a coloured dot. */
function Attendance({ value }: { value: NonNullable<AgendaItem["attendance"]> }) {
  const label = value === "ATTENDING" ? "Going" : value === "CANNOT_ATTEND" ? "Can't go" : "Unsure"
  const colours = value === "ATTENDING" ? colour.forest800 : value === "CANNOT_ATTEND" ? colour.danger : colour.warning
  return <Text style={[type.caption, { color: colours, fontSize: 10 }]}>{label}</Text>
}

/**
 * THE NEXT ONE, WITH MORE ROOM.
 *
 * The next fixture deserves more hierarchy than the seventh, and less than a screen-filling hero. This
 * is a card rather than a banner: big enough to be the first thing seen, small enough that the fixture
 * AFTER it is still on screen -- because "what have I got coming up" is a plural question, and a hero
 * that pushes the answer below the fold has misunderstood it.
 */
export function NextFixtureCard({
  item,
  today,
  onPress,
}: {
  item: AgendaItem
  today: string
  onPress?: () => void
}) {
  const status = statusTone(item.status)
  const struck = status?.struck ?? false
  const home = homeAwayLabel(item.homeAway)
  const time = kickoffLabel(item.time)

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Next. ${spokenAgendaItem(item, today)}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        backgroundColor: colour.forest800,
        padding: space.lg,
        gap: space.sm,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <Text style={[type.overline, { color: colour.onForestMuted }]}>
        {item.kind === "training" ? "NEXT TRAINING" : "NEXT FIXTURE"}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {item.kind === "fixture" && (
          <ClubCrest clubName={item.them?.clubName ?? null} url={item.them?.crestUrl ?? null} size={48} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={2}
            style={[type.title, { color: colour.onForest, textDecorationLine: struck ? "line-through" : "none" }]}
          >
            {item.kind === "training" ? "Training" : opponentLine(item)}
          </Text>
          <Text style={[type.small, { color: colour.onForestMuted, marginTop: 2 }]}>
            {item.us.teamName ?? item.us.clubName}
            {item.childFirstName ? ` · ${item.childFirstName}` : ""}
          </Text>
        </View>
      </View>

      {/* THE FACTS STOP SHORT OF THE BADGE'S CORNER. 44 was not enough -- the badge is 34 wide plus a
          ring and sits 16 from the edge, so it reaches 52 in, and a long venue name ran underneath it
          while still showing its own ellipsis. Reserved generously: an address is the longest thing on
          this card and it is the one somebody reads. */}
      {/* THE FACTS KEEP CLEAR OF THE BADGE'S CORNER, which is 34 wide plus a ring and 16 from the edge.
          The venue is the GROUND'S NAME rather than its postal address -- the address belongs on the
          console beside Directions, not in a card where it truncates to "Lightfoot Lane, Pr...". */}
      <View style={{ gap: space.xs, marginTop: space.xs, paddingRight: 58 }}>
        <Fact
          icon={<Clock size={14} color={colour.onForestMuted} />}
          text={time ? `${relativeDate(item.date, today)} · ${time}` : relativeDate(item.date, today)}
        />
        {!!shortVenue(item.venue) && (
          <Fact icon={<MapPin size={14} color={colour.onForestMuted} />} text={shortVenue(item.venue)!} />
        )}
      </View>

      {!!status && status.tone !== "confirmed" && (
        <View style={{ alignSelf: "flex-start", marginTop: space.xs, marginRight: 58, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 }}>
          <Text style={[type.caption, { color: colour.onForest, fontSize: 11 }]}>{status.label}</Text>
        </View>
      )}

      {/* THE MARK SITS IN THE CARD'S OWN CORNER, not on the crest.
          Pinned to the crest it half-disappeared behind the white tile and its green ring vanished into
          the green card -- a badge you have to look for twice is worse than the word it replaced. Down
          here it has the card's whole corner to itself, it is the same distance from the edge whatever
          the opponent's name does to the layout, and on green it needs a ring only to separate it from
          the background rather than from another badge. */}
      {!!home && item.kind === "fixture" && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", right: space.lg, bottom: space.lg }}
        >
          <HomeAwayBadge home={home} size={34} ringColour="rgba(255,255,255,0.28)" />
        </View>
      )}
    </Pressable>
  )
}

function Fact({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      {icon}
      <Text numberOfLines={1} style={[type.small, { color: colour.onForest }]}>
        {text}
      </Text>
    </View>
  )
}

export { PersonAvatar }
