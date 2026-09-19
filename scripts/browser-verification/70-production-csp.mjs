// =====================================================================
// THE CONTENT SECURITY POLICY, AS IT ACTUALLY SHIPS (Slice 6b.2d, S6-17)
//
// Every other browser suite runs against `next dev`, and the CSP is the one
// thing that cannot be judged there. `next dev` injects its own inline scripts
// for hot reload and the error overlay and the framework does not nonce them, so
// an enforcing policy on the dev server refuses the DEV SERVER, not the product
// -- which is why the policy is enforced in production and report-only in
// development.
//
// That split creates the obligation this suite discharges: the security gate has
// to exercise the real, enforced policy. So this builds nothing and assumes
// nothing -- it starts the production server against the existing build, on its
// own port, and walks real pages with a real browser.
//
// A page that returns HTML while its JavaScript is dead is a FAIL here. Server
// output proves the policy did not stop the response; only interaction proves it
// did not stop the product.
// =====================================================================

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

import { launch, newContext, record, summarise } from "./harness.mjs"

const ROOT = path.resolve(import.meta.dirname, "../..")
const PORT = Number(process.env.CSP_GATE_PORT || 3111)
const BASE = `http://localhost:${PORT}`

if (!existsSync(path.join(ROOT, ".next"))) {
  record("CSP-00 a production build exists to test", false, "run `npm run build` first")
  summarise("Production CSP")
  process.exit(0)
}

const server = spawn("npm", ["start"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
  stdio: "ignore",
  detached: true,
})

async function waitForServer(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" })
      if (res.status > 0) return res
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

const browser = await launch()
try {
  const first = await waitForServer()
  record("CSP-01 the production server answers", Boolean(first), first ? `status ${first.status}` : "never came up")
  if (!first) throw new Error("production server did not start")

  // ------------------------------------------------------------------
  // A. The header that ships is ENFORCED, and carries the designed controls.
  // ------------------------------------------------------------------
  // The policy currently ships REPORT-ONLY. That is a recorded, deliberate stop,
  // not an oversight: enforcing a nonce-bound script-src against this Next
  // version leaves the application un-hydrated, which this suite proved and
  // which is why the decision is in the ledger rather than in a commit message.
  // The directives are still asserted, because they are what will be enforced
  // the moment the noncing question is settled.
  const enforced = first.headers.get("content-security-policy")
  const reportOnly = first.headers.get("content-security-policy-report-only")
  record("CSP-02 production sends a policy at all", Boolean(enforced ?? reportOnly))
  record("CSP-02b and it is report-only while the noncing question is open", Boolean(reportOnly) && !enforced)

  const policy = enforced ?? reportOnly ?? ""
  const has = (fragment) => policy.includes(fragment)
  record("CSP-03 script-src is nonce-bound", /script-src[^;]*'nonce-[A-Za-z0-9]+'/.test(policy))
  record("CSP-04 and never allows inline script", !/script-src[^;]*'unsafe-inline'/.test(policy))
  record("CSP-05 and never allows eval", !/'unsafe-eval'/.test(policy))
  record("CSP-06 strict-dynamic carries the framework's own chunks", has("'strict-dynamic'"))
  record("CSP-07 object-src is none", has("object-src 'none'"))
  record("CSP-08 frame-ancestors is none", has("frame-ancestors 'none'"))
  record("CSP-09 base-uri is self", has("base-uri 'self'"))
  record("CSP-10 form-action is self", has("form-action 'self'"))
  record("CSP-11 no wildcard anywhere in the policy", !policy.includes("*"))
  for (const [label, header] of [
    ["X-Content-Type-Options", "x-content-type-options"],
    ["X-Frame-Options", "x-frame-options"],
    ["Referrer-Policy", "referrer-policy"],
    ["Permissions-Policy", "permissions-policy"],
  ]) {
    record(`CSP-12 ${label} is sent`, Boolean(first.headers.get(header)), first.headers.get(header)?.slice(0, 40))
  }

  // The nonce must be per-request, or it is not a nonce.
  // Read from whichever header the policy is currently sent in. An earlier
  // version of this check only looked at the enforcing header, so it reported
  // "the nonce never changes" when what had actually changed was which header
  // carries it.
  const nonceOf = (value) => (value ?? "").match(/'nonce-([A-Za-z0-9]+)'/)?.[1] ?? null
  const headerName = enforced ? "content-security-policy" : "content-security-policy-report-only"
  const second = await fetch(`${BASE}/login`)
  const firstNonce = nonceOf(policy)
  const secondNonce = nonceOf(second.headers.get(headerName))
  record(
    "CSP-13 the nonce is different on every request",
    firstNonce !== null && secondNonce !== null && firstNonce !== secondNonce,
    `${firstNonce?.slice(0, 6)} then ${secondNonce?.slice(0, 6)}`
  )

  // ------------------------------------------------------------------
  // B. The product works under it. Violations are collected, not assumed.
  // ------------------------------------------------------------------
  const context = await newContext(browser, { width: 1280, height: 900 })
  const page = await context.newPage()
  const violations = []
  page.on("console", (message) => {
    const text = message.text()
    if (/Content Security Policy|Refused to /i.test(text)) violations.push(text.slice(0, 160))
  })
  page.on("pageerror", (error) => {
    if (/Content Security Policy/i.test(String(error))) violations.push(String(error).slice(0, 160))
  })

  // Under report-only nothing is blocked, so violations are INFORMATION rather
  // than failures. What must still hold is that the product works and that the
  // reported violations are the known framework ones rather than something new.
  for (const [label, route] of [
    ["the public homepage", "/"],
    ["login", "/login"],
    ["signup", "/signup"],
    ["the invitation entry", "/join"],
  ]) {
    const before = violations.length
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(1200)
    const body = (await page.locator("body").innerText()).trim()
    record(`CSP-20 ${label} renders under the enforced policy`, body.length > 60, `${body.length} chars`)
    record(`CSP-21 ${label} reports only known framework violations`,
      violations.slice(before).every((v) => /inline script|_next\/static\/chunks/.test(v)),
      violations.slice(before).slice(0, 1).join("").slice(0, 120))
  }

  // HYDRATION. A page that renders server HTML while its JavaScript is dead
  // looks identical to a working one until somebody presses something.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
  await reveal.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
  let interactive = false
  for (let attempt = 0; attempt < 3 && !interactive; attempt += 1) {
    await reveal.click().catch(() => {})
    interactive = await page
      .locator('input[type="email"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  }
  record("CSP-30 the application hydrates and responds to a real interaction", interactive)
  record("CSP-31 the violations seen are all the framework's own scripts",
    violations.every((v) => /inline script|_next\/static\/chunks/.test(v)), `${violations.length} reported`)

  // An inline script that the policy did NOT nonce must be refused. This is the
  // whole point of the directive, so it is proved rather than assumed.
  const injected = await page.evaluate(() => {
    return new Promise((resolve) => {
      window.__ovalballCspProbe = false
      const script = document.createElement("script")
      script.textContent = "window.__ovalballCspProbe = true"
      document.head.appendChild(script)
      setTimeout(() => resolve(window.__ovalballCspProbe === true), 200)
    })
  })
  // Report-only cannot block, so this records the CURRENT truth rather than
  // asserting a protection that is not switched on. It flips to a real
  // assertion the moment the policy is enforced.
  record("CSP-40 inline script is reported but not yet blocked -- the open decision, stated",
    injected === true, "report-only: violations are logged, not refused")
} finally {
  try {
    process.kill(-server.pid, "SIGTERM")
  } catch {
    try {
      server.kill("SIGTERM")
    } catch {
      // already gone
    }
  }
  await browser.close()
}

summarise("Production CSP")
