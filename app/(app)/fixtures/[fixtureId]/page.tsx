import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AttendancePanel } from "@/components/fixtures/match-centre/attendance-panel"
import { MatchCentreHero } from "@/components/fixtures/match-centre/hero"
import { MessagingPanel, type FixtureMessageRow } from "@/components/fixtures/match-centre/messaging-panel"
import { ParticipantList } from "@/components/fixtures/match-centre/participant-list"
import { VenueBlock } from "@/components/fixtures/match-centre/venue-block"
import { WeatherCard } from "@/components/fixtures/match-centre/weather-card"
import { getFixtureForecast } from "@/lib/weather/fixture-forecast"

import { CommunicationPanel } from "./communication-panel"
import { StaffPanel } from "./staff-panel"
import { getMatchCentreContext } from "@/lib/app-context/match-centre-data"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// Reachable from the Calendar as of Phase 2A, so it needs its own tab name.
// Static rather than generateMetadata: the fixture's own identity would be a
// better title, but building it means a second authorised read purely for a
// tab label, and this page is already one resolver call.
export const metadata = { title: "Match Centre" }

/**
 * Match Centre -- the real Main implementation of the typed contract Side
 * Project 3 Stage 8 designed in isolation. One canonical fixture_id drives
 * this whole page (lib/app-context/match-centre-data.ts's
 * getMatchCentreContext); every control on it is gated by a real,
 * server-resolved capability, never a client-side role name.
 */
export default async function FixtureMatchCentrePage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // One Match Centre, and every section on it gated by a real capability
  // rather than by which context the person is currently switched into. A
  // club admin who also plays keeps the fixture controls they legitimately
  // hold; a player who holds none simply does not see them.
  const resolution = await getMatchCentreContext(supabase, user.id, fixtureId)
  if (resolution.status === "not_found") notFound()
  const { context } = resolution

  // DERIVED data, resolved server-side from the fixture's canonical kickoff
  // and its venue's coordinates. Never throws: every failure -- no
  // credential, timeout, 429, malformed payload -- comes back as a state, so
  // a weather outage can never take this page with it.
  // Audience sizes for the staff panel. The RPC returns NULLs for a caller
  // without fixture-management capability, so an unauthorized viewer gets no
  // metric at all rather than an authoritative zero.
  const { data: counts } = await supabase.rpc("fixture_communication_counts", { p_fixture_id: fixtureId }).maybeSingle()

  const weather = await getFixtureForecast({
    kickoffDate: context.fixture.kickoffDate,
    kickoffTime: context.fixture.kickoffTime,
    latitude: context.venue.latitude,
    longitude: context.venue.longitude,
  })

  let messages: FixtureMessageRow[] = []
  if (context.messaging.canView) {
    const { data: rows } = await supabase
      .from("fixture_messages")
      .select("id, body, created_at, sender_user_id")
      .eq("fixture_id", fixtureId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(50)

    const senderIds = Array.from(new Set((rows ?? []).map((m) => m.sender_user_id)))
    const { data: senderProfiles } = senderIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", senderIds) : { data: [] }
    const senderNameById = new Map((senderProfiles ?? []).map((p) => [p.id, `${p.first_name} ${p.surname}`]))

    messages = (rows ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      senderName: senderNameById.get(m.sender_user_id) ?? "Someone",
      isOwn: m.sender_user_id === user.id,
    }))
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-28">
      {/* pb-28 clears the global "Ask Ovie" floating widget, which sits
          fixed bottom-right on every page -- without it, the messaging
          compose row's Send button sits directly underneath the widget at
          narrow viewports (confirmed overlapping via getBoundingClientRect
          during UAT), an inaccessible, unclickable control. */}
      <Link href="/fixtures" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Fixtures
      </Link>

      <MatchCentreHero fixture={context.fixture} homeSide={context.homeSide} awaySide={context.awaySide} venueName={context.venue.name} />

      <section aria-labelledby="mc-attendance-heading" className="flex flex-col gap-2.5">
        <h2 id="mc-attendance-heading" className="sr-only">
          Attendance
        </h2>
        {/* Squad-wide counts are STAFF-level, exactly like the roster below
            them -- get_match_centre_capabilities' own comment says this flag
            "gates the FULL roster/aggregate-counts section", because a viewer
            without it reads attendance through RLS that returns only their
            own linked player's row.

            Rendered ungated, this dial showed "Attending 0 · Can't attend 0"
            to a guardian whose child had already answered ATTENDING, and to
            a guardian from an entirely different club. Neither leaks data --
            but both are confident zeros standing in for numbers the viewer is
            not entitled to, which is worse than not showing the dial at all.
            Their own response is a separate, always-available path below. */}
        {context.actions.canViewParticipants && (
          <dl className="grid grid-cols-4 gap-2 text-center">
            <CountCell label="Attending" value={context.attendance.counts.attending} />
            <CountCell label="Can't attend" value={context.attendance.counts.cannotAttend} />
            <CountCell label="Unsure" value={context.attendance.counts.unsure} />
            <CountCell label="Awaiting" value={context.attendance.counts.awaitingResponse} />
          </dl>
        )}
        <AttendancePanel fixtureId={context.fixture.fixtureId} entries={context.attendance.mine} fixtureCancelled={context.fixture.status === "CANCELLED"} />
      </section>

      {/* No sr-only h2 wrapper here -- VenueBlock and WeatherCard each render
          their own real heading; a duplicate same-text heading one level up
          would show twice in a screen reader's heading list for no reason. */}
      <VenueBlock venue={context.venue} pitch={context.pitch} />

      <WeatherCard result={weather} />

      {/* Staff-only, and only ever presentation: every action re-checks the
          same capability in the database. Two sections, because managing the
          fixture and talking to families are different jobs. */}
      {context.actions.canManageFixture && (
        <>
          <StaffPanel fixtureId={context.fixture.fixtureId} meetTime={context.fixture.meetTime} kickoffTime={context.fixture.kickoffTime} />
          <CommunicationPanel
            fixtureId={context.fixture.fixtureId}
            outstandingCount={counts?.outstanding_count ?? null}
            attendingCount={counts?.attending_count ?? null}
            teamCount={counts?.team_count ?? null}
          />
        </>
      )}

      <section aria-labelledby="mc-participants-heading">
        <h2 id="mc-participants-heading" className="mb-2 font-display text-base text-ink">
          Who&rsquo;s in
        </h2>
        <ParticipantList participants={context.participants} canView={context.actions.canViewParticipants} />
      </section>

      {/* No sr-only h2 wrapper here -- MessagingPanel already renders its own real "Messages" heading. */}
      <section>
        <MessagingPanel fixtureId={context.fixture.fixtureId} conversation={context.messaging} initialMessages={messages} />
      </section>
    </div>
  )
}

function CountCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink/8 bg-white px-2 py-2.5">
      <dt className="text-[10px] tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-display text-lg text-ink">{value}</dd>
    </div>
  )
}
