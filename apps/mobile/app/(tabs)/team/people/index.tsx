import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { readTeamPeople, teamPeopleErrorMessage, type TeamPeople, type TeamPerson } from "@ovalball/contracts/team/people"

import { supabase } from "../../../../src/auth/supabase"
import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { PersonAvatar } from "../../../../src/components/identity"
import { ChevronRight, CircleAlert } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PEOPLE -- who is in this side (CA-M7).
 *
 * Three groups a club actually thinks in -- Players, the Coaches and Managers who run them, and their
 * Parents and Guardians -- from the one roster reader (`team_people`) both clients share. The reader
 * refuses outright without `team.roster.view`; it carries names and roles and nothing else, so there is
 * no email, phone, date of birth or family detail on this screen to leak.
 *
 * The people waiting to join are counted here and dealt with under Team Settings, where infrequent
 * work lives; a pending request also surfaces in Needs Attention. Archived players are kept under
 * their own fold so a restore stays possible.
 *
 * ROLE IS PRESENTATION. "Manager" on a row describes the role assignment. What the viewer may DO is
 * asked of the server on the person's own screen.
 */
type Tab = "players" | "staff" | "guardians"

export default function TeamPeopleScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [tab, setTab] = useState<Tab>(params.tab === "staff" ? "staff" : params.tab === "guardians" ? "guardians" : "players")
  const [people, setPeople] = useState<TeamPeople | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setPeople(await readTeamPeople(supabase, teamId))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        setRefused(true)
        setPeople({ staff: [], players: [], guardians: [], requests: [], archived: [] })
        return
      }
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load the people in this team. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setPeople(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const open = (person: TeamPerson) => router.push({ pathname: "/team/people/[kind]/[id]", params: { kind: person.kind, id: person.rowId } } as never)

  const rows = people ? (tab === "players" ? people.players : tab === "staff" ? people.staff : people.guardians) : []
  const empty: Record<Tab, { title: string; body: string }> = {
    players: { title: "No players in this team yet", body: "Players appear here once the club places them in the side, or approves a request to join." },
    staff: { title: "Nobody runs this side yet", body: "Coaches and managers are assigned by the club." },
    guardians: { title: "No parents or guardians yet", body: "They appear as their players join the side." },
  }

  return (
    <TeamScreen section="People" refreshing={refreshing} onRefresh={refresh}>
      {refused && <NotForYou title="The roster is not part of your view" body="Who is in the side is shown to the people who run it." />}
      {problem && !people && <ErrorState message={problem} onRetry={load} />}
      {!problem && people === null && <CardSkeleton lines={4} />}

      {people && !refused && (
        <>
          {people.requests.length > 0 && authority.rosterManage && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${people.requests.length} ${people.requests.length === 1 ? "person is" : "people are"} waiting to join. Opens the requests.`}
              onPress={() => router.push("/team/settings/requests" as never)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, opacity: pressed ? 0.92 : 1 })}
            >
              <CircleAlert size={18} color={colour.warning} strokeWidth={2.2} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
                {people.requests.length === 1 ? "1 person is waiting to join" : `${people.requests.length} people are waiting to join`}
              </Text>
              <ChevronRight size={17} color={colour.warning} />
            </Pressable>
          )}

          <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}>
            {(
              [
                ["players", `Players · ${people.players.length}`],
                ["staff", `Staff · ${people.staff.length}`],
                ["guardians", `Parents · ${people.guardians.length}`],
              ] as [Tab, string][]
            ).map(([key, label]) => {
              const selected = tab === key
              return (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} onPress={() => setTab(key)} style={{ flex: 1, minHeight: TOUCH_TARGET - 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: selected ? colour.surface : "transparent" }}>
                  <Text numberOfLines={1} style={[type.smallMedium, { color: selected ? colour.ink : colour.inkMuted, fontSize: 13 }]}>
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {rows.length === 0 ? (
            <EmptyState title={empty[tab].title} body={empty[tab].body} />
          ) : (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {rows.map((person, index) => (
                <PersonLine key={person.rowId} person={person} first={index === 0} onPress={() => open(person)} />
              ))}
            </View>
          )}

          {tab === "players" && people.archived.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchived }} accessibilityLabel={`${people.archived.length} archived`} onPress={() => setShowArchived((v) => !v)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={[type.smallMedium, { color: colour.inkMuted }]}>Archived · {people.archived.length}</Text>
                <View style={{ transform: [{ rotate: showArchived ? "90deg" : "0deg" }] }}>
                  <ChevronRight size={16} color={colour.inkSubtle} />
                </View>
              </Pressable>
              {showArchived && (
                <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden", opacity: 0.85 }}>
                  {people.archived.map((person, index) => (
                    <PersonLine key={person.rowId} person={person} first={index === 0} onPress={() => open(person)} />
                  ))}
                </View>
              )}
            </View>
          )}
        </>
      )}
      {!authorityLoading && people && !authority.rosterManage && !refused && (
        <Text style={[type.caption, { color: colour.inkSubtle }]}>Changing who is in the side is done by the people the club has given that job to.</Text>
      )}
    </TeamScreen>
  )
}

function PersonLine({ person, first, onPress }: { person: TeamPerson; first: boolean; onPress: () => void }) {
  const status = person.status === "active" ? null : person.status === "requested" ? { label: "Awaiting review", tone: "caution" as const } : { label: "Archived", tone: "neutral" as const }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${person.name}${person.detail ? `, ${person.detail}` : ""}${status ? `, ${status.label}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <PersonAvatar name={person.name} url={null} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>
          {person.name}
        </Text>
        {!!person.detail && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {person.detail}
          </Text>
        )}
      </View>
      {status && <StatusPill label={status.label} tone={status.tone} />}
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
