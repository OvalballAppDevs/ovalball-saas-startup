import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"

import { readHybridKnockoutPreview, setHybridQualifiers, type HybridKnockoutPreview } from "@ovalball/contracts/tournaments/hybrid"
import type { TournamentPlanContext } from "@ovalball/contracts/tournaments/planning"

import { supabase } from "../auth/supabase"
import { Card, InfoNote } from "../components/ui"
import { friendlyRefusal, logDetail } from "../errors/translate"
import { colour, radius, space, type } from "../design/tokens"

/**
 * A HYBRID'S SEAM: HOW MANY GO THROUGH, AND WHO THEY MEET.
 *
 * The group stage is arranged on the previous step with the round robin's own tables; the knockout stage
 * is the knockout's own bracket. The one decision that joins them is how many sides from each table go
 * through (1-4), saved the moment it is chosen, as the Tri-Fixture's table switch is.
 *
 * THE CROSSOVER IS THE SERVER'S. "1st Table A v 2nd Table B" is read from `get_hybrid_knockout_preview`,
 * which uses the same seeding rule generation does -- the phone never works out a draw of its own.
 */
export function HybridKnockoutStage({
  context, onChanged,
}: {
  context: TournamentPlanContext
  onChanged: () => void
}) {
  const plan = context.plan
  const chosen = plan?.qualifiersPerTable ?? null
  const tableCount = plan?.tables.length ?? 0
  const [preview, setPreview] = useState<HybridKnockoutPreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!plan) return
    try {
      setPreview(await readHybridKnockoutPreview(supabase, plan.id))
    } catch (caught) {
      const failure = friendlyRefusal(caught, "the knockout stage")
      logDetail("hybrid preview", failure)
      setProblem(failure.message)
    }
  }, [plan])

  useEffect(() => {
    void load()
  }, [load, chosen, tableCount, plan?.thirdPlacePlayoff])

  async function choose(n: number) {
    if (!plan || n === chosen) return
    setSaving(true)
    setProblem(null)
    try {
      await setHybridQualifiers(supabase, plan.id, n)
      onChanged()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "the knockout stage")
      logDetail("hybrid qualifiers", failure)
      setProblem(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Knockout Stage</Text>
      <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
        How many teams from each table go through. Table winners are kept apart: 1st in one table plays 2nd in another.
      </Text>

      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
        {[1, 2, 3, 4].map((n) => {
          const on = chosen === n
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: saving }}
              accessibilityLabel={`${n} from each table`}
              disabled={saving}
              onPress={() => void choose(n)}
              style={({ pressed }) => ({
                minHeight: 44,
                minWidth: 44,
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
              <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{n}</Text>
            </Pressable>
          )
        })}
      </View>

      {chosen === null ? (
        <InfoNote>Choose how many go through to see the knockout stage.</InfoNote>
      ) : preview && preview.teams >= 2 ? (
        <View style={{ gap: space.xs }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {`${preview.teams} teams go through. The knockout starts at the ${preview.firstRound}.`}
          </Text>
          {preview.games.map((g) => (
            <View
              key={g.game}
              accessibilityLabel={`${preview.firstRound} ${g.game}: ${g.sideA} versus ${g.sideB}`}
              style={{ gap: 4, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}
            >
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{`${preview.firstRound} ${g.game}`}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={[type.smallMedium, { flex: 1, color: colour.ink }]}>{g.sideA}</Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>v</Text>
                <Text style={[type.smallMedium, { flex: 1, color: g.bye ? colour.inkMuted : colour.ink, textAlign: "right" }]}>{g.sideB}</Text>
              </View>
            </View>
          ))}
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            Each place fills itself when its table's last game has a confirmed result.
          </Text>
        </View>
      ) : null}

      {!!problem && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>}
    </Card>
  )
}
