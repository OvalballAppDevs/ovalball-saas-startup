import { useCallback, useEffect, useState } from "react"
import { Switch, Text, View } from "react-native"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  fieldSizeGuidance,
  readTournamentPlanDraft,
  setPlanStandings,
  type DraftGame,
  type TournamentPlanContext,
} from "@ovalball/contracts/tournaments/planning"

import { supabase } from "../auth/supabase"
import { ClubCrest } from "../components/identity"
import { Card, InfoNote } from "../components/ui"
import { friendlyRefusal, logDetail } from "../errors/translate"
import { colour, radius, space, type } from "../design/tokens"

/**
 * A TRI-FIXTURE'S MIDDLE STEP: THE THREE GAMES, AND WHETHER THEY MAKE A TABLE.
 *
 * A Tri-Fixture is a round robin of exactly three sides (20270666): A v B, B v C, C v A -- the same
 * pairing rule and the same scheduler as any round robin, never a second engine. So there are no tables
 * to arrange, and this step shows the organiser what generating will create, read from the SERVER's
 * own preview of the pairings rather than worked out on the phone.
 *
 * THE TABLE IS A CHOICE. Three sides sharing a pitch for a morning is often not a competition anybody is
 * winning, so a Tri-Fixture keeps no table unless the organiser asks for one; when they do, it uses the
 * round robin's own scoring and tie-breakers, set in the next step.
 */
export function TriFixtureStep({
  context, grade, onChanged,
}: {
  context: TournamentPlanContext
  grade: string
  onChanged: () => void
}) {
  const [games, setGames] = useState<DraftGame[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const playing = context.sides.filter((s) => s.competes !== false)
  const guidance = fieldSizeGuidance(context.plan?.fieldSize ?? 3, playing.length)
  const keepsTable = context.plan?.standingsEnabled ?? false

  const load = useCallback(async () => {
    try {
      const preview = await readTournamentPlanDraft(supabase, context.tournamentId, grade, true)
      setGames((preview?.tables ?? []).flatMap((t) => t.rounds.flatMap((r) => r.games)))
    } catch (caught) {
      const failure = friendlyRefusal(caught, "these games")
      logDetail("tri-fixture preview", failure)
      setProblem(failure.message)
    }
  }, [context.tournamentId, grade])

  useEffect(() => {
    void load()
  }, [load, context.sides.length])

  async function toggle(next: boolean) {
    if (!context.plan) return
    setSaving(true)
    setProblem(null)
    try {
      await setPlanStandings(supabase, context.plan.id, next)
      onChanged()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "this competition")
      logDetail("tri-fixture standings", failure)
      setProblem(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>The Three Games</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          Each team plays the other two once. Times and pitches are set when the fixtures are generated.
        </Text>
        {!!guidance && <InfoNote>{guidance}</InfoNote>}
        {!guidance && games?.map((g, i) => (
          <View key={`${g.sideA.participantId}-${g.sideB.participantId}`} style={{ gap: 6, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>Game {i + 1}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ClubCrest clubName={g.sideA.clubName} url={clubLogoUrlFromPath(supabase, g.sideA.crestPath)} size={22} />
              <Text numberOfLines={2} style={[type.small, { flex: 1, color: colour.ink }]}>{g.sideA.clubName}</Text>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>v</Text>
              <Text numberOfLines={2} style={[type.small, { flex: 1, color: colour.ink, textAlign: "right" }]}>{g.sideB.clubName}</Text>
              <ClubCrest clubName={g.sideB.clubName} url={clubLogoUrlFromPath(supabase, g.sideB.crestPath)} size={22} />
            </View>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Keep a Table</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
              {keepsTable
                ? "Results build a table, using the scoring and tie-breakers in Settings."
                : "No table. The three games are played and their results recorded, with no standings."}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Keep a Table"
            value={keepsTable}
            disabled={saving || !context.plan}
            onValueChange={(v) => void toggle(v)}
            trackColor={{ true: colour.rugby700, false: colour.lineStrong }}
          />
        </View>
      </Card>

      {!!problem && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>}
    </>
  )
}
