import { test } from "node:test"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { AUTH_SESSION_VERSION } from "@/lib/auth/session-version"

/**
 * record_session_version() clamps what a session may store to
 * internal.auth_session_version(). If the TypeScript constant is bumped
 * without the database function, every session is stored below the new
 * requirement and signed out on every request; if the database is bumped
 * alone, the clamp stops meaning anything. The latest migration defining the
 * function must agree with the constant.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")

test("the database's session version matches AUTH_SESSION_VERSION", async () => {
  const dir = path.join(ROOT, "supabase/migrations")
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()
  let latest: number | null = null
  for (const file of files) {
    const source = await readFile(path.join(dir, file), "utf8")
    const pattern = /create or replace function internal\.auth_session_version\(\)[\s\S]*?as \$\$\s*select\s+(\d+)\s*\$\$/gi
    for (const match of source.matchAll(pattern)) latest = Number(match[1])
  }
  assert.notEqual(latest, null, "internal.auth_session_version() must be defined by a migration")
  assert.equal(latest, AUTH_SESSION_VERSION)
})
