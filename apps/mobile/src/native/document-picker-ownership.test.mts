import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * THE DEVICE FILE PICKER HAS EXACTLY ONE OWNER.
 *
 * `expo-document-picker` was banned from the whole mobile app because the messenger's attach menu is a
 * standing four-item decision, and absence of the dependency was the second barrier behind absence of
 * the "Choose File" row: removing the row alone leaves the capability one import away.
 *
 * Team Documents then legitimately needed a device picker -- a club document is uploaded from
 * somewhere, and that is the product that uploads it -- so the blanket ban began failing on correct,
 * shipped product and the canonical gate was red on committed code for weeks. The rule is now an
 * explicit owner list rather than a blanket ban.
 *
 * NARROWING A RULE IS THE MOMENT IT QUIETLY STOPS WORKING, so this asserts the boundary in all three
 * directions rather than trusting that it still bites: the owner is allowed, the messenger is not, and
 * an unrelated surface is not. Each case actually RUNS the checker against a real tree, because a test
 * that only re-implements the regex would pass while the shipped checker did nothing.
 *
 * Each case creates one file it owns and removes that same file in `finally`. Nothing else is touched,
 * and no case restores by reverting the tree.
 */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ROOT = here("../../../../")
const CHECKER = here("../../../../scripts/verify-mobile-messenger-scope.mjs")

/** Runs the real checker. Returns true when the gate passes. */
function gatePasses(): boolean {
  try {
    execFileSync("node", [CHECKER], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

/** Writes a throwaway source file, runs the checker, and always removes exactly that file. */
function withFile(relativePath: string, body: string, run: () => void): void {
  const absolute = ROOT + relativePath
  assert.ok(!existsSync(absolute), `${relativePath} already exists -- refusing to overwrite a real file`)
  writeFileSync(absolute, body)
  try {
    run()
  } finally {
    rmSync(absolute, { force: true })
  }
}

const IMPORTS_PICKER = `import * as DocumentPicker from "expo-document-picker"\nexport const x = DocumentPicker\n`

test("the gate passes as the tree actually stands", () => {
  assert.ok(gatePasses(), "the shipped tree must satisfy its own scope rule")
})

test("Team Documents is the declared owner and may import the picker", () => {
  const checker = readFileSync(CHECKER, "utf8")
  assert.match(checker, /DOCUMENT_PICKER_OWNERS/)
  assert.match(checker, /apps\/mobile\/src\/team\/team-documents-screen\.tsx/)

  const owner = readFileSync(here("../team/team-documents-screen.tsx"), "utf8")
  assert.match(owner, /^\s*import[^\n]*expo-document-picker/m, "the declared owner must be the file that actually imports it")
})

test("Club Documents' Upload screen is the second declared owner and actually imports the picker", () => {
  // The club library is where a document is received; Messenger reaches a document only by sharing it FROM
  // that library, so adding the library's own upload screen does not open a door for the messenger.
  const checker = readFileSync(CHECKER, "utf8")
  assert.match(checker, /apps\/mobile\/src\/documents\/upload-screen\.tsx/)

  const owner = readFileSync(here("../documents/upload-screen.tsx"), "utf8")
  assert.match(owner, /^\s*import[^\n]*expo-document-picker/m, "the declared owner must be the file that actually imports it")
})

test("the Club Documents library screen itself is NOT an owner", () => {
  withFile("apps/mobile/src/documents/__scope-probe.ts", IMPORTS_PICKER, () => {
    assert.ok(!gatePasses(), "only the named upload screen may import the picker, not its neighbours")
  })
})

test("the messenger may NOT acquire a device file picker", () => {
  withFile("apps/mobile/src/messages/__scope-probe.ts", IMPORTS_PICKER, () => {
    assert.ok(!gatePasses(), "a messenger file importing expo-document-picker must fail the gate")
  })
})

test("an unrelated mobile surface may NOT silently begin using it", () => {
  withFile("apps/mobile/src/tournaments/__scope-probe.ts", IMPORTS_PICKER, () => {
    assert.ok(!gatePasses(), "a non-owner surface importing expo-document-picker must fail the gate")
  })
})

test("opening the picker is caught even without an import line", () => {
  // The capability, not the import statement, is the thing being guarded.
  withFile(
    "apps/mobile/src/clubhouse/__scope-probe.ts",
    `export async function pick() {\n  return await DocumentPicker.getDocumentAsync({})\n}\n`,
    () => {
      assert.ok(!gatePasses(), "calling DocumentPicker.getDocumentAsync outside the owner must fail the gate")
    },
  )
})

test("the dependency may not sit in the bundle with no product behind it", () => {
  // If the owner ever stops importing it, the dependency has to go too -- otherwise the capability is
  // back to being one import away, which is the state the original ban existed to prevent.
  const checker = readFileSync(CHECKER, "utf8")
  assert.match(checker, /only while a declared owner uses it/)
  assert.match(checker, /must be a dependency/)
})
