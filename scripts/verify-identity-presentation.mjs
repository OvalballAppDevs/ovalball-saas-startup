#!/usr/bin/env node
/**
 * THREE CONCEPTS, AND NONE OF THEM IS A FALLBACK FOR ANOTHER.
 *
 *   A CLUB LOGO / CREST is a club's mark.
 *   A KIT is what the team plays in.
 *   A PERSON'S AVATAR is somebody's face.
 *
 * They were conflated. `CrestPlate` passed the club's home shirt into `ClubAvatar` as a fallback, on
 * the stated reasoning that a shirt is "the next most recognisable thing a club owns" -- so Preston
 * Grasshoppers, which has no crest, was represented by an illustration of a shirt everywhere its
 * identity appeared: the Club Desk hero, the public club home, the chrome bars. Worse, `ClubAvatar`
 * discarded a REAL crest that happened to render small and showed the shirt instead, so uploading a
 * badge would not necessarily have fixed it.
 *
 * The owner's rule is that club presentation can never return kit artwork and person presentation can
 * never return club artwork. The prop that made the first possible is gone; this keeps it gone, and
 * catches the next component that reaches for the same shortcut.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const SEARCH_DIRS = ["app", "components", "lib"]

/** The club-identity component. Nothing may hand it arbitrary artwork to show instead of a crest. */
const CLUB_IDENTITY = "ClubAvatar"
/** The kit illustration. Legitimate only where the product is deliberately showing kit. */
const KIT = "RugbyKit"
/** The person-identity component. */
const PERSON = "UserAvatar"

/**
 * Files allowed to render kit artwork, because they are about kit.
 * A new entry needs a reason, and "the crest was missing" is not one.
 */
const KIT_SURFACES = new Map([
  ["app/(app)/club/kit-section.tsx", "the kit configuration and preview screen -- kit IS the subject"],
  ["components/club/rugby-kit.tsx", "the kit illustration itself"],
  ["components/club-home/home-sections.tsx", "the public club page's own 'our kit' section"],
  ["components/fixtures/match-centre/hero.tsx", "match kit: what each side is playing in today"],
  ["components/training/training-centre/hero.tsx", "training kit"],
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const problems = []
let clubSurfaces = 0
let kitSurfaces = 0

for (const dir of SEARCH_DIRS) {
  let files
  try {
    files = walk(join(ROOT, dir))
  } catch {
    continue
  }
  for (const file of files) {
    const rel = relative(ROOT, file)
    const raw = readFileSync(file, "utf8")
    // Comments stripped: this repository documents the defect it fixed, at length, and a guard that
    // matches its own commentary reports its own history as a regression.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

    const usesClub = src.includes(`<${CLUB_IDENTITY}`)
    const usesKit = src.includes(`<${KIT}`)
    const usesPerson = src.includes(`<${PERSON}`)
    if (usesClub) clubSurfaces += 1
    if (usesKit) kitSurfaces += 1

    // 1. Nothing may reintroduce a way to pass artwork into club identity.
    if (usesClub && /<ClubAvatar[^>]*\sfallback=/.test(src)) {
      problems.push(`${rel}: passes a \`fallback\` into ${CLUB_IDENTITY}. Club identity has exactly two outcomes -- the crest, or the club's initials.`)
    }

    // 2. A file that shows both a club's identity and a kit is where the two get confused. Allowed
    //    only where kit is genuinely the subject.
    if (usesClub && usesKit && !KIT_SURFACES.has(rel)) {
      problems.push(`${rel}: renders both ${CLUB_IDENTITY} and ${KIT}. If this is a kit surface, declare it in KIT_SURFACES with a reason; if it is club identity, it must not reach for the shirt.`)
    }

    // 3. A person is never represented by a club's mark.
    if (usesPerson && /<UserAvatar[^>]*\savatarUrl=\{[^}]*(logoUrl|crestUrl|clubLogo)/.test(src)) {
      problems.push(`${rel}: feeds club artwork into ${PERSON}. A person's avatar is their own photo, or their initials.`)
    }

    // 4. And a club is never represented by somebody's face.
    if (usesClub && /<ClubAvatar[^>]*\slogoUrl=\{[^}]*(avatarUrl|avatar_storage|personAvatar)/.test(src)) {
      problems.push(`${rel}: feeds a personal avatar into ${CLUB_IDENTITY}.`)
    }
  }
}

if (problems.length > 0) {
  console.error(`FAIL  identity_presentation  ${problems.length} conflation(s):`)
  for (const p of problems) console.error(`          ${p}`)
  process.exit(1)
}

// A zero here would mean the component names changed and this guard quietly stopped looking.
if (clubSurfaces === 0 || kitSurfaces === 0) {
  console.error(
    `FAIL  identity_presentation  found ${clubSurfaces} club-identity and ${kitSurfaces} kit surface(s) -- the guard has stopped recognising this codebase`,
  )
  process.exit(1)
}

console.log(
  `  ok    identity_presentation              ${clubSurfaces} club-identity surface(s), ${kitSurfaces} kit surface(s), ${KIT_SURFACES.size} declared as kit-about-kit`,
)
