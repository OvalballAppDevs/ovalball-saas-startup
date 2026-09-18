import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

/**
 * THE CHEAP HALF OF A PERIMETER FINDING.
 *
 * Slice 6b.2a's archaeology found that `authenticated` holds USAGE on the `internal` schema and
 * EXECUTE on 227 functions in it. None of that is reachable from a browser today, for one reason and
 * one reason only: PostgREST is configured to expose `public` and `graphql_public` and nothing else,
 * so `/rest/v1/rpc/<name>` resolves only in `public`.
 *
 * That makes the whole exposure one configuration line away from mattering, which is exactly the kind
 * of fact that should not depend on somebody remembering it. The grant surface itself is a separate
 * piece of work with its own unit (see SLICE_6B2A_INTERNAL_SCHEMA_PERIMETER.md); this is the guard
 * that fails the day the line changes.
 */

const CONFIG = readFileSync("supabase/config.toml", "utf8")

function exposedSchemas(): string[] {
  const api = CONFIG.slice(CONFIG.indexOf("[api]"))
  const line = api.split("\n").find((l) => /^\s*schemas\s*=/.test(l))
  assert.ok(line, "supabase/config.toml has no [api] schemas line to check")
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

test("PERIMETER: the API exposes public and graphql_public, and nothing else", () => {
  assert.deepEqual(
    exposedSchemas().sort(),
    ["graphql_public", "public"],
    "The set of API-exposed schemas changed. Every internal.* function -- including the session " +
      "predicates and the capability resolver -- becomes directly callable by a browser role the " +
      "moment `internal` is on this list, because authenticated already holds USAGE and EXECUTE.",
  )
})

test("PERIMETER: `internal` is never an API-exposed schema", () => {
  assert.ok(
    !exposedSchemas().includes("internal"),
    "`internal` is exposed to the API. Ovalball's whole authority model assumes internal.* is " +
      "reachable only from inside another function, and the grants were never written for direct " +
      "browser invocation.",
  )
})

test("PERIMETER: no migration quietly re-grants the internal schema to a browser role", () => {
  // A migration cannot change PostgREST's exposed schemas, but it can widen the grants that make the
  // exposure dangerous. This catches the obvious shape rather than auditing all 227 functions, which
  // is deliberately the other unit's job.
  const offenders: string[] = []
  for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql"))) {
    const src = readFileSync(`supabase/migrations/${f}`, "utf8")
    if (/grant\s+all\s+on\s+schema\s+internal\s+to\s+(anon|authenticated)/i.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [], "A migration grants ALL on schema internal to a browser role.")
})
