import { test } from "node:test"
import assert from "node:assert/strict"

import { EMAIL_EVENT_KEYS, EMAIL_EVENTS, emailEventDefinition } from "@/lib/email/catalogue"
import { escapeHtml, safeUrl } from "@/lib/email/design/components"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

/**
 * Template and escaping regressions.
 *
 * These assert SEMANTICS, not markup: a full-HTML snapshot would fail on
 * every spacing change and teach the next person to regenerate it without
 * reading it, which is worse than no test. What is pinned here is what the
 * message must always be true about.
 */

const SITE = "https://app.ovalball.test"

/** Every catalogued event, rendered with each of its fixtures. */
function eachRendered(): Array<{ key: string; label: string; rendered: ReturnType<typeof renderEmail> }> {
  const out: Array<{ key: string; label: string; rendered: ReturnType<typeof renderEmail> }> = []
  for (const key of EMAIL_EVENT_KEYS) {
    for (const variant of PREVIEW_FIXTURES[key]) {
      out.push({ key, label: variant.label, rendered: renderEmail(key, variant.data as never, SITE) })
    }
  }
  return out
}

test("every catalogued event has a template and renders", () => {
  for (const key of EMAIL_EVENT_KEYS) {
    assert.ok(PREVIEW_FIXTURES[key]?.length, `${key} has no preview fixture`)
    const r = renderEmail(key, PREVIEW_FIXTURES[key][0].data as never, SITE)
    assert.ok(r.html.length > 0, `${key} produced no HTML`)
  }
})

test("every email has a subject, a preheader and real plain text", () => {
  for (const { key, label, rendered } of eachRendered()) {
    const where = `${key} / ${label}`
    assert.ok(rendered.subject.trim().length > 0, `${where}: empty subject`)
    assert.ok(rendered.preheader.trim().length > 0, `${where}: empty preheader`)
    // A stripped-tags fallback would be short and link-free. Real written
    // text is neither.
    assert.ok(rendered.text.trim().length > 40, `${where}: plain text is too thin to be written`)
    // Angle brackets an AUTHOR typed are their words and belong in the text.
    // What must never appear is markup the TEMPLATE generated -- that would
    // mean the plain part was produced by stripping tags off the HTML.
    for (const generated of ["<table", "<td", "<tr", "<p ", "<a href", "<div", "style="]) {
      assert.ok(
        !rendered.text.includes(generated),
        `${where}: plain text contains generated markup (${generated})`
      )
    }
  }
})

test("plain text carries the destination, not just a button word", () => {
  // The one thing a plain-text reader cannot recover for themselves.
  for (const { key, label, rendered } of eachRendered()) {
    if (!rendered.html.includes("<a href=")) continue
    assert.match(
      rendered.text,
      /https?:\/\//,
      `${key} / ${label}: HTML has a link but the plain text has no URL`
    )
  }
})

test("every link points at Ovalball's own origin", () => {
  for (const { key, label, rendered } of eachRendered()) {
    const hrefs = [...rendered.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    assert.ok(hrefs.length > 0, `${key} / ${label}: no links at all`)
    for (const href of hrefs) {
      assert.ok(
        href.startsWith(SITE),
        `${key} / ${label}: link escapes the product origin -> ${href}`
      )
    }
  }
})

test("author-supplied text is escaped, never rendered as markup", () => {
  const rendered = renderEmail(
    "safeguarding_officer_message",
    {
      clubName: "Sample RUFC",
      senderName: "A Club Administrator",
      body: '<img src=x onerror="alert(1)"> & <b>bold</b>',
    },
    SITE
  )
  assert.ok(!rendered.html.includes("<img src=x"), "an injected tag survived into the HTML")
  // The literal characters "onerror=" DO still appear -- as escaped text the
  // recipient reads. What must not appear is an unescaped attribute, i.e. the
  // quote that would let it become a real handler.
  assert.ok(!rendered.html.includes('onerror="'), "an injected handler survived unescaped")
  assert.ok(rendered.html.includes("onerror=&quot;"), "the handler was not escaped for display")
  assert.ok(rendered.html.includes("&lt;img"), "the tag was not escaped for display")
  assert.ok(rendered.html.includes("&amp;"), "the ampersand was not escaped")
})

test("a club name containing markup cannot break the document", () => {
  const rendered = renderEmail(
    "club_invitation",
    {
      clubName: '</td></tr></table><script>alert(1)</script>',
      clubLogoUrl: null,
      inviteToken: "t",
      roleLabel: null,
    },
    SITE
  )
  assert.ok(!rendered.html.includes("<script>"), "a script tag survived from a club name")
  assert.ok(rendered.subject.includes("<script>") === true, "subject is raw text, which is correct")
})

test("escapeHtml covers every character that changes parsing", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;")
})

test("safeUrl refuses anything that is not this origin", () => {
  assert.ok(safeUrl(`${SITE}/invite/abc`, SITE))
  assert.equal(safeUrl("https://evil.test/steal", SITE), null, "off-origin URL was allowed")
  assert.equal(safeUrl("javascript:alert(1)", SITE), null, "javascript: URL was allowed")
  assert.equal(safeUrl("//evil.test", SITE), null, "protocol-relative URL was allowed")
})

test("a long club name does not blow the 600px email width", () => {
  const rendered = renderEmail(
    "guardian_invitation",
    {
      clubName: "Kingston-upon-Thames Rugby Football Club (Colts & Juniors)",
      clubLogoUrl: null,
      teamName: "Under 14s Girls Development Squad",
      inviteToken: "t",
    },
    SITE
  )
  // No fixed pixel width larger than the content column may be emitted, or
  // the message scrolls sideways on a phone.
  const widths = [...rendered.html.matchAll(/width="(\d+)"/g)].map((m) => Number(m[1]))
  for (const w of widths) {
    assert.ok(w <= 600, `a fixed width of ${w}px exceeds the 600px email column`)
  }
})

test("a missing club crest renders no image at all", () => {
  const withLogo = renderEmail(
    "club_invitation",
    { clubName: "Sample RUFC", clubLogoUrl: `${SITE}/crest.png`, inviteToken: "t", roleLabel: null },
    SITE
  )
  const without = renderEmail(
    "club_invitation",
    { clubName: "Sample RUFC", clubLogoUrl: null, inviteToken: "t", roleLabel: null },
    SITE
  )
  assert.ok(withLogo.html.includes("<img"), "a supplied crest was not rendered")
  // A broken image icon in an invitation reads as a broken product.
  assert.ok(!without.html.includes("<img"), "an absent crest produced an image tag anyway")
})

test("the guardian invitation carries no child identifying detail", () => {
  const rendered = renderEmail(
    "guardian_invitation",
    { clubName: "Sample RUFC", clubLogoUrl: null, teamName: "Under 12s", inviteToken: "t" },
    SITE
  )
  const haystack = `${rendered.subject} ${rendered.text}`.toLowerCase()
  for (const forbidden of ["date of birth", "dob", "medical", "attendance"]) {
    assert.ok(!haystack.includes(forbidden), `guardian invitation leaked "${forbidden}"`)
  }
})

test("the referral email describes a free month, never a cash reward", () => {
  const rendered = renderEmail(
    "referral_reward_earned",
    {
      referringClubName: "Sample RUFC",
      referredClubName: "Another Sample RFC",
      planLabel: "Standard",
      rewardValue: "£15.00",
    },
    SITE
  )
  const body = `${rendered.subject} ${rendered.text}`.toLowerCase()
  assert.ok(body.includes("free month"), "the free-month entitlement is not stated")
  assert.ok(
    body.includes("can't be paid out as cash") || body.includes("cannot be paid out as cash"),
    "the email does not say the credit is not cash"
  )
  for (const forbidden of ["cash reward", "cashback", "payout", "£29"]) {
    assert.ok(!body.includes(forbidden), `referral email used forbidden framing: "${forbidden}"`)
  }
})

test("classification and topic agree with the identity rule", () => {
  for (const key of EMAIL_EVENT_KEYS) {
    const d = emailEventDefinition(key)
    if (d.classification === "TRANSACTIONAL_IDENTITY") {
      assert.equal(d.topicKey, null, `${key}: an identity email must not claim a topic`)
    } else {
      assert.ok(d.topicKey, `${key}: a topic-scoped email must name its topic`)
    }
  }
})

test("safeguarding communication is never preference-gated", () => {
  for (const key of ["safeguarding_officer_message", "safeguarding_officer_invitation"] as const) {
    assert.equal(
      EMAIL_EVENTS[key].classification,
      "TRANSACTIONAL_IDENTITY",
      `${key} must not be suppressible by a topic preference`
    )
  }
})

test("no marketing classification exists in the transactional pipeline", () => {
  for (const key of EMAIL_EVENT_KEYS) {
    assert.notEqual(
      emailEventDefinition(key).classification as string,
      "MARKETING",
      `${key} is marketing and does not belong in the transactional sender`
    )
  }
})
