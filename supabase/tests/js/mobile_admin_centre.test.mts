import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { CLUB_CONTACT_ROLES, clubProfileErrorMessage, clubProfileFieldsDiffer, EMPTY_CLUB_PROFILE_FIELDS } from "../../../packages/contracts/src/club/profile"
import { REASON_REQUIRED_OPERATIONS, REASON_REQUIRED_RPCS } from "../../../packages/contracts/src/required-reasons"

/**
 * THE ADMIN CENTRE IS THE SAME PRODUCT ON A SECOND CLIENT (CA-M1).
 *
 * Structural pins, beside the SQL suite that proves the domain operations
 * themselves: both clients write the Club Profile through the domain
 * operations and never the tables; the app decides nothing from a role
 * label; every section is gated by a canonical capability the website gates
 * the same job on; no admin mutation is queued for later; the required-reasons
 * list is one list; and the error rule is one rule.
 */

const MOBILE = "apps/mobile"
const ADMIN_ROUTES = join(MOBILE, "app/(tabs)/admin")
const ADMIN_SRC = join(MOBILE, "src/admin")
const CONTRACTS_CLUB = "packages/contracts/src/club"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const read = (path: string) => readFileSync(path, "utf8")
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const adminFiles = [...walk(ADMIN_ROUTES), ...walk(ADMIN_SRC)].filter((f) => /\.tsx?$/.test(f))

test("both clients change the Club Profile through the domain operations, never the tables", () => {
  const contracts = code(join(CONTRACTS_CLUB, "profile.ts"))
  for (const rpc of ["update_club_profile", "save_club_contact", "delete_club_contact"]) {
    assert.match(contracts, new RegExp(`rpc\\("${rpc}"`), `the shared wrapper calls ${rpc}`)
  }
  assert.doesNotMatch(contracts, /from\("clubs"\)\s*\.\s*(update|insert|delete|upsert)/, "the shared module never writes clubs directly")
  assert.doesNotMatch(contracts, /from\("club_contacts"\)\s*\.\s*(update|insert|delete|upsert)/, "the shared module never writes club_contacts directly")

  const webActions = code("app/(app)/club/actions.ts")
  assert.match(webActions, /from "@ovalball\/contracts\/club\/profile"/)
  assert.doesNotMatch(webActions, /from\("clubs"\)\s*\.update\(\{\s*bio/, "the website's profile save no longer writes clubs directly")
  assert.doesNotMatch(webActions, /from\("club_contacts"\)/, "the website's contact actions no longer touch club_contacts directly")

  for (const f of adminFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("(clubs|club_contacts)"\)\s*\.\s*(update|insert|delete|upsert)/, `${f} must not write the tables`)
    assert.doesNotMatch(src, /rpc\("(update_club_profile|save_club_contact|delete_club_contact)"/, `${f} must go through the shared wrapper, not call the operation itself`)
  }
})

test("the app decides nothing from a role label", () => {
  for (const f of [...adminFiles, join(MOBILE, "app/(tabs)/more.tsx")]) {
    const src = code(f)
    assert.doesNotMatch(src, /role\s*===?\s*["'](CLUB_ADMIN|Club Admin|club_admin)["']/i, `${f} branches on a role label`)
    assert.doesNotMatch(src, /\bisClubAdmin\b|\bclubRoleKey\s*===?/, `${f} derives authority from a role`)
  }
  const access = code(join(ADMIN_SRC, "access.ts"))
  assert.match(access, /readAdminCentreAccess|my_capabilities/, "visibility comes from the server's capability read")
})

test("every Admin Centre section is gated by one canonical capability the website gates the same job on", () => {
  // The website gates the same job on the same key: in its Club Settings navigation, or on the page that owns the job (Teams).
  const webNav = code("app/(app)/club/settings/resolve-nav-capabilities.ts") + code("app/(app)/teams/page.tsx")
  const keys = new Set(ADMIN_CENTRE_SECTIONS.map((s) => s.key))
  assert.equal(keys.size, ADMIN_CENTRE_SECTIONS.length, "section keys are unique")
  for (const s of ADMIN_CENTRE_SECTIONS) {
    assert.match(webNav, new RegExp(`"${s.capability.replace(/\./g, "\\.")}"`), `${s.key} is gated on ${s.capability}, which the website also gates on`)
    assert.ok(s.webPath.startsWith("/"), `${s.key} names a web destination`)
    assert.match(s.label, /^[A-Z]/, `${s.key} label is Title Case`)
  }
  assert.ok(ADMIN_CENTRE_SECTIONS.some((s) => s.native && s.key === "club-profile"), "Club Profile is native in CA-M1")
})

test("no admin mutation is queued, cached as authority, or kept in a mobile-only store", () => {
  for (const f of adminFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /AsyncStorage|SecureStore|mobile_club_settings|queue|retryLater|pendingWrites/i, `${f} keeps no local store of admin state`)
  }
  const screen = code(join(ADMIN_ROUTES, "club-profile.tsx"))
  assert.match(screen, /useFocusEffect/, "the screen re-reads when it comes back into focus")
  assert.match(screen, /readClubProfile\(/, "the screen reads the canonical profile")
  assert.match(screen, /canEditClubProfile\(|readAdminCentreAccess\(/, "the screen asks the server whether it may edit")
})

test("the shared field rules behave", () => {
  assert.equal(clubProfileFieldsDiffer(EMPTY_CLUB_PROFILE_FIELDS, { ...EMPTY_CLUB_PROFILE_FIELDS, bio: "  " }), false, "whitespace alone is not a change")
  assert.equal(clubProfileFieldsDiffer(EMPTY_CLUB_PROFILE_FIELDS, { ...EMPTY_CLUB_PROFILE_FIELDS, website: "x" }), true)
  assert.deepEqual(CLUB_CONTACT_ROLES, ["fixture_secretary", "minis_secretary", "general"])
  assert.equal(clubProfileErrorMessage({ code: "42501", message: "You do not have permission to change this club's profile." }, "fallback"), "You do not have permission to change this club's profile.")
  assert.equal(clubProfileErrorMessage({ code: "22023", message: "A name is required." }, "fallback"), "A name is required.")
  assert.equal(clubProfileErrorMessage({ code: "08006", message: "connection lost: driver detail" }, "fallback"), "fallback", "a driver fault never reaches a screen verbatim")
  assert.equal(clubProfileErrorMessage(new Error("TypeError: fetch failed"), "fallback"), "fallback")
})

test("the required-reasons list is one list, and no client keeps another", () => {
  assert.equal(new Set(REASON_REQUIRED_RPCS).size, REASON_REQUIRED_RPCS.length)
  assert.equal(REASON_REQUIRED_RPCS.length, 12)
  for (const op of REASON_REQUIRED_OPERATIONS) {
    if (op.when === "conditional") assert.ok(op.condition, `${op.rpc} states its condition`)
  }
  // No second hand-written list of reason-requiring RPC names anywhere in either client. A file that
  // CALLS the operations (rpc("...")) is their caller, not a list; a list is the names as bare strings.
  const suspects = [...walk("apps/mobile/src"), ...walk("apps/mobile/app"), ...walk("lib"), ...walk("app")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("required-reasons"))
  for (const f of suspects) {
    const src = code(f)
    const hits = REASON_REQUIRED_RPCS.filter((rpc) => new RegExp(`(?<!rpc\\()["'\`]${rpc}["'\`]`).test(src))
    assert.ok(hits.length < 6, `${f} names ${hits.length} reason-requiring operations as bare strings -- a second list`)
  }
})

// ------------------------------------------------------------------ CA-M2: identity, branding, venues, teams

import { execFileSync } from "node:child_process"
import { KIT_SWATCHES, kitInputProblem } from "../../../packages/contracts/src/agenda/kit"
import { venueAddressLine, venueInputProblem, venueMapsQuery, EMPTY_VENUE_INPUT, type ClubVenue } from "../../../packages/contracts/src/club/venues"
import { aliasAllowed } from "../../../packages/contracts/src/club/teams"

const ADMIN_SCREENS = walk(ADMIN_ROUTES).filter((f) => /\.tsx$/.test(f))

test("PERSON avatar, CLUB crest and KIT are three identities and no CA-M2 surface confuses them", () => {
  // The crest tile is ClubCrest fed by the club's logo columns; the shirt is RugbyKit fed by club_kits; nobody's avatar is drawn as either.
  const branding = code(join(ADMIN_ROUTES, "branding.tsx"))
  assert.match(branding, /<ClubCrest[^>]*url=\{branding\.crest\.url\}/, "the crest tile draws the club's crest URL")
  assert.match(branding, /<RugbyKit[^>]*kit=\{kit\}/, "the shirt draws the kit config")
  assert.doesNotMatch(branding, /PersonAvatar|avatarUrl|replaceMyAvatar/, "a person's picture never appears on the branding screen")
  assert.doesNotMatch(branding, /<ClubCrest[^>]*kit|<RugbyKit[^>]*crest|url=\{[^}]*kit[^}]*\}/, "a kit is never handed to the crest, nor a crest to the shirt")

  const contracts = code(join(CONTRACTS_CLUB, "branding.ts"))
  assert.match(contracts, /resolveClubLogoPathFrom\(club\.logo_storage_path, club\.club_directory\?\.logo_storage_path\)/, "the crest URL comes from the logo columns only")
  assert.doesNotMatch(contracts, /crest[^\n]*club_kits|club_kits[^\n]*crest/, "the crest is never derived from club_kits")
  assert.match(contracts, /resolveClubTheme\(byVariant\.primary\)/, "colours derive from the home kit through the one theme engine")
  assert.doesNotMatch(contracts, /mobilePrimaryColour|mobileAccentColour|branding_colour/, "no mobile-only colour source")

  // The header (every admin screen's bar) draws the club's crest, never a kit or the person.
  const screen = code(join(ADMIN_SRC, "screen.tsx"))
  assert.match(screen, /<ClubCrest[^>]*url=\{club\.crestUrl\}/)
  assert.doesNotMatch(screen, /RugbyKit|PersonAvatar/)

  for (const f of ADMIN_SCREENS) {
    const src = code(f)
    assert.doesNotMatch(src, /<ClubCrest[^>]*url=\{[^}]*(avatar|kit)[^}]*\}/i, `${f} hands a kit or avatar to the crest`)
  }
})

test("the two protected Ovalball logo files are untouched and untracked", () => {
  const tracked = execFileSync("git", ["ls-files", "public/icons"], { encoding: "utf8" })
  for (const name of ["Ovalball Square Logo.png", "Overball Logo Low Res.png"]) {
    assert.ok(!tracked.includes(name), `${name} must stay untracked`)
    assert.ok(existsSync(join("public/icons", name)), `${name} must still exist on disk`)
  }
})

test("branding: one swatch list and one kit rule for both clients; the kit write is the existing operation", () => {
  assert.equal(KIT_SWATCHES.length, 12)
  assert.match(code("app/(app)/club/kit-section.tsx"), /KIT_SWATCHES/, "the website uses the shared swatches")
  assert.equal(kitInputProblem({ pattern: "HOOPS", primaryColour: "#7a1f3d", secondaryColour: null, accentColour: null }), "That pattern needs a second colour.")
  assert.equal(kitInputProblem({ pattern: "SOLID", primaryColour: "#7a1f3d", secondaryColour: null, accentColour: null }), null)
  assert.equal(kitInputProblem({ pattern: "SOLID", primaryColour: "claret", secondaryColour: null, accentColour: null }), "The first colour needs to be a six-digit colour code.")
  assert.match(code(join(CONTRACTS_CLUB, "branding.ts")), /rpc\("upsert_club_kit"/)
  assert.doesNotMatch(code(join(CONTRACTS_CLUB, "branding.ts")), /from\("club_kits"\)\s*\.\s*(insert|update|upsert|delete)/)
})

test("venues: both clients save through save_club_venue; no client writes venues or club_pitches; no delete anywhere", () => {
  const contracts = code(join(CONTRACTS_CLUB, "venues.ts"))
  assert.match(contracts, /rpc\("save_club_venue"/)
  assert.doesNotMatch(contracts, /from\("(venues|club_pitches)"\)\s*\.\s*(insert|update|upsert|delete)/)
  assert.doesNotMatch(contracts, /delete_venue|delete_club_pitch/, "there is no delete; a venue or pitch is deactivated")
  const webActions = code("app/(app)/club/actions.ts")
  assert.match(webActions, /saveVenueOperation\(/, "the website's venue actions use the shared operation")
  assert.doesNotMatch(webActions, /rpc\("create_venue"|rpc\("update_venue"|rpc\("set_venue_address"/, "the website no longer choreographs create/update + address itself")
  for (const f of ADMIN_SCREENS.filter((f) => f.includes("/venues/"))) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("(venues|club_pitches)"\)\s*\.\s*(insert|update|upsert|delete)/, `${f} writes a table`)
    assert.doesNotMatch(src, /rpc\("/, `${f} calls an operation directly instead of the shared wrapper`)
    assert.doesNotMatch(src, /latitude:|longitude:|p_latitude/, `${f} must not type a pin`)
  }
  assert.match(code(join(ADMIN_ROUTES, "venues/[venueId].tsx")), /Confirm Deactivate/, "deactivation is confirmed")
  assert.match(code(join(ADMIN_ROUTES, "venues/[venueId].tsx")), /useFocusEffect/)

  const v: ClubVenue = { id: "v", name: "Riverside", addressLine1: "1 Mill Lane", addressLine2: null, town: "Ovaltown", county: null, postcode: "BB10 2LS", country: "United Kingdom", directions: null, active: true, isDefaultHome: true, latitude: 53.8, longitude: -2.2, geocodeStatus: "pending" }
  assert.equal(venueAddressLine(v), "1 Mill Lane, Ovaltown, BB10 2LS")
  assert.deepEqual(venueMapsQuery(v), { kind: "query", query: "Riverside, 1 Mill Lane, Ovaltown, BB10 2LS" }, "a pending pin is never offered as coordinates")
  assert.deepEqual(venueMapsQuery({ ...v, geocodeStatus: "success" }), { kind: "coordinates", latitude: 53.8, longitude: -2.2 })
  assert.equal(venueInputProblem(EMPTY_VENUE_INPUT), "A venue name is required.")
})

test("teams: creation is the domain operation by Directory key; identity is never parsed from a name; fold asks the capability", () => {
  const contracts = code(join(CONTRACTS_CLUB, "teams.ts"))
  assert.match(contracts, /rpc\("create_club_team"/)
  assert.match(contracts, /rpc\("fold_team"/)
  assert.doesNotMatch(contracts, /from\("teams"\)\s*\.\s*(insert|update|upsert|delete)/, "the shared module never writes teams")
  const webActions = code("app/(app)/teams/actions.ts")
  assert.match(webActions, /createClubTeam\(/, "the website creates through the operation")
  assert.doesNotMatch(webActions, /from\("teams"\)\s*\.\s*insert/, "the website's direct teams insert is gone")
  const teamPage = code("app/(app)/teams/[teamId].tsx".replace("[teamId].tsx", "[teamId]/page.tsx"))
  assert.match(teamPage, /"team\.lifecycle\.manage"/, "fold/reactivate on the web are gated on the capability the operation asks")
  assert.doesNotMatch(teamPage, /activeManageableClubId\(ctx, activeContext\) === team\.club_id/, "the role-based gate is gone")
  assert.match(code("app/(app)/teams/page.tsx"), /"team\.team\.manage"/, "Add Team on the web is gated on team.team.manage")

  for (const f of ADMIN_SCREENS.filter((f) => f.includes("/teams/"))) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("teams"\)\s*\.\s*(insert|update|upsert|delete)/, `${f} writes teams`)
    assert.doesNotMatch(src, /\b(U6|U7|U8|U9|U1[0-9])\b/, `${f} hard-codes an age grade`)
    assert.doesNotMatch(src, /displayName\.(includes|match|startsWith)|fullLabel\.(includes|match)|\/U\\d|Under \\d/, `${f} derives identity from a name`)
    assert.doesNotMatch(src, /role\s*===?\s*["']CLUB_ADMIN["']|clubRoleKey/, `${f} decides from a role`)
    assert.doesNotMatch(src, /from ["'][^"']*(fixtures|availability|match-centre|messages)|router\.push\([^)]*(fixtures|calendar|messages)/, `${f} must stay configuration, not operations`)
  }
  assert.match(code(join(ADMIN_ROUTES, "teams/[teamId].tsx")), /Confirm Fold/, "folding is confirmed with a reason")
  assert.doesNotMatch(code(join(ADMIN_ROUTES, "teams/[teamId].tsx")), /age_group|ageGroup:\s*[a-z]+\.value|onChangeText=\{[^}]*ageGroup/, "the age grade is not editable on the phone")

  assert.equal(aliasAllowed({ squadDesignation: "B" }), true)
  assert.equal(aliasAllowed({ squadDesignation: "A" }), false)
  assert.equal(aliasAllowed({ squadDesignation: null }), false)
  assert.equal(aliasAllowed({ squadDesignation: "1st" }), false)
})

test("the team catalogue and taxonomy live once, in the shared package", () => {
  assert.match(read("lib/teams/catalog.ts"), /export \* from "@ovalball\/contracts\/teams\/catalog"/)
  assert.match(read("lib/teams/directory-taxonomy.ts"), /export \* from "@ovalball\/contracts\/teams\/directory-taxonomy"/)
  assert.doesNotMatch(code("packages/contracts/src/teams/catalog.ts"), /@\/types|@\/lib/, "the shared catalogue imports nothing from the web")
})
