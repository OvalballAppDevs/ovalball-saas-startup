#!/usr/bin/env node
/**
 * THE MOBILE MESSENGER ATTACH MENU IS FOUR THINGS, AND STAYS FOUR THINGS.
 *
 * Club Documents · Take Photo · Choose Photo · Contact Card.
 *
 * The product owner made this a standing decision after a first implementation offered two more. It is
 * guarded structurally rather than by a note in a file, because both of the excluded features are the
 * kind a future session would cheerfully "restore" on the reasonable-sounding grounds that the platform
 * supports the file type or that an entry point that explains itself is friendlier than none.
 *
 *   CHOOSE FILE. A document in an Ovalball conversation comes from the club's library -- a place with an
 *   owner, a category and a revision -- not from whatever happens to be on one person's handset. So the
 *   menu has no such row AND `expo-document-picker` is not a dependency: two barriers, because removing
 *   the row alone leaves the capability one import away.
 *
 *   CREATE IMAGE. No AI image generation, and no entry point that exists only to explain that the
 *   platform cannot do it. The owner does not want the idea present in the interface at all.
 *
 * This checks what SHIPS: the action union the sheet is built from, the rows it renders, the mobile
 * app's own dependencies, and the routes under the messages tab. It deliberately does not read comments.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MOBILE = join(ROOT, "apps", "mobile")
const failures = []
const checks = []

const check = (ok, label, detail = "") => {
  checks.push(ok)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)

// ---------------------------------------------------------------- the sheet
const sheetPath = join(MOBILE, "src", "components", "attachment-sheet.tsx")
const sheet = read(sheetPath)
check(sheet !== null, "the attachment sheet exists", sheetPath)

if (sheet) {
  // THE UNION IS THE CONTRACT. A row cannot be rendered for an action the type does not permit, so
  // reading the type catches a restoration before the rendering does.
  const union = sheet.match(/export type AttachmentAction\s*=\s*([^\n]+)/)?.[1] ?? ""
  const actions = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort()
  check(
    JSON.stringify(actions) === JSON.stringify(["camera", "contact", "documents", "library"]),
    "the attach menu offers exactly four actions",
    `found ${JSON.stringify(actions)}`
  )

  // And the labels a person actually sees, since a union member could be renamed.
  for (const label of ["Club Documents", "Take Photo", "Choose Photo", "Contact Card"]) {
    check(sheet.includes(`label: "${label}"`), `the sheet offers "${label}"`)
  }
  for (const forbidden of ["Choose File", "Create Image", "Attach a File", "Generate Image"]) {
    check(!sheet.includes(`label: "${forbidden}"`), `the sheet does not offer "${forbidden}"`)
  }
}

// ---------------------------------------------------------------- no file picker anywhere
const pkg = JSON.parse(read(join(MOBILE, "package.json")) ?? "{}")
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
check(!("expo-document-picker" in deps), "expo-document-picker is not a dependency of the mobile app")

const sources = []
const walk = (dir) => {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(path)
  }
}
walk(join(MOBILE, "src"))
walk(join(MOBILE, "app"))

for (const path of sources) {
  const body = readFileSync(path, "utf8")
  const relative = path.slice(ROOT.length + 1)
  // A COMMENT EXPLAINING THE ABSENCE IS NOT A RESTORATION. Only real code counts: an import of the
  // picker, or a call into it.
  check(
    !/^\s*import[^\n]*expo-document-picker/m.test(body),
    "no source file imports expo-document-picker",
    relative
  )
  check(!/DocumentPicker\.getDocumentAsync/.test(body), "no source file opens a device file picker", relative)
  check(
    !/images?\/generations|dall-e|gpt-image|generateImage\(/i.test(body),
    "no source file reaches for image generation",
    relative
  )
}

// ---------------------------------------------------------------- no Create Image route
const messagesRoutes = join(MOBILE, "app", "(tabs)", "messages")
if (existsSync(messagesRoutes)) {
  const routes = readdirSync(messagesRoutes, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
  check(!routes.includes("create-image.tsx"), "there is no Create Image screen under Messages", routes.join(", "))
}

if (failures.length > 0) {
  console.error(`FAIL  mobile messenger scope — ${failures.length} of ${checks.length} checks failed`)
  for (const failure of [...new Set(failures)]) console.error(`      ${failure}`)
  process.exit(1)
}

console.log(
  `PASS  mobile messenger scope — ${checks.length} checks: the attach menu is Club Documents, Take Photo, Choose Photo and Contact Card, with no device file picker and no image generation`
)
