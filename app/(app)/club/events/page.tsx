import { redirect } from "next/navigation"

import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { EventsManager } from "./events-manager"

export const dynamic = "force-dynamic"
export const metadata = { title: "Club Events" }

/**
 * EVENT MANAGEMENT -- where an event is created, edited and cancelled.
 *
 * THE MANAGEMENT SURFACE, NOT THE CENTRE. Event Centre is what a participant
 * opens; this is what a club administrator opens. Calendar routes staff HERE
 * first and offers Event Centre beside it, exactly as it already does for
 * fixtures and training -- one canonical editor, never a Calendar-local copy
 * of the form.
 *
 * AUTHORITY IS THE CAPABILITY ENGINE'S ANSWER, not a role name. `calendar
 * .manage` at club scope is the same capability the rest of the Calendar
 * domain already uses; a team-scoped grant reaches the create path through
 * save_club_event, which checks per team.
 */
export default async function ClubEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; action?: string }>
}) {
  const { event: focusEventId, action } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const boardContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // WHICH CLUB'S PROGRAMME THIS IS.
  //
  // The board context is a VIEW, not an authority. Requiring `kind === "club"`
  // here made Event Centre's own Edit and Cancel actions dead-end: a club
  // administrator looking at the calendar in one of their team contexts holds
  // club-scoped calendar.manage perfectly well, pressed Cancel Event, and was
  // bounced back to /calendar with nothing having happened.
  //
  // So the club is resolved from the EVENT being acted on where one is named,
  // and from the board context otherwise -- and the capability check that
  // follows is what actually decides, exactly as it does everywhere else.
  let clubId = boardContext.kind === "club" ? boardContext.id : null
  if (focusEventId) {
    const { data: focusEvent } = await supabase.from("club_events").select("club_id").eq("id", focusEventId).maybeSingle()
    if (focusEvent?.club_id) clubId = focusEvent.club_id
  }
  if (!clubId) {
    // No event named and not in a club view: the one club they administer, if
    // there is exactly one. More than one is genuinely ambiguous and is left
    // to the context switcher rather than guessed.
    const { data: memberships } = await supabase
      .from("club_memberships")
      .select("club_id")
      .eq("user_id", user.id)
      .eq("status", "active")
    const clubIds = Array.from(new Set((memberships ?? []).map((m) => m.club_id).filter((c): c is string => Boolean(c))))
    if (clubIds.length === 1) clubId = clubIds[0]
  }
  if (!clubId) redirect("/calendar")

  // THE CAPABILITY IS THE BOUNDARY. Resolved against whichever club was found
  // above, so reaching this page by URL with somebody else's event id gives
  // exactly nothing.
  const canManageClub = await hasCapability(supabase, "calendar.event.manage", "club", { clubId })
  if (!canManageClub) redirect("/calendar")

  // One read each for the three things the form offers, all scoped to this
  // club -- and every one of them re-validated server-side by
  // save_club_event, so this list is a convenience rather than the boundary.
  const [{ data: teamRows }, { data: venueRows }, { data: pitchRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, display_name, category, age_group, gender, squad_designation, rugby_code")
      .eq("club_id", clubId)
      .eq("active", true),
    supabase.from("venues").select("id, name").eq("club_id", clubId).eq("active", true),
    supabase.from("club_pitches").select("id, display_name").eq("club_id", clubId).eq("active", true).order("sort_order"),
    supabase
      .from("club_events")
      .select("id, name, description, starts_on, start_time, ends_on, end_time, is_club_wide, status, venue_id, external_location_name, club_event_teams(team_id), club_event_pitches(pitch_id)")
      .eq("club_id", clubId)
      .order("starts_on", { ascending: true }),
  ])

  const teams = (teamRows ?? []).map((t) => ({
    id: t.id,
    label: fullTeamLabel({
      category: (t.category ?? "youth") as "senior" | "youth" | "colts",
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code,
    }),
  }))

  const events = (eventRows ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    startsOn: e.starts_on,
    startTime: e.start_time,
    endsOn: e.ends_on,
    endTime: e.end_time,
    isClubWide: e.is_club_wide,
    status: e.status,
    venueId: e.venue_id,
    locationName: e.external_location_name,
    teamIds: (e.club_event_teams ?? []).map((r) => r.team_id).filter((x): x is string => Boolean(x)),
    pitchIds: (e.club_event_pitches ?? []).map((r) => r.pitch_id).filter((x): x is string => Boolean(x)),
  }))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{boardContext.label}</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Club Events</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Socials, fundraisers, open days and presentation evenings. Anything the club puts on that is not a match or a training session.
      </p>

      <EventsManager
        clubId={clubId}
        teams={teams}
        venues={(venueRows ?? []).map((v) => ({ id: v.id, name: v.name }))}
        pitches={(pitchRows ?? []).map((p) => ({ id: p.id, displayName: p.display_name }))}
        events={events}
        canCreateClubWide={canManageClub}
        focusEventId={focusEventId ?? null}
        focusAction={action === "cancel" ? "cancel" : action === "edit" ? "edit" : null}
      />
    </div>
  )
}
