// FIXTURE OPERATIONS -- WHAT IT COSTS
// (Fixture Operations brief §87-§88.)
//
// Measured, not asserted. These are OBSERVATIONS recorded so the product
// owner can decide what is acceptable -- a threshold invented here would
// be a number nobody agreed to, passing or failing on my opinion.
//
// The machine matters: this is a development build on a loaded laptop,
// with the dev server compiling on demand. Every figure is a median of
// three, and the first load of each route is discarded because it is
// measuring the compiler, not the page.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

const SHOTS = process.env.SHOT_DIR ?? "/Users/Devs/.claude/jobs/e976849c/tmp"
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function measureRoute(label, path) {
  let requests = 0
  const onRequest = () => (requests += 1)

  // Warm-up load, discarded: on a dev server the first hit compiles the route.
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const samples = []
  for (let i = 0; i < 3; i++) {
    requests = 0
    page.on("request", onRequest)
    const started = Date.now()
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    samples.push(Date.now() - started)
    page.off("request", onRequest)
  }

  record(`OBSERVED  ${label}`, true, `median ${median(samples)}ms of [${samples.join(", ")}], ${requests} requests`)
  return median(samples)
}

// A baseline to read the others against. /account is about as small as an
// authenticated page in this app gets, so whatever it costs is the app
// shell, not the surface under test.
const baseline = await measureRoute("baseline: /account (app shell only)", "/account")
const control = await measureRoute("Fixture Control Centre", "/fixtures/management")
const planner = await measureRoute("Mass Fixture Planner (25 empty rows)", "/fixtures/planner")

record("OBSERVED  what each surface costs over the app shell", true,
  `Control Centre +${control - baseline}ms, Planner +${planner - baseline}ms`)

// ---------------------------------------------------------------------
// VALIDATION -- the cost a person actually waits through
// ---------------------------------------------------------------------
const TEAMS = ["Under 12 Boys", "Under 13 Boys", "Under 14 Girls", "Under 15 Boys", "Under 16 Girls"]
const OPPONENT = "Aberaeron Rugby Football Club"

function block(n) {
  return Array.from({ length: n }, (_, i) => {
    const day = String((i % 27) + 1).padStart(2, "0")
    const month = String((i % 5) + 1).padStart(2, "0")
    return [`${day}/${month}/2031`, "11:00", "10:15", "H", TEAMS[i % TEAMS.length], OPPONENT, "", "", "", ""].join("\t")
  }).join("\n")
}

async function measureCheck(rows) {
  await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const started = Date.now()
  await page.evaluate(
    ([payload]) => {
      const el = document.querySelector('input[aria-label="Date, row 1"]')
      el.focus()
      const dt = new DataTransfer()
      dt.setData("text/plain", payload)
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [block(rows)],
  )
  await page.waitForFunction(
    () => /\d+ ready/.test(document.body.innerText) && !document.body.innerText.includes("Checking…"),
    null, { timeout: 300000 },
  )
  const ms = Date.now() - started
  record(`OBSERVED  paste and check ${rows} rows`, true, `${ms}ms (${Math.round(ms / rows)}ms per row)`)
  return ms
}

await measureCheck(10)
await measureCheck(55)
await measureCheck(120)

// A full-page screenshot of the planner holding a real season, for the
// visual record.
await page.screenshot({ path: `${SHOTS}/mass-planner-checked.png`, fullPage: false })

record("OBSERVED  these are development-build figures on a loaded machine", true,
  "not a production benchmark; recorded for the product owner to judge")

await browser.close()
summarise()
console.log(`\nScreenshot in ${SHOTS}/mass-planner-checked.png`)
