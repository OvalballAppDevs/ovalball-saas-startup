import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"

import type { TournamentPlanContext } from "@ovalball/contracts/tournaments/planning"
import {
  readTournamentBracket,
  tieResolutionLabel,
  type TieResolution,
  type TournamentBracket,
} from "@ovalball/contracts/tournaments/knockout"

import { supabase } from "../auth/supabase"
import { Button, Card, InfoNote } from "../components/ui"
import { CalendarDays } from "../components/icons"
import { colour, space, type } from "../design/tokens"

import { TournamentBracketView } from "./bracket"
import { dayLabel } from "./knockout-planning"

/**
 * WHAT WILL ACTUALLY BE GENERATED, SHOWN BEFORE IT IS.
 *
 * The round robin's Review step lists what the competition will be; a knockout's has to go further and
 * show the BRACKET, because a draw is the thing an organiser needs to look at before committing to it.
 * A list saying "4 games" tells them nothing about whether the two strongest sides meet in the first
 * round.
 *
 * GENERATING OPENS THE DRAFT. It does not put up a dialogue saying it worked -- the proof that it
 * worked is the bracket, and the organiser is taken straight to it.
 */
export function KnockoutReviewStep({
  context,
  grade,
  days,
  duration,
  tie,
  extraTime,
  thirdPlace,
  busy,
  onEdit,
  onGenerate,
  generateBlocked = false,
}: {
  context: TournamentPlanContext
  grade: string
  days: string[]
  duration: number
  tie: TieResolution
  extraTime: number | null
  thirdPlace: boolean
  busy: boolean
  onEdit: (step: number) => void
  onGenerate: () => void
  /** True when the server's readiness says Generate would be refused -- the panel above says why. */
  generateBlocked?: boolean
}) {
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)

  const load = useCallback(async () => {
    try {
      setBracket(await readTournamentBracket(supabase, context.tournamentId, grade))
    } catch {
      setBracket(null)
    }
  }, [context.tournamentId, grade])

  useEffect(() => {
    void load()
  }, [load])

  const rounds = bracket?.rounds.filter((r) => !r.isThirdPlace).map((r) => r.name) ?? []

  return (
    <>
      <Card style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink, paddingBottom: space.xs }]}>
          The Competition
        </Text>
        <Fact label="Competition" value={`${grade} · Knockout`} />
        <Fact label="Teams" value={`${context.sides.length} confirmed`} />
        <Fact label="Competition days" value={days.length ? days.map(dayLabel).join(", ") : "None selected"} />
        <Fact label="Draw" value={rounds.length ? rounds.join(" → ") : "Not drawn yet"} />
        <Fact label="Match duration" value={`${duration} min`} />
        <Fact label="Extra time" value={extraTime === null ? "None" : `${extraTime} min`} />
        <Fact label="Tie resolution" value={tieResolutionLabel(tie)} />
        <Fact label="Third-place play-off" value={thirdPlace ? "On" : "Off"} />
        {/* RESULT VISIBILITY IS THE TOURNAMENT'S, not the competition's, and is set on Tournament
            Details. Named here so the organiser reviews it, and reached where it is actually owned. */}
        <Fact label="Result visibility" value="Set on Tournament Details" />
      </Card>

      {!!bracket && bracket.rounds.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>The Draw</Text>
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            The opening round is the sides you arranged. Later rounds show what fills them.
          </Text>
          <TournamentBracketView bracket={bracket} />
        </Card>
      )}

      <Button
        label="Generate Fixtures"
        busy={busy}
        disabled={generateBlocked}
        icon={<CalendarDays size={18} color={colour.onForest} strokeWidth={1.9} />}
        onPress={onGenerate}
        accessibilityHint="Creates the draft competition and opens it"
      />
      <InfoNote>
        Generating creates a draft only you can see. Participating teams, players and parents see
        nothing until you publish the plan.
      </InfoNote>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: 6 }}>
      <Text style={[type.caption, { width: 128, color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.small, { flex: 1, color: colour.ink }]}>{value}</Text>
    </View>
  )
}
