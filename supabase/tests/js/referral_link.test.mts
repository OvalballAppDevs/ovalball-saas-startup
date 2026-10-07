import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

import { clubReferralUrl, referralSlugFrom } from "../../../packages/contracts/src/clubhouse/referral-link"
import { shareMessage } from "../../../packages/contracts/src/invitations/share"

/**
 * ONE REFERRAL LINK PER CLUB (20270740000000; the owner's decision of 2026-10-05) -- the client side.
 *
 * The server half lives in `supabase/tests/referral_link_attribution.sql`: who is credited, when, and what a
 * link may never do. This pins that every client carries the same link the same way: one address shape, a slug
 * that is only ever a slug, nothing remembered in a cookie or in storage, and one share screen for it.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

test("a club's link is /r/<its slug>, whatever the site address ends with", () => {
  assert.equal(clubReferralUrl("https://ovalball.co.uk", "ovalball-uat-rufc"), "https://ovalball.co.uk/r/ovalball-uat-rufc")
  assert.equal(clubReferralUrl("https://ovalball.co.uk/", "ovalball-uat-rufc"), "https://ovalball.co.uk/r/ovalball-uat-rufc")
})

test("a slug from an address is only ever a slug: lower-cased, or nothing", () => {
  assert.equal(referralSlugFrom("  Ovalball-UAT-RUFC "), "ovalball-uat-rufc")
  for (const bad of ["", "   ", "../admin", "a b", "slug?x=1", "-leading", "%2e%2e", "x".repeat(101), null, undefined]) {
    assert.equal(referralSlugFrom(bad as string | null | undefined), null, `${String(bad)} is no referral`)
  }
})

test("the link's message speaks to the club that receives it", () => {
  assert.equal(
    shareMessage({ kind: "REFERRAL", clubName: "Ovalball UAT RUFC", referredClubName: null }, "https://ovalball.co.uk/r/ovalball-uat-rufc"),
    "Ovalball UAT RUFC uses Ovalball to run its rugby: teams, fixtures, training and people in one place. We think your club would like it too: https://ovalball.co.uk/r/ovalball-uat-rufc"
  )
})

test("the phone shares the link through the one share screen, with no code and no shown-once warning", () => {
  const screen = code("apps/mobile/src/clubhouse/refer-link.tsx")
  assert.match(screen, /<ShareView\b/, "the one share screen: link, QR, WhatsApp first, poster")
  assert.match(screen, /share=\{\{ url: clubReferralUrl\(webUrl, slug\), code: null,/, "one URL for the QR, the poster and the message; no code, so no 'shown once' warning")
  assert.match(screen, /subject: \{ variant: "REFERRAL" \}/, "the club's own Rise Together poster")
  const hub = code("apps/mobile/app/(tabs)/clubhouse/refer.tsx")
  assert.match(hub, /title="Share Your Club Link"[\s\S]*?disabled=\{!canRefer\}/, "only people who may refer clubs share the club's link")
  assert.match(hub, /refer-link\?view=poster/, "Share a Poster opens the same screen on its poster")
})

test("the web carries the link in the address only: no cookie, no storage, and only to signup or the claim", () => {
  const page = code("app/r/[slug]/page.tsx")
  assert.doesNotMatch(page, /cookies\(|localStorage|sessionStorage|setCookie/, "the page remembers nothing")
  assert.match(page, /\/signup\$\{ref\}/)
  assert.match(page, /\/clubhouse\$\{ref\}/)
  assert.match(code("app/signup/signup-shell.tsx"), /useState\(\(\) => referralSlugFrom\(searchParams\.get\("ref"\)\)\)/, "read once, when the wizard opens")
  assert.match(code("app/signup/submit-signup.ts"), /referralSlug: referralSlugFrom\(referralSlug\)/, "it travels with the answers, server-side")
  assert.match(code("app/signup/complete-authenticated-signup.ts"), /referralSlug: referralSlugFrom\(referralSlug\)/)
  // Since 20270743000000 signup's claim goes through submit_club_claim like the Clubhouse's: the slug is handed
  // over and resolved by the server, whose guard decides whether it stands -- the client never names a club.
  assert.match(code("lib/signup/complete-signup.ts"), /rpc\("submit_club_claim", \{[\s\S]*?p_referral_slug: payload\.referralSlug/, "the signup claim hands the link's slug to submit_club_claim")
  assert.doesNotMatch(code("lib/signup/complete-signup.ts"), /referred_by_club_id/, "and never names the referring club itself")
  assert.match(code("app/(app)/clubhouse/claim-actions.ts"), /p_referral_slug: slug/, "a claim made in the Clubhouse says which club's link it came through")
})

test("the Clubhouse reads the referral from the address, so every way to a claim keeps it", () => {
  const dialog = code("app/(app)/clubhouse/claim-club-dialog.tsx")
  // The map mounts this dialog in its own React root, where there is no router: useSearchParams() is null
  // there, and reading it threw on every pin for a club not yet on Ovalball.
  assert.doesNotMatch(dialog, /useSearchParams/)
  assert.match(dialog, /const referralSlug = useReferralSlug\(\)/)
  assert.match(
    code("app/(app)/clubhouse/use-referral-slug.ts"),
    /useSyncExternalStore\(unchanging, \(\) => new URLSearchParams\(window\.location\.search\)\.get\("ref"\), \(\) => null\)/,
    "the address, read the same way in either tree; nothing on the server"
  )
  assert.match(
    code("app/(app)/clubhouse/club-map-card.tsx"),
    /href=\{`\/clubhouse\/club\/\$\{club\.directoryId\}\$\{profileQuery\}`\}/,
    "a claim made from the club's profile still says which link brought them"
  )
})

test("an introduction made through a link is never counted as an invitation sent", () => {
  assert.match(code("lib/app-context/commercial-intelligence-data.ts"), /from\("club_ovalball_invitations"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("source", "invitation"\)/)
})
