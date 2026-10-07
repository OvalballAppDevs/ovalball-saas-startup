import { useMemo, useState } from "react"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"

import type { DraftTableGroup, TournamentPlanContext } from "@ovalball/contracts/tournaments/planning"
import { setSwissRounds, swapSwissSides, swissRoundLimit, type SwissBye, type SwissUpcomingRound } from "@ovalball/contracts/tournaments/swiss"

import { supabase } from "../auth/supabase"
import { Button, Card, InfoNote } from "../components/ui"
import { friendlyRefusal, logDetail } from "../errors/translate"
import { colour, radius, space, type } from "../design/tokens"

/**
 * A SWISS'S MIDDLE STEP: HOW MANY ROUNDS, AND HOW THEY ARE PAIRED.
 *
 * A Swiss is one table, so there is nothing to arrange; what the organiser decides is the number of
 * rounds -- at most the field allows without two teams meeting twice, the server's own limit -- saved
 * the moment it is chosen. How each round is paired is not a choice: it is the competition's rule,
 * said here in words so nobody has to know what "Swiss" means.
 */
export function SwissRoundsStep({ context, onChanged }: { context: TournamentPlanContext; onChanged: () => void }) {
  const playing = context.sides.filter((s) => s.competes !== false).length
  const limit = Math.max(2, Math.min(12, swissRoundLimit(playing)))
  const chosen = context.swissRounds ?? null
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function choose(n: number) {
    if (!context.plan || n === chosen) return
    setSaving(true)
    setProblem(null)
    try {
      await setSwissRounds(supabase, context.plan.id, n)
      onChanged()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "this competition")
      logDetail("swiss rounds", failure)
      setProblem(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Number of Rounds</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          {`Every team plays once a round. ${playing} teams can play up to ${swissRoundLimit(playing)} rounds without meeting the same team twice.`}
        </Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
          {Array.from({ length: limit - 1 }, (_, i) => i + 2).map((n) => {
            const on = chosen === n
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: saving }}
                accessibilityLabel={`${n} rounds`}
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
        {!!chosen && chosen > swissRoundLimit(playing) && (
          <InfoNote>{`${chosen} rounds is more than ${playing} teams can play without a rematch. Choose fewer.`}</InfoNote>
        )}
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>How Rounds Are Paired</Text>
        <Rule n={1} text="Round 1 is drawn at random. You can swap teams on the draft before it starts." />
        <Rule n={2} text="Each later round ranks the table by points, then your tie-breakers, and pairs teams on the same points. No two teams ever meet twice." />
        <Rule n={3} text="With an odd number of teams, the lowest-placed team that has not had a bye sits the round out and is awarded a win. Nobody has more than one." />
        <Rule n={4} text="Kick-off times for every round are reserved when you generate. Each round is paired the moment the round before it has confirmed results, and teams are told who they play next." />
      </Card>

      {!!problem && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>}
    </>
  )
}

function Rule({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
        <Text style={[type.caption, { color: colour.ink }]}>{n}</Text>
      </View>
      <Text style={[type.small, { flex: 1, color: colour.inkMuted, lineHeight: 20 }]}>{text}</Text>
    </View>
  )
}

/**
 * THE DRAFT'S SWISS ROUNDS: who sits out, which rounds are booked but not yet paired, and the
 * organiser's swap for the round about to start. Everything here is read from the server's draft; the
 * swap is the server's to allow or refuse (never into a rematch, a second bye, or a started round).
 */
export function SwissDraftCard({
  planId, tables, byes, upcoming, onChanged,
}: {
  planId: string
  tables: DraftTableGroup[]
  byes: SwissBye[]
  upcoming: SwissUpcomingRound[]
  onChanged: () => void
}) {
  const [swapping, setSwapping] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // THE ROUND ABOUT TO BE PLAYED: the latest paired round, and the sides in it (its bye included).
  const current = useMemo(() => {
    const rounds = tables.flatMap((t) => t.rounds)
    const latest = rounds.reduce((n, r) => Math.max(n, r.round), 0)
    const games = rounds.filter((r) => r.round === latest).flatMap((r) => r.games)
    const sides = new Map<string, string>()
    for (const g of games) {
      sides.set(g.sideA.participantId, g.sideA.clubName)
      sides.set(g.sideB.participantId, g.sideB.clubName)
    }
    const bye = byes.find((b) => b.round === latest)
    if (bye) sides.set(bye.participantId, bye.clubName)
    return { round: latest, sides: [...sides.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) }
  }, [tables, byes])

  async function swap() {
    if (picked.length !== 2) return
    setBusy(true)
    setProblem(null)
    try {
      await swapSwissSides(supabase, planId, picked[0]!, picked[1]!)
      setSwapping(false)
      setPicked([])
      onChanged()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "this round")
      logDetail("swiss swap", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Swiss Rounds</Text>
      {byes.map((b) => (
        <Text key={`bye-${b.round}`} style={[type.small, { color: colour.ink, lineHeight: 20 }]}>
          {`Round ${b.round}: ${b.clubName} has a bye and is awarded a win.`}
        </Text>
      ))}
      {upcoming.map((r) => (
        <View key={`up-${r.round}`} style={{ gap: 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colour.lineStrong }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{`Round ${r.round}`}</Text>
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            {[r.startTime ? String(r.startTime).slice(0, 5) : "No kick-off yet", r.pitchName].filter(Boolean).join(" · ")}
            {` · paired when Round ${r.round - 1} has confirmed results`}
          </Text>
        </View>
      ))}
      {current.round > 0 && (
        <Button label={`Swap Teams in Round ${current.round}`} variant="secondary" onPress={() => { setProblem(null); setPicked([]); setSwapping(true) }} />
      )}
      {!!problem && !swapping && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>}

      <Modal visible={swapping} transparent animationType="fade" onRequestClose={() => setSwapping(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "center", padding: space.lg }}>
          <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, maxHeight: "80%" }}>
            <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>{`Swap Teams in Round ${current.round}`}</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>Choose two teams. Each takes the other's opponent, or bye.</Text>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.xs }}>
              {current.sides.map((s) => {
                const on = picked.includes(s.id)
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={s.name}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : p.length < 2 ? [...p, s.id] : [p[1]!, s.id]))}
                    style={({ pressed }) => ({
                      minHeight: 44, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.md,
                      borderWidth: 1, borderColor: on ? colour.forest800 : colour.line,
                      backgroundColor: on ? colour.chalk : colour.surface, opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={[type.small, { color: colour.ink }]}>{s.name}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
            {!!problem && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>}
            <Button label="Swap Teams" busy={busy} disabled={picked.length !== 2} onPress={() => void swap()} />
            <Button label="Cancel" variant="secondary" onPress={() => setSwapping(false)} />
          </View>
        </View>
      </Modal>
    </Card>
  )
}
