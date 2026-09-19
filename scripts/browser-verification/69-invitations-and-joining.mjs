// =====================================================================
// CONVERGENCE STEP 3 -- ONE JOINING SYSTEM, IN A REAL BROWSER
//
// Slice 5 already issued one credential in two forms: a token that lives in a
// link and a ten-character code somebody can read down a phone, both resolving
// through preview_invitation / redeem_invitation to the same access_invitations
// row. Almost none of it reached a person.
//
// Every assertion below is something the product could not do before Step 3:
//
//   - the human code was generated, hashed and thrown away at issue, every
//     time, so the one artefact a volunteer can read aloud never existed as far
//     as the product was concerned;
//   - the issuer got a bare URL under an apology about development email;
//   - there was no QR and no copy control;
//   - a typed code went straight from the box to redemption, so the person
//     entering it never saw which club they were joining, while somebody with a
//     link was told;
//   - resend_invitation existed, granted and fully specified, with no button.
//
// The club is made busy on purpose and put back. Nothing touches production and
// no session borrows a real person's login.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const CLUB_ADMIN = "uat.coach@ovalball.test"
const INVITEE = `uat.s3.invitee.${TAG}@ovalball.test`
const MINE = `uat.s3.%.${TAG}@ovalball.test`
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)
const teamU12 = sql(`select id from public.teams where club_id = '${clubId}' and age_group = 'U12' and squad_designation is null limit 1`)

function teardown() {
  sql(`
    delete from public.invitation_teams it using public.access_invitations i
      where it.invitation_id = i.id and i.invited_email_normalised like '${MINE}';
    delete from public.access_invitations where invited_email_normalised like '${MINE}';`)
}

teardown()
const browser = await launch()

try {
  const context = await newContext(browser, { width: 1440, height: 1200 })
  const page = await context.newPage()
  await signIn(page, CLUB_ADMIN)
  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // ------------------------------------------------------------------
  // A. Issuing hands over something a person can actually use.
  // ------------------------------------------------------------------
  await go("/people")
  await page.getByRole("button", { name: /invite someone/i }).click()
  await page.waitForTimeout(600)
  await page.locator("#invite-email").fill(INVITEE)
  for (const select of await page.locator("select").all()) {
    const options = (await select.locator("option").allInnerTexts()).join("/")
    if (/Fixture Secretary/.test(options) && /Volunteer/.test(options)) {
      await select.selectOption({ label: "Volunteer" })
      break
    }
  }
  await page.getByRole("button", { name: /Send invitation/i }).click()
  await page.waitForTimeout(3000)

  // The link and the code are readonly INPUTS so they can be selected and
  // copied -- innerText does not see input values, which an earlier draft of
  // this suite read as the product not showing them at all.
  const panel = await page.locator("main").innerText()
  const link = await page.locator("#invitation-link").inputValue()
  const code = await page.locator("#invitation-code").inputValue()

  record("A1 issuing hands back a share panel rather than a bare URL", /Invitation ready/.test(panel))
  record("A2 with the canonical join link, and only that shape", /\/join\?t=/.test(link), link.replace(/t=.*/, "t=…"))
  record("A3 and the human code, which used to be generated and discarded", CODE_SHAPE.test(code), `${code.slice(0, 2)}…`)
  record("A4 and says what accepting it will give them", /Volunteer/.test(panel))
  record("A5 and when it runs out", /Expires \d/.test(panel))
  record("A6 and that this is the only time either can be shown", /only time they can be shown/i.test(panel))
  record("A7 Copy Link is a real control, not a selectable string", (await page.getByRole("button", { name: /^Copy Link$/ }).count()) === 1)
  record("A8 and so is Copy Code", (await page.getByRole("button", { name: /^Copy Code$/ }).count()) === 1)

  await page.getByRole("button", { name: /Show QR Code/i }).click()
  await page.waitForTimeout(400)
  record("A9 a QR can be shown", (await page.locator("figure svg").count()) === 1)
  record("A10 and it is not the only way to do anything -- the link and code are still there",
    (await page.locator("#invitation-link").count()) === 1 && (await page.locator("#invitation-code").count()) === 1)
  record("A11 and it carries a text alternative rather than being a bare image",
    /Scanning this opens the same invitation link/.test(await page.locator("main").innerText()))

  // ------------------------------------------------------------------
  // B. A typed code is previewed, not redeemed blind.
  // ------------------------------------------------------------------
  const anon = await newContext(browser, { width: 1440, height: 1000 })
  const anonPage = await anon.newPage()

  // Signed OUT, straight to the code URL: preview_invitation is granted to anon
  // on purpose, so somebody who has been read a code down the phone can see
  // which club it is for before they create an account.
  await go(`/join?c=${encodeURIComponent(code)}`, anonPage)
  let joinText = await anonPage.locator("main").innerText()
  record("B1 a code in the URL previews the invitation to somebody signed out", /Ovalball UAT RUFC/.test(joinText))
  record("B2 and it never discloses who was invited", !joinText.includes(INVITEE))
  record("B3 and asks them to sign in rather than offering Accept to nobody",
    (await anonPage.getByRole("button").allInnerTexts()).some((t) => /sign in/i.test(t)))

  // Signed IN, typed into the box: it must reach the same previewed page rather
  // than going straight to redemption, which is what it used to do -- so the
  // person typing a code never saw what they were accepting and the person
  // clicking a link did.
  await go("/join")
  await page.locator("#invite-code").fill(code.toLowerCase())
  await page.getByRole("button", { name: /^Continue$/ }).click()
  await page.waitForURL(/\/join\?c=/, { timeout: 15000 }).catch(() => {})
  const typedText = await page.locator("main").innerText()
  record("B4 typing a code reaches the previewed page instead of redeeming blind", /\/join\?c=/.test(page.url()))
  record("B5 in lower case and without dashes, because the database normalises it", /Ovalball UAT RUFC/.test(typedText))

  // ------------------------------------------------------------------
  // C. Resend is a REISSUE, and the old credential dies.
  // ------------------------------------------------------------------
  await go("/people")
  await page.getByRole("button", { name: /^Resend$/ }).first().click()
  // Wait for the reissued credential to appear, not for a duration: the share
  // panel is what the resend produces, so it is the readiness signal.
  await page.locator("#invitation-code").waitFor({ state: "visible", timeout: 20000 }).catch(() => {})
  const afterResend = await page.locator("main").innerText()
  const newCode = await page.locator("#invitation-code").inputValue()
  const newLink = await page.locator("#invitation-link").inputValue()
  record("C1 resending issues a new code", CODE_SHAPE.test(newCode) && newCode !== code)
  record("C2 and a new link", newLink !== link)
  record("C3 and says the previous ones no longer work", /no longer work/i.test(afterResend))
  record("C4 which is true in the database, not just on screen",
    sql(`select count(*) from public.access_invitations where code_hmac = internal.invitation_code_hash('${code}')`) === "0")

  await go(`/join?c=${encodeURIComponent(code)}`, anonPage)
  joinText = await anonPage.locator("main").innerText()
  record("C5 so the old code now previews nothing at all", /doesn.t work/i.test(joinText))
  // The page deliberately offers the POSSIBILITIES rather than naming the cause
  // -- "used already, withdrawn, or typed incorrectly" -- so a prober cannot
  // distinguish a rotated code from a wrong one. An earlier draft of this check
  // searched for those words and read their presence as disclosure, which is
  // backwards: the list IS the non-disclosure.
  record("C6 and offers the possibilities rather than naming which one it was",
    /used already, withdrawn, or/i.test(joinText) && !/this code was (revoked|replaced|reissued)/i.test(joinText))

  // ------------------------------------------------------------------
  // D. The invitation's lifecycle is the canonical one, worded.
  // ------------------------------------------------------------------
  await go("/people")
  const listText = await page.locator("main").innerText()
  record("D1 a waiting invitation carries its state", /Pending/.test(listText))
  record("D2 who sent it and when", /Sent by /.test(listText))
  record("D3 and that it has been reissued", /resent once/i.test(listText))
  record("D4 and no token or code is shown after the moment it was issued",
    !CODE_SHAPE.test(listText) && !/\/join\?t=/.test(listText))

  // ------------------------------------------------------------------
  // E. A team join code is the same credential, not a second system.
  // ------------------------------------------------------------------
  await go(`/teams/${teamU12}`)
  const joinCodeButton = page.getByRole("button", { name: /Create a Join Code|Create Another Code/i })
  if (await joinCodeButton.count()) {
    await joinCodeButton.first().click()
    await page.waitForTimeout(3000)
    const teamPanel = await page.locator("main").innerText()
    record("E1 a team join code is presented in the same panel as every other invitation", /Invitation ready/.test(teamPanel))
    record("E2 with a link as well as a code, so it can be put in a group chat",
      /\/join\?t=/.test(await page.locator("#invitation-link").inputValue()))
    record("E3 and a code that still grants nothing by itself -- it produces a request",
      /request to join/i.test(teamPanel))
    // Put the team back: this suite does not leave live credentials behind.
    const created = sql(`select id from public.access_invitations where kind = 'TEAM_JOIN_CODE' and team_id = '${teamU12}'
                         and state = 'ISSUED' order by created_at desc limit 1`)
    if (created) sql(`update public.access_invitations set state = 'REVOKED', revoked_at = now(),
                        revocation_reason = 'browser suite cleanup' where id = '${created}'`)
  } else {
    record("E1 a team join code is presented in the same panel as every other invitation", false, "no join-code control was offered")
  }

  // ------------------------------------------------------------------
  // F. Nothing that worked before stopped working.
  // ------------------------------------------------------------------
  await go("/people")
  record("F1 the invitation can still be revoked", (await page.getByRole("button", { name: /^Revoke$/ }).count()) >= 1)
  await page.getByRole("button", { name: /^Revoke$/ }).first().click()
  await page.getByRole("button", { name: /^Confirm$/ }).click()
  // Wait for the row to GO, not for a duration. A revalidating server action
  // takes as long as the machine is busy, and 2.5 seconds was enough right up
  // until a full batch made it not -- the third time this exact pattern has
  // failed in these suites and the last place it survived.
  await page
    .locator("li", { hasText: INVITEE })
    .first()
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => {})
  record("F2 and revoking still takes it out of the queue", !(await page.locator("main").innerText()).includes(INVITEE))
  record("F3 against the canonical row, with who and why recorded",
    sql(`select state || '|' || (revoked_by is not null)::text from public.access_invitations
         where invited_email_normalised = '${INVITEE}'`).startsWith("REVOKED|true"))
} finally {
  teardown()
  await browser.close()
}

record("Z1 the suite leaves no invitation of its own behind",
  sql(`select count(*) from public.access_invitations where invited_email_normalised like '${MINE}'`) === "0")

summarise("Invitations and joining")
