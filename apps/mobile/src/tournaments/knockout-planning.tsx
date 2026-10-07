import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import type { PlanSide, TournamentPlanContext } from "@ovalball/contracts/tournaments/planning"
import {
  TIE_RESOLUTIONS,
  randomiseBracket,
  readTournamentBracket,
  setBracketDraw,
  setKnockoutSettings,
  setRoundDays,
  tieResolutionLabel,
  type TieResolution,
  type TournamentBracket,
} from "@ovalball/contracts/tournaments/knockout"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { Button, Card, InfoNote } from "../components/ui"
import { Shuffle } from "../components/icons"
import { friendly, logDetail } from "../errors/translate"
import { colour, radius, space, type } from "../design/tokens"

import { TournamentBracketView } from "./bracket"
import { ChoiceCard, FormSwitchRow, SectionLabel } from "./form-primitives"

/**
 * PLANNING A KNOCKOUT, IN THE SAME WIZARD.
 *
 * Step one and the chrome are shared with a round robin, because confirming who is coming and which
 * days they play is the same job whatever shape the competition takes. What differs is the middle: a
 * round robin arranges tables, a knockout arranges a DRAW; and a round robin's settings are about
 * points, a knockout's are about what happens when a game is level.
 *
 * NOTHING HERE DECIDES ANYTHING. The pairing rule, where the byes fall, what an empty place is called
 * and the running order are all the server's. These screens show them and send the organiser's choices
 * back through the governed RPCs.
 */

const RED = "#c1221b"
const RED_SURFACE = "#fdf2f2"

/* ---- step 2: the draw --------------------------------------------------------------------------- */

export function KnockoutDrawStep({
  context,
  grade,
  onBusyChange,
}: {
  context: TournamentPlanContext
  grade: string
  onBusyChange?: (busy: boolean) => void
}) {
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProblem(null)
      setBracket(await readTournamentBracket(supabase, context.tournamentId, grade))
    } catch (caught) {
      const failure = friendly(caught, "this draw")
      logDetail("knockout draw", failure)
      setProblem(failure.message)
    }
  }, [context.tournamentId, grade])

  // THE DRAW IS PERSISTED, NOT REGENERATED. Opening this step reads what is already arranged; only
  // Randomise redraws, because a bracket that reshuffled every time somebody came back to look at it
  // would be a bracket nobody could arrange.
  useEffect(() => {
    void load()
  }, [load])

  const planId = context.plan?.id ?? null
  const seedOrder = currentSeedOrder(bracket)

  async function run(work: () => Promise<unknown>) {
    setBusy(true)
    onBusyChange?.(true)
    setProblem(null)
    try {
      await work()
      await load()
    } catch (caught) {
      const failure = friendly(caught, "this draw")
      logDetail("knockout draw write", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  /** Swapping two sides is one draw with two entries exchanged -- the server's own validation applies. */
  async function swap(a: string, b: string) {
    if (!planId || !seedOrder) return
    const next = seedOrder.map((id) => (id === a ? b : id === b ? a : id))
    await run(() => setBracketDraw(supabase, planId, next))
    setPicked(null)
  }

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>The Field</Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Stat label="TEAMS" value={String(context.sides.length)} />
          <Stat label="BRACKET" value={bracket ? `${bracket.bracketSize} places` : "—"} />
          <Stat label="BYES" value={bracket ? String(Math.max(0, bracket.bracketSize - context.sides.length)) : "—"} />
        </View>
        {!!bracket && bracket.bracketSize > context.sides.length && (
          <InfoNote>
            {`${context.sides.length} teams need ${/^(8|11|18)/.test(String(bracket.bracketSize)) ? "an" : "a"} ${bracket.bracketSize}-place bracket, so ${bracket.bracketSize - context.sides.length} ${bracket.bracketSize - context.sides.length === 1 ? "side has" : "sides have"} no opponent in the first round and ${bracket.bracketSize - context.sides.length === 1 ? "goes" : "go"} straight through. A bye is not a game and has no score.`}
          </InfoNote>
        )}
      </Card>

      {!!bracket && bracket.rounds.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>The Draw</Text>
          <TournamentBracketView bracket={bracket} />
        </Card>
      )}

      <Button
        label="Randomise Draw"
        variant="secondary"
        busy={busy}
        icon={<Shuffle size={18} color={colour.ink} strokeWidth={1.9} />}
        onPress={() => planId && void run(() => randomiseBracket(supabase, planId))}
        accessibilityHint="Redraws the whole bracket"
      />

      {/*
        SWAPPING WITHOUT A GESTURE. Dragging inside a bracket that pans sideways is a fight, and a
        drag-only control excludes anybody using a screen reader -- so two taps do it: choose a side,
        then choose the side to exchange it with. The same call a drag would make.
      */}
      <Card style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Move a Team</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          {picked
            ? "Now choose the team to swap it with."
            : "Tap a team, then tap the one you want to swap it with."}
        </Text>
        {context.sides.map((side) => (
          <SwapRow
            key={side.participantId}
            side={side}
            picked={picked === side.participantId}
            dimmed={!!picked && picked !== side.participantId}
            onPress={() => {
              if (!picked) { setPicked(side.participantId); return }
              if (picked === side.participantId) { setPicked(null); return }
              void swap(picked, side.participantId)
            }}
          />
        ))}
      </Card>

      {problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
    </>
  )
}

/** The app's own radio mark, so a knockout choice looks like every other choice in Ovalball. */
function Dot({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 20, height: 20, borderRadius: 10, borderWidth: 2,
        borderColor: on ? colour.forest800 : colour.lineStrong,
        alignItems: "center", justifyContent: "center",
      }}
    >
      {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800 }} />}
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }}>
      <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: colour.ink }]}>{value}</Text>
    </View>
  )
}

function SwapRow({
  side,
  picked,
  dimmed,
  onPress,
}: {
  side: PlanSide
  picked: boolean
  dimmed: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={picked ? `${side.clubName}, chosen. Tap another team to swap.` : `Swap ${side.clubName}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: 52,
        paddingHorizontal: space.sm,
        borderRadius: radius.md,
        borderWidth: picked ? 2 : 1,
        borderColor: picked ? RED : colour.line,
        backgroundColor: picked ? RED_SURFACE : colour.surface,
        opacity: pressed ? 0.8 : dimmed ? 0.55 : 1,
      })}
    >
      <ClubCrest clubName={side.clubName} url={clubLogoUrlFromPath(supabase, side.crestPath)} size={26} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{side.clubName}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>
          {side.label}
          {side.isHost ? " · Host" : ""}
        </Text>
      </View>
    </Pressable>
  )
}

/**
 * The draw as the server holds it, in SEED order, so a swap can be expressed as one rearrangement.
 *
 * This is read straight from the server rather than assembled from the games on screen. The bracket's
 * places are not its seeds -- an eight-place bracket plays 1v8, 4v5, 2v7, 3v6 -- so walking the first
 * round's cards and posting the result as a draw exchanges two sides and then re-permutes all eight
 * through the seeding map. That is not a theoretical risk: it is what this function used to do.
 */
function currentSeedOrder(bracket: TournamentBracket | null): string[] | null {
  const order = bracket?.drawOrder
  return order && order.length > 0 ? order : null
}

/* ---- step 3: the settings ------------------------------------------------------------------------ */

export function KnockoutSettingsStep({
  context,
  grade,
  days,
  duration,
  tie,
  onTie,
  extraTime,
  onExtraTime,
  thirdPlace,
  onThirdPlace,
  roundDays,
  onRoundDays,
  showDuration = true,
}: {
  context: TournamentPlanContext
  grade: string
  days: string[]
  duration: number
  /** A Hybrid's Settings step already sets the game length for both stages, above this. */
  showDuration?: boolean
  tie: TieResolution
  onTie: (t: TieResolution) => void
  extraTime: number | null
  onExtraTime: (n: number | null) => void
  thirdPlace: boolean
  onThirdPlace: (v: boolean) => void
  roundDays: Record<number, string>
  onRoundDays: (r: Record<number, string>) => void
}) {
  // THE ROUNDS COME FROM THE DRAW, not from arithmetic repeated here. A competition of six sides has a
  // quarter-final round and one of four does not, and the server already knows which.
  const [roundNames, setRoundNames] = useState<{ round: number; name: string }[]>([])
  useEffect(() => {
    let live = true
    void readTournamentBracket(supabase, context.tournamentId, grade)
      .then((b) => {
        if (!live || !b) return
        setRoundNames(b.rounds.filter((r) => !r.isThirdPlace).map((r) => ({ round: r.round, name: r.name })))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [context.tournamentId, grade])

  return (
    <>
      {showDuration && <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Match Duration</Text>
        <Text style={[type.title, { color: colour.ink }]}>{duration} minutes</Text>
        {/* THE ONE DURATION AUTHORITY. Knockout does not get a second: the age grade's own regulation
            length is the default and the ceiling, exactly as it is for a round robin. */}
        <InfoNote>{`Default from ${context.defaults.durationSource}. Change it on the competition's own timing settings.`}</InfoNote>
      </Card>}

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Extra Time If Drawn</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          An optional further period. Separate from what finally decides a level game.
        </Text>
        <ChoiceCard
          wide
          icon={<Dot on={extraTime === null} />}
          title="None"
          blurb="No additional time. Go straight to the tie resolution."
          selected={extraTime === null}
          onPress={() => onExtraTime(null)}
        />
        <ChoiceCard
          wide
          icon={<Dot on={extraTime !== null} />}
          title="Extra time"
          blurb={extraTime === null ? "A further period is played." : `A further period of ${extraTime} minutes.`}
          selected={extraTime !== null}
          onPress={() => onExtraTime(extraTime ?? 5)}
        />
        {extraTime !== null && (
          <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
            {[5, 7, 10].map((m) => (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ selected: extraTime === m }}
                accessibilityLabel={`${m} minutes of extra time`}
                onPress={() => onExtraTime(m)}
                style={({ pressed }) => ({
                  minHeight: 38,
                  paddingHorizontal: space.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.pill,
                  backgroundColor: extraTime === m ? colour.forest800 : colour.surface,
                  borderWidth: 1,
                  borderColor: extraTime === m ? colour.forest800 : colour.line,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: extraTime === m ? colour.onForest : colour.ink }]}>{m} min</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Tie Resolution</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          What finally decides a game that is still level. Only what Ovalball can actually record is offered.
        </Text>
        {TIE_RESOLUTIONS.map((t) => (
          <ChoiceCard
            key={t.key}
            wide
            icon={<Dot on={tie === t.key} />}
            title={t.label}
            blurb={t.blurb}
            selected={tie === t.key}
            onPress={() => onTie(t.key)}
          />
        ))}
      </Card>

      {/* WHICH DAY EACH ROUND IS PLAYED ON. A cup across a weekend is usually quarter-finals Friday,
          semi-finals Saturday, final Sunday -- a decision about the competition, not a consequence of
          pitch capacity. The scheduler still places the time and the pitch. */}
      {days.length > 1 && (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Round Scheduling</Text>
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            Which day each round is played on. Kick-off times and pitches are still worked out from your reservations.
          </Text>
          {roundNames.map((r) => (
            <View key={r.round} style={{ gap: 6 }}>
              <SectionLabel>{r.name.toUpperCase()}</SectionLabel>
              <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
                {days.map((d) => {
                  const on = roundDays[r.round] === d
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${r.name} on ${dayLabel(d)}`}
                      onPress={() => onRoundDays({ ...roundDays, [r.round]: d })}
                      style={({ pressed }) => ({
                        minHeight: 38,
                        paddingHorizontal: space.md,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.pill,
                        backgroundColor: on ? colour.forest800 : colour.surface,
                        borderWidth: 1,
                        borderColor: on ? colour.forest800 : colour.line,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{dayLabel(d)}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: space.sm }}>
        <FormSwitchRow
          icon={<View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: RED_SURFACE, borderWidth: 1.5, borderColor: RED }} />}
          label="Third-Place Play-Off"
          hint="Creates a play-off between the two losing semi-finalists."
          value={thirdPlace}
          onChange={onThirdPlace}
        />
      </Card>
    </>
  )
}

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${months[m - 1]}`
}

export { RED as KNOCKOUT_RED, RED_SURFACE as KNOCKOUT_RED_SURFACE }
export { tieResolutionLabel, setKnockoutSettings, setRoundDays }
