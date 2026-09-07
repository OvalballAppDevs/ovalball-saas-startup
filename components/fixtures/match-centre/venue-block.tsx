import type { MatchCentrePitch, MatchCentreVenue } from "@/lib/app-context/match-centre-data"

export function VenueBlock({ venue, pitch }: { venue: MatchCentreVenue; pitch: MatchCentrePitch }) {
  const hasVenue = !!(venue.name || venue.address)
  const directionsHref =
    venue.latitude != null && venue.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
      : venue.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`
        : null

  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3.5">
      <h3 className="text-xs font-medium tracking-[0.06em] text-ink/50 uppercase">Venue</h3>
      {hasVenue ? (
        <>
          {venue.name && <p className="mt-1.5 text-sm font-medium text-ink">{venue.name}</p>}
          {pitch.label && <p className="text-sm text-ink/70">{pitch.label}</p>}
          {venue.address && <p className="mt-0.5 text-sm text-ink/60">{venue.address}</p>}
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2.5 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Directions →
            </a>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-sm text-ink/50">Venue to be confirmed.</p>
      )}
    </div>
  )
}
