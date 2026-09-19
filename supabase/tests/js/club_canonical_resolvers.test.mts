import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

/**
 * ONE RESOLVER PER DERIVED CLUB VALUE (Convergence Step 6; command §7, §8, §10).
 *
 * A club's logo and a club's colours are both DERIVED — the logo from the club's
 * own upload falling back to the Club Directory's seed, the theme from
 * `club_kits` falling back to Ovalball's default. Each has exactly one canonical
 * implementation, and the failure mode is not that a screen shows the wrong
 * thing today: it is that the rule gets written out by hand in a tenth place,
 * and then a third source or a deactivated-club clause reaches nine of them.
 *
 * Step 0 recorded "multiple raw logo_storage_path reads and consumers skipping
 * the directory fallback". The second half turned out to be untrue when
 * measured — every consumer checked applied the fallback. They had each
 * re-implemented it: TEN hand-written `a ?? b` chains across four files, all
 * correct, all separately maintained. This test is what stops the eleventh.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")

function sourceFiles(dirs = ["app", "lib", "components"]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"))
    }
  }
  for (const d of dirs) walk(path.join(ROOT, d))
  return out.sort()
}

const FILES = sourceFiles().map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }))

/**
 * The club → directory fallback, written by hand. Deliberately matches the
 * SHAPE rather than a specific variable name, because the ten that existed used
 * ten different names.
 */
const HAND_WRITTEN_LOGO_FALLBACK = /logo_storage_path\s*\?\?\s*[^\n]*?(club_directory|directory_logo|directory\.logo)/

test("no surface re-implements the club logo fallback", () => {
  const offenders = FILES.filter(({ file, source }) => {
    // The resolver itself is where the rule lives.
    if (file === "lib/app-context/club-logo.ts") return false
    return HAND_WRITTEN_LOGO_FALLBACK.test(source)
  }).map((f) => f.file)

  assert.deepEqual(
    offenders,
    [],
    `These write the club-logo fallback by hand. Use resolveClubLogoPath (nested club record) or ` +
      `resolveClubLogoPathFrom (a flat pair, or an unclaimed opponent's directory row) from ` +
      `lib/app-context/club-logo.ts instead.`
  )
})

test("the canonical logo resolver exposes both legitimate call shapes", () => {
  const resolver = readFileSync(path.join(ROOT, "lib/app-context/club-logo.ts"), "utf8")
  for (const name of ["resolveClubLogoPath", "resolveClubLogoPathFrom", "resolveClubLogoUrl", "clubLogoUrlFromPath"]) {
    assert.ok(new RegExp(`export function ${name}\\b`).test(resolver), `${name} must be exported from the one resolver`)
  }
  // The rule is stated once: the nested form delegates rather than repeating `??`.
  assert.ok(
    /return resolveClubLogoPathFrom\(/.test(resolver),
    "resolveClubLogoPath must delegate to resolveClubLogoPathFrom so the fallback exists in exactly one expression"
  )
})

test("only the theme resolver produces club theme variables", () => {
  // THE FIRST DRAFT OF THIS TEST WAS WRONG, and the correction is worth keeping.
  // It flagged every file that selected `primary_colour` from club_kits, which
  // caught four legitimate ones: the Club Settings kit editor, the setup
  // wizard, the agenda and the training centre all load kit rows to hand to
  // `RugbyKit`, the SHIRT renderer. A shirt is not a page theme, and both
  // legitimately read the same table.
  //
  // What §10 actually asks is that changing the canonical kit reaches every
  // themed surface -- which is a property of who produces the CSS variables,
  // not of who reads the table. There is one producer.
  const producers = FILES.filter(({ file, source }) => {
    if (file === "lib/club-theme/theme.ts") return false
    return /--club-[a-z-]+\s*["'`]?\s*:/.test(source) || /clubThemeVariables\s*=/.test(source)
  }).map((f) => f.file)

  assert.deepEqual(
    producers,
    [],
    `These build club theme CSS variables themselves. clubThemeVariables in lib/club-theme/theme.ts is ` +
      `the one producer, so a kit change reaches every themed surface at once.`
  )
})

test("the theme resolver is the only place a default club colour is declared", () => {
  const resolver = readFileSync(path.join(ROOT, "lib/club-theme/theme.ts"), "utf8")
  assert.ok(/OVALBALL_DEFAULT_KIT/.test(resolver), "the fallback kit must be declared in the resolver")
  assert.ok(
    /export function resolveClubTheme\b/.test(resolver) && /export function clubThemeVariables\b/.test(resolver),
    "resolveClubTheme and clubThemeVariables are the canonical pair"
  )
})
