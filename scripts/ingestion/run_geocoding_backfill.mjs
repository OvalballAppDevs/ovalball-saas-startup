// Runs the exact same canonical geocoding backfill lib/geocoding/backfill.ts's
// runClubDirectoryGeocodingBackfill performs (postcodes.io, one bulk call per 100 postcodes),
// against the local Supabase stack directly -- for use when there's no running web session to
// click the admin "Run Backfill" button through. Never touches a row that isn't
// geocode_status = 'pending'; always writes the real, canonical latitude/longitude columns
// (never a preview-only value).
//
// Usage: node scripts/ingestion/run_geocoding_backfill.mjs

import { execFileSync } from "node:child_process"

const POSTCODES_IO_BASE_URL = "https://api.postcodes.io"
const BATCH_SIZE = 100

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-Aqt", "-F", "|"],
    { input: sql, encoding: "utf8" }
  )
}

// Mark rows with no postcode as no_postcode, same as the canonical function's first step.
const noPostcodeOut = psql(`
  update public.club_directory set geocode_status = 'no_postcode'
  where geocode_status = 'pending' and postcode is null
  returning id;
`)
const markedNoPostcode = noPostcodeOut.trim().split("\n").filter((l) => l && l !== "id").length

const pendingOut = psql(`
  select id, postcode from public.club_directory
  where geocode_status = 'pending' and postcode is not null and active = true;
`)
const pendingRows = pendingOut
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [id, postcode] = l.split("|")
    return { id, postcode }
  })

console.log(`Marked ${markedNoPostcode} rows no_postcode. ${pendingRows.length} rows pending with a postcode.`)

if (pendingRows.length === 0) {
  console.log("Nothing to geocode.")
  process.exit(0)
}

const coordsByPostcode = new Map()
const uniquePostcodes = Array.from(new Set(pendingRows.map((r) => r.postcode.trim()).filter(Boolean)))
for (let i = 0; i < uniquePostcodes.length; i += BATCH_SIZE) {
  const batch = uniquePostcodes.slice(i, i + BATCH_SIZE)
  const res = await fetch(`${POSTCODES_IO_BASE_URL}/postcodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcodes: batch }),
  })
  if (!res.ok) {
    console.error(`postcodes.io batch failed with status ${res.status}`)
    continue
  }
  const body = await res.json()
  for (const item of body.result) {
    if (item.result) {
      coordsByPostcode.set(item.query, { latitude: item.result.latitude, longitude: item.result.longitude })
    }
  }
}

let geocoded = 0
let failed = 0
for (const row of pendingRows) {
  const coords = coordsByPostcode.get(row.postcode.trim())
  if (coords) {
    psql(
      `update public.club_directory set latitude = ${coords.latitude}, longitude = ${coords.longitude}, geocoded_at = now(), geocode_status = 'success', geocode_source = 'postcodes.io' where id = '${row.id}';`
    )
    geocoded++
  } else {
    psql(`update public.club_directory set geocoded_at = now(), geocode_status = 'failed', geocode_source = 'postcodes.io' where id = '${row.id}';`)
    failed++
  }
}

console.log(`\nDONE: ${geocoded} geocoded, ${failed} failed (postcode not resolvable by postcodes.io).`)
