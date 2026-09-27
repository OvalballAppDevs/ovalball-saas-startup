#!/usr/bin/env node
// =====================================================================================================
// FIND A FIXTURE UAT WORLD -- SYNTHETIC CREST UPLOAD (companion to
// supabase/seeds/local_uat_find_fixture_matching_world.sql).
//
// Storage uploads cannot happen inside a plain .sql seed file (there is no raw-SQL path into Supabase
// Storage's own bucket/object API) -- this is the one companion script that finishes what that seed
// starts. Run it once after the SQL seed has created the ten synthetic clubs:
//
//   node scripts/seed-find-fixture-uat-crests.mjs
//
// IDEMPOTENT: `upsert: true` on the storage object, and the `clubs.logo_storage_path` update is the
// same value every run -- re-running this script changes nothing that is already correct.
//
// THE TEN CRESTS ARE DELIBERATELY SYNTHETIC: simple flat-colour shield shapes with a one-letter initial
// and a basic heraldic pattern (stripe/quarters/hoop/chevron/etc), generated as SVG and rasterised with
// `sharp` -- never a photograph, never modelled on any real club's actual identity, never real club IP.
// They exist only so FF-3's crest-forward result cards can be evaluated with something other than the
// deliberate fallback on every row. Source PNGs live in
// supabase/seeds/assets/find-fixture-uat-crests/*.png, committed alongside this script.
//
// Wires through the SAME canonical path a real club logo upload uses
// (app/(app)/club/actions.ts's uploadClubLogo): `club-logos` bucket, `${clubId}/logo-...png`,
// `clubs.logo_storage_path` -- never a special FF-3-only crest lookup.
// =====================================================================================================
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CREST_DIR = path.join(REPO, "supabase/seeds/assets/find-fixture-uat-crests")

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY must be set (local dev: `supabase status -o env` prints it as SERVICE_ROLE_KEY).")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CLUBS = [
  ["north", "ovalball-uat-north-rfc"],
  ["south", "ovalball-uat-south-rfc"],
  ["east", "ovalball-uat-east-rfc"],
  ["west", "ovalball-uat-west-rfc"],
  ["valley", "ovalball-uat-valley-rfc"],
  ["riverside", "ovalball-uat-riverside-rfc"],
  ["borough", "ovalball-uat-borough-rl"],
  ["athletic", "ovalball-uat-athletic-rfc"],
  ["park", "ovalball-uat-park-rfc"],
  ["united", "ovalball-uat-united-rfc"],
]

let failures = 0
for (const [key, normalizedKey] of CLUBS) {
  const { data: club, error: clubErr } = await supabase
    .from("clubs")
    .select("id, club_directory!inner(normalized_key)")
    .eq("club_directory.normalized_key", normalizedKey)
    .maybeSingle()
  if (clubErr || !club) {
    console.error(`SKIP (club not seeded yet): ${normalizedKey}`, clubErr?.message ?? "")
    failures += 1
    continue
  }
  const storagePath = `${club.id}/logo-uat-seed.png`
  const file = readFileSync(path.join(CREST_DIR, `${key}.png`))
  const { error: uploadErr } = await supabase.storage.from("club-logos").upload(storagePath, file, { contentType: "image/png", upsert: true })
  if (uploadErr) {
    console.error(`UPLOAD FAILED: ${normalizedKey}`, uploadErr.message)
    failures += 1
    continue
  }
  const { error: updateErr } = await supabase.from("clubs").update({ logo_storage_path: storagePath }).eq("id", club.id)
  if (updateErr) {
    console.error(`UPDATE FAILED: ${normalizedKey}`, updateErr.message)
    failures += 1
    continue
  }
  console.log(`OK: ${normalizedKey} -> ${storagePath}`)
}

if (failures > 0) {
  console.error(`${failures} club(s) did not get a crest -- see above.`)
  process.exit(1)
}
console.log("All ten Find a Fixture UAT crests are in place.")
