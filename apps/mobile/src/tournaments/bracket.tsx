import { Pressable, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  bracketSideText,
  type BracketGame,
  type BracketRound,
  type BracketSide,
  type TournamentBracket,
} from "@ovalball/contracts/tournaments/knockout"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { InfoNote } from "../components/ui"
import { colour, radius, space, type } from "../design/tokens"

import { longDate } from "./detail-chrome"

/**
 * THE DRAW, DRAWN.
 *
 * ONE COMPONENT FOR EVERY SURFACE THAT SHOWS A BRACKET -- the organiser arranging it in Planning, the
 * Review step before generating, the generated draft, and the participant's read-only Draw tab. They
 * differ in what the server sends them and in what sits around them, never in how a bracket looks.
 *
 * ---- WHY IT RUNS TOP TO BOTTOM --------------------------------------------------------------------
 *
 * A bracket is traditionally drawn as columns reading left to right, and on a phone that means it has
 * to pan sideways. The bigger the competition the worse that gets: a sixteen- or thirty-two-side draw
 * is several screens wide, and the first thing a sideways pan takes off the edge is the end of a
 * label -- "Winner QF" without its number, which is the whole content of a place nobody has reached.
 *
 * So the draw runs DOWNWARD. Each round is a full-width section with its own heading and day, and its
 * games sit beneath it at full width, with room for a club's real name rather than an abbreviation. A
 * bigger field makes the page longer, which is the direction a phone scrolls anyway and which has no
 * practical limit. Where a game's place comes from is carried in words -- "Winner QF1" -- rather than
 * in a line drawn across a gap that no longer exists.
 *
 * ---- WHAT AN EMPTY PLACE SHOWS -------------------------------------------------------------------
 *
 * The sentence the server gave it: "Winner QF1", "Loser SF1". No crest, no club, no colour -- because
 * there is nothing there yet, and drawing a placeholder that looks like a side is how somebody comes to
 * believe a team has qualified.
 */

export function TournamentBracketView({
  bracket,
  onOpenGame,
}: {
  bracket: TournamentBracket
  /** Opens the one shared result detail. Only a real game has one. */
  onOpenGame?: (gameId: string) => void
}) {
  if (bracket.rounds.length === 0) {
    return <InfoNote>No draw has been made for this competition yet.</InfoNote>
  }

  return (
    <View style={{ gap: space.md }}>
      {bracket.rounds.map((round, ri) => (
        <View key={`${round.round}-${round.isThirdPlace}`} style={{ gap: 2 }}>
          {/* THE FLOW, SHOWN RATHER THAN IMPLIED. A short rule between two rounds says the one above
              feeds the one below. The third-place play-off gets none: nothing feeds out of the final
              into it, and a line there would say it did. */}
          {ri > 0 && !round.isThirdPlace && <FeedsInto />}
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>
            {round.isThirdPlace ? "Third-Place Play-Off" : round.name}
          </Text>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>{roundDayText(round)}</Text>
          <View style={{ gap: space.xs, paddingTop: space.xs }}>
            {round.games.map((g) => (
              <GameCard key={g.pairingId} game={g} showScores={bracket.showsScores} onOpenGame={onOpenGame} />
            ))}
          </View>
        </View>
      ))}

      {/*
        THE SIDES ALREADY THROUGH. Their own block, never a fixture against nobody: a bye has no
        opponent, no pitch, no kick-off and no score, and drawing it as a game would invent all four.
      */}
      {bracket.byes.length > 0 && (
        <View style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>Byes</Text>
          {bracket.byes.map((b) => (
            <View
              key={b.participantId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                padding: space.md,
                borderRadius: radius.lg,
                backgroundColor: colour.surface,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colour.lineStrong,
              }}
            >
              <ClubCrest clubName={b.side.clubName} url={clubLogoUrlFromPath(supabase, b.side.crestPath)} size={26} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
                  {b.side.clubName}
                </Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>
                  Bye · Through to {b.advancesToName}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** The one piece of chrome a vertical draw needs: this round is fed by the one above it. */
function FeedsInto() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: "center", paddingBottom: space.sm }}
    >
      <View style={{ width: 1, height: 16, backgroundColor: colour.lineStrong }} />
    </View>
  )
}

function GameCard({
  game,
  showScores,
  onOpenGame,
}: {
  game: BracketGame
  showScores: boolean
  onOpenGame?: (gameId: string) => void
}) {
  const tappable = !!game.gameId && !!onOpenGame
  // THE DAY IS THE ROUND'S, not the card's: the round heading already says it, and repeating it on
  // every card spends the width the club names need.
  const meta = [game.startTime ? game.startTime.slice(0, 5) : null, game.pitchName]
    .filter(Boolean)
    .join(" · ")

  const body = (
    <View
      style={{
        borderRadius: radius.md,
        backgroundColor: colour.surface,
        borderWidth: 1,
        borderColor: colour.line,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        gap: 2,
      }}
    >
      <SideLine side={game.sideA} showScore={showScores} />
      <View style={{ height: 1, backgroundColor: colour.line }} />
      <SideLine side={game.sideB} showScore={showScores} />
      {!!meta && (
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11, paddingTop: 2 }]}>
          {meta}
        </Text>
      )}
      {/* A LEVEL GAME THAT HAS NOT BEEN DECIDED stops the bracket, and says so rather than looking
          merely unplayed. */}
      {game.needsWinner && (
        <View style={{ alignSelf: "flex-start", marginTop: 2, paddingHorizontal: space.sm, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colour.warningSurface }}>
          <Text style={[type.caption, { color: colour.warning, fontSize: 11 }]}>Winner required</Text>
        </View>
      )}
    </View>
  )

  if (!tappable) return body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${bracketSideText(game.sideA)} against ${bracketSideText(game.sideB)}`}
      onPress={() => onOpenGame?.(game.gameId as string)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  )
}

function SideLine({ side, showScore }: { side: BracketSide; showScore: boolean }) {
  // AN EMPTY PLACE IS A SENTENCE, not a greyed-out team: no crest, and the text in the muted ink the
  // app uses for something that is not yet a fact.
  if (side.unresolved) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 30 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderStyle: "dashed", borderColor: colour.lineStrong }} />
        <Text style={[type.small, { flex: 1, color: colour.inkSubtle }]}>
          {side.label ?? "To be decided"}
        </Text>
      </View>
    )
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 30 }}>
      <ClubCrest clubName={side.clubName} url={clubLogoUrlFromPath(supabase, side.crestPath)} size={22} />
      <Text
        numberOfLines={2}
        style={[side.isWinner ? type.smallMedium : type.small, { flex: 1, color: colour.ink, lineHeight: 18 }]}
      >
        {side.clubName}
      </Text>
      {showScore && side.score !== null && (
        <Text style={[side.isWinner ? type.smallMedium : type.small, { color: side.isWinner ? colour.forest800 : colour.inkMuted }]}>
          {side.score}
        </Text>
      )}
    </View>
  )
}

function roundDayText(round: BracketRound): string {
  const day = round.games.find((g) => g.date)?.date
  return day ? longDate(day) : "Not scheduled"
}
