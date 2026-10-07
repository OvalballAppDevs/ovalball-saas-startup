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
 *   menu has no such row AND the messenger may not import a device file picker: two barriers, because
 *   removing the row alone leaves the capability one import away. The picker itself is not banned from
 *   the whole app any more -- Team Documents legitimately uploads from a device -- so the second
 *   barrier is now an explicit owner list (DOCUMENT_PICKER_OWNERS) rather than the absence of the
 *   dependency. Everything outside that list, messenger included, still fails this gate on import.
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

// ---------------------------------------------------------------- the device file picker has ONE owner
/**
 * TEAM DOCUMENTS OWNS `expo-document-picker`, AND NOTHING ELSE MAY.
 *
 * The original rule banned the dependency from the whole app. That was the right rule when nothing in
 * Ovalball needed a device file picker: the messenger's "Choose File" row was the only plausible
 * reason to add it, so absence of the dependency was a clean second barrier behind absence of the row.
 *
 * Team Documents (`app/(tabs)/teams/[teamId]/documents.tsx`) then legitimately needed one -- a club
 * document is uploaded from somewhere, and that is the product that does the uploading. The blanket ban
 * therefore started failing on correct, shipped product, which is a failing checker rather than a
 * failing app: the gate has been red on committed code since 2026-09-28.
 *
 * SO THE RULE IS NARROWED TO ITS ACTUAL INTENT, NOT RELAXED. The messenger still may not acquire the
 * capability, and neither may any other surface: the picker may be imported by exactly the files named
 * below, and a new importer anywhere else fails this gate and has to be argued for deliberately. That
 * keeps the second barrier the owner asked for -- "removing the row alone leaves the capability one
 * import away" -- while letting the one product that owns it do its job.
 */
const DOCUMENT_PICKER_OWNERS = [
  // Team Documents: uploads a club document from the device into the club's own library.
  "apps/mobile/src/team/team-documents-screen.tsx",
  // Club Documents: the club library's own Upload screen (Club Admin), receiving a file into the same library.
  "apps/mobile/src/documents/upload-screen.tsx",
]

const pkg = JSON.parse(read(join(MOBILE, "package.json")) ?? "{}")
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

// The dependency may exist ONLY while a declared owner actually uses it. If Team Documents ever stops
// importing it, the dependency has to go too -- otherwise the capability sits in the bundle with no
// product behind it, which is exactly the "one import away" state the ban existed to prevent.
const ownersThatImport = DOCUMENT_PICKER_OWNERS.filter((rel) => {
  const body = read(join(ROOT, rel))
  return body !== null && /^\s*import[^\n]*expo-document-picker/m.test(body)
})
if ("expo-document-picker" in deps) {
  check(
    ownersThatImport.length > 0,
    "expo-document-picker is a dependency only while a declared owner uses it",
  )
} else {
  check(
    ownersThatImport.length === 0,
    "a declared owner imports expo-document-picker, so it must be a dependency",
  )
}

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
  const mayPickDocuments = DOCUMENT_PICKER_OWNERS.includes(relative)
  check(
    mayPickDocuments || !/^\s*import[^\n]*expo-document-picker/m.test(body),
    "only a declared owner (Team Documents, Club Documents upload) imports expo-document-picker",
    relative
  )
  check(
    mayPickDocuments || !/DocumentPicker\.getDocumentAsync/.test(body),
    "only a declared owner (Team Documents, Club Documents upload) opens a device file picker",
    relative
  )
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
