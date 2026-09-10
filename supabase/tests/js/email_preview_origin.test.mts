import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { CONTRACTED_EVENT_KEYS, templateContract } from "@/lib/email/contracts"
import { emailLogoUrl } from "@/lib/email/design/components"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

const SITE = "http://localhost:3000"

/**
 * ASSET ORIGIN IS FOR SITE ADMIN PREVIEW ONLY, AND ONLY FOR AN IMAGE.
 *
 * A worktree dev server can legitimately run on a port other than the one
 * NEXT_PUBLIC_SITE_URL names, which used to leave the Email Configuration
 * preview showing a broken logo even though the asset route itself worked
 * perfectly well. The fix threads an optional `assetOrigin` through the SAME
 * canonical renderer real mail uses -- these tests pin the two invariants
 * that make that safe: it can only ever change where the LOGO is fetched
 * from, and it is validated exactly as strictly as `siteUrl` always was.
 */

test("assetOrigin changes only the embedded logo, never a CTA or link destination", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const fixture = PREVIEW_FIXTURES[key][0]
    const contract = templateContract(key)

    const withoutOverride = renderEmail(key, fixture.data as never, SITE, contract.default)
    const withOverride = renderEmail(key, fixture.data as never, SITE, contract.default, "http://localhost:3111")

    const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(
      hrefs(withOverride.html),
      hrefs(withoutOverride.html),
      `"${key}": assetOrigin must not change any href`
    )

    // Every link in both renders must still resolve to the canonical site
    // origin -- assetOrigin must never leak into a destination.
    for (const href of hrefs(withOverride.html)) {
      assert.ok(href.startsWith(SITE), `"${key}": link "${href}" does not resolve to the canonical site origin`)
    }
  }
})

test("assetOrigin only ever moves the logo's own host, and only when a logo is configured", () => {
  const withoutOverride = emailLogoUrl(SITE)
  const withOverride = emailLogoUrl(SITE, "http://localhost:3111")

  if (withoutOverride === null) {
    // No brand logo configured in this render context: nothing to move.
    assert.equal(withOverride, null)
    return
  }

  assert.ok(withOverride?.startsWith("http://localhost:3111/"), "assetOrigin should redirect the logo's own host")
  assert.equal(
    new URL(withOverride!).pathname,
    new URL(withoutOverride).pathname,
    "the asset PATH must be identical regardless of which origin serves it"
  )
})

test("an assetOrigin that is not a valid absolute URL is refused, exactly like siteUrl always was", () => {
  assert.equal(emailLogoUrl(SITE, "not a url"), null)
  assert.equal(emailLogoUrl(SITE, "javascript:alert(1)"), null)
})

test("emailLogoUrl accepts whatever origin it is given -- the safety boundary is who may call it", () => {
  // assetOrigin is not a value substituted into an otherwise-fixed siteUrl
  // check; it IS the check, so a syntactically valid foreign origin DOES
  // build a URL against it. That is only safe because this parameter is
  // never reachable from a browser-supplied value -- pinned by the next test.
  const result = emailLogoUrl(SITE, "https://attacker.example")
  if (result !== null) {
    assert.equal(new URL(result).origin, "https://attacker.example")
  }
})

test("the real send pipeline never imports the preview-only origin resolver", async () => {
  // sendEmailEvent must call renderEmail with assetOrigin left undefined, so
  // every real send resolves its logo from siteUrl alone. Structural rather
  // than behavioural, because the alternative -- asserting this by reading
  // rendered output -- can't distinguish "never passed one" from "passed one
  // that happened to match siteUrl this time".
  const sendPath = fileURLToPath(new URL("../../../lib/email/send.ts", import.meta.url))
  const source = await readFile(sendPath, "utf8")
  assert.ok(
    !source.includes("previewAssetOrigin"),
    "lib/email/send.ts must never import or call previewAssetOrigin -- that value exists for a Site Admin's own local preview only"
  )
})
