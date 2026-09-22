#!/usr/bin/env node
/**
 * Permanent guards for the Site Admin navigation information architecture.
 *
 * Grouping eighteen top-level links into five is only safe if nothing can
 * fall out of the map. The properties that matter and cannot be seen by
 * reading a screenshot:
 *
 *   * every route the capability filter produced is still represented
 *     somewhere in the grouped output -- a page must never become
 *     unreachable because someone forgot to add it to a section;
 *   * grouping never invents a route the filter did not produce;
 *   * grouping applies to Site Admin only, so Club/Team/Parent/Player
 *     navigation is untouched;
 *   * the drawer and the sidebar render the SAME structure.
 *
 * Physical hitboxes and scroll behaviour are CSS and are verified by
 * browser UAT instead -- see docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md.
 *
 *   node scripts/verify-admin-nav.mjs
 */

import { readFileSync, existsSync } from "node:fs"

let pass = 0
let fail = 0

function check(name, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "")

const navSrc = read("lib/app-context/build-nav-items.ts")
const layoutSrc = read("app/(app)/layout.tsx")
const mobileSrc = read("app/(app)/app-mobile-nav.tsx")
const desktopSrc = read("app/(app)/app-nav.tsx")
const sectionsSrc = read("app/(app)/nav-sections.tsx")

console.log("\nSite Admin navigation\n")

// ---------------------------------------------------------------- A
// Every /admin route the Site Admin branch pushes must be represented in
// the section map, or land in the "More" fallback. This is the check that
// stops a page becoming unreachable.
const siteAdminBranch = navSrc.slice(navSrc.indexOf("if (inSiteAdminContext) {"))
const pushedHrefs = [...siteAdminBranch.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1])
const mappedHrefs = [...navSrc.matchAll(/hrefs:\s*\[([^\]]+)\]/gs)]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))

check(
  "the Site Admin branch still produces routes to group",
  pushedHrefs.length >= 15,
  `found ${pushedHrefs.length}`
)

const unmapped = pushedHrefs.filter((h) => !mappedHrefs.includes(h) && h !== "/dashboard")
check(
  "every Site Admin route is placed in a named section",
  unmapped.length === 0,
  unmapped.length ? `unmapped (would fall into "More"): ${unmapped.join(", ")}` : ""
)

// A "More" fallback must nevertheless exist, so an unmapped future route is
// displaced rather than dropped.
check(
  'an unmapped route still renders via the "More" fallback section',
  /key:\s*"more"/.test(navSrc) && /leftovers/.test(navSrc)
)

// ---------------------------------------------------------------- B
check(
  "grouping only ever draws from the already-filtered list (no literal hrefs invented)",
  /const byHref = new Map\(items\.map/.test(navSrc) && /byHref\.get\(href\)/.test(navSrc)
)

check(
  "Dashboard stays a top-level item rather than being buried in a section",
  /byHref\.get\("\/dashboard"\)/.test(navSrc)
)

// ---------------------------------------------------------------- C
// GROUPING IS PER CONTEXT, AND THE CLUB HAS IT TOO.
//
// This pair used to read "grouping is applied only in a Site Admin context" and "non-Site-Admin contexts
// receive empty sections". Both still passed, and both had stopped being true: UX-5's whole point was that
// a club's navigation should match Site Admin's information architecture, and buildClubSections now shares
// groupNavItems with it. A green assertion that states something false about the product is worse than a
// red one, so this says what the layout actually does.
check(
  "Site Admin is grouped by its own section map",
  /activeContext\.kind === "site_admin"\s*\?\s*buildSiteAdminSections/.test(layoutSrc)
)

check(
  "and a club or team is grouped too, by the club section map (UX-5)",
  /buildClubSections\(navPrimary/.test(layoutSrc) &&
    /activeContext\.kind === "club" \|\| activeContext\.kind === "team"/.test(layoutSrc)
)

check(
  "the contexts with a small fixed catalogue stay flat, selecting the plain list",
  /sections:\s*\[\]/.test(layoutSrc)
)

check(
  "both section builders share one grouping function, so the fallback rule cannot diverge",
  /return groupNavItems\(items, SITE_ADMIN_SECTIONS\)/.test(navSrc) && /return groupNavItems\(items, spec\)/.test(navSrc)
)

// ---------------------------------------------------------------- D
check(
  "the drawer and the sidebar render the same NavSections component",
  /from "\.\/nav-sections"/.test(mobileSrc) && /from "\.\/nav-sections"/.test(desktopSrc)
)

check(
  "both surfaces are handed the identical top/sections structures",
  /top=\{navTop\}[\s\S]{0,80}sections=\{navSections\}/.test(layoutSrc) &&
    (layoutSrc.match(/top=\{navTop\}/g) ?? []).length === 2
)

// ---------------------------------------------------------------- E
console.log("\nMobile drawer structure\n")

check(
  "the drawer's built-in overlapping close button is disabled",
  /showCloseButton=\{false\}/.test(mobileSrc)
)

// Comments are stripped first: this file deliberately QUOTES the old
// `absolute top-3 right-3` in its explanation of the bug, and a check that
// cannot tell prose from code is not a check.
const mobileCode = mobileSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
check(
  "gear and close are laid out as siblings, not absolutely positioned",
  !/\babsolute\b[^"]*\btop-\d/.test(mobileCode)
)

const touchTargets = (mobileSrc.match(/size-11 shrink-0 items-center justify-center/g) ?? []).length
check(
  "gear and close both have 44px (size-11) touch targets",
  touchTargets >= 2,
  `found ${touchTargets}`
)

check(
  "the close control has an accessible name",
  /aria-label="Close menu"/.test(mobileSrc)
)

check(
  "the navigation region scrolls independently of the page behind it",
  /min-h-0 flex-1 overflow-y-auto overscroll-contain/.test(mobileSrc)
)

check(
  "the drawer accounts for mobile safe areas",
  /env\(safe-area-inset-top\)/.test(mobileSrc) && /env\(safe-area-inset-bottom\)/.test(mobileSrc)
)

check(
  "the desktop sidebar nav also scrolls rather than overflowing the viewport",
  /min-h-0 flex-1 overflow-y-auto/.test(desktopSrc)
)

// ---------------------------------------------------------------- F
console.log("\nGrouped navigation accessibility\n")

check("sections expose aria-expanded", /aria-expanded=\{expanded\}/.test(sectionsSrc))
check("sections control a labelled panel", /aria-controls=\{panelId\}/.test(sectionsSrc))
check(
  "a section containing the current page cannot stay collapsed",
  /const expanded = open \|\| containsActive/.test(sectionsSrc)
)
check(
  "the active child marks its parent section active",
  /containsActive \? "text-pitch-400"/.test(sectionsSrc)
)
check("the current page is announced to assistive tech", /aria-current=\{active \? "page" : undefined\}/.test(sectionsSrc))
check("collapsed links stay in the document (hidden, not unmounted)", /hidden=\{!expanded\}/.test(sectionsSrc))

// ---------------------------------------------------------------- G
console.log("\nContext-aware settings\n")

const identitySrc = read("lib/app-context/identity-display.ts")
check(
  "settings resolve from the ACTIVE context, not the account's highest role",
  /export function resolveContextSettingsLink\(kind: ActiveContextKind/.test(identitySrc)
)
check("club context resolves to Club Settings", /case "club":\s*\n\s*return \{ href: "\/club\/settings"/.test(identitySrc))
check("team context resolves to that exact team", /href: `\/teams\/\$\{activeId\}`/.test(identitySrc))
// EVERY KIND WITH NO SETTINGS SURFACE OF ITS OWN resolves to personal settings.
//
// This used to pin the exact pair `case "parent":` then `case "player":` then the return. It had been
// failing since "family" (All Children) joined the chain, and Convergence Step 15 added "governing" -- a
// county union has no settings surface either, because its record is verified reference data maintained
// in Site Admin. Pinning a count is what made a correct product look broken, so the check now asserts the
// RULE: each of these kinds falls through to /account, whatever order they are written in and however
// many there come to be.
{
  const settingsBlock = identitySrc.slice(identitySrc.indexOf("export function resolveContextSettingsLink"))
  const fallthrough = settingsBlock.slice(0, settingsBlock.indexOf('return { href: "/account"'))
  const shareIt = ["parent", "player", "family", "governing"]
  check(
    `the kinds with no settings surface of their own resolve to personal settings (${shareIt.join(", ")})`,
    shareIt.every((kind) => new RegExp(`case "${kind}":`).test(fallthrough))
  )
  // And the ones that DO have their own are still answered separately, not swept into the fallthrough.
  check(
    "club and team still resolve to their own settings, and Site Admin to none",
    /case "club":/.test(settingsBlock.slice(0, settingsBlock.indexOf("/club/settings") + 20)) &&
      /case "site_admin":\s*\n\s*return null/.test(settingsBlock)
  )
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
