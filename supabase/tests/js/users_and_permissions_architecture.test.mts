import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { explainDecision, decisionRemedy, type AccessDecision } from "@/lib/permissions/access-explanation"
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
  assert.match(src, /rpc\("remove_team_access"/, "removing one is remove_team_access's job")
  assert.doesNotMatch(src, /from\("team_permissions"\)[\s\S]{0,160}(insert|update|delete)/,
    "team roles are never written directly around the authority that audits them")
})

test("the person access page explains from server authority and never re-derives a decision", () => {
  const src = code("app/(app)/people/[membershipId]/page.tsx")
  assert.match(src, /rpc\("explain_access"/, "the WHY comes from explain_access")
  assert.match(src, /from "\.\.\/\.\.\/club\/permissions\/groups"/,
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
