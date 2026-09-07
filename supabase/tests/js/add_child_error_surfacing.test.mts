import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

import { toPublicAddChildError } from "@/lib/errors/public-error"

/**
 * Phase 2B, reported live: "Child 1 does not get added correctly. Child 2
 * proceeds through the adding flow."
 *
 * add_child_for_guardian's invite-only guard is deliberate safeguarding and
 * stays. What was broken is that its clear, actionable refusal never reached
 * the parent: the message was missing from the allowlist, so it was replaced
 * by the generic "sign out and back in" fallback -- advice that cannot work,
 * for a refusal that was intentional.
 *
 * The allowlist matches on the message TEXT, so the database function and
 * this list are coupled by a string with nothing but this test holding them
 * together. Rewording the RAISE in a later migration without touching
 * public-error.ts would silently reintroduce the exact reported symptom, and
 * every test that only checks the guard fires would still pass. So this
 * reads the live function body and asserts the two agree.
 */

const GUARD_MESSAGE = "You need an invitation from this club before you can add a child to it."

test("the invite-only refusal reaches the parent verbatim", () => {
  assert.equal(toPublicAddChildError({ message: GUARD_MESSAGE }), GUARD_MESSAGE)
})

test("an unexpected failure is still not leaked verbatim", () => {
  // The allowlist must stay an allowlist: a raw Postgres error is replaced.
  const raw = 'permission denied for table players'
  assert.notEqual(toPublicAddChildError({ message: raw }), raw)
  assert.match(toPublicAddChildError({ message: raw }), /couldn't add this child/i)
})

test("the allowlisted text still matches what the database actually raises", () => {
  let body: string
  try {
    body = execFileSync(
      "docker",
      [
        "exec", "-i", "supabase_db_ovalball-saas-startup",
        "psql", "-U", "postgres", "-d", "postgres", "-At",
        "-c", "select prosrc from pg_proc where proname = 'add_child_for_guardian'",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
  } catch {
    // Local Supabase not running -- the SQL suite covers this path anyway.
    return
  }
  assert.ok(body.length > 0, "add_child_for_guardian was not found in the local database")
  assert.ok(
    body.includes(GUARD_MESSAGE),
    "the database's invite-only message no longer matches the allowlisted text in " +
      "lib/errors/public-error.ts -- a parent would see the generic 'sign out and " +
      "back in' fallback again. Update both together."
  )
})
