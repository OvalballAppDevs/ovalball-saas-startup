#!/usr/bin/env node
/**
 * CLUB DIGITAL HOME -- structural guard.
 *
 * The club homepage, its news and its announcements rest on a few
 * architectural promises that a later change could quietly break without
 * any test turning red. This script reads the source and fails if one does:
 *
 *   1. ONE THEME ENGINE. Club branding comes from the home kit through
 *      lib/club-theme/theme.ts. No other file resolves a club theme or mints
 *      --club-* colour variables.
 *   2. ONE ARTICLE RENDERER, AND NO HTML. Article markup is parsed only by
 *      lib/club-content/markup.ts and rendered only by
 *      components/club-home/article-body.tsx. Nothing on these surfaces uses
 *      dangerouslySetInnerHTML.
 *   3. AUTHORITY IS CONSUMED, NEVER RE-DERIVED. No role-string checks in the
 *      club content, public club or club home code, and no direct writes to
 *      the content tables from TypeScript -- every write is a database
 *      function that asks internal.may_edit_club_content /
 *      may_publish_club_content.
 *   4. THE PUBLIC LOADERS SELECT NO PRIVATE FIELDS. Meet times, notes,
 *      changing rooms, pitch and venue detail, competition sync errors, and
 *      who created or published content never appear in a public select.
 *   5. NO SECOND COLOUR SETTING. Nothing adds a website/brand colour beside
 *      the home kit.
 *
 *   node scripts/verify-club-digital-home.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir)
  let entries
  try {
    entries = readdirSync(abs)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const rel = path.join(dir, name)
    const st = statSync(path.join(ROOT, rel))
    if (st.isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(rel)
  }
  return out
}

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8")
const APP_SOURCES = [...walk("app"), ...walk("components"), ...walk("lib")]
const FEATURE_DIRS = ["lib/club-content", "lib/club-public", "lib/club-theme", "components/club-home", "components/club-content", "app/club/[slug]", "app/(app)/club/settings/news", "app/(app)/teams/[teamId]/news"]
const FEATURE_SOURCES = FEATURE_DIRS.flatMap((d) => walk(d))

if (FEATURE_SOURCES.length === 0) failures.push("no club digital home sources were found -- the guard is looking in the wrong place")

// 1. One theme engine ---------------------------------------------------------
for (const file of APP_SOURCES) {
  const src = read(file)
  if (file !== "lib/club-theme/theme.ts" && /export function resolveClubTheme\b/.test(src)) failures.push(`${file}: defines a second resolveClubTheme`)
  if (file !== "lib/club-theme/theme.ts" && /["'`]--club-[a-z-]+["'`]\s*:/.test(src)) failures.push(`${file}: mints --club-* variables outside the theme engine`)
}

// 2. One renderer, no HTML ----------------------------------------------------
for (const file of APP_SOURCES) {
  const src = read(file)
  if (/\bparseArticleBody\(/.test(src) && !["lib/club-content/markup.ts", "components/club-home/article-body.tsx"].includes(file)) {
    failures.push(`${file}: renders article markup itself -- use components/club-home/article-body.tsx`)
  }
}
for (const file of FEATURE_SOURCES) {
  if (/dangerouslySetInnerHTML\s*[=:]/.test(read(file))) failures.push(`${file}: uses dangerouslySetInnerHTML on a club content surface`)
}

// 3. Authority consumed -------------------------------------------------------
for (const file of FEATURE_SOURCES) {
  const src = read(file)
  for (const pattern of [/role\s*===?\s*["'`]/, /["'`](CLUB_ADMIN|TEAM_ADMIN|TEAM_MANAGER|TEAM_STAFF|team_admin)["'`]/, /\broleLabel\b/, /isClubAdminAnywhere/]) {
    if (pattern.test(src)) failures.push(`${file}: role-string authority check (${pattern}) -- consume the capability adapters instead`)
  }
}
for (const file of APP_SOURCES) {
  const src = read(file)
  if (/from\(\s*["'`]club_(articles|announcements)["'`]\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/.test(src.replace(/\s+/g, " "))) {
    failures.push(`${file}: writes a club content table directly -- use the database functions in lib/club-content/actions.ts`)
  }
}

// 4. Public loaders select no private fields ----------------------------------
const PRIVATE = /\b(meet_time|notes|changing_room|pitch_allocation|pitch_id|venue_address|venue_id|sync_error|created_by|updated_by|published_by|mirror_fixture_id)\b/
const PUBLIC_LOADERS = [...walk("lib/club-public"), ...walk("app/club/[slug]")]
for (const file of PUBLIC_LOADERS) {
  const src = read(file)
  for (const m of src.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
    const hit = PRIVATE.exec(m[2])
    if (hit) failures.push(`${file}: public select includes private field "${hit[1]}"`)
  }
  const cols = /ARTICLE_COLUMNS\s*=\s*(["'`])([\s\S]*?)\1/.exec(src)
  if (cols && PRIVATE.test(cols[2])) failures.push(`${file}: ARTICLE_COLUMNS includes a private field`)
}

// 5. No second colour setting -------------------------------------------------
const migration = readdirSync(path.join(ROOT, "supabase/migrations")).find((f) => f.endsWith("_a_club_has_a_home.sql"))
if (!migration) failures.push("the club digital home migration is missing")
else if (/\b(website|brand|theme|primary)_colou?r\b/i.test(read(path.join("supabase/migrations", migration)))) {
  failures.push(`${migration}: adds a colour setting beside the home kit`)
}

if (failures.length) {
  console.error("  FAIL  club_digital_home_structure")
  for (const f of failures) console.error(`          ${f}`)
  process.exit(1)
}
console.log(`  ok    club_digital_home_structure        ${FEATURE_SOURCES.length} files checked`)
