import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  canOpenGuardiansPlayers,
  readClubPlayerDirectory,
  readClubPlayerMoves,
  readDuplicateReviews,
  readGuardianLinkRequests,
  readPendingTeamPlaces,
  readPlayerJoinRequests,
  type GuardiansPlayersCapabilities,
} from "@ovalball/contracts/club/guardians-players"

import { AdminScreen } from "../../../../src/admin/screen"
import { todayIso, useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * GUARDIANS & PLAYERS -- the overview (CA-M11.1).
 *
 * The website spreads a club's player and guardian administration over six pages; the phone gathers
 * the same jobs in one place. WAITING ON YOU are the queues a person may decide -- guardian link
 * requests, players asking to join, possible duplicates, places a parent added, call-ups and
 * dispensations at a stage this club decides -- each counted only where the server's capability read
 * says so. Below them, the directories. Nothing here is authority: every count is what the caller may
 * already read, and every decision is refused again by the database.
 */
interface Counts {
  players: number
  needGuardian: number
  guardians: number
  linkRequests: number
  pendingPlaces: number
  joinRequests: number
  duplicates: number
  callUpsWaiting: number
  dispensationsWaiting: number
}

export default function GuardiansPlayersOverview() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps, refresh } = useGuardiansPlayersAccess()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const generation = useRef(0)

  const load = useCallback(
    async (c: GuardiansPlayersCapabilities) => {
      if (!clubId || !canOpenGuardiansPlayers(c)) return
      const gen = ++generation.current
      setError(null)
      try {
        const directory = await readClubPlayerDirectory(supabase, clubId, c)
        const [links, places, joins, duplicates, moves] = await Promise.all([
          readGuardianLinkRequests(supabase, clubId).catch(() => []),
          readPendingTeamPlaces(supabase, directory.teams).catch(() => []),
          c.joinRequestReview ? readPlayerJoinRequests(supabase, clubId).catch(() => []) : Promise.resolve([]),
          c.duplicateResolve ? readDuplicateReviews(supabase, directory.teams).catch(() => []) : Promise.resolve([]),
          c.callupRequest || c.callupApprove || c.dispensationRequest || c.dispensationApproveClub ? readClubPlayerMoves(supabase, clubId, c, todayIso()).catch(() => null) : Promise.resolve(null),
        ])
        if (gen !== generation.current) return
        const guardianIds = new Set(directory.players.flatMap((p) => p.guardians.map((g) => g.guardianUserId || g.guardianId)))
        setCounts({
          players: directory.players.length,
          needGuardian: directory.players.filter((p) => p.needsGuardian).length,
          guardians: guardianIds.size,
          linkRequests: links.length,
          pendingPlaces: places.length,
          joinRequests: joins.length,
          duplicates: duplicates.length,
          callUpsWaiting: c.callupApprove ? (moves?.callUps.filter((r) => r.canDecide && r.status === "requested").length ?? 0) : 0,
          dispensationsWaiting: c.dispensationApproveClub ? (moves?.dispensations.filter((r) => r.status === "source_team_approved" || r.status === "club_approved" || (r.canDecideSourceTeam && r.status === "requested")).length ?? 0) : 0,
        })
      } catch (cause) {
        const translated = friendly(cause, "guardians and players")
        logDetail("admin:guardians", translated)
        if (gen === generation.current) setError(translated)
      }
    },
    [clubId]
  )

  useEffect(() => {
    if (!accessLoading) void load(caps)
  }, [accessLoading, caps, load])
  useFocusEffect(
    useCallback(() => {
      if (!accessLoading) void load(caps)
    }, [accessLoading, caps, load])
  )

  const may = canOpenGuardiansPlayers(caps)
  const go = (screen: string) => router.push(`/admin/guardians/${screen}` as never)

  return (
    <AdminScreen section="Guardians & Players" onRefresh={() => void refresh().then(() => load(caps))} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Guardians & Players
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Who plays for the club, who is responsible for them, and what is waiting for a decision.</Text>
      </View>

      {accessLoading && <CardSkeleton lines={3} />}
      {!accessLoading && !clubId && <EmptyState title="Choose a club context" body="This section works on the club you are viewing." />}
      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="Approving who looks after which player is done by the people the club has given that job to." />}

      {may && error && <ErrorState message={error.message} onRetry={() => void load(caps)} offline={error.retryable} />}
      {may && !error && !counts && <CardSkeleton lines={4} />}

      {may && counts && (
        <>
          <Group title="Waiting on You">
            <Row label="Guardian Link Requests" caption="Adults asking to be recognised as a parent or guardian" count={counts.linkRequests} onPress={() => go("link-requests")} />
            {caps.joinRequestReview && <Row label="Players Asking to Join" caption="Choose which side each one joins" count={counts.joinRequests} onPress={() => go("join-requests")} />}
            {caps.duplicateResolve && <Row label="Possible Duplicate Players" caption="Is this the same child as one already here?" count={counts.duplicates} onPress={() => go("duplicates")} />}
            {caps.rosterManage && <Row label="Places to Confirm" caption="A parent added a child directly to a side" count={counts.pendingPlaces} onPress={() => router.push({ pathname: "/admin/guardians/players", params: { filter: "pending" } } as never)} />}
            {(caps.callupApprove || caps.dispensationApproveClub) && <Row label="Player Moves to Decide" caption="Call-ups and dispensations at this club's stage" count={counts.callUpsWaiting + counts.dispensationsWaiting} onPress={() => go("moves")} />}
          </Group>

          <Group title="Directory">
            <Row label="Players" caption={counts.needGuardian > 0 ? `${counts.players} players · ${counts.needGuardian} need a guardian` : `${counts.players} players`} count={counts.needGuardian} tone="warning" onPress={() => go("players")} />
            <Row label="Guardians" caption={`${counts.guardians} parents and guardians linked to players here`} onPress={() => go("guardians")} />
            {(caps.callupRequest || caps.callupApprove || caps.dispensationRequest || caps.dispensationApproveClub) && <Row label="Player Moves" caption="Call-ups for a fixture and dispensations for a season" onPress={() => go("moves")} />}
          </Group>
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

function Row({ label, caption, count, tone = "attention", onPress }: { label: string; caption: string; count?: number; tone?: "attention" | "warning"; onPress: () => void }) {
  const badge = count !== undefined && count > 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${count} waiting. ${caption}` : `${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      {badge && (
        <View style={{ minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: tone === "warning" ? colour.warningSurface : colour.forest800 }}>
          <Text style={[type.caption, { color: tone === "warning" ? colour.warning : colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{count}</Text>
        </View>
      )}
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
