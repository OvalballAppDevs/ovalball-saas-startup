import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { canOpenGuardiansPlayers, GUARDIANS_PLAYERS_KEYS, guardiansFromDirectory, guardiansPlayersErrorMessage, noGuardiansPlayersCapabilities, replacementInvitationLink, sameAgeGroup, type DirectoryPlayer } from "../../../packages/contracts/src/club/guardians-players"
import { destinationForHref, destinationHref } from "../../../packages/contracts/src/navigation/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"

/**
 * GUARDIANS & PLAYERS ON THE PHONE IS THE WEBSITE'S ADMINISTRATION OVER THE SAME OPERATIONS (CA-M11.1).
 *
 * Structural pins beside the SQL suite (supabase/tests/guardians_players_ca11_1.sql) that proves the
 * authority itself: the shared contract calls exactly the operations the website's server actions
 * call; no mobile club screen reads a date of birth except the SUBMITTED one on a link request or a
 * duplicate review, and never a player's gender value; the Admin Centre section is native and gated
 * on the website's key; every R-class control goes through the confirmed sheet and the step-up path;
 * no role label decides anything; the contract is platform-neutral; and the attention item for
 * players asking to join lands on the native screen through the one resolver.
 */
const MOBILE = "apps/mobile"
const SCREENS = join(MOBILE, "app/(tabs)/admin/guardians")
const CONTRACT = "packages/contracts/src/club/guardians-players.ts"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const read = (path: string) => readFileSync(path, "utf8")
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const screens = walk(SCREENS).filter((f) => /\.tsx$/.test(f))
const rpcNames = (src: string) => Array.from(src.matchAll(/rpc\("([a-z_]+)"/g)).map((m) => m[1])

test("the shared contract calls the operations the website's server actions call, with no operation of its own", () => {
  const contract = code(CONTRACT)
  const webActions = [
    "app/(app)/club/settings/guardians/actions.ts",
    "app/(app)/guardian-requests/actions.ts",
    "app/(app)/club/join-requests/actions.ts",
    "app/(app)/club/player-moves/actions.ts",
    // The rollover action asks a guardian through the shared handover contract; the operation is named there.
    "app/(app)/club/rollover/actions.ts",
    "packages/contracts/src/club/handover.ts",
  ]
  const webRpcs = new Set(webActions.flatMap((f) => rpcNames(code(f))))
  const expected = [
    "approve_guardian_link_request",
    "reject_guardian_link_request",
    "remove_guardian_relationship",
    "send_replacement_guardian_invitation",
    "resolve_player_duplicate_review_as_existing",
    "resolve_player_duplicate_review_as_new",
    "approve_player_club_join_request",
    "decline_player_club_join_request",
    "request_player_call_up",
    "decide_player_call_up",
    "request_player_dispensation",
    "decide_player_dispensation",
    "revoke_player_dispensation",
    "request_player_playing_pathway",
  ]
  for (const rpc of expected) {
    assert.ok(webRpcs.has(rpc), `the website calls ${rpc} from a server action`)
    assert.match(contract, new RegExp(`rpc\\("${rpc}"`), `the shared contract wraps ${rpc}`)
  }
  // The one operation the website has no control for: canonical, granted, and offered natively with a reason.
  assert.match(contract, /rpc\("move_player_team_membership", \{ p_membership_id: membershipId, p_target_team_id: targetTeamId, p_reason: reason\.trim\(\) \|\| undefined \}\)/)
  // Reads converge the website's own reads: the approval queue and the guardian directory are the two operations, nothing else names an email.
  assert.match(contract, /rpc\("guardian_link_requests_for_approval", \{ p_club_id: clubId \}\)/)
  assert.match(contract, /rpc\("get_team_guardian_directory", \{ p_team_id: teamId \}\)/)
  assert.match(contract, /rpc\("my_capabilities", \{ p_scope_type: "club", p_club_id: clubId \}\)/)
  assert.doesNotMatch(contract, /from\("profiles"\)\s*\.select\("[^"]*email/, "a guardian's email is never read from profiles; only the directory operation supplies it")
  // The same arguments the website passes.
  assert.match(code("app/(app)/club/settings/guardians/actions.ts"), /rpc\("remove_guardian_relationship", \{ p_guardian_id: guardianId, p_reason: reason \}\)/)
  assert.match(contract, /rpc\("remove_guardian_relationship", \{ p_guardian_id: guardianId, p_reason: reason\.trim\(\) \}\)/)
  assert.match(contract, /rpc\("approve_player_club_join_request", \{ p_request_id: requestId, p_team_id: teamId \}\)/)
  assert.match(contract, /rpc\("decide_player_dispensation", \{[\s\S]*?p_stage: stage,[\s\S]*?\}\)/)
  // No table is written by any client: the operations are the only writes.
  const all = [contract, ...screens.map(code)].join("\n")
  assert.doesNotMatch(all, /\.from\("[a-z_]+"\)\s*\.\s*(insert|update|upsert|delete)\(/, "no client writes a table in this domain")
  for (const f of screens) assert.doesNotMatch(code(f), /\.rpc\(/, `${f} goes through the shared contract, never an operation directly`)
})

test("the contract is platform-neutral and never imports a client runtime", () => {
  const src = code(CONTRACT)
  assert.doesNotMatch(src, /from "(react|react-native|next\/[a-z-]+|server-only|node:[a-z]+|expo[a-z-]*)"/)
  assert.match(src, /import type \{ Database \} from "\.\.\/database"/)
  assert.match(src, /SupabaseClient<Database>/)
})

test("no mobile club screen reads a date of birth except what was SUBMITTED on a request or review, and never a player's gender value", () => {
  const contract = code(CONTRACT)
  // Only the submitted column, from the two places the website shows it; never players.date_of_birth.
  assert.doesNotMatch(contract, /(?<!submitted_)date_of_birth/, "the contract selects no date_of_birth column except submitted_date_of_birth")
  assert.match(contract, /submitted_date_of_birth/)
  assert.doesNotMatch(contract, /(?<!request_player_)playing_pathway/, "the contract never reads playing_pathway; it may only call request_player_playing_pathway")
  assert.doesNotMatch(contract, /from\("players"\)/, "staff never read players; player_staff_view is the projection")
  assert.match(contract, /loadStaffPlayers\(/)
  for (const f of screens) {
    const src = code(f)
    assert.doesNotMatch(src, /(?<!submitted)date_of_birth|(?<!submitted)DateOfBirth|\bdob\b/i, `${f} shows no date of birth of its own`)
    assert.doesNotMatch(src, /playing_pathway|playingPathway|pathway ===|"MALE"|"FEMALE"/, `${f} never shows or decides a gender value`)
    assert.doesNotMatch(src, /safeguarding_case|welfare|concern/i, `${f} carries no safeguarding narrative`)
  }
  // The one word people see for it is "Gender", and the club may only ask.
  const detail = code(join(SCREENS, "player/[playerId].tsx"))
  assert.match(detail, /label="Gender" value=\{player\.needsGender \? "Not recorded" : "Recorded"\}/)
  assert.match(detail, /askGuardianForGender\(/)
  assert.match(detail, /Ask Guardian for Gender/)
  assert.doesNotMatch(detail, /Playing Pathway|playing pathway/i, "shown to people as Gender, never playing pathway")
})

test("the Admin Centre section is native and gated on the website's own key; the screens draw only from the server's capability read", () => {
  const section = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "guardians")
  assert.ok(section)
  assert.equal(section.native, true)
  assert.equal(section.capability, "family.relationship.approve")
  assert.equal(section.webPath, "/club/settings/guardians")
  assert.ok(existsSync(join(SCREENS, "index.tsx")), "router.push(`/admin/${key}`) has a screen to land on")
  assert.ok(existsSync(join(SCREENS, "_layout.tsx")))
  assert.match(code(join(SCREENS, "_layout.tsx")), /headerShown: false/)
  assert.equal(canOpenGuardiansPlayers({ ...noGuardiansPlayersCapabilities(), relationshipApprove: true }), true)
  assert.equal(canOpenGuardiansPlayers(noGuardiansPlayersCapabilities()), false)
  // The eleven keys are the catalogue's, and nothing is a role label.
  const catalogue = read("supabase/migrations/20270349000000_capability_catalogue_and_bundles.sql")
  for (const key of Object.values(GUARDIANS_PLAYERS_KEYS)) assert.match(catalogue, new RegExp(`\\('${key.replace(/\./g, "\\.")}'`), `${key} is a catalogue key`)
  const access = code(join(MOBILE, "src/admin/guardians-players.ts"))
  assert.match(access, /readGuardiansPlayersCapabilities\(/)
  for (const f of [...screens, join(MOBILE, "src/admin/guardians-players.ts"), CONTRACT]) {
    const src = code(f)
    assert.doesNotMatch(src, /role\s*===?\s*["'](CLUB_ADMIN|Club Admin|club_admin|FIXTURE_SECRETARY|TEAM_MANAGER)["']/i, `${f} branches on a role label`)
    assert.doesNotMatch(src, /\bisClubAdmin\b|\bclubRoleKey\b|roleLabel\s*===?/, `${f} derives authority from a role`)
    assert.doesNotMatch(src, /safeguarding\.officer|SAFEGUARDING_OFFICER/, `${f} never reaches for Safeguarding Officer authority`)
  }
  for (const f of screens.filter((f) => !f.endsWith("_layout.tsx"))) assert.match(code(f), /useFocusEffect/, `${f} re-reads on focus`)
})

test("every R-class control goes through the confirmed sheet and the step-up path, and verification never performs the mutation", () => {
  const rClass: Record<string, RegExp[]> = {
    "link-requests.tsx": [/approveGuardianLinkRequest\(/, /rejectGuardianLinkRequest\(/],
    "player/[playerId].tsx": [/removeGuardianRelationship\(/, /movePlayerTeamPlace\(/, /sendReplacementGuardianInvitation\(/],
    "duplicates.tsx": [/resolveDuplicateAsExisting\(/, /resolveDuplicateAsNew\(/],
    "moves.tsx": [/decideClubCallUp\(/, /decideDispensation\(/, /revokeDispensation\(/],
    "join-requests.tsx": [/approvePlayerJoinRequest\(/, /declinePlayerJoinRequest\(/],
  }
  for (const [file, ops] of Object.entries(rClass)) {
    const src = code(join(SCREENS, file))
    for (const op of ops) assert.match(src, op, `${file} calls the shared wrapper`)
    assert.match(src, /<ReasonSheet/, `${file} confirms through the sheet`)
    assert.match(src, /onStepUp=\{\(reason\) => \{\s*if \(ask\) pending\.hold\(ask, reason\)/, `${file} holds the intent on a recent-auth refusal`)
    assert.match(src, /router\.push\(\{ pathname: "\/step-up", params: \{ returnTo: [`"]\/admin\/guardians\//, `${file} steps up and returns to itself`)
    assert.match(src, /const resume = pending\.take\(\)\s*if \(resume\) setAsk\(resumedAsk\(resume\)\)/, `${file} re-asks on return; the server authorises again`)
    assert.doesNotMatch(src, /onConfirm: async \([^)]*\) => \{\s*\}/, `${file} has no empty confirmation`)
  }
  // Destructive and terminal decisions are confirmed with explicit words; a removal always carries a reason.
  const detail = code(join(SCREENS, "player/[playerId].tsx"))
  assert.match(detail, /confirmLabel: "Remove Guardian",\s*destructive: true,\s*reason: "required"/)
  assert.match(detail, /confirmLabel: "Move to Another Side",\s*reason: "required"/)
  assert.match(code(join(SCREENS, "duplicates.tsx")), /Confirm Same Child/), assert.match(code(join(SCREENS, "duplicates.tsx")), /Confirm Different Child/)
  assert.match(code(join(SCREENS, "moves.tsx")), /confirmLabel: "Revoke", destructive: true, reason: "required"/)
  // The step-up screen performs none of this domain's operations.
  const stepUp = code(join(MOBILE, "app/step-up.tsx"))
  assert.doesNotMatch(stepUp, /approve_guardian_link_request|remove_guardian_relationship|resolve_player_duplicate|decide_player_call_up|decide_player_dispensation|guardians-players/)
  const pending = code(join(MOBILE, "src/admin/pending-intent.ts"))
  assert.doesNotMatch(pending, /AsyncStorage|SecureStore|MMKV/)
})

test("the squad picker is never pre-selected, the replacement link is the website's address and the phone says no email was sent", () => {
  const joins = code(join(SCREENS, "join-requests.tsx"))
  assert.match(joins, /value=\{chosen\[r\.requestId\] \?\? null\}/, "nothing is chosen until somebody chooses it")
  assert.match(joins, /disabled=\{!chosen\[r\.requestId\]\}/, "Accept waits for a side")
  assert.match(joins, /alreadyResolved|Someone else at/, "already resolved is a real answer")
  assert.equal(replacementInvitationLink("https://ovalball.co.uk/", "tok"), "https://ovalball.co.uk/guardian-invite/tok")
  const web = code("app/(app)/club/settings/guardians/actions.ts")
  assert.match(web, /\$\{siteUrl\}\/guardian-invite\/\$\{data\.token\}/, "the same address the website renders")
  const detail = code(join(SCREENS, "player/[playerId].tsx"))
  assert.match(detail, /replacementInvitationLink\(webUrl, result\.token\)/)
  assert.match(detail, /No email was sent from the phone/)
  assert.match(detail, /Copy Link/), assert.match(detail, /Share Link/)
  assert.doesNotMatch(detail, /sendEmailEvent|lib\/email/, "a phone cannot call the server-only email module and does not pretend to")
  // Players are drawn with initials only on club surfaces, as the website's club surfaces draw them.
  for (const f of screens) {
    const src = code(f)
    if (/<PersonAvatar/.test(src)) assert.doesNotMatch(src, /<PersonAvatar[^>]*url=\{(?!null)/, `${f} passes no picture URL for a player or guardian`)
  }
})

test("the attention item for players asking to join lands on the native screen through the one resolver, and the website's addresses resolve natively", () => {
  assert.match(code("packages/contracts/src/attention/club.ts"), /destination: \{ kind: "club_player_join_requests" \}/)
  assert.doesNotMatch(code("packages/contracts/src/attention/club.ts"), /href: "\/club\/join-requests"/)
  assert.deepEqual(destinationForHref("/club/join-requests"), { kind: "club_player_join_requests" })
  assert.equal(destinationHref({ kind: "club_player_join_requests" }), "/club/join-requests")
  const expected: Record<string, string> = {
    "ovalball://club/join-requests": "/admin/guardians/join-requests",
    "ovalball://guardian-requests": "/admin/guardians/link-requests",
    "ovalball://club/settings/guardians": "/admin/guardians",
    "ovalball://club/player-moves": "/admin/guardians/moves",
  }
  for (const [url, pathname] of Object.entries(expected)) {
    const intent = resolveIntent(url)
    assert.equal(intent.kind, "CLUB_GUARDIANS", url)
    assert.equal(routeForIntent(intent)?.pathname, pathname, url)
  }
  // The website's club news address is untouched by the new branch.
  assert.equal(resolveIntent("ovalball://club/some-club/news/some-story").kind, "CLUB_ARTICLE_BY_SLUG")
  assert.match(code(join(MOBILE, "src/attention/routes.ts")), /routeForIntent\(intent\)/)
})

test("the pure rules behave: guardians deduplicate across children, same-age-grade is exact, and the error rule shows only the server's own sentences", () => {
  const player = (overrides: Partial<DirectoryPlayer>): DirectoryPlayer => ({ playerId: "p", name: "P", firstName: "P", ageGrade: "U12", isAdult: false, hasLogin: false, needsGender: false, places: [], guardians: [], needsGuardian: false, ...overrides })
  const g = { guardianId: "g1", guardianUserId: "u1", name: "Ada Adult", email: "ada@x.test", relationshipType: "parent" }
  const rows = guardiansFromDirectory([player({ playerId: "a", name: "A", guardians: [g] }), player({ playerId: "b", name: "B", guardians: [{ ...g, guardianId: "g2" }] })])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].children.map((c) => c.playerId), ["a", "b"])
  assert.equal(sameAgeGroup({ category: "youth", ageGroup: "U12", gender: null }, { category: "youth", ageGroup: "U12", gender: "" }), true)
  assert.equal(sameAgeGroup({ category: "youth", ageGroup: "U12", gender: null }, { category: "youth", ageGroup: "U13", gender: null }), false)
  assert.equal(guardiansPlayersErrorMessage({ code: "42501", message: "You are not authorised to manage Guardian relationships for this player." }, "fallback"), "You are not authorised to manage Guardian relationships for this player.")
  assert.equal(guardiansPlayersErrorMessage({ code: "22023", message: "A reason is required to remove a Guardian relationship." }, "fallback"), "A reason is required to remove a Guardian relationship.")
  assert.equal(guardiansPlayersErrorMessage({ code: "08006", message: "connection lost: driver detail" }, "fallback"), "fallback")
})
