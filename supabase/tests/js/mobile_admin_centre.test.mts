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
  const webNav = code("app/(app)/club/settings/resolve-nav-capabilities.ts") + code("app/(app)/teams/page.tsx") + code("packages/contracts/src/club/people.ts")
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
    // consulting the shared rule for an operation (reasonRuleFor("...")) is not a list either
    const hits = REASON_REQUIRED_RPCS.filter((rpc) => new RegExp(`(?<!rpc\\(|reasonRuleFor\\()["'\`]${rpc}["'\`]`).test(src))
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

// ------------------------------------------------------------------ CA-M3: people & memberships

import { PEOPLE_FILTERS, personName, reasonRuleFor } from "../../../packages/contracts/src/club/people"

test("people: one read model, one reason list, one avatar resolver, no child data, no permission editor", () => {
  const contracts = code(join(CONTRACTS_CLUB, "people.ts"))
  assert.match(contracts, /rpc\("club_people"/, "the People list reads the shared read model")
  for (const rpc of ["set_primary_club_role", "transition_club_membership", "set_team_access", "remove_team_access", "assign_role", "transition_role_assignment", "decide_club_join_request"]) {
    assert.match(contracts, new RegExp(`rpc\\("${rpc}"`), `the shared module wraps ${rpc}`)
  }
  assert.doesNotMatch(contracts, /set_capability_override|revoke_capability_override|capability_overrides/, "no permission editing lives in People (CA-M4)")
  assert.doesNotMatch(contracts, /from\("(club_memberships|role_assignments|team_permissions|players|guardians)"\)/, "no direct table reads or writes; the read model and the operations only")
  assert.match(contracts, /REASON_REQUIRED_OPERATIONS/, "the reason rule comes from the one shared list")
  assert.equal(reasonRuleFor("transition_club_membership"), "required", "the server requires a reason from anyone acting on another person's membership, so the sheet asks for it up front")
  assert.equal(reasonRuleFor("transition_club_membership", { actingOnSelf: true }), "optional", "the one exception the shared list names: a person acting on their own membership")
  assert.equal(reasonRuleFor("revoke_invitation"), "required")
  assert.equal(reasonRuleFor("set_primary_club_role"), "optional")
  assert.deepEqual(PEOPLE_FILTERS.map((f) => f.key), ["all", "staff", "members", "pending", "suspended"])
  assert.equal(personName({ firstName: "Ada", surname: "Admin", invitationEmail: null }), "Ada Admin")
  assert.equal(personName({ firstName: null, surname: null, invitationEmail: "a…@x.test" }), "a…@x.test")

  // CA-M4 extracted the list row into src/admin/person-row.tsx; the list and its row are read together.
  const list = code(join(ADMIN_ROUTES, "people/index.tsx")) + code(join(ADMIN_SRC, "person-row.tsx"))
  const detail = code(join(ADMIN_ROUTES, "people/[membershipId]/index.tsx"))
  for (const f of [list, detail]) {
    assert.match(f, /resolvePersonalAvatarUrls?\(/, "the person's avatar comes from the canonical personal-avatar resolver")
    assert.match(f, /<PersonAvatar/, "a person is drawn with PersonAvatar")
    assert.doesNotMatch(f, /<ClubCrest|<RugbyKit|clubLogoUrlFromPath|crestUrl/, "a club crest or a kit is never a person's picture")
    assert.doesNotMatch(f, /date_of_birth|dateOfBirth|\bdob\b/i, "no date of birth on a People screen")
    assert.doesNotMatch(f, /guardian_link|safeguarding_case|players\b.*from\(|player_team_memberships/, "no family, child or safeguarding data")
    assert.doesNotMatch(src(f), /role\s*===?\s*["']CLUB_ADMIN["']|clubRoleKey/, "no role branching")
    assert.doesNotMatch(f, /set_capability_override|capability_overrides|Allow|Withhold/, "no permission toggles")
    assert.doesNotMatch(f, /AsyncStorage|queue|retryLater/i, "no offline queue")
    assert.match(f, /useFocusEffect/, "re-reads on focus")
  }
  assert.match(list, /readClubPeople\(supabase, clubId, \{ search: query, filter, limit: PAGE, offset \}\)/, "search, filter and paging are the server's")
  assert.match(detail, /ReasonSheet/, "every membership change goes through the confirmed, reasoned sheet")
  assert.match(detail, /Confirm Suspension|Remove Access/, "destructive actions are confirmed")
  assert.doesNotMatch(detail, /onSwipe|Swipeable/, "no destructive swipe")
  function src(s: string) { return s }
})

test("people on the web: capability gate, shared read model, shared operations with reasons", () => {
  const page = code("app/(app)/people/page.tsx")
  assert.match(page, /readPeopleCapabilities\(/, "the page asks the canonical capabilities")
  assert.match(page, /readClubPeople\(/, "the page lists people from the shared read model")
  assert.doesNotMatch(page, /isClubAdminAnywhere|clubAdminMembershipAt/, "the role-based gate is gone")
  const actions = code("app/(app)/people/actions.ts")
  assert.match(actions, /setPrimaryClubRole\(|transitionMembership\(|removeTeamAccess\(/, "the actions call the shared wrappers")
  assert.doesNotMatch(actions, /rpc\("set_primary_club_role"|rpc\("remove_team_access"/, "the website no longer calls these operations without the shared reason rule")
  const row = code("app/(app)/people/person-row.tsx")
  assert.match(row, /Confirm Suspension/, "suspend and restore reached the web person row")
})

// ---------------------------------------------------------------------------------------------------
// CA-M4 -- Roles & Permissions
// ---------------------------------------------------------------------------------------------------

test("permissions: ROLE is a bundle, a DECISION is a scoped exception, and neither client computes the effective answer", () => {
  const contracts = code(join(CONTRACTS_CLUB, "permissions.ts"))
  // the two canonical operations, and nothing else, write a decision
  assert.match(contracts, /rpc\("set_capability_override"/)
  assert.match(contracts, /rpc\("revoke_capability_override"/)
  assert.match(contracts, /rpc\("apply_capability_preset"/)
  assert.doesNotMatch(contracts, /from\("capability_overrides"\)|from\("bundle_capabilities"\)|from\("role_assignments"\)/, "no direct table reads or writes")
  // the read model is the server's; the contract only reads `effective`
  assert.match(contracts, /rpc\("club_person_permissions"/)
  assert.match(contracts, /rpc\("club_person_permission_scopes"/)
  assert.match(contracts, /rpc\("club_member_capabilities"|rpc\("club_team_capabilities"/)
  assert.doesNotMatch(contracts, /decisiveRule\s*===|reasonCode\s*===\s*"ROLE_BUNDLE"\s*&&/, "no client-side precedence")
  // restore default is a revoke, never an opposite decision
  assert.match(contracts, /export async function restoreDefault[\s\S]*?revoke_capability_override/)
  const screens = adminFiles.filter((f) => /permissions/.test(f)).map(code).join("\n")
  assert.ok(screens.length > 0, "the native permissions screens exist")
  assert.doesNotMatch(screens, /rpc\("set_capability_override"|rpc\("revoke_capability_override"|from\("capability_overrides"\)/, "the app writes only through the shared contract")
  assert.doesNotMatch(screens, /effective\s*=\s*(row\.)?(decision|roleDefault)|effective:\s*!?row\.decision/, "the app never derives `effective` from the decision or the role default")
  assert.match(screens, /readPersonPermissionScopes/, "scope is first-class: the screen asks the server which scopes a decision can name")
  assert.match(screens, /"Use Role Default"|inherit/, "the control has three states")
  assert.match(screens, /roleDefaultSentence|role_default/, "the role default is shown")
})

test("permissions: the editor exposes only the audited keys, shared by both clients, with no raw key in the UI", () => {
  const groups = code(join(CONTRACTS_CLUB, "permission-groups.ts"))
  assert.match(groups, /export const EDITOR_KEYS/)
  for (const key of ["fixture.fixture.create", "fixture.fixture.cancel", "venue.pitch_allocation.manage", "training.plan.manage", "calendar.event.manage"]) {
    assert.match(groups, new RegExp(key.replace(/\./g, "\\.")), `${key} is in the shared groups`)
  }
  for (const key of ["fixture.planner.use", "fixture.fixture.delete", "people.capability.manage", "people.role.assign_club", "people.member.view_contact", "site."]) {
    assert.doesNotMatch(groups, new RegExp(`key: "${key.replace(/\./g, "\\.")}`), `${key} is never offered`)
  }
  assert.ok(!existsSync("app/(app)/club/permissions/groups.ts"), "the web keeps no second copy of the groups")
  assert.ok(!existsSync("lib/permissions/access-explanation.ts"), "the web keeps no second copy of the explanation sentences")
  const web = code("app/(app)/club/permissions/permissions-panel.tsx") + code("app/(app)/club/permissions/page.tsx")
  assert.match(web, /@ovalball\/contracts\/club\/permission/, "the web reads the shared groups and contract")
  assert.doesNotMatch(web, /rpc\("club_member_capabilities"|rpc\("club_team_capabilities"|rpc\("set_capability_override"/, "the web goes through the contract too")
})

test("permissions: R is the server's; both clients carry the same step-up and never perform the intent themselves", () => {
  const webActions = code("app/(app)/club/permissions/actions.ts")
  assert.match(webActions, /guardAction\(\{ recentMinutes: 10 \}/, "the web action asks for a recent authenticator before every decision")
  const peopleActions = code("app/(app)/people/actions.ts")
  assert.match(peopleActions, /export async function setMembershipSuspended[\s\S]*?guardAction\(\{ recentMinutes: 10 \}/)
  assert.match(peopleActions, /export async function revokeMembership[\s\S]*?guardAction\(\{ recentMinutes: 10 \}/)
  const stepUp = code(join(MOBILE, "app/step-up.tsx"))
  assert.match(stepUp, /mfa\.challenge/), assert.match(stepUp, /mfa\.verify/)
  assert.doesNotMatch(stepUp, /set_capability_override|transition_club_membership|decidePermission|restoreDefault/, "the step-up screen performs no pending action")
  const pending = code(join(ADMIN_SRC, "pending-intent.ts"))
  assert.doesNotMatch(pending, /AsyncStorage|localStorage|SecureStore|MMKV/, "the pending intent is memory only")
  const sheets = code(join(ADMIN_SRC, "reason-sheet.tsx")) + code(join(ADMIN_SRC, "decision-sheet.tsx"))
  assert.match(sheets, /isRecentAuthRefusal/, "the sheets recognise the server's refusal rather than a client timestamp")
  assert.doesNotMatch([...adminFiles, join(MOBILE, "app/step-up.tsx")].map(code).join("\n"), /lastMfaAt|mfaVerifiedAt|Date\.now\(\)\s*-\s*\w*(mfa|verified)/i, "no client timestamp stands in for the server's recency")
  const contracts = code(join(CONTRACTS_CLUB, "permissions.ts"))
  assert.equal(/RECENT_AUTH_SENTENCE = "Enter a code from your authenticator to continue\."/.test(contracts), true)
})

test("permissions: Site Admin authority and safeguarding are never in the club product; membership keys are the catalogue's", () => {
  const all = [...adminFiles.map(code), code(join(CONTRACTS_CLUB, "permissions.ts")), code(join(CONTRACTS_CLUB, "people.ts"))].join("\n")
  assert.doesNotMatch(all, /site_set_capability_override|site\.capabilities\.override|site_admins|site_capability_grants/, "no Site Admin authority reaches the Admin Centre")
  assert.doesNotMatch(all, /safeguarding_cases|safeguarding\.welfare|safeguarding_officer_nominate/, "no safeguarding case content")
  const people = code(join(CONTRACTS_CLUB, "people.ts"))
  assert.match(people, /people\.membership\.suspend/), assert.match(people, /people\.membership\.revoke/)
  const person = code(join(ADMIN_ROUTES, "people/[membershipId]/index.tsx"))
  assert.match(person, /canSuspend = !!caps\?\.suspend/), assert.match(person, /canRevoke = !!caps\?\.revoke/)
  const migration = read("supabase/migrations/20270546000000_a_permission_says_what_the_server_enforces.sql")
  assert.match(migration, /club_membership_authority\(v_club, 'people\.membership\.suspend'\)/)
  assert.match(migration, /club_membership_authority\(v_club, 'people\.membership\.revoke'\)/)
  assert.match(migration, /internal\.can\('fixture\.fixture\.cancel'/)
  assert.match(migration, /require_recent_aal2\(interval '10 minutes'\)/)
  const sections = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "permissions")
  assert.equal(sections?.native, true), assert.equal(sections?.capability, "people.capability.manage")
})

// ---------------------------------------------------------------------------------------------------
// CA-M5 -- News & Announcements
// ---------------------------------------------------------------------------------------------------

const walkIfExists = (dir: string) => (existsSync(dir) ? walk(dir).filter((f) => /\.tsx?$/.test(f)) : [])
const READER = [...walkIfExists(join(MOBILE, "app/(tabs)/news")), ...walkIfExists(join(MOBILE, "app/(tabs)/announcements")), ...walkIfExists(join(MOBILE, "src/content"))]
const PUBLISHER = [...walkIfExists(join(MOBILE, "app/(tabs)/admin/news")), ...walkIfExists(join(MOBILE, "src/admin/content"))]

test("news: one publishing domain -- both clients read the tables through the shared contract and write through the website's own operations", () => {
  const contracts = code(join(CONTRACTS_CLUB, "content.ts"))
  for (const rpc of ["save_club_article", "save_club_announcement", "set_club_article_status", "set_club_announcement_status", "set_club_article_featured", "club_publishing_scopes"]) {
    assert.match(contracts, new RegExp(`rpc\\("${rpc}"`), `the shared contract wraps ${rpc}`)
  }
  assert.match(contracts, /\.eq\("status", "PUBLISHED"\)/, "every reader asks for PUBLISHED explicitly; PUBLIC vs MEMBERS is left to RLS")
  assert.doesNotMatch(contracts, /visibility\.eq|\.eq\("visibility"/, "no client narrows the audience itself")
  assert.ok(READER.length >= 5, "the native reader exists")
  assert.ok(PUBLISHER.length >= 3, "the native publisher exists")
  const all = [...READER, ...PUBLISHER].map(code).join("\n")
  assert.doesNotMatch(all, /rpc\("save_club_article"|rpc\("save_club_announcement"|rpc\("set_club_|from\("club_articles"\)|from\("club_announcements"\)/, "the app never writes or reads the tables directly")
  assert.doesNotMatch(all, /WebView|dangerouslySetInnerHTML|innerHTML/, "no WebView and no HTML for Ovalball-owned content")
  assert.doesNotMatch(all, /AsyncStorage|SecureStore|MMKV/, "no mobile-only publishing store, no offline queue")
  assert.doesNotMatch(all, /service_role|SUPABASE_SERVICE/, "no service-role credential")
  // the web reads and writes through the same contract
  const webManage = code("lib/club-content/manage.ts") + code("lib/club-content/actions.ts")
  assert.match(webManage, /@ovalball\/contracts\/club\/content/)
  assert.doesNotMatch(code("lib/club-content/actions.ts"), /rpc\("save_club_article"|rpc\("save_club_announcement"|rpc\("set_club_/, "the web actions go through the contract too")
})

test("news: the audience picker is built from the server's scopes and nothing else; the renderer is the shared markup tree", () => {
  const publisher = PUBLISHER.map(code).join("\n")
  assert.match(publisher, /readPublishingScopes/, "the composer asks the server where this person may publish")
  assert.doesNotMatch(publisher, /role\s*===?\s*["']CLUB_ADMIN["']|role_key|clubRoleKey|isClubAdmin/, "no role label decides an audience")
  assert.doesNotMatch(publisher, /setTimeout\([^)]*publish|setInterval/, "no client timer publishes anything; the window is the server's")
  const reader = READER.map(code).join("\n")
  assert.match(reader, /parseArticleBody/, "the body is rendered from the shared parser")
  assert.match(reader, /readPublishedArticle\(|readPublishedArticleBySlug\(/), assert.match(reader, /readLiveAnnouncement\(/)
  assert.doesNotMatch(reader, /mark_announcement_read|read_receipt|readAt/, "no read receipts were invented")
  assert.doesNotMatch(reader, /reply|Reply Privately|Message Author|Contact Coach/, "reading creates no communication route")
  const sections = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "news")
  assert.equal(sections?.native, true), assert.equal(sections?.capability, "club.news.manage")
  const home = code(join(MOBILE, "app/(tabs)/index.tsx"))
  assert.doesNotMatch(home, /\/news\/\$\{[^}]*slug\}|club\/\$\{summary\.clubSlug[^}]*\}\/news/, "Home no longer hands club content to the browser")
})

test("news: one reading projection -- Home and the index ask readFeed with the context's scope; the client decides where to ask, the server what may be seen", () => {
  const homeData = code(join(MOBILE, "src/context/home-data.ts"))
  const index = code(join(MOBILE, "app/(tabs)/news/index.tsx"))
  for (const [name, src] of [["Home", homeData], ["the index", index]] as const) {
    assert.match(src, /readingScopeFor\(/, `${name} resolves where to ask through the shared rule`)
    assert.match(src, /readFeed\(/, `${name} reads through the one projection`)
    assert.doesNotMatch(src, /guardianRelationships\.map|guardianRelationships\)\.filter/, `${name} does not derive clubs on its own`)
  }
  const contracts = code(join(CONTRACTS_CLUB, "content.ts"))
  assert.match(contracts, /case "family":[\s\S]*?guardianRelationships[\s\S]*?linkedPlayerTeams/, "a family asks the clubs its children and the person's own player record play at")
  assert.match(contracts, /case "site_admin"|default:\s*\n\s*return \{ kind: active\.kind, clubs: \[\]/, "site admin and governing ask nothing: no all-content feed")
  assert.match(contracts, /seenA\.has\(a\.id\)|!seenA\.has/, "the merge deduplicates by publication id")
  assert.doesNotMatch(contracts, /\.eq\("visibility"|visibility\.eq/, "no client narrows the audience")
})
