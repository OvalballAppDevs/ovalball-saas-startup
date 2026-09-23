import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import { getFixtureForecast } from "@/lib/weather/fixture-forecast"
import { forecastLocation, homeClubIdFor, resolveFixtureVenue } from "@ovalball/contracts/fixtures/venue"
import type { Database } from "@/types/database.types"

export const dynamic = "force-dynamic"

/**
 * THE FORECAST FOR ONE FIXTURE, FOR A CLIENT THAT CANNOT REACH THE PROVIDER.
 *
 * WHY THIS ROUTE EXISTS AT ALL. Match Conditions is part of the Match Centre the
 * owner signed off, and the forecast in it is not decoration -- it is what a
 * parent checks on a Saturday morning. But `lib/weather/fixture-forecast.ts`
 * holds a PROVIDER CREDENTIAL and a Next.js cache, and neither can go into an
 * installed app: a key shipped to a handset is a key that has been published,
 * and a per-device cache would multiply a free tier's quota by the number of
 * phones.
 *
 * So the app asks the website, which already owns the one Met Office adapter,
 * the one cache keyed on rounded coordinates and kickoff hour, and the one
 * honest unavailable state. Ten teams at one ground at 10:30 still share a
 * single upstream call, whether they are looking at a browser or a phone.
 * Building a second forecast path for mobile would have been a second weather
 * integration, which is exactly what the shared-product rule forbids.
 *
 * AUTHORITY IS THE DATABASE'S, NOT THIS ROUTE'S. The caller's own access token
 * is used to build the Supabase client, so the fixture read runs under THEIR
 * RLS: a fixture they may not see comes back as nothing and this answers 404.
 * The route holds no service key and cannot see more than the caller can. That
 * is also why a missing fixture and a forbidden one give the same answer --
 * telling them apart would let somebody map the platform's fixtures by watching
 * which ids answer differently, which is the same reasoning the Match Centre
 * page's own 404 records.
 *
 * WEATHER IS DERIVED DATA, NEVER FIXTURE TRUTH. It is computed from the
 * fixture's canonical kickoff and its venue's coordinates, it is never stored
 * against the fixture, and a fixture is complete and correct with no forecast at
 * all. `getFixtureForecast` never throws -- every failure is one of the five
 * canonical states -- so a provider outage cannot take this endpoint with it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params

  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Sign in to read this forecast." }, { status: 401 })
  }

  // The CALLER'S token, not a service key. Every read below is the caller's own.
  const supabase = createSupabaseClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Sign in to read this forecast." }, { status: 401 })

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id, kickoff_date, kickoff_time, home_away, venue_id, venue_address, owning_team_id, opponent_team_id, opponent_directory_id")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!fixture) return NextResponse.json({ error: "Fixture not available." }, { status: 404 })

  /*
    The venue Match Centre shows is the venue the forecast asks about.

    This used to read `venue_id` alone, which is only one of the three ways a
    fixture records where it is played -- so a fixture whose ground is the
    fixture's own address, or the home side's default ground, had no location and
    every such match reported no forecast. One resolver now answers both questions,
    so the page cannot name a ground the weather was never asked about.
  */
  const [owningClubId, opponentClubId] = await Promise.all([
    clubIdOfTeam(supabase, fixture.owning_team_id),
    clubIdOfTeam(supabase, fixture.opponent_team_id),
  ])
  const venue = await resolveFixtureVenue(supabase, {
    venueId: fixture.venue_id,
    venueAddress: fixture.venue_address,
    homeClubId: homeClubIdFor({ homeAway: fixture.home_away, owningClubId, opponentClubId }),
    // An away fixture against a Directory-only opponent still has a home ground:
    // theirs, recorded in the Club Directory with its own postcode and geocode.
    homeDirectoryId: fixture.home_away === "Away" ? fixture.opponent_directory_id : null,
  })

  /*
    THE SAME PROVENANCE RULE AS EVER, now applied by the shared resolver. Only
    coordinates derived from the venue's OWN canonical postcode are used --
    anything else is a number somebody typed, and UAT found a venue pinned on a
    football ground three kilometres from the rugby club. Asking the sky about the
    wrong place produces a confident wrong answer rather than an honest absent one.
  */
  const location = forecastLocation(venue)

  const forecast = await getFixtureForecast({
    kickoffDate: fixture.kickoff_date,
    kickoffTime: fixture.kickoff_time,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  })

  return NextResponse.json(forecast, {
    // No shared cache in front of this: the upstream call is already cached by
    // lead time inside getFixtureForecast, and a CDN copy keyed only on the URL
    // would outlive that policy without knowing it existed.
    headers: { "Cache-Control": "private, no-store" },
  })
}

/** Which club a team belongs to, for resolving whose ground a fixture is played at. */
async function clubIdOfTeam(
  supabase: ReturnType<typeof createSupabaseClient<Database>>,
  teamId: string | null
): Promise<string | null> {
  if (!teamId) return null
  const { data } = await supabase.from("teams").select("club_id").eq("id", teamId).maybeSingle()
  return data?.club_id ?? null
}
