import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { removeTeamAccess } from "@ovalball/contracts/club/people"
import { approveTeamPlaceRequest, archiveTeamPlayer, declineTeamPlaceRequest, readTeamPeople, restoreTeamPlayer, teamPeopleErrorMessage, type TeamPerson } from "@ovalball/contracts/team/people"
import { loadStaffPlayers, type StaffPlayer } from "@ovalball/contracts/team/players"

import { supabase } from "../../../../../src/auth/supabase"
import { useTeamAuthority } from "../../../../../src/team/authority"
import { TeamScreen } from "../../../../../src/team/screen"
import { ReasonSheet, type ReasonAsk } from "../../../../../src/admin/reason-sheet"
import { PersonAvatar } from "../../../../../src/components/identity"
import { Button, Card, CardSkeleton, EmptyState, StatusPill } from "../../../../../src/components/ui"
import { colour, space, type } from "../../../../../src/design/tokens"

/**
 * ONE PERSON, AS THE TEAM MAY SEE THEM (CA-M7).
 *
 * WHAT IS HERE IS OPERATIONAL AND NOTHING ELSE. A player: their name, the age grade the platform has
 * resolved for them (never a date of birth), whether they are an adult, their place in this side and
 * the parents or guardians the roster reader already names. A coach or manager: their role. A guardian:
 * which player they are here for. No contact details -- those are a club-scoped capability with no
 * team scope -- no medical fact, no safeguarding record, no other club or team, no family beyond what
 * the roster itself carries.
 *
 * WHAT MAY BE DONE is asked of the server per capability, and refused there again on the write:
 * archive or restore a player's place, approve or decline a request (`team.roster.manage`); remove a
 * staff assignment (`people.role.assign_team`). Role labels never decide any of it.
 */
export default function TeamPersonScreen() {
  const router = useRouter()
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>()
  const { authority, teamId } = useTeamAuthority()
  const [person, setPerson] = useState<TeamPerson | null | undefined>(undefined)
  const [guardians, setGuardians] = useState<TeamPerson[]>([])
  const [player, setPlayer] = useState<StaffPlayer | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!teamId || !id) return
    try {
      const people = await readTeamPeople(supabase, teamId)
      const all = [...people.staff, ...people.players, ...people.guardians, ...people.requests, ...people.archived]
      const found = all.find((p) => p.rowId === id && p.kind === kind) ?? null
      setPerson(found)
      if (found?.kind === "player") {
        setGuardians(people.guardians.filter((g) => (g.detail ?? "").endsWith(found.name)))
        if (found.personId) setPlayer((await loadStaffPlayers(supabase, [found.personId])).get(found.personId) ?? null)
      }
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load this person."))
      setPerson(null)
    }
  }, [teamId, id, kind])

  useEffect(() => {
    setPerson(undefined)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const after = async () => {
    await load()
  }

  if (person === undefined) {
    return (
      <TeamScreen section="Person">
        <CardSkeleton lines={3} />
      </TeamScreen>
    )
  }
  if (!person) {
    return (
      <TeamScreen section="Person">
        <EmptyState title="Not in this team" body={problem ?? "This person is no longer on the side, or was never on it."} />
      </TeamScreen>
    )
  }

  const status = person.status === "active" ? null : person.status === "requested" ? { label: "Awaiting review", tone: "caution" as const } : { label: "Archived", tone: "neutral" as const }

  return (
    <TeamScreen section={person.kind === "player" ? "Player" : person.kind === "coach" ? "Team Staff" : "Parent or Guardian"}>
      <View style={{ alignItems: "center", gap: space.sm }}>
        <PersonAvatar name={person.name} url={null} size={72} />
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink, textAlign: "center" }]}>
          {person.name}
        </Text>
        {!!person.detail && <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>{person.detail}</Text>}
        {status && <StatusPill label={status.label} tone={status.tone} />}
      </View>

      {person.kind === "player" && (
        <Card>
          <View style={{ gap: space.xs }}>
            <Fact label="Age grade" value={player?.ageGrade ?? "Not resolved yet"} />
            <Fact label="Adult" value={player ? (player.isAdult ? "Yes" : "No") : "—"} />
            <Fact label="Place in this side" value={person.status === "active" ? "Active" : person.status === "requested" ? "Requested" : "Archived"} />
            <Fact label="Ovalball account" value={player ? (player.hasLogin ? "Yes" : "No") : "—"} />
          </View>
        </Card>
      )}

      {person.kind === "player" && guardians.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>PARENTS AND GUARDIANS</Text>
          <Card>
            <View style={{ gap: space.sm }}>
              {guardians.map((g) => (
                <View key={g.rowId} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <PersonAvatar name={g.name} url={null} size={32} />
                  <Text style={[type.small, { color: colour.ink }]}>{g.name}</Text>
                </View>
              ))}
            </View>
          </Card>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>Contact details are held by the club, not shown here.</Text>
        </View>
      )}

      {/* ---- What may be done, each control drawn only for a capability the server confirmed ---- */}
      {person.kind === "player" && authority.rosterManage && (
        <View style={{ gap: space.sm }}>
          {person.status === "requested" && (
            <>
              <Button
                label="Approve Request"
                onPress={() =>
                  setAsk({
                    title: `Approve ${person.name}?`,
                    body: "They join the side and their parents or guardians are told.",
                    confirmLabel: "Approve",
                    reason: "none",
                    onConfirm: async () => {
                      await approveTeamPlaceRequest(supabase, person.rowId)
                      await after()
                    },
                  })
                }
              />
              <Button
                label="Decline Request"
                variant="secondary"
                onPress={() =>
                  setAsk({
                    title: `Decline ${person.name}?`,
                    body: "Say why. The reason is recorded and their parents or guardians are told.",
                    confirmLabel: "Decline",
                    destructive: true,
                    reason: "required",
                    onConfirm: async (reason) => {
                      await declineTeamPlaceRequest(supabase, person.rowId, reason)
                      await after()
                    },
                  })
                }
              />
            </>
          )}
          {person.status === "active" && (
            <Button
              label="Archive From This Side"
              variant="secondary"
              onPress={() =>
                setAsk({
                  title: `Archive ${person.name}?`,
                  body: "They leave this side's roster and register. Nothing about them is deleted, and the club can restore them.",
                  confirmLabel: "Archive",
                  destructive: true,
                  reason: "none",
                  onConfirm: async () => {
                    await archiveTeamPlayer(supabase, person.rowId)
                    await after()
                  },
                })
              }
            />
          )}
          {person.status === "archived" && (
            <Button
              label="Restore to This Side"
              onPress={() =>
                setAsk({
                  title: `Restore ${person.name}?`,
                  body: "They return to this side's roster and register.",
                  confirmLabel: "Restore",
                  reason: "none",
                  onConfirm: async () => {
                    await restoreTeamPlayer(supabase, person.rowId)
                    await after()
                  },
                })
              }
            />
          )}
        </View>
      )}

      {person.kind === "coach" && authority.roleAssignTeam && person.status === "active" && (
        <Button
          label="Remove From This Side"
          variant="secondary"
          onPress={() =>
            setAsk({
              title: `Remove ${person.name}?`,
              body: "Their role on this side ends. Their club membership is untouched.",
              confirmLabel: "Remove",
              destructive: true,
              reason: "optional",
              onConfirm: async (reason) => {
                await removeTeamAccess(supabase, person.rowId, reason)
                router.back()
              },
            })
          }
        />
      )}

      {!authority.rosterManage && person.kind === "player" && (
        <Text style={[type.caption, { color: colour.inkSubtle }]}>Changing this player's place in the side is done by the club.</Text>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That could not be done.")} />
    </TeamScreen>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
