import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { SAFEGUARDING_CLUB_KEYS, SAFEGUARDING_OFFICER_KEYS, SAFEGUARDING_SELF_KEYS, noSafeguardingAccess, safeguardingJoinUrl } from "../../../packages/contracts/src/club/safeguarding"
import { notificationHref } from "../../../packages/contracts/src/notifications/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"

/**
 * CA-M11.1 -- SAFEGUARDING ON THE PHONE: the website's Safeguarding Officer product over the same
 * operations and the same authority, with nothing invented and nothing widened.
 */
const MOBILE = "apps/mobile"
const CONTRACT = "packages/contracts/src/club/safeguarding.ts"
const WEB_ACTIONS = "app/(app)/club/settings/safeguarding/actions.ts"
const WEB_PAGE = "app/(app)/club/settings/safeguarding/page.tsx"
const WEB_APPOINTMENTS = "lib/safeguarding/club-appointments.ts"
const CATALOGUE = "supabase/migrations/20270349000000_capability_catalogue_and_bundles.sql"
const SCREENS = join(MOBILE, "app/(tabs)/admin/safeguarding")
const HOOK = join(MOBILE, "src/safeguarding/access.ts")

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const mobileSafeguardingFiles = () => [...walk(SCREENS), HOOK].filter((f) => /\.tsx?$/.test(f))

test("the contract calls the same server operations the website does, and no other", () => {
  const contract = code(CONTRACT)
  const web = code(WEB_ACTIONS) + code(WEB_PAGE) + code(WEB_APPOINTMENTS)
  const shared = [
    "get_club_safeguarding_officers",
    "get_club_member_directory",
    "nominate_club_safeguarding_officer",
    "nominate_safeguarding_officer",
    "update_safeguarding_officer_contact",
    "invite_safeguarding_officer",
    "resend_safeguarding_officer_invitation",
    "revoke_safeguarding_officer_invitation",
    "deactivate_safeguarding_officer",
    "start_or_get_safeguarding_officer_conversation",
    "send_safeguarding_officer_message",
  ]
  for (const rpc of shared) {
    assert.match(contract, new RegExp(`rpc\\("${rpc}"`), `the contract wraps ${rpc}`)
    assert.match(web, new RegExp(`rpc\\("${rpc}"`), `the website calls ${rpc} too`)
  }
  // The officer's reads exist on the server and have no website page; the phone reads them as they are.
  for (const rpc of ["welfare_member_view", "club_message_reports", "my_capabilities"]) assert.match(contract, new RegExp(`rpc\\("${rpc}"`), `the contract reads ${rpc}`)
  // The canonical invitation architecture, for the open invitation and its withdrawal.
  assert.match(contract, /from\("invitations_admin_view"\)/)
  assert.match(contract, /rpc\("revoke_invitation"/)
  // The same appointment read the website makes -- and the same filter, which is a record type, not a decision.
  assert.match(contract, /\.eq\("role_key", "SAFEGUARDING_OFFICER"\)/)
  assert.match(code(WEB_APPOINTMENTS), /\.eq\("role_key", "SAFEGUARDING_OFFICER"\)/)
  // Nothing invented: no case domain, no notes, no email, no site authority.
  assert.doesNotMatch(contract, /safeguarding_(case|concern|incident|note)|allegation|evidence/i, "no case domain is read or written")
  assert.doesNotMatch(contract, /sendEmailEvent|nodemailer|resend\.com|lib\/email/, "no email leaves the phone")
  assert.doesNotMatch(contract, /site_set_capability_override|set_capability_override|revoke_capability_override|confirm_safeguarding_officer|site_safeguarding_review|mark_message_report_reviewed|resolve_message_report/, "no Site authority is offered from the phone")
  assert.doesNotMatch(contract, /decision_reason/, "the dispensation's decision narrative is never selected")
  assert.doesNotMatch(contract, /notifications|notify_/, "no notification is emitted or added")
  assert.doesNotMatch(contract, /from ["']react|from ["']next|server-only|node:/, "platform-neutral")
})

test("no role label decides anything: capability keys through my_capabilities, on both sides", () => {
  const contract = code(CONTRACT)
  const occurrences = (contract.match(/"SAFEGUARDING_OFFICER"/g) ?? []).length
  const readFilters = (contract.match(/\.eq\("(role_key|kind)", "SAFEGUARDING_OFFICER"\)/g) ?? []).length
  assert.equal(occurrences, readFilters, "the role label appears only as a read filter on a record, never in a decision")
  assert.equal(readFilters, 2, "the appointment read and the open-invitation read, exactly")
  assert.doesNotMatch(contract, /CLUB_ADMIN|role\s*===?\s*["']|roleLabel|clubRoleKey|admin_role|is_site_admin/, "no role name decides anything in the contract")
  for (const f of mobileSafeguardingFiles()) {
    const src = code(f)
    assert.doesNotMatch(src, /SAFEGUARDING_OFFICER|CLUB_ADMIN|role\s*===?\s*["']|roleLabel|clubRoleKey/, `${f} decides nothing from a role label`)
    assert.doesNotMatch(src, /from\("role_assignments"\)|from\("club_memberships"\)|from\("site_admins"\)/, `${f} reads no authority table directly`)
  }
  assert.equal((contract.match(/rpc\("my_capabilities", \{ p_scope_type: "club"/g) ?? []).length, 1, "one club-scope probe")
  assert.equal((contract.match(/rpc\("my_capabilities", \{ p_scope_type: "self"/g) ?? []).length, 1, "one self-scope probe, for the officer's own card")
  const hook = code(HOOK)
  assert.match(hook, /readSafeguardingAccess\(supabase, clubId\)/)
  assert.match(hook, /isOfficer: resolved\.anyOfficer/)
  assert.match(hook, /useFocusEffect/, "re-asked on focus")
  assert.match(hook, /active\?\.kind === "club" \? \(active\.clubId \?\? active\.id\) : null/, "the active club, from the shared context")
})

test("the Admin Centre section is native and gated on the Club Admin's nomination key alone", () => {
  const section = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "safeguarding")
  assert.ok(section, "the section exists")
  assert.equal(section?.native, true)
  assert.equal(section?.capability, SAFEGUARDING_CLUB_KEYS.nominate)
  assert.equal(section?.capability, "safeguarding.officer.nominate")
  assert.equal(section?.webPath, "/club/settings/safeguarding")
  assert.ok(statSync(join(SCREENS, "index.tsx")).isFile(), "the folder is named after the section key so router.push(`/admin/${key}`) lands on it")
  assert.match(code(join(SCREENS, "_layout.tsx")), /<Stack screenOptions=\{\{ headerShown: false \}\} \/>/)
  const index = code(join(SCREENS, "index.tsx"))
  assert.match(index, /useSafeguardingOfficerAccess\(\)/)
  assert.match(index, /access\.nominate && \(!state\.hasPrimary \|\| !state\.hasDeputy\)/, "nominating is offered on the club's key only")
  assert.match(index, /access\.deactivate && <Button label="Remove Assignment"/, "ending the assignment is offered on its own key")
  assert.match(index, /access\.conversationStart/, "messaging the officer is offered on its own key")
  assert.match(index, /access\.anyOfficer/, "the officer's sections exist only on the officer's keys")
  assert.match(index, /returnTo: RETURN_TO/), assert.match(index, /const RETURN_TO = "\/admin\/safeguarding"/)
  assert.match(index, /onStepUp=/, "an R-class refusal steps up and resumes rather than failing")
  assert.match(index, /resumedAsk\(resume\)/)
})

test("the officer keys are the catalogue's SO bundle, asked of my_capabilities, and open only what the server can read", () => {
  const catalogue = read(CATALOGUE)
  for (const key of Object.values(SAFEGUARDING_OFFICER_KEYS)) {
    assert.match(catalogue, new RegExp(`\\('SO', '${key.replace(/\./g, "\\.")}', 'club'\\)`), `${key} is in the SO bundle at club scope`)
  }
  assert.match(catalogue, new RegExp(`\\('SO', '${SAFEGUARDING_SELF_KEYS.contactEdit.replace(/\./g, "\\.")}', 'self'\\)`))
  for (const key of Object.values(SAFEGUARDING_CLUB_KEYS)) assert.match(catalogue, new RegExp(`\\('CA', '${key.replace(/\./g, "\\.")}', 'club'\\)`), `${key} is the Club Admin's`)
  assert.doesNotMatch(catalogue, /\('SO', 'safeguarding\.officer\.nominate'/, "the officer bundle never carries the club's nomination key")
  const none = noSafeguardingAccess()
  assert.equal(none.anyOfficer, false)
  assert.equal(Object.values(none.officer).some(Boolean), false)
  const index = code(join(SCREENS, "index.tsx"))
  assert.match(index, /access\.officer\.conversationHandle/), assert.match(index, /access\.officer\.dispensationView/)
  assert.match(index, /access\.officer\.welfareView/), assert.match(index, /access\.officer\.moderationReview/)
  assert.doesNotMatch(index, /access\.officer\.transferView/, "transfer.view has no server read behind it, so it opens nothing")
  for (const f of mobileSafeguardingFiles()) {
    assert.doesNotMatch(code(f), /safeguarding\.[a-z_]+\.[a-z_]+|messaging\.moderation/, `${f} names no capability key literally -- keys live in the contract`)
  }
  // The read-only officer screens offer no decision: nothing on the server lets an officer decide.
  const dispensations = code(join(SCREENS, "dispensations.tsx"))
  const reports = code(join(SCREENS, "reports.tsx"))
  assert.doesNotMatch(dispensations + reports, /decide_player_dispensation|revoke_player_dispensation|mark_message_report_reviewed|resolve_message_report|<Button /, "read-only")
})

test("no email leaves the phone: the invitation link is built once, shown once and never stored", () => {
  assert.equal(safeguardingJoinUrl("https://ovalball.app/", "a b"), "https://ovalball.app/join?t=a%20b")
  assert.equal(safeguardingJoinUrl("https://ovalball.app", "t0k3n"), "https://ovalball.app/join?t=t0k3n")
  const index = code(join(SCREENS, "index.tsx"))
  assert.match(index, /No email was sent from the phone/)
  assert.match(index, /No email is sent from the phone/)
  assert.match(index, /Clipboard\.setStringAsync\(link\.joinUrl\)/), assert.match(index, /Share\.share\(\{ message: link\.joinUrl \}\)/)
  assert.match(index, /This link is shown once/)
  for (const f of mobileSafeguardingFiles()) assert.doesNotMatch(code(f), /AsyncStorage|SecureStore|MMKV|localStorage/, `${f} stores nothing`)
  const contract = code(CONTRACT)
  assert.match(contract, /if \(error\.code === "22023"\) return \{ mode: "no-account" \}/, "only the website's own fallback condition becomes the phone's no-account answer")
  assert.match(contract, /throw error\n\}/, "every other refusal is thrown as a refusal")
  assert.match(index, /no Ovalball conversation was opened and nothing was sent/)
})

test("nothing safeguarding is projected onto Club Home, the attention system, or any generic row", () => {
  for (const f of [join(MOBILE, "src/club/home.tsx"), ...walk(join(MOBILE, "src/attention")), join(MOBILE, "app/(tabs)/admin/index.tsx")]) {
    assert.doesNotMatch(code(f), /safeguard|dispensation|welfare|message_reports/i, `${f} carries nothing safeguarding`)
  }
  const index = code(join(SCREENS, "index.tsx"))
  assert.doesNotMatch(index, /\{[a-z]+\.length\}\s*(open|pending|report|conversation)/i, "no counts")
  assert.doesNotMatch(index, /badge|urgent|alert!|🚨|⚠️/i, "no sensational labels")
})

test("no notification was added, the four officer-facing types keep their catalogued destination, and the phone lands them natively", () => {
  for (const type of ["safeguarding_officer_confirmed", "safeguarding_thread_reviewed", "safeguarding_threads_transferred", "safeguarding_threads_unattended"]) {
    assert.equal(notificationHref(type, { club_id: "c", assignment_id: "a", conversation_id: "x" }), "/club/settings/safeguarding")
  }
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://club/settings/safeguarding")), { pathname: "/admin/safeguarding" })
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://club/settings/safeguarding/messages/abc")), { pathname: "/admin/safeguarding/threads/[conversationId]", params: { conversationId: "abc" } })
  assert.equal(resolveIntent("ovalball://club/settings/guardians/xyz").kind === "SAFEGUARDING", false, "only the exact safeguarding shapes")
  const migrations = readdirSync("supabase/migrations")
  assert.ok(!migrations.some((m) => /ca11_1|ca-m11-1|safeguarding_mobile/i.test(m)), "CA-M11.1 adds no migration")
})

test("the thread reader mirrors the website's: same data, same boundary, ownership colours kept", () => {
  const thread = code(join(SCREENS, "threads/[conversationId].tsx"))
  assert.match(thread, /readSafeguardingThread\(supabase, id\)/)
  assert.match(thread, /sendSafeguardingThreadMessage\(supabase, id, body\)/)
  assert.match(thread, /mine \? colour\.messengerBlue : colour\.mint100/, "blue for mine, mint for received")
  assert.match(thread, /Reviewed by Ovalball on/)
  const contract = code(CONTRACT)
  assert.match(contract, /from\("fixture_messages"\)\s*\.select\("id, sender_user_id, body, created_at"\)\s*\.eq\("safeguarding_conversation_id", conversationId\)/, "the body is read only for one conversation, exactly as the website's page selects it")
  assert.match(contract, /select\("safeguarding_conversation_id, created_at"\)/, "the list reads activity, never content")
  const list = code(join(SCREENS, "threads/index.tsx"))
  assert.doesNotMatch(list, /messageBody|\.messages\b/, "the list shows no line of content")
  assert.doesNotMatch(list.replace(/type\.body/g, ""), /\.body\b/, "the only .body on the list screen is the type token")
})
