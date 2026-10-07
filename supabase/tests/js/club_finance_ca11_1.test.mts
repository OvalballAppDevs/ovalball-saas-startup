import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  billingPeriodLabel,
  canRetryPayment,
  canWaiveObligation,
  computeDashboardMetrics,
  describeBillingState,
  describeNextCollection,
  FINANCE_AUTHORITY_KEYS,
  FINANCE_EXPORT_HEADER,
  FINANCE_WEB_PATHS,
  filterObligationRows,
  financeErrorMessage,
  financeExportFileName,
  financeRowsToCsv,
  firstPaymentExample,
  formatMinorUnits,
  isBillingPeriod,
  isObligationOverdue,
  calculateFirstMonthProration,
  nextFullBillingPeriod,
  obligationTone,
  poundsToMinorUnits,
  priceInputProblem,
  shiftBillingPeriod,
  siblingRuleInput,
  type FinanceObligationRow,
} from "../../../packages/contracts/src/club/finance"
import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { RECENT_AUTH_SENTENCE } from "../../../packages/contracts/src/club/permissions"

/**
 * CA-M11.1 -- SUBSCRIPTIONS & PAYMENTS: the Club Admin's money on the phone, over the website's own domain.
 *
 * What is pinned: the contract calls the SAME RPCs the web's server actions call and nothing else; no
 * provider secret, token or bank column is selected by any mobile file; the club screens ask only club-scope
 * finance keys, never a team-scope one; the Admin Centre row is native and gated on the key the web gates
 * the page on; GoCardless is reached only through the website's own app routes, in the system's authentication
 * browser (Club Memberships Part 1, 20270750000000 -- it used to be the website's web entry point in the system
 * browser, which never came back to the app); every write goes through the reason sheet with the step-up hand-off;
 * and the pure formulas the web now imports from the contract still give the web's own answers.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..")
const CONTRACT = join(ROOT, "packages/contracts/src/club/finance.ts")
const SCREENS = join(ROOT, "apps/mobile/app/(tabs)/admin/subscriptions")
const HELPERS = [
  "apps/mobile/src/admin/finance-ui.tsx",
  "apps/mobile/src/admin/finance-authority.ts",
  "apps/mobile/src/admin/finance-export.ts",
  // Club Memberships Part 2: the running-memberships kit the club screens (and a Team Manager's view) are built from.
  "apps/mobile/src/membership/board-ui.tsx",
  "apps/mobile/src/membership/running-ui.tsx",
].map((p) => join(ROOT, p))
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const screenFiles = walk(SCREENS).filter((f) => f.endsWith(".tsx"))
const mobileFiles = [...screenFiles, ...HELPERS]
const contractCode = code(CONTRACT)
const rpcNames = (source: string) => new Set([...source.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]))

// ------------------------------------------------------------------ same operations as the web

test("every RPC the web's finance server actions call is the one the contract calls, by name", () => {
  const webActions = [
    "app/(app)/club/finance/actions.ts",
    "app/(app)/club/settings/subscriptions/actions.ts",
    "app/(app)/club/settings/ovalball-billing/actions.ts",
  ].map((p) => code(join(ROOT, p)))
  const webReads = [
    "app/(app)/club/finance/page.tsx",
    "app/(app)/club/finance/payments/page.tsx",
    "app/(app)/club/finance/[payerSubscriptionId]/page.tsx",
    "app/(app)/club/settings/subscriptions/page.tsx",
    "lib/platform/subscription.ts",
    "lib/platform/referrals.ts",
    "lib/permissions/has-capability.ts",
  ].map((p) => code(join(ROOT, p)))
  const contract = rpcNames(contractCode)

  // Mutations the phone performs natively: the same function, by name.
  for (const name of ["create_membership_obligations_for_period", "set_obligation_exemption", "configure_sibling_discount_rule", "disconnect_gocardless", "select_club_plan", "start_club_trial"]) {
    assert.ok(webActions.some((w) => w.includes(`"${name}"`)), `${name} is a web server action`)
    assert.ok(contract.has(name), `${name} is called by the contract`)
  }
  // Reads: the same single doors.
  // (The connection itself is now read on both clients through membership_setup_state -- see the Club Memberships test.)
  for (const name of ["get_finance_action_required", "get_membership_operational_detail", "get_sibling_discount_rules", "get_active_subscription_impact", "export_finance_rows", "club_platform_billing_state", "club_platform_next_collection", "club_referral_summary", "my_capabilities"]) {
    assert.ok([...webActions, ...webReads].some((w) => w.includes(`"${name}"`)), `${name} is read by the web`)
    assert.ok(contract.has(name), `${name} is read by the contract`)
  }
  // Nothing the web does NOT do: no provider-write RPC, no token function, no orphan action.
  for (const name of ["configure_subscription_programme", "set_subscription_price", "preview_first_payment_illustrative", "record_payment_refund", "end_membership_subscription", "cancel_club_platform_subscription", "store_gocardless_connection", "get_gocardless_token_for_club_admin_action", "get_gocardless_token_for_payer_subscription", "set_responsible_payer", "record_gocardless_payment", "apply_payment_status_transition", "claim_club_referral"]) {
    assert.ok(!contract.has(name), `${name} is not a phone operation`)
  }
  // club_membership_board: the ledger names a player who has left every team from the club's own board (Part 2),
  // where the roster read no longer finds them -- read-only, the same door every membership view reads.
  assert.deepEqual([...contract].sort(), [
    "club_membership_board",
    "club_platform_billing_state",
    "club_platform_next_collection",
    "club_referral_summary",
    "configure_sibling_discount_rule",
    "create_membership_obligations_for_period",
    "disconnect_gocardless",
    "export_finance_rows",
    "get_active_subscription_impact",
    "get_finance_action_required",
    "get_gocardless_connection_status",
    "get_membership_operational_detail",
    "get_sibling_discount_rules",
    "my_capabilities",
    "select_club_plan",
    "set_obligation_exemption",
    "start_club_trial",
  ])
})

test("Club Memberships is set up through ONE contract on both clients, and neither reaches the legacy doors", () => {
  const setupContract = code(join(ROOT, "packages/contracts/src/membership/setup.ts"))
  // The doors 20270748000000 added, by name -- and nothing else.
  assert.deepEqual([...rpcNames(setupContract)].sort(), [
    "accept_club_membership_terms",
    "activate_membership_programme",
    "archive_membership_product",
    "create_membership_product",
    "membership_first_payment_example",
    "membership_setup_state",
    "pause_membership_programme",
    "rename_membership_product",
    "save_membership_settings",
    "set_membership_product_price",
    "set_membership_product_teams",
  ])
  assert.deepEqual([...setupContract.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]), ["club_subscription_pricing"], "the setup contract reads one table: the price history")
  assert.doesNotMatch(setupContract, /\.(insert|update|delete|upsert)\(/, "the setup contract writes a table")
  assert.doesNotMatch(setupContract, /access_token|gc_organisation_id|account_number|sort_code|service_role/, "the setup contract names a secret")
  // The website's actions and the phone's screens import that contract rather than calling the RPCs themselves.
  const webActions = code(join(ROOT, "app/(app)/club/settings/subscriptions/actions.ts"))
  assert.match(webActions, /from "@ovalball\/contracts\/membership\/setup"/)
  // The page decides what it is from the same server answer the phone reads.
  assert.match(code(join(ROOT, "app/(app)/club/settings/subscriptions/page.tsx")), /loadMembershipSetup\(supabase, clubId\)/)
  assert.match(code(join(SCREENS, "index.tsx")), /loadMembershipSetup\(supabase, clubId\)/)
  for (const name of ["setup.tsx", "settings.tsx"]) assert.match(code(join(SCREENS, name)), /from "@ovalball\/contracts\/membership\/setup"/, `${name} uses the setup contract`)
  // Switching memberships on is Activate's alone: no client calls the legacy configure or price doors.
  for (const f of [...mobileFiles, join(ROOT, "app/(app)/club/settings/subscriptions/actions.ts"), CONTRACT]) {
    assert.doesNotMatch(code(f), /configure_subscription_programme|"set_subscription_price"/, `${f} calls a legacy membership door`)
  }
})

test("the contract reads the same tables the web pages read, and never the merchant connection", () => {
  const tables = new Set([...contractCode.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]))
  assert.deepEqual([...tables].sort(), ["club_subscription_pricing", "club_subscription_programmes", "gocardless_payments", "gocardless_subscriptions", "membership_obligations", "platform_credits", "platform_payments", "platform_plan_entitlements", "platform_plans"])
  assert.doesNotMatch(contractCode, /gocardless_merchant_connections/, "the merchant connection table is never named by a client")
  for (const f of mobileFiles) assert.doesNotMatch(code(f), /\.from\(\s*"/, `${f} reads through the contract, not tables`)
})

test("the web imports the shared formulas rather than keeping its own", () => {
  assert.match(code(join(ROOT, "lib/payments/domain/money.ts")), /from "@ovalball\/contracts\/club\/finance"/)
  assert.match(code(join(ROOT, "lib/payments/domain/dashboard-metrics.ts")), /from "@ovalball\/contracts\/club\/finance"/)
  assert.match(code(join(ROOT, "lib/payments/domain/proration.ts")), /from "@ovalball\/contracts\/club\/finance"/)
  for (const p of ["lib/payments/domain/money.ts", "lib/payments/domain/dashboard-metrics.ts", "lib/payments/domain/proration.ts"]) {
    assert.doesNotMatch(code(join(ROOT, p)), /export function/, `${p} defines no second formula`)
  }
})

// ------------------------------------------------------------------ nothing secret on a phone

test("no mobile finance file and no contract line selects a secret, a token, a bank column or a service role", () => {
  const forbidden = /access_token|refresh_token|account_number|sort_code|iban|webhook_secret|service_role|client_secret|authorisation_url/i
  for (const f of [...mobileFiles, CONTRACT]) {
    assert.doesNotMatch(code(f), forbidden, `${f} names a secret or bank column`)
  }
  // Provider identifiers stay on the server too: the contract projects them out of RPC results.
  const providerIds = /gc_payment_id|gc_mandate_id|gc_subscription_id|gc_billing_request_id|gc_customer_id|gc_organisation_id/
  for (const f of [...mobileFiles, CONTRACT]) assert.doesNotMatch(code(f), providerIds, `${f} carries a provider id`)
  // Never a write to a finance table from the phone: the RPCs are the only door.
  assert.doesNotMatch(contractCode, /\.(insert|update|delete|upsert)\(/, "the contract writes a table")
  for (const f of mobileFiles) assert.doesNotMatch(code(f), /supabase\s*\.\s*from\(/, `${f} touches a table directly`)
})

test("no local cache of money: nothing under the finance screens persists a payment, an obligation or a status", () => {
  for (const f of mobileFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /AsyncStorage|SecureStore|localStorage/, `${f} stores finance state on the device`)
  }
  // The export lands in the app's own cache only long enough to share, and is overwritten each time.
  const exporter = code(join(ROOT, "apps/mobile/src/admin/finance-export.ts"))
  assert.match(exporter, /Paths\.cache/)
  assert.match(exporter, /if \(target\.exists\) target\.delete\(\)/)
  assert.match(exporter, /Sharing\.shareAsync/)
})

// ------------------------------------------------------------------ authority: club scope, the web's keys, never a role

test("the club screens ask exactly the club-scope keys the web pages gate on, and no team-scope finance key", () => {
  assert.deepEqual(Object.values(FINANCE_AUTHORITY_KEYS).sort(), [
    "club.referrals.view",
    "finance.enrolment.manage",
    "finance.gocardless.connect",
    "finance.payment.act",
    "finance.platform_billing.manage",
    "finance.platform_billing.view",
    "finance.subscription.configure",
    "finance.subscription.export",
    "finance.subscription.view",
  ])
  assert.match(contractCode, /rpc\("my_capabilities", \{ p_scope_type: "club", p_club_id: clubId \}\)/)
  assert.doesNotMatch(contractCode, /p_scope_type: "team"|p_team_id/, "the club finance contract never asks a team-scope question")
  for (const f of mobileFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /my_capabilities/, `${f} probes through the contract, not directly`)
    assert.doesNotMatch(src, /role\s*===\s*"|CLUB_ADMIN|TEAM_MANAGER|isSiteAdmin/, `${f} decides from a role label`)
    assert.doesNotMatch(src, /team_subscription_status|canSeeTeamSubscriptions/, `${f} borrows the team manager's read`)
  }
  // The web's own gates, for the record: each page key is one the contract probes. Club Memberships Part 2 moved the
  // gate the Finance Dashboard asked into the one access check every page of the Memberships area asks itself
  // (memberships-access.ts): all four keys are asked there, at club scope, a person without the club's finance view is
  // sent away, and no page of the area relies on another page (or a shared header) having asked.
  const financeGate = code(join(ROOT, "app/(app)/club/finance/memberships-access.ts"))
  for (const key of ["finance.subscription.view", "finance.enrolment.manage", "finance.payment.act", "finance.subscription.export"]) {
    assert.ok(financeGate.includes(`hasCapability(supabase, "${key}", "club", { clubId })`), `the Memberships gate does not ask ${key} at the club`)
  }
  assert.match(financeGate, /if \(!clubId \|\| !canView\) redirect\("\/dashboard"\)/, "somebody without the club's finance view is not sent away")
  for (const page of ["page.tsx", "members/page.tsx", "members/[playerId]/page.tsx", "reminders/page.tsx", "payments/page.tsx"]) {
    assert.match(code(join(ROOT, "app/(app)/club/finance", page)), /await requireMembershipsAccess\(/, `${page} does not ask the Memberships gate itself`)
  }
  const billingPage = code(join(ROOT, "app/(app)/club/settings/ovalball-billing/page.tsx"))
  for (const key of ["finance.platform_billing.manage", "club.referrals.view"]) assert.ok(billingPage.includes(`"${key}"`))
})

test("the Admin Centre row is native and gated on the key the web gates the settings page on", () => {
  const row = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "subscriptions")
  assert.ok(row, "the subscriptions section exists")
  assert.equal(row.native, true)
  assert.equal(row.capability, "finance.subscription.configure")
  // Part 2: the section is where the club RUNS its memberships too, so somebody who may only see them can find it,
  // as the website's settings navigation already allows (configure OR view).
  assert.deepEqual(row.orCapabilities, ["finance.subscription.view"])
  assert.equal(row.webPath, "/club/settings/subscriptions")
  const nav = code(join(ROOT, "app/(app)/club/settings/resolve-nav-capabilities.ts"))
  assert.match(nav, /finance\.subscription\.configure/, "the web's settings navigation gates on the same key")
  // The router reaches it by the section key, so the folder must be named the same.
  assert.ok(statSync(join(SCREENS, "index.tsx")).isFile())
  assert.ok(statSync(join(SCREENS, "_layout.tsx")).isFile())
  assert.match(code(join(SCREENS, "_layout.tsx")), /headerShown: false/)
})

// ------------------------------------------------------------------ GoCardless: a hand-off, never a native form

test("GoCardless is reached only through the website's own app routes, in the system's authentication browser", () => {
  // The website's own journey is unchanged.
  assert.equal(FINANCE_WEB_PATHS.gocardlessConnect("abc"), "/api/gocardless/oauth/start?clubId=abc")
  // The phone never starts OAuth itself: it asks the website to START with the person's own token, opens the one-time
  // begin link in an authentication session (never a WebView), and asks the website to FINISH. GoCardless's code and
  // the club's token stay on the server; disconnecting goes through the website so the token is revoked at once.
  const helper = code(join(ROOT, "apps/mobile/src/membership/gocardless-connect.ts"))
  assert.match(helper, /WebBrowser\.openAuthSessionAsync\(beginUrl, returnUrl\)/)
  for (const route of ["/api/gocardless/oauth/app/start", "/api/gocardless/oauth/app/finish", "/api/gocardless/connection/disconnect"]) {
    assert.ok(helper.includes(`"${route}"`), `the helper calls ${route}`)
  }
  assert.match(helper, /fetch\(`\$\{webUrl\}\$\{path\}`/, "every request goes to the configured website and nowhere else")
  assert.doesNotMatch(helper, /WebView|gocardless\.com|connect-sandbox|oauth\/authorize/i, "the helper talks to the provider itself")
  for (const name of ["index.tsx", "setup.tsx", "settings.tsx"]) {
    const src = code(join(SCREENS, name))
    assert.match(src, /connectGoCardless\(\{ supabase, clubId/, `${name} connects through the website's app routes`)
    assert.doesNotMatch(src, /disconnectGoCardless\(supabase,/, `${name} disconnects without revoking the token`)
  }
  for (const name of ["index.tsx", "settings.tsx"]) assert.match(code(join(SCREENS, name)), /disconnectThroughWebsite\(\{ supabase, clubId, reason \}\)/)
  for (const f of mobileFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /WebView/i, `${f} embeds a WebView`)
    assert.doesNotMatch(src, /gocardless\.com|connect-sandbox|oauth\/authorize|fetch\(/i, `${f} talks to the provider itself`)
    assert.doesNotMatch(src, /account number|sort code|bank details.*TextInput/i, `${f} collects bank details`)
    // Every website hand-off is Linking.openURL of the configured web origin. The one other address a finance screen
    // opens is a payer's email or telephone, shown only to somebody the People rule lets see them -- and that is the
    // phone's own mail app or dialler, written out as such, never a website.
    for (const m of src.matchAll(/Linking\.openURL\(([^)]*)\)/g)) assert.match(m[1], /\$\{webUrl\}|^`(mailto|tel):\$\{/, `${f}: ${m[1]} is not the website`)
  }
  // The web-tier writes with the merchant token stay on the web, as a named page.
  assert.equal(FINANCE_WEB_PATHS.membership("x"), "/club/finance/x")
  assert.match(code(join(SCREENS, "payments.tsx")), /Retry on the Website/)
  assert.match(code(join(SCREENS, "membership/[payerSubscriptionId].tsx")), /Cancel Membership on the Website/)
})

// ------------------------------------------------------------------ every write: reason sheet, step-up, re-read

test("every screen that writes goes through the reason sheet with the step-up hand-off, and re-reads afterwards", () => {
  for (const name of ["index.tsx", "settings.tsx", "payments.tsx", "ovalball-billing.tsx"]) {
    const src = code(join(SCREENS, name))
    assert.match(src, /<ReasonSheet/, `${name} uses the sheet`)
    assert.match(src, /onStepUp=\{\(reason\) => \{/, `${name} hands a recent-auth refusal to step-up`)
    assert.match(src, /pending\.hold\(ask, reason\)/, `${name} holds the intent`)
    assert.match(src, /pathname: "\/step-up", params: \{ returnTo: "\/admin\/subscriptions/, `${name} returns to its own screen`)
    assert.match(src, /const resume = pending\.take\(\)\s*\n\s*if \(resume\) setAsk\(resumedAsk\(resume\)\)/, `${name} resumes the same ask on focus`)
    assert.match(src, /(financeErrorMessage|membershipSetupErrorMessage)\(cause/, `${name} shows the server's own sentence`)
  }
  // Programme & Pricing became Membership Settings: the old route only forwards, so nothing writes from it.
  assert.match(code(join(SCREENS, "plans.tsx")), /<Redirect href=\{"\/admin\/subscriptions\/settings" as never\} \/>/)
  // The setup journey re-reads after every write and hands a recent-authenticator refusal on Activate to step-up.
  const setup = code(join(SCREENS, "setup.tsx"))
  assert.match(setup, /isRecentAuthRefusal\(cause\)/)
  assert.match(setup, /pathname: "\/step-up", params: \{ returnTo: RETURN_PATH \}/)
  assert.ok((setup.match(/await load\(\)/g) ?? []).length >= 6, "the setup journey re-reads after its writes")
  assert.match(setup, /membershipSetupErrorMessage\(cause/)
  // Waive and Disconnect record a reason, as the web requires; the rest confirm.
  assert.match(code(join(SCREENS, "payments.tsx")), /confirmLabel: "Waive",\s*reason: "required"/)
  assert.match(code(join(SCREENS, "index.tsx")), /confirmLabel: "Confirm Disconnect",\s*destructive: true,\s*reason: "required"/)
  // The sheet's own contract: a step-up never performs the change.
  assert.match(code(join(ROOT, "apps/mobile/src/admin/reason-sheet.tsx")), /isRecentAuthRefusal\(cause\) && onStepUp/)
  assert.equal(financeErrorMessage({ code: "42501", message: RECENT_AUTH_SENTENCE }, "x"), "You are not authorised to do this for this club.")
  assert.equal(financeErrorMessage({ code: "42501", message: "You are not authorised to configure subscriptions for this club." }, "x"), "You are not authorised to configure subscriptions for this club.")
  assert.equal(financeErrorMessage({ code: "P0001", message: "Plan pro is not available to buy." }, "x"), "That plan is not available to buy yet.")
})

// ------------------------------------------------------------------ running memberships on the phone (Part 2)

test("running memberships: every screen reads the shared contracts, writes through their doors, and hands the merchant's jobs to the website", () => {
  const overview = code(join(SCREENS, "index.tsx"))
  // The overview offers Send Reminders but never sends: it opens Reminders with the right people chosen.
  assert.match(overview, /loadClubMembershipBoard\(supabase, clubId\)/)
  assert.match(overview, /pathname: "\/admin\/subscriptions\/reminders"|go\("\/admin\/subscriptions\/reminders"/)
  assert.doesNotMatch(overview, /sendMembershipReminders|sendRemindersInBatches/, "the overview sends a reminder itself")
  // Reminders: the server's own preview of the words, sent in the server's batches -- and no free text to send.
  const reminders = code(join(SCREENS, "reminders.tsx"))
  assert.match(reminders, /previewMembershipReminders\(supabase, \{ clubId, playerIds/)
  assert.match(reminders, /sendRemindersInBatches\(\(batch\) => sendMembershipReminders\(supabase, \{ clubId, playerIds: batch \}\), ids\)/)
  assert.doesNotMatch(reminders, /TextInput|multiline/, "a reminder carries no free text")
  // One member: Change Who Pays is the release door with a reason; Cancel and Retry hand off to the website.
  const member = code(join(SCREENS, "member/[playerId].tsx"))
  assert.match(member, /loadClubMemberMembership\(supabase, clubId, String\(playerId\)\)/)
  assert.match(member, /releaseResponsiblePayer\(supabase, \{ payerSubscriptionId, reason: reason\.trim\(\) \}\)/)
  assert.match(member, /Cancel Membership on the Website/)
  assert.match(member, /Retry Payment on the Website/)
  // Teams: the club telling a team's staff is the one door for it.
  assert.match(code(join(SCREENS, "teams.tsx")), /sendTeamMembershipAttention\(supabase, team\.team\.id\)/)
  // The old board's address forwards to Members, so an old link still lands.
  assert.match(code(join(SCREENS, "board.tsx")), /<Redirect href=\{\{ pathname: "\/admin\/subscriptions\/members"/)
})

test("a Team Manager's squad view shows standing and reminders only: no amount, payer, Direct Debit or other team", () => {
  const team = code(join(ROOT, "apps/mobile/app/(tabs)/subscriptions.tsx"))
  assert.match(team, /loadTeamMembershipBoard\(supabase, teamId\)/)
  // Team scope on every reminder, so the server lets this team's staff remind only their own players.
  assert.match(team, /sendMembershipReminders\(supabase, \{ clubId: board\.clubId, teamId, playerIds: batch \}\)/)
  assert.match(team, /loadMembershipReminderHistory\(supabase, \{ clubId: next\.clubId, teamId/)
  assert.doesNotMatch(team, /formatMoneyMinor|formatMinorUnits|amountDueMinor|monthlyAmountMinor|\.payer\b|mandateStatus|MoneySheet|loadClubMembershipBoard|recipients/, "the team view reaches for money, a payer or the club's board")
})

// ------------------------------------------------------------------ the formulas, the web's own answers

test("money and periods format as the web formats them", () => {
  assert.equal(formatMinorUnits(1550), "£15.50")
  assert.equal(formatMinorUnits(0), "£0.00")
  assert.equal(poundsToMinorUnits(15.5), 1550)
  assert.equal(poundsToMinorUnits(0.1 + 0.2), 30)
  assert.equal(shiftBillingPeriod("2026-01-01", -1), "2025-12-01")
  assert.equal(shiftBillingPeriod("2026-12-01", 1), "2027-01-01")
  assert.equal(billingPeriodLabel("2026-09-01"), "September 2026")
  assert.ok(isBillingPeriod("2026-09-01"))
  assert.ok(!isBillingPeriod("2026-09-15"))
  assert.ok(!isBillingPeriod(undefined))
  assert.equal(financeExportFileName("2026-09-01"), "finance-export-2026-09.csv")
})

test("dashboard metrics: expected, collected, outstanding, excused and the success rate, exactly as the web computes them", () => {
  const m = computeDashboardMetrics(
    [
      { amountDueMinor: 1500, status: "PAID" },
      { amountDueMinor: 1500, status: "FAILED" },
      { amountDueMinor: 1500, status: "WAIVED" },
      { amountDueMinor: 1500, status: "SETUP_PENDING" },
      { amountDueMinor: 1500, status: "SUBMITTED" },
    ],
    3
  )
  // The canonical definitions (20270746000000): a waived month is not expected; outstanding is what is owed
  // and not yet paid (failed, not set up, with the bank).
  assert.equal(m.expectedRevenueMinor, 6000)
  assert.equal(m.collectedMinor, 1500)
  assert.equal(m.exemptWaivedMinor, 1500)
  assert.equal(m.outstandingMinor, 4500)
  // Attempted: PAID, FAILED, SUBMITTED = 3; failed 1 -> 66.7%.
  assert.equal(m.successRatePercent, 66.7)
  assert.equal(m.activeDirectDebits, 3)
  assert.equal(computeDashboardMetrics([], 0).successRatePercent, null)
  assert.equal(computeDashboardMetrics([{ amountDueMinor: 100, status: "PAID" }, { amountDueMinor: 500, status: "EXEMPT" }], 0).outstandingMinor, 0)
})

test("OVERDUE is derived, never asserted: an unsettled obligation past its due date plus the five-day window", () => {
  const now = new Date("2026-09-24T12:00:00Z")
  // A payment WITH THE BANK is money on its way -- Collecting, never Overdue (the canonical rule, 20270746000000):
  // calling it overdue sent clubs chasing families whose money was already in transit.
  assert.ok(!isObligationOverdue("SUBMITTED", "2026-09-10", 5, now), "with the bank is collecting, not overdue")
  assert.ok(isObligationOverdue("SETUP_PENDING", "2026-09-10", 5, now))
  assert.ok(!isObligationOverdue("SETUP_PENDING", "2026-09-22", 5, now), "inside the processing window")
  assert.ok(!isObligationOverdue("SETUP_PENDING", "2026-09-01", 5, now, "2026-09-20"), "a member who joined on the 20th is not overdue on the 24th")
  // The server's own boundary (today > effective due + 5, by date): five days late is not yet Overdue, six is --
  // whatever the time of day, so the ledger never says Overdue on a day the board says Due.
  assert.ok(!isObligationOverdue("SETUP_PENDING", "2026-09-19", 5, now), "exactly five days late is not yet overdue")
  assert.ok(!isObligationOverdue("SETUP_PENDING", "2026-09-19", 5, new Date("2026-09-24T23:59:00Z")), "not even late on the fifth day")
  assert.ok(isObligationOverdue("SETUP_PENDING", "2026-09-18", 5, now), "six days late is overdue")
  assert.ok(isObligationOverdue("SETUP_PENDING", "2026-09-19", 5, new Date("2026-09-25T00:01:00Z")), "and the next day it is")
  assert.ok(!isObligationOverdue("PAID", "2026-01-01", 5, now), "a settled obligation is never overdue")
  assert.ok(!isObligationOverdue("FAILED", "2026-01-01", 5, now), "a failure is a failure, not an overdue")
  assert.ok(!isObligationOverdue("WAIVED", "2026-01-01", 5, now))
})

test("proration: integer pence, calendar days inclusive, the same rounding the SQL uses", () => {
  const p = calculateFirstMonthProration("2026-09-16", 1500)
  assert.deepEqual(p, { chargeableDays: 15, totalDaysInMonth: 30, proratedAmountMinor: 750, billingPeriod: "2026-09-01" })
  assert.equal(calculateFirstMonthProration("2026-02-15", 1000).proratedAmountMinor, 500)
  assert.equal(nextFullBillingPeriod("2026-12-16"), "2027-01-01")
  const ex = firstPaymentExample("PRORATE_CURRENT_MONTH", 1500, new Date("2026-09-24T12:00:00Z"))
  assert.equal(ex.firstAmountMinor, 750)
  assert.equal(ex.coversLabel, "16–30 September")
  const later = firstPaymentExample("NEXT_COLLECTION_DAY", 1500, new Date("2026-09-24T12:00:00Z"))
  assert.equal(later.firstAmountMinor, 1500)
  assert.equal(later.noChargeThisMonth, true)
})

test("the CSV export has the web's thirteen columns, its escaping, and no bank data", () => {
  assert.equal(FINANCE_EXPORT_HEADER.length, 13)
  const csv = financeRowsToCsv([
    {
      player_first_name: 'Ann "Annie"',
      player_surname: "O'Neill",
      payer_first_name: "Pat",
      payer_surname: "O'Neill",
      payer_email: "pat@example.test",
      billing_period: "2026-09-01",
      amount_due_minor: 1275,
      obligation_status: "PAID",
      due_date: "2026-09-01",
      payment_status: "confirmed",
      subscription_status: "active",
      base_amount_minor: 1500,
      sibling_ordinal: 2,
      sibling_discount_type: "PERCENTAGE",
      sibling_discount_amount_minor: 225,
      final_amount_minor: 1275,
    },
  ])
  const [header, row] = csv.split("\n")
  assert.equal(header, '"Player","Payer","Payer email","Billing period","Amount","Obligation status","Due date","Payment status","Subscription status","Base rate","Sibling ordinal","Sibling discount","Final rate"')
  assert.equal(row, '"Ann ""Annie"" O\'Neill","Pat O\'Neill","pat@example.test","2026-09-01","12.75","PAID","2026-09-01","confirmed","active","15.00","2","PERCENTAGE","12.75"')
  assert.doesNotMatch(FINANCE_EXPORT_HEADER.join(","), /bank|sort|account|token|mandate/i)
})

test("the members list filters and the web's own rules for offering Waive and Retry", () => {
  const row = (status: string, payment: { id: string; status: string } | null = null, name = "Player"): FinanceObligationRow => ({ obligationId: status + name, payerSubscriptionId: "p", playerId: "x", playerName: name, amountMinor: 100, dueDate: "2026-09-01", status, resolvedReason: null, payment, isProrated: false })
  const rows = [row("PAID"), row("FAILED", { id: "pay", status: "failed" }), row("OVERDUE"), row("SETUP_PENDING"), row("WAIVED"), row("EXEMPT"), row("SUBMITTED", null, "Zed")]
  assert.equal(filterObligationRows(rows, "attention", "").length, 3)
  assert.equal(filterObligationRows(rows, "failed", "").length, 1)
  assert.equal(filterObligationRows(rows, "excused", "").length, 2)
  assert.equal(filterObligationRows(rows, "all", "zed").length, 1)
  assert.ok(canWaiveObligation("FAILED"))
  assert.ok(canWaiveObligation("SUBMITTED"))
  for (const s of ["PAID", "WAIVED", "EXEMPT", "REFUNDED"]) assert.ok(!canWaiveObligation(s), `${s} cannot be waived`)
  assert.ok(canRetryPayment(row("FAILED", { id: "pay", status: "failed" })))
  assert.ok(!canRetryPayment(row("FAILED")), "no attempt, nothing to retry")
  assert.ok(!canRetryPayment(row("PAID", { id: "pay", status: "confirmed" })))
  assert.equal(obligationTone("FAILED"), "danger")
  assert.equal(obligationTone("PAID"), "positive")
  assert.equal(obligationTone("WAIVED"), "neutral")
  // Part 2: the phone's month pill follows the one month tone the web draws -- late is amber, never red; money on
  // its way is "moving"; red only where a payment failed or was taken back.
  assert.equal(obligationTone("OVERDUE"), "caution")
  assert.equal(obligationTone("SUBMITTED"), "moving")
  assert.equal(obligationTone("CHARGEDBACK"), "danger")
})

test("settings inputs are checked as the web checks them", () => {
  assert.equal(priceInputProblem("0", "2026-10-01"), "Enter a valid amount greater than £0.")
  assert.equal(priceInputProblem("15", "next week"), "Choose an effective-from date (YYYY-MM-DD).")
  assert.equal(priceInputProblem("15.50", "2026-10-01"), null)
  assert.deepEqual(siblingRuleInput("NONE", "whatever"), { ok: true, discountValue: 0 })
  assert.deepEqual(siblingRuleInput("PERCENTAGE", "150"), { ok: false, problem: "Percentage must be between 0 and 100." })
  assert.deepEqual(siblingRuleInput("PERCENTAGE", "15"), { ok: true, discountValue: 15 })
  assert.deepEqual(siblingRuleInput("FIXED", "2.50"), { ok: true, discountValue: 250 })
  assert.deepEqual(siblingRuleInput("FIXED", "-1"), { ok: false, problem: "Amount must be £0 or more." })
})

test("Domain B copy: the nine billing states and the next-collection line, as the web writes them", () => {
  const base = { effectivePlan: "standard", subscriptionStatus: null, planPricePence: 1500, currency: "GBP", nextCollectionOn: null, currentPeriodEnd: null, trialStatus: null, trialRemainingSeconds: null, creditBalancePence: 0, platformMode: "live" as const }
  assert.equal(describeBillingState({ ...base, subscriptionStatus: "active" }, "Standard").headline, "Standard")
  assert.equal(describeBillingState({ ...base, subscriptionStatus: "past_due" }, "Standard").headline, "Standard · payment failed")
  assert.equal(describeBillingState({ ...base, trialStatus: "active", trialRemainingSeconds: 86_400 * 2 + 1 }, "Standard").headline, "Free trial · 3 days left")
  assert.equal(describeBillingState({ ...base, effectivePlan: null }, "Standard").headline, "No plan yet")
  assert.deepEqual(describeNextCollection({ ...base, platformMode: "beta" }, null), { text: "Nothing while Ovalball is in Beta", attention: false })
  assert.deepEqual(describeNextCollection({ ...base, subscriptionStatus: "pending_setup" }, null), { text: "Nothing until your Direct Debit is set up", attention: true })
  assert.equal(describeNextCollection({ ...base, subscriptionStatus: "active", nextCollectionOn: "2026-10-01" }, { grossPence: 1500, creditAvailablePence: 0, creditAppliedPence: 0, netPence: 1500, currency: "GBP", willSkip: false }).text, "£15.00 on 1 October 2026")
})

// ------------------------------------------------------------------ the two domains stay apart

test("the two money domains share nothing: Domain B reads no club-member table and Domain A reads no platform table", () => {
  const start = contractCode.indexOf("export type PlatformSubscriptionStatus")
  assert.ok(start > 0, "Domain B begins with its own status type")
  const domainA = contractCode.slice(0, start)
  const domainB = contractCode.slice(start)
  assert.doesNotMatch(domainA, /platform_(plans|payments|credits|plan_entitlements|club_subscriptions|trials|referrals)|club_platform_|club_referral_summary/)
  assert.doesNotMatch(domainB, /membership_obligations|gocardless_|club_subscription_|player_subscription_payers/)
  assert.doesNotMatch(code(join(SCREENS, "ovalball-billing.tsx")), /loadFinanceDashboard|loadSubscriptionSettings|membership_obligations/)
})

// ------------------------------------------------------------------ content standard

test("controls are Title Case and the body copy is sentence case, UK English", () => {
  const labels = new Set<string>()
  // Buttons and sheet confirmations are controls; a metric caption or a definition term is not.
  for (const f of screenFiles) for (const m of code(f).matchAll(/(?:<Button label|confirmLabel:|<Chip label)[=\s]*["`]([^"`$]+)["`]/g)) labels.add(m[1])
  assert.ok(labels.size >= 10)
  for (const label of labels) {
    for (const word of label.split(" ")) {
      if (["a", "an", "and", "the", "to", "of", "on", "in", "for", "with", "&", "£"].includes(word)) continue
      assert.match(word, /^[A-Z£(]|^\d/, `"${label}" is not Title Case (word "${word}")`)
    }
  }
  for (const f of [...screenFiles, CONTRACT]) assert.doesNotMatch(read(f), /\b(authoriz(e|ed|ation)|organiz(e|ation)|customiz(e|ed)|Center)\b/, `${f} uses US spelling`)
})
