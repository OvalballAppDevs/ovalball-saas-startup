import { AdminScreen } from "../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../src/admin/access"
import { CardSkeleton, EmptyState } from "../../../src/components/ui"
import { EventsList } from "../../../src/events/events-list"

/** EVENTS -- the club's own events: create, then manage each in its Event Centre. */
export default function AdminEvents() {
  const { clubId, sections, loading } = useAdminCentreAccess()
  return (
    <AdminScreen section="Events">
      {loading && <CardSkeleton lines={3} />}
      {/* Outside a club context there is no club to list -- said, never left as a skeleton that never resolves. */}
      {!loading && !clubId && <EmptyState title="Choose a club context" body="Events are run by the club you are viewing. Switch to a club context from the header." />}
      {!loading && !!clubId && <EventsList openPath="/admin/event/[eventId]" clubId={clubId} canCreate={sections.some((s) => s.key === "events")} />}
    </AdminScreen>
  )
}
