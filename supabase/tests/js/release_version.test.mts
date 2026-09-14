import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { nextReleaseVersion } from "@/lib/platform/release-version"

/**
 * ONE VERSION, OWNED BY SITE ADMIN.
 *
 * Ovalball's displayed version is the published release recorded in Site Admin
 * → Release & Platform Mode. package.json's version was once rendered in the
 * Site Admin dashboard, System Health and the public footer, and drifted to
 * 0.0.1 while the published release was 0.0.3. These tests keep that from
 * coming back and cover the next-version suggestion.
 */

test("the next version is the patch after the highest recorded version, drafts included", () => {
  assert.equal(nextReleaseVersion(["0.0.3", "0.0.2"]), "0.0.4")
  assert.equal(nextReleaseVersion(["0.0.2", "0.0.10", "0.0.9"]), "0.0.11", "numeric, not alphabetical, ordering")
  assert.equal(nextReleaseVersion(["1.2.9", "0.9.99"]), "1.2.10")
  assert.equal(nextReleaseVersion([" 0.1.0 "]), "0.1.1")
})

test("no suggestion is invented when nothing recorded is a plain MAJOR.MINOR.PATCH", () => {
  assert.equal(nextReleaseVersion([]), "")
  assert.equal(nextReleaseVersion(["beta-1", "2026.09"]), "")
  assert.equal(nextReleaseVersion(["beta-1", "0.0.3"]), "0.0.4", "non-standard labels are ignored, not fatal")
})

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

test("no application code reads package.json or an APP_VERSION constant for a displayed version", () => {
  const offenders = ["app", "components", "lib"].flatMap((d) => sources(d)).filter((file) => {
    const src = readFileSync(file, "utf8")
    return /from\s+["'][./@a-z-]*package\.json["']/.test(src) || /\bAPP_VERSION\b/.test(src)
  })
  assert.deepEqual(offenders, [], "read the Site Admin published release (getBetaBadgeState) instead")
})
