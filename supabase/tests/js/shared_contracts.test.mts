import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"

/**
 * THE SHARED PACKAGE STAYS SHARED.
 *
 * `packages/contracts` exists so the mobile app and the website give the same answers to "who is
 * signed in" and "which contexts may this identity operate as" -- by running the same code, not by
 * agreeing to. Two things would quietly end that.
 *
 * ONE: a platform import. The moment something here imports `next/headers`, `react`, `react-native` or
 * a Node built-in, one of the two clients can no longer compile it, and the answer starts being
 * reimplemented on the other side. That is how the web ended up with fourteen copies of the club-logo
 * rule, and it is the failure this package was created to prevent rather than repeat.
 *
 * TWO: authority. These functions run on a device an attacker owns. They may decide what to SHOW; they
 * may never decide what a person may DO. A capability answer belongs to `internal.can` on the server,
 * reached through an RPC, every time.
 */

const SRC = "packages/contracts/src"
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"))
const read = (f: string) => readFileSync(`${SRC}/${f}`, "utf8")
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

test("the package has modules to check", () => {
  assert.ok(files.length >= 8, `only ${files.length} modules found -- has the package moved?`)
})

test("nothing in the shared package belongs to one platform", () => {
  // `server-only` included: it is what made every one of these unreachable from React Native in the
  // first place, and it stays on the web re-export where it means something.
  const FORBIDDEN = [
    /from "server-only"|import "server-only"/,
    /from "next\//,
    /from "react"/,
    /from "react-dom"/,
    /from "react-native/,
    /from "node:/,
    /require\(/,
    /from "fs"|from "path"|from "crypto"/,
    /from "@\//,
  ]
  for (const file of files) {
    const src = code(file)
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(src), `${file} imports something platform-specific: ${pattern}`)
    }
  }
})

test("and nothing in it carries a secret", () => {
  for (const file of files) {
    const src = code(file)
    assert.ok(!/SERVICE_ROLE|service_role/.test(src), `${file} mentions the service role key`)
    assert.ok(!/process\.env/.test(src), `${file} reads an environment variable -- configuration belongs to each client`)
  }
})

test("no capability decision is taken in the shared package", () => {
  // Presentation rules may live here. `internal.can` may not be reimplemented beside them: a client
  // that decided a capability would be wrong the moment a Club Admin changed a permission, and would
  // put a security boundary on a device its owner controls.
  for (const file of files) {
    const src = code(file)
    assert.ok(
      !/\bcanEdit|\bcanCreate|\bcanCancel|capability_decision|bundle_capabilities|capability_overrides/.test(src),
      `${file} looks like it decides a capability`
    )
  }
})

test("the web still reaches the implementation through its original paths", () => {
  // Nothing on the web was asked to change its imports, so each moved module is a re-export and holds
  // no implementation of its own. A copy reappearing in lib/ is the drift this guards.
  const MOVED: [string, string][] = [
    ["lib/app-context/session-context.ts", "session-context"],
    ["lib/app-context/active-context-rules.ts", "active-context-rules"],
    ["lib/app-context/club-logo.ts", "club-logo"],
    ["lib/app-context/personal-avatar.ts", "personal-avatar"],
    ["lib/players/age-state.ts", "age-state"],
    ["lib/governing/roles.ts", "governing-roles"],
    ["lib/permissions/role-labels.ts", "role-labels"],
    ["lib/governing/body.ts", "governing-body"],
  ]
  for (const [path, module] of MOVED) {
    const src = readFileSync(path, "utf8")
    assert.match(src, new RegExp(`export \\* from "@ovalball/contracts/${module}"`), `${path} no longer re-exports the package`)
    assert.ok(
      !/^(export )?(async )?function |^export const \w+ = \(/m.test(src.replace(/\/\*[\s\S]*?\*\//g, "")),
      `${path} has grown an implementation of its own again`
    )
  }
})

test("the club logo rule has no kit in it, on either client", () => {
  // The invariant the mobile build inherits from day one: a club is not its shirt.
  const src = read("club-logo.ts")
  assert.ok(!/kit/i.test(src), "the canonical club-logo resolver mentions a kit")
})
