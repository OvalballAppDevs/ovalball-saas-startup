import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Settings2 } from "lucide-react"

import { MatchConditions } from "@/components/fixtures/match-centre/match-conditions"
import { EventAttendancePanel } from "@/components/events/event-centre/attendance-panel"
import { EventCentreHero } from "@/components/events/event-centre/hero"
import { WhosComing } from "@/components/events/event-centre/whos-coming"
import { getEventCentreContext, eventForecastInput } from "@/lib/app-context/event-centre-data"
import { createClient } from "@/lib/supabase/server"
import { getFixtureForecast } from "@/lib/weather/fixture-forecast"

export const dynamic = "force-dynamic"
export const metadata = { title: "Event Centre" }

/**
 * EVENT CENTRE -- one club event, one page, every role.
 *
 * ONE SHARED SURFACE, exactly as Match Centre and Training Centre are. There
 * is no per-role variant of this component tree and no role branch choosing
 * between trees. Everybody who may open this event sees the same structure in
 * the same order; CAPABILITY decides what their viewer's data and actions put
 * in front of them, and capability is resolved server-side by
 * getEventCentreContext -- never from a role name in the browser.
 *
 * ONE CANONICAL RECORD. The route is the event's own id. The Calendar projects
 * a multi-day event onto every day it covers and, for a multi-team event, into
 * every affected team's lane -- and every one of those cells links HERE, with
 * this same id. The multiplication is presentation and it stops at the screen.
 *
 * THIS PAGE IS NOT THE EVENT EDITOR. It reads the canonical event and writes
 * exactly one thing a participant owns: their own response. Name, dates,
 * location, pitches and team scope are edited in Event Management, and staff
 * are routed there from the Calendar rather than being given a second form
 * here that would be a copy of it.
 *
 * A FORGED ID IS A 404. get_club_event_card returns null for an event this
 * viewer may not see, which is the same answer a genuinely missing event
 * gives -- so the route cannot be used to discover whether another club's
 * event exists.
 */
export default async function EventCentrePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const supabase = await createClient()

  const ctx = await getEventCentreContext(supabase, eventId)
  if (!ctx) notFound()

  // The club crest, from the same private bucket every other Centre reads.
  let clubLogoUrl: string | null = null
  if (ctx.clubLogoPath) {
    const { data } = await supabase.storage.from("club-logos").createSignedUrl(ctx.clubLogoPath, 3600)
    clubLogoUrl = data?.signedUrl ?? null
  }

  // WEATHER FROM THE EVENT'S OWN RESOLVED LOCATION -- a club venue's canonical
  // coordinates, or the stored coordinates of the external address. Same
  // adapter, same cache and same horizon rule as Match Centre and Training
  // Centre, so an event months away costs no provider request at all and
  // answers TOO_EARLY_FOR_FORECAST instead.
  const weather = await getFixtureForecast(eventForecastInput(ctx))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/calendar"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Calendar
        </Link>
        {/* MANAGEMENT ACTIONS, for the people who hold the capability and
            nobody else. `canManage` is the capability engine's answer, resolved
            server-side -- an ordinary player or parent is not shown a disabled
            control they cannot use, they are shown nothing.

            Editing and cancelling both live on the canonical management
            surface rather than being cloned here: this page is what a
            participant opens, and a second editor on it would be a second
            place for the event's truth to be written. */}
        {ctx.canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/club/events?event=${ctx.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink/12 bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
            >
              <Settings2 className="size-4" aria-hidden="true" />
              Edit Event
            </Link>
            {ctx.status !== "CANCELLED" && (
              <Link
                href={`/club/events?event=${ctx.id}&action=cancel`}
                className="inline-flex min-h-11 items-center rounded-lg border border-destructive/30 bg-white px-3.5 text-sm font-medium text-destructive-text transition-colors hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
              >
                Cancel Event
              </Link>
            )}
          </div>
        )}
      </div>

      <EventCentreHero event={ctx} clubLogoUrl={clubLogoUrl}>
        {/* The reply lives inside the invitation, as it does on both sibling
            surfaces. A viewer with nobody to answer for gets nothing here --
            not a locked panel, because they are not missing a feature. */}
        {ctx.myPlayers.length > 0 && ctx.status !== "CANCELLED" && (
          <div className="border-t border-white/10 bg-black/15">
            <EventAttendancePanel eventId={ctx.id} entries={ctx.myPlayers} />
          </div>
        )}
      </EventCentreHero>

      {/* THE SAME CONDITIONS COMPONENT the other two Centres render. A ground,
          a pitch and a forecast are the same three facts whether the thing
          happening there is a match, a session or a centenary weekend. */}
      {ctx.location && (
        <MatchConditions
          venue={{
            venueId: null,
            name: ctx.location.name,
            address: ctx.location.address,
            addressLines: ctx.location.address ? ctx.location.address.split(", ") : [],
            postcode: ctx.location.postcode,
            latitude: ctx.location.latitude,
            longitude: ctx.location.longitude,
            geocodeStatus: ctx.location.geocodeStatus,
          }}
          pitch={{ pitchId: null, label: ctx.pitches.map((p) => p.displayName).join(", ") || null }}
          weather={weather}
          heading="Event Conditions"
          headingId="ec-conditions-heading"
          momentLabel={ctx.isMultiDay ? "On the First Day" : "At the Start"}
        />
      )}

      {ctx.description && (
        <section aria-labelledby="ec-about-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
          <h2 id="ec-about-heading" className="border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
            About This Event
          </h2>
          {/* PLAIN TEXT, WITH ITS LINE BREAKS KEPT. `whitespace-pre-line`
              preserves the paragraphs somebody typed without interpreting a
              single character of what they typed as markup -- there is no
              rich-text pipeline in this product to hand it to, and inventing
              one here would be an HTML injection surface for the sake of bold
              text on a party invitation. */}
          <p className="px-5 py-4 text-sm leading-relaxed whitespace-pre-line text-ink">{ctx.description}</p>
        </section>
      )}

      <WhosComing entries={ctx.register} canView={ctx.canViewRegister} />
    </div>
  )
}
