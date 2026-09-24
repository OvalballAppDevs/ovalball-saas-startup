import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { readClubTeams, readTeamCapabilities, type ClubTeam, type ClubTeamsDirectory, type TeamCapabilities } from "@ovalball/contracts/club/teams"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { CODE_LABEL } from "../../../../src/hub/bundles"
import { ChevronRight } from "../../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * TEAMS -- the club's sides as CONFIGURATION, natively (CA-M2). Not operations: no fixtures,
 * availability or messages here. Each side is a canonical Team Directory identity the club has
 * activated; its name is derived from that identity, its group comes from the one shared taxonomy,
 * and its code is the club's. Folded sides sit in their own group and can be brought back.
 */
export default function TeamsScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const [data, setData] = useState<ClubTeamsDirectory | null>(null)
  const [caps, setCaps] = useState<TeamCapabilities>({ view: false, manage: false, lifecycle: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setData(null)
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [next, allowed] = await Promise.all([readClubTeams(supabase, clubId), readTeamCapabilities(supabase, clubId)])
      setData(next)
      setCaps(allowed)
    } catch (cause) {
      const translated = friendly(cause, "the club's teams")
      logDetail("admin:teams", translated)
      setError(translated)
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => {
    setData(null)
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  return (
    <AdminScreen section="Teams" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Teams
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>
          The sides the club runs{data?.rugbyCode ? ` in ${CODE_LABEL[data.rugbyCode]}` : ""}. A side is a Team Directory identity: its age grade and pathway are the identity's, and its name follows from them.
        </Text>
      </View>

      {loading && !data && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {data && (
        <>
          {caps.manage && <Button label="Add Team" variant="secondary" onPress={() => router.push("/admin/teams/new")} />}
          {data.groups.length === 0 && <EmptyState title="No teams yet" body={caps.manage ? "Add the club's first side from the Team Directory." : "The club has not activated a side yet."} />}
          {data.groups.map(({ group, teams }) => (
            <Group key={group.key} title={group.title}>
              {teams.map((t) => (
                <TeamRow key={t.id} team={t} onPress={() => router.push(`/admin/teams/${t.id}` as never)} />
              ))}
            </Group>
          ))}
          {data.folded.length > 0 && (
            <Group title="Folded">
              {data.folded.map((t) => (
                <TeamRow key={t.id} team={t} muted onPress={() => router.push(`/admin/teams/${t.id}` as never)} />
              ))}
            </Group>
          )}
        </>
      )}
    </AdminScreen>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>{children}</View>
    </View>
  )
}

function TeamRow({ team, muted = false, onPress }: { team: ClubTeam; muted?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${team.fullLabel}. ${team.compactLabel}${team.alias ? `, known as ${team.alias}` : ""}${muted ? ". Folded" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent", opacity: muted ? 0.7 : 1 })}
    >
      <View style={{ minWidth: 64, paddingVertical: 4, paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: colour.mint100, alignItems: "center" }}>
        <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>{team.compactLabel}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{team.fullLabel}</Text>
        {team.alias && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Known as {team.alias}</Text>}
      </View>
      {muted ? <StatusPill label="Folded" tone="caution" /> : <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}
