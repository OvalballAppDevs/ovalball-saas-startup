import { Pressable, Text, View } from "react-native"
import type { ClubTheme, AgendaItem, FamilyMember } from "@ovalball/contracts"
import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"
import { needsAttendanceResponse } from "@ovalball/contracts"
import { matchTypeLabel } from "@ovalball/contracts/fixtures/game-type"

import {
  homeAwayLabel,
  kickoffLabel,
  opponentFullName,
  opponentLine,
  relativeDate,
  shortVenue,
  spokenAgendaItem,
  statusTone,
  type StatusTone,
} from "../agenda/presentation"
import { ChildMark } from "./child-mark"
import { ClubCrest, PersonAvatar } from "./identity"
import { Clock, Flag, MapPin, OvalIcon, Users } from "./icons"
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
  child = null,
}: {
  item: AgendaItem
  today: string
  onPress?: () => void
  showOwner?: boolean
  /**
   * THE CHILD THIS ROW BELONGS TO, projected by `FamilyProjection`.
   *
   * Passed in rather than derived, because the projection is the one authority
   * for a child's name and picture. When it is present the row LEADS with the
   * child -- which is the first thing a guardian of two is asking -- and the
   * child's first name is dropped from the grey metadata below, where it used to
   * be the quietest thing on the most important row.
   */
  child?: FamilyMember | null
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
        {/* WHO, THEN WHAT. A guardian scanning a week is looking for a person
            before a date, and the aggregated view must never make them work it out
            from an age grade. */}
        {!!child && <ChildMark member={child} style={{ marginBottom: 1 }} />}
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
          {/* The child's name is above now when there is one, so repeating it here
              would be the same fact twice; our own side's name still belongs. */}
          {!!ownerLabel(item, child !== null) && (
            <Meta icon={<OvalIcon size={12} color={colour.inkMuted} />} text={ownerLabel(item, child !== null)!} />
          )}
          {!!shortVenue(item.venue) && <Meta icon={<MapPin size={12} color={colour.inkMuted} />} text={shortVenue(item.venue)!} />}
          {/* THE CLASSIFICATION, from the one taxonomy (`fixtures.game_type`), in the same words as the
              Calendar card, the Match Centre and the Team Home. Absent where nothing is recorded -- a
              fixture with no type is not "Friendly". */}
          {!training && !!matchTypeLabel(item.gameType) && <Meta icon={<Flag size={12} color={colour.inkMuted} />} text={matchTypeLabel(item.gameType)!} />}
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
            not just dates.

            AND WHERE THERE IS NO ANSWER YET, the row says so rather than saying nothing. A blank was
            indistinguishable from a row that belongs to nobody, so a parent scanning a week could not
            see which events were still waiting on them -- the one thing the week is being scanned for.
            It appears only where an answer is genuinely outstanding: `needsAttendanceResponse` is the
            canonical rule, so the word here and the row in Needs Attention appear and disappear
            together, and a cancelled or long-past event is never marked as waiting. */}
        {item.attendance ? (
          <Attendance value={item.attendance} />
        ) : (
          item.playerId !== null && needsAttendanceResponse(item, today) && <Attendance value={null} />
        )}
      </View>
    </Pressable>
  )
}

/**
 * WHOSE RUGBY THIS ROW IS.
 *
 * A child's name in a family view, our own side elsewhere. It is always shown for a fixture rather than
 * only in mixed views, because once the title is the opponent's CLUB the row would otherwise never say
 * which of our sides is playing -- and a club running seven teams needs that more than it needs the
 * word "v".
 */
function ownerLabel(item: AgendaItem, childShownAbove: boolean): string | null {
  if (childShownAbove) return item.us.teamName ?? null
  return item.childFirstName ?? item.us.teamName ?? null
}

export function HomeAwayBadge({
  home,
  size = 26,
  ringColour,
  onDark,
}: {
  home: NonNullable<ReturnType<typeof homeAwayLabel>>
  size?: number
  /** A ring, where the badge sits on a background close to its own colour. */
  ringColour?: string
  /** True on the forest card, where the home badge would otherwise vanish into the background. */
  onDark?: boolean
}) {
  const known = home.short === "H" || home.short === "A"
  // FOREST ON FOREST IS INVISIBLE. On the dark card the home badge was the same colour as the card
  // behind it, so only its ring showed and "H" read as an outline somebody had forgotten to fill.
  // The pitch green is the brand's own light green and reads on both grounds.
  const background = home.short === "H"
    ? (onDark ? colour.pitch600 : colour.forest800)
    : home.short === "A"
      ? colour.messengerBlue
      : colour.lineStrong
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
          {
            color: known ? (onDark && home.short === "H" ? colour.forest950 : colour.onForest) : colour.inkMuted,
            fontSize: size * 0.48,
            lineHeight: size * 0.6,
          },
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

/**
 * One child's own answer, in words rather than a coloured dot.
 *
 * THE WORD IS THE PLATFORM'S. This row said "Going / Can't go / Unsure" -- a
 * FOURTH first-person-ish vocabulary for the three database states, beside the
 * register's "Attending / Can't attend / Unsure", the shared control's "I'm
 * Available / Not Available / Unsure" and the Agenda's own former "Can Attend /
 * Can't Attend / Maybe". This is a row DESCRIBING somebody's answer, so it takes
 * the third-person register words, which is what the web's equivalent shows.
 */
function Attendance({ value }: { value: AgendaItem["attendance"] }) {
  // NULL IS THE CANONICAL "AWAITING" STATE -- the absence of a row, which the shared
  // vocabulary already has a word for. Not a fourth state invented for a list.
  const label = ATTENDANCE_STATE_WORDS[value ?? "AWAITING"]
  const colours =
    value === "ATTENDING" ? colour.forest800 : value === "CANNOT_ATTEND" ? colour.danger : colour.warning
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
  theme,
  onPress,
  child = null,
}: {
  item: AgendaItem
  today: string
  /**
   * THE CLUB'S OWN COLOURS, from its home kit.
   *
   * The card is the club's card, and on the website it has been the club's
   * colours since the Club Digital Home landed -- a Burnley member opens their
   * club home and it is amber and blue, not Ovalball green. Resolved by the
   * shared `resolveClubTheme` from the same `club_kits` row, so a club that
   * changes its shirt changes both clients at once.
   *
   * Optional, and Ovalball's forest is the honest fallback: a club with no
   * recorded kit has no colours to show, and inventing some would be worse than
   * the platform's own.
   */
  theme?: ClubTheme | null
  onPress?: () => void
  /**
   * THE CHILD THIS IS ABOUT, projected by `FamilyProjection`.
   *
   * On the card that a parent looks at first, "whose match is this" outranks every
   * other fact on it. The child's first name used to be a suffix on the team line
   * -- "Under 12 Boys · Pippa" -- which is the least prominent place on the card
   * for the most important word.
   */
  child?: FamilyMember | null
}) {
  const status = statusTone(item.status)
  const struck = status?.struck ?? false
  const home = homeAwayLabel(item.homeAway)
  const time = kickoffLabel(item.time)

  /*
    EVERY COLOUR ON THIS CARD COMES FROM ONE PLACE.

    `theme.hero` is a MEASURED palette, not a set of guesses: `foreground` is
    chosen to clear WCAG AA against `background`, and `mutedForeground` is the
    dimmest value that still does -- so a club with a white kit gets a white card
    with dark text, and a club with a navy kit gets light text, both readable.
    Picking the ground from the club and then keeping Ovalball's white text would
    be how a pale-kit club ends up with an unreadable home screen.
  */
  const ground = theme?.hero.background ?? colour.forest800
  const ink = theme?.hero.foreground ?? colour.onForest
  const inkMuted = theme?.hero.mutedForeground ?? colour.onForestMuted
  // The translucent chips read over any ground, light or dark, because they are
  // mixed from the card's OWN text colour rather than from white.
  const chip = `${ink}22`

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Next. ${spokenAgendaItem(item, today)}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        backgroundColor: ground,
        // A near-white kit produces a near-white card, which would float free of
        // the chalk page without an edge. The theme's own plate border is the
        // value measured for exactly that case.
        borderWidth: theme ? 1 : 0,
        borderColor: theme?.hero.plateBorder ?? "transparent",
        padding: space.lg,
        gap: space.sm,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.overline, { color: inkMuted }]}>
          {item.kind === "training" ? "NEXT TRAINING" : "NEXT FIXTURE"}
        </Text>
        {/* WHOSE, ON THE CARD'S OWN TOP LINE. Drawn in the card's ink rather than
            the page's, because the ground here is the club's colour and the shared
            mark's default would disappear into a dark kit. */}
        {!!child && (
          <View accessible accessibilityLabel={child.shortLabel} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1 }}>
            <PersonAvatar name={child.fullName} url={child.avatarUrl} initials={child.initials} size={22} />
            <Text numberOfLines={1} style={[type.smallMedium, { color: ink, flexShrink: 1 }]}>
              {child.shortLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {item.kind === "fixture" && (
          <ClubCrest clubName={item.them?.clubName ?? null} url={item.them?.crestUrl ?? null} size={48} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={2}
            style={[type.title, { color: ink, textDecorationLine: struck ? "line-through" : "none" }]}
          >
            {item.kind === "training" ? "Training" : opponentLine(item)}
          </Text>
          {/* OUR SIDE, ONCE. The title is the opponent's CLUB, so this is the only place the age grade
              appears -- "Preston Grasshoppers RFC Under 13 Boys" above "Under 13 Boys" said it twice
              and told nobody which of our teams was playing. */}
          <Text style={[type.small, { color: inkMuted, marginTop: 2 }]}>
            {item.us.teamName ?? item.us.clubName}
            {/* The child is named on the top line when there is one, so repeating
                them here would say it twice. */}
            {!child && item.childFirstName ? ` · ${item.childFirstName}` : ""}
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
          icon={<Clock size={14} color={inkMuted} />}
          tint={ink}
          text={time ? `${relativeDate(item.date, today)} · ${time}` : relativeDate(item.date, today)}
        />
        {!!shortVenue(item.venue) && (
          <Fact icon={<MapPin size={14} color={inkMuted} />} tint={ink} text={shortVenue(item.venue)!} />
        )}
        {item.kind === "fixture" && !!matchTypeLabel(item.gameType) && (
          <Fact icon={<Flag size={14} color={inkMuted} />} tint={ink} text={matchTypeLabel(item.gameType)!} />
        )}
      </View>

      {!!status && status.tone !== "confirmed" && (
        <View style={{ alignSelf: "flex-start", marginTop: space.xs, marginRight: 58, backgroundColor: chip, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 }}>
          <Text style={[type.caption, { color: ink, fontSize: 11 }]}>{status.label}</Text>
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
          <HomeAwayBadge home={home} size={34} ringColour="rgba(255,255,255,0.28)" onDark />
        </View>
      )}
    </Pressable>
  )
}

/**
 * One fact on the Next Up card.
 *
 * The colour is PASSED rather than read from the tokens: the card takes the
 * club's own ground, which may be dark navy or near-white, and a fact hard-coded
 * to white is a fact nobody can read on an amber shirt.
 */
function Fact({ icon, text, tint }: { icon?: React.ReactNode; text: string; tint: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      {icon}
      <Text numberOfLines={1} style={[type.small, { color: tint }]}>
        {text}
      </Text>
    </View>
  )
}

export { PersonAvatar }
