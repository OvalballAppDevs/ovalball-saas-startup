import { STANDING_ORDER, type MembershipStanding } from "@ovalball/contracts/membership/board"
import { MEMBER_SEGMENTS, type MemberFilters, type MemberSegment } from "@ovalball/contracts/membership/operate"

import { loadMembershipsBoard, requireMembershipsAccess } from "../memberships-access"
import { MembershipsLoadProblem, MembershipsNotSetUp, MembershipsShell } from "../memberships-shell"
import { MembersBoard } from "./members-board"

export const metadata = { title: "Members | Memberships" }

type Search = Record<string, string | string[] | undefined>

/**
 * THE CLUB'S MEMBERS, BY STANDING (Club Memberships Part 2).
 *
 * Everybody the club's memberships cover this month, from the server's one board, grouped in working order with the
 * settled folded away. The filters live in the address (`?segment=&team=&membership=&status=&q=`), so the overview's
 * legend, a team, a membership and a colleague's link all open the same list.
 */
export default async function MembershipMembersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const access = await requireMembershipsAccess()
  const board = await loadMembershipsBoard()

  return (
    <MembershipsShell access={access} board={board} active="members">
      {!board ? (
        <MembershipsLoadProblem />
      ) : !board.programme ? (
        <MembershipsNotSetUp canConfigure={access.can.configure} />
      ) : (
        <MembersBoard
          clubId={access.clubId}
          rows={board.rows}
          memberships={board.memberships}
          endedCount={board.counts.ended ?? 0}
          initialFilters={readFilters(params)}
          canRemind={access.can.enrolment}
        />
      )}
    </MembershipsShell>
  )
}

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

/** The address's filters, kept only where they name something real; the rest fall back to "everybody". */
function readFilters(params: Search): MemberFilters {
  const segment = first(params.segment)
  const status = first(params.status)
  return {
    segment: MEMBER_SEGMENTS.some((s) => s.key === segment) ? (segment as MemberSegment) : "all",
    teamId: first(params.team),
    membershipId: first(params.membership),
    standing: STANDING_ORDER.includes(status as MembershipStanding) ? (status as MembershipStanding) : null,
    query: (first(params.q) ?? "").slice(0, 100),
  }
}
