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
  // CA-M11: Get Started and the invitation screen joined the entrance group; the rule is unchanged.
  assert.match(gate, /const onEntrance = group === "welcome" \|\| group === "get-started" \|\| group === "sign-in" \|\| group === "forgot-password" \|\| onJoin/)
  assert.match(gate, /status === "signed-out" && !onEntrance\) router\.replace\("\/welcome"\)/)
  // The signed-in branch comes FIRST and sends anyone not in the app into it -- including
  // somebody sitting on /welcome. Recovery still outranks it.
  const order = [gate.indexOf('status === "recovering"'), gate.indexOf('status === "signed-in" && !inApp'), gate.indexOf('status === "signed-out"')]
  assert.ok(order[0] < order[1] && order[1] < order[2], "the gate's branches are out of order")
  assert.match(gate, /status === "signed-in" && !inApp && !onStepUp && !onJoin\) router\.replace\("\/\(tabs\)"\)/)
})

test("Welcome is a route with one job and no authority", () => {
  const route = code("apps/mobile/app/welcome.tsx")
  assert.match(route, /router\.push\("\/sign-in"\)/, "Log In does not go to the one sign-in")
  const screen = code("apps/mobile/src/components/welcome/welcome-screen.tsx")
  for (const forbidden of ["supabase", "signUp", "signInWith", "role", "club_id", "player", "guardian", "SecureStore", "AsyncStorage"]) {
    assert.ok(!screen.includes(forbidden), `the Welcome screen reaches for ${forbidden}`)
  }
  // CA-M11: Get Started enters the app's own decision screen, whose CLUB path is the canonical web signup.
  assert.match(route, /router\.push\("\/get-started"\)/, "Get Started does not enter the native decision screen")
  assert.ok(!screen.includes("/signup"), "the Welcome screen still opens the website blind")
  const decision = code("apps/mobile/app/get-started.tsx")
  assert.match(decision, /Linking\.openURL\(`\$\{webUrl\}\$\{path\.webPath\}`\)/, "the club path does not open the canonical web signup")
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
  for (const file of ["apps/mobile/src/components/welcome/welcome-screen.tsx", "apps/mobile/src/components/welcome/still.ts", "apps/mobile/src/components/brand.tsx"]) {
    const src = read(file)
    for (const invented of ["Ovalball UAT", "Preston", "Burnley", "RFC", "Under 12", "Ava", "Harry"]) {
      assert.ok(!src.includes(invented), `${file} carries "${invented}"`)
    }
  }
})

// -------------------------------------------------------------- the motion

test("Reduce Motion holds the still, and nothing loops, spins or bounces", () => {
  const screen = code("apps/mobile/src/components/welcome/welcome-screen.tsx")
  assert.match(screen, /AccessibilityInfo\.isReduceMotionEnabled\(\)/)
  assert.match(screen, /addEventListener\("reduceMotionChanged"/)
  assert.match(screen, /if \(reduceMotion\) \{\s*\n\s*push\.setValue\(0\)\s*\n\s*return/)
  // One slow push-in, once; no loop, no rotation, no bounce.
  assert.match(screen, /duration: 12000/)
  assert.match(screen, /outputRange: \[1, 1\.06\]/)
  assert.match(screen, /bounciness: 0/)
  assert.ok(!/Animated\.loop|rotate|Easing\.bounce|Easing\.elastic|setInterval/.test(screen))
  // The motto's line-height is never below its size: that is what clipped RUGBY. on the device.
  assert.match(screen, /lineHeight: Math\.round\(motto \* 1\.0\)/)
})

test("the still is decoration: hidden from assistive technology and never a touch target", () => {
  const screen = read("apps/mobile/src/components/welcome/welcome-screen.tsx")
  assert.match(screen, /pointerEvents="none"\s*\n\s*accessibilityElementsHidden\s*\n\s*importantForAccessibility="no-hide-descendants"/)
  assert.match(screen, /contentFit="cover"/)
  assert.ok(!/left: \d{3}|top: \d{3}/.test(screen), "something is placed at an absolute pixel")
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

test("the still is app-owned, bundled, and free of domain truth", () => {
  const still = read("apps/mobile/src/components/welcome/still.ts")
  for (const forbidden of ["https://", "uri:", "unsplash", "pexels", "crest", "club_", "fixture"]) {
    assert.ok(!code("apps/mobile/src/components/welcome/still.ts").includes(forbidden), `still.ts carries ${forbidden}`)
  }
  const m = still.match(/require\("\.\.\/\.\.\/\.\.\/(assets\/welcome\/[a-z-]+\.(?:jpg|png|webp))"\)/)
  assert.ok(m, "no still is wired")
  const path = `apps/mobile/${m![1]}`
  assert.ok(existsSync(path), `${path} is referenced but not bundled`)
  const size = statSync(path).size
  assert.ok(size > 100_000 && size < 1_200_000, `${path} weighs ${size}`)
})
