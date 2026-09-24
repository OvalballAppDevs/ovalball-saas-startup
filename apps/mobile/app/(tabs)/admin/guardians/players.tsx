import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { canOpenGuardiansPlayers, guardiansPlayersErrorMessage, readClubPlayerDirectory, readPendingTeamPlaces, type DirectoryPlayer, type PendingTeamPlace } from "@ovalball/contracts/club/guardians-players"
import { approveTeamPlaceRequest, declineTeamPlaceRequest } from "@ovalball/contracts/team/people"

import { AdminScreen } from "../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, Search } from "../../../../src/components/icons"
import { PersonAvatar } from "../../../../src/components/identity"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

type Filter = "all" | "needs_guardian" | "needs_gender" | "pending"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_guardian", label: "Needs a Guardian" },
  { key: "needs_gender", label: "No Gender Recorded" },
  { key: "pending", label: "Places to Confirm" },
]

/**
 * PLAYERS -- the club-wide directory the website lists on /club/settings/guardians (CA-M11.1).
 *
 * Every row is a player with an active place on one of the club's sides, read through the staff
 * projection: a name and an age grade, never a date of birth; whether a gender is recorded, never
 * which. Search and filters are client-side over the one shared read. A player is drawn with initials
 * only, as the website's club surfaces draw them. "Places to Confirm" is the website's parent-added
 * queue: a child a parent added directly, waiting for the club to confirm the side.
 */
export default function PlayersDirectory() {
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string }>()
  const { loading: accessLoading, clubId, caps } = useGuardiansPlayersAccess()
  const [players, setPlayers] = useState<DirectoryPlayer[] | null>(null)
  const [pending, setPending] = useState<PendingTeamPlace[]>([])
  const [error, setError] = useState<FriendlyError | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>(params.filter === "pending" ? "pending" : "all")
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !canOpenGuardiansPlayers(caps)) return
    const gen = ++generation.current
    setError(null)
    try {
      const directory = await readClubPlayerDirectory(supabase, clubId, caps)
      const places = caps.rosterManage ? await readPendingTeamPlaces(supabase, directory.teams).catch(() => []) : []
      if (gen !== generation.current) return
      setPlayers(directory.players)
      setPending(places)
    } catch (cause) {
      const translated = friendly(cause, "the club's players")
      logDetail("admin:guardians:players", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, accessLoading, caps])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const may = canOpenGuardiansPlayers(caps)
  const needle = query.trim().toLowerCase()
  const visible = (players ?? []).filter((p) => {
    if (filter === "needs_guardian" && !p.needsGuardian) return false
    if (filter === "needs_gender" && (!p.needsGender || p.isAdult)) return false
    if (needle && !p.name.toLowerCase().includes(needle) && !p.guardians.some((g) => g.name.toLowerCase().includes(needle))) return false
    return true
  })
  const visiblePending = pending.filter((r) => !needle || r.playerName.toLowerCase().includes(needle))

  function decidePlace(r: PendingTeamPlace, decision: "approve" | "decline") {
    setAsk(
      decision === "approve"
        ? {
            title: `Confirm ${r.playerName} on ${r.teamLabel}?`,
            body: "They join the side and their parents or guardians are told.",
            confirmLabel: "Approve",
            reason: "none",
            onConfirm: async () => {
              await approveTeamPlaceRequest(supabase, r.membershipId)
              setNotice(`${r.playerName} is on ${r.teamLabel}.`)
              await load()
            },
          }
        : {
            title: `Decline ${r.playerName}?`,
            body: "Say why. The reason is recorded and their parents or guardians are told.",
            confirmLabel: "Decline",
            destructive: true,
            reason: "required",
            onConfirm: async (reason) => {
              await declineTeamPlaceRequest(supabase, r.membershipId, reason)
              setNotice(`${r.playerName}'s place was declined.`)
              await load()
            },
          }
    )
  }

  return (
    <AdminScreen section="Players" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Players
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Every player with a place on one of the club's sides, and who is responsible for them.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="The player directory is for the people the club has given that job to." />}

      {may && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput accessibilityLabel="Search players" value={query} onChangeText={setQuery} placeholder="Search by player or guardian" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
          </View>

          <View accessibilityRole="radiogroup" accessibilityLabel="Filter players" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {FILTERS.filter((f) => f.key !== "pending" || caps.rosterManage).map((f) => {
              const on = filter === f.key
              return (
                <Pressable key={f.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={f.label} onPress={() => setFilter(f.key)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                  <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {notice && <Notice tone="ok" text={notice} />}
          {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
          {!error && players === null && (
            <View style={{ gap: space.md }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}

          {filter === "pending" && players !== null && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>PLACES TO CONFIRM</Text>
              {visiblePending.length === 0 ? (
                <EmptyState title="Nothing to confirm" body="When a parent adds a child directly to a side, the place waits here for the club." />
              ) : (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  {visiblePending.map((r, i) => (
                    <View key={r.membershipId} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{r.teamLabel}</Text>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{r.playerName}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>
                        {r.playerAgeGrade ?? "Age grade not resolved yet"} · Added by {r.guardianName}
                      </Text>
                      <View style={{ flexDirection: "row", gap: space.sm }}>
                        <Button label="Decline" variant="secondary" onPress={() => decidePlace(r, "decline")} style={{ flex: 1 }} />
                        <Button label="Approve" onPress={() => decidePlace(r, "approve")} style={{ flex: 1 }} />
                      </View>
                    </View>
                  ))}
                </Card>
              )}
            </View>
          )}

          {filter !== "pending" && players !== null && visible.length === 0 && (
            <EmptyState title={needle ? "No players match this search" : filter === "all" ? "No players yet" : "Nobody here"} body={needle ? "Try a different name." : filter === "all" ? "Players appear once they hold a place on one of the club's sides." : "Nobody matches this filter right now."} />
          )}

          {filter !== "pending" && visible.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                {visible.length} {visible.length === 1 ? "player" : "players"}
              </Text>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {visible.map((p, i) => (
                  <Pressable
                    key={p.playerId}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}. ${p.places.map((pl) => pl.compactTeamLabel).join(", ")}${p.needsGuardian ? ". Needs a guardian" : ""}`}
                    onPress={() => router.push({ pathname: "/admin/guardians/player/[playerId]", params: { playerId: p.playerId } } as never)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: TOUCH_TARGET + 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                  >
                    <PersonAvatar name={p.name} url={null} size={40} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
                        {p.places.map((pl) => pl.compactTeamLabel).join(" · ")}
                        {p.guardians.length > 0 ? ` · ${p.guardians.map((g) => g.name).join(", ")}` : ""}
                      </Text>
                    </View>
                    {p.needsGuardian && <StatusPill label="Guardian Required" tone="caution" />}
                    <ChevronRight size={17} color={colour.inkSubtle} />
                  </Pressable>
                ))}
              </Card>
            </View>
          )}
        </>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void load()} errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this place").message)} />
    </AdminScreen>
  )
}
