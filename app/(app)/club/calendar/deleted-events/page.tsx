import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { canManageClubFixturesAnywhere, getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { DeletedCalendarEventsClient, type DeletedEventRow } from "./deleted-events-client"

/**
 * Calendar Fixture Lifecycle hardening, Section H: "Deleted Calendar
 * Events" -- the unified back-office archive for archived fixtures and
 * genuinely-removed training, reading the shared public.deleted_calendar_
 * events view (Section R: a normalized READ projection, never a merged
 * table). Gated on the same back-office boundary as Fixture Management/
 * Training Management -- Club Admin/Fixtures Secretary (fixtures side) or
 * club.training.manage (training side); never a Parent/Player, Coach, or
 * Manager by default, matching Section M's role matrix.
 */
export default async function DeletedCalendarEventsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)

  const canManageTraining = clubId ? await hasCapability(supabase, "club.training.manage", "club", { clubId }) : false
  if (!clubId || !(canManageClubFixturesAnywhere(ctx) || canManageTraining)) redirect("/dashboard")

  const clubName = activeContext.kind === "club" ? activeContext.label : "Your club"

  const { data: rows } = await supabase
    .from("deleted_calendar_events")
    .select("event_type, canonical_id, team_id, team_name, opponent_label, event_date, event_time, venue_name, original_status, deleted_at, deleted_by, deleted_reason, club_id")
    .eq("club_id", clubId)
    .order("deleted_at", { ascending: false })

  const deletedByIds = Array.from(new Set((rows ?? []).map((r) => r.deleted_by).filter((id): id is string => Boolean(id))))
  const { data: profiles } = deletedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", deletedByIds) : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Unknown"]))

  // The view's columns are typed nullable (a UNION over outer joins), but
  // every real row always has these -- guarding rather than asserting so a
  // genuinely malformed row is dropped, never rendered with a fake value.
  const events: DeletedEventRow[] = (rows ?? [])
    .filter((r): r is typeof r & { canonical_id: string; team_name: string; event_date: string; original_status: string; deleted_at: string } =>
      Boolean(r.canonical_id && r.team_name && r.event_date && r.original_status && r.deleted_at)
    )
    .map((r) => ({
      eventType: r.event_type as "fixture" | "training",
      canonicalId: r.canonical_id,
      teamName: r.team_name,
      opponentLabel: r.opponent_label,
      eventDate: r.event_date,
      eventTime: r.event_time,
      venueName: r.venue_name,
      originalStatus: r.original_status,
      deletedAt: r.deleted_at,
      deletedByName: r.deleted_by ? (nameById.get(r.deleted_by) ?? "Unknown") : "Unknown",
      deletedReason: r.deleted_reason,
    }))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Calendar / Operations</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Deleted Calendar Events</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Archived fixtures and removed training for {clubName}. Nothing here was physically deleted -- every record can be
        traced back to its real, canonical fixture or training session. Never shown to Parents or Players.
      </p>
      <DeletedCalendarEventsClient events={events} />
    </div>
  )
}
