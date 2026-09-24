import { useCallback, useEffect, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { resolvePersonalAvatarUrls } from "@ovalball/contracts/personal-avatar"
import { readClubPeople, type ClubPerson } from "@ovalball/contracts/club/people"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { PersonRow } from "../../../../src/admin/person-row"
import { supabase } from "../../../../src/auth/supabase"
import { Search } from "../../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ROLES & PERMISSIONS -- choose the person (CA-M4).
 *
 * The Admin Centre's entry to the permission product is the same list of people the People section
 * shows (active members only, from `club_people`), so the reader recognises the person before they
 * open what that person may do. Decisions are taken on the person's own permissions screen; this
 * screen decides nothing.
 */
export default function PermissionsPeopleScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<ClubPerson[] | null>(null)
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map())
  const [error, setError] = useState<FriendlyError | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId) {
      setPeople([])
      return
    }
    const gen = ++generation.current
    setError(null)
    try {
      const page = await readClubPeople(supabase, clubId, { search: query, filter: "members", limit: 200 })
      if (gen !== generation.current) return
      const list = page.people.filter((p) => p.kind === "member" && p.membershipId && p.state === "ACTIVE")
      setPeople(list)
      const urls = await resolvePersonalAvatarUrls(supabase, list.filter((p) => p.avatarStoragePath).map((p) => p.avatarStoragePath as string))
      if (gen === generation.current) setAvatars(urls)
    } catch (cause) {
      const translated = friendly(cause, "the club's people")
      logDetail("admin:permissions", translated)
      if (gen === generation.current) {
        setError(translated)
        setPeople([])
      }
    }
  }, [clubId, query])

  useEffect(() => {
    // Cleared FIRST: the previous context's people must never stand in for this one's.
    setPeople(null)
    const t = setTimeout(() => void load(), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, query])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  return (
    <AdminScreen section="Roles & Permissions" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Roles & Permissions
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>A role gives a person a default set of permissions. A decision here allows or withholds one of them, at the club or for one team.</Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
        <Search size={18} color={colour.inkSubtle} />
        <TextInput accessibilityLabel="Search people" value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
      </View>

      {people === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {people && people.length === 0 && !error && (query ? <EmptyState title="No people match this search" body="Try a different name." /> : <EmptyState title="No members yet" body="Members appear when they join the club or accept an invitation." />)}

      {people && people.length > 0 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {people.map((p, i) => (
            <PersonRow key={p.membershipId ?? String(i)} person={p} avatarUrl={p.avatarStoragePath ? (avatars.get(p.avatarStoragePath) ?? null) : null} first={i === 0} onPress={() => router.push(`/admin/people/${p.membershipId}/permissions` as never)} />
          ))}
        </Card>
      )}
    </AdminScreen>
  )
}
