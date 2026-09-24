import { useCallback, useEffect, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { aliasAllowed, clearTeamAlias, foldTeam, reactivateTeam, readClubTeams, readTeamCapabilities, setTeamAlias, teamErrorMessage, type ClubTeam, type TeamCapabilities } from "@ovalball/contracts/club/teams"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { CODE_LABEL } from "../../../../src/hub/bundles"
import { Button, Card, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { formatDate } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ONE TEAM'S CONFIGURATION, natively (CA-M2).
 *
 * The identity is shown and NOT edited: age grade, pathway, code and name are the Team Directory's
 * and are moved only by Season Handover, on both clients. What the club may do here is what the
 * website lets it do: give a B or C squad a name of its own (`set_team_alias` / `clear_team_alias`,
 * team.team.manage), and fold or reactivate the side (`fold_team` / `reactivate_team`,
 * team.lifecycle.manage -- the capability the operations themselves ask, never a role). Folding
 * needs a reason, cancels the side's future fixtures and tells any Ovalball opponent; nothing is
 * deleted, and the number of fixtures affected is what the server reports back.
 */
export default function TeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const [team, setTeam] = useState<ClubTeam | null>(null)
  const [caps, setCaps] = useState<TeamCapabilities>({ view: false, manage: false, lifecycle: false })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [alias, setAlias] = useState("")
  const [reason, setReason] = useState("")
  const [confirmFold, setConfirmFold] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!clubId || !teamId) {
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const [dir, allowed] = await Promise.all([readClubTeams(supabase, clubId), readTeamCapabilities(supabase, clubId)])
      const found = dir.teams.find((t) => t.id === teamId) ?? null
      setTeam(found)
      setCaps(allowed)
      setAlias((a) => (a === "" && found?.alias ? found.alias : a))
    } catch (cause) {
      const translated = friendly(cause, "this team")
      logDetail("admin:team", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId, teamId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function run(op: () => Promise<string | void>, subject: string) {
    setBusy(true)
    setMessage(null)
    try {
      const done = await op()
      await load()
      if (done) setMessage({ tone: "ok", text: done })
    } catch (cause) {
      setMessage({ tone: "error", text: teamErrorMessage(cause, friendly(cause, subject).message) })
      if ((cause as { code?: string }).code === "42501") {
        setCaps((c) => ({ ...c, manage: false, lifecycle: false }))
        void refreshAccess()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminScreen section={team?.fullLabel ?? "Team"} onRefresh={() => void load()} refreshing={false}>
      {loading && !team && <CardSkeleton lines={4} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {!loading && !loadError && !team && <ErrorState message="This team is not available to you." />}

      {team && (
        <>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {team.fullLabel}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <StatusPill label={team.compactLabel} tone="neutral" />
              <StatusPill label={CODE_LABEL[team.rugbyCode]} tone="neutral" />
              {!team.active && <StatusPill label="Folded" tone="caution" />}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Identity
            </Text>
            <Card style={{ gap: space.sm }}>
              <Row label="Team Directory" value={team.canonicalKey ?? "Not mapped"} />
              <Row label="Age Grade" value={team.ageGroup ?? (team.category === "senior" ? "Open age" : "—")} />
              <Row label="Pathway" value={team.gender ? team.gender[0].toUpperCase() + team.gender.slice(1) : "Not recorded"} />
              <Row label="Squad" value={team.squadDesignation ?? "First side"} />
              <Row label="Rugby Code" value={CODE_LABEL[team.rugbyCode]} />
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: space.xs }]}>Age grade and identity are progressed through Season Handover, not edited here. This is the identity Rugby Hub, Rules of Play and fixture matching read.</Text>
            </Card>
          </View>

          {aliasAllowed(team) && (
            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                Squad Name
              </Text>
              <Card style={{ gap: space.md }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>What the club calls this squad — "Blacks" rather than "B". The canonical identity is untouched; only what is printed changes.</Text>
                <TextInput accessibilityLabel="Squad Name" value={alias} onChangeText={setAlias} editable={caps.manage && !busy} autoCapitalize="words" placeholder="e.g. Blacks" placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: caps.manage ? colour.surface : "rgba(16,21,18,0.03)", color: colour.ink }]} />
                {caps.manage && (
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    {team.alias && <Button label="Clear Name" variant="secondary" onPress={() => void run(async () => { await clearTeamAlias(supabase, team.id); setAlias(""); return "Squad name cleared." }, "the squad name")} disabled={busy} style={{ flex: 1 }} />}
                    <Button label="Save Name" onPress={() => void run(async () => { await setTeamAlias(supabase, team.id, alias); return "Squad name saved." }, "the squad name")} busy={busy} disabled={!alias.trim() || alias.trim() === (team.alias ?? "")} style={{ flex: 2 }} />
                  </View>
                )}
              </Card>
            </View>
          )}

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              {team.active ? "Fold This Team" : "Folded"}
            </Text>
            <Card style={{ gap: space.md }}>
              {!team.active && (
                <Text style={[type.small, { color: colour.inkMuted }]}>
                  Folded{team.foldedAt ? ` on ${formatDate(team.foldedAt)}` : ""}{team.foldReason ? `: ${team.foldReason}` : "."} Its past fixtures and results are kept.
                </Text>
              )}
              {team.active && <Text style={[type.small, { color: colour.inkMuted }]}>Folding keeps the side and its history but cancels its future fixtures and tells any Ovalball opponent. It needs a reason, and a Club Admin can bring the side back later.</Text>}
              {!caps.lifecycle && <Text style={[type.caption, { color: colour.inkMuted }]}>Folding or reactivating needs the club's team lifecycle permission.</Text>}
              {caps.lifecycle && team.active && !confirmFold && <Button label="Fold Team" variant="quiet" onPress={() => setConfirmFold(true)} disabled={busy} />}
              {caps.lifecycle && team.active && confirmFold && (
                <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
                  <Text style={[type.smallMedium, { color: colour.warning }]}>Why is {team.fullLabel} folding?</Text>
                  <TextInput accessibilityLabel="Reason for folding" value={reason} onChangeText={setReason} editable={!busy} multiline placeholder="Not enough players this season…" placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: 72, padding: space.md, textAlignVertical: "top", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]} />
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button label="Keep Team" variant="secondary" onPress={() => { setConfirmFold(false); setReason("") }} disabled={busy} style={{ flex: 1 }} />
                    <Button label="Confirm Fold" onPress={() => void run(async () => { const n = await foldTeam(supabase, team.id, reason); setConfirmFold(false); setReason(""); return `Folded. ${n} future ${n === 1 ? "fixture was" : "fixtures were"} cancelled.` }, "this team")} busy={busy} disabled={!reason.trim()} style={{ flex: 1 }} />
                  </View>
                </View>
              )}
              {caps.lifecycle && !team.active && <Button label="Reactivate Team" onPress={() => void run(async () => { await reactivateTeam(supabase, team.id); return "Reactivated. Its fixtures were not restored automatically." }, "this team")} busy={busy} />}
              {message && (
                <View accessibilityRole={message.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: message.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
                  <Text style={[type.small, { color: message.tone === "error" ? colour.danger : colour.forest800 }]}>{message.text}</Text>
                </View>
              )}
            </Card>
          </View>
        </>
      )}
    </AdminScreen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, minHeight: 28, alignItems: "center" }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
