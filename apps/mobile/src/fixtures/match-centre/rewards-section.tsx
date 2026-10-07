import { useState } from "react"
import { Pressable, Text, View } from "react-native"

import {
  awardStateLine,
  castMatchAwardVote,
  closeMatchAward,
  giveMatchAward,
  openMatchAward,
  readRecognitionSquad,
  type MatchAward,
  type MatchRewards,
} from "@ovalball/contracts/match-centre/rewards"

import { supabase } from "../../auth/supabase"
import { AwardBadge } from "../../components/player-identity"
import { ChoiceSheet } from "../../components/field-sheet"
import { Button } from "../../components/ui"
import { friendly } from "../../errors/translate"
import { colour, radius, space, type } from "../../design/tokens"
import type { MatchCentreView } from "../../match-centre/load"

/**
 * REWARDS & RECOGNITION -- the four awards the side runs (club default, team override), each with
 * where it stands and only the action this viewer may take:
 *
 *   Parents' Player of the Match -- a vote, one per child, opening at kick-off
 *   Coaches' Player of the Match and the Beast Award -- chosen by the side's coaches and staff
 *   Opposition Player of the Match -- chosen by the OTHER side, from this side's names only
 *
 * Totals are never shown to the team; the winner is. The server refuses anything a client offers in
 * error -- a vote before kick-off, a second vote for one child, a parent giving a coach's award.
 */
const AUDIENCE: Record<MatchAward["electorate"], string> = {
  FAMILY_OR_SELF: "Parents",
  TEAM_COACHES: "Coaches",
  OPPOSITION_COACHES: "Opposition",
}

export function RewardsSection({ view, rewards, onChanged }: { view: MatchCentreView; rewards: MatchRewards | null; onChanged: () => void }) {
  const [picker, setPicker] = useState<null | { award: MatchAward; mode: "vote" | "give"; forPlayerId?: string; forName?: string; options: { id: string; name: string }[]; value: string | null }>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!rewards) return null
  const sides: ("home" | "away")[] = ["home", "away"]
  const sideName = (s: "home" | "away") => (s === "home" ? view.home : view.away)

  async function choosePlayer(award: MatchAward, mode: "vote" | "give", forPlayerId?: string, forName?: string, current?: string | null) {
    setProblem(null)
    try {
      const squad = await readRecognitionSquad(supabase, view.fixtureId, award.teamId)
      setPicker({ award, mode, forPlayerId, forName, options: squad.map((p) => ({ id: p.playerId, name: p.name })), value: current ?? null })
    } catch (caught) {
      setProblem(friendly(caught, "the squad").message)
    }
  }

  async function act(work: () => Promise<void>, done: string) {
    setBusy(true)
    setProblem(null)
    try {
      await work()
      setNotice(done)
      setPicker(null)
      onChanged()
    } catch (caught) {
      setProblem(friendly(caught, "this award").message)
    } finally {
      setBusy(false)
    }
  }

  if (rewards.awards.length === 0) {
    return (
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Awards & Recognition</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>Neither side runs match awards yet. A club sets its default awards, and a team can switch them on for itself.</Text>
      </View>
    )
  }

  return (
    <View style={{ gap: space.lg }}>
      {!!notice && (
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: colour.successSurface, borderRadius: radius.lg, padding: space.md }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{notice}</Text>
        </View>
      )}
      {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}

      {sides.map((s) => {
        const awards = rewards.awards.filter((a) => a.side === s)
        if (awards.length === 0) return null
        return (
          <View key={s} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
            <View>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Awards & Recognition</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{[sideName(s).clubName, sideName(s).teamName].filter(Boolean).join(" · ")}</Text>
            </View>

            {/* THE BADGE FAMILY, as the side runs it. */}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {awards.map((a) => (
                <View key={a.categoryKey} style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk }}>
                  <AwardBadge categoryKey={a.categoryKey} size={48} label={a.name} />
                  <Text numberOfLines={3} style={[type.caption, { color: colour.ink, textAlign: "center", fontSize: 11, lineHeight: 13 }]}>{a.name}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10 }]}>{AUDIENCE[a.electorate]}</Text>
                </View>
              ))}
            </View>

            {awards.map((a) => (
              <View key={`row-${a.categoryKey}`} style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.md, gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <AwardBadge categoryKey={a.categoryKey} size={36} label={a.name} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{a.state === "DECIDED" && a.winner ? (a.winner.displayName ?? a.winner.firstName) : a.name}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{a.state === "DECIDED" && a.winner ? a.name : awardStateLine(a)}</Text>
                    {a.state === "OPEN" && a.votingClosesAt && <Text style={[type.caption, { color: colour.inkMuted }]}>Voting closes {when(a.votingClosesAt)}</Text>}
                    {a.totalVotes !== null && <Text style={[type.caption, { color: colour.inkMuted }]}>{a.totalVotes} {a.totalVotes === 1 ? "vote" : "votes"} cast (staff only)</Text>}
                  </View>
                  <StatePill award={a} />
                </View>

                {/* ONE VOTE PER CHILD. */}
                {a.state === "OPEN" &&
                  a.voteEntitlements.map((e) => {
                    const chosen = e.myVotePlayerId
                    return (
                      <Button
                        key={e.playerId}
                        label={chosen ? `Change ${e.firstName}'s Vote` : a.voteEntitlements.length > 1 ? `Vote for ${e.firstName}'s Family` : "Cast Your Vote"}
                        variant={chosen ? "secondary" : "primary"}
                        onPress={() => void choosePlayer(a, "vote", e.playerId, e.firstName, chosen)}
                      />
                    )
                  })}
                {a.state === "OPEN" && a.voteEntitlements.some((e) => e.myVotePlayerId) && (
                  <Text style={[type.caption, { color: colour.forest800 }]}>Your vote is in. You can change it until voting closes.</Text>
                )}

                {a.canGive && (
                  <Button
                    label={a.state === "DECIDED" ? "Change the Winner" : `Choose the ${a.electorate === "OPPOSITION_COACHES" ? "Opposition " : ""}Winner`}
                    variant={a.state === "DECIDED" ? "secondary" : "primary"}
                    onPress={() => void choosePlayer(a, "give", undefined, undefined, a.winner?.playerId ?? null)}
                  />
                )}
                {a.canOpen && (
                  <Button label="Open Voting" busy={busy} onPress={() => void act(() => openMatchAward(supabase, { fixtureId: view.fixtureId, teamId: a.teamId, categoryKey: a.categoryKey }), "Voting is open.")} />
                )}
                {a.canClose && a.awardId && (
                  <Button label="Close Voting" variant="secondary" busy={busy} onPress={() => void act(() => closeMatchAward(supabase, a.awardId!), "Voting is closed.")} />
                )}
              </View>
            ))}
          </View>
        )
      })}

      {picker && (
        <ChoiceSheet
          visible
          title={picker.mode === "vote" ? (picker.forName && picker.award.voteEntitlements.length > 1 ? `${picker.award.name} · ${picker.forName}'s Vote` : picker.award.name) : picker.award.name}
          hint={picker.mode === "vote" ? "Choose who stood out for the team." : "Choose the player. The family is told."}
          options={picker.options}
          value={picker.value}
          emptyMessage="There is nobody in this squad to choose yet."
          onClose={() => setPicker(null)}
          saving={busy}
          problem={problem}
          onSave={(playerId) => {
            if (!playerId) return
            const award = picker.award
            if (picker.mode === "vote" && award.awardId && picker.forPlayerId) {
              void act(() => castMatchAwardVote(supabase, { awardId: award.awardId!, playerId, forPlayerId: picker.forPlayerId! }), "Your vote has been recorded.")
            } else if (picker.mode === "give") {
              void act(() => giveMatchAward(supabase, { fixtureId: view.fixtureId, teamId: award.teamId, categoryKey: award.categoryKey, playerId }), `${award.name} awarded.`)
            }
          }}
        />
      )}
    </View>
  )
}

function StatePill({ award }: { award: MatchAward }) {
  const map: Record<MatchAward["state"], { label: string; ink: string; ground: string }> = {
    OPENS_AT_KICKOFF: { label: "After Kick-off", ink: colour.inkMuted, ground: colour.chalk },
    NOT_STARTED: { label: "Not Started", ink: colour.inkMuted, ground: colour.chalk },
    OPEN: { label: "Open Now", ink: colour.forest800, ground: colour.successSurface },
    DECIDED: { label: award.outcome === "WINNER" ? "Awarded" : "Closed", ink: award.outcome === "WINNER" ? colour.forest800 : colour.inkMuted, ground: award.outcome === "WINNER" ? colour.successSurface : colour.chalk },
    CANCELLED: { label: "Cancelled", ink: colour.danger, ground: colour.dangerSurface },
  }
  const p = map[award.state]
  return (
    <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: p.ground }}>
      <Text style={[type.caption, { color: p.ink, fontFamily: "Inter_600SemiBold" }]}>{p.label}</Text>
    </View>
  )
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}
