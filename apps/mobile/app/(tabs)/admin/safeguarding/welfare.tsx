import { useEffect, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { lookupWelfare, safeguardingErrorMessage, searchWelfareCandidates, type WelfareCandidate, type WelfareRecord } from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../src/admin/screen"
import { supabase } from "../../../../src/auth/supabase"
import { Search } from "../../../../src/components/icons"
import { Button, Card } from "../../../../src/components/ui"
import { friendly } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * WELFARE LOOKUP (CA-M11.1): the officer's reasoned read of one player's team and guardian contact,
 * through `welfare_member_view`. The server refuses without a reason and records the reason given as
 * a security event against the officer, the club and the player; the screen says so before the
 * lookup is made. Nothing is listed until it is asked for, and nothing is kept once the screen is left.
 */
export default function SafeguardingWelfareScreen() {
  const [query, setQuery] = useState("")
  const [candidates, setCandidates] = useState<WelfareCandidate[]>([])
  const [chosen, setChosen] = useState<WelfareCandidate | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [record, setRecord] = useState<WelfareRecord[] | null>(null)

  useEffect(() => {
    if (chosen) return
    let live = true
    const t = setTimeout(() => {
      searchWelfareCandidates(supabase, query)
        .then((c) => live && setCandidates(c))
        .catch(() => live && setCandidates([]))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, chosen])

  async function lookUp() {
    if (!chosen || !reason.trim()) return
    setBusy(true)
    setProblem(null)
    try {
      setRecord(await lookupWelfare(supabase, chosen.playerId, reason))
    } catch (cause) {
      setProblem(safeguardingErrorMessage(cause, friendly(cause, "this lookup").message))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setChosen(null)
    setReason("")
    setRecord(null)
    setProblem(null)
    setQuery("")
  }

  return (
    <AdminScreen section="Welfare Lookup">
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Welfare Lookup
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>A player's team and guardian contact, for a stated reason. Every lookup is recorded against you with the reason you give.</Text>
      </View>

      {!chosen && (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput accessibilityLabel="Search players" value={query} onChangeText={setQuery} placeholder="Player's name" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
          </View>
          {query.trim().length >= 2 && candidates.length === 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>No player by that name is visible to you.</Text>}
          {candidates.length > 0 && (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {candidates.map((c, i) => (
                <Pressable key={c.playerId} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => setChosen(c)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, paddingHorizontal: space.lg, justifyContent: "center", borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
                  <Text style={[type.small, { color: colour.ink }]}>{c.name}</Text>
                </Pressable>
              ))}
            </Card>
          )}
        </View>
      )}

      {chosen && !record && (
        <Card style={{ gap: space.md }}>
          <Text style={[type.heading, { color: colour.ink }]}>{chosen.name}</Text>
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Reason</Text>
            <TextInput
              accessibilityLabel="Reason"
              value={reason}
              onChangeText={setReason}
              editable={!busy}
              multiline
              maxLength={500}
              placeholder="Recorded with the lookup"
              placeholderTextColor={colour.inkSubtle}
              style={[type.body, { minHeight: 72, padding: space.md, textAlignVertical: "top", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
            />
          </View>
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {problem}
            </Text>
          )}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Cancel" variant="secondary" onPress={reset} disabled={busy} style={{ flex: 1 }} />
            <Button label="Look Up" onPress={() => void lookUp()} busy={busy} disabled={!reason.trim()} style={{ flex: 2 }} />
          </View>
        </Card>
      )}

      {chosen && record && (
        <View style={{ gap: space.md }}>
          {record.length === 0 && (
            <Card>
              <Text style={[type.small, { color: colour.inkMuted }]}>No welfare record could be read for {chosen.name}.</Text>
            </Card>
          )}
          {record.map((r, i) => (
            <Card key={i} style={{ gap: space.xs }}>
              <Text style={[type.heading, { color: colour.ink }]}>{r.playerName}</Text>
              <Field label="Team" value={r.teamName} />
              <Field label="Guardian" value={r.guardianName} />
              <Field label="Guardian contact" value={r.guardianContact} />
              <Field label="Guardian relationship" value={r.guardianState ? r.guardianState.charAt(0) + r.guardianState.slice(1).toLowerCase() : null} />
            </Card>
          ))}
          <Text style={[type.caption, { color: colour.inkSubtle }]}>This lookup has been recorded with your reason.</Text>
          <Button label="Done" variant="secondary" onPress={reset} />
        </View>
      )}
    </AdminScreen>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <Text style={[type.small, { color: colour.inkMuted, width: 140 }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{value ?? "Not recorded"}</Text>
    </View>
  )
}
