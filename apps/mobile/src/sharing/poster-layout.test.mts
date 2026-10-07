import { test } from "node:test"
import assert from "node:assert/strict"

import { joinAddressForPrint, posterCopy, wrapLines } from "./poster-layout.ts"

const club = { clubName: "Ovalball UAT RUFC", crestUrl: null }
const share = { code: "K7QP2-M4XAB", expiresLabel: "18 October 2026" }

test("an invitation poster says who it is for in the owner's own order: invited, as a role, for a team, at the club", () => {
  const copy = posterCopy(club, { variant: "INVITATION", role: "Coach", teamName: "Women's 1st Team" }, share, "https://ovalball.co.uk")
  assert.deepEqual(
    copy.stack.map((l) => l.text),
    ["YOU'VE BEEN INVITED", "as a", "COACH", "for", "WOMEN'S 1ST TEAM", "at", "Ovalball UAT RUFC"]
  )
  assert.equal(copy.scanLine, "Scan to join on Ovalball")
  assert.equal(copy.codeLine, "or enter K7QP2-M4XAB at ovalball.co.uk/join")
  assert.match(copy.footnote, /only works with the email address it was issued for/)
  assert.ok(!JSON.stringify(copy).includes("@"), "a poster never carries an email address")
})

test("the article follows the role: an Assistant Coach, a Volunteer", () => {
  assert.equal(posterCopy(club, { variant: "INVITATION", role: "Assistant Coach", teamName: null }, share, "https://x.test").stack[1].text, "as an")
  assert.equal(posterCopy(club, { variant: "INVITATION", role: "Volunteer", teamName: null }, share, "https://x.test").stack[1].text, "as a")
})

test("an invitation with no role or team still reads: invited to join the club", () => {
  const copy = posterCopy(club, { variant: "INVITATION" }, { code: null, expiresLabel: null }, "https://x.test")
  assert.deepEqual(copy.stack.map((l) => l.text), ["YOU'VE BEEN INVITED", "to join", "Ovalball UAT RUFC"])
  assert.equal(copy.codeLine, null, "no code, no code line")
  assert.equal(copy.expiry, null, "no expiry, nothing said about one")
})

test("a team's joining poster asks to join the team and says the club decides", () => {
  const copy = posterCopy(club, { variant: "TEAM_JOIN", teamName: "Under 12 Boys" }, share, "https://ovalball.co.uk/")
  assert.deepEqual(copy.stack.map((l) => l.text), ["JOIN", "UNDER 12 BOYS", "at", "Ovalball UAT RUFC"])
  assert.equal(copy.scanLine, "Scan to ask to join on Ovalball")
  assert.equal(copy.footnote, "Using it asks to join. The club decides.")
  assert.equal(copy.expiry, "Open until 18 October 2026")
})

test("a referral poster speaks to the club that receives it, with no code and the referring club named", () => {
  const copy = posterCopy(club, { variant: "REFERRAL" }, { code: null, expiresLabel: null }, "https://ovalball.co.uk")
  assert.deepEqual(copy.stack.map((l) => l.text), ["RISE", "TOGETHER."])
  // Written to the receiving club (the owner's decision, 2026-10-05): it no longer asks them to recommend Ovalball onward.
  assert.equal(copy.standfirst, "Your club, on Ovalball: teams, fixtures, training and people in one place.")
  assert.equal(copy.codeLine, null)
  assert.equal(copy.footnote, "Recommended by Ovalball UAT RUFC.")
})

test("the code-entry address is printed without a scheme", () => {
  assert.equal(joinAddressForPrint("http://localhost:3000"), "localhost:3000/join")
  assert.equal(joinAddressForPrint("https://ovalball.co.uk/"), "ovalball.co.uk/join")
})

test("wrapLines keeps words whole and ends what will not fit in an ellipsis", () => {
  assert.deepEqual(wrapLines("Under 12 Boys", 1000, 40, 0.5, 2), ["Under 12 Boys"])
  const lines = wrapLines("The Very Long Name Of A Rugby Club That Goes On", 300, 40, 0.5, 2)
  assert.equal(lines.length, 2)
  assert.ok(lines[1].endsWith("…"))
})
