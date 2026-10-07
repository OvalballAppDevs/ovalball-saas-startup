import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Text, View } from "react-native"
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { STANDING_LABEL, STANDING_ORDER, loadClubMembershipBoard, type ClubMembershipBoard, type MembershipRow, type MembershipStanding } from "@ovalball/contracts/membership/board"
import {
  MEMBER_SEGMENTS,
  NO_MEMBER_FILTERS,
  activeFilterCount,
  filterMembers,
  memberGroups,
  memberTeamOptions,
  segmentCounts,
  type MemberFilters,
  type MemberSegment,
} from "@ovalball/contracts/membership/operate"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { supabase } from "../../../../src/auth/supabase"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { FoldedGroup } from "../../../../src/membership/board-ui"
import { DropdownChip, MemberRow, PickerSheet, SearchField, SegmentedTabs, type PickerOption } from "../../../../src/membership/running-ui"
import { ActionGroup } from "../../../../src/people/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * MEMBERS -- every member's standing this month, and who needs action (Club Memberships Part 2).
 *
 * The club's view of the one membership standing the server derives (`club_membership_board`): All, Up to Date or
 * Need Action, then a search and three filters that wrap rather than scroll out of sight (Team, Status, Membership),
 * each a list in a sheet. Members are grouped by standing in the order the work comes; the settled groups fold away
 * unless they are what was asked for. Every row opens that member's page. Segments, filters and groups are the shared
 * contract's (`membership/operate`), so the web and the phone cannot count anybody differently.
 *
 * Reading needs `finance.subscription.view` at the club. The month's ledger -- who owes what, Waive, Retry,
 * Generate and Export -- is Payments; an old link that asked this screen for a ledger filter or month goes there.
 */
export default function MembersRoute() {
  const params = useLocalSearchParams<{ filter?: string; month?: string }>()
  // THE LEDGER USED TO LIVE AT THIS ADDRESS, with `filter` and `month`: such a link still lands on the ledger.
  if (params.filter || params.month) {
    const forward: Record<string, string> = {}
    if (params.filter) forward.filter = String(params.filter)
    if (params.month) forward.month = String(params.month)
    return <Redirect href={{ pathname: "/admin/subscriptions/payments", params: forward } as never} />
  }
  return <MembersScreen />
}

const SEGMENTS = new Set<string>(MEMBER_SEGMENTS.map((s) => s.key))
const STANDINGS = new Set<string>(STANDING_ORDER)

function presetFilters(p: { teamId?: string; segment?: string; standing?: string; membershipId?: string }): MemberFilters {
  return {
    ...NO_MEMBER_FILTERS,
    segment: p.segment && SEGMENTS.has(p.segment) ? (p.segment as MemberSegment) : "all",
    teamId: p.teamId ? String(p.teamId) : null,
    standing: p.standing && STANDINGS.has(p.standing) && p.standing !== "ENDED" ? (p.standing as MembershipStanding) : null,
    membershipId: p.membershipId ? String(p.membershipId) : null,
  }
}

const memberCount = (n: number) => `${n} ${n === 1 ? "member" : "members"}`

function MembersScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ teamId?: string; segment?: string; standing?: string; membershipId?: string }>()
  const { clubId } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [board, setBoard] = useState<ClubMembershipBoard | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState<MemberFilters>(() => presetFilters(params))
  const [picker, setPicker] = useState<"team" | "status" | "membership" | null>(null)
  const generation = useRef(0)

  // A link into this screen (a team on Teams, the overview) chooses the filters it was opened with.
  useEffect(() => {
    setFilters(presetFilters({ teamId: params.teamId, segment: params.segment, standing: params.standing, membershipId: params.membershipId }))
  }, [params.teamId, params.segment, params.standing, params.membershipId])

  const load = useCallback(async () => {
    if (!clubId || authorityLoading || !authority.view) return
    const gen = ++generation.current
    setError(null)
    try {
      const next = await loadClubMembershipBoard(supabase, clubId)
      if (gen === generation.current) setBoard(next)
    } catch (cause) {
      const translated = friendly(cause, "the club's members")
      logDetail("admin:memberships:members", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, authorityLoading, authority.view])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refreshAuthority(), load()])
    setRefreshing(false)
  }, [refreshAuthority, load])

  const rows = useMemo(() => board?.rows ?? [], [board])
  // THE SEGMENT COUNTS FOLLOW THE OTHER FILTERS: "Need Action 2" beside Under 12 Boys is about Under 12 Boys.
  const counts = useMemo(() => segmentCounts(filterMembers(rows, { ...filters, segment: "all" })), [rows, filters])
  const shown = useMemo(() => filterMembers(rows, filters), [rows, filters])
  const groups = useMemo(() => memberGroups(shown), [shown])
  const filtered = activeFilterCount(filters) > 0
  // Settled groups fold away -- unless a settled standing is exactly what was asked for.
  const fold = filters.segment === "all" && filters.standing === null

  const teamOptions = useMemo<PickerOption[]>(
    () => memberTeamOptions(rows).map((t) => ({ id: t.id, label: t.name, detail: memberCount(rows.filter((r) => r.standing !== "ENDED" && (r.teams ?? []).some((x) => x.id === t.id)).length) })),
    [rows]
  )
  const statusOptions = useMemo<PickerOption[]>(
    () =>
      STANDING_ORDER.filter((s) => s !== "ENDED")
        .map((s) => ({ s, n: rows.filter((r) => r.standing === s).length }))
        .filter(({ s, n }) => n > 0 || filters.standing === s)
        .map(({ s, n }) => ({ id: s, label: STANDING_LABEL[s], detail: memberCount(n) })),
    [rows, filters.standing]
  )
  const membershipOptions = useMemo<PickerOption[]>(
    () => (board?.memberships ?? []).map((m) => ({ id: m.id, label: m.name, detail: memberCount(rows.filter((r) => r.standing !== "ENDED" && r.membership?.id === m.id).length) })),
    [board, rows]
  )

  const teamName = filters.teamId ? (teamOptions.find((t) => t.id === filters.teamId)?.label ?? "Chosen team") : null
  const membershipName = filters.membershipId ? (membershipOptions.find((m) => m.id === filters.membershipId)?.label ?? "Chosen membership") : null
  const running = !!board?.programme && (board.programme.enabled || board.programme.activatedAt !== null)

  const open = (row: MembershipRow) => router.push({ pathname: "/admin/subscriptions/member/[playerId]", params: { playerId: row.playerId } } as never)
  const clearFilters = () => setFilters((f) => ({ ...NO_MEMBER_FILTERS, segment: f.segment }))

  return (
    <AdminScreen section="Members" onRefresh={() => void refresh()} refreshing={refreshing}>
      {!authorityLoading && !authority.view && <EmptyState title="Not for you at this club" body="Seeing the club's members needs the finance view permission at this club. If that has changed, pull to refresh." />}

      {(authorityLoading || (authority.view && !board && !error)) && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </View>
      )}

      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {board && !running && <EmptyState title="The club doesn't collect membership through Ovalball yet" body="Once Club Memberships are set up, each player's standing appears here." />}

      {board && running && (
        <>
          <SegmentedTabs
            label="Members"
            value={filters.segment}
            onChange={(segment) => setFilters((f) => ({ ...f, segment }))}
            tabs={MEMBER_SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))}
          />

          <View style={{ gap: space.sm }}>
            <SearchField value={filters.query} onChange={(query) => setFilters((f) => ({ ...f, query }))} placeholder="Search members" label="Search members" />
            {/* THE FILTERS WRAP, never scroll sideways: a chosen filter must always be in view. */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <DropdownChip label="Team" value={teamName} anyLabel="all teams" onPress={() => setPicker("team")} />
              <DropdownChip label="Status" value={filters.standing ? STANDING_LABEL[filters.standing] : null} anyLabel="any status" onPress={() => setPicker("status")} />
              {(board.memberships.length > 1 || filters.membershipId) && <DropdownChip label="Membership" value={membershipName} anyLabel="all memberships" onPress={() => setPicker("membership")} />}
              {filtered && <Button label="Clear Filters" variant="quiet" onPress={clearFilters} />}
            </View>
            {(filtered || filters.segment !== "all") && shown.length > 0 && (
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{`${shown.length} of ${memberCount(segmentCounts(rows).all)}`}</Text>
            )}
          </View>

          {rows.length === 0 && <EmptyState title="No members yet" body="Each player's membership appears here once they are in a team with a membership." />}

          {rows.length > 0 && shown.length === 0 && (
            filtered ? (
              <View style={{ gap: space.sm }}>
                <EmptyState title="Nobody matches these filters." body="Try a different team, status or name." />
                <Button label="Clear Filters" variant="secondary" onPress={clearFilters} />
              </View>
            ) : filters.segment === "up_to_date" ? (
              <EmptyState title="Nobody is up to date yet this month" body="A member is up to date once this month's payment has been collected." />
            ) : (
              <EmptyState title="Nobody needs action" body="Every member is up to date, or their payment is on its way." />
            )
          )}

          {groups.map((group) => {
            const list = (
              <ActionGroup>
                {group.rows.map((row, i) => (
                  <MemberRow key={row.playerId} row={row} first={i === 0} context="club" hint="Opens their membership" onPress={() => open(row)} />
                ))}
              </ActionGroup>
            )
            if (group.settled && fold) {
              return (
                <FoldedGroup key={group.standing} label={STANDING_LABEL[group.standing]} count={group.rows.length}>
                  {list}
                </FoldedGroup>
              )
            }
            return (
              <View key={group.standing} style={{ gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.inkMuted }]}>
                  {STANDING_LABEL[group.standing]} · {group.rows.length}
                </Text>
                {list}
              </View>
            )
          })}

          <PickerSheet
            visible={picker === "team"}
            title="Team"
            hint="Members of one team. A player in two teams is in both."
            options={teamOptions}
            allLabel="All Teams"
            value={filters.teamId}
            onClose={() => setPicker(null)}
            onApply={(teamId) => {
              setFilters((f) => ({ ...f, teamId }))
              setPicker(null)
            }}
          />
          <PickerSheet
            visible={picker === "status"}
            title="Status"
            hint="This month's standing."
            options={statusOptions}
            allLabel="Any Status"
            value={filters.standing}
            onClose={() => setPicker(null)}
            onApply={(standing) => {
              setFilters((f) => ({ ...f, standing: standing as MembershipStanding | null }))
              setPicker(null)
            }}
          />
          <PickerSheet
            visible={picker === "membership"}
            title="Membership"
            hint="The membership a member holds, or would hold from their team."
            options={membershipOptions}
            allLabel="All Memberships"
            value={filters.membershipId}
            onClose={() => setPicker(null)}
            onApply={(membershipId) => {
              setFilters((f) => ({ ...f, membershipId }))
              setPicker(null)
            }}
          />
        </>
      )}
    </AdminScreen>
  )
}
