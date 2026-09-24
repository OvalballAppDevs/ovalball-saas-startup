import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { ADDITIONAL_SQUAD_LETTERS, resolveStructuredFields, type TeamCategoryGroup, type TeamOptionAvailability } from "@ovalball/contracts/teams/catalog"
import { fullTeamLabel } from "@ovalball/contracts/teams/compact-label"
import { createClubTeam, readClubTeams, readTeamCatalogue, readTeamCapabilities, teamErrorMessage, type RugbyCode } from "@ovalball/contracts/club/teams"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { CODE_LABEL } from "../../../../src/hub/bundles"
import { Button, Card, CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ADD A TEAM -- from the Team Directory, natively (CA-M2).
 *
 * The picker is the website's: the one canonical catalogue (`canonical_team_types` projected for
 * the club's code by `canonical_team_types_by_code`), the same availability rules (already added,
 * folded so reactivate instead, B/C only once the first side exists). What is sent is the entry's
 * stable KEY and an optional squad letter; `create_club_team` decides every structured field from
 * the Directory and the triggers derive the name. No label is parsed, on either client.
 */
export default function NewTeamScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const [rugbyCode, setRugbyCode] = useState<RugbyCode | null>(null)
  const [groups, setGroups] = useState<TeamCategoryGroup[]>([])
  const [availability, setAvailability] = useState<TeamOptionAvailability[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const [squad, setSquad] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setError(null)
    try {
      const [directory, caps] = await Promise.all([readClubTeams(supabase, clubId), readTeamCapabilities(supabase, clubId)])
      setCanManage(caps.manage)
      setRugbyCode(directory.rugbyCode)
      if (directory.rugbyCode) {
        const cat = await readTeamCatalogue(supabase, directory.rugbyCode, directory.teams)
        setGroups(cat.groups)
        setAvailability(cat.availability)
      }
    } catch (cause) {
      const translated = friendly(cause, "the Team Directory")
      logDetail("admin:teams:new", translated)
      setError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])
  useEffect(() => {
    void load()
  }, [load])

  const chosen = availability.find((a) => a.option.key === chosenKey) ?? null
  const preview = chosen ? fullTeamLabel({ ...resolveStructuredFields(chosen.option, chosen.option.allowAdditionalSquads ? squad : null), rugbyCode: rugbyCode ?? undefined }) : null

  async function add() {
    if (!clubId || !chosen) return
    setBusy(true)
    setProblem(null)
    try {
      const id = await createClubTeam(supabase, clubId, chosen.option.key, chosen.option.allowAdditionalSquads ? squad : null)
      router.replace(`/admin/teams/${id}` as never)
    } catch (cause) {
      setProblem(teamErrorMessage(cause, friendly(cause, "the team").message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminScreen section="Add Team">
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Add Team
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>
          {rugbyCode ? `From the ${CODE_LABEL[rugbyCode]} Team Directory. ` : ""}Pick the side; its age grade, pathway and name are the Directory's.
        </Text>
      </View>

      {loading && <CardSkeleton lines={4} />}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {!loading && !error && !rugbyCode && <ErrorState message="This club's rugby code is not recorded, so no Team Directory can be offered." />}
      {!loading && !error && rugbyCode && groups.length === 0 && <ErrorState message="The Team Directory is not available right now." onRetry={() => void load()} />}
      {!loading && !canManage && <ErrorState message="Adding a team needs the club's teams permission." />}

      {canManage &&
        groups.map((g) => (
          <View key={g.label} style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>{g.label.toUpperCase()}</Text>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {g.options.map((o, i) => {
                const a = availability.find((x) => x.option.key === o.key)
                const primary = a?.primary ?? { state: "addable" as const }
                const active = chosenKey === o.key
                const disabled = primary.state === "active" && !o.allowAdditionalSquads
                const note = primary.state === "active" ? (o.allowAdditionalSquads ? "First side added — add a B or C squad" : "Already added") : primary.state === "inactive" ? "Folded — reactivate it from Teams" : null
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: disabled || primary.state === "inactive" }}
                    accessibilityLabel={`${o.label}${note ? `. ${note}` : ""}`}
                    disabled={disabled || primary.state === "inactive"}
                    onPress={() => { setChosenKey(o.key); setSquad(primary.state === "active" ? "B" : null); setProblem(null) }}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: active ? colour.mint100 : pressed ? "rgba(16,21,18,0.03)" : "transparent", opacity: disabled || primary.state === "inactive" ? 0.5 : 1 })}
                  >
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: active ? colour.forest800 : colour.lineStrong, backgroundColor: active ? colour.forest800 : "transparent" }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{o.label}</Text>
                      {note && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{note}</Text>}
                    </View>
                  </Pressable>
                )
              })}
            </Card>
          </View>
        ))}

      {chosen && (
        <Card style={{ gap: space.md }}>
          {chosen.option.allowAdditionalSquads && (
            <View style={{ gap: 6 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Squad</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Squad" style={{ flexDirection: "row", gap: space.sm }}>
                {[null, ...ADDITIONAL_SQUAD_LETTERS].map((letter) => {
                  const state = letter ? chosen.additionalSquads[letter] : chosen.primary
                  const taken = state?.state === "active" || state?.state === "inactive"
                  const blocked = state?.state === "blocked_primary_inactive"
                  const on = squad === letter
                  return (
                    <Pressable key={letter ?? "first"} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: taken || blocked }} accessibilityLabel={letter ? `${letter} squad` : "First side"} disabled={taken || blocked} onPress={() => setSquad(letter)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center", opacity: taken || blocked ? 0.5 : 1 }}>
                      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{letter ? `${letter} squad` : "First side"}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}
          <Text style={[type.small, { color: colour.inkMuted }]}>
            Will be called <Text style={{ fontFamily: "Inter_600SemiBold", color: colour.ink }}>{preview}</Text>
          </Text>
          {problem && (
            <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
              <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>
            </View>
          )}
          <Button label="Add Team" onPress={() => void add()} busy={busy} />
        </Card>
      )}
    </AdminScreen>
  )
}
