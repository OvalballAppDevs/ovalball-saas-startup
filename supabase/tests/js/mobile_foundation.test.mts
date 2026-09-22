import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

/**
 * THE MOBILE FOUNDATION'S NON-NEGOTIABLES.
 *
 * An installed app is a file on a device its owner controls, so everything in the bundle is published.
 * These assertions are about the two things that would be expensive to discover later: a privileged
 * secret compiled into the binary, and an authority decision taken on the handset.
 *
 * They are source assertions on purpose. The journey itself is proved in a browser
 * (`scripts/browser-verification/91-mobile-foundation.mjs`, 27 assertions), but a secret leaking into a
 * bundle is not something a journey notices -- it is something a reader has to look for, so it is
 * looked for here, every run, by name.
 */

const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(`${MOBILE}/${p}`, "utf8")
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(`${MOBILE}/${dir}`, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) sources(path, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(path)
  }
  return acc
}

const FILES = [...sources("src"), ...sources("app"), "app.config.ts"]

test("the app has real source to check", () => {
  assert.ok(FILES.length >= 15, `only ${FILES.length} mobile source files found`)
})

test("no privileged credential can reach the bundle", () => {
  // Named rather than pattern-matched, because these are the actual secrets this platform holds and a
  // clever regex over "key" flags every keyboard handler in the app.
  const FORBIDDEN = [
    "SERVICE_ROLE",
    "service_role",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOCARDLESS_CLIENT_SECRET",
    "GOCARDLESS_WEBHOOK_SECRET",
    "ZEPTOMAIL",
    "TURNSTILE_SECRET_KEY",
    "INVITATION_PEPPER",
    "SUPABASE_ACCESS_TOKEN",
  ]
  for (const file of FILES) {
    const src = strip(read(file))
    for (const secret of FORBIDDEN) {
      assert.ok(!src.includes(secret), `${file} references ${secret}`)
    }
  }
})

test("configuration is read only from the public Expo channel", () => {
  // Anything the app reads at runtime arrives through `extra`, which is compiled in and public. A
  // direct `process.env` read in app code would be a second, unreviewed channel into the bundle.
  for (const file of FILES) {
    if (file === "app.config.ts") continue
    const src = strip(read(file))
    assert.ok(!/process\.env\.(?!NODE_ENV)/.test(src), `${file} reads process.env directly instead of the app config`)
  }
  const config = strip(read("app.config.ts"))
  // Only EXPO_PUBLIC_ variables, whose name says they are public.
  const reads = [...config.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1])
  for (const name of reads) {
    assert.ok(name.startsWith("EXPO_PUBLIC_"), `app.config.ts reads ${name}, which is not a public variable`)
  }
})

test("no capability is decided on the device", () => {
  // The rule the brief states outright: the client may render, navigate, collect input and ask. What a
  // person may DO is the server's answer. A local `canEdit` would be wrong the moment a Club Admin
  // changed a permission, and would be a security boundary on hardware an attacker owns.
  for (const file of FILES) {
    const src = strip(read(file))
    assert.ok(
      !/\bcanEditFixture\b|\bcanManage\b\s*=|\bisClubAdmin\b\s*=|context\.kind\s*===\s*["']team["']\s*(&&|\?)\s*(can|allow)/.test(src),
      `${file} looks like it decides authority from the selected context`
    )
  }
})

test("the session is stored in the platform's secure store, not beside ordinary data", () => {
  const store = strip(read("src/auth/session-store.ts"))
  assert.match(store, /expo-secure-store/, "the session store does not use the platform secure store")
  assert.match(store, /Platform\.OS !== "web"/, "the store does not distinguish the platform that has no secure store")
  const client = strip(read("src/auth/supabase.ts"))
  assert.match(client, /storage: sessionStore/, "the Supabase client does not use the secure session store")
  // A browser redirect mechanism has no place in a native client; a deep link delivers the callback.
  assert.match(client, /detectSessionInUrl: false/, "the native client still expects a browser URL callback")
})

test("the assurance level comes from the auth server and fails closed", () => {
  const session = strip(read("src/auth/session.tsx"))
  assert.match(session, /getAuthenticatorAssuranceLevel/, "MFA state is not asked of the auth server")
  assert.match(session, /nextLevel === "aal2"/, "the step-up condition is not the canonical one")
  // If assurance cannot be established, the session must NOT be treated as fully authenticated.
  assert.match(session, /return "needs-mfa"/, "an assurance failure does not fail closed")
  const verify = strip(read("app/verify.tsx"))
  assert.match(verify, /mfa\.challenge/, "the verification screen does not open a canonical challenge")
  assert.match(verify, /mfa\.verify/, "the verification screen does not verify canonically")
  // Nothing secret is displayed: enrolment is a web job, and recovery codes are not shown "just in case".
  assert.ok(!/recovery|secret|qr/i.test(verify), "the verification screen shows enrolment material")
})

test("a person's picture and a club's crest cannot be substituted for one another", () => {
  const identity = strip(read("src/components/identity.tsx"))
  // The web's defect was a `fallback` prop that made substitution POSSIBLE. There must be nowhere to
  // pass a kit, rather than a convention that nobody does.
  assert.ok(!/fallback/.test(identity), "an identity component accepts a fallback image again")
  assert.ok(!/kit/i.test(identity), "an identity component knows what a kit is")
  for (const file of FILES) {
    const src = strip(read(file))
    assert.ok(!/RugbyKit|kitUrl|kit_config/.test(src), `${file} reaches for a kit`)
  }
})

test("the club crest is resolved by the canonical rule, not re-derived", () => {
  const home = strip(read("src/context/home-data.ts"))
  assert.match(home, /clubLogoUrlFromPath/, "the club crest is not resolved through the canonical helper")
})

test("contexts come from the shared reader, and nothing reimplements them", () => {
  const contexts = strip(read("src/context/contexts.tsx"))
  assert.match(contexts, /from "@ovalball\/contracts"/, "the context provider does not use the shared package")
  assert.match(contexts, /listSwitchableContexts/, "the app builds its own context list")
  assert.match(contexts, /getSessionContext/, "the app reads the session context itself")
  // The list of context kinds must never be written down in the app: it belongs to the platform.
  for (const file of FILES) {
    const src = strip(read(file))
    assert.ok(
      !/"site_admin"\s*\|\s*"club"|\["site_admin",/.test(src),
      `${file} keeps its own copy of the context kinds`
    )
  }
})

test("a person is never shown a raw database or auth error", () => {
  const translate = strip(read("src/errors/translate.ts"))
  assert.match(translate, /PGRST|jwt expired|42501/i, "the error translator does not recognise the platform's own failures")
  // The original text must be carried for a developer and never rendered.
  assert.match(translate, /detail/, "the translator discards the detail a developer needs")

  // EVERY CAUGHT FAILURE GOES THROUGH THE TRANSLATOR. This is the rule that matters, and it is checked
  // where the failure is caught rather than where a string is rendered: a screen that renders
  // `error.message` is fine when `error` is already a FriendlyError, and catastrophic when it is a
  // PostgrestError. Following the value is not something a regex can do, so the PRODUCER is pinned --
  // if every catch hands its error to `friendly`, no raw text exists to be rendered.
  for (const file of FILES) {
    if (file.includes("errors/translate")) continue
    const src = strip(read(file))
    const catches = [...src.matchAll(/catch\s*\(([^)]*)\)\s*\{([\s\S]*?)\n  \}/g)]
    for (const [, binding, body] of catches) {
      const name = binding.trim().split(/[:\s]/)[0]
      if (!name) continue
      assert.match(body, /friendly\(/, `${file} catches ${name} without translating it`)
    }
    // And no raw failure is interpolated into a string a person could read.
    assert.ok(
      !/\$\{(error|err|e)\.message\}|String\((error|err)\)/.test(src),
      `${file} puts a raw failure into text`
    )
  }

  // The two providers are where a Supabase failure actually arrives, so they must be the ones holding
  // the translator.
  for (const provider of ["src/auth/session.tsx", "src/context/contexts.tsx"]) {
    assert.match(strip(read(provider)), /friendly\(/, `${provider} does not translate failures`)
  }
})

test("every destination that is not built says so", () => {
  // The brief's rule: do not pretend functionality exists. An empty list reads as "you have nothing",
  // which is a worse lie than "this is not built yet".
  for (const screen of ["app/(tabs)/calendar.tsx", "app/(tabs)/hub.tsx", "app/(tabs)/fixtures.tsx"]) {
    assert.match(read(screen), /ComingSoon/, `${screen} does not say it is unfinished`)
  }
  const ui = read("src/components/ui.tsx")
  assert.match(ui, /Coming in this mobile build/, "the unfinished-destination state lost its wording")
})
