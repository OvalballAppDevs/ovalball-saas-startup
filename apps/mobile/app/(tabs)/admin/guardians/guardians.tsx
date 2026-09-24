import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { canOpenGuardiansPlayers, guardiansFromDirectory, readClubPlayerDirectory, type DirectoryGuardian } from "@ovalball/contracts/club/guardians-players"

import { AdminScreen } from "../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, Search } from "../../../../src/components/icons"
import { PersonAvatar } from "../../../../src/components/identity"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * GUARDIANS -- the club's directory of parents and guardians, one row per adult (CA-M11.1).
 *
 * The website lists guardians under each player; this turns the same read round so a person can find
 * an adult and see every child they are linked to at this club. Names and emails come from
 * `get_team_guardian_directory` alone, which the database limits to family.relationship.approve at the
 * club -- there is no other route to a guardian's contact details here. There is no guardian detail
 * screen because the website has none: a relationship is managed from the player it belongs to.
 */
export default function GuardiansDirectory() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps } = useGuardiansPlayersAccess()
  const [guardians, setGuardians] = useState<DirectoryGuardian[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [query, setQuery] = useState("")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !canOpenGuardiansPlayers(caps)) return
    const gen = ++generation.current
    setError(null)
    try {
      const directory = await readClubPlayerDirectory(supabase, clubId, caps)
      if (gen !== generation.current) return
      setGuardians(guardiansFromDirectory(directory.players))
    } catch (cause) {
      const translated = friendly(cause, "the club's guardians")
      logDetail("admin:guardians:guardians", translated)
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
  const visible = (guardians ?? []).filter((g) => !needle || g.name.toLowerCase().includes(needle) || (g.email ?? "").toLowerCase().includes(needle) || g.children.some((c) => c.playerName.toLowerCase().includes(needle)))

  return (
    <AdminScreen section="Guardians" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Guardians
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>The parents and guardians linked to players at the club, and which children they are here for.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="The guardian directory is for the people the club has given that job to." />}

      {may && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput accessibilityLabel="Search guardians" value={query} onChangeText={setQuery} placeholder="Search by name, email or child" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
          </View>

          {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
          {!error && guardians === null && (
            <View style={{ gap: space.md }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}
          {guardians !== null && visible.length === 0 && <EmptyState title={needle ? "No guardians match this search" : "No guardians yet"} body={needle ? "Try a different name." : "Guardians appear once a relationship with a player here has been approved."} />}

          {visible.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                {visible.length} {visible.length === 1 ? "guardian" : "guardians"}
              </Text>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {visible.map((g, i) => (
                  <View key={g.guardianUserId || g.name} style={{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                      <PersonAvatar name={g.name} url={null} size={40} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
                          {g.name}
                        </Text>
                        {g.email ? (
                          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1} selectable>
                            {g.email}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ gap: 2 }}>
                      {g.children.map((c) => (
                        <Pressable
                          key={c.playerId}
                          accessibilityRole="button"
                          accessibilityLabel={`${c.playerName}, their ${c.relationshipType ?? "child"}. Open player`}
                          onPress={() => router.push({ pathname: "/admin/guardians/player/[playerId]", params: { playerId: c.playerId } } as never)}
                          style={({ pressed }) => ({ minHeight: 40, flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: 52, opacity: pressed ? 0.6 : 1 })}
                        >
                          <Text style={[type.small, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
                            {c.playerName}
                          </Text>
                          <ChevronRight size={15} color={colour.inkSubtle} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}
        </>
      )}
    </AdminScreen>
  )
}
