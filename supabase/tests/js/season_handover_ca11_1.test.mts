import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  ADMIN_CENTRE_SECTIONS,
} from "../../../packages/contracts/src/club/admin-centre"
import {
  HANDOVER_CAPABILITIES,
  HANDOVER_SECTIONS,
  HANDOVER_SECTION_LABELS,
  YOUTH_AGE_GROUPS,
  applyConfirmationLines,
  applyOutcomeSentence,
  blockerDestination,
  bulkConfirmCandidates,
  consequenceCounts,
  consequenceSentence,
  decisionAfter,
  groupProposalsByAgeGrade,
  handoverErrorMessage,
  matchesPlayerFilter,
  needsPlayerInformation,
  noAutomaticSuccessor,
  plannedTeamLabel,
  playerStatusLabel,
  playerStatusTone,
  resolveHandoverSection,
  teamDecisionLabel,
  type HandoverConsequence,
  type PlayerProposalRow,
  type RolloverTeamProposalRow,
} from "../../../packages/contracts/src/club/handover"

/**
 * CA-M11.1 -- SEASON HANDOVER ON THE PHONE: the promises the mobile build makes and the drift it forbids.
 *
 * The website is the functional specification. The phone consumes the SAME read model, calls the SAME
 * RPCs through the SAME shared wrappers, offers each control on the SAME capability, and reimplements
 * no season, progression or age-grade logic. Apply is explicit and never runs because a step-up was
 * passed. These tests pin each of those by reading the sources, so the next slice that quietly copies
 * a rule into React Native, or gives the web its own handover reads again, fails here.
 */
const ROOT = "."
const WEB = "app/(app)/club/rollover"
const MOBILE = "apps/mobile"
const CONTRACT = "packages/contracts/src/club/handover.ts"
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const rpcNames = (src: string) => [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1])

const MUTATIONS = [
  "generate_rollover_proposal",
  "confirm_rollover_team_proposal",
  "confirm_mixed_boundary_rollover",
  "undo_rollover_team_decision",
  "resolve_rollover_group_flag",
  "create_next_season_scheduling_group",
  "rollover_placement_options",
  "set_rollover_player_placement",
  "set_rollover_player_planned_placement",
  "clear_rollover_player_placement",
  "plan_missing_placement_team",
  "unplan_handover_team",
  "place_graduating_player",
  "mark_graduating_player_left",
  "request_player_playing_pathway",
  "apply_season_handover",
]
const READS = ["handover_state", "rollover_readiness", "handover_apply_blockers", "handover_consequences", "handover_audit", "handover_team_labels", "my_capabilities"]

// ---------------------------------------------------------------------------
// The contract is the one place the RPCs are named, and the web calls it
// ---------------------------------------------------------------------------

test("the shared contract calls every RPC the web's actions used to call, by the same name and argument names", () => {
  const contract = code(CONTRACT)
  const called = new Set(rpcNames(contract))
  for (const name of [...MUTATIONS, ...READS]) assert.ok(called.has(name), `contract does not call ${name}`)
  // The web's argument names, exactly.
  assert.match(contract, /p_club_id: clubId, p_rugby_code: rugbyCode, p_to_season_id: toSeasonId/)
  assert.match(contract, /p_proposal_id: input\.proposalId,\s*p_action: input\.action,\s*p_age_group: input\.ageGroup \?\? undefined,\s*p_squad_designation: input\.squadDesignation \?\? undefined,\s*p_fold_reason: input\.foldReason \?\? undefined,\s*p_gender: input\.gender \?\? undefined/)
  assert.match(contract, /p_create_girls_team: input\.createGirlsTeam/)
  assert.match(contract, /p_rollover_id: rolloverId, p_expected_revision: expectedRevision \?\? undefined/)
  assert.match(contract, /p_source_group_id: input\.sourceGroupId,\s*p_to_season_id: input\.toSeasonId,\s*p_team_ids: input\.teamIds,\s*p_alias: input\.alias \?\? undefined/)
})

test("the web's server actions are thin callers of the contract and name no RPC of their own", () => {
  const actions = code(join(WEB, "actions.ts"))
  assert.deepEqual(rpcNames(actions), [], "actions.ts still calls an RPC directly instead of the shared wrapper")
  assert.match(actions, /from "@ovalball\/contracts\/club\/handover"/)
  for (const fn of ["prepareHandover", "decideTeamProposal", "decideMixedBoundary", "undoTeamDecision", "resolveGroupFlag", "createNextSeasonGroup", "readPlacementOptions", "setPlayerPlacement", "setPlayerPlannedPlacement", "clearPlayerPlacement", "planMissingPlacementTeam", "unplanHandoverTeam", "placeGraduatingPlayer", "markGraduatingPlayerLeft", "askGuardianForPlayingInformation", "applySeasonHandover"]) {
    assert.match(actions, new RegExp(`\\b${fn}\\b`), `actions.ts does not go through ${fn}`)
  }
})

test("the web page builds from the shared read model and passes Apply on the key the server judges", () => {
  const page = code(join(WEB, "page.tsx"))
  assert.match(page, /readHandoverBoard\(supabase, activeClub\)/)
  assert.deepEqual(rpcNames(page), [], "page.tsx reads a handover function directly again")
  assert.doesNotMatch(page, /from\("seasons"\)|from\("age_grade_rollovers"\)|from\("age_grade_rollover_player_proposals"\)|from\("scheduling_groups"\)/, "page.tsx has grown its own reads again")
  assert.match(page, /canApply=\{board\.capabilities\.apply\}/, "Apply is offered on team.handover.apply, not the reviewing key")
  const contract = code(CONTRACT)
  assert.equal((contract.match(/rpc\("my_capabilities"/g) ?? []).length, 1, "one authority probe")
  assert.doesNotMatch(contract, /CLUB_ADMIN|FIXTURE_SECRETARY|roleLabel|clubRoleKey/, "no role name decides anything")
  assert.equal(HANDOVER_CAPABILITIES.prepare, "team.handover.prepare")
  assert.equal(HANDOVER_CAPABILITIES.apply, "team.handover.apply")
  assert.equal(HANDOVER_CAPABILITIES.place, "team.graduation.place")
  assert.equal(HANDOVER_CAPABILITIES.lifecycle, "team.lifecycle.manage")
  assert.equal(HANDOVER_CAPABILITIES.miniRugbyGroups, "team.mini_rugby_group.manage")
})

test("the web components import the shared rules where they were converged", () => {
  const expectations: [string, RegExp[]][] = [
    ["handover-nav.tsx", [/HANDOVER_SECTIONS/, /HANDOVER_SECTION_LABELS/, /resolveHandoverSection/]],
    ["handover-overview.tsx", [/consequenceSentence/, /splitConsequences/]],
    ["handover-apply.tsx", [/consequenceCounts/, /applyConfirmationLines/, /applyOutcomeSentence/, /handoverEventWord/, /APPLY_IRREVERSIBLE_SENTENCE/, /APPLY_AUTHORITY_SENTENCE/]],
    ["handover-attention.tsx", [/blockerDestination/]],
    ["player-handover-proposals.tsx", [/playerStatusLabel/, /playerStatusTone/, /matchesPlayerFilter/, /PLAYER_FILTERS/, /plannedPlacementVerdict/]],
    ["rollover-review.tsx", [/bulkConfirmCandidates/, /groupProposalsByAgeGrade/, /noAutomaticSuccessor/, /teamDecisionLabel/, /decisionAfter/, /mixedBoundaryLabel/, /YOUTH_AGE_GROUPS/]],
    ["mini-rugby-next-season.tsx", [/nextSeasonGroupTag/]],
  ]
  for (const [file, patterns] of expectations) {
    const src = code(join(WEB, file))
    assert.match(src, /from "@ovalball\/contracts\/club\/handover"/, `${file} does not import the shared module`)
    for (const p of patterns) assert.match(src, p, `${file} no longer uses ${p}`)
  }
  // The rules were MOVED, not copied: none of them is defined locally any more.
  assert.doesNotMatch(code(join(WEB, "player-handover-proposals.tsx")), /^function statusLabel\(|^function matchesFilter\(|^const FILTERS: /m)
  assert.doesNotMatch(code(join(WEB, "handover-apply.tsx")), /^const EVENT_WORDS/m)
  assert.doesNotMatch(code(join(WEB, "page.tsx")), /STATE_WORDS/)
  const ageGroups = read("lib/teams/age-groups.ts")
  assert.match(ageGroups, /export \{ YOUTH_AGE_GROUPS[^}]*\} from "@ovalball\/contracts\/teams\/age-groups"/, "the web's age-group list is the shared one")
})

test("the shared module belongs to neither platform and carries no secret", () => {
  const src = code(CONTRACT)
  for (const pattern of [/from "server-only"|import "server-only"/, /from "next\//, /from "react"/, /from "react-native/, /from "node:/, /require\(/, /from "@\//, /process\.env/, /SERVICE_ROLE|service_role/]) {
    assert.doesNotMatch(src, pattern, `handover.ts imports or reads something it must not: ${pattern}`)
  }
  assert.doesNotMatch(src, /getFullYear|extract\(year|"1 August"|"1 September"|0[89]-01/, "no season is computed from a date -- the register answers")
})

// ---------------------------------------------------------------------------
// The phone: native section, capability-gated, no logic of its own, explicit Apply
// ---------------------------------------------------------------------------

const ROLLOVER_DIR = join(MOBILE, "app/(tabs)/admin/rollover")
const mobileHandoverFiles = () => [...walk(ROLLOVER_DIR), join(MOBILE, "src/admin/handover.tsx"), join(MOBILE, "src/admin/handover-sheets.tsx")].filter((f) => /\.tsx?$/.test(f))

test("the Admin Centre's Season Handover section is native and gated on team.handover.prepare, routed by its key", () => {
  const row = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "rollover")
  assert.ok(row, "the rollover section exists")
  assert.equal(row!.native, true)
  assert.equal(row!.capability, "team.handover.prepare")
  assert.equal(row!.label, "Season Handover")
  const index = code(join(MOBILE, "app/(tabs)/admin/index.tsx"))
  assert.match(index, /router\.push\(`\/admin\/\$\{s\.key\}`/, "native sections are routed by key")
  for (const file of ["_layout.tsx", "index.tsx", "teams.tsx", "players.tsx", "attention.tsx", "apply.tsx"]) {
    assert.ok(existsSync(join(ROLLOVER_DIR, file)), `${file} is missing under admin/rollover`)
  }
  assert.match(code(join(ROLLOVER_DIR, "_layout.tsx")), /<Stack screenOptions=\{\{ headerShown: false \}\} \/>/)
  const access = code(join(MOBILE, "src/admin/handover.tsx"))
  assert.match(access, /readHandoverBoard\(supabase, clubId\)/, "the phone reads the shared board")
  assert.match(access, /active\?\.kind === "club" \? \(active\.clubId \?\? active\.id\) : null/, "the active club context, never a role label")
  assert.doesNotMatch(access, /CLUB_ADMIN|FIXTURE_SECRETARY|roleLabel/, "no role name decides anything")
})

test("every mobile handover control is offered on a server capability from the shared probe", () => {
  const teams = code(join(ROLLOVER_DIR, "teams.tsx"))
  assert.match(teams, /board\.capabilities\.prepare/)
  assert.match(teams, /board\.capabilities\.miniRugbyGroups/)
  const players = code(join(ROLLOVER_DIR, "players.tsx"))
  assert.match(players, /board\.capabilities\.place/)
  assert.match(players, /board\.capabilities\.prepare/)
  const apply = code(join(ROLLOVER_DIR, "apply.tsx"))
  assert.match(apply, /board\.capabilities\.apply \?/, "Apply is offered on team.handover.apply")
  assert.match(apply, /APPLY_AUTHORITY_SENTENCE/, "and a reviewer who may not run it reads why")
})

test("no handover, season or age-grade logic is duplicated in the mobile app", () => {
  for (const f of mobileHandoverFiles()) {
    const src = code(f)
    assert.deepEqual(rpcNames(src), [], `${f} calls an RPC directly instead of the shared wrapper`)
    assert.doesNotMatch(src, /\.from\("(seasons|age_grade_rollovers|age_grade_rollover_team_proposals|age_grade_rollover_player_proposals|age_grade_rollover_planned_teams|player_graduation_queue|scheduling_groups|teams|players)"\)/, `${f} reads a handover table directly`)
    assert.doesNotMatch(src, /\bU\d{1,2}\b/, `${f} hardcodes an age grade`)
    assert.doesNotMatch(src, /getFullYear|extract\(year|season_year|starts_on|ends_on|pre_season_starts_on|"1 August"|"1 September"/, `${f} computes something about a season`)
    assert.doesNotMatch(src, /next_age_grade|nextAgeGrade|parseInt\(.*age|ageGroup\s*[+-]\s*1|Number\(.*U/, `${f} computes a progression`)
    assert.doesNotMatch(src, /date_of_birth|dateOfBirth|dob\b/i, `${f} touches a date of birth`)
    assert.doesNotMatch(src, /placementApplied \?.*"Placed"|=== "DOB_REQUIRED"|=== "CLUB_HOLDING"|external_approval_required/, `${f} re-derives the player status precedence`)
  }
  // The Adjust destinations are the shared list, never a mobile copy.
  assert.match(code(join(MOBILE, "src/admin/handover-sheets.tsx")), /YOUTH_AGE_GROUPS\.map/)
  assert.doesNotMatch(code(join(MOBILE, "src/admin/handover-sheets.tsx")), /\["U6"/)
})

test("the apply screen requires explicit confirmation, and a step-up return re-asks rather than performing the mutation", () => {
  const apply = code(join(ROLLOVER_DIR, "apply.tsx"))
  const calls = apply.match(/applySeasonHandover\(supabase/g) ?? []
  assert.equal(calls.length, 1, "the single mutation boundary is called from exactly one place")
  const idx = apply.indexOf("applySeasonHandover(supabase")
  const before = apply.slice(Math.max(0, idx - 400), idx)
  assert.match(before, /onConfirm: async \(\) => \{/, "and that place is the confirmation sheet's onConfirm")
  assert.match(apply, /confirmLabel: "Apply Handover"/)
  assert.match(apply, /APPLY_IRREVERSIBLE_SENTENCE/)
  assert.match(apply, /applyConfirmationLines\(counts\)/, "the sheet restates every consequence")
  assert.match(apply, /p_expected_revision|expectedRevision = rollover\.decisionsRevision/, "the revision the reviewer saw is what is sent")
  assert.match(apply, /if \(!board \|\| !rollover \|\| !counts \|\| blockerCount > 0\) return/, "a blocked handover opens no confirmation")
  // Step-up: hold, go, and on return only re-open the sheet.
  assert.match(apply, /pending\.hold\(ask, reason\)/)
  assert.match(apply, /returnTo: "\/admin\/rollover\/apply"/)
  assert.match(apply, /const resume = pending\.take\(\)\s*if \(resume\) setAsk\(resumedAsk\(resume\)\)/, "a step-up return re-opens the sheet and nothing else")
  assert.doesNotMatch(apply.replace(/onConfirm: async \(\) => \{[\s\S]*?\},/, ""), /applySeasonHandover\(supabase/, "nothing outside onConfirm applies")
  // The step-up screen itself performs nothing and a cancel discards the intent.
  const stepUp = code(join(MOBILE, "app/step-up.tsx"))
  assert.doesNotMatch(stepUp, /apply_season_handover|applySeasonHandover|rollover/)
  assert.match(stepUp, /discardIntents\(\)/)
  // The team sheet's fold/graduate step-up follows the same shape.
  const teams = code(join(ROLLOVER_DIR, "teams.tsx"))
  assert.match(teams, /holdIntent<HeldDecision>\(INTENT_KEY/)
  assert.match(teams, /returnTo: "\/admin\/rollover\/teams"/)
  assert.match(teams, /takeIntent<HeldDecision>\(INTENT_KEY\)/)
  assert.match(teams, /"Verified\. Confirm to continue\."/)
})

test("the Mixed boundary has no default answer on the phone either", () => {
  const sheets = code(join(MOBILE, "src/admin/handover-sheets.tsx"))
  assert.match(sheets, /useState<boolean \| null>\(null\)/, "createGirls starts unanswered")
  assert.match(sheets, /disabled=\{createGirls === null\}/, "the control is unusable until Yes or No")
  assert.match(sheets, /if \(!ask \|\| createGirls === null\) return/)
})

// ---------------------------------------------------------------------------
// The pure rules, once
// ---------------------------------------------------------------------------

const proposal = (over: Partial<RolloverTeamProposalRow>): RolloverTeamProposalRow => ({
  id: "p",
  teamId: "t",
  teamDisplayName: "Under 12 Boys",
  teamGender: "boys",
  teamSquadDesignation: null,
  currentAgeGroup: "U12",
  proposedAgeGroup: "U13",
  requiresManualChoice: false,
  isMixedBoundary: false,
  decision: "pending",
  decidedAgeGroup: null,
  girlsTeamCreated: null,
  createGirlsTeam: null,
  foldReason: null,
  applied: false,
  ...over,
})

const player = (over: Partial<PlayerProposalRow>): PlayerProposalRow => ({
  proposalId: "pp",
  playerId: "pl",
  playerName: "Harry Smith",
  currentTeamName: "Under 12 Boys",
  normalPlacementName: "Under 13 Boys",
  selectedPlacementName: null,
  regulatoryAgeLabel: "U13",
  reviewState: "READY",
  allocationStatus: "NORMAL_PLACEMENT",
  movementRequirement: "permitted",
  dispensationRequired: false,
  reason: null,
  placementApplied: false,
  normalTeamMissing: false,
  plannedTeamName: null,
  plannedTeamPending: false,
  placementChosen: false,
  ...over,
})

test("sections, labels and the default section are the website's", () => {
  assert.deepEqual([...HANDOVER_SECTIONS], ["overview", "teams", "players", "attention", "apply"])
  assert.equal(HANDOVER_SECTION_LABELS.attention, "Needs Attention")
  assert.equal(HANDOVER_SECTION_LABELS.apply, "Apply & Audit")
  assert.equal(resolveHandoverSection(undefined), "overview")
  assert.equal(resolveHandoverSection("players"), "players")
  assert.equal(resolveHandoverSection("nonsense"), "overview")
  assert.deepEqual([...YOUTH_AGE_GROUPS], ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "U19"])
})

test("a consequence's tense is the server's, and the counts treat created and reactivated as planned", () => {
  const c = (kind: HandoverConsequence["kind"], isApplied: boolean): HandoverConsequence => ({ kind, fromLabel: "Under 12 Boys", toLabel: "Under 13 Boys", note: null, isApplied })
  assert.deepEqual(consequenceSentence(c("progress", false)), { subject: "Under 12 Boys", verb: "will become", object: "Under 13 Boys", needsDecision: false })
  assert.deepEqual(consequenceSentence(c("progress", true)), { subject: "Under 12 Boys", verb: "became", object: "Under 13 Boys", needsDecision: false })
  assert.equal(consequenceSentence(c("graduate", false)).verb, "completes the youth pathway")
  assert.equal(consequenceSentence(c("fold", true)).verb, "did not continue")
  assert.equal(consequenceSentence(c("plan", false)).verb, "will be created")
  assert.equal(consequenceSentence(c("created", true)).verb, "was created")
  assert.equal(consequenceSentence(c("reactivated", false)).verb, "will be reactivated")
  assert.equal(consequenceSentence(c("undecided", false)).needsDecision, true)
  assert.equal(consequenceSentence({ ...c("undecided", false), toLabel: null }).verb, "has no proposed destination")
  const counts = consequenceCounts([c("progress", true), c("plan", false), c("created", true), c("reactivated", true), c("graduate", false), c("fold", false), c("undecided", false)])
  assert.deepEqual(counts, { progressing: 1, creating: 3, graduating: 1, folding: 1, undecided: 1 })
  const lines = applyConfirmationLines(counts)
  assert.equal(lines[0], "1 team move up an age grade, keeping their history.")
  assert.ok(lines.includes("3 teams will be created."))
  assert.equal(lines[lines.length - 1], "Players move to the teams recorded against them.")
  assert.equal(applyOutcomeSentence({ alreadyApplied: true, teamsProgressed: 0, teamsFolded: 0, teamsGraduated: 0, teamsCreated: 0, teamsReactivated: 0, playersMoved: 0, playersHeld: 0 }), "This handover had already been applied, so nothing was changed again.")
  assert.equal(applyOutcomeSentence({ alreadyApplied: false, teamsProgressed: 3, teamsFolded: 0, teamsGraduated: 0, teamsCreated: 1, teamsReactivated: 1, playersMoved: 40, playersHeld: 2 }), "3 teams progressed, 2 created or reactivated, 40 players moved.")
})

test("team rules: grouping, straightforward candidates, no automatic successor, decision labels", () => {
  const rows = [proposal({ id: "a", currentAgeGroup: "U10" }), proposal({ id: "b", currentAgeGroup: "U9", teamSquadDesignation: "B" }), proposal({ id: "c", currentAgeGroup: "U9" }), proposal({ id: "d", currentAgeGroup: "U11", isMixedBoundary: true }), proposal({ id: "e", currentAgeGroup: "U18", requiresManualChoice: true, proposedAgeGroup: null }), proposal({ id: "f", decision: "confirmed" })]
  assert.deepEqual(groupProposalsByAgeGrade(rows).map((g) => [g.age, g.rows.map((r) => r.id)]), [["U9", ["c", "b"]], ["U10", ["a"]], ["U11", ["d"]], ["U12", ["f"]], ["U18", ["e"]]])
  assert.deepEqual(bulkConfirmCandidates(rows).map((r) => r.id), ["a", "b", "c"], "a Mixed boundary, a manual choice and a decided row are never bulk-confirmed")
  assert.equal(noAutomaticSuccessor(rows[4]), true)
  assert.equal(noAutomaticSuccessor(proposal({ requiresManualChoice: true, proposedAgeGroup: "U13" })), false)
  assert.equal(decisionAfter("adjust"), "confirmed")
  assert.equal(decisionAfter("graduate"), "graduated")
  assert.equal(teamDecisionLabel("confirmed", "U13", false), "Decided: becomes U13")
  assert.equal(teamDecisionLabel("confirmed", "U13", true), "Became U13")
  assert.equal(teamDecisionLabel("folded", null, false), "Decided: will not continue")
  assert.equal(teamDecisionLabel("graduated", null, true), "Youth pathway complete")
  assert.equal(teamDecisionLabel("deferred", null, false), "Deferred — still needs a decision")
  assert.equal(plannedTeamLabel("Under 12 Girls", "B"), "Under 12 Girls B")
  assert.equal(plannedTeamLabel(null, null), "Team")
})

test("player rules: the status precedence, its tone and the filters are one rule", () => {
  assert.equal(playerStatusLabel(player({ placementApplied: true, reviewState: "BLOCKED" })), "Placed")
  assert.equal(playerStatusLabel(player({ plannedTeamName: "Under 13 Boys", plannedTeamPending: true, allocationStatus: "DOB_REQUIRED" })), "Team planned")
  assert.equal(playerStatusLabel(player({ allocationStatus: "DOB_REQUIRED", reviewState: "NEEDS_ATTENTION" })), "Date of birth needed")
  assert.equal(playerStatusLabel(player({ allocationStatus: "CLUB_HOLDING" })), "Club holding")
  assert.equal(playerStatusLabel(player({ reviewState: "BLOCKED" })), "Not permitted")
  assert.equal(playerStatusLabel(player({ reviewState: "NEEDS_ATTENTION", movementRequirement: "external_approval_required" })), "Governing approval")
  assert.equal(playerStatusLabel(player({ reviewState: "NEEDS_ATTENTION" })), "Needs attention")
  assert.equal(playerStatusLabel(player({})), "Ready")
  assert.equal(playerStatusTone(player({})), "positive")
  assert.equal(playerStatusTone(player({ allocationStatus: "CLUB_HOLDING" })), "neutral")
  assert.equal(playerStatusTone(player({ reviewState: "BLOCKED" })), "negative")
  assert.equal(playerStatusTone(player({ reviewState: "NEEDS_ATTENTION" })), "caution")
  assert.equal(matchesPlayerFilter(player({}), "all"), true)
  assert.equal(matchesPlayerFilter(player({}), "ready"), true)
  assert.equal(matchesPlayerFilter(player({}), "attention"), false)
  assert.equal(matchesPlayerFilter(player({ reviewState: "NEEDS_ATTENTION" }), "attention"), true)
  assert.equal(matchesPlayerFilter(player({ allocationStatus: "CLUB_HOLDING" }), "holding"), true)
  assert.equal(matchesPlayerFilter(player({ dispensationRequired: true }), "approval"), true)
})

test("blockers: destinations by kind, and the one the club may only ask about", () => {
  assert.deepEqual(blockerDestination("season"), { section: "seasons", label: "Open Seasons" })
  assert.deepEqual(blockerDestination("team"), { section: "teams", label: "Decide in Teams" })
  assert.deepEqual(blockerDestination("collision"), { section: "teams", label: "Resolve in Teams" })
  for (const k of ["player", "dispensation", "stale"] as const) assert.deepEqual(blockerDestination(k), { section: "players", label: "Review in Players" })
  assert.equal(needsPlayerInformation("player", "id", "Ovalball cannot tell which pathway this player is registered in."), true)
  assert.equal(needsPlayerInformation("player", null, "which pathway this player is registered in"), false)
  assert.equal(needsPlayerInformation("team", "id", "which pathway this player is registered in"), false)
})

test("a server refusal is shown in its own words, and anything else in the app's", () => {
  assert.equal(handoverErrorMessage({ code: "42501", message: "Only this club's Club Admin or a Full Site Admin may apply a season handover." }, "fallback"), "Only this club's Club Admin or a Full Site Admin may apply a season handover.")
  assert.equal(handoverErrorMessage({ code: "P0001", message: "These decisions have changed since you reviewed them." }, "fallback"), "These decisions have changed since you reviewed them.")
  assert.equal(handoverErrorMessage({ code: "PGRST116", message: "JSON object requested" }, "fallback"), "fallback")
  assert.equal(handoverErrorMessage(null, "fallback"), "fallback")
})
