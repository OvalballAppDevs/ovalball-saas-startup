/**
 * PARENT HOME — ONE TRUTH, SEVERAL PRESENTATIONS.
 *
 * The rebuild's whole risk is that a prettier Home grows its own answers. So what
 * is asserted here is not how it looks, it is that every attractive thing on it is
 * the SAME canonical value the rest of the app draws:
 *
 *   the hero and the Calendar card are one participant match projection;
 *   the club's colours are its own home kit, made safe rather than replaced;
 *   the membership is the GoCardless domain, not a local boolean;
 *   a section with no canonical content is not drawn at all.
 */

import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { test } from "node:test"

import {
  clubAccentsOnDark,
  heroActionLabel,
  heroKindLabel,
  projectFamily,
  projectHomeHero,
  projectParticipantMatch,
  resolveClubTheme,
  MANDATE_STATUS_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  MAX_HERO_PAGES,
  type AgendaItem,
  type AgendaSide,
} from "@ovalball/contracts"
import { contrastRatio } from "@ovalball/contracts/club/colour"

import { routeForAgendaItem } from "../../../apps/mobile/src/links/destinations"

const FOREST = "#071c14"
const TODAY = "2026-10-01"

const OURS: AgendaSide = {
  directoryId: "d1", clubName: "Ovalball UAT RUFC", teamName: "Under 12 Boys",
  compactName: "U12", rugbyCode: "union", crestUrl: "https://crest/ours.png", kit: null,
}
const THEIRS: AgendaSide = {
  directoryId: "d2", clubName: "Preston Grasshoppers RFC", teamName: "Under 12 Boys",
  compactName: "U12", rugbyCode: "union", crestUrl: "https://crest/theirs.png", kit: null,
}

const CHILDREN = [
  { playerId: "p-1", firstName: "Ava", surname: "Whitaker", fullName: "Ava Whitaker", teamId: "t1", teamName: "Under 12 Boys", clubId: "c1", clubName: "Ovalball UAT RUFC", avatarStoragePath: null },
  { playerId: "p-2", firstName: "George", surname: "Whitaker", fullName: "George Whitaker", teamId: "t2", teamName: "Under 10 Boys", clubId: "c1", clubName: "Ovalball UAT RUFC", avatarStoragePath: null },
]
const FAMILY = projectFamily(CHILDREN, new Map())

function event(o: Partial<AgendaItem> & { key: string; date: string }): AgendaItem {
  return {
    kind: "fixture", eventId: o.key, time: "10:30", meetTime: "09:45", us: OURS, them: THEIRS,
    homeAway: "Home", venue: "Ovalball UAT Ground", pitch: null, status: "Booked",
    gameType: "League Fixture", result: null, playerId: "p-1", childFirstName: "Ava",
    attendance: null, teamId: "t1", clubId: "c1", href: null, ...o,
  } as AgendaItem
}
const session = (o: Partial<AgendaItem> & { key: string; date: string }) =>
  event({ kind: "training", them: null, homeAway: null, status: null, gameType: null, time: "18:00", venue: "Prairie Playing Fields", ...o })

// --------------------------------------------- one truth, several presentations

test("the Home hero and the Calendar card are the SAME participant match", () => {
  const item = event({ key: "sat", date: "2026-10-03" })
  const hero = projectHomeHero([item], FAMILY, TODAY)[0]
  const card = projectParticipantMatch(item, FAMILY)

  // Presentation may differ. Truth may not.
  assert.equal(hero.item.eventId, item.eventId)
  assert.deepEqual(hero.match?.home, card.home)
  assert.deepEqual(hero.match?.away, card.away)
  assert.equal(hero.match?.ourOrientation, card.ourOrientation)
  assert.equal(hero.match?.kickoff, card.kickoff)
  assert.equal(hero.match?.meetTime, card.meetTime)
  assert.equal(hero.match?.venue, card.venue)
  assert.equal(hero.match?.matchType, card.matchType)
  assert.equal(hero.match?.classification, card.classification)
  assert.deepEqual(hero.match?.child, card.child)
})

test("an away hero puts the opposition's crest on the left, as the card does", () => {
  const away = event({ key: "away", date: "2026-10-03", homeAway: "Away" })
  const hero = projectHomeHero([away], FAMILY, TODAY)[0]
  assert.equal(hero.match?.home?.clubName, "Preston Grasshoppers RFC")
  assert.equal(hero.match?.home?.crestUrl, "https://crest/theirs.png")
  assert.equal(hero.match?.away?.isOurs, true)
})

test("the training hero is the same training projection, with no invented opponent", () => {
  const hero = projectHomeHero([session({ key: "tue", date: "2026-10-06" })], FAMILY, TODAY)[0]
  assert.equal(hero.kind, "training")
  assert.equal(hero.training?.title, "Training Session")
  assert.equal(hero.match, null)
  assert.ok(!hero.training!.spoken.includes("versus"))
})

// --------------------------------------------------------------- hero ordering

test("the hero leads with what is genuinely next, not with a category", () => {
  const pages = projectHomeHero(
    [event({ key: "match", date: "2026-10-10" }), session({ key: "session", date: "2026-10-02" })],
    FAMILY,
    TODAY
  )
  assert.deepEqual(pages.map((p) => p.key), ["session", "match"])
  assert.equal(heroKindLabel(pages[0].kind), "NEXT TRAINING")
  assert.equal(heroKindLabel(pages[1].kind), "NEXT MATCH")
})

test("both kinds earn a page even when several of one come first", () => {
  const pages = projectHomeHero(
    [
      event({ key: "m1", date: "2026-10-03" }),
      event({ key: "m2", date: "2026-10-04" }),
      event({ key: "m3", date: "2026-10-05" }),
      session({ key: "late-session", date: "2026-10-20" }),
    ],
    FAMILY,
    TODAY
  )
  assert.ok(pages.some((p) => p.kind === "training"), "a family's next session lost its page to a third match")
  assert.ok(pages.length <= MAX_HERO_PAGES, "the hero became a list")
})

test("a cancelled event is never what a parent is told to get ready for", () => {
  const pages = projectHomeHero(
    [event({ key: "off", date: "2026-10-02", status: "Cancelled" }), event({ key: "on", date: "2026-10-03" })],
    FAMILY,
    TODAY
  )
  assert.deepEqual(pages.map((p) => p.key), ["on"])
})

test("nothing upcoming is an honest empty hero rather than a page of nothing", () => {
  assert.deepEqual(projectHomeHero([event({ key: "gone", date: "2026-09-20" })], FAMILY, TODAY), [])
  assert.deepEqual(projectHomeHero([], FAMILY, TODAY), [])
})

test("an outstanding answer is asked where the event is", () => {
  const needs = projectHomeHero([event({ key: "a", date: "2026-10-03", attendance: null })], FAMILY, TODAY)[0]
  const answered = projectHomeHero([event({ key: "b", date: "2026-10-03", attendance: "UNSURE" })], FAMILY, TODAY)[0]
  assert.equal(needs.needsAnswer, true)
  assert.equal(answered.needsAnswer, false, "Unsure is an answer and must not be chased")
})

test("each hero page names its own child, so a family of two is never ambiguous", () => {
  const pages = projectHomeHero(
    [event({ key: "ava", date: "2026-10-03", playerId: "p-1" }), session({ key: "george", date: "2026-10-02", playerId: "p-2", childFirstName: "George" })],
    FAMILY,
    TODAY
  )
  assert.deepEqual(pages.map((p) => (p.match ?? p.training)!.child?.shortLabel), ["George", "Ava"])
})

test("a participant's hero goes to a participant centre and says so", () => {
  assert.equal(heroActionLabel("match"), "View Match Centre")
  assert.equal(heroActionLabel("training"), "View Training Centre")
  for (const kind of ["parent", "family", "player"] as const) {
    assert.equal(routeForAgendaItem(event({ key: "a", date: "2026-10-03" }), kind)!.pathname, "/fixtures/[fixtureId]/match-centre")
    assert.equal(routeForAgendaItem(session({ key: "t", date: "2026-10-03" }), kind)!.pathname, "/calendar/training/[sessionId]")
  }
})

// ------------------------------------------------- the club's own colours, safely

function accentsFor(primary: string, secondary: string, accent: string | null = null) {
  return clubAccentsOnDark(resolveClubTheme({ primaryColour: primary, secondaryColour: secondary, accentColour: accent, pattern: "HOOPS" }), FOREST)
}

test("a club's accents come from its canonical home kit, not a mobile table", () => {
  const navyGold = accentsFor("#1b2a5e", "#d4af37")
  assert.equal(navyGold.source, "home-kit")
  // No mapping of club to colour anywhere in the app.
  const source = readFileSync("packages/contracts/src/club/accent.ts", "utf8")
  assert.match(source, /theme\.kit\.primary/)
  assert.ok(!/Ovalball UAT|Preston|Burnley/.test(source), "a club is named in the colour projection")
})

test("a very dark kit is lifted until it can be seen on forest", () => {
  const nearBlack = accentsFor("#0a0a0a", "#111111")
  assert.ok(nearBlack.contrast.primaryOnDark >= 3, `near-black primary at ${nearBlack.contrast.primaryOnDark}:1`)
  assert.ok(nearBlack.contrast.secondaryOnDark >= 3)
})

test("a very light kit still reads, and its text still reads on it", () => {
  const whiteAndYellow = accentsFor("#ffffff", "#ffe600")
  assert.ok(whiteAndYellow.contrast.primaryOnDark >= 3)
  assert.ok(whiteAndYellow.contrast.onPrimary >= 4.5, `ink on a white accent at ${whiteAndYellow.contrast.onPrimary}:1`)
})

test("two shades of one colour are still told apart", () => {
  // A kit in two blues would otherwise draw a ball in one colour badly printed.
  const twoBlues = accentsFor("#1b2a5e", "#22337a")
  assert.ok(twoBlues.contrast.primaryVsSecondary >= 1.4, `accents at ${twoBlues.contrast.primaryVsSecondary}:1 of each other`)
  // And the second colour is still the club's own, pushed away from the first --
  // never a third colour the app chose for them.
  assert.notEqual(twoBlues.primary, twoBlues.secondary)
})

test("materially different clubs get materially different accents", () => {
  const navyGold = accentsFor("#1b2a5e", "#d4af37")
  const redGreen = accentsFor("#b3121c", "#0f7a3d")
  assert.notEqual(navyGold.primary, redGreen.primary)
  assert.notEqual(navyGold.secondary, redGreen.secondary)
})

test("a club with no recorded kit gets Ovalball's own, and says so", () => {
  const none = clubAccentsOnDark(resolveClubTheme(null), FOREST)
  assert.equal(none.source, "ovalball-default")
  assert.ok(none.contrast.primaryOnDark >= 3)
})

test("the page is chalk, and the club is an accent on it — never the ground", () => {
  const home = readFileSync("apps/mobile/app/(tabs)/index.tsx", "utf8")
  // The screen's own ground is the app's light surface, whatever the club wears,
  // and the header stands on it in its ordinary chalk tone.
  assert.match(home, /backgroundColor: surface\.page/)
  assert.ok(!/backgroundColor: surface\.forest\b/.test(home), "Home is painted forest again")
  assert.ok(!/tone="forest"/.test(home), "the header is on the dark ground again")
  assert.ok(!/accents\.primary\s*\}\}\s*>\s*<ScrollView/.test(home), "the club's colour became the page")
})

test("a club's accent is made safe on a white card, not just on forest", () => {
  // A white or yellow kit as a rule down a white notice would vanish; the
  // projection darkens the club's own colour until it stands 3:1 off white.
  for (const [p, sec, acc] of [
    ["#14532d", "#ffffff", "#f59e0b"],
    ["#ffffff", "#ffe600", null],
    ["#1b2a5e", "#d4af37", null],
    ["#87ceeb", "#ffffff", null],
  ] as const) {
    const a = accentsFor(p, sec, acc)
    assert.ok(contrastRatio(a.highlightOnLight, "#ffffff") >= 3, `${p}: accent on white at ${contrastRatio(a.highlightOnLight, "#ffffff").toFixed(2)}:1`)
  }
  // And a club with no kit gets forest, the one accent every surface may fall to.
  assert.equal(clubAccentsOnDark(resolveClubTheme(null), FOREST).highlightOnLight.length, 7)
})

// ------------------------------------------------------------ the membership

test("the subscription words are the provider's, never collapsed", () => {
  assert.equal(MANDATE_STATUS_LABEL.submitted, "Submitted to your bank, not yet active")
  assert.equal(MANDATE_STATUS_LABEL.active, "Active")
  assert.equal(SUBSCRIPTION_STATUS_LABEL.pending, "Set up, first collection not yet due")
  // "Paid" would flatten two genuinely different provider facts.
  assert.ok(!Object.values(MANDATE_STATUS_LABEL).includes("Paid"))
})

test("family payment authority is the family's, never a staff finance capability", () => {
  const source = readFileSync("packages/contracts/src/subscriptions/family.ts", "utf8")
  assert.match(source, /get_enrolment_eligibility/, "the family-facing authority is not used")
  assert.ok(!/finance\.subscription\.view/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "a staff capability gates a parent's view")
})

test("mobile keeps no payment state of its own", () => {
  const source = readFileSync("packages/contracts/src/subscriptions/family.ts", "utf8")
  for (const table of ["gocardless_subscriptions", "gocardless_mandates", "gocardless_billing_requests"]) {
    assert.ok(source.includes(table), `${table} is not read`)
  }
  // No local boolean, no shadow table, nothing copied between clients. Prose
  // explaining that must not be mistaken for the thing.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")
  for (const forbidden of [/mobile_subscription/, /isActive\s*=/, /localStatus/, /\bsynchronis/i, /\bcache\b/]) {
    assert.ok(!forbidden.test(code), `the projection keeps its own state: ${forbidden}`)
  }
})

test("a provider processing state is not dressed up as a task", () => {
  const source = readFileSync("packages/contracts/src/subscriptions/family.ts", "utf8")
  // Only a genuine absence or a genuine failure is attention.
  assert.match(source, /attention: "setup_required"/)
  assert.match(source, /failed \? "failed" : "none"/)
})

test("the mandate is entered on the provider's own pages, never natively", () => {
  const home = readFileSync("apps/mobile/app/(tabs)/index.tsx", "utf8")
  assert.match(home, /parent\/players\/\$\{subscription\.playerId\}\/subscription/)
  for (const forbidden of ["sort code", "account number", "TextInput"]) {
    assert.ok(!home.includes(forbidden), `Home collects bank details: ${forbidden}`)
  }
})

// --------------------------------------------- what the old Home no longer has

test("Home no longer duplicates Fixtures or the Calendar", () => {
  // The note explaining why they were removed must not be read as their presence.
  const home = readFileSync("apps/mobile/app/(tabs)/index.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n")
  for (const gone of ["This Week", "ThisWeek", "Quick Actions", "More Than Rugby", "AgendaRow", "onOpenCalendar"]) {
    assert.ok(!home.includes(gone), `Home still carries "${gone}"`)
  }
})

test("no section is drawn without canonical content behind it", () => {
  const sections = readFileSync("apps/mobile/src/components/home/sections.tsx", "utf8")
  assert.match(sections, /const notice = notices\[0\]\s*\n\s*if \(!notice\) return null/)
  assert.match(sections, /if \(news\.length === 0\) return null/)
  // And the membership card is rendered per subscription that actually exists.
  const home = readFileSync("apps/mobile/app/(tabs)/index.tsx", "utf8")
  assert.match(home, /summary\.subscriptions\.map\(/)
})

test("no fabricated club, news, announcement or membership text ships", () => {
  for (const file of [
    "apps/mobile/app/(tabs)/index.tsx",
    "apps/mobile/src/components/home/sections.tsx",
    "apps/mobile/src/components/home/rugby-hero.tsx",
  ]) {
    const src = readFileSync(file, "utf8")
    for (const invented of ["Club Membership", "Valid until", "A Great Start", "Training on Friday", "Preston Grasshoppers", "Ovalball UAT"]) {
      assert.ok(!src.includes(invented), `${file} bakes in "${invented}" from the mock-up`)
    }
  }
})

test("there is no rugby ball on Home — not drawn, not resized, not moved", () => {
  // The owner rejected the generated ball outright. It is gone, and nothing
  // draws another: no ellipse, no ball component, no ball asset.
  assert.ok(!existsSync("apps/mobile/src/components/home/club-ball.tsx"), "the ball component is back")
  const hero = readFileSync("apps/mobile/src/components/home/rugby-hero.tsx", "utf8")
  for (const forbidden of ["ClubBall", "club-ball", "<Ellipse", "hoopPath", "ball.png", "ball.jpg", "ball.svg"]) {
    assert.ok(!hero.includes(forbidden), `the hero still has a ball: ${forbidden}`)
  }
  assert.ok(!existsSync("apps/mobile/assets/editorial/ball.jpg"))
})

test("the artwork is the app's own, bundled, and never fetched or invented in code", () => {
  const editorial = readFileSync("apps/mobile/src/components/home/editorial.ts", "utf8")
  for (const forbidden of ["https://", "uri:", "unsplash", "pexels", "placeholder.com"]) {
    assert.ok(!editorial.includes(forbidden), `an editorial asset is fetched: ${forbidden}`)
  }
  // Every reference is a bundled file that actually exists and weighs something.
  for (const file of editorial.matchAll(/require\("\.\.\/\.\.\/\.\.\/(assets\/editorial\/[a-z-]+\.jpg)"\)/g)) {
    const path = `apps/mobile/${file[1]}`
    assert.ok(existsSync(path), `${path} is referenced but not bundled`)
    assert.ok(statSync(path).size > 20_000, `${path} is not a real photograph`)
    assert.ok(statSync(path).size < 600_000, `${path} is too heavy for a phone bundle`)
  }
  // The two heroes and all four news fallbacks are wired, not left null.
  assert.ok(!/heroMatch: null|heroTraining: null/.test(editorial), "a hero has no artwork")
  for (const key of ["matchday", "training", "community", "general"]) {
    assert.match(editorial, new RegExp(`${key}: require\\("\\.\\./\\.\\./\\.\\./assets/editorial/rugby-${key}\\.jpg"\\)`), `the ${key} news fallback is missing`)
  }
  // And none of it carries domain truth: no club, no crest, no kit, no fixture.
  for (const forbidden of ["crest", "logo", "kit", "fixture", "club_", "Ovalball UAT"]) {
    assert.ok(!editorial.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").includes(forbidden), `editorial.ts reaches into the domain: ${forbidden}`)
  }
})

test("a news card shows the club's own photograph first, and an editorial one only in its absence", () => {
  const sections = readFileSync("apps/mobile/src/components/home/sections.tsx", "utf8")
  assert.match(sections, /article\.heroUrl \? \(/, "a news card has no branded fallback")
  assert.match(sections, /editorial\.news\.(matchday|training|community|general)/)
  for (const forbidden of ["unsplash", "pexels", "placeholder.com", "https://"]) {
    assert.ok(!sections.includes(forbidden), `sections fetch ${forbidden}`)
  }
})

test("the header still shows the signed-in person, not the selected child", () => {
  const header = readFileSync("apps/mobile/src/components/app-header.tsx", "utf8")
  assert.match(header, /<PersonAvatar name=\{person\.firstName\} url=\{person\.avatarUrl\}/)
  const home = readFileSync("apps/mobile/app/(tabs)/index.tsx", "utf8")
  assert.ok(!/person\.avatarUrl/.test(home), "Home reaches past the header for an identity")
})

// -------------------------------------------- the visual correction, pinned

test("the hero ground is dark, and chalk text reads on it for every kit", () => {
  // The rejected build painted the hero the lifted kit colour -- pale grey -- and
  // wrote white on it. The ground is now forest tinted toward the club and
  // clamped dark; the projection measures chalk on it and refuses to lighten past
  // 4.5:1, whatever the kit is.
  for (const [p, sec, acc] of [
    ["#14532d", "#ffffff", "#f59e0b"], // the review club: green / white / amber
    ["#ffffff", "#ffe600", null],       // a white kit, the case that broke
    ["#1b2a5e", "#d4af37", null],
    ["#0a0a0a", "#111111", null],
  ] as const) {
    const a = accentsFor(p, sec, acc)
    assert.ok(a.contrast.chalkOnHero >= 4.5, `${p}: chalk on hero at ${a.contrast.chalkOnHero.toFixed(2)}:1`)
    assert.ok(a.heroBase !== a.primary, `${p}: the hero ground is the raw accent again`)
  }
})

test("a wash is eight per cent club colour over forest, not ninety-two", () => {
  // `mix(a, b, t)` is t of b. The first build had the arguments reversed.
  const a = accentsFor("#ffffff", "#ffe600")
  assert.ok(a.contrast.chalkOnHero >= 4.5)
  const washLightness = parseInt(a.wash.slice(1, 3), 16)
  assert.ok(washLightness < 0x40, `a white club's wash is ${a.wash} -- that is a pale card again`)
})

test("the review club resolves to its canonical kit, and the amber is what personalises it", () => {
  const a = accentsFor("#14532d", "#ffffff", "#f59e0b")
  assert.equal(a.source, "home-kit")
  // Its green primary lifts to near-white on forest, so the chromatic highlight
  // -- the club's own amber -- is what the chips and the active dot use.
  assert.equal(a.highlight, "#f59e0b")
  assert.ok(a.contrast.onPrimary >= 4.5)
})

test("training never kicks off, and a match never merely starts", () => {
  const hero = readFileSync("apps/mobile/src/components/home/rugby-hero.tsx", "utf8")
  assert.match(hero, /function timeLine\(page: HeroPage\)/)
  assert.match(hero, /if \(page\.kind === "match"\) \{\s*\n\s*return \[start \? `KO \$\{start\}`/)
  assert.match(hero, /return start \? `Starts \$\{start\}` : "Time to be confirmed"/)
  // No "KO" on any code path that a session can reach.
  const training = hero.split('if (page.kind === "match")')[1]?.split("}")[1] ?? ""
  assert.ok(!/KO /.test(training), "a training card can still say KO")
})

test("the training hero says the team once", () => {
  const hero = readFileSync("apps/mobile/src/components/home/rugby-hero.tsx", "utf8")
  assert.match(hero, /const subtitle = match \? `vs \$\{sideLabel\(match\.away\)\}` : null/)
})

test("the hero is at most one match and one session — never a carousel of filler", () => {
  assert.equal(MAX_HERO_PAGES, 2)
  const pages = projectHomeHero(
    [event({ key: "m1", date: "2026-10-03" }), event({ key: "m2", date: "2026-10-04" }), session({ key: "s", date: "2026-10-06" }), session({ key: "s2", date: "2026-10-08" })],
    FAMILY, TODAY
  )
  assert.deepEqual(pages.map((p) => p.key), ["m1", "s"])
  assert.equal(projectHomeHero([event({ key: "only", date: "2026-10-03" })], FAMILY, TODAY).length, 1, "one thing coming is one page and no dots")
})

test("the hero is a photograph beneath a controlled overlay, and the words are native", () => {
  const hero = readFileSync("apps/mobile/src/components/home/rugby-hero.tsx", "utf8")
  assert.match(hero, /editorial\.heroMatch : editorial\.heroTraining/, "the artwork is not chosen by kind")
  assert.match(hero, /accessible=\{false\}/, "the artwork is announced as content")
  assert.match(hero, /id="heroShade"/, "no controlled dark overlay")
  assert.match(hero, /stopColor=\{colour\.forest950\}/, "the overlay is not forest")
  // Every fact is text over the picture, never baked into it.
  assert.match(hero, /\{heroKindLabel\(page\.kind\)\}/)
  assert.match(hero, /<ClubCrest clubName=\{clubName\} url=\{crestUrl\}/)
  assert.match(hero, /text=\{timeLine\(page\)\}/)
  // A card that has no artwork falls back to the club-tinted forest, not a hole.
  assert.match(hero, /stopColor=\{accents\.heroBase\}/)
})

test("the call to action is refined — chalk on the photograph, never a painted club button", () => {
  const hero = readFileSync("apps/mobile/src/components/home/rugby-hero.tsx", "utf8")
  const cta = hero.split("THE CALL TO ACTION")[1] ?? ""
  assert.match(cta, /backgroundColor: colour\.chalk/)
  assert.ok(!/backgroundColor: accents\.highlight/.test(cta.split("</Pressable>")[0]), "the action is the club's amber block again")
  assert.match(cta, /color: colour\.forest800/)
})

test("announcements, news and the membership live on light cards with dark type", () => {
  const sections = readFileSync("apps/mobile/src/components/home/sections.tsx", "utf8")
  assert.match(sections, /backgroundColor: surface\.card/)
  for (const dark of ["surface.forestRaised", "surface.forest,", "onForest.primary", "accents.wash", "accents.heroBase"]) {
    assert.ok(!sections.includes(dark), `a section is still on the dark ground: ${dark}`)
  }
  assert.match(sections, /color: colour\.ink\b/)
  // The club's colour is a rule and a dot, sized in single digits.
  assert.match(sections, /width: 4, backgroundColor: rule/)
  assert.match(sections, /width: 6, height: 6, borderRadius: 3, backgroundColor: accents\.highlightOnLight/)
  // The membership's colour is its state, never the club.
  const membership = sections.split("export function SubscriptionStatusCard")[1] ?? ""
  assert.ok(!/accents\./.test(membership.split("const card =")[0]), "the membership card is painted in club colours")
})
