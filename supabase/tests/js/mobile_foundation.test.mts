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
    /*
      WHAT THIS IS LOOKING FOR: authority DECIDED here, from a role or a context.

      It is about the right-hand side, not the variable name. Two earlier shapes
      of this rule fired on correct code and would have been switched off for it:
      `canManage =` caught `const canManage = canManageConversationParticipants(
      ctx, parties)` -- a value the shared contract computed from the server's
      answer -- and a broader `can[A-Z]\w* = ...` caught `canSave={draft !==
      value}`, which is a form's dirty check and has nothing to do with
      permission.

      The defect is a client reading a ROLE NAME or the SELECTED CONTEXT and
      concluding what somebody may do. That is what is matched.
    */
    const DECIDED_HERE = new RegExp(
      [
        // a role name compared against, anywhere
        String.raw`(role|roleLabel|permission)\s*===\s*["'][A-Za-z_ ]+["']`,
        // the selected context deciding an action
        String.raw`(active|context)\.kind\s*===\s*["']\w+["']\s*(&&|\?)\s*\w*(can|allow|edit|manage|delete)`,
        // the one explicit historical shape
        String.raw`\bcanEditFixture\b`,
      ].join("|"),
      "i"
    )
    assert.ok(!DECIDED_HERE.test(src), `${file} looks like it decides authority from a role or the selected context`)
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
  // Nothing secret is displayed: recovery codes are not shown "just in case", no secret, no QR. (CA-M11:
  // the screen may NAME the website's recovery-code route as a hand-off; it never shows a code.)
  assert.ok(!/secret|qr|recoveryCodes|issue_my_first_recovery_codes|regenerate_my_recovery_codes/i.test(verify), "the verification screen shows enrolment material")
})

test("a person's picture and a club's crest cannot be substituted for one another", () => {
  const identity = strip(read("src/components/identity.tsx"))
  // The web's defect was a `fallback` prop that made substitution POSSIBLE. There must be nowhere to
  // pass a kit, rather than a convention that nobody does.
  assert.ok(!/fallback/.test(identity), "an identity component accepts a fallback image again")
  assert.ok(!/kit/i.test(identity), "an identity component knows what a kit is")

  /*
    A KIT IS ITS OWN COMPONENT, AND IT IS THE ONLY ONE.

    This used to forbid a kit anywhere in the app, because at the time nothing
    had a legitimate reason to draw one -- the identity module's own comment said
    so, and said that when one arrived it would be its own component. M6 is that
    arrival: the Match Centre hero shows the crest and the playing shirt side by
    side at equal size, because a child recognises the shirt they are about to
    put on far faster than a club badge.

    The rule the guard exists for is UNCHANGED and is the important one: a kit
    may never stand in for a person's picture or a club's crest. So the kit
    renderer and the surfaces that deliberately draw one are named, and
    everywhere else is still refused -- which is the same discipline the web
    arrived at by removing the `fallback` prop rather than by asking people not
    to use it.
  */
  // The kit renderer itself, and the Match Centre, whose header IS about what the
  // two sides wear. It moved out of the route tree at P3, when the fixture console
  // stopped being addressable and both surfaces became components the canonical
  // route chooses between.
  const MAY_DRAW_A_KIT = new Set([
    "src/components/rugby-kit.tsx",
    "src/fixtures/match-centre.tsx",
  ])
  for (const file of FILES) {
    if (MAY_DRAW_A_KIT.has(file)) continue
    const src = strip(read(file))
    assert.ok(!/RugbyKit|kitUrl|kit_config/.test(src), `${file} reaches for a kit`)
  }

  // And the kit component itself may not know what a person or a club is.
  const kit = strip(read("src/components/rugby-kit.tsx"))
  assert.ok(!/PersonAvatar|ClubCrest|avatar/i.test(kit), "the kit renderer reaches for an identity picture")
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

test("every destination that is not built says so, and says it as a real screen", () => {
  // The rule is not to pretend functionality exists, and the temptation is to answer that with an
  // empty list -- which is worse, because an empty list says "you have no fixtures" rather than "this
  // is not finished". Each one names what it WILL hold, so it is a foundation to build into rather
  // than a placeholder to tear out.
  /*
    DISCOVERED, NOT LISTED.

    This named four screens and asserted every one was still a foundation.
    Calendar and Fixtures were then BUILT -- they are directories with a real
    `index.tsx` now -- and the assertion started reading files that no longer
    exist. It had been failing quietly ever since, which is the one thing a guard
    must not do: the rule it protects (an unfinished destination says so rather
    than showing an empty list) is still worth protecting, and a red guard
    protects nothing.

    So the tabs are discovered and each is judged on what it is. A screen that
    renders the foundation must say what it will hold; a screen that does not is
    a finished destination and is left alone. Building one therefore RETIRES its
    entry automatically instead of breaking this test.
  */
  const tabs = FILES.filter((f) => /^app\/\(tabs\)\/[^/]+(\.tsx|\/index\.tsx)$/.test(f))
  assert.ok(tabs.length > 0, "no tab destinations were found at all")
  let foundations = 0
  for (const screen of tabs) {
    const src = read(screen)
    if (!/DestinationFoundation/.test(src)) continue
    foundations += 1
    assert.match(src, /willHold=\{\[/, `${screen} is a foundation but does not say what it will hold`)
  }
  // Recorded rather than asserted at a number: the count falls as the product is
  // built, and a test that pinned it would have to be edited every time -- which
  // is how the list above went stale.
  assert.ok(foundations >= 0, "unreachable")
  const foundation = read("src/components/destination.tsx")
  assert.match(foundation, /WHAT WILL BE HERE/, "the foundation state lost its heading")
})

test("and no unfinished destination is solved with a WebView", () => {
  // Native app means native product. Opening the website is legitimate for the jobs that are
  // deliberately web-only, and it happens in the SYSTEM browser -- an embedded browser pretending to
  // be the app is the thing this must never become.
  for (const file of FILES) {
    const src = strip(read(file))
    assert.ok(!/WebView|react-native-webview/.test(src), `${file} embeds a WebView`)
  }
  assert.match(strip(read("src/components/destination.tsx")), /Linking\.openURL/, "the web handoff no longer uses the system browser")
})

test("the launch canvas gets out of the way rather than fading in place", () => {
  // While it fades it is still a full-screen view over the product: without this a tap lands on
  // decoration and a screen reader can focus a layer on its way out. Found by an axe run timed to the
  // fade, which is where a VoiceOver user actually lives.
  const launch = strip(read("src/components/launch.tsx"))
  assert.match(launch, /pointerEvents=\{fading \? "none" : "auto"\}/, "the fading canvas still takes taps")
  assert.match(launch, /accessibilityElementsHidden=\{fading\}/, "the fading canvas is still in the accessibility tree")
})


test("a message bubble is coloured and ordered the way the website does it", () => {
  // THE FIRST DRAFT HAD IT INVERTED -- forest for mine, white for received -- which misattributes
  // every message on the screen to the wrong side for anybody who learned the product in a browser.
  // The website is blue-right for your own and mint-left for received, newest at the top.
  const bubble = strip(read("app/(tabs)/messages/[kind]/[id].tsx"))
  assert.match(bubble, /mine \? colour\.messengerBlue : colour\.mint100/, "the bubble colours no longer match the website")
  assert.match(bubble, /const mine = message\.isOwn/, "ownership is derived from something other than the server's answer")
  assert.ok(!/senderUserId === /.test(bubble), "ownership is recomputed from a sender id")
  // Newest at the top, as the web thread sorts it -- and a virtualised list, because a club thread
  // can run for a season and a ScrollView would build every message before the first frame.
  assert.match(bubble, /new Date\(b\.createdAt\)\.getTime\(\) - new Date\(a\.createdAt\)\.getTime\(\)/, "the thread is not newest-first")
  assert.ok(!/scrollToEnd/.test(bubble), "the thread scrolls to the oldest message after sending")
  assert.match(bubble, /<FlatList/, "the conversation renders every message rather than a window")

  // And the website still says the same thing, so this test fails if the product changes rather than
  // quietly describing a rule that has moved.
  const web = readFileSync("components/messenger/message-thread.tsx", "utf8")
  assert.match(web, /isOwn[\s\S]{0,120}bg-messenger-blue/, "the website no longer colours your own messages blue")
  assert.match(web, /!m\.isOwn && "bg-mint-100/, "the website no longer colours received messages mint")
})
