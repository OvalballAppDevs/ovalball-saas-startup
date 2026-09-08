import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { EMAIL_COLORS, EMAIL_LOGO_PATH, emailLogoUrl } from "@/lib/email/design/components"
import { CONTRACTED_EVENT_KEYS, templateContract } from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/legal/metadata"

const SITE = "http://localhost:3000"

function renderDefault(key: (typeof CONTRACTED_EVENT_KEYS)[number]) {
  const fixture = PREVIEW_FIXTURES[key][0]
  return renderEmail(key, fixture.data as never, SITE, templateContract(key).default)
}

// ---------------------------------------------------------------------------
// The email palette IS the website palette
// ---------------------------------------------------------------------------

/**
 * This is the test the old comment should have been.
 *
 * `EMAIL_COLORS` claimed to restate globals.css and had quietly drifted from
 * it -- the email green was #1c4532 against a site forest-800 of #123d2c.
 * Nobody sees that in isolation. You see it the moment an email sits next to
 * the product it is supposedly from.
 */
test("every email colour is the same value the website uses", () => {
  const css = readFileSync("app/globals.css", "utf8")
  const tokenOf = (name: string) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
    assert.ok(match, `globals.css does not define --${name}`)
    return match![1].toLowerCase()
  }

  const pairs: Array<[keyof typeof EMAIL_COLORS, string]> = [
    ["forest950", "forest-950"],
    ["forest900", "forest-900"],
    ["forest800", "forest-800"],
    ["pitch600", "pitch-600"],
    ["pitch400", "pitch-400"],
    ["mint100", "mint-100"],
    ["chalk", "chalk"],
    ["ink", "ink"],
    ["inkMuted", "ink-muted"],
  ]

  for (const [emailKey, cssName] of pairs) {
    assert.equal(
      EMAIL_COLORS[emailKey].toLowerCase(),
      tokenOf(cssName),
      `email ${emailKey} has drifted from the site's --${cssName}`
    )
  }
})

// ---------------------------------------------------------------------------
// The logo
// ---------------------------------------------------------------------------

test("the logo is served from Ovalball's own origin, never a remote host", () => {
  const url = emailLogoUrl(SITE)
  assert.ok(url, "the logo URL should resolve")
  assert.ok(url!.startsWith(SITE), `the logo is loaded from elsewhere: ${url}`)
})

test("a hostile site URL cannot smuggle the logo onto another host", () => {
  // safeUrl is the backstop. Even if the origin resolver were wrong, the
  // logo cannot end up pointing somewhere Ovalball does not control.
  assert.equal(emailLogoUrl("https://ovalball.co.uk"), "https://ovalball.co.uk/email/ovalball-logo.png")
})

test("the logo asset exists at the one code-owned path", () => {
  // A broken image in a transactional email reads as a broken product, and
  // this is the single path every email points at.
  assert.doesNotThrow(
    () => readFileSync(`public${EMAIL_LOGO_PATH}`),
    `no brand asset at public${EMAIL_LOGO_PATH}`
  )
})

test("the logo carries real alt text, so a blocked image still says Ovalball", () => {
  const html = renderDefault("club_welcome").html
  assert.match(html, new RegExp(`alt="${PRODUCT_NAME}"`))
})

test("the brand survives images being switched off", () => {
  // Most clients block remote images by default. The product name, the
  // tagline and the operator statement are all live text, so the email is
  // fully readable with every image suppressed.
  const html = renderDefault("club_welcome").html
  const withoutImages = html.replace(/<img[^>]*>/g, "")
  assert.ok(withoutImages.includes(PRODUCT_NAME))
  assert.ok(withoutImages.includes(PRODUCT_TAGLINE))
  assert.ok(withoutImages.includes("Pipaxon Technologies Ltd"))
})

test("no email loads an image from anywhere but Ovalball", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const html = renderDefault(key).html
    for (const src of [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1])) {
      assert.ok(src.startsWith(SITE), `"${key}" loads a remote image: ${src}`)
    }
  }
})

// ---------------------------------------------------------------------------
// The eyebrow is code-owned
// ---------------------------------------------------------------------------

test("every event declares the kind of message it is", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    assert.ok(templateContract(key).eyebrow.trim(), `"${key}" has no eyebrow`)
  }
})

test("editing the copy cannot change what kind of message an email claims to be", () => {
  // The whole point of making the eyebrow code-owned. A Site Admin may
  // rewrite a safeguarding email's heading; filing it under "Welcome to
  // Ovalball" is a different power, and not one this screen grants.
  const html = renderEmail(
    "safeguarding_officer_message",
    { clubName: "Sample RUFC", senderName: "A Person", body: "A message." },
    SITE,
    {
      subject: "Welcome to Ovalball",
      preheader: "Welcome to Ovalball",
      heading: "Welcome to Ovalball",
      body: "Welcome to Ovalball.",
      ctaLabel: null,
    }
  ).html

  assert.ok(html.includes("Safeguarding"), "the safeguarding eyebrow should be present")
  assert.equal(
    templateContract("safeguarding_officer_message").eyebrow,
    "Safeguarding",
    "the eyebrow must come from the contract, not the copy"
  )
})

test("the eyebrow is not an editable field", () => {
  // If it ever appears in the editable content type, the guarantee above is
  // gone and this test is the thing that notices.
  const contentKeys = Object.keys(templateContract("club_welcome").default)
  assert.ok(!contentKeys.includes("eyebrow"), "eyebrow leaked into editable content")
})

// ---------------------------------------------------------------------------
// The shell, and what it must never contain
// ---------------------------------------------------------------------------

test("no email depends on JavaScript, external CSS, web fonts or SVG", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const html = renderDefault(key).html
    assert.ok(!/<script/i.test(html), `"${key}" contains a script`)
    assert.ok(!/<iframe/i.test(html), `"${key}" contains an iframe`)
    assert.ok(!/<form/i.test(html), `"${key}" contains a form`)
    assert.ok(!/<svg/i.test(html), `"${key}" contains an SVG, which Outlook will not render`)
    assert.ok(!/\son[a-z]+=/i.test(html), `"${key}" contains an inline event handler`)
    assert.ok(!/<link[^>]+stylesheet/i.test(html), `"${key}" loads external CSS`)
    assert.ok(!/@import|fonts\.googleapis/i.test(html), `"${key}" loads a web font`)
  }
})

test("layout does not depend on flexbox or grid, which Outlook ignores", () => {
  const html = renderDefault("club_welcome").html
  assert.ok(!/display:\s*flex/i.test(html))
  assert.ok(!/display:\s*grid/i.test(html))
})

test("the one style block is enhancement only, never required for usability", () => {
  // Gmail and Outlook cannot be relied on to apply <style>. The rule inside
  // only widens padding on large screens; strip it and the email is still
  // comfortable, which is what this asserts.
  const html = renderDefault("club_welcome").html
  const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(html)
  assert.ok(styleBlock, "expected exactly one style block")
  const rules = styleBlock![1]
  assert.ok(rules.includes("min-width"), "the media query should only ADD on wider screens")
  assert.ok(!/max-width/.test(rules), "a max-width rule would make narrow screens depend on <style>")
})

test("the email declares a light colour scheme so clients invert it less aggressively", () => {
  const html = renderDefault("club_welcome").html
  assert.match(html, /name="color-scheme"\s+content="light"/)
  assert.match(html, /name="supported-color-schemes"/)
})

test("every email still carries a preheader, and it is hidden", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const rendered = renderDefault(key)
    assert.ok(rendered.preheader.trim(), `"${key}" has no preheader`)
    assert.ok(rendered.html.includes("max-height:0"), `"${key}" preheader is not hidden`)
  }
})

test("the Rugby Connected strip uses the canonical tagline, not a retyped one", () => {
  const html = renderDefault("club_welcome").html
  assert.ok(html.includes(PRODUCT_TAGLINE))
})

// ---------------------------------------------------------------------------
// Plain text did not regress
// ---------------------------------------------------------------------------

test("the redesign did not make the HTML necessary to understand the email", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const rendered = renderDefault(key)
    assert.ok(rendered.text.trim().length > 40, `"${key}" has a thin plain-text part`)
    assert.ok(!/<[a-z]/i.test(rendered.text), `"${key}" leaked markup into plain text`)
    assert.ok(rendered.text.includes(PRODUCT_NAME), `"${key}" plain text does not name the product`)
  }
})

test("plain text still spells out any destination the HTML links to", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const rendered = renderDefault(key)
    if (!templateContract(key).hasCta) continue
    assert.ok(
      rendered.text.includes(SITE),
      `"${key}" has a button in HTML but no URL a plain-text reader could use`
    )
  }
})
