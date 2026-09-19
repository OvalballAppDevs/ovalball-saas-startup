import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

/**
 * EVERY MASTER-CONTROL RPC IS REACHABLE FROM A SCREEN (Identity/Auth Slice 7e; S7-5).
 *
 * The reconciliation's verdict on Slice 7 was not that the authority model was
 * wrong. It was that seventeen of the twenty-three master-control RPCs had no UI
 * caller anywhere in the product -- so the two-administrator Site Admin rule
 * could not be performed at all, three provenance timelines answered a question
 * no screen asked, and "sign this account out of everything" was something the
 * platform could do and nobody could ask it to.
 *
 * That is a condition a test can hold permanently, and this is it. It is
 * deliberately structural rather than behavioural: it does not check that the
 * control works -- the browser suite does that -- it checks that a function the
 * database exposes to a signed-in browser is something the product can actually
 * ask for. A function nobody can call is either a gap or a grant that should not
 * exist, and both are worth failing over.
 *
 * WHY A GREP RATHER THAN A CALL GRAPH. The name is the payload: every one of
 * these is invoked as `supabase.rpc("<name>", …)`, so the literal appearing in
 * application source is exactly the reachability question. A stricter check
 * would be more fragile without being more true.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"

/**
 * Declared, narrow, and owned by another slice.
 *
 * `site_safeguarding_review` is Slice 4G's: the only route by which Ovalball
 * reads a club safeguarding thread. It is granted and has no screen. That is a
 * real finding and it is recorded rather than fixed here, because on this
 * project a defect outside the current slice's scope belongs to the slice that
 * owns the code -- Message Management, not Users & Access. It is named here so
 * it cannot be forgotten, and so that this list is the only place a new
 * unreachable function can hide.
 */
const DECLARED_UNREACHABLE = new Set(["site_safeguarding_review"])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full)
  }
  return acc
}

const APPLICATION_SOURCE = [
  ...sourceFiles(path.join(ROOT, "app")),
  ...sourceFiles(path.join(ROOT, "lib")),
].map((file) => readFileSync(file, "utf8"))

function browserCallableSiteFunctions(): string[] {
  const out = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atq",
      "-c",
      `select distinct p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and p.proname like 'site\\_%'
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        order by 1`,
    ],
    { encoding: "utf8" }
  )
  return out.split("\n").map((l) => l.trim()).filter(Boolean)
}

test("every site_* function a signed-in browser may execute is reachable from the product", () => {
  const functions = browserCallableSiteFunctions()
  assert.ok(functions.length >= 23, `expected the master-control family to be present, found ${functions.length}`)

  const unreachable = functions
    .filter((name) => !DECLARED_UNREACHABLE.has(name))
    .filter((name) => !APPLICATION_SOURCE.some((source) => source.includes(name)))
    .sort()

  assert.deepEqual(
    unreachable,
    [],
    `These functions are granted to authenticated and no screen can ask for them. Give each one a ` +
      `caller, revoke the grant, or -- if it belongs to another slice -- declare it in ` +
      `DECLARED_UNREACHABLE with the reason.`
  )
})

test("nothing sits in the declared-unreachable list after it has been given a caller", () => {
  const stale = [...DECLARED_UNREACHABLE]
    .filter((name) => APPLICATION_SOURCE.some((source) => source.includes(name)))
    .sort()
  assert.deepEqual(stale, [], `These now have callers and must be removed from DECLARED_UNREACHABLE: ${stale.join(", ")}`)
})

test("AB.1's thirteen tabs exist, and the three the reconciliation named by name are among them", () => {
  const tabs = readFileSync(path.join(ROOT, "app/(app)/admin/users/[userId]/tabs.ts"), "utf8")
  const labels = [...tabs.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1])

  assert.equal(labels.length, 13, `AB.1 specifies thirteen detail tabs; found ${labels.length}: ${labels.join(", ")}`)

  // The reconciliation names these three outright as not existing in any form.
  for (const named of ["Team Memberships", "Invitations", "Audit History"]) {
    assert.ok(labels.includes(named), `the reconciliation names "${named}" as a missing tab; it must exist`)
  }
})

/**
 * The seventeen that had no caller, named individually rather than counted.
 *
 * A count passes if seventeen unrelated functions happen to be mentioned
 * somewhere. This fails with the name of whichever one lost its screen.
 */
test("each of the seventeen orphaned master-control RPCs has a caller, by name", () => {
  const orphaned = [
    "site_add_club_membership",
    "site_transition_club_membership",
    "site_assign_club_role",
    "site_revoke_role_assignment",
    "site_assign_team_role",
    "site_set_player_team_membership",
    "site_link_guardian",
    "site_end_guardian_relationship",
    "site_revoke_sessions",
    "site_force_password_reset",
    "site_revoke_invitation",
    "site_set_capability_override",
    "site_request_site_admin_grant",
    "site_approve_site_admin_grant",
    "site_reject_site_admin_grant",
    "site_membership_history",
    "site_team_history",
  ]
  const missing = orphaned.filter((name) => !APPLICATION_SOURCE.some((source) => source.includes(name)))
  assert.deepEqual(missing, [], `Slice 7e gave these a caller and something has taken it away: ${missing.join(", ")}`)
})

test("Create User sends the assignments the RPC has always accepted (AB.4, S7-6)", () => {
  const form = readFileSync(path.join(ROOT, "app/(app)/admin/users/new/create-user-form.tsx"), "utf8")
  assert.ok(/intended:\s*assignments/.test(form), "the wizard must send its assignments to createUser")
  assert.ok(/"identity"\s*\|\s*"assignments"\s*\|\s*"review"/.test(form), "AB.4 specifies three steps")
  // Site Admin must not be grantable from a create form: it takes two people.
  assert.ok(
    !/value="SITE_ADMIN"/.test(form),
    "Site Admin is never an assignment kind on Create User -- it takes two administrators"
  )
})
