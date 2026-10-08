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
  // Pitch placement is pitch-allocation authority, not fixture editing (20270762000000, H5): clearing goes
  // through the allocation-only RPC, and the shared operations never reach the fixture-edit pitch path.
  assert.match(ops, /rpc\("allocate_fixture_pitch"/, "clearing a pitch uses the allocation-only RPC")
  assert.doesNotMatch(ops, /rpc\("update_fixture_pitch"/, "pitch placement never goes through the fixture-edit path")
  for (const file of walk("packages/contracts/src/pitch-allocation")) assert.doesNotMatch(read(file), /server-only|from "react|from "next/, `${file} is not platform-neutral`)
})

test("the native board asks the board's own two keys and never fixture edit, result recording or a role", () => {
  // The board is Arena Planning's Pitches view now; the old route only forwards to it.
  assert.match(code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx")), /<Redirect href=\{\{ pathname: "\/admin\/arena\/planning"/, "the old route forwards to Arena Planning")
  // ARENA PLANNING REBUILD (Day / Pitches): the board no longer reads the old board's capability pair on its own
  // (src/arena/pitch-board-panel.tsx is retired). Its authority is the day's: get_arena_day says canManage, which
  // the server derives from the same key (internal.arena_can_manage = venue.pitch_allocation.manage), and a person
  // with neither key is refused the day itself (42501) and told so. Same keys, one source -- not a weaker check.
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  // CONNECTED PLANNER (2026-10-05): the Pitches and Changing Rooms boards share one kit (planner/board-kit.tsx) --
  // the lift, the headers, the state words -- so the board's pins read the board and its kit together.
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx")) + code(join(MOBILE, "src/arena/planner/board-kit.tsx"))
  assert.match(screen, /<PitchBoard[\s\S]{0,200}canManage=\{day\.canManage\}/, "the board's controls come from the server's own answer for this day")
  for (const f of [screen, board, code(join(MOBILE, "src/arena/planner/use-day-planner.ts")), code(join(MOBILE, "src/arena/planner/allocation-sheet.tsx"))]) {
    assert.doesNotMatch(f, /fixture\.fixture\.edit|fixture\.result\.record|CLUB_ADMIN|role ===|roleLabel/, "the board infers authority from the wrong thing")
  }
  assert.match(board, /Gesture\.Pan\(\)\s*\.enabled\(canManage\)/, "nothing on the board can be lifted without the manage key")
  assert.match(screen, /forbidden: code === "42501"/, "a person without view or manage is told so")
  const arena = read("supabase/migrations/20270738000000_arena_plans_the_estate.sql")
  assert.match(arena, /function internal\.arena_can_manage[\s\S]{0,400}internal\.can\('venue\.pitch_allocation\.manage'/, "Arena's manage is the board's own key")
  assert.match(arena, /function internal\.arena_can_view[\s\S]{0,400}internal\.can\('venue\.pitch_allocation\.view'/, "and its view the board's view key")
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /"venue\.pitch_allocation\.view"/)
  assert.match(ops, /"venue\.pitch_allocation\.manage"/)
  const venues = code("packages/contracts/src/club/venues.ts")
  assert.match(venues, /viewAllocation: allowed\.has\("venue\.pitch_allocation\.view"\)/)
  assert.doesNotMatch(code(join(MOBILE, "app/(tabs)/admin/venues/index.tsx")), /calendar\/pitch-allocation`\)/, "the venues screen still hands pitch allocation to the website")
})

test("the phone stages moves and saves them as ONE plan the server checks whole, with the same conflict detectors", () => {
  // ARENA PLANNING REBUILD (Day / Pitches): the drag, the Allocate sheet and Auto Allocate's proposal now stage
  // into ONE day plan (src/arena/planner/) instead of three pipelines, and Save sends it as one transaction --
  // these pins follow the guarantees from the retired panel to where they now live.
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  const plan = code(join(MOBILE, "src/arena/planner/plan.ts"))
  const bar = code(join(MOBILE, "src/arena/planner/plan-bar.tsx"))
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  // Arena: every staged move goes to the server as one plan, through the canonical writers, checked once
  // as a whole arrangement by the one engine -- so two fixtures can swap pitches, and nothing half-applies.
  assert.match(planner, /applyArenaAllocation\(supabase, clubId, day\.date, toArenaChanges\(plan\), "MANUAL"\)/, "save goes through the one Arena apply")
  assert.match(plan, /expected\[k\] = saved\[k\] \?\? null/, "each change names what it expects, so nobody's change is applied over")
  // DAY / PITCHES REFINEMENT: one verb for saving, said the same everywhere -- "Save Change", "Save 3 Changes", or
  // "Apply Plan" when every change is Ovalball's proposal -- from one function the bar and the leave sheet share.
  const words = code(join(MOBILE, "src/arena/planner/words.ts"))
  assert.match(bar, /saveWords\(counts\.total, counts\.auto\)/, "the bar says it in the shared words")
  assert.match(words, /action: total === 1 \? "Save Change" : `Save \$\{total\} Changes`/, "changes are staged before they are saved")
  assert.match(words, /auto === total\) return \{ status: [^}]*action: "Apply Plan" \}/, "and Ovalball's own proposal is applied, in its own words")
  assert.match(screen, /beforeRemove/, "leaving with staged changes asks first")
  assert.match(planner, /kickoffProposed/, "a proposed kick-off on a shared fixture is reported, not hidden")
  assert.match(bar, /Nothing was saved, and your changes are still staged/, "a refused plan keeps every staged change and says so")
  // Automatic allocation is the server's (preview, then Apply), never a client proposal.
  assert.match(planner, /previewArenaAllocation\(supabase, clubId, day\.date, \{ venueId, rerun \}\)/, "Auto Allocate previews on the server")
  assert.match(planner, /stage\(next, a, \{ \.\.\.item\.proposed \}, "AUTO", item\.explanation\)/, "its proposal is staged as Auto Allocate's own")
  assert.match(plan, /source: c\.origin/, "and applied as AUTO, so a lock still binds it")
  const sheets = code(join(MOBILE, "src/arena/sheets.tsx"))
  assert.match(sheets, /Re-run Auto Allocation/, "Recalculate All is now Re-run Auto Allocation")
  assert.match(sheets, /Recalculate unlocked allocations using current facility availability and team preferences/, "and says what it does")
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

// PEOPLE & INVITATIONS (2026-10-05): the invitation sheet, the share panel and the Joining Pass were three
// pieces of one job and are now the one sharing layer -- src/sharing/qr.tsx (the encoder), share-view.tsx (link,
// code, QR and the five doors), poster.tsx (the picture, generalised from the Joining Pass) -- and the one
// invitation flow, src/people/invite-flow.tsx. Every guarantee the old pins held is pinned again here.
const SHARING = join(MOBILE, "src/sharing")

test("QR, code and link are one canonical invitation: the QR encodes the join link and nothing else", () => {
  assert.equal(invitationJoinUrl("abc/+=", "https://ovalball.co.uk/"), "https://ovalball.co.uk/join?t=abc%2F%2B%3D")
  const share = code("lib/invitations/share.ts")
  assert.match(share, /sharedJoinUrl\(token, getSiteUrl\(\)\)/, "the website's join URL is not the shared shape")
  const qr = code(join(SHARING, "qr.tsx"))
  assert.match(qr, /require\("qrcode\/lib\/core\/qrcode"\)/, "the phone does not use the website's encoder")
  const view = code(join(SHARING, "share-view.tsx"))
  assert.match(view, /<QrCode value=\{share\.url\}/, "the QR must carry the link itself")
  const actions = code(join(SHARING, "share-actions.tsx"))
  assert.match(actions, /whatsappShareUrl\(message\)/, "WhatsApp carries the same message and link")
  assert.match(actions, /setStringAsync\(url\)/, "Copy Link copies the same link")
  for (const f of [join(SHARING, "share-view.tsx"), join(SHARING, "share-actions.tsx"), join(MOBILE, "src/people/invite-flow.tsx"), join(MOBILE, "app/scan-invitation.tsx")]) {
    assert.doesNotMatch(code(f), /AsyncStorage|SecureStore|console\./, `${f} persists or logs`)
  }
})

test("the staff invitation collects what the website collects and shows the same triple once; a resend rotates", () => {
  const flow = code(join(MOBILE, "src/people/invite-flow.tsx"))
  for (const label of ["Email Address", "Their Role at the Club (Optional)", "Club Access", "Team Roles (Optional)"]) assert.ok(flow.includes(label), `missing ${label}`)
  assert.match(flow, /inviteClubStaff\(supabase, \{\s*clubId,\s*email: email\.trim\(\),/, "the same RPC inputs as the website")
  assert.match(flow, /sentTo: null/, "the phone never claims to have emailed")
  assert.match(flow, /replacesPrevious: true/, "a reissue says the previous link and code stop working")
  const contract = code("packages/contracts/src/club/invitations.ts")
  assert.match(contract, /token: row\?\.token \?\? null/, "the token is returned once")
  assert.match(contract, /declared_role: input\.declaredRole/)
  const people = code(join(MOBILE, "app/(tabs)/admin/people/index.tsx"))
  assert.match(people, /replacesPrevious: true/, "a reissue from People says the previous link and code stop working")
  assert.doesNotMatch(people, /nothing else changes/, "the old, wrong resend copy")
  const codes = code(join(MOBILE, "app/(tabs)/team/settings/join-codes.tsx"))
  assert.match(codes, /invitationJoinUrl\(result\.token, webUrl\)/, "a team code shows its link (and QR) as the website does")
  const requests = code("packages/contracts/src/team/requests.ts")
  assert.match(requests, /token: row\?\.token \?\? null/)
})

test("a poster is the same link as one picture: the link's QR from the one encoder, nothing kept, nothing issued", () => {
  const poster = code(join(SHARING, "poster.tsx"))
  assert.match(poster, /qrModules\(share\.url\)/, "the poster's QR must carry the link itself, never a payload of its own")
  assert.match(code(join(SHARING, "qr.tsx")), /export function qrModules/, "one encoder for the screen and the picture")
  assert.match(poster, /const quiet = 4/, "the symbol keeps its four-module quiet zone on white")
  assert.doesNotMatch(poster, /AsyncStorage|SecureStore|console\.|\.rpc\(/, "the poster stores, logs or issues nothing")
  assert.doesNotMatch(poster, /sentTo|email/i, "an address never goes on a picture that travels")
  assert.match(poster, /finally \{\s*if \(target\.exists\) target\.delete\(\)/, "the picture can carry a credential; the phone keeps no copy after sharing")
  // ONE COMPOSITION, NOT THREE RENDERERS: invitation, team joining link and referral are variants of one layout.
  const layout = code(join(SHARING, "poster-layout.ts"))
  assert.match(layout, /export type PosterVariant = "INVITATION" \| "TEAM_JOIN" \| "REFERRAL"/)
  assert.equal([...readdirSync(join(MOBILE, "src")).filter((d) => d === "invitations")].length, 0, "the old sheet, panel and pass are gone")
  // A reissued credential is shown in the page: in a second modal opened over the closing confirmation it was
  // dismissed with it, and the new link and code -- shown once -- were never seen.
  const people = code(join(MOBILE, "app/(tabs)/admin/people/index.tsx"))
  assert.doesNotMatch(people, /<Modal visible=\{reissued/, "the reissued credential must not open in a second modal")
  assert.match(people, /\{reissued && \(/)
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
  // Opened with its origin, so Back returns to More (M2/M3 origin-aware Back).
  assert.match(club, /\(venueCaps\.allocate \|\| venueCaps\.viewAllocation\) && <Row[^\n]*label="Arena"[^\n]*router\.push\(\{ pathname: "\/admin\/arena" as never, params: \{ returnTo: "\/more" \} \}\)/)
  assert.match(club, /\(admin\.sections\.some\(\(s\) => s\.key === "safeguarding"\) \|\| officer\) && <Row[^\n]*label="Safeguarding"/)
  const team = more.slice(more.indexOf("{inTeam && ("), more.indexOf("{inFamily && ("))
  for (const forbidden of ["Guardians & Players", "Subscriptions & Payments", "Season Handover", "Pitch Allocation", "Arena", "Roles & Permissions", "Safeguarding", "Fixture Control Centre", "Planner", "Import", "Admin Centre"]) {
    assert.ok(!team.includes(`label="${forbidden}"`), `a team context offers ${forbidden}`)
  }
  for (const key of ["guardians", "subscriptions", "rollover", "safeguarding"]) {
    const section = ADMIN_CENTRE_SECTIONS.find((s) => s.key === key)
    assert.ok(section, `${key} section exists`)
    assert.equal(section!.native, true, `${key} is native`)
  }
})
