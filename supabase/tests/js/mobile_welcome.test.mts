/**
 * THE PUBLIC WELCOME — a brand entrance that grants nothing.
 *
 * What is worth proving is not how it looks (that is the owner's review on a phone) but the
 * things a screen like this can quietly get wrong: that a signed-in person never passes through
 * it, that a signed-out one lands on it, that its two actions go to the canonical places and
 * nowhere new, that the mark it shows is the canonical mark reproduced rather than redrawn, that
 * the two protected originals are byte-for-byte untouched, that Reduce Motion is honoured, and
 * that nothing invented ships in it.
 */

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { test } from "node:test"

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")

// ---------------------------------------------------------------- the gate

test("a signed-out session lands on Welcome, and a signed-in one is never shown it", () => {
  const gate = code("apps/mobile/app/_layout.tsx")
  assert.match(gate, /const onEntrance = group === "welcome" \|\| group === "sign-in" \|\| group === "forgot-password"/)
  assert.match(gate, /status === "signed-out" && !onEntrance\) router\.replace\("\/welcome"\)/)
  // The signed-in branch comes FIRST and sends anyone not in the app into it -- including
  // somebody sitting on /welcome. Recovery still outranks it.
  const order = [gate.indexOf('status === "recovering"'), gate.indexOf('status === "signed-in" && !inApp'), gate.indexOf('status === "signed-out"')]
  assert.ok(order[0] < order[1] && order[1] < order[2], "the gate's branches are out of order")
  assert.match(gate, /status === "signed-in" && !inApp\) router\.replace\("\/\(tabs\)"\)/)
})

test("Welcome is a route with one job and no authority", () => {
  const route = code("apps/mobile/app/welcome.tsx")
  assert.match(route, /router\.push\("\/sign-in"\)/, "Log In does not go to the one sign-in")
  const screen = code("apps/mobile/src/components/welcome/welcome-screen.tsx")
  for (const forbidden of ["supabase", "signUp", "signInWith", "role", "club_id", "player", "guardian", "SecureStore", "AsyncStorage"]) {
    assert.ok(!screen.includes(forbidden), `the Welcome screen reaches for ${forbidden}`)
  }
  assert.match(screen, /Linking\.openURL\(`\$\{webUrl\}\/signup`\)/, "Get Started does not open the canonical web signup")
  assert.ok(!/TextInput/.test(screen), "Welcome collects input")
})

// --------------------------------------------------------------- the words

test("the motto and the two actions are exactly the canonical ones", () => {
  const screen = read("apps/mobile/src/components/welcome/welcome-screen.tsx")
  assert.match(screen, /RUGBY\.\{"\\n"\}/)
  assert.match(screen, /CONNECTED\./)
  assert.match(screen, /Your rugby life, all in one place\./)
  assert.match(screen, /label="Get Started"/)
  assert.match(screen, /accessibilityLabel="Log In"/)
  for (const forbidden of ["Welcome back", "Manage your club", "management platform", "Join Now", "Register Club", "Continue", "Dashboard", "Meal"]) {
    assert.ok(!screen.includes(forbidden), `Welcome says "${forbidden}"`)
  }
})

test("no fabricated club, team or person appears on the entrance", () => {
  for (const file of ["apps/mobile/src/components/welcome/welcome-screen.tsx", "apps/mobile/src/components/welcome/objects.ts", "apps/mobile/src/components/brand.tsx"]) {
    const src = read(file)
    for (const invented of ["Ovalball UAT", "Preston", "Burnley", "RFC", "Under 12", "Ava", "Harry"]) {
      assert.ok(!src.includes(invented), `${file} carries "${invented}"`)
    }
  }
})

// -------------------------------------------------------------- the motion

test("Reduce Motion renders every piece in its final place, and nothing spins or bounces", () => {
  const screen = code("apps/mobile/src/components/welcome/welcome-screen.tsx")
  assert.match(screen, /AccessibilityInfo\.isReduceMotionEnabled\(\)/)
  assert.match(screen, /addEventListener\("reduceMotionChanged"/)
  assert.match(screen, /if \(reduceMotion\) \{\s*\n\s*arrival\.setValue\(1\)\s*\n\s*breath\.setValue\(0\)\s*\n\s*return/)
  // Two ambient behaviours only, both slow; no full rotations, no bounce.
  assert.match(screen, /ambient\?: "turn" \| "float"/)
  assert.match(screen, /period = ambient === "turn" \? 9000 : 7000/)
  assert.match(screen, /outputRange: \[`\$\{base - 1\.5\}deg`, `\$\{base \+ 1\.5\}deg`\]/, "the ball turns more than a few degrees")
  assert.match(screen, /bounciness: 0/)
  assert.ok(!/360deg|Easing\.bounce|Easing\.elastic|setInterval/.test(screen))
})

test("the collage is decoration: hidden from assistive technology and never a touch target", () => {
  const screen = read("apps/mobile/src/components/welcome/welcome-screen.tsx")
  assert.match(screen, /pointerEvents="none"\s*\n\s*accessibilityElementsHidden\s*\n\s*importantForAccessibility="no-hide-descendants"/)
  assert.match(screen, /overflow: "hidden"/)
  // Sized in fractions of the window, not in pixels copied from a screenshot.
  assert.match(screen, /width: 0\.\d+ \* width/)
  assert.ok(!/left: \d{3}|top: \d{3}/.test(screen), "a piece is placed at an absolute pixel")
})

// ---------------------------------------------------------------- the mark

test("the protected originals are byte-for-byte what they were", () => {
  const expected: Record<string, string> = {
    "public/icons/Ovalball Square Logo.png": "fc5abb60b66f2bafe56de45a2cea6a0e9fa41d240068eff96f86c27f2bdb7e50",
    "public/icons/Overball Logo Low Res.png": "3f77df404a5a004e5a917ebd8424620b10ae0ebd8da4122f0e9fdae0f042cb30",
  }
  for (const [file, sha] of Object.entries(expected)) {
    assert.ok(existsSync(file), `${file} is missing`)
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), sha, `${file} has been modified`)
  }
})

test("the mark is the canonical geometry reproduced, not a new drawing", () => {
  const brand = read("apps/mobile/src/components/brand.tsx")
  // The measured outer-minus-inner ring, exactly as fitted to the canonical file.
  assert.match(brand, /A 356\.47 180\.17 -20\.48 1 0/)
  assert.match(brand, /A 287\.35 120\.21 -17\.74 1 0/)
  assert.match(brand, /fillRule="evenodd"/)
  assert.equal((brand.match(/BRAND_GREEN = "#03ac63"/g) ?? []).length, 1)
  // No glow, gradient, bevel or shadow baked into the mark.
  for (const forbidden of ["LinearGradient", "RadialGradient", "shadow", "Glow", "filter"]) {
    assert.ok(!code("apps/mobile/src/components/brand.tsx").includes(forbidden), `the mark has a ${forbidden}`)
  }
  // The wordmark is the file's own letterforms, bundled, in both ground variants.
  for (const asset of ["apps/mobile/assets/welcome/ovalball-wordmark-on-dark.png", "apps/mobile/assets/welcome/ovalball-wordmark-on-light.png", "apps/mobile/assets/welcome/ovalball-mark-master.png"]) {
    assert.ok(existsSync(asset), `${asset} is not bundled`)
    assert.ok(statSync(asset).size > 20_000 && statSync(asset).size < 400_000, `${asset} weighs ${statSync(asset).size}`)
  }
  assert.ok(!existsSync("apps/mobile/assets/welcome/ovalball-wordmark.png"), "a stray wordmark derivative")
  // Nothing under public/icons is referenced by the app: the originals are read by tooling only.
  assert.ok(!/public\/icons/.test(code("apps/mobile/src/components/brand.tsx")))
})

// --------------------------------------------------------------- the assets

test("every collage object is app-owned, bundled and free of domain truth", () => {
  const manifest = read("apps/mobile/src/components/welcome/objects.ts")
  for (const forbidden of ["https://", "uri:", "unsplash", "pexels", "crest", "logo", "club_", "fixture"]) {
    assert.ok(!code("apps/mobile/src/components/welcome/objects.ts").includes(forbidden), `objects.ts carries ${forbidden}`)
  }
  let total = 0
  for (const m of manifest.matchAll(/require\("\.\.\/\.\.\/\.\.\/(assets\/welcome\/[a-z-]+\.(?:png|webp))"\)/g)) {
    const path = `apps/mobile/${m[1]}`
    assert.ok(existsSync(path), `${path} is referenced but not bundled`)
    const size = statSync(path).size
    assert.ok(size > 10_000 && size < 700_000, `${path} weighs ${size}`)
    total += size
  }
  assert.ok(total < 3_500_000, `the collage weighs ${total} bytes -- first launch must be instant`)
})
