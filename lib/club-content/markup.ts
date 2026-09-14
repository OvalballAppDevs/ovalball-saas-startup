/**
 * CLUB ARTICLE MARKUP.
 *
 * Articles are stored as a deliberately small text markup, and this module is
 * the one parser for it. It returns a plain data tree that
 * components/club-home/article-body.tsx turns into React elements -- there is
 * no HTML anywhere in the path, no dangerouslySetInnerHTML and no sanitiser to
 * keep up to date, because nothing a club types is ever interpreted as markup
 * by the browser.
 *
 * What a volunteer can write, and what the editor toolbar inserts:
 *
 *   ## Heading            ### Smaller heading
 *   **bold**              *italic*
 *   [link text](https://example.com)   [in-app link](/rugby-hub)
 *   - bulleted item       1. numbered item
 *   A blank line starts a new paragraph; a single line break is kept.
 *
 * Anything else is text. A link whose address is not https://, http://,
 * mailto: or a path on this site is shown as its text and not linked.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; external: boolean; children: Inline[] }
  | { type: "break" }

export type Block =
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }

/** A safe link target, or null. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim()
  if (/^https?:\/\/[^\s]+$/i.test(href)) return { href, external: true }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return { href, external: true }
  if (/^\/(?!\/)[^\s]*$/.test(href)) return { href, external: false }
  return null
}

/** Inline formatting inside one block. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let text = ""
  const flush = () => {
    if (text) out.push({ type: "text", text })
    text = ""
  }

  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)

    if (rest.startsWith("\n")) {
      flush()
      out.push({ type: "break" })
      i += 1
      continue
    }

    // [text](href)
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      const target = safeHref(link[2])
      flush()
      if (target) out.push({ type: "link", href: target.href, external: target.external, children: parseInline(link[1]) })
      else out.push(...parseInline(link[1]))
      i += link[0].length
      continue
    }

    // **bold**
    const strong = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest)
    if (strong && !strong[1].includes("\n\n")) {
      flush()
      out.push({ type: "strong", children: parseInline(strong[1]) })
      i += strong[0].length
      continue
    }

    // *italic* or _italic_
    const em = /^([*_])(?=\S)([^*_\n]*?\S)\1/.exec(rest)
    if (em) {
      flush()
      out.push({ type: "em", children: parseInline(em[2]) })
      i += em[0].length
      continue
    }

    text += source[i]
    i += 1
  }
  flush()
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/
const HEADING = /^(#{2,3})\s+(.*)$/

/** The whole article body. */
export function parseArticleBody(body: string): Block[] {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim()
    if (text) blocks.push({ type: "paragraph", children: parseInline(text) })
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      flushParagraph()
      i += 1
      continue
    }

    const heading = HEADING.exec(line.trim())
    if (heading) {
      flushParagraph()
      blocks.push({ type: "heading", level: heading[1].length === 2 ? 2 : 3, children: parseInline(heading[2].trim()) })
      i += 1
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered && !bullet)
      const pattern = ordered ? NUMBERED : BULLET
      const items: Inline[][] = []
      while (i < lines.length) {
        const m = pattern.exec(lines[i])
        if (!m) break
        items.push(parseInline(m[1].trim()))
        i += 1
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph()
  return blocks
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.text : n.type === "break" ? " " : inlineText(n.children)))
    .join("")
}

/** The body as plain sentences: for descriptions, previews and reading time. */
export function articlePlainText(body: string): string {
  return parseArticleBody(body)
    .map((b) => (b.type === "list" ? b.items.map(inlineText).join(". ") : inlineText(b.children)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

/** A description of at most `max` characters, ending on a word. */
export function summarise(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, "")}…`
}

/** Whole minutes to read, never less than one. */
export function readingMinutes(body: string): number {
  const words = articlePlainText(body).split(" ").filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}
