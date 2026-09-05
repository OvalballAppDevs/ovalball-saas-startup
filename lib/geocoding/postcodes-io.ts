import "server-only"

/**
 * postcodes.io -- free, keyless UK postcode lookup (no account, no
 * billing, no secret to protect). Chosen specifically so the map's
 * location data never depends on a browser-exposed or leaked API key.
 * https://postcodes.io/docs -- bulk endpoint accepts up to 100 postcodes
 * per request, so a full club_directory backfill is a handful of calls,
 * never one call per row.
 */

const POSTCODES_IO_BASE_URL = "https://api.postcodes.io"
const BULK_LOOKUP_BATCH_SIZE = 100

export interface PostcodeCoordinates {
  latitude: number
  longitude: number
}

interface BulkLookupResponseItem {
  query: string
  result: { latitude: number; longitude: number } | null
}

interface BulkLookupResponse {
  status: number
  result: BulkLookupResponseItem[]
}

/**
 * Looks up many postcodes at once, batching internally at the provider's
 * 100-per-request limit. Returns a map keyed by the EXACT input string so
 * callers can join back to their own rows; a postcode the provider
 * couldn't resolve (invalid/retired) is simply absent from the map --
 * never a fabricated 0,0 or an approximate guess.
 */
export async function bulkLookupPostcodes(postcodes: string[]): Promise<Map<string, PostcodeCoordinates>> {
  const results = new Map<string, PostcodeCoordinates>()
  const unique = Array.from(new Set(postcodes.map((p) => p.trim()).filter(Boolean)))

  for (let i = 0; i < unique.length; i += BULK_LOOKUP_BATCH_SIZE) {
    const batch = unique.slice(i, i + BULK_LOOKUP_BATCH_SIZE)
    const response = await fetch(`${POSTCODES_IO_BASE_URL}/postcodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch }),
    })
    if (!response.ok) {
      throw new Error(`postcodes.io bulk lookup failed with status ${response.status}`)
    }
    const body = (await response.json()) as BulkLookupResponse
    for (const item of body.result) {
      if (item.result) {
        results.set(item.query, { latitude: item.result.latitude, longitude: item.result.longitude })
      }
    }
  }

  return results
}
