import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CONTRACTED_EVENT_KEYS,
  EMAIL_TEMPLATE_CONTRACTS,
  allowedVariables,
  sampleVariables,
  templateContract,
  unknownVariables,
} from "@/lib/email/contracts"
import { applyVariables } from "@/lib/email/resolve-content"
import { EMAIL_EVENTS } from "@/lib/email/catalogue"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { WIRED_EVENT_KEYS } from "@/lib/email/wiring"

const SITE = "http://localhost:3000"

/** Renders one event with its registered default copy and its own fixture. */
function renderDefault(key: keyof typeof EMAIL_TEMPLATE_CONTRACTS) {
  const fixture = PREVIEW_FIXTURES[key][0]
  return renderEmail(key, fixture.data as never, SITE, templateContract(key).default)
}

// ---------------------------------------------------------------------------
// The registry as a contract
// ---------------------------------------------------------------------------

test("every catalogued email has editable copy, so none is invisible in Site Admin", () => {
  for (const key of Object.keys(EMAIL_EVENTS)) {
    assert.ok(
      (CONTRACTED_EVENT_KEYS as readonly string[]).includes(key),
      `"${key}" is sendable but has no contract, so a Site Admin looking for its wording would find nothing`
    )
  }
})

test("every contracted email is one the product knows how to address", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    assert.ok(EMAIL_EVENTS[key], `"${key}" is editable but has no recipient rule`)
  }
})

test("an email declared wired is one something actually sends", () => {
  for (const key of WIRED_EVENT_KEYS) {
    assert.ok(EMAIL_EVENTS[key], `"${key}" is declared wired but is not a catalogued event`)
  }
})

test("every registered default renders without leaving a variable behind", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const rendered = renderDefault(key)
    for (const part of [rendered.subject, rendered.preheader, rendered.html, rendered.text]) {
      assert.ok(!/\{\{/.test(part), `"${key}" renders a literal {{ }} tag a recipient would see`)
    }
  }
})

test("every registered default satisfies its own contract", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const contract = templateContract(key)
    const d = contract.default
    assert.ok(d.subject.trim(), `"${key}" has an empty default subject`)
    assert.ok(d.heading.trim(), `"${key}" has an empty default heading`)
    assert.ok(d.body.trim(), `"${key}" has an empty default body`)
    if (contract.hasCta) {
      assert.ok(d.ctaLabel?.trim(), `"${key}" has a button and no default label`)
    }
    assert.deepEqual(
      unknownVariables(key, d.subject, d.preheader, d.heading, d.body, d.ctaLabel),
      [],
      `"${key}" default copy uses a variable the event does not provide`
    )
  }
})

// ---------------------------------------------------------------------------
// The variable allowlist -- the security boundary of the whole feature
// ---------------------------------------------------------------------------

test("a variable the event does not provide is refused, not rendered blank", () => {
  const unknown = unknownVariables("club_welcome", "Hello {{club_name}} {{secret_token}}", "", "Hi", "Body", null)
  assert.deepEqual(unknown, ["secret_token"])
})

test("no contracted variable exposes a date of birth, a token, an address or an id", () => {
  const forbidden = /(date_of_birth|dob|password|token|secret|api_key|email_address|phone|user_id|\bid\b)/
  // `postcode` alone is deliberately not in the forbidden list: a public
  // sports venue's postcode (fixture_venue_postcode, training_venue_postcode)
  // is not personal data -- it is the same address already shown in the
  // structured Match/Training Summary block to the same recipients. A
  // PERSON's postcode remains covered by this test via the separate
  // `_person_postcode` / `home_postcode`-shaped check below.
  const personalPostcode = /(person_postcode|home_postcode|guardian_postcode|player_postcode)/
  for (const key of CONTRACTED_EVENT_KEYS) {
    for (const variable of allowedVariables(key)) {
      assert.ok(
        !forbidden.test(variable.name) && !personalPostcode.test(variable.name),
        `"${key}" offers {{${variable.name}}}, which would put protected data in editable copy`
      )
    }
  }
})

test("substitution reaches only the event's own values, never a nested object path", () => {
  const values = sampleVariables("club_welcome")
  const attempted = applyVariables("{{club_name}} / {{player.date_of_birth}} / {{__proto__}}", values)
  assert.ok(attempted.includes("Solihull Rugby Club"))
  assert.ok(!attempted.includes("date_of_birth"))
  assert.ok(!attempted.includes("{{"))
})

test("an unknown tag renders as nothing rather than as template syntax", () => {
  assert.equal(applyVariables("Hello {{nobody}}.", { club_name: "X" }), "Hello .")
})

test("a value containing markup is inert once rendered", () => {
  const rendered = renderEmail(
    "club_welcome",
    { firstName: "<script>alert(1)</script>", clubName: "Bobby </b> Tables RFC", clubLogoUrl: null },
    SITE,
    { subject: "Welcome {{club_name}}", preheader: "", heading: "Hi {{first_name}}", body: "Body.", ctaLabel: "Open" }
  )
  assert.ok(!rendered.html.includes("<script>"), "a club name rendered as live markup")
  assert.ok(rendered.html.includes("&lt;script&gt;"), "the value should survive, escaped")
})

// ---------------------------------------------------------------------------
// What editable copy must never be able to change
// ---------------------------------------------------------------------------

test("copy cannot move a button: every link still points at Ovalball's own origin", () => {
  const rendered = renderEmail(
    "club_welcome",
    { firstName: "Callum", clubName: "Solihull Rugby Club", clubLogoUrl: null },
    SITE,
    {
      subject: "s",
      preheader: "",
      heading: "h",
      // Copy is text. Even copy that looks like a link is text.
      body: "Visit https://ovalball-security-check.example.com to confirm.",
      ctaLabel: "Open Ovalball",
    }
  )
  for (const href of [...rendered.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(href.startsWith(SITE), `copy produced an outbound link: ${href}`)
  }
})

test("no contract lets an administrator supply a destination", () => {
  const destinationish = /(url|link|href|destination|redirect)/
  for (const key of CONTRACTED_EVENT_KEYS) {
    for (const variable of allowedVariables(key)) {
      assert.ok(!destinationish.test(variable.name), `"${key}" offers {{${variable.name}}}, which is a destination`)
    }
  }
})

test("the shared Ovalball footer survives rewritten copy", () => {
  const rendered = renderEmail(
    "club_welcome",
    { firstName: "Callum", clubName: "Solihull Rugby Club", clubLogoUrl: null },
    SITE,
    { subject: "s", preheader: "", heading: "h", body: "Anything at all.", ctaLabel: "Open" }
  )
  assert.ok(rendered.html.includes("Pipaxon Technologies Ltd"))
  assert.ok(rendered.text.includes("Pipaxon Technologies Ltd"))
})

// ---------------------------------------------------------------------------
// Safeguarding and identity events stay themselves
// ---------------------------------------------------------------------------

test("a safeguarding email cannot be turned into an optional one by editing its words", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    if (!key.startsWith("safeguarding")) continue
    assert.notEqual(
      EMAIL_EVENTS[key].classification,
      "OPTIONAL_OPERATIONAL",
      `"${key}" must not be preference-gated`
    )
  }
})

test("what the validator accepts is exactly what the editor shows", () => {
  // The invariant that matters is not that two arrays match -- it is that an
  // administrator is never refused a variable the screen offered them, and
  // never quietly allowed one it did not. So this exercises the validator the
  // save path actually calls, rather than comparing the list to itself.
  for (const key of CONTRACTED_EVENT_KEYS) {
    for (const variable of allowedVariables(key)) {
      assert.deepEqual(
        unknownVariables(key, `{{${variable.name}}}`, "", "h", "b", null),
        [],
        `"${key}" shows {{${variable.name}}} but refuses it on save`
      )
    }
    assert.deepEqual(
      unknownVariables(key, "{{not_offered_anywhere}}", "", "h", "b", null),
      ["not_offered_anywhere"],
      `"${key}" accepts a variable the editor never offered`
    )
  }
})

// ---------------------------------------------------------------------------
// The Club Welcome email specifically
// ---------------------------------------------------------------------------

test("Club Welcome greets the person and names their club", () => {
  const rendered = renderEmail(
    "club_welcome",
    { firstName: "Callum", clubName: "Solihull Rugby Club", clubLogoUrl: null },
    SITE,
    templateContract("club_welcome").default
  )
  assert.ok(rendered.subject.includes("Solihull Rugby Club"))
  assert.ok(rendered.html.includes("Callum"))
  assert.ok(rendered.text.includes("Solihull Rugby Club"))
})

test("Club Welcome is operational, so it is not silently suppressible", () => {
  assert.equal(EMAIL_EVENTS.club_welcome.classification, "MANDATORY_OPERATIONAL")
})

test("every event's preview fixture is data the event actually takes", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    assert.ok(PREVIEW_FIXTURES[key]?.length > 0, `"${key}" has no preview fixture, so its editor cannot show a preview`)
    assert.doesNotThrow(() => renderDefault(key), `"${key}" cannot be previewed`)
  }
})
