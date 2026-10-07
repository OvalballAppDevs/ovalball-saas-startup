// THE ONE CANONICAL OVALBALL LOCATION SERVICE.
//
// Provider: postcodes.io (https://api.postcodes.io) -- public, keyless, no account, no secret. This
// function requires NO environment variable at all. If anything in this system ever reports "address
// lookup isn't configured", that is a defect, not a setup step.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS EDGE FUNCTION IS RETAINED EVEN THOUGH postcodes.io NEEDS NO KEY (the §13 decision).
//
// The obvious argument for deleting it is that a keyless public API can be called straight from the
// client. That was weighed against the existing Ovalball architecture rather than against
// convenience, and the function stays, for four reasons that outlive any one provider:
//
//   1. ONE SERVICE CONTRACT FOR WEB AND MOBILE. `packages/contracts/src/address.ts` defines the
//      shape; this function is the single place that produces it. Two clients calling postcodes.io
//      directly would be two normalisations of the same payload, free to drift -- which is precisely
//      the "one canonical implementation" rule this whole address programme exists to enforce.
//   2. PROVIDER ABSTRACTION THAT HAS ALREADY PAID FOR ITSELF. This is the second provider decision
//      in two days. The boundary meant swapping getAddress.io for postcodes.io changed this file and
//      left every screen's contract intact.
//   3. CENTRALISED VALIDATION. Postcode shape-checking, canonical spacing and the failure vocabulary
//      are applied once, server-side, so a client cannot skip them.
//   4. IDENTICAL BEHAVIOUR. Web and mobile cannot diverge on what "not found" or "temporarily
//      unavailable" means, because neither decides it.
//
// The cost is one network hop. That is a fair price for the above, and the function is already part
// of the normal local stack (it comes up with `supabase start`), so it costs no developer setup.
// ---------------------------------------------------------------------------------------------
//
// MODES
//   { mode: "address-suggest", q: "23 Rosehill" } -> candidate PROPERTIES            (Google Places)
//   { mode: "address-resolve", placeId: "..." }   -> one CanonicalAddress            (Google Places)
//   { mode: "suggest",  q: "BB11" }              -> candidate POSTCODES with their district (postcodes.io)
//   { mode: "resolve",  postcode: "..." }        -> one CanonicalLocation + its precision
//   { mode: "reverse",  latitude, longitude }    -> nearest CanonicalLocations (exposed, no UI yet)
//   { mode: "nearest",  postcode: "..." }        -> neighbouring CanonicalLocations (exposed, no UI yet)
//
// NO PROPERTY-LEVEL RESULTS ARE POSSIBLE HERE, BY DESIGN. postcodes.io holds no Royal Mail/PAF
// property data. This function will never return a house number or a street, and nothing downstream
// may synthesise one.

const POSTCODES_IO = "https://api.postcodes.io"
const PLACES = "https://places.googleapis.com/v1"

// Billed per request, so it lives only in this function's secret. If it is absent the Places modes
// answer `not_configured` honestly rather than pretending to search -- the postcode modes are
// unaffected, because postcodes.io needs no credential at all.
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

// Mirrors packages/contracts/src/address.ts, which is the source of truth. Deno cannot import from
// the TypeScript workspace, so the shape is restated here; the contract file and this file must be
// changed together, and the contract's own tests pin the normalisation rules both sides rely on.
const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i

function normaliseOutcode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").trim()
  return OUTCODE.test(compact) ? compact.toUpperCase() : null
}

function normalisePostcode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").trim()
  const match = compact.match(FULL_POSTCODE)
  if (!match) return null
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`
}

interface PostcodesIoResult {
  postcode?: string
  latitude?: number | null
  longitude?: number | null
  admin_district?: string | null
  admin_county?: string | null
  region?: string | null
  country?: string | null
}

/** postcodes.io -> the canonical shape. `country` is Ovalball's own constant, NOT the provider's
 * value; the provider's "England"/"Scotland"/... is carried as `nation`, because they are two
 * different facts and neither should silently stand in for the other. */
function toCanonicalLocation(r: PostcodesIoResult): { ok: true; location: Record<string, unknown> } | { ok: false } {
  if (typeof r.latitude !== "number" || typeof r.longitude !== "number" || typeof r.postcode !== "string") return { ok: false }
  return {
    ok: true,
    location: {
      postcode: r.postcode,
      latitude: r.latitude,
      longitude: r.longitude,
      // admin_district is the LOCAL AUTHORITY, not a postal town -- see the contract header.
      adminDistrict: r.admin_district ?? null,
      county: r.admin_county ?? null,
      region: r.region ?? null,
      nation: r.country ?? null,
      country: "United Kingdom",
    },
  }
}

/** Uses `/postcodes?q=` rather than `/autocomplete`, because it returns whole records. A list of bare
 * postcodes ("BB11 1AD, BB11 1AE...") gives a person nothing to choose between; showing the district
 * beside each one does. Costs the same one request. */
async function suggest(q: string): Promise<Response> {
  const trimmed = q.trim()
  if (trimmed.length < 2) return json({ status: "invalid_query", reason: "Type at least two characters." })
  try {
    const res = await fetch(`${POSTCODES_IO}/postcodes?q=${encodeURIComponent(trimmed)}&limit=10`)
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const body = (await res.json()) as { result?: PostcodesIoResult[] | null }
    // A 200 with result:null is postcodes.io's "nothing matched" -- a real answer, not a broken one.
    if (body.result === null || body.result === undefined) return json({ status: "ok", suggestions: [] })
    if (!Array.isArray(body.result)) return json({ status: "malformed_response" })
    const suggestions = body.result
      .filter((r) => typeof r.postcode === "string")
      .map((r) => ({ postcode: r.postcode as string, adminDistrict: r.admin_district ?? null }))
    return json({ status: "ok", suggestions })
  } catch {
    return json({ status: "network_error" })
  }
}

/** Was this a real postcode that Royal Mail has since withdrawn? Only asked once an ordinary lookup
 * has already missed, so it costs nothing on the normal path -- and it turns a misleading
 * "we couldn't find that" into the truth for the historic addresses a club directory is full of. */
async function terminatedAnswer(canonical: string): Promise<Response | null> {
  try {
    const res = await fetch(`${POSTCODES_IO}/terminated_postcodes/${encodeURIComponent(canonical.replace(/\s/g, ""))}`)
    if (!res.ok) return null
    const body = (await res.json()) as { result?: { postcode?: string; year_terminated?: number } | null }
    if (!body.result || typeof body.result.year_terminated !== "number") return null
    return json({ status: "terminated", postcode: body.result.postcode ?? canonical, yearTerminated: body.result.year_terminated })
  } catch {
    return null
  }
}

/** An outward code alone still has a real position, so the map can follow a half-typed postcode to
 * the right town. Its coordinate is the outward code's centroid, which is coarser again than a
 * postcode's -- the caller is told which it got via `precision`. */
async function resolveOutcode(outcode: string): Promise<Response> {
  try {
    const res = await fetch(`${POSTCODES_IO}/outcodes/${encodeURIComponent(outcode)}`)
    if (res.status === 404) return json({ status: "not_found" })
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const body = (await res.json()) as { result?: { outcode?: string; latitude?: number; longitude?: number; admin_district?: string[]; country?: string[] } | null }
    const r = body.result
    if (!r || typeof r.latitude !== "number" || typeof r.longitude !== "number" || typeof r.outcode !== "string") return json({ status: "malformed_response" })
    return json({
      status: "ok",
      location: {
        postcode: r.outcode,
        latitude: r.latitude,
        longitude: r.longitude,
        // These arrive as arrays for an outward code, which can span several districts. Only a single
        // unambiguous value is reported; anything else is left null rather than picking one.
        adminDistrict: Array.isArray(r.admin_district) && r.admin_district.length === 1 ? r.admin_district[0] : null,
        county: null,
        region: null,
        nation: Array.isArray(r.country) && r.country.length === 1 ? r.country[0] : null,
        country: "United Kingdom",
      },
      precision: "outcode",
    })
  } catch {
    return json({ status: "network_error" })
  }
}

async function resolve(raw: string): Promise<Response> {
  const canonical = normalisePostcode(raw)
  if (!canonical) {
    // Not a full postcode -- but an outward code on its own is still placeable, so the map can follow
    // a half-typed postcode rather than sitting still until the last character arrives.
    const outcode = normaliseOutcode(raw)
    if (outcode) return await resolveOutcode(outcode)
    return json({ status: "invalid_query", reason: "That doesn't look like a complete UK postcode." })
  }
  try {
    const res = await fetch(`${POSTCODES_IO}/postcodes/${encodeURIComponent(canonical.replace(/\s/g, ""))}`)
    if (res.status === 404) return (await terminatedAnswer(canonical)) ?? json({ status: "not_found" })
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const body = (await res.json()) as { result?: PostcodesIoResult | null }
    if (!body.result) return (await terminatedAnswer(canonical)) ?? json({ status: "not_found" })
    const mapped = toCanonicalLocation(body.result)
    if (!mapped.ok) return json({ status: "malformed_response" })
    return json({ status: "ok", location: mapped.location, precision: "postcode" })
  } catch {
    return json({ status: "network_error" })
  }
}

/** Coordinates -> nearest postcodes. Exposed for future Ovalball features (a pin dropped on a map);
 * no UI consumes it yet, so that when one does it reuses this rather than growing its own call. */
async function reverseGeocode(lat: number, lon: number, limit: number): Promise<Response> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ status: "invalid_query", reason: "Need a latitude and a longitude." })
  try {
    const res = await fetch(`${POSTCODES_IO}/postcodes?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&limit=${encodeURIComponent(String(limit))}`)
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const body = (await res.json()) as { result?: PostcodesIoResult[] | null }
    if (!body.result) return json({ status: "not_found" })
    return json({ status: "ok", locations: body.result.map(toCanonicalLocation).filter((m) => m.ok).map((m) => (m as { ok: true; location: unknown }).location) })
  } catch {
    return json({ status: "network_error" })
  }
}

/** A postcode -> its neighbours, nearest first. Same reasoning as reverse geocoding. */
async function nearest(raw: string, limit: number): Promise<Response> {
  const canonical = normalisePostcode(raw)
  if (!canonical) return json({ status: "invalid_query", reason: "That doesn't look like a complete UK postcode." })
  try {
    const res = await fetch(`${POSTCODES_IO}/postcodes/${encodeURIComponent(canonical.replace(/\s/g, ""))}/nearest?limit=${encodeURIComponent(String(limit))}`)
    if (res.status === 404) return json({ status: "not_found" })
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const body = (await res.json()) as { result?: PostcodesIoResult[] | null }
    if (!body.result) return json({ status: "not_found" })
    return json({ status: "ok", locations: body.result.map(toCanonicalLocation).filter((m) => m.ok).map((m) => (m as { ok: true; location: unknown }).location) })
  } catch {
    return json({ status: "network_error" })
  }
}

// ===================================================================================================
// PROPERTY-LEVEL ADDRESS SEARCH (Google Places API New).
//
// The LEGACY Places endpoints are not enabled on this project and must not be used -- they answer
// REQUEST_DENIED with a "legacy API" message. These are the New endpoints.
//
// SESSION TOKENS ARE A COST CONTROL, NOT A DETAIL. Google bills autocomplete per request unless the
// requests form a session that ends in a Details call carrying the same token, in which case the
// autocomplete requests in that session are not separately charged. The client generates one token per
// search and hands it back on resolve, so an eight-keystroke search costs one session rather than eight
// lookups. A missing token still works; it just costs more.
// ===================================================================================================

function placesUnavailable(): Response | null {
  return PLACES_KEY ? null : json({ status: "invalid_query", reason: "Address search is not configured in this environment." })
}

async function placesSuggest(q: string, sessionToken: string | null): Promise<Response> {
  const unavailable = placesUnavailable()
  if (unavailable) return unavailable
  const trimmed = q.trim()
  if (trimmed.length < 3) return json({ status: "invalid_query", reason: "Type at least three characters." })
  try {
    const body: Record<string, unknown> = { input: trimmed, includedRegionCodes: ["gb"] }
    if (sessionToken) body.sessionToken = sessionToken
    const res = await fetch(`${PLACES}/places:autocomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": PLACES_KEY },
      body: JSON.stringify(body),
    })
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const data = (await res.json()) as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[] }
    const suggestions = (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is { placeId: string; text?: { text?: string } } => typeof p?.placeId === "string")
      .map((p) => {
        const label = p.text?.text ?? ""
        const parts = label.split(",").map((x) => x.trim()).filter(Boolean)
        return { placeId: p.placeId, label, primary: parts[0] ?? label, secondary: parts.slice(1).join(", ") }
      })
    return json({ status: "ok", suggestions })
  } catch {
    return json({ status: "network_error" })
  }
}

async function placesResolve(placeId: string, sessionToken: string | null): Promise<Response> {
  const unavailable = placesUnavailable()
  if (unavailable) return unavailable
  if (!placeId.trim()) return json({ status: "invalid_query", reason: "No address was selected." })
  try {
    // The field mask is what Google bills against -- only the fields Ovalball actually maps are asked for.
    const url = new URL(`${PLACES}/places/${encodeURIComponent(placeId)}`)
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken)
    const res = await fetch(url.toString(), {
      headers: { "X-Goog-Api-Key": PLACES_KEY, "X-Goog-FieldMask": "id,addressComponents,location" },
    })
    if (res.status === 404) return json({ status: "not_found" })
    if (!res.ok) return json({ status: "provider_error", httpStatus: res.status })
    const place = (await res.json()) as { id?: string; addressComponents?: { longText?: string; types?: string[] }[]; location?: { latitude?: number; longitude?: number } }
    if (typeof place.id !== "string") return json({ status: "malformed_response" })

    const components = place.addressComponents ?? []
    const pick = (type: string): string | null => components.find((c) => (c.types ?? []).includes(type))?.longText ?? null
    const streetNumber = pick("street_number")
    const route = pick("route")
    const premise = pick("premise")
    const subpremise = pick("subpremise")
    // UK order, most specific first: subpremise, named building, street. See the contract's own note.
    const streetLine = streetNumber && route ? `${streetNumber} ${route}` : route
    const parts = [subpremise, premise, streetLine].filter((p) => !!p && p.trim().length > 0) as string[]

    const latitude = typeof place.location?.latitude === "number" ? place.location.latitude : null
    const longitude = typeof place.location?.longitude === "number" ? place.location.longitude : null
    let postcode = pick("postal_code")
    let postcodeSource: "provider" | "reverse_geocoded" = "provider"

    // THE TWO PROVIDERS EARNING THEIR KEEP TOGETHER. Google returns a postcode for a specific building
    // (Turf Moor -> BB10 4BX) but NOT for a whole street ("Belvedere Road"), because a street spans
    // several postcodes -- which is honest, and also leaves a venue without the postcode Ovalball
    // needs. postcodes.io can reverse-geocode the coordinate Google did give us, free and keyless.
    // It is labelled `reverse_geocoded` rather than passed off as confirmed: it is the postcode
    // NEAREST the selected point, and for a street-level pick that may not be the venue's own.
    if (!postcode && latitude !== null && longitude !== null) {
      try {
        const rev = await fetch(`${POSTCODES_IO}/postcodes?lat=${latitude}&lon=${longitude}&limit=1`)
        if (rev.ok) {
          const revBody = (await rev.json()) as { result?: { postcode?: string }[] | null }
          const nearest = revBody.result?.[0]?.postcode
          if (typeof nearest === "string") {
            postcode = nearest
            postcodeSource = "reverse_geocoded"
          }
        }
      } catch {
        // A failed fill is not a failed resolution -- the address is still good without a postcode.
      }
    }

    return json({
      status: "ok",
      address: {
        line1: parts[0] ?? null,
        line2: parts.length > 1 ? parts.slice(1).join(", ") : null,
        // postal_town is a REAL postal town -- the field postcodes.io never had, and the reason a
        // Places resolution may set `town` where a postcode resolution may not.
        town: pick("postal_town") ?? pick("locality"),
        county: pick("administrative_area_level_2"),
        postcode,
        postcodeSource,
        nation: pick("administrative_area_level_1"),
        country: pick("country") ?? "United Kingdom",
        latitude,
        longitude,
        providerRef: place.id,
      },
    })
  } catch {
    return json({ status: "network_error" })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  let payload: { mode?: string; q?: string; postcode?: string; placeId?: string; sessionToken?: string; latitude?: number; longitude?: number; limit?: number }
  try {
    payload = await req.json()
  } catch {
    return json({ status: "invalid_query", reason: "Expected a JSON body." })
  }

  const mode = payload.mode
  const sessionToken = typeof payload.sessionToken === "string" && payload.sessionToken ? payload.sessionToken : null
  // Property-level search (Google Places) -- the canonical interactive path.
  if (mode === "address-suggest") return await placesSuggest(payload.q ?? "", sessionToken)
  if (mode === "address-resolve") return await placesResolve(payload.placeId ?? "", sessionToken)
  // Postcode intelligence (postcodes.io) -- free, keyless, and the only source of the facts below.
  if (mode === "suggest") return await suggest(payload.q ?? "")
  if (mode === "resolve") return await resolve(payload.postcode ?? "")
  // Capped so a caller cannot turn one request into an unbounded provider query.
  const limit = Math.min(Math.max(payload.limit ?? 5, 1), 10)
  if (mode === "reverse") return await reverseGeocode(payload.latitude as number, payload.longitude as number, limit)
  if (mode === "nearest") return await nearest(payload.postcode ?? "", limit)
  return json({ status: "invalid_query", reason: "Unknown mode." })
})
