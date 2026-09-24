import { useCallback, useEffect, useState } from "react"
import { getCoachingBundle } from "@ovalball/contracts/rugby-hub/coaching-data"
import { hubHrefFor } from "@ovalball/contracts/rugby-hub/destinations"
import { getDevelopmentBundle } from "@ovalball/contracts/rugby-hub/development-data"
import { getGameKnowledgeBundle } from "@ovalball/contracts/rugby-hub/game-knowledge-data"
import { getGlossaryBundle } from "@ovalball/contracts/rugby-hub/glossary-data"
import { getOfficiatingBundle } from "@ovalball/contracts/rugby-hub/officiating-data"
import { getParentsBundle } from "@ovalball/contracts/rugby-hub/parents-data"
import { getPositionExplorerBundle } from "@ovalball/contracts/rugby-hub/position-explorer-data"
import type { HubEntityType } from "@ovalball/contracts/rugby-hub/related"
import { getSkillsExplorerBundle } from "@ovalball/contracts/rugby-hub/skills-explorer-data"

import { supabase } from "../../auth/supabase"

/**
 * WHAT A THING IS, IN ONE SENTENCE, FOR A HOTSPOT OR A LABEL.
 *
 * A visual explainer names the parts of a scene by canonical entity -- a glossary term, a game
 * concept, a position -- and shows that entity's own canonical summary when it is tapped. This
 * hook resolves `{ type, key }` to `{ title, text, href }` from the same shared readers every
 * screen uses. Bundles are loaded LAZILY, only for the types actually asked about, and kept in
 * process memory for the session (the same policy as the Hub cache); nothing is hard-coded.
 */
export interface HubEntityRef {
  type: HubEntityType
  key: string
}

export interface HubExplanation {
  title: string
  text: string
  href: string
}

type Loaded = Map<string, HubExplanation>

const loaded = new Map<HubEntityType, Loaded>()
const inflight = new Map<HubEntityType, Promise<Loaded>>()

/** Forget every loaded explanation -- called with the Hub cache on sign-out. */
export function forgetHubExplanations(): void {
  loaded.clear()
  inflight.clear()
}

/** The canonical web href for an entity reference; the route table turns it into a screen. */
export function hubHrefForRef(ref: HubEntityRef): string {
  switch (ref.type) {
    case "GAME_CONCEPT":
      return hubHrefFor({ kind: "game", conceptKey: ref.key })
    case "GLOSSARY_TERM":
      return hubHrefFor({ kind: "glossary", termKey: ref.key })
    case "OFFICIATING_CONCEPT":
      return hubHrefFor({ kind: "officiating", contentKey: ref.key })
    case "COACHING_CONCEPT":
      return hubHrefFor({ kind: "coaching", conceptKey: ref.key, code: "all" })
    case "PARENT_GUIDE":
      return hubHrefFor({ kind: "parents", guideKey: ref.key })
    case "PLAYER_DEVELOPMENT_CONCEPT":
      return hubHrefFor({ kind: "development", conceptKey: ref.key, code: "all" })
    case "COMPETITION_GUIDE":
      return hubHrefFor({ kind: "competitions", contentKey: ref.key, code: "all" })
    case "RUGBY_TEAM":
      return hubHrefFor({ kind: "international", teamKey: ref.key, code: "all" })
    case "RUGBY_PERSON":
      return hubHrefFor({ kind: "people", personKey: ref.key })
    case "RULE":
      return hubHrefFor({ kind: "rules", identityKey: null, section: ref.key })
    case "SKILL":
      return hubHrefFor({ kind: "skills", skillKey: ref.key })
    case "POSITION": {
      // A position key is unique within a code; the manifest carries `union:` / `league:` prefixes when it must say which.
      const [maybeCode, rest] = ref.key.includes(":") ? ref.key.split(":", 2) : [null, ref.key]
      return hubHrefFor({ kind: "positions", code: maybeCode === "league" ? "league" : "union", positionKey: rest })
    }
    case "STORY":
      return hubHrefFor({ kind: "story", entryKey: ref.key })
    case "CLUB":
      return hubHrefFor({ kind: "clubs", clubKey: ref.key, code: "all" })
  }
}

async function loadType(t: HubEntityType): Promise<Loaded> {
  const map: Loaded = new Map()
  const put = (key: string, title: string, text: string) => map.set(key, { title, text, href: hubHrefForRef({ type: t, key }) })
  switch (t) {
    case "GLOSSARY_TERM":
      for (const term of (await getGlossaryBundle(supabase)).terms) put(term.termKey, term.displayTerm, term.plainLanguageDefinition)
      break
    case "GAME_CONCEPT":
      for (const c of (await getGameKnowledgeBundle(supabase)).concepts) put(c.contentKey, c.title, c.summary)
      break
    case "OFFICIATING_CONCEPT":
      for (const c of (await getOfficiatingBundle(supabase)).concepts) put(c.contentKey, c.title, c.summary)
      break
    case "COACHING_CONCEPT":
      for (const c of (await getCoachingBundle(supabase)).concepts) put(c.contentKey, c.title, c.summary)
      break
    case "PLAYER_DEVELOPMENT_CONCEPT":
      for (const c of (await getDevelopmentBundle(supabase)).concepts) put(c.contentKey, c.title, c.summary)
      break
    case "PARENT_GUIDE":
      for (const g of (await getParentsBundle(supabase)).guides) put(g.contentKey, g.title, g.summary)
      break
    case "SKILL":
      for (const s of (await getSkillsExplorerBundle(supabase, null)).skills) put(s.skillKey, s.displayName, s.summary)
      break
    case "POSITION":
      for (const code of ["union", "league"] as const) {
        for (const p of (await getPositionExplorerBundle(supabase, code, null)).positions) put(`${code}:${p.positionKey}`, p.displayName, p.purpose)
      }
      break
    default:
      // Teams, people, clubs, rules, stories and competitions are destinations, not hotspot subjects.
      break
  }
  return map
}

function ensure(t: HubEntityType): Promise<Loaded> {
  const have = loaded.get(t)
  if (have) return Promise.resolve(have)
  const pending = inflight.get(t)
  if (pending) return pending
  const p = loadType(t)
    .then((m) => {
      loaded.set(t, m)
      inflight.delete(t)
      return m
    })
    .catch(() => {
      inflight.delete(t)
      return new Map() as Loaded
    })
  inflight.set(t, p)
  return p
}

/**
 * A resolver from an entity reference to its canonical explanation. Returns null until that type's
 * bundle has loaded (the load is started on first ask and the component re-renders when it lands),
 * and null for a key the canon does not have -- never a guess.
 */
export function useHubExplanations(): (ref: HubEntityRef) => HubExplanation | null {
  const [, bump] = useState(0)
  const asked = useState(() => new Set<HubEntityType>())[0]

  useEffect(() => () => asked.clear(), [asked])

  return useCallback(
    (ref: HubEntityRef) => {
      const key = ref.type === "POSITION" && !ref.key.includes(":") ? `union:${ref.key}` : ref.key
      const have = loaded.get(ref.type)
      if (have) return have.get(key) ?? null
      if (!asked.has(ref.type)) {
        asked.add(ref.type)
        void ensure(ref.type).then(() => bump((n) => n + 1))
      }
      return null
    },
    [asked]
  )
}
