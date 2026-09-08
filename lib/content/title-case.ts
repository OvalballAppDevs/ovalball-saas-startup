/**
 * The Ovalball content standard, in code.
 *
 * WHAT THIS IS FOR
 *
 * Product navigation and page/section titles are Title Case. Everything else a
 * person reads -- paragraphs, helper text, errors, statuses, buttons and form
 * labels -- is UK English sentence case.
 *
 * This module is NOT a runtime filter over the interface. Copy is written
 * correctly in the source string, because that is the only version an export,
 * an email or a screen reader ever sees. What lives here is the shared
 * definition of what "correct" means, so the guardrail tests and any place
 * that has to build a title from data can agree on one answer.
 *
 * WHY IT IS NOT APPLIED EVERYWHERE
 *
 * A blanket transformation would be wrong more often than right. "RFU" would
 * become "Rfu", "de Silva" would become "De Silva", and the sentence "Nothing
 * changes until you apply the handover." would become a headline. Titles are
 * the narrow case where a mechanical rule is safe, and even there the
 * protected words below exist because rugby has proper nouns that no casing
 * algorithm can infer.
 */

/**
 * Words that keep their exact form wherever they appear in a title.
 *
 * Governing bodies, age grades and platform proper nouns. An age grade is
 * matched by shape rather than listed, because U6 through U19 all behave the
 * same way and a list would go stale the moment a grade is added.
 */
export const PROTECTED_TERMS = [
  "RFU",
  "RFL",
  "DOB",
  "UK",
  "ID",
  "URL",
  "API",
  "CSV",
  "GoCardless",
  "Ovalball",
  "Mini-Rugby",
  "McDonald",
] as const

/** Lower-case in the middle of a title; capitalised first and last. */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "over",
  "per",
  "the",
  "to",
  "up",
  "via",
  "with",
])

const PROTECTED_BY_LOWER = new Map(PROTECTED_TERMS.map((t) => [t.toLowerCase(), t]))

/** U6, U12, U18, U19 — an age grade is a shape, not a vocabulary. */
function isAgeGrade(word: string): boolean {
  return /^U\d{1,2}$/i.test(word)
}

function caseSegment(segment: string): string {
  if (!segment) return segment
  const protectedForm = PROTECTED_BY_LOWER.get(segment.toLowerCase())
  if (protectedForm) return protectedForm
  if (isAgeGrade(segment)) return segment.toUpperCase()
  // A word that already carries an internal capital is somebody's deliberate
  // spelling -- GoCardless, McDonald, iOS -- and is left exactly alone.
  if (/[A-Z]/.test(segment.slice(1))) return segment
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/**
 * Title Case for a product navigation label or page/section title.
 *
 * Deliberately not exported as a component wrapper: a title that has to be
 * computed at render time is a title nobody wrote, and the source string is
 * what ends up in an email, an export and an accessible name.
 */
export function toTitleCase(input: string): string {
  const words = input.trim().split(/(\s+)/)
  const significant = words.filter((w) => w.trim().length > 0)
  let seen = 0

  return words
    .map((word) => {
      if (!word.trim()) return word
      seen += 1
      const isFirst = seen === 1
      const isLast = seen === significant.length

      // Keep punctuation attached and case the parts around hyphens/slashes.
      const cased = word
        .split(/([-/])/)
        .map((part, i) => {
          if (part === "-" || part === "/") return part
          const bare = part.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
          if (!bare) return part
          const lead = part.slice(0, part.indexOf(bare))
          const tail = part.slice(part.indexOf(bare) + bare.length)
          const protectedForm = PROTECTED_BY_LOWER.get(bare.toLowerCase())
          if (protectedForm) return lead + protectedForm + tail
          if (isAgeGrade(bare)) return lead + bare.toUpperCase() + tail
          if (!isFirst && !isLast && i === 0 && MINOR_WORDS.has(bare.toLowerCase())) {
            return lead + bare.toLowerCase() + tail
          }
          return lead + caseSegment(bare) + tail
        })
        .join("")

      return cased
    })
    .join("")
}

/**
 * True when a string is already an acceptable product title.
 *
 * Used by the guardrail tests rather than at runtime. It answers "would the
 * standard have written it this way?", so a title that is already correct --
 * including one containing a protected term -- passes untouched.
 */
export function isTitleCase(input: string): boolean {
  return toTitleCase(input) === input
}
