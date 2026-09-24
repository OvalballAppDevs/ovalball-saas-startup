import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { explainDecision, decisionRemedy, type AccessDecision } from "@ovalball/contracts/club/access-explanation"
import { roleAssignmentLabel, roleKeyLabel, PENDING_CONFIRMATION_EXPLANATION } from "@/lib/permissions/role-presentation"
import { CLUB_ROLE_LABEL, TEAM_PERMISSION_LABEL, TEAM_STAFF_PERMISSION_OPTIONS } from "@/lib/permissions/role-labels"

/**
 * CONVERGENCE STEP 2 -- ONE CONCEPT, ONE SOURCE.
 *
 * The Users & Permissions centre is made almost entirely of things that already
 * existed. What made it a convergence rather than a rebuild is that it stopped
 * the same question being answered twice. These assertions hold that shape, and
 * every one of them corresponds to a real defect found in the Step 2 baseline
 * rather than to a rule invented to have something to check:
 *
 *   - a page read pending invitations from `public.invitations`, a table that
 *     has held zero rows since `issue_invitation` began writing
 *     `public.access_invitations`, so the section could never draw a row and the
 *     Revoke button inside it could never be pressed;
 *   - the revocation itself wrote `status = 'revoked'` into that same empty
 *     table, matched nothing, returned no error and reported success;
 *   - three of the four role-label maps in the product were local copies, and
 *     one screen printed the raw database value `BASIC_USER` to somebody
 *     deciding whether to let a stranger into their club;
 *   - and the explanation of WHY somebody may do something must never leak a
 *     reason code to a person, nor invent a sentence when it does not recognise
 *     one.
 */

const read = (p: string) => readFileSync(p, "utf8")
/** Source with comments stripped: a rule about CODE must not be satisfied or broken by prose. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const PEOPLE_PAGE = "app/(app)/people/page.tsx"
const PEOPLE_ACTIONS = "app/(app)/people/actions.ts"

test("pending invitations are read from the table invitations are actually in", () => {
  const src = code(PEOPLE_PAGE)
  assert.match(src, /from\("invitations_admin_view"\)/,
    "the centre must list waiting invitations from the canonical admin view")
  assert.doesNotMatch(src, /from\("invitations"\)/,
    "public.invitations has held zero rows since Slice 5; reading it draws an empty section forever")
})

test("revoking an invitation goes through the authority, not a table write", () => {
  const src = code(PEOPLE_ACTIONS)
  assert.match(src, /rpc\("revoke_invitation"/, "revocation is revoke_invitation's job")
  assert.doesNotMatch(src, /from\("invitations"\)[\s\S]{0,120}update/,
    "an UPDATE that matches no rows returns no error and reports success")
})

test("giving and removing a team role both call the canonical RPCs", () => {
  const src = code(PEOPLE_ACTIONS)
  assert.match(src, /rpc\("set_team_access"/, "giving a team role is set_team_access's job")
  // CA-M3 moved the removal into the shared People contract; the action calls the wrapper, the wrapper the RPC.
  assert.match(src, /removeTeamAccess\(supabase/, "removing one is remove_team_access's job (through the shared wrapper)")
  assert.match(code("packages/contracts/src/club/people.ts"), /rpc\("remove_team_access"/, "and the wrapper is the one that calls remove_team_access")
  assert.doesNotMatch(src, /from\("team_permissions"\)[\s\S]{0,160}(insert|update|delete)/,
    "team roles are never written directly around the authority that audits them")
})

test("the person access page explains from server authority and never re-derives a decision", () => {
  const src = code("app/(app)/people/[membershipId]/page.tsx")
  assert.match(src, /rpc\("explain_access"/, "the WHY comes from explain_access")
  assert.match(src, /from "@ovalball\/contracts\/club\/permission-groups"/,
    "the permissions explained are the club permissions catalogue, imported rather than restated")
  assert.doesNotMatch(src, /rpc\("(has_capability|my_capabilities)"/,
    "asking a second question about the same person would let the two answers disagree")
})

test("no people or permissions surface keeps its own copy of the role wording", () => {
  for (const file of [
    "app/(app)/people/person-row.tsx",
    "app/(app)/people/join-request-row.tsx",
    "app/(app)/people/pending-invitation-row.tsx",
    "app/(app)/teams/[teamId]/team-people.tsx",
  ]) {
    const src = code(file)
    assert.doesNotMatch(src, /(const|let)\s+\w*(CLUB_ROLE|ROLE_LABEL|PERMISSION_LABEL)\w*\s*(:|=)\s*(Record<|\{)/,
      `${file} must take role wording from lib/permissions/role-labels.ts`)
  }
})

test("no people surface prints a raw database role value to a person", () => {
  // Every interpolation of a role-shaped value has to pass through the label
  // authority. This screen read "Says they are: BASIC_USER" to somebody deciding
  // whether to let a stranger into their club.
  for (const file of [
    "app/(app)/people/join-request-row.tsx",
    "app/(app)/people/person-row.tsx",
    "app/(app)/people/pending-invitation-row.tsx",
  ]) {
    for (const [, inside] of code(file).matchAll(/\$\{([^}]*(?:requestedRole|clubRole|permission)[^}]*)\}/g)) {
      assert.match(inside, /clubRoleLabel|teamPermissionLabel|describeRole|CLUB_ROLE_LABEL|TEAM_PERMISSION_LABEL/,
        `${file} interpolated "${inside.trim()}" without the canonical wording`)
    }
  }
})

test("the three roles a club hands out are the canonical labels, and exclude view_only", () => {
  assert.deepEqual(
    TEAM_STAFF_PERMISSION_OPTIONS.map((o) => o.value),
    ["team_admin", "coach", "manager"],
    "view_only arrives through guardianship and squad membership, never by being chosen from a list"
  )
  for (const o of TEAM_STAFF_PERMISSION_OPTIONS) {
    assert.equal(o.label, TEAM_PERMISSION_LABEL[o.value], "the option label is the canonical label, not a second wording")
  }
})

const decision = (over: Partial<AccessDecision> = {}): AccessDecision => ({
  allowed: false, decisiveRule: "role_bundle", reasonCode: "DEFAULT_DENY", decisiveSource: null, trail: [], ...over,
})

test("an explanation names the mechanism and never shows a person a reason code", () => {
  for (const reasonCode of [
    "ROLE_BUNDLE", "EXPLICIT_ALLOW", "EXPLICIT_DENY", "DEFAULT_DENY", "SITE_CAPABILITY",
    "MEMBERSHIP_INACTIVE", "MEMBERSHIP_SUSPENDED", "ROLE_SUSPENDED", "CLUB_INACTIVE", "ACCOUNT_INACTIVE",
    "MINOR_PROHIBITED", "ADULT_PLAYER", "OUT_OF_SCOPE", "SCOPE_NOT_IMPLEMENTED", "UNKNOWN_CAPABILITY",
    "CAPABILITY_RETIRED", "SESSION", "NO_SUBJECT", "IMPERSONATION_VIEW_ONLY", "IMPERSONATION_BLOCKED",
    "SCOPE_MALFORMED", "SCOPE_TAMPERED",
  ]) {
    for (const allowed of [true, false]) {
      const sentence = explainDecision("Nadia", "create fixtures", decision({ reasonCode, allowed }))
      assert.doesNotMatch(sentence, /[A-Z]{3,}_[A-Z]/, `"${sentence}" leaks the reason code ${reasonCode}`)
      assert.match(sentence, /^Nadia (can|cannot) create fixtures/, `"${sentence}" must start with the verdict`)
      assert.match(sentence, /\.$/, "an explanation is a sentence")
    }
  }
})

test("an unrecognised reason code falls back to the rule the database named, never to a guess", () => {
  const sentence = explainDecision("Nadia", "create fixtures", decision({ reasonCode: "SOMETHING_NEW", decisiveRule: "a newer rule" }))
  assert.equal(sentence, "Nadia cannot create fixtures, because a newer rule.")
  const bare = explainDecision("Nadia", "create fixtures", decision({ reasonCode: "SOMETHING_NEW", decisiveRule: null }))
  assert.equal(bare, "Nadia cannot create fixtures.", "with nothing to say, it says nothing rather than inventing a cause")
})

test("a remedy is offered only where this club can actually act", () => {
  assert.equal(decisionRemedy(decision({ reasonCode: "SITE_CAPABILITY" })), "This club cannot change it.")
  assert.equal(decisionRemedy(decision({ reasonCode: "SOMETHING_NEW" })), null)
  assert.equal(decisionRemedy(decision({ reasonCode: "DEFAULT_DENY", allowed: true })), null,
    "a permission that is allowed by default needs nothing removed")
})

test("the club role labels the centre relies on are the three the database constrains", () => {
  assert.deepEqual(Object.keys(CLUB_ROLE_LABEL).sort(), ["BASIC_USER", "CLUB_ADMIN", "FIXTURE_SECRETARY"])
})


/* ------------------------------------------------------------------------- *
 * The Step 2 review corrections.
 * ------------------------------------------------------------------------- */

test("a Safeguarding Officer appointment is worded with its state, never as though it were settled", () => {
  assert.equal(
    roleAssignmentLabel("SAFEGUARDING_OFFICER", "Safeguarding Officer", "PENDING_CONFIRMATION"),
    "Safeguarding Officer — Pending confirmation",
    "a nomination confers nothing until Ovalball confirms it, and the label has to carry that"
  )
  assert.equal(roleAssignmentLabel("SAFEGUARDING_OFFICER", "Safeguarding Officer", "CONFIRMED"), "Safeguarding Officer")
  assert.notEqual(
    roleAssignmentLabel("SAFEGUARDING_OFFICER", "Safeguarding Officer", "PENDING_CONFIRMATION"),
    roleAssignmentLabel("SAFEGUARDING_OFFICER", "Safeguarding Officer", "CONFIRMED"),
    "the two states must be distinguishable on sight"
  )
  // Every other role has no confirmation state at all -- a CHECK constraint, not a convention.
  assert.equal(roleAssignmentLabel("CLUB_ADMIN", "Club Admin", null), "Club Admin")
})

test("the appointment state is read from one place, and that place is the state machine", () => {
  const reader = code("lib/safeguarding/club-appointments.ts")
  assert.match(reader, /from\("role_assignments"\)/, "the appointment lives in role_assignments, not the contact register")
  assert.match(reader, /confirmation_state/, "and its state is what makes it an appointment rather than a grant")

  const page = code("app/(app)/club/settings/safeguarding/page.tsx")
  assert.match(page, /resolveClubSafeguardingAppointments/,
    "the page that owns the appointment must read it; reading only get_club_safeguarding_officers made every nomination invisible")
  assert.doesNotMatch(page, /from\("role_assignments"\)/,
    "and must consume the shared reader rather than opening a second one")

  const grid = code("app/(app)/club/permissions/page.tsx")
  assert.match(grid, /confirmation_state/, "the permissions grid captioned a pending nominee as the Safeguarding Officer outright")
  assert.match(grid, /roleAssignmentLabel/, "so it takes its wording from the same authority")
})

test("the pending-appointment explanation has exactly one wording", () => {
  assert.match(PENDING_CONFIRMATION_EXPLANATION, /Ovalball to confirm/)
  assert.match(PENDING_CONFIRMATION_EXPLANATION, /no Safeguarding Officer authority/)
  const page = readFileSync("app/(app)/club/settings/safeguarding/page.tsx", "utf8")
  assert.doesNotMatch(page, /waiting for Ovalball to confirm/i,
    "the sentence is imported, not retyped -- two copies is how the two screens disagreed in the first place")
})

test("the club's fixtures role is worded the way the product words it everywhere", () => {
  // The catalogue says "Fixtures Secretary" and every other Ovalball surface says
  // "Fixture Secretary". Mapped in presentation; no migration, no second role identity.
  assert.equal(roleKeyLabel("FIXTURES_SECRETARY", "Fixtures Secretary"), "Fixture Secretary")
  assert.equal(roleKeyLabel("CLUB_ADMIN", "Club Admin"), "Club Admin", "a role whose wording is not in dispute keeps the catalogue's")
  assert.equal(roleKeyLabel("SOMETHING_NEW", null), "SOMETHING_NEW", "an unknown role falls back to its key, never to a guess")
  assert.match(code("app/(app)/people/actions.ts"), /roleKeyLabel\(row\.role_key, row\.label\)/,
    "the invite form offered a differently-named role from the one the person's row would later show")
})

test("explanatory copy about who may act never names a role instead of asking the capability", () => {
  // L4: the team page told a Team Manager that "Only this club's Club Admin can
  // ... assign people", directly beneath an assign control she was entitled to
  // use -- because the sentence was gated on a session-wide flag while the
  // control was gated on team.roster.manage. One question, two answers.
  const page = code("app/(app)/teams/[teamId]/page.tsx")
  assert.doesNotMatch(page, /isClubAdminAnywhere/,
    "a session-wide role flag must not decide what a page says about authority at THIS team")
  assert.doesNotMatch(page, /Only this club['\u2019]s Club Admin can/,
    "copy that names a role cannot follow the capability engine when the club moves that capability")
  assert.match(page, /\{\(!canManage \|\| !canManagePeople\)/,
    "the explanation asks the same flags the controls ask, so the two cannot contradict each other")
})
