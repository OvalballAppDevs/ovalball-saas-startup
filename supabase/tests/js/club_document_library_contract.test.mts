import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  CLUB_DOCUMENT_ALLOWED_MIME_TYPES,
  CLUB_DOCUMENT_MAX_SIZE_BYTES,
  CLUB_DOCUMENT_SIGNED_URL_SECONDS,
  DOCUMENT_CATEGORY_LABEL,
  DOCUMENT_CATEGORY_OPTIONS,
  clubDocumentErrorMessage,
  defaultDocumentTitle,
  documentCategoryLabel,
  documentFileKind,
  folderPaths,
  folderTrail,
  formatFileSize,
  isDocumentCategory,
  librarySearchNeedle,
  shareCountLabel,
  validateClubDocumentFile,
  type LibraryFolder,
} from "../../../packages/contracts/src/documents/library"
import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { CLUB_AUTHORITY_KEYS } from "../../../packages/contracts/src/club/overview"

/**
 * CLUB DOCUMENTS IS ONE LIBRARY ON TWO CLIENTS.
 *
 * The pure rules of the shared contract (`packages/contracts/src/documents/library.ts`), plus structural
 * pins: the categories match the table's own check constraint, the upload rules match the website's
 * server action, the mobile area is reached from the Admin Centre behind `club.documents.view`, and no
 * mobile screen shows a storage path or bucket URL or writes the library without the shared contract.
 */

const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

test("the categories are the table's own check values, in the website's words", () => {
  const migration = readFileSync("supabase/migrations/20260831440000_document_library.sql", "utf8")
  const check = /category in \(([^)]+)\)/.exec(migration)
  assert.ok(check, "the base migration's category check is readable")
  const tableValues = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(DOCUMENT_CATEGORY_OPTIONS.map(([key]) => key), tableValues)
  assert.equal(DOCUMENT_CATEGORY_LABEL.ground_pitch_information, "Ground / Pitch Information")
  assert.equal(documentCategoryLabel("match_day_information"), "Match Day Information")
  // An internal key never reaches a screen, even one the list does not know.
  assert.equal(documentCategoryLabel("committee_minutes"), "Other")
  assert.equal(documentCategoryLabel(null), "Other")
  assert.ok(isDocumentCategory("parking"))
  assert.ok(!isDocumentCategory("Parking"))
  // The website reads the same list.
  assert.match(readFileSync("lib/documents/categories.ts", "utf8"), /from "@ovalball\/contracts\/documents\/categories"/)
})

test("the upload rules are the website's: four formats, 10MB, nothing empty", () => {
  assert.deepEqual([...CLUB_DOCUMENT_ALLOWED_MIME_TYPES], ["application/pdf", "image/jpeg", "image/png", "image/webp"])
  assert.equal(CLUB_DOCUMENT_MAX_SIZE_BYTES, 10 * 1024 * 1024)
  assert.equal(CLUB_DOCUMENT_SIGNED_URL_SECONDS, 3600)
  assert.equal(validateClubDocumentFile({ mimeType: "application/pdf", sizeBytes: 1200 }), null)
  assert.equal(validateClubDocumentFile({ mimeType: "image/webp", sizeBytes: CLUB_DOCUMENT_MAX_SIZE_BYTES }), null)
  assert.equal(validateClubDocumentFile({ mimeType: "application/pdf", sizeBytes: CLUB_DOCUMENT_MAX_SIZE_BYTES + 1 }), "Documents must be 10MB or smaller.")
  assert.equal(validateClubDocumentFile({ mimeType: "application/pdf", sizeBytes: 0 }), "That file appears to be empty.")
  assert.match(validateClubDocumentFile({ mimeType: "application/msword", sizeBytes: 10 }) ?? "", /Unsupported file type/, "Word is a team-document format only")
  assert.match(validateClubDocumentFile({ mimeType: null, sizeBytes: 10 }) ?? "", /Unsupported file type/)
  // The same words the web action returns.
  const web = readFileSync("app/(app)/documents/actions.ts", "utf8")
  for (const sentence of ["Documents must be 10MB or smaller.", "That file appears to be empty.", "Unsupported file type. Upload a PDF, JPEG, PNG, or WEBP."]) {
    assert.ok(web.includes(sentence), `the website still says "${sentence}"`)
  }
})

test("sizes, kinds, titles and share counts read the way a person says them", () => {
  assert.equal(formatFileSize(null), null)
  assert.equal(formatFileSize(0), null)
  assert.equal(formatFileSize(512), "512 B")
  assert.equal(formatFileSize(1100), "1 KB")
  assert.equal(formatFileSize(820 * 1024), "820 KB")
  assert.equal(formatFileSize(1.8 * 1024 * 1024), "1.8 MB")
  assert.deepEqual(documentFileKind("image/png"), { kind: "image", label: "Image" })
  assert.deepEqual(documentFileKind("application/pdf"), { kind: "pdf", label: "PDF" })
  assert.equal(documentFileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document").label, "Word Document")
  assert.equal(documentFileKind("text/plain").kind, "file")
  assert.equal(defaultDocumentTitle("Visitor Guide 2026.pdf"), "Visitor Guide 2026")
  assert.equal(defaultDocumentTitle("parking.map.jpeg"), "parking.map")
  assert.equal(defaultDocumentTitle("README"), "README")
  assert.equal(shareCountLabel(0), null)
  assert.equal(shareCountLabel(1), "Shared in 1 conversation")
  assert.equal(shareCountLabel(3), "Shared in 3 conversations")
})

test("a search can never rewrite the query it is placed in", () => {
  assert.equal(librarySearchNeedle("  visitor   guide "), "visitor guide")
  assert.equal(librarySearchNeedle("a,b)or(id.eq.1"), "a b or id.eq.1")
  assert.equal(librarySearchNeedle("100%_done*"), "100 done")
  assert.equal(librarySearchNeedle(null), "")
  assert.ok(librarySearchNeedle("x".repeat(500)).length <= 80)
})

test("folder paths and the trail follow the parent chain, and a broken chain cannot loop", () => {
  const folders: LibraryFolder[] = [
    { id: "a", name: "Match Day", parentFolderId: null },
    { id: "b", name: "Parking", parentFolderId: "a" },
    { id: "c", name: "Maps", parentFolderId: "b" },
    { id: "d", name: "Archive Papers", parentFolderId: null },
    { id: "x", name: "Loop One", parentFolderId: "y" },
    { id: "y", name: "Loop Two", parentFolderId: "x" },
  ]
  const paths = new Map(folderPaths(folders).map((f) => [f.id, f.path]))
  assert.equal(paths.get("c"), "Match Day / Parking / Maps")
  assert.equal(paths.get("d"), "Archive Papers")
  assert.ok(paths.get("x"), "a cyclic pair still resolves to a name")
  assert.deepEqual(folderPaths(folders).map((f) => f.path), [...folderPaths(folders).map((f) => f.path)].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(folderTrail(folders, "c").map((f) => f.name), ["Match Day", "Parking", "Maps"])
  assert.deepEqual(folderTrail(folders, null), [])
  assert.ok(folderTrail(folders, "x").length <= 2)
})

test("the server's own refusal reaches the person; anything else is the caller's sentence", () => {
  const shared = { code: "P0001", message: "This document has been shared in 2 fixture conversation(s) and cannot be permanently deleted -- archive it instead." }
  assert.equal(clubDocumentErrorMessage(shared, "fallback"), shared.message)
  assert.equal(clubDocumentErrorMessage({ code: "42501", message: "internal detail" }, "fallback"), "You don't have permission to change this club's documents.")
  assert.equal(clubDocumentErrorMessage({ code: "XX000", message: "stack trace" }, "fallback"), "fallback")
  assert.equal(clubDocumentErrorMessage(null, "fallback"), "fallback")
})

test("Club Documents is an Admin Centre section behind club.documents.view, with a native screen", () => {
  const section = ADMIN_CENTRE_SECTIONS.find((s) => s.key === "documents")
  assert.ok(section, "the section exists")
  assert.equal(section!.label, "Club Documents")
  assert.equal(section!.capability, "club.documents.view")
  assert.equal(section!.native, true)
  assert.equal(section!.webPath, "/documents")
  assert.equal(CLUB_AUTHORITY_KEYS.documentsView, "club.documents.view")
  assert.equal(CLUB_AUTHORITY_KEYS.documentsManage, "club.documents.manage")
  assert.ok(existsSync("apps/mobile/app/(tabs)/admin/documents/index.tsx"), "the landing's /admin/documents row has a route")
})

test("mobile Club Documents uses the shared contract, signs on open, and never shows a path or bucket URL", () => {
  const files = [...walk("apps/mobile/src/documents"), ...walk("apps/mobile/app/(tabs)/admin/documents")].filter((f) => /\.tsx?$/.test(f))
  assert.ok(files.length >= 6, "the area's files are where they should be")
  for (const f of files) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("(club_documents|document_folders)"\)/, `${f} writes or reads the tables without the shared contract`)
    assert.doesNotMatch(src, /rpc\("delete_club_document"/, `${f} calls the delete operation itself`)
    assert.doesNotMatch(src, /storage\s*\.from\(|getPublicUrl|createSignedUrl/, `${f} reaches into storage directly`)
    assert.doesNotMatch(src, /\{[^}]*\.storagePath\s*\}/, `${f} renders a storage path`)
    assert.doesNotMatch(src, /AsyncStorage|SecureStore/, `${f} keeps a local copy of library state`)
  }
  const routes = walk("apps/mobile/app/(tabs)/admin/documents").filter((f) => /\.tsx$/.test(f))
  for (const f of routes) assert.ok(code(f).split("\n").filter((l) => l.trim()).length <= 15, `${f} is a thin route module`)
  const library = code("apps/mobile/src/documents/library-screen.tsx")
  assert.match(library, /signDocumentUrl\(supabase, doc\.storagePath\)/, "a URL is signed when the document is opened")
  assert.match(library, /from "\.\.\/messages\/open-attachment"/, "documents open through the one shared opener")
  assert.match(library, /readClubLibraryAuthority\(/, "what is offered comes from the server's capability read")
})
