// Applies a researched logo_candidate_url as the real, applied crest (club_directory.logo_storage_path)
// for clubs that have one but no crest uploaded yet -- the same storage bucket/path convention and
// size/type limits as the manual admin upload tool (app/(app)/admin/clubs/[directoryId]/actions.ts,
// uploadDirectoryLogoAdmin), just run in bulk. Local-only: uses SUPABASE_SERVICE_ROLE_KEY from
// apps env against the local Supabase stack (127.0.0.1:54321).
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingestion/apply_logo_candidates.mjs <targets.txt>
// targets.txt is pipe-delimited: directory_id|name|logo_candidate_url, one per line.

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not set in environment")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"])
const EXT_FOR_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }

const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean)
const rows = lines.map((l) => {
  const [id, name, url] = l.split("|")
  return { id, name, url }
})

console.log(`Applying logo candidates for ${rows.length} clubs...`)

let ok = 0
let failed = 0
const failures = []

for (const row of rows) {
  try {
    const res = await fetch(row.url, { redirect: "follow", signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (!ALLOWED_TYPES.has(contentType)) throw new Error(`unsupported content-type: ${contentType || "none"}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) throw new Error("empty response body")
    if (buf.length > MAX_BYTES) throw new Error(`too large: ${buf.length} bytes`)

    const ext = EXT_FOR_TYPE[contentType]
    const path = `${row.id}/logo-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, buf, {
      contentType,
      upsert: false,
    })
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`)

    execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
      { input: `update public.club_directory set logo_storage_path = '${path}' where id = '${row.id}';\n`, stdio: ["pipe", "ignore", "inherit"] }
    )

    ok++
  } catch (err) {
    failed++
    failures.push({ name: row.name, url: row.url, error: String(err.message || err) })
  }
}

console.log(`\nDONE: ${ok} applied, ${failed} failed`)
if (failures.length) {
  console.log("\nFailures:")
  for (const f of failures) console.log(` - ${f.name}: ${f.error} (${f.url})`)
}
