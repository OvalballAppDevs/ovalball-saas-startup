import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { afterExploreNext, dedupeByHref, entityTypeOfHref, exploreNext, hubEntityTypeLabel, relatedEntities, type HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"
import { conceptQuickCheck, glossaryQuickCheck, officiatingCall, stableHash } from "@ovalball/contracts/rugby-hub/quick-check"
import type { GameKnowledgeBundle } from "@ovalball/contracts/rugby-hub/game-knowledge-types"
import type { HeritageEntry } from "@ovalball/contracts/rugby-hub/heritage-data"
import { orderedGroupKeys, storyOfTheDay } from "../../../apps/mobile/src/hub/experience/landing"

/**
 * THE RUGBY HUB EXPERIENCE LAYER -- what makes the graph tactile on a phone.
 *
 * Explore Next, Keep Exploring, Quick Check and What Would You Call? are all DERIVED from the
 * canonical bundles the website reads: nothing here has content of its own, nothing is random,
 * and the type of a destination is read from its canonical href, never guessed from a title.
 */

const ROOT = resolve(import.meta.dirname, "../../..")
const HUB_APP = resolve(ROOT, "apps/mobile/app/(tabs)/hub")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p)
  }
  return out
}

function gameBundle(): GameKnowledgeBundle {
  const concept = (contentKey: string, title: string, summary: string, whyItMatters: string | null = null) => ({
    id: `id-${contentKey}`,
    contentKey,
    title,
    summary,
    rugbyCode: null,
    whyItMatters,
    whatHappens: null,
    whatToWatchFor: null,
    whatHappensNext: null,
    unionLeagueDifference: null,
    family: "PHASES",
    journeyOrder: 1,
  })
  return {
    concepts: [concept("the-ruck", "The ruck", "What a ruck is."), concept("the-maul", "The maul", "What a maul is."), concept("the-scrum", "The scrum", "What a scrum is."), concept("the-lineout", "The lineout", "What a lineout is.")],
    positionsByConcept: new Map([["id-the-ruck", [{ positionId: "p1", positionKey: "flanker", rugbyCode: "union", displayName: "Flanker", shirtNumber: 6 }]]]),
    skillsByConcept: new Map([["id-the-ruck", [{ skillId: "s1", skillKey: "rucking", displayName: "Rucking" }]]]),
    relatedByConcept: new Map([
      [
        "id-the-ruck",
        [
          // The TITLE lies about the type: it says Glossary, the href is an officiating concept.
          { title: "Glossary: the ruck", href: "/rugby-hub/officiating/ruck-decisions" },
          { title: "Ruck", href: "/rugby-hub/glossary/ruck" },
          { title: "Ruck (again)", href: "/rugby-hub/glossary/ruck" },
          { title: "Tackle", href: "/rugby-hub/game/the-tackle" },
        ],
      ],
    ]),
    regulatoryFactsByConcept: new Map([["id-the-ruck", [{ factKey: "ruck.offside", valueText: "Players must join a ruck from behind the hindmost foot." }]]]),
  } as unknown as GameKnowledgeBundle
}

test("an entity's type comes from its canonical href, never from its title", () => {
  assert.equal(entityTypeOfHref("/rugby-hub/glossary/ruck")?.type, "GLOSSARY_TERM")
  assert.equal(entityTypeOfHref("/rugby-hub/officiating/ruck-decisions")?.type, "OFFICIATING_CONCEPT")
  assert.equal(entityTypeOfHref("/rugby-hub/positions/union/flanker")?.type, "POSITION")
  assert.equal(entityTypeOfHref("/rugby-hub/rules#section-ruck.offside")?.type, "RULE")
  assert.equal(entityTypeOfHref("https://example.org/anything"), null)

  const related = relatedEntities({ domain: "game", bundle: gameBundle() }, "id-the-ruck")
  const lying = related.find((e) => e.href === "/rugby-hub/officiating/ruck-decisions")
  assert.ok(lying)
  assert.equal(lying.type, "OFFICIATING_CONCEPT", "a title saying 'Glossary' must not make it a glossary term")
  for (const e of related) assert.equal(e.type, entityTypeOfHref(e.href)?.type, `${e.href} typed from its href`)
})

test("relationships are deduplicated by href and keep canonical order", () => {
  const related = relatedEntities({ domain: "game", bundle: gameBundle() }, "id-the-ruck")
  const hrefs = related.map((e) => e.href)
  assert.equal(new Set(hrefs).size, hrefs.length, "no href appears twice")
  assert.equal(hrefs.filter((h) => h === "/rugby-hub/glossary/ruck").length, 1)
  // related knowledge first, then skills, positions, rules -- the order the website lists them in
  assert.deepEqual(hrefs, ["/rugby-hub/officiating/ruck-decisions", "/rugby-hub/glossary/ruck", "/rugby-hub/game/the-tackle", "/rugby-hub/skills/rucking", "/rugby-hub/positions/union/flanker", "/rugby-hub/rules#section-ruck.offside"])
  assert.deepEqual(
    dedupeByHref([
      { type: "SKILL", key: "a", title: "A", href: "/rugby-hub/skills/a", via: "SKILL" },
      null,
      { type: "SKILL", key: "a", title: "A twice", href: "/rugby-hub/skills/a", via: "SKILL" },
    ]).map((e) => e.title),
    ["A"]
  )
  assert.equal(relatedEntities({ domain: "game", bundle: gameBundle() }, "id-nothing").length, 0)
})

test("exploreNext is deterministic and spreads across entity types before repeating one", () => {
  const related = relatedEntities({ domain: "game", bundle: gameBundle() }, "id-the-ruck")
  const a = exploreNext(related)
  const b = exploreNext(related)
  assert.deepEqual(a, b)
  assert.equal(a.length, 4)
  const types = a.map((e) => e.type)
  assert.equal(new Set(types).size, 4, `four different types first: ${types.join(", ")}`)
  // With limit 6 the fifth and sixth fill from what is left, still in canonical order.
  const six = exploreNext(related, 6).map((e) => e.href)
  assert.equal(six.length, 6)
  assert.equal(six[0], "/rugby-hub/officiating/ruck-decisions")
  // Keep Exploring shows what Explore Next did not take, or everything when too little is left.
  const rest = afterExploreNext(related, a)
  assert.equal(rest.length, 2, "two left over is enough for a foot of two rows")
  for (const e of rest) assert.ok(!a.some((x) => x.href === e.href))
  assert.equal(afterExploreNext(related, exploreNext(related, 5)).length, related.length, "one left over: the foot shows the full list rather than one row")
  const restOfSix = afterExploreNext(related, exploreNext(related, 3))
  assert.equal(restOfSix.length, 3)
  for (const e of restOfSix) assert.ok(!a.slice(0, 3).some((x) => x.href === e.href))
  for (const t of ["GAME_CONCEPT", "GLOSSARY_TERM", "RULE", "POSITION", "SKILL", "STORY", "CLUB", "RUGBY_PERSON", "RUGBY_TEAM", "COMPETITION_GUIDE", "PARENT_GUIDE", "COACHING_CONCEPT", "PLAYER_DEVELOPMENT_CONCEPT", "OFFICIATING_CONCEPT"] as const) {
    assert.ok(hubEntityTypeLabel(t).length > 0, `${t} has a human label`)
  }
})

test("a quick check is deterministic, has at least two answers, and says only what the canon says", () => {
  const b = gameBundle()
  const concept = b.concepts[0]
  const explore: HubRelatedEntity[] = [{ type: "GLOSSARY_TERM", key: "ruck", title: "Ruck", href: "/rugby-hub/glossary/ruck", via: "RELATED_KNOWLEDGE" }]
  const one = conceptQuickCheck(concept, b.concepts, explore)
  const two = conceptQuickCheck(concept, b.concepts, explore)
  assert.ok(one)
  assert.deepEqual(one, two)
  assert.equal(one.id, "concept:the-ruck")
  assert.ok(one.options.length >= 2 && one.options.length <= 4)
  assert.equal(one.options.filter((o) => o.correct).length, 1)
  assert.ok(one.options.some((o) => o.correct && o.label === "The ruck"))
  // Every word shown is a canonical field: the summary in the prompt, titles as answers, whyItMatters/summary as explanation.
  assert.ok(one.prompt.includes(concept.summary))
  for (const o of one.options) assert.ok(b.concepts.some((c) => c.title === o.label), `answer '${o.label}' is a real sibling title`)
  assert.equal(one.explanation, concept.summary)
  assert.deepEqual(one.explore, explore)
  // The subject must not be among its own distractors.
  assert.equal(one.options.filter((o) => o.key === "the-ruck").length, 1)
  // Too few siblings: no check rather than a check with one answer.
  assert.equal(conceptQuickCheck(concept, b.concepts.slice(0, 2)), null)
  assert.equal(conceptQuickCheck(concept, [concept]), null)

  const terms = [
    { termKey: "ruck", displayTerm: "Ruck", plainLanguageDefinition: "A contest on the ground.", rugbyCode: "union" as const },
    { termKey: "maul", displayTerm: "Maul", plainLanguageDefinition: "A contest on the feet.", rugbyCode: "union" as const },
    { termKey: "scrum", displayTerm: "Scrum", plainLanguageDefinition: "A restart with packs bound.", rugbyCode: null },
    { termKey: "play-the-ball", displayTerm: "Play-the-ball", plainLanguageDefinition: "The league restart after a tackle.", rugbyCode: "league" as const },
  ]
  const g = glossaryQuickCheck(terms[0], terms)
  assert.ok(g)
  assert.deepEqual(g, glossaryQuickCheck(terms[0], terms))
  assert.equal(g.id, "glossary:ruck")
  assert.ok(g.prompt.includes(terms[0].plainLanguageDefinition))
  assert.ok(!g.options.some((o) => o.label === "Play-the-ball"), "a union term is never checked against a league term")
  assert.equal(g.options.find((o) => o.correct)?.label, "Ruck")
  assert.equal(g.explanation, terms[0].plainLanguageDefinition)
  assert.equal(glossaryQuickCheck(terms[0], terms.slice(0, 2)), null)
})

test("What Would You Call? derives its scenario, answers and reveal from the concept and its family", () => {
  const family = [
    { contentKey: "knock-on", title: "Knock-on", summary: "The ball goes forward off a hand.", whatHappens: "A player loses the ball forward.", howItIsSignalled: "Arm out, hand rolling forward.", commonMisunderstanding: "Backwards off the hand is not a knock-on." },
    { contentKey: "forward-pass", title: "Forward pass", summary: "A pass travels forward.", whatHappens: null, howItIsSignalled: null, commonMisunderstanding: null },
    { contentKey: "offside", title: "Offside", summary: "A player is in front of the ball.", whatHappens: null, howItIsSignalled: null, commonMisunderstanding: null },
  ]
  const laws = [{ factKey: "knock-on.definition", valueText: "A knock-on occurs when a player loses possession forward." }]
  const call = officiatingCall(family[0], family, laws)
  assert.ok(call)
  assert.deepEqual(call, officiatingCall(family[0], family, laws))
  assert.equal(call.id, "call:knock-on")
  assert.equal(call.scenario, "A player loses the ball forward.")
  assert.equal(call.prompt, "What would you call?")
  assert.equal(call.options.length, 3)
  assert.equal(call.options.find((o) => o.correct)?.label, "Knock-on")
  assert.equal(call.explanation, "Arm out, hand rolling forward.")
  assert.equal(call.misunderstanding, "Backwards off the hand is not a knock-on.")
  assert.deepEqual(call.laws, laws)
  // A concept with no account of what happens falls back to its summary; with no siblings it is null.
  assert.equal(officiatingCall(family[1], family)?.scenario, "A pass travels forward.")
  assert.equal(officiatingCall(family[0], family.slice(0, 2)), null)
  assert.equal(stableHash("ruck"), stableHash("ruck"))
  assert.notEqual(stableHash("ruck"), stableHash("maul"))
})

test("every Hub detail screen ends with Keep Exploring and starts its rail from the shared projection", () => {
  const detailScreens = walk(HUB_APP).filter((p) => /\[[^\]]+\]\.tsx$/.test(p))
  assert.ok(detailScreens.length >= 13, `expected the thirteen detail screens, found ${detailScreens.length}`)
  for (const screen of detailScreens) {
    const src = readFileSync(screen, "utf8")
    const rel = screen.slice(ROOT.length + 1)
    assert.ok(src.includes("HubKeepExploring"), `${rel} renders Keep Exploring`)
    assert.ok(src.includes("HubExploreNext"), `${rel} renders Explore Next`)
    assert.ok(/relatedEntities\(\{ domain: "[a-z]+", bundle: data \}/.test(src), `${rel} derives its entities from the shared projection`)
  }
  const wanted: Record<string, string> = {
    "game/[conceptKey].tsx": "HubQuickCheck",
    "glossary/[termKey].tsx": "HubQuickCheck",
    "coaching/[conceptKey].tsx": "HubQuickCheck",
    "development/[conceptKey].tsx": "HubQuickCheck",
    "parents/[guideKey].tsx": "HubQuickCheck",
    "officiating/[contentKey].tsx": "HubWhatWouldYouCall",
  }
  for (const [file, component] of Object.entries(wanted)) {
    const src = readFileSync(join(HUB_APP, file), "utf8")
    assert.ok(src.includes(`<${component}`), `${file} renders ${component}`)
  }
  const officiating = readFileSync(join(HUB_APP, "officiating/[contentKey].tsx"), "utf8")
  assert.ok(officiating.includes('officiatingFamily === "DECISIONS_AND_SIGNALS"'), "the call is offered on the decisions-and-signals family only")
  for (const file of ["game/[conceptKey].tsx", "officiating/[contentKey].tsx", "coaching/[conceptKey].tsx", "parents/[guideKey].tsx"]) {
    assert.ok(readFileSync(join(HUB_APP, file), "utf8").includes("<HubShowMe"), `${file} offers Show Me`)
  }
  assert.ok(readFileSync(join(HUB_APP, "glossary/[termKey].tsx"), "utf8").includes("<HubSeeIt"), "the glossary offers See It")
})

test("the experience layer never draws on chance and never carries messaging actions", () => {
  const dirs = [resolve(ROOT, "apps/mobile/src/hub/experience"), resolve(ROOT, "packages/contracts/src/rugby-hub")]
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n")
      assert.ok(!code.includes("Math.random"), `${file.slice(ROOT.length + 1)} uses no Math.random`)
    }
  }
  const actions = /(label|title|accessibilityLabel)=\{?["'`](Message|Contact Coach|Reply|Invite)\b|>\s*(Message|Contact Coach|Reply|Invite)\s*</
  for (const file of walk(HUB_APP)) {
    if (file.includes(`${join("hub", "safeguarding")}${"/"}`)) continue
    const src = readFileSync(file, "utf8")
    assert.ok(!actions.test(src), `${file.slice(ROOT.length + 1)} carries no messaging action`)
  }
  for (const file of walk(resolve(ROOT, "apps/mobile/src/hub/experience"))) {
    assert.ok(!actions.test(readFileSync(file, "utf8")), `${file.slice(ROOT.length + 1)} carries no messaging action`)
  }
})

test("the landing orders the same five groups by context and never hides one", () => {
  const src = readFileSync(join(HUB_APP, "index.tsx"), "utf8")
  assert.ok(src.includes("orderedGroupKeys(active?.kind)"), "the landing orders by the active context kind")
  assert.ok(src.includes("SECTION_HEROES"), "each group carries its section hero")
  assert.ok(src.includes("From the Story of Rugby"))
  assert.ok(!src.includes("HUB_GROUPS.filter"), "groups are reordered, never filtered")
  const ia = ["learn", "play", "coach", "explore", "welfare"]
  assert.deepEqual(orderedGroupKeys(null), ia)
  assert.deepEqual(orderedGroupKeys("parent"), ["welfare", "learn", "play", "coach", "explore"])
  assert.deepEqual(orderedGroupKeys("family"), ["welfare", "learn", "play", "coach", "explore"])
  assert.deepEqual(orderedGroupKeys("team"), ["coach", "play", "learn", "explore", "welfare"])
  assert.deepEqual(orderedGroupKeys("club"), ["coach", "play", "learn", "explore", "welfare"])
  assert.deepEqual(orderedGroupKeys("site_admin"), ia)
  for (const kind of [null, "parent", "team", "player", "governing"]) assert.equal(new Set(orderedGroupKeys(kind)).size, 5, `${kind}: every group is present`)

  const entry = (entryKey: string): HeritageEntry => ({ id: entryKey, entryKey, eraId: "e", entryType: "MOMENT", codeScope: "UNION", title: entryKey, happenedYear: 1900, happenedOn: null, endsYear: null, summary: "", detail: null, certainty: "ESTABLISHED", certaintyNote: null, significance: null, people: [], places: [], tags: [] }) as unknown as HeritageEntry
  const entries = [entry("webb-ellis"), entry("first-international"), entry("the-split"), entry("first-world-cup")]
  assert.equal(storyOfTheDay([], 10), null)
  assert.equal(storyOfTheDay(entries, 10), storyOfTheDay([...entries].reverse(), 10), "the same day picks the same moment whatever order the entries arrive in")
  assert.notEqual(storyOfTheDay(entries, 10)?.entryKey, storyOfTheDay(entries, 11)?.entryKey, "tomorrow is a different moment")
  assert.equal(storyOfTheDay(entries, 10)?.entryKey, storyOfTheDay(entries, 14)?.entryKey, "the cycle is the number of entries")
})
