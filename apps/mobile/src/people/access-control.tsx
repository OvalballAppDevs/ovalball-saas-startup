import { useCallback, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { readAccessSummary, readClubPeople, type AccessSummary, type AccessSummaryRow, type ClubPerson } from "@ovalball/contracts/club/people"
import { TEAM_ROLE_OPTIONS, catalogueRole } from "@ovalball/contracts/role-labels"

import { supabase } from "../auth/supabase"
import { friendly, logDetail } from "../errors/translate"
import { PersonRow } from "../admin/person-row"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { BriefcaseMedical, CalendarDays, ClipboardList, HeartHandshake, IdCard, KeyRound, Plus, Shield, ShieldCheck, ShieldUser, UserRound, Users } from "../components/icons"
import { colour, space, type } from "../design/tokens"
import { ActionGroup, ActionRow, Body, FlowScreen, SectionTitle, Tabs, peopleCount } from "./ui"

/** Team roles in the one order every picker uses: Coach first, Volunteer last. */
const TEAM_ORDER: string[] = TEAM_ROLE_OPTIONS.map((o) => o.value)

/**
 * ROLES & ACCESS -- who can do what, and who does what (People & Invitations; the owner's "Roles &
 * Privileges" and "Access Control" are this one screen).
 *
 * CLUB ACCESS is what somebody can do across the whole club -- exactly one of Club Admin, Fixture
 * Secretary or Member -- beside the appointed Safeguarding Officer. TEAM ROLES are what somebody does for a
 * team, each giving access to that team only. The two are never listed together as if they were levels of
 * the same thing: a Coach is not a smaller Club Admin.
 *
 * Every count is the server's (`club_access_summary`) and every row opens the register narrowed to the
 * people it counts (`club_people` with a role or a title). Titles a club has given -- Treasurer, Physio --
 * appear as what they are: descriptions, counted, granting nothing. Pending invitations are listed here
 * from the same register, never from a second list.
 */
export function AccessControl({ clubId }: { clubId: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<"club" | "team">("club")
  const [summary, setSummary] = useState<AccessSummary | null>(null)
  const [pending, setPending] = useState<ClubPerson[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const [s, p] = await Promise.all([readAccessSummary(supabase, clubId), readClubPeople(supabase, clubId, { filter: "pending", limit: 3 })])
      setSummary(s)
      setPending(p.people.filter((x) => x.kind === "invited"))
    } catch (cause) {
      const failure = friendly(cause, "the club's roles")
      logDetail("access-control", failure)
      setProblem(failure.message)
    }
  }, [clubId])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const open = (params: Record<string, string>) => router.push({ pathname: "/admin/people", params } as never)
  const rowFor = (row: AccessSummaryRow, icon: React.ReactNode, first: boolean, params: Record<string, string>, description?: string) => (
    <ActionRow
      key={row.key}
      first={first}
      icon={icon}
      title={row.label}
      caption={description ?? catalogueRole(row.key)?.description ?? null}
      detail={peopleCount(row.people)}
      onPress={() => open(params)}
    />
  )
  const icon = (key: string) =>
    key === "CLUB_ADMIN" ? <ShieldCheck size={20} color={colour.forest800} /> : key === "FIXTURES_SECRETARY" ? <CalendarDays size={20} color={colour.forest800} /> : key === "MEMBER" ? <Users size={20} color={colour.forest800} /> : key === "SAFEGUARDING_OFFICER" ? <Shield size={20} color={colour.forest800} /> : key === "VOLUNTEER" ? <HeartHandshake size={20} color={colour.forest800} /> : key === "TEAM_ADMINISTRATION" ? <KeyRound size={20} color={colour.forest800} /> : key === "TEAM_MANAGER" ? <ClipboardList size={20} color={colour.forest800} /> : key === "FIRST_AIDER" ? <BriefcaseMedical size={20} color={colour.forest800} /> : key === "TEAM_SAFEGUARDING_LEAD" ? <ShieldUser size={20} color={colour.forest800} /> : <UserRound size={20} color={colour.forest800} />

  return (
    <FlowScreen title="Roles & Access">
      <View style={{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: colour.chalk }}>
        <Tabs tabs={[{ key: "club", label: "Club Access" }, { key: "team", label: "Team Roles" }]} value={tab} onChange={setTab} />
      </View>
      <Body>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!summary && !problem && <CardSkeleton lines={4} />}

        {summary && tab === "club" && (
          <View style={{ gap: space.xl }}>
            <View style={{ gap: space.md }}>
              <SectionTitle title="Club Access" detail="What people can do across the whole club. Everyone has exactly one." />
              <ActionGroup>
                {summary.clubAccess.filter((r) => r.key !== "SAFEGUARDING_OFFICER").map((r, i) => rowFor(r, icon(r.key), i === 0, { role: r.key }))}
              </ActionGroup>
              {summary.clubAccess.filter((r) => r.key === "SAFEGUARDING_OFFICER").map((r) => (
                <ActionGroup key={r.key}>
                  <ActionRow first icon={icon(r.key)} title={r.label} caption={catalogueRole(r.key)?.description ?? null} detail={peopleCount(r.people)} onPress={() => router.push("/admin/safeguarding" as never)} />
                </ActionGroup>
              ))}
            </View>

            <View style={{ gap: space.md }}>
              <SectionTitle title="Club Roles" detail="What people do for the club. Volunteer adds pitch allocations to what a member sees; a title only describes." />
              <ActionGroup>
                {summary.clubRoles.map((r, i) => rowFor(r, icon(r.key), i === 0, { role: r.key }, "Helps out across the club. Sees what members see, plus pitch allocations."))}
                {summary.clubTitles.map((r) => rowFor(r, <IdCard size={20} color={colour.forest800} />, false, { title: r.label }, "A title the club has given."))}
              </ActionGroup>
            </View>

            <View style={{ gap: space.md }}>
              <SectionTitle
                title="Pending Invitations"
                detail={summary.pendingInvitations === 0 ? "Nobody is waiting to accept an invitation." : `${summary.pendingInvitations} waiting to be accepted.`}
              />
              {pending.length > 0 && (
                <ActionGroup>
                  {pending.map((p, i) => (
                    <PersonRow key={p.invitationId ?? i} person={p} avatarUrl={null} first={i === 0} />
                  ))}
                </ActionGroup>
              )}
              {summary.pendingInvitations > pending.length && <Button label={`View All Pending (${summary.pendingInvitations})`} variant="secondary" onPress={() => open({ filter: "pending" })} />}
            </View>

            <Button label="Invite People" icon={<Plus size={18} color={colour.onForest} />} onPress={() => router.push("/admin/people/add" as never)} />
          </View>
        )}

        {summary && tab === "team" && (
          <View style={{ gap: space.xl }}>
            <View style={{ gap: space.md }}>
              <SectionTitle title="Team Roles" detail="What people do for a team. Each gives access to that team only." />
              <ActionGroup>
                {summary.teamRoles
                  .filter((r) => r.key !== "TEAM_ADMINISTRATION")
                  .sort((a, b) => TEAM_ORDER.indexOf(a.key) - TEAM_ORDER.indexOf(b.key))
                  .map((r, i) => rowFor(r, icon(r.key), i === 0, { role: r.key }))}
              </ActionGroup>
            </View>
            <View style={{ gap: space.md }}>
              <SectionTitle title="Team Access" detail="Added on top of a Coach or Team Manager role, for one team." />
              <ActionGroup>
                {summary.teamRoles.filter((r) => r.key === "TEAM_ADMINISTRATION").map((r) => rowFor(r, icon(r.key), true, { role: r.key }))}
              </ActionGroup>
            </View>
            {summary.teamTitles.length > 0 && (
              <View style={{ gap: space.md }}>
                <SectionTitle title="Titles in Use" detail="Head Coach, Physio and custom roles describe what people do. They give no extra access." />
                <ActionGroup>{summary.teamTitles.map((r, i) => rowFor(r, <IdCard size={20} color={colour.forest800} />, i === 0, { title: r.label }, "A title on a team role."))}</ActionGroup>
              </View>
            )}
            <Text style={[type.small, { color: colour.inkMuted }]}>Custom roles are made when you give someone a role: choose Create a Custom Role.</Text>
          </View>
        )}
      </Body>
    </FlowScreen>
  )
}
