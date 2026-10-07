import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readArenaPreferences, saveFacilityPreferences, type ArenaPreferences, type PreferencePurpose } from "@ovalball/contracts/arena"

import { useAdminCentreAccess } from "../admin/access"
import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { ArrowDown, ChevronRight, Plus, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"
import { friendly, friendlyAction, logDetail } from "../errors/translate"
import { LeaveSheet, Sheet } from "../pitch-allocation/sheets"

export const PURPOSES: { key: PreferencePurpose; title: string; kind: "venue" | "pitch" | "room" }[] = [
  { key: "VENUE", title: "Preferred Venue", kind: "venue" },
  { key: "MATCH_PITCH", title: "Preferred Match Pitch", kind: "pitch" },
  { key: "TRAINING_PITCH", title: "Preferred Training Pitch", kind: "pitch" },
  { key: "HOME_ROOM", title: "Preferred Home Changing Room", kind: "room" },
  { key: "AWAY_ROOM", title: "Preferred Away Changing Room", kind: "room" },
  { key: "OFFICIALS_ROOM", title: "Preferred Officials Room", kind: "room" },
]

function nameOf(p: ArenaPreferences, kind: "venue" | "pitch" | "room", id: string): string {
  if (kind === "venue") return p.venues.find((v) => v.id === id)?.name ?? "Venue"
  if (kind === "pitch") {
    const pitch = p.pitches.find((x) => x.id === id)
    const venue = pitch ? p.venues.find((v) => v.id === pitch.venueId) : null
    return pitch ? `${pitch.name}${p.venues.length > 1 && venue ? ` · ${venue.name}` : ""}` : "Pitch"
  }
  const room = p.rooms.find((x) => x.id === id)
  const venue = room ? p.venues.find((v) => v.id === room.venueId) : null
  return room ? `${room.name}${p.venues.length > 1 && venue ? ` · ${venue.name}` : ""}` : "Room"
}

/**
 * TEAM PREFERENCES -- the club's default, then each team. A team that has set nothing for a purpose uses
 * the club's default; one with nothing anywhere takes any suitable resource. Preferences, never
 * assignments: automatic allocation tries them in order and the hard rules always win.
 */
export function PreferencesListScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const [prefs, setPrefs] = useState<ArenaPreferences | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      setPrefs(await readArenaPreferences(supabase, clubId))
    } catch (cause) {
      const failure = friendly(cause, "the preferences")
      logDetail("arena preferences", failure)
      setProblem(failure.message)
    }
  }, [clubId])
  useEffect(() => { void load() }, [load])

  const clubSet = prefs ? PURPOSES.filter((p) => (prefs.clubDefault[p.key] ?? []).length > 0).length : 0
  return (
    <View style={{ flex: 1, backgroundColor: surface.page }}>
      <OvalballDetailHeader title="Team Preferences" onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/arena/settings" as never))} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          Rank the venue, pitches and changing rooms each team likes to use. Automatic allocation tries them in order, and only where they are free and big enough.
        </Text>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!problem && !prefs && <CardSkeleton lines={5} />}
        {prefs && (
          <>
            <Row title="Club Default" body={clubSet === 0 ? "Nothing set: any suitable resource" : `${clubSet} of 6 set · used by every team that has not set its own`} onPress={() => router.push({ pathname: "/admin/arena/preferences/[teamId]", params: { teamId: "club" } } as never)} />
            <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>TEAMS</Text>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {prefs.teams.map((t, i) => {
                const own = PURPOSES.filter((p) => (t.preferences[p.key] ?? []).length > 0).length
                return (
                  <Pressable key={t.team.id} accessibilityRole="button" accessibilityLabel={`${t.team.displayName}. ${own === 0 ? "Uses the club default" : `${own} of 6 set`}`}
                    onPress={() => router.push({ pathname: "/admin/arena/preferences/[teamId]", params: { teamId: t.team.id } } as never)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 56, paddingHorizontal: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>{t.team.displayName}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{own === 0 ? "Uses the club default" : `${own} of 6 set · the rest use the club default`}</Text>
                    </View>
                    <ChevronRight size={16} color={colour.inkSubtle} />
                  </Pressable>
                )
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Row({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{body}</Text>
      </View>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}

/**
 * ONE TEAM'S PREFERENCES (or the club's default): six ranked lists, each with Use Club Default for a
 * team. Every change is held until Save Changes, which writes each list that changed; leaving with
 * anything unsaved asks first.
 */
export function PreferencesDetailScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { teamId: rawTeamId } = useLocalSearchParams<{ teamId: string }>()
  const isClub = rawTeamId === "club"
  const { clubId } = useAdminCentreAccess()
  const [prefs, setPrefs] = useState<ArenaPreferences | null>(null)
  const [draft, setDraft] = useState<Partial<Record<PreferencePurpose, string[]>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<PreferencePurpose | null>(null)
  const [leave, setLeave] = useState<(() => void) | null>(null)

  const team = prefs?.teams.find((t) => t.team.id === rawTeamId) ?? null
  const saved = useMemo(() => (prefs ? (isClub ? prefs.clubDefault : team?.preferences ?? {}) : {}), [prefs, isClub, team])

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const p = await readArenaPreferences(supabase, clubId)
      setPrefs(p)
      const own = rawTeamId === "club" ? p.clubDefault : p.teams.find((t) => t.team.id === rawTeamId)?.preferences ?? {}
      setDraft({ ...own })
    } catch (cause) {
      const failure = friendly(cause, "the preferences")
      logDetail("arena preferences", failure)
      setProblem(failure.message)
    }
  }, [clubId, rawTeamId])
  useEffect(() => { void load() }, [load])

  const changed = PURPOSES.filter((p) => JSON.stringify(draft[p.key] ?? []) !== JSON.stringify(saved[p.key] ?? []))
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (changed.length === 0) return
      event.preventDefault()
      setLeave(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, changed.length])

  async function save(): Promise<boolean> {
    if (!clubId || changed.length === 0) return true
    setBusy(true)
    setSaveProblem(null)
    try {
      for (const p of changed) {
        await saveFacilityPreferences(supabase, clubId, isClub ? null : rawTeamId, p.key, draft[p.key] ?? [])
      }
      await load()
      return true
    } catch (cause) {
      const failure = friendlyAction(cause, "save", "the preferences")
      logDetail("arena preferences save", failure)
      setSaveProblem(failure.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const title = isClub ? "Club Default" : team ? team.team.displayName : "Team"
  const options = (purpose: PreferencePurpose) => {
    if (!prefs) return []
    const kind = PURPOSES.find((p) => p.key === purpose)!.kind
    const taken = new Set(draft[purpose] ?? [])
    if (kind === "venue") return prefs.venues.filter((v) => !taken.has(v.id)).map((v) => v.id)
    if (kind === "pitch") return prefs.pitches.filter((v) => !taken.has(v.id)).map((v) => v.id)
    return prefs.rooms
      .filter((r) => !taken.has(r.id) && (purpose === "OFFICIALS_ROOM" ? true : r.roomType !== "match_officials"))
      .map((r) => r.id)
  }

  return (
    <View style={{ flex: 1, backgroundColor: surface.page }}>
      <OvalballDetailHeader title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/arena/preferences" as never))} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!problem && !prefs && <CardSkeleton lines={6} />}
        {prefs && (
          <>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              {isClub
                ? "Every team that has not set its own preference for something uses these."
                : "Anything this team leaves unset uses the club default. Hard rules always win: a preferred pitch is only used when it is free and big enough."}
            </Text>
            {PURPOSES.map((p) => {
              const ids = draft[p.key] ?? []
              const inherited = !isClub && ids.length === 0 ? prefs.clubDefault[p.key] ?? [] : []
              return (
                <View key={p.key} style={{ gap: space.xs, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
                  <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>{p.title}</Text>
                  {ids.length === 0 ? (
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      {!isClub && inherited.length > 0
                        ? `Using the club default: ${inherited.map((id, i) => `${i + 1}. ${nameOf(prefs, p.kind, id)}`).join(", ")}`
                        : "Any suitable"}
                    </Text>
                  ) : (
                    ids.map((id, i) => (
                      <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: TOUCH_TARGET }}>
                        <Text style={[type.smallMedium, { color: colour.forest800, width: 22 }]}>{`${i + 1}.`}</Text>
                        <Text style={[type.small, { color: colour.ink, flex: 1 }]} numberOfLines={1}>{nameOf(prefs, p.kind, id)}</Text>
                        {prefs.canManage && i < ids.length - 1 && (
                          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${nameOf(prefs, p.kind, id)} down`} onPress={() => setDraft((d) => { const next = [...(d[p.key] ?? [])]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return { ...d, [p.key]: next } })}
                            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                            <ArrowDown size={18} color={colour.inkMuted} />
                          </Pressable>
                        )}
                        {prefs.canManage && (
                          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(prefs, p.kind, id)}`} onPress={() => setDraft((d) => ({ ...d, [p.key]: (d[p.key] ?? []).filter((x) => x !== id) }))}
                            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                            <X size={18} color={colour.inkMuted} />
                          </Pressable>
                        )}
                      </View>
                    ))
                  )}
                  {ids.length > 0 && <Text style={[type.caption, { color: colour.inkSubtle }]}>{`${ids.length + 1}. Any suitable`}</Text>}
                  {prefs.canManage && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                      {options(p.key).length > 0 && ids.length < 10 && (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Add a choice to ${p.title}`} onPress={() => setAdding(p.key)}
                          style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, opacity: pressed ? 0.7 : 1 })}>
                          <Plus size={14} color={colour.forest800} />
                          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add</Text>
                        </Pressable>
                      )}
                      {!isClub && ids.length > 0 && (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Use the club default for ${p.title}`} onPress={() => setDraft((d) => ({ ...d, [p.key]: [] }))}
                          style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, opacity: pressed ? 0.7 : 1 })}>
                          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Use Club Default</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
            {saveProblem && <Text style={[type.caption, { color: colour.danger }]}>{saveProblem}</Text>}
            {prefs.canManage && changed.length > 0 && (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Discard" variant="secondary" onPress={() => setDraft({ ...saved })} style={{ flex: 1 }} />
                <Button label={`Save Changes (${changed.length})`} onPress={() => void save()} busy={busy} style={{ flex: 2 }} />
              </View>
            )}
          </>
        )}
      </ScrollView>
      <Sheet visible={adding !== null} onClose={() => setAdding(null)} title={adding ? `Add to ${PURPOSES.find((p) => p.key === adding)!.title}` : ""}>
        {adding && prefs && (
          <View style={{ gap: space.xs }}>
            {options(adding).map((id) => (
              <Pressable key={id} accessibilityRole="button" accessibilityLabel={nameOf(prefs, PURPOSES.find((p) => p.key === adding)!.kind, id)}
                onPress={() => { setDraft((d) => ({ ...d, [adding]: [...(d[adding] ?? []), id] })); setAdding(null) }}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, opacity: pressed ? 0.8 : 1 })}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{nameOf(prefs, PURPOSES.find((p) => p.key === adding)!.kind, id)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Sheet>
      <LeaveSheet visible={leave !== null} count={changed.length} body={`${changed.length} ${changed.length === 1 ? "preference list has" : "preference lists have"} not been saved.`} onSave={async () => { const go = leave; setLeave(null); if (await save()) go?.() }} onDiscard={() => { const go = leave; setLeave(null); setDraft({ ...saved }); go?.() }} onStay={() => setLeave(null)} />
    </View>
  )
}

