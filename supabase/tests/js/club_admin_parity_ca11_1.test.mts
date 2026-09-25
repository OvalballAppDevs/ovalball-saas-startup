import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { ALL_TABS, HEADER_UTILITIES, projectTabs } from "../../../apps/mobile/src/context/tab-projection"
import { invitationJoinUrl, invitationSecretFromScannedText } from "../../../packages/contracts/src/invitations/share"
import { applyPending, previewPlacement, summarise } from "../../../apps/mobile/src/pitch-allocation/model"
import { DEFAULT_SCHEDULING_POLICY, type AllocationFixture, type PitchAllocationBoard, type PitchOption } from "../../../packages/contracts/src/pitch-allocation"

/**
 * CA-M11.1 -- CLUB ADMIN FUNCTIONAL PARITY RECOVERY: the phone is another first-class client of the
 * same Club Admin product. These pins cover the parts the slice's owner corrections named directly:
 * the bottom bar, Pitch Allocation, invitations (QR, code, link) and the shared-domain rule.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// ------------------------------------------------------------------ bottom navigation

test("the bottom bar is exactly Home / Fixtures / Calendar / Clubhouse / More in every context, with no stray cells", () => {
  // Clubhouse V1 (owner product decision) amends the earlier Rugby Hub lock: Rugby Hub's route,
  // content and safeguarding reach are unchanged -- only its bar cell moved, to More.
  for (const kind of ["club", "team", "family", "parent", "player", "site_admin", "governing", null] as const) {
    assert.deepEqual(projectTabs({ kind }).map((t) => t.label), ["Home", "Fixtures", "Calendar", "Clubhouse", "More"], `context ${kind}`)
  }
  assert.ok(!ALL_TABS.some((t) => HEADER_UTILITIES.includes(t) && projectTabs({ kind: "club" }).some((v) => v.key === t)))
  // THE TWO ARROWS: every route group under the tab folder must be declared as a screen, hidden or not.
  // An undeclared group is auto-registered with the library's "missing icon" glyph -- the arrows.
  const layout = code(join(MOBILE, "app/(tabs)/_layout.tsx"))
  const declared = new Set(Array.from(layout.matchAll(/\{ key: "([a-z-]+)", title:/g)).map((m) => m[1]))
  const groups = readdirSync(join(MOBILE, "app/(tabs)"))
    .filter((name) => name !== "_layout.tsx")
    .map((name) => name.replace(/\.tsx$/, ""))
  for (const group of groups) assert.ok(declared.has(group), `tab route group "${group}" is not declared in the tab layout (it would draw as an arrow)`)
  assert.match(layout, /href: shown\.has\(key\) \? undefined : null/, "undeclared-in-bar screens are hidden, not drawn")
})

// ------------------------------------------------------------------ pitch allocation

test("pitch allocation is one shared domain: the website and the phone read and write through the same package", () => {
  for (const f of ["types", "occupancy", "auto-allocate", "training-conflicts", "tournament-conflicts", "lanes"]) {
    assert.match(code(`lib/pitch-allocation/${f}.ts`), new RegExp(`export \\* from "@ovalball/contracts/pitch-allocation/${f}"`), `${f} is not shared`)
  }
  assert.match(code("app/(app)/calendar/pitch-allocation/data.ts"), /from "@ovalball\/contracts\/pitch-allocation\/board"/, "the web read model is not the shared one")
  const actions = code("app/(app)/calendar/pitch-allocation/actions.ts")
  for (const op of ["allocateFixtureOnPitch", "createAllocationProposal", "readAllocationProposal", "discardAllocationProposal"]) assert.match(actions, new RegExp(op), `web actions do not use ${op}`)
  assert.doesNotMatch(actions, /rpc\("update_fixture_schedule"/, "the web still calls the placement RPC on its own")
  const settings = code("app/(app)/club/settings/pitch-allocation/actions.ts")
  assert.match(settings, /saveSharedSchedulingPolicy\(/)
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /p_source: "PITCH_ALLOCATION"/, "the board's audit fingerprint")
  assert.match(ops, /rpc\("update_fixture_pitch"/, "clearing a pitch uses the canonical single-fixture RPC")
  for (const file of walk("packages/contracts/src/pitch-allocation")) assert.doesNotMatch(read(file), /server-only|from "react|from "next/, `${file} is not platform-neutral`)
})

test("the native board asks the board's own two keys and never fixture edit, result recording or a role", () => {
  const screen = code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx"))
  assert.match(screen, /readPitchAllocationCapabilities\(supabase, clubId\)/)
  assert.doesNotMatch(screen, /fixture\.fixture\.edit|fixture\.result\.record|CLUB_ADMIN|role ===|roleLabel/, "the board infers authority from the wrong thing")
  assert.match(screen, /caps\.manage &&/, "controls are drawn for the manage key only")
  assert.match(screen, /noAccess/, "a person without view or manage is told so")
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /"venue\.pitch_allocation\.view"/)
  assert.match(ops, /"venue\.pitch_allocation\.manage"/)
  const venues = code("packages/contracts/src/club/venues.ts")
  assert.match(venues, /viewAllocation: allowed\.has\("venue\.pitch_allocation\.view"\)/)
  assert.doesNotMatch(code(join(MOBILE, "app/(tabs)/admin/venues/index.tsx")), /calendar\/pitch-allocation`\)/, "the venues screen still hands pitch allocation to the website")
})

test("the phone stages moves and saves them through the same atomic write, one per fixture, with the same conflict detectors", () => {
  const screen = code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx"))
  assert.match(screen, /allocateFixtureOnPitch\(supabase, clubId, fixtureId/, "save goes through the shared operation")
  assert.match(screen, /Save Changes \(\$\{pending\.size\}\)/, "changes are staged before they are saved")
  assert.match(screen, /beforeRemove/, "leaving with staged changes asks first")
  assert.match(screen, /kickoffProposed/, "a proposed kick-off on a shared fixture is reported, not hidden")
  assert.match(screen, /createAllocationProposal\(/)
  assert.match(screen, /conflictSeverity !== "hard"/, "hard-blocked proposal items are never staged")
  const model = code(join(MOBILE, "src/pitch-allocation/model.ts"))
  for (const fn of ["detectConflicts", "detectResourceConflicts", "detectTournamentConflicts", "partitionAllocation", "fixtureOccupiedWindow", "unallocatedReason"]) assert.match(model, new RegExp(fn), `${fn} is not the shared one`)
  assert.doesNotMatch(model, /[-+]\s*(?:\w+\.)*(warmUpMinutes|packUpMinutes)\b/, "the phone recomputes the occupied window itself")
  // a staged move is reflected honestly: two fixtures on one single-lane pitch at the same time clash
  const pitch: PitchOption = { id: "p1", displayName: "Pitch 1", active: true, venueId: "v1", physicalSizeCategory: "full", customLengthM: null, customWidthM: null, layout: "full_only", laneCount: 1 }
  const fixture = (id: string, pitchId: string | null, kickoffTime: string | null): AllocationFixture => ({
    fixtureId: id, homeTeamId: "t" + id, homeTeamLabel: "Under 12 Boys", opponentLabel: "Them", category: "youth", ageGroup: "U12", gender: "boys", status: "Planned",
    kickoffDate: "2026-10-03", kickoffTime, venueId: "v1", pitchId, durationMinutes: 50, durationConfidence: "confirmed", requiredPitchSize: "full", requiresOpponentAgreement: false,
    isSharedGroup: false, schedulingGroupId: null, awaySchedulingGroupId: null, effectiveHomeTeamIds: ["t" + id], effectiveAwayTeamIds: [],
  })
  const board: PitchAllocationBoard = {
    fixtures: [fixture("a", "p1", "10:00:00")], unallocated: [fixture("b", null, null)], pitches: [pitch], policy: { ...DEFAULT_SCHEDULING_POLICY, warmUpMinutes: 15, packUpMinutes: 10 },
    conflicts: [], rugbyCode: "union", tournaments: [], tournamentConflicts: [], trainingSessions: [], trainingConflicts: [], fixtureConflictsFromTraining: [], clubEvents: [], bufferSource: "club",
  }
  assert.equal(summarise(board).needsAttention, 1)
  const clash = previewPlacement(board, new Map(), "b", "p1", "10:30:00")
  assert.equal(clash?.severity, "hard", "an overlapping placement on a single-lane pitch is a clash")
  assert.equal(previewPlacement(board, new Map(), "b", "p1", "12:00:00"), null, "a clear slot is not")
  const staged = applyPending(board, new Map([["b", { pitchId: "p1", kickoffTime: "12:00:00" }]]))
  assert.equal(staged.unallocated.length, 0)
  assert.equal(staged.fixtures.length, 2)
})

// ------------------------------------------------------------------ invitations

test("QR, code and link are one canonical invitation: the QR encodes the join link and nothing else", () => {
  assert.equal(invitationJoinUrl("abc/+=", "https://ovalball.co.uk/"), "https://ovalball.co.uk/join?t=abc%2F%2B%3D")
  const share = code("lib/invitations/share.ts")
  assert.match(share, /sharedJoinUrl\(token, getSiteUrl\(\)\)/, "the website's join URL is not the shared shape")
  const qr = code(join(MOBILE, "src/invitations/qr.tsx"))
  assert.match(qr, /require\("qrcode\/lib\/core\/qrcode"\)/, "the phone does not use the website's encoder")
  const panel = code(join(MOBILE, "src/invitations/share-panel.tsx"))
  assert.match(panel, /<QrCode value=\{share\.url\}/, "the QR must carry the link itself")
  assert.doesNotMatch(panel, /AsyncStorage|SecureStore|console\./, "the share panel stores or logs a secret")
  for (const f of ["src/invitations/invite-staff-sheet.tsx", "src/invitations/share-panel.tsx", "app/scan-invitation.tsx"]) assert.doesNotMatch(code(join(MOBILE, f)), /AsyncStorage|SecureStore|console\./, `${f} persists or logs`)
})

test("the staff invitation collects what the website collects and shows the same triple once; a resend rotates", () => {
  const sheet = code(join(MOBILE, "src/invitations/invite-staff-sheet.tsx"))
  for (const label of ["Email Address", "Their Real-World Role (Optional)", "Club-Wide Role (Optional)", "Team Roles (Optional)"]) assert.ok(sheet.includes(label), `missing ${label}`)
  assert.match(sheet, /inviteClubStaff\(supabase, \{ clubId, email: email\.trim\(\), declaredRole, clubRoles/, "the same RPC inputs as the website")
  assert.match(sheet, /sentTo: null/, "the phone never claims to have emailed")
  const contract = code("packages/contracts/src/club/invitations.ts")
  assert.match(contract, /token: row\?\.token \?\? null/, "the token is returned once")
  assert.match(contract, /declared_role: input\.declaredRole/)
  const people = code(join(MOBILE, "app/(tabs)/admin/people/index.tsx"))
  assert.match(people, /replacesPrevious: true/, "a reissue says the previous link and code stop working")
  assert.doesNotMatch(people, /nothing else changes/, "the old, wrong resend copy")
  const codes = code(join(MOBILE, "app/(tabs)/team/settings/join-codes.tsx"))
  assert.match(codes, /invitationJoinUrl\(result\.token, webUrl\)/, "a team code shows its link (and QR) as the website does")
  const requests = code("packages/contracts/src/team/requests.ts")
  assert.match(requests, /token: row\?\.token \?\? null/)
})

test("the scanner accepts only an Ovalball invitation link and hands it to the same join screen", () => {
  const site = "https://ovalball.co.uk"
  const schemes = ["ovalball", "ovalball-dev"]
  assert.deepEqual(invitationSecretFromScannedText(`${site}/join?t=abc`, site, schemes), { token: "abc", code: null })
  assert.deepEqual(invitationSecretFromScannedText("ovalball-dev://join?c=ABCDE-FGHIJ", site, schemes), { token: null, code: "ABCDE-FGHIJ" })
  assert.equal(invitationSecretFromScannedText("https://evil.example/join?t=abc", site, schemes), null, "another host")
  assert.equal(invitationSecretFromScannedText(`${site}/login?next=/join?t=abc`, site, schemes), null, "another path")
  assert.equal(invitationSecretFromScannedText("ABCDE-FGHIJ", site, schemes), null, "a bare code is typed, not scanned")
  assert.equal(invitationSecretFromScannedText(`${site}/join`, site, schemes), null)
  const scanner = code(join(MOBILE, "app/scan-invitation.tsx"))
  assert.match(scanner, /barcodeTypes: \["qr"\]/)
  assert.match(scanner, /invitationSecretFromScannedText\(data, webUrl, APP_SCHEMES\)/)
  assert.match(scanner, /holdJoinSecret\(secret\)/)
  assert.doesNotMatch(scanner, /Linking\.openURL|WebView/, "a scanned URL is never opened, only interpreted")
  const gate = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(gate, /group === "scan-invitation"/)
  assert.match(code(join(MOBILE, "app.config.ts")), /"expo-camera"/)
})

// ------------------------------------------------------------------ discoverability and isolation

test("the club's jobs are reachable from More behind their canonical capabilities, and a team context gets none of them", () => {
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  const club = more.slice(more.indexOf("{inClub && ("), more.indexOf("{!inFamily && !inClub && ("))
  for (const [label, key] of [["Guardians & Players", "guardians"], ["Subscriptions & Payments", "subscriptions"], ["Season Handover", "rollover"], ["Roles & Permissions", "permissions"]] as const) {
    assert.match(club, new RegExp(`s\\.key === "${key}"\\) && <Row[^\\n]*label="${label.replace(/&/g, "&")}"`), `${label} is not gated on the "${key}" section`)
  }
  assert.match(club, /\(venueCaps\.allocate \|\| venueCaps\.viewAllocation\) && <Row[^\n]*label="Pitch Allocation"/)
  assert.match(club, /\(admin\.sections\.some\(\(s\) => s\.key === "safeguarding"\) \|\| officer\) && <Row[^\n]*label="Safeguarding"/)
  const team = more.slice(more.indexOf("{inTeam && ("), more.indexOf("{inFamily && ("))
  for (const forbidden of ["Guardians & Players", "Subscriptions & Payments", "Season Handover", "Pitch Allocation", "Roles & Permissions", "Safeguarding", "Fixture Control Centre", "Planner", "Import", "Admin Centre"]) {
    assert.ok(!team.includes(`label="${forbidden}"`), `a team context offers ${forbidden}`)
  }
  for (const key of ["guardians", "subscriptions", "rollover", "safeguarding"]) {
    const section = ADMIN_CENTRE_SECTIONS.find((s) => s.key === key)
    assert.ok(section, `${key} section exists`)
    assert.equal(section!.native, true, `${key} is native`)
  }
})
