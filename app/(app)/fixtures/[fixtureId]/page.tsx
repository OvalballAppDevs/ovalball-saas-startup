import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AttendancePanel } from "@/components/fixtures/match-centre/attendance-panel"
import { MatchCentreHero } from "@/components/fixtures/match-centre/hero"
import { MessagingPanel, type FixtureMessageRow } from "@/components/fixtures/match-centre/messaging-panel"
import { ParticipantList } from "@/components/fixtures/match-centre/participant-list"
import { VenueBlock } from "@/components/fixtures/match-centre/venue-block"
import { getMatchCentreContext } from "@/lib/app-context/match-centre-data"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

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

  const resolution = await getMatchCentreContext(supabase, user.id, fixtureId)
  if (resolution.status === "not_found") notFound()
  const { context } = resolution

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
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <Link href="/fixtures" className="inline-flex items-center gap-1.5 text-sm text-ink/55 hover:text-ink/80">
        <ArrowLeft className="size-3.5" /> Fixtures
      </Link>

      <MatchCentreHero fixture={context.fixture} homeSide={context.homeSide} awaySide={context.awaySide} />

      <section aria-labelledby="mc-attendance-heading" className="flex flex-col gap-2.5">
        <h2 id="mc-attendance-heading" className="sr-only">
          Attendance
        </h2>
        <dl className="grid grid-cols-4 gap-2 text-center">
          <CountCell label="Attending" value={context.attendance.counts.attending} />
          <CountCell label="Can't attend" value={context.attendance.counts.cannotAttend} />
          <CountCell label="Unsure" value={context.attendance.counts.unsure} />
          <CountCell label="Awaiting" value={context.attendance.counts.awaitingResponse} />
        </dl>
        <AttendancePanel fixtureId={context.fixture.fixtureId} entries={context.attendance.mine} fixtureCancelled={context.fixture.status === "CANCELLED"} />
      </section>

      <section aria-labelledby="mc-venue-heading">
        <h2 id="mc-venue-heading" className="sr-only">
          Venue
        </h2>
        <VenueBlock venue={context.venue} pitch={context.pitch} />
      </section>

      <section aria-labelledby="mc-participants-heading">
        <h2 id="mc-participants-heading" className="mb-2 font-display text-base text-ink">
          Who&rsquo;s in
        </h2>
        <ParticipantList participants={context.participants} canView={context.actions.canViewParticipants} />
      </section>

      <section aria-labelledby="mc-messages-heading">
        <h2 id="mc-messages-heading" className="sr-only">
          Messages
        </h2>
        <MessagingPanel fixtureId={context.fixture.fixtureId} conversation={context.messaging} initialMessages={messages} />
      </section>
    </div>
  )
}

function CountCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink/8 bg-white px-2 py-2.5">
      <dt className="text-[10px] tracking-wide text-ink/50 uppercase">{label}</dt>
      <dd className="mt-0.5 font-display text-lg text-ink">{value}</dd>
    </div>
  )
}
