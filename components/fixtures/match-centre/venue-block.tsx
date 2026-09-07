import { MapPin, Navigation, Trees } from "lucide-react"

import type { MatchCentrePitch, MatchCentreVenue } from "@/lib/app-context/match-centre-data"
import { buildDirectionsUrl, formatVenueAddress } from "@/lib/fixtures/directions-url"

/**
 * Where the match is, and how to get there.
 *
 * The address is assembled from the venue's STRUCTURED columns with blanks
 * dropped, never by joining every field regardless -- that is what produces
 * "Holden Road, , , BB11 4RS" on a card a parent is trying to read in a car
 * park.
 *
 * Directions is generated from canonical venue data through a constant host
 * (lib/fixtures/directions-url.ts). Nothing user-writable contributes to the
 * origin, and the action is omitted entirely when the venue has neither
 * coordinates nor an address -- a button that navigates nowhere is worse
 * than no button.
 */
export function VenueBlock({ venue, pitch }: { venue: MatchCentreVenue; pitch: MatchCentrePitch }) {
  const address = formatVenueAddress(venue) ?? venue.address
  const directionsUrl = buildDirectionsUrl(venue)
  const hasAnything = venue.name || address || pitch.label

  return (
    <section aria-labelledby="mc-venue-heading" className="rounded-lg border border-ink/10 bg-white px-5 py-4">
      <h2 id="mc-venue-heading" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        Venue
      </h2>

      {!hasAnything ? (
        <p className="mt-2 text-sm text-ink-muted">The venue hasn&rsquo;t been confirmed yet.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-display text-base text-ink">{venue.name ?? "Venue to be confirmed"}</p>
              {address && <p className="mt-0.5 text-sm text-ink-muted">{address}</p>}
            </div>
          </div>

          {pitch.label && (
            <div className="flex items-start gap-2.5">
              <Trees className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs tracking-wide text-ink-muted uppercase">Pitch</p>
                <p className="text-sm text-ink">{pitch.label}</p>
              </div>
            </div>
          )}

          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              // Deliberately NOT full width on mobile. The global "Ask Ovie"
              // widget is fixed bottom-RIGHT, and a full-width primary action
              // sits underneath it -- confirmed at 390px, where the widget
              // covered the right half of this button. Left-aligned and
              // self-sized, it stays clear of the widget while keeping a
              // 44px touch target.
              className="inline-flex min-h-11 w-auto max-w-[15rem] items-center justify-center gap-2 self-start rounded-md border border-forest-800/20 bg-forest-800/5 px-5 text-sm font-medium text-forest-900 transition-colors hover:bg-forest-800/10 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              <Navigation className="size-4" aria-hidden="true" />
              Directions
              <span className="sr-only"> to {venue.name ?? "the venue"}, opens in a new tab</span>
            </a>
          )}
        </div>
      )}
    </section>
  )
}
