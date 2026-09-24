import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

/**
 * THE VISUAL MANIFEST NAMES ONLY CANONICAL ENTITIES (CA-M6).
 *
 * A hotspot or a step in `apps/mobile/src/hub/visuals/manifest.ts` is a reference to a published Hub entity;
 * its label and explanation are read from the database at render time. So the manifest may not name a key
 * that does not exist, and it may not carry rugby prose of its own. Every assetKey must be registered once
 * in `assets.ts`, and the section heroes must all resolve.
 */
const manifest = readFileSync("apps/mobile/src/hub/visuals/manifest.ts", "utf8")
const assets = readFileSync("apps/mobile/src/hub/visuals/assets.ts", "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-At", "-c", q], { encoding: "utf8" }).trim()

// The manifest writes references through short constructors declared at its head, e.g. `const G = (key) => ({ type: "GLOSSARY_TERM", key })`.
const ctor = new Map([...code(manifest).matchAll(/const ([A-Z][A-Za-z]*) = \(key: string\)[^\n]*?type: "([A-Z_]+)"/g)].map((m) => [m[1], m[2]]))
const refs = [...code(manifest).matchAll(/\b([A-Z][A-Za-z]*)\("([a-z0-9-]+)"\)/g)].filter((m) => ctor.has(m[1])).map((m) => ({ type: ctor.get(m[1]) as string, key: m[2] }))
const assetKeys = [...code(manifest).matchAll(/assetKey:\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
const registered = [...code(assets).matchAll(/"([a-z0-9-]+)":\s*require\(/g)].map((m) => m[1])

test("every hotspot and step references a PUBLISHED canonical entity", () => {
  assert.ok(refs.length >= 40, `expected a real manifest, found ${refs.length} references`)
  const contentKeys = new Set(sql("select content_type||':'||content_key from hub_content_items where status='PUBLISHED';").split("\n"))
  const terms = new Set(sql("select term_key from hub_glossary_terms where status='PUBLISHED';").split("\n"))
  const skills = new Set(sql("select skill_key from hub_skills where status='PUBLISHED';").split("\n"))
  const positions = new Set(sql("select position_key from hub_positions where status='PUBLISHED';").split("\n"))
  const missing = refs.filter((r) => {
    if (r.type === "GLOSSARY_TERM") return !terms.has(r.key)
    if (r.type === "SKILL") return !skills.has(r.key)
    if (r.type === "POSITION") return !positions.has(r.key)
    return !contentKeys.has(`${r.type}:${r.key}`)
  })
  assert.deepEqual(missing, [], "references that name no published entity")
})

test("every assetKey is registered exactly once, and the manifest carries no rugby prose", () => {
  const unregistered = [...new Set(assetKeys)].filter((k) => !registered.includes(k))
  assert.deepEqual(unregistered, [])
  const dupes = registered.filter((k, i) => registered.indexOf(k) !== i)
  assert.deepEqual(dupes, [])
  for (const hero of ["hero-landing", "hero-learn", "hero-play", "hero-coach", "hero-explore", "hero-welfare"]) assert.ok(registered.includes(hero), `${hero} is registered`)
  // No sentence-length prose beyond the alt text: a hotspot never explains rugby itself.
  const prose = [...code(manifest).matchAll(/^\s*(\w+):\s*"([^"\n]{160,})"/gm)].filter((m) => m[1] !== "alt").map((m) => m[1])
  assert.deepEqual(prose, [], "a long string that is not an alt sentence would be a second content store")
  assert.doesNotMatch(code(manifest), /label:\s*"/, "hotspot labels come from the canonical entity, never the manifest")
})

test("the image is only the scene: no text is expected inside it, and nothing is served from a canonical bucket", () => {
  assert.doesNotMatch(assets, /club-logos|club-news-media|avatars|storage\.from/, "app-owned imagery only; canonical media stays with its resolver")
  assert.doesNotMatch(code(manifest), /http:|https:/, "no remote imagery in the manifest")
})
