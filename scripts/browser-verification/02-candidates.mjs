// MESSAGE A PERSON -- who is offered, and who must not be (brief §19, §20).
//
// Read through the ordinary product UI, never the database: the point is
// what a person is actually shown.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const PEOPLE = {
  coach: { email: "uat.coach@ovalball.test", name: "Priya Nair" },
  guardianOne: { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" },
  guardianTwo: { email: "uat.guardian.two@ovalball.test", name: "Dana Whitaker" },
  adultPlayer: { email: "uat.adult.player@ovalball.test", name: "Marcus Fenwick" },
  u18: { email: "uat.player.self@ovalball.test", name: "Rowan Whitaker" },
  unrelated: { email: "uat.unrelated@ovalball.test", name: "Unrelated Visitor" },
}

const browser = await launch()

async function candidatesFor(email) {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await signIn(page, email)
  await page.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  // The picker lives in the conversation pane; read only that region so the
  // inbox list beside it cannot be mistaken for a candidate.
  const text = await page.locator("main").last().innerText()
  await ctx.close()
  return text
}

// --- the coach's view ----------------------------------------------------
const coachSees = await candidatesFor(PEOPLE.coach.email)

record("§19 coach -> guardian offered", coachSees.includes(PEOPLE.guardianOne.name), PEOPLE.guardianOne.name)
record("§19 coach -> adult player offered", coachSees.includes(PEOPLE.adultPlayer.name), PEOPLE.adultPlayer.name)
record("§20 U18 is NOT offered to the coach", !coachSees.includes(PEOPLE.u18.name), PEOPLE.u18.name)
record("§19 unrelated adult is NOT offered", !coachSees.includes(PEOPLE.unrelated.name), PEOPLE.unrelated.name)

// --- a guardian's view ---------------------------------------------------
const guardianSees = await candidatesFor(PEOPLE.guardianOne.email)
record("§19 guardian -> coach offered", guardianSees.includes(PEOPLE.coach.name), PEOPLE.coach.name)
record("§19 guardian -> guardian offered", guardianSees.includes(PEOPLE.guardianTwo.name), PEOPLE.guardianTwo.name)
record("§20 U18 is NOT offered to a guardian", !guardianSees.includes(PEOPLE.u18.name), PEOPLE.u18.name)

// --- the adult player's view --------------------------------------------
const playerSees = await candidatesFor(PEOPLE.adultPlayer.email)
record("§19 adult player -> coach offered", playerSees.includes(PEOPLE.coach.name), PEOPLE.coach.name)
record("§20 U18 is NOT offered to an adult player", !playerSees.includes(PEOPLE.u18.name), PEOPLE.u18.name)

// --- the U18's own view: direct messaging is not theirs to start ----------
const u18Sees = await candidatesFor(PEOPLE.u18.email)
const u18Excluded =
  !u18Sees.includes(PEOPLE.coach.name) && !u18Sees.includes(PEOPLE.guardianOne.name)
record("§20 a U18 is offered no direct-message candidates", u18Excluded, u18Sees.replace(/\n+/g, " / ").slice(0, 140))

// --- an adult with no shared club sees nobody ----------------------------
const unrelatedSees = await candidatesFor(PEOPLE.unrelated.email)
record(
  "§19 an adult with no shared club is offered nobody",
  !unrelatedSees.includes(PEOPLE.coach.name) && !unrelatedSees.includes(PEOPLE.guardianOne.name),
  unrelatedSees.replace(/\n+/g, " / ").slice(0, 140),
)

await browser.close()
process.exit(summarise() ? 0 : 1)
