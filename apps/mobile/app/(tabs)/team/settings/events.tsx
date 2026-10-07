import { useAppContexts } from "../../../../src/context/contexts"
import { useTeamAuthority } from "../../../../src/team/authority"
import { TeamScreen } from "../../../../src/team/screen"
import { CardSkeleton, EmptyState } from "../../../../src/components/ui"
import { EventsList } from "../../../../src/events/events-list"

/** A TEAM'S EVENTS -- the side's own socials, runs and trips, created within the team's own authority. */
export default function TeamEvents() {
  const { active } = useAppContexts()
  const { authority, loading, teamId } = useTeamAuthority()
  const clubId = active?.kind === "team" ? active.clubId : null
  return (
    <TeamScreen section="Events">
      {loading && <CardSkeleton lines={3} />}
      {/* Outside a team context there is no side to list -- said, never left as a skeleton that never resolves. */}
      {!loading && (!clubId || !teamId) && <EmptyState title="Choose a team context" body="A team's events belong to the side you are viewing. Switch to a team context from the header." />}
      {!loading && !!clubId && !!teamId && <EventsList openPath="/team/event/[eventId]" clubId={clubId} teamId={teamId} canCreate={authority.calendarEventManage} />}
    </TeamScreen>
  )
}
