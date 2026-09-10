import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allowedVariables,
  CONTRACTED_EVENT_KEYS,
  hasClubCrest,
  type EmailVariableCategory,
} from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

const SITE = "http://localhost:3000"

/**
 * THE DYNAMIC DATA PANEL'S OWN DATA IS ONLY AS TRUSTWORTHY AS ITS METADATA.
 *
 * The Site Admin "Dynamic Data" library is a typed metadata layer over the
 * SAME allowlist unknownVariables() already enforces at save time -- it adds
 * no new variable and relaxes no existing check. These tests hold the
 * metadata itself to the standard the panel promises a Site Admin: every
 * entry genuinely has a category, a plain-language source, and a value type,
 * because an "Insert" button next to an empty description is worse than no
 * button.
 */

const KNOWN_CATEGORIES: readonly EmailVariableCategory[] = [
  "Recipient",
  "Player",
  "Guardian",
  "Club",
  "Team",
  "Fixture",
  "Opposition",
  "Match",
  "Training",
  "Event",
  "Venue",
  "Pitch",
  "Competition",
  "Season",
  "Attendance",
  "Brand",
  "Account",
  "Referral",
  "Support",
  "System",
]

test("every registered variable carries complete Dynamic Data metadata", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    for (const variable of allowedVariables(key)) {
      assert.ok(variable.label.trim().length > 0, `"${key}".${variable.name} has no label`)
      assert.ok(variable.source.trim().length > 0, `"${key}".${variable.name} has no source`)
      assert.ok(variable.description.trim().length > 0, `"${key}".${variable.name} has no description`)
      assert.ok(variable.sample.trim().length > 0, `"${key}".${variable.name} has no sample`)
      assert.equal(variable.valueType, "text", `"${key}".${variable.name} has an unexpected valueType`)
      assert.ok(
        KNOWN_CATEGORIES.includes(variable.category),
        `"${key}".${variable.name} has category "${variable.category}", which is not in the declared set`
      )
    }
  }
})

test("searching by category or label actually finds the variable, the way the panel's search does", () => {
  // Pins the CONTRACT the search box relies on: key, label, category and
  // description are all plain strings a simple substring match can search --
  // nothing here requires walking a database or a domain object.
  const clubVariable = allowedVariables("club_welcome").find((v) => v.name === "club_name")
  assert.ok(clubVariable)
  const haystack = `${clubVariable!.name} ${clubVariable!.label} ${clubVariable!.category} ${clubVariable!.description}`.toLowerCase()
  assert.ok(haystack.includes("club"), "searching \"club\" should find {{club_name}}")
})

/**
 * THE CLUB CREST IS STRUCTURE, NOT A VARIABLE -- AND THE FLAG THAT SAYS SO
 * MUST BE TRUE.
 *
 * hasClubCrest is what the Dynamic Data panel uses to show "Club Crest" as an
 * informational, non-insertable entry. If the flag ever drifted from what the
 * renderer actually does, the panel would either promise a crest that never
 * appears or hide one that does -- so this asserts the renderer's real
 * behaviour, not the flag reading itself back.
 */
test("hasClubCrest is true only for events whose renderer actually embeds a same-origin crest", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const fixture = PREVIEW_FIXTURES[key][0]
    const data = fixture.data as Record<string, unknown>

    if (!("clubLogoUrl" in data)) {
      // This event's own typed data has no crest slot at all -- hasClubCrest
      // must not claim one exists to insert data into.
      assert.equal(hasClubCrest(key), false, `"${key}" has no clubLogoUrl in its data but claims hasClubCrest`)
      continue
    }

    const withCrest = renderEmail(key, { ...data, clubLogoUrl: `${SITE}/email-assets/logo.png` } as never, SITE)
    const crestRendered = withCrest.html.includes(`src="${SITE}/email-assets/logo.png"`)
    assert.equal(
      crestRendered,
      hasClubCrest(key),
      `"${key}": renderer embeds a crest ${crestRendered}, but hasClubCrest says ${hasClubCrest(key)}`
    )
  }
})

test("a club crest URL on a foreign origin is dropped, not rendered", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    if (!hasClubCrest(key)) continue

    const fixture = PREVIEW_FIXTURES[key][0]
    const data = fixture.data as Record<string, unknown>
    const rendered = renderEmail(key, { ...data, clubLogoUrl: "https://attacker.example/crest.png" } as never, SITE)
    assert.ok(
      !rendered.html.includes("attacker.example"),
      `"${key}" embedded a crest from a foreign origin`
    )
  }
})
