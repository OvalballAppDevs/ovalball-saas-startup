/**
 * Approximate straight-line ("as the crow flies") distance between two
 * lat/lng points, in miles -- the haversine formula. Deliberately labelled
 * "approximate" everywhere it surfaces in copy (lib/ovie/opponent-search.ts,
 * the confirmation/result cards) -- this is NOT road-driving distance, and
 * nothing in this app claims otherwise. Reuses the exact coordinate source
 * already powering the Partner Clubs map (club_directory.latitude/
 * longitude, populated by lib/geocoding/backfill.ts) -- no independent
 * geocoding call here.
 */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_MILES = 3958.8
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R_MILES * c
}

/** Rounds to one decimal place for display -- "8.4 miles", never a raw float. */
export function formatDistanceMiles(miles: number): string {
  return `Approx. ${miles.toFixed(1)} miles`
}
