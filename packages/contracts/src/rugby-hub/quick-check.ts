import type { HubRelatedEntity } from "./related"

/**
 * QUICK CHECK AND "WHAT WOULD YOU CALL?" -- DERIVED, NEVER AUTHORED HERE (CA-M6).
 *
 * A small challenge makes a knowledge page interactive, but a challenge written by a client would
 * be a second content store with no review behind it. So every question here is FIELD PLUMBING over
 * canonical content: the prompt is the canonical definition or summary, the correct answer is the
 * canonical title, the other answers are the titles of real sibling entities from the same family
 * or code, and the explanation is the canonical field itself. Nothing in this file contains a word
 * of rugby.
 *
 * DETERMINISTIC. The same term produces the same question with the same options in the same order
 * on every device, every day: siblings are chosen and ordered by a stable hash of the keys, never by
 * `Math.random`. A page therefore never "regenerates" a quiz, and a test can pin the exact output.
 *
 * HONEST ABOUT ITS LIMITS. With fewer than two siblings there is no question -- a one-option check
 * would be theatre, and padding it with invented options would be a lie.
 */

/** FNV-1a, 32-bit: the one stable hash every choice in this file is made with. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export interface QuickCheckOption {
  key: string
  label: string
  correct: boolean
}

export interface QuickCheck {
  id: string
  prompt: string
  options: QuickCheckOption[]
  /** The canonical field the answer rests on. */
  explanation: string
  explore: HubRelatedEntity[]
}

export interface WhatWouldYouCall {
  id: string
  /** What happens on the pitch, in the concept's own words. */
  scenario: string
  prompt: string
  options: QuickCheckOption[]
  /** How the decision is signalled, else the concept's summary. */
  explanation: string
  misunderstanding: string | null
  /** The rules the concept cites. */
  laws: { factKey: string; valueText: string | null }[]
  explore: HubRelatedEntity[]
}

const SIBLING_COUNT = 3

/** Stable order of a list by the hash of each item's key salted with the subject's key. */
function orderedBy<T>(items: T[], keyOf: (item: T) => string, salt: string): T[] {
  return [...items].sort((a, b) => stableHash(`${salt}::${keyOf(a)}`) - stableHash(`${salt}::${keyOf(b)}`) || keyOf(a).localeCompare(keyOf(b)))
}

function buildOptions(subjectKey: string, subjectLabel: string, siblings: { key: string; label: string }[]): QuickCheckOption[] | null {
  const others = orderedBy(
    siblings.filter((s) => s.key !== subjectKey && s.label.trim().length > 0 && s.label !== subjectLabel),
    (s) => s.key,
    subjectKey
  ).slice(0, SIBLING_COUNT)
  if (others.length < 2) return null
  const all = [{ key: subjectKey, label: subjectLabel, correct: true }, ...others.map((s) => ({ key: s.key, label: s.label, correct: false }))]
  return orderedBy(all, (o) => o.key, `${subjectKey}::order`)
}

export interface QuickCheckTerm {
  termKey: string
  displayTerm: string
  plainLanguageDefinition: string
  rugbyCode: "union" | "league" | null
}

/** "Which term means: <definition>?" -- the canonical term against three real siblings of its code. */
export function glossaryQuickCheck(term: QuickCheckTerm, allTerms: QuickCheckTerm[], explore: HubRelatedEntity[] = []): QuickCheck | null {
  const definition = term.plainLanguageDefinition.trim()
  if (!definition) return null
  const siblings = allTerms.filter((t) => t.rugbyCode === null || term.rugbyCode === null || t.rugbyCode === term.rugbyCode).map((t) => ({ key: t.termKey, label: t.displayTerm }))
  const options = buildOptions(term.termKey, term.displayTerm, siblings)
  if (!options) return null
  return { id: `glossary:${term.termKey}`, prompt: `Which term means: ${definition}`, options, explanation: definition, explore }
}

export interface QuickCheckConcept {
  contentKey: string
  title: string
  summary: string
  whyItMatters?: string | null
}

/** "Which of these is: <summary>?" -- the canonical concept against three real siblings of its family. */
export function conceptQuickCheck(concept: QuickCheckConcept, siblings: QuickCheckConcept[], explore: HubRelatedEntity[] = []): QuickCheck | null {
  const summary = concept.summary.trim()
  if (!summary) return null
  const options = buildOptions(concept.contentKey, concept.title, siblings.map((s) => ({ key: s.contentKey, label: s.title })))
  if (!options) return null
  return {
    id: `concept:${concept.contentKey}`,
    prompt: `Which of these is: ${summary}`,
    options,
    explanation: (concept.whyItMatters ?? "").trim() || summary,
    explore,
  }
}

export interface OfficiatingCallConcept {
  contentKey: string
  title: string
  summary: string
  whatHappens?: string | null
  howItIsSignalled?: string | null
  commonMisunderstanding?: string | null
}

/**
 * "What would you call?" -- the scenario is the concept's own account of what happens; the answers are
 * the decisions of the same officiating family; the explanation is how the decision is signalled.
 * Educational, not an examination: the concept and its rules say what the call is.
 */
export function officiatingCall(
  concept: OfficiatingCallConcept,
  familySiblings: OfficiatingCallConcept[],
  laws: { factKey: string; valueText: string | null }[] = [],
  explore: HubRelatedEntity[] = []
): WhatWouldYouCall | null {
  const scenario = (concept.whatHappens ?? "").trim() || concept.summary.trim()
  if (!scenario) return null
  const options = buildOptions(concept.contentKey, concept.title, familySiblings.map((s) => ({ key: s.contentKey, label: s.title })))
  if (!options) return null
  return {
    id: `call:${concept.contentKey}`,
    scenario,
    prompt: "What would you call?",
    options,
    explanation: (concept.howItIsSignalled ?? "").trim() || concept.summary.trim(),
    misunderstanding: (concept.commonMisunderstanding ?? "").trim() || null,
    laws,
    explore,
  }
}
