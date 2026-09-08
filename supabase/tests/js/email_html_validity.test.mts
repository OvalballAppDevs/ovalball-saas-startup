import assert from "node:assert/strict"
import { test } from "node:test"

import { CONTRACTED_EVENT_KEYS, templateContract } from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

const SITE = "http://localhost:3000"

/**
 * IS THE HTML ACTUALLY WELL FORMED?
 *
 * Every other email test asks what the markup SAYS. This one asks whether it
 * is valid at all, and it is written by hand rather than handed to a browser
 * on purpose: a browser's parser is built to recover from broken markup, so it
 * silently repairs an unclosed cell and reports nothing. Outlook renders
 * through Word and does not recover -- it drops the rest of the table. A
 * check that passes in Chrome and fails in an inbox is worse than no check.
 *
 * No dependency, for the reason the loader already documents: this is a
 * tokeniser and a stack, and adding a parser to the tree to hold one would
 * cost more than it explains.
 */

/** Elements that never take a closing tag. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "source", "track", "wbr",
])

/** Where a tag is only legal inside a particular parent. */
const REQUIRED_PARENTS: Record<string, string[]> = {
  tr: ["table", "thead", "tbody", "tfoot"],
  td: ["tr"],
  th: ["tr"],
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
}

interface Tag {
  name: string
  raw: string
  closing: boolean
  selfClosing: boolean
  index: number
}

/**
 * Yields tags in order, skipping the doctype, comments, and the contents of
 * <style>, whose text is CSS and must never be read as markup.
 */
function* tags(html: string): Generator<Tag> {
  let i = 0
  while (i < html.length) {
    const open = html.indexOf("<", i)
    if (open === -1) return

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open)
      i = end === -1 ? html.length : end + 3
      continue
    }
    if (html.startsWith("<!", open)) {
      const end = html.indexOf(">", open)
      i = end === -1 ? html.length : end + 1
      continue
    }

    const end = html.indexOf(">", open)
    if (end === -1) return

    const raw = html.slice(open, end + 1)
    const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw)
    if (match) {
      const name = match[2].toLowerCase()
      yield { name, raw, closing: match[1] === "/", selfClosing: raw.endsWith("/>"), index: open }

      // <style> holds CSS; a brace or a > inside it is not markup.
      if (name === "style" && match[1] !== "/") {
        const close = html.indexOf("</style>", end)
        i = close === -1 ? html.length : close
        continue
      }
    }
    i = end + 1
  }
}

/**
 * Walks one tag's attributes, respecting quoting.
 *
 * A regex cannot do this. `content="width=device-width, initial-scale=1"` has
 * an equals sign INSIDE its quoted value, and any pattern loose enough to spot
 * a genuinely unquoted attribute also reports that one -- which is how the
 * first version of this test failed against perfectly valid markup.
 */
function attributesOf(raw: string): { names: string[]; unquoted: string | null } {
  const body = raw.replace(/^<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*/, "").replace(/\/?>$/, "")
  const names: string[] = []
  let unquoted: string | null = null
  let i = 0

  const skipSpace = () => {
    while (i < body.length && /\s/.test(body[i])) i += 1
  }

  while (i < body.length) {
    skipSpace()
    if (i >= body.length) break

    const nameStart = i
    while (i < body.length && /[a-zA-Z0-9:_-]/.test(body[i])) i += 1
    const name = body.slice(nameStart, i)
    if (!name) {
      i += 1
      continue
    }
    names.push(name.toLowerCase())

    skipSpace()
    if (body[i] !== "=") continue // a valueless attribute is legal
    i += 1
    skipSpace()

    const quote = body[i]
    if (quote === '"' || quote === "'") {
      i += 1
      const end = body.indexOf(quote, i)
      i = end === -1 ? body.length : end + 1
    } else {
      const valueStart = i
      while (i < body.length && !/\s/.test(body[i])) i += 1
      unquoted = `${name}=${body.slice(valueStart, i)}`
    }
  }

  return { names, unquoted }
}

/** Renders one event with its registered copy and its own controlled fixture. */
function renderDefault(key: (typeof CONTRACTED_EVENT_KEYS)[number]) {
  const fixture = PREVIEW_FIXTURES[key][0]
  return renderEmail(key, fixture.data as never, SITE, templateContract(key).default)
}

/** Every event, rendered once, so each test states its own subject clearly. */
const RENDERED = CONTRACTED_EVENT_KEYS.map((key) => ({ key, html: renderDefault(key).html }))

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test("every element that is opened is closed, in the right order", () => {
  for (const { key, html } of RENDERED) {
    const stack: string[] = []
    for (const tag of tags(html)) {
      if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) continue
      if (!tag.closing) {
        stack.push(tag.name)
        continue
      }
      const open = stack.pop()
      assert.equal(
        open,
        tag.name,
        `"${key}": found </${tag.name}> where </${open ?? "nothing"}> was expected`
      )
    }
    assert.deepEqual(stack, [], `"${key}" leaves ${stack.join(", ")} unclosed`)
  }
})

test("no closing tag is written for a void element", () => {
  // </img> and </br> are the classic hand-written-email slip. Outlook's parser
  // treats the stray close as a new element and the layout shifts under it.
  for (const { key, html } of RENDERED) {
    for (const tag of tags(html)) {
      if (tag.closing && VOID_ELEMENTS.has(tag.name)) {
        assert.fail(`"${key}" writes </${tag.name}>, which is not a real element`)
      }
    }
  }
})

test("table rows and cells sit inside the elements they require", () => {
  // The single most damaging class of email bug: a <td> outside a <tr>, or a
  // <tr> outside a table, makes Word drop everything after it.
  for (const { key, html } of RENDERED) {
    const stack: string[] = []
    for (const tag of tags(html)) {
      if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) continue
      if (tag.closing) {
        stack.pop()
        continue
      }
      const required = REQUIRED_PARENTS[tag.name]
      if (required) {
        const parent = stack[stack.length - 1]
        assert.ok(
          parent && required.includes(parent),
          `"${key}": <${tag.name}> sits directly inside <${parent ?? "nothing"}>, but must be inside ${required.join(" or ")}`
        )
      }
      stack.push(tag.name)
    }
  }
})

test("the document skeleton appears exactly once", () => {
  for (const { key, html } of RENDERED) {
    assert.ok(/^<!doctype html>/i.test(html.trim()), `"${key}" has no doctype`)
    for (const element of ["html", "head", "body", "title"]) {
      const opens = [...tags(html)].filter((t) => t.name === element && !t.closing).length
      assert.equal(opens, 1, `"${key}" has ${opens} <${element}> elements, expected exactly 1`)
    }
  }
})

test("no anchor is nested inside another anchor", () => {
  for (const { key, html } of RENDERED) {
    let depth = 0
    for (const tag of tags(html)) {
      if (tag.name !== "a") continue
      if (tag.closing) {
        depth -= 1
        continue
      }
      assert.equal(depth, 0, `"${key}" nests <a> inside <a>, which has no defined rendering`)
      depth += 1
    }
  }
})

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

test("every attribute value is quoted", () => {
  // An unquoted value ends at the first space, so a club called "Sample RUFC"
  // in an unquoted attribute silently truncates and the rest becomes markup.
  for (const { key, html } of RENDERED) {
    for (const tag of tags(html)) {
      if (tag.closing) continue
      const { unquoted } = attributesOf(tag.raw)
      assert.ok(
        !unquoted,
        `"${key}": <${tag.name}> has the unquoted attribute ${unquoted} in ${tag.raw.slice(0, 90)}`
      )
    }
  }
})

test("no attribute is written twice on the same element", () => {
  // A duplicate is not an error a parser reports; it silently keeps one of
  // them, and which one differs between clients.
  for (const { key, html } of RENDERED) {
    for (const tag of tags(html)) {
      if (tag.closing) continue
      const { names } = attributesOf(tag.raw)
      const seen = new Set<string>()
      for (const name of names) {
        assert.ok(!seen.has(name), `"${key}": <${tag.name}> repeats the ${name} attribute`)
        seen.add(name)
      }
    }
  }
})

test("every image declares alt text and its own dimensions", () => {
  // Dimensions are not cosmetic in email: without them a blocked image
  // collapses to nothing and the layout reflows around a hole.
  for (const { key, html } of RENDERED) {
    for (const tag of tags(html)) {
      if (tag.name !== "img" || tag.closing) continue
      assert.match(tag.raw, /\salt="/, `"${key}" has an image with no alt attribute`)
      assert.match(tag.raw, /\swidth="\d+"/, `"${key}" has an image with no width`)
      assert.match(tag.raw, /\sheight="\d+"/, `"${key}" has an image with no height`)
    }
  }
})

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

test("no raw < survives into text, which would open an element nobody wrote", () => {
  for (const { key, html } of RENDERED) {
    // Everything that is not inside a tag is text. A bare "<" there means an
    // escaping failure, and the club name after it disappears into markup.
    const text = html.replace(/<[^>]*>/g, " ")
    assert.ok(!text.includes("<"), `"${key}" contains an unescaped < in its text`)
  }
})

test("a club name full of markup cannot break the document", () => {
  // The structural tests above run on registered copy. This runs the same
  // checks on deliberately hostile data, because that is when escaping is
  // load-bearing rather than incidental.
  const html = renderEmail(
    "club_welcome",
    {
      firstName: `"><script>alert(1)</script>`,
      clubName: `Bobby </td></tr></table> Tables RFC & Sons <img src=x>`,
      clubLogoUrl: null,
    },
    SITE,
    templateContract("club_welcome").default
  ).html

  const stack: string[] = []
  for (const tag of tags(html)) {
    if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) continue
    if (!tag.closing) {
      stack.push(tag.name)
      continue
    }
    assert.equal(stack.pop(), tag.name, "hostile input broke the element nesting")
  }
  assert.deepEqual(stack, [], "hostile input left elements unclosed")
  assert.ok(!html.includes("<script>"), "hostile input produced a script element")
  assert.ok(html.includes("&lt;script&gt;"), "the hostile value should survive, escaped")
})

test("ampersands in text are written as entities", () => {
  // A bare & is tolerated by browsers and mangled by some mail clients, which
  // is how "Colts & Juniors" arrives as "Colts &Juniors" or worse.
  for (const { key, html } of RENDERED) {
    const text = html.replace(/<[^>]*>/g, " ")
    const bare = /&(?!#?[a-zA-Z0-9]{1,8};)/.exec(text)
    assert.ok(!bare, `"${key}" contains a bare & in its text at "${text.slice(Math.max(0, (bare?.index ?? 0) - 30), (bare?.index ?? 0) + 30)}"`)
  }
})
