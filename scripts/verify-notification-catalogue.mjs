#!/usr/bin/env node
/**
 * A NOTIFICATION HAS TO BE REGISTERED, AND IT HAS TO GO SOMEWHERE.
 *
 * Ovalball has one notification system, and it makes three separate promises
 * about every type it emits:
 *
 *   1. the type is REGISTERED (public.notification_types), so it belongs to a
 *      topic and a person's preferences can actually govern it;
 *   2. the topic it claims EXISTS (public.notification_topics), so the
 *      account page can render it;
 *   3. pressing the notification LANDS ON THE THING IT IS ABOUT, because
 *      notificationHref names a destination for it.
 *
 * All three were broken at once when this guard was written. Twenty-five
 * emitted types were registered nowhere -- `fixture_cancelled` among them --
 * and forty-five types fell through notificationHref's default to /dashboard.
 * A parent tapped "Fixture cancelled" and arrived on a dashboard.
 *
 * WHY A FILE GUARD WHEN THE DATABASE ALREADY HAS A FOREIGN KEY.
 *
 * notifications.type references notification_types(type_key), so an
 * unregistered type cannot be stored. That is the stronger guarantee, and it
 * is the reason promise (1) cannot regress. But it only fires when the
 * emitting code path actually RUNS: a notification emitted from a branch no
 * test exercises passes CI and fails in front of a person. And the foreign
 * key knows nothing at all about promises (2) and (3) -- a perfectly stored
 * notification can still go nowhere.
 *
 * So this reads the source. It resolves every type each emitter can produce,
 * including the ones assembled through a plpgsql variable or handed to a
 * fan-out helper as a parameter, and checks all three promises against the
 * registry and the destination map before anything is run.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const problems = []

const HREF_FILE = "lib/notifications/destinations.ts"

// ---------------------------------------------------------------------------
// Parsing helpers.
// ---------------------------------------------------------------------------

/**
 * Split on commas that are not inside parentheses, brackets or a SQL string.
 * `''` is SQL's escaped quote, not the end of a literal, so it is consumed as
 * a pair -- otherwise `format('It''s', x)` would split in the middle.
 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      current += char
      if (char === "'") {
        if (text[i + 1] === "'") current += text[++i]
        else inString = false
      }
      continue
    }
    if (char === "'") {
      inString = true
      current += char
      continue
    }
    if (char === "(" || char === "[") depth++
    else if (char === ")" || char === "]") depth--
    else if (char === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts.map((part) => part.trim())
}

/** Read the balanced contents of the parenthesis opening at `open`. */
function balanced(source, open) {
  let depth = 0
  let inString = false
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (inString) {
      if (char === "'") {
        if (source[i + 1] === "'") i++
        else inString = false
      }
      continue
    }
    if (char === "'") inString = true
    else if (char === "(") depth++
    else if (char === ")") {
      depth--
      if (depth === 0) return { body: source.slice(open + 1, i), end: i }
    }
  }
  return null
}

/**
 * Blank out SQL comments, preserving every offset so match positions stay
 * valid. A comma inside a `--` comment is not an argument separator: one such
 * comma, in a comment explaining a call, shifted every argument after it and
 * made this guard read `'CANCELLED'` out of a WHERE clause as a notification
 * type. A parser that reads comments as code reports confident nonsense.
 */
function blankSqlComments(source) {
  let out = ""
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === "'") {
      out += char
      i++
      while (i < source.length) {
        out += source[i]
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            out += source[i + 1]
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    if (char === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") {
        out += " "
        i++
      }
      continue
    }
    if (char === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " "
        i++
      }
      out += "  "
      i += 2
      continue
    }
    out += char
    i++
  }
  return out
}

/** Every `'literal'` in an expression, lowercased, without the quotes. */
function literalsIn(expression) {
  return [...expression.matchAll(/'([a-z][a-z0-9_]*)'/gi)].map((m) => m[1].toLowerCase())
}

const migrationDir = join(root, "supabase/migrations")
const migrationFiles = readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
const migrations = migrationFiles.map((file) => ({
  file,
  source: blankSqlComments(readFileSync(join(migrationDir, file), "utf8")),
}))

// ---------------------------------------------------------------------------
// 1. THE REGISTRY, as a fresh database would end up holding it.
// ---------------------------------------------------------------------------
/** topic key -> the migration that introduced it. */
const topics = new Map()
/** type key -> { topic, file }. */
const registry = new Map()

for (const { file, source } of migrations) {
  for (const match of source.matchAll(
    /insert\s+into\s+public\.notification_topics\s*\(([^)]*)\)\s*values/gi
  )) {
    const columns = splitTopLevel(match[1]).map((c) => c.toLowerCase())
    const keyIndex = columns.indexOf("key")
    let cursor = match.index + match[0].length
    while (true) {
      const open = source.indexOf("(", cursor)
      if (open === -1) break
      const between = source.slice(cursor, open)
      if (/[;]|on\s+conflict|create|alter|comment/i.test(between)) break
      const group = balanced(source, open)
      if (!group) break
      const values = splitTopLevel(group.body)
      const key = literalsIn(values[keyIndex] ?? "")[0]
      if (key && !topics.has(key)) topics.set(key, file)
      cursor = group.end + 1
    }
  }

  for (const match of source.matchAll(
    /insert\s+into\s+public\.notification_types\s*\(([^)]*)\)\s*values/gi
  )) {
    const columns = splitTopLevel(match[1]).map((c) => c.toLowerCase())
    const typeIndex = columns.indexOf("type_key")
    const topicIndex = columns.indexOf("topic_key")
    let cursor = match.index + match[0].length
    while (true) {
      const open = source.indexOf("(", cursor)
      if (open === -1) break
      const between = source.slice(cursor, open)
      if (/[;]|on\s+conflict|create|alter|comment/i.test(between)) break
      const group = balanced(source, open)
      if (!group) break
      const values = splitTopLevel(group.body)
      const typeKey = literalsIn(values[typeIndex] ?? "")[0]
      const topicKey = literalsIn(values[topicIndex] ?? "")[0]
      if (typeKey && !registry.has(typeKey)) registry.set(typeKey, { topic: topicKey, file })
      cursor = group.end + 1
    }
  }
}

if (registry.size === 0) {
  problems.push(
    "No notification types could be read from the migrations. The parser has lost sight of the registry, " +
      "which means every check below is silently passing on an empty set."
  )
}

// ---------------------------------------------------------------------------
// 2. WHAT THE PRODUCT ACTUALLY EMITS.
// ---------------------------------------------------------------------------
// Positional: read the column list of each `insert into public.notifications`,
// find where `type` sits, and take the matching expression out of the VALUES
// row or the SELECT list. Three shapes then appear in this codebase:
//
//   'fixture_cancelled'            a literal -- the common case
//   case when x then 'a' else 'b'  a branch -- every arm is emittable
//   v_type / p_type                a variable or a fan-out parameter
//
// The last one is resolved rather than skipped: a helper like
// internal.notify_training_participants(p_type => 'training_session_cancelled')
// emits a real type, and skipping it would leave the most-used emitters
// unchecked.

/** type key -> Set of "file:function" that can emit it. */
const emitted = new Map()
const unresolved = []
/** function signature -> { file, params, typeParam } for parameterised emitters. */
const fanOutHelpers = new Map()

function recordEmission(typeKey, where) {
  if (!emitted.has(typeKey)) emitted.set(typeKey, new Set())
  emitted.get(typeKey).add(where)
}

/** The `create function <name>(...)` that encloses `position`, if any. */
function enclosingFunction(source, position) {
  const before = source.slice(0, position)
  const starts = [
    ...before.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/gi),
  ]
  if (starts.length === 0) return null
  const last = starts[starts.length - 1]
  const params = balanced(source, last.index + last[0].length - 1)
  return {
    name: last[1].toLowerCase(),
    params: params ? splitTopLevel(params.body) : [],
    bodyStart: last.index,
  }
}

for (const { file, source } of migrations) {
  for (const match of source.matchAll(/insert\s+into\s+public\.notifications\s*\(/gi)) {
    const columnGroup = balanced(source, match.index + match[0].length - 1)
    if (!columnGroup) continue
    const columns = splitTopLevel(columnGroup.body).map((c) => c.toLowerCase())
    const typeIndex = columns.indexOf("type")
    if (typeIndex === -1) {
      problems.push(
        `${file}: an insert into public.notifications names no type column. Every notification declares its type explicitly.`
      )
      continue
    }

    const rest = source.slice(columnGroup.end + 1)
    let expressions = null

    const valuesMatch = /^\s*values\s*\(/i.exec(rest)
    if (valuesMatch) {
      const row = balanced(rest, valuesMatch[0].length - 1)
      if (row) expressions = splitTopLevel(row.body)
    } else {
      const selectMatch = /^\s*select\s+/i.exec(rest)
      if (selectMatch) {
        // The select list ends at the top-level `from` or the statement's `;`.
        let depth = 0
        let inString = false
        let body = ""
        for (let i = selectMatch[0].length; i < rest.length; i++) {
          const char = rest[i]
          if (inString) {
            body += char
            if (char === "'") {
              if (rest[i + 1] === "'") body += rest[++i]
              else inString = false
            }
            continue
          }
          if (char === "'") {
            inString = true
            body += char
            continue
          }
          if (char === "(") depth++
          if (char === ")") depth--
          if (depth === 0 && char === ";") break
          if (depth === 0 && /\s/.test(char) && /^\s+from\s/i.test(rest.slice(i, i + 6))) break
          body += char
        }
        expressions = splitTopLevel(body)
      }
    }

    if (!expressions || expressions.length !== columns.length) {
      problems.push(
        `${file}: could not read the type of an insert into public.notifications. ` +
          `This guard has to understand every emitter; if the statement is legitimate, teach the parser rather than removing the check.`
      )
      continue
    }

    const owner = enclosingFunction(source, match.index)
    const where = `${file}${owner ? ` (${owner.name})` : ""}`
    const expression = expressions[typeIndex]

    // A literal, or a branch of literals -- every arm can be emitted.
    const literals = literalsIn(expression)
    if (literals.length > 0) {
      for (const literal of literals) recordEmission(literal, where)
      continue
    }

    const identifier = /^([a-z_][a-z0-9_]*)$/i.exec(expression.replace(/::text$/i, "").trim())
    if (!identifier) {
      unresolved.push(`${where}: type expression \`${expression.slice(0, 60)}\``)
      continue
    }
    const name = identifier[1].toLowerCase()

    if (owner && owner.params.some((p) => p.trim().toLowerCase().startsWith(`${name} `))) {
      // A fan-out helper. Its callers decide the type; resolved in pass 3.
      fanOutHelpers.set(owner.name, {
        file,
        paramIndex: owner.params.findIndex((p) => p.trim().toLowerCase().startsWith(`${name} `)),
        paramName: name,
      })
      continue
    }

    if (owner) {
      // A plpgsql local. Every literal it is ever assigned is emittable.
      const bodyEnd = source.indexOf("$$;", owner.bodyStart)
      const body = source.slice(owner.bodyStart, bodyEnd === -1 ? source.length : bodyEnd)
      const assigned = new Set()
      for (const assignment of body.matchAll(
        new RegExp(`\\b${name}\\s*:=\\s*([^;]+);`, "gi")
      )) {
        for (const literal of literalsIn(assignment[1])) assigned.add(literal)
      }
      if (assigned.size > 0) {
        for (const literal of assigned) recordEmission(literal, where)
        continue
      }
    }

    unresolved.push(`${where}: type variable \`${name}\` resolves to no literal`)
  }
}

// ---------------------------------------------------------------------------
// 3. WHAT THE FAN-OUT HELPERS ARE CALLED WITH.
// ---------------------------------------------------------------------------
// internal.notify_training_participants(id, 'training_session_cancelled', ...)
// emits that type as surely as a literal inside the insert does.
for (const [helper, { paramIndex, paramName }] of fanOutHelpers) {
  let calls = 0
  for (const { file, source } of migrations) {
    for (const call of source.matchAll(
      new RegExp(`(?<!function\\s)\\b${helper.replace(".", "\\.")}\\s*\\(`, "gi")
    )) {
      // Skip the declaration itself, and grants/revokes naming the signature.
      const preceding = source.slice(Math.max(0, call.index - 60), call.index)
      if (/create\s+(or\s+replace\s+)?function\s+$/i.test(preceding)) continue
      if (/(revoke|grant)[\s\S]*$/i.test(preceding) && !/;\s*$/.test(preceding)) {
        if (/execute\s+on\s+function\s+$/i.test(preceding)) continue
      }
      const args = balanced(source, call.index + call[0].length - 1)
      if (!args) continue
      const parts = splitTopLevel(args.body)
      // Named notation (`p_type => 'x'`) wins over position when present.
      const named = parts.find((p) => new RegExp(`^${paramName}\\s*=>`, "i").test(p))
      const argument = named ?? parts[paramIndex]
      if (argument === undefined) continue
      const literals = literalsIn(argument)
      if (literals.length === 0) continue
      calls++
      for (const literal of literals) recordEmission(literal, `${file} (-> ${helper})`)
    }
  }
  if (calls === 0) {
    unresolved.push(`${helper}: takes its type as a parameter and no call site passes a literal`)
  }
}

// ---------------------------------------------------------------------------
// 4. TYPESCRIPT EMITTERS.
// ---------------------------------------------------------------------------
// The one that started this: gocardless_membership_cancelled is inserted from
// TypeScript, so no SQL-side check could ever have seen it.
function walkSource(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkSource(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

for (const dir of ["app", "lib"]) {
  for (const path of walkSource(join(root, dir))) {
    const source = readFileSync(path, "utf8")
    if (!source.includes('from("notifications")')) continue
    for (const insert of source.matchAll(
      /from\(["']notifications["']\)\s*\.\s*insert\(\s*\{([\s\S]{0,800}?)\}\s*\)/g
    )) {
      const typeMatch = /\btype\s*:\s*["']([a-z0-9_]+)["']/i.exec(insert[1])
      const where = relative(root, path)
      if (!typeMatch) {
        unresolved.push(`${where}: inserts a notification whose type is not a literal`)
        continue
      }
      recordEmission(typeMatch[1].toLowerCase(), where)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. WHERE EACH TYPE TAKES YOU.
// ---------------------------------------------------------------------------
const hrefSource = readFileSync(join(root, HREF_FILE), "utf8")
const switchStart = hrefSource.indexOf("switch (type)")
if (switchStart === -1) {
  problems.push(
    `${HREF_FILE}: no \`switch (type)\` found. notificationHref is the one destination map; if it moved, move this guard with it.`
  )
}
const switchBody = switchStart === -1 ? "" : hrefSource.slice(switchStart)
const routed = new Set(
  [...switchBody.matchAll(/case\s+["']([a-z0-9_]+)["']\s*:/gi)].map((m) => m[1].toLowerCase())
)

// ---------------------------------------------------------------------------
// THE FOUR PROMISES.
// ---------------------------------------------------------------------------

// A. Nothing is emitted that the registry does not know about.
for (const [type, wheres] of [...emitted].sort()) {
  if (registry.has(type)) continue
  problems.push(
    `\`${type}\` is emitted (${[...wheres].join(", ")}) but is not in public.notification_types. ` +
      `An unregistered type belongs to no topic, so no preference can govern it -- and the ` +
      `notifications_type_registered foreign key will reject the insert at runtime.`
  )
}

// B. Nothing is registered that goes nowhere.
for (const [type, { file }] of [...registry].sort()) {
  if (routed.has(type)) continue
  problems.push(
    `\`${type}\` is registered (${file}) but notificationHref names no destination for it, so it falls ` +
      `through to /dashboard. Give it a case in ${HREF_FILE}.`
  )
}

// C. No destination for a type that does not exist.
for (const type of [...routed].sort()) {
  if (registry.has(type)) continue
  problems.push(
    `${HREF_FILE} routes \`${type}\`, which is in no registry insert. Either the type was renamed and this ` +
      `case is dead, or it is emitted without being registered.`
  )
}

// D. Every registered type claims a topic that exists.
for (const [type, { topic, file }] of [...registry].sort()) {
  if (!topic) {
    problems.push(`\`${type}\` (${file}) is registered with no topic. A type without a topic cannot be preferred on or off.`)
    continue
  }
  if (!topics.has(topic)) {
    problems.push(
      `\`${type}\` (${file}) claims topic \`${topic}\`, which no migration creates. The account page renders topics; ` +
        `a type filed under a topic that does not exist is invisible there.`
    )
  }
}

// E. Every destination is actually exercised. A route nobody walks is a route
//    nobody has checked: the deep-link matrix is the only place that asserts
//    a type lands on the surface that owns it, so a type added to the map
//    without a row there is routed on trust.
const MATRIX_FILE = "supabase/tests/js/notification_destinations.test.mts"
let matrixSource = ""
try {
  matrixSource = readFileSync(join(root, MATRIX_FILE), "utf8")
} catch {
  problems.push(`${MATRIX_FILE} is missing. It is the deep-link matrix every routed type is checked against.`)
}
const exercised = new Set(
  [...matrixSource.matchAll(/\[\s*["']([a-z0-9_]+)["']\s*,/gi)].map((m) => m[1].toLowerCase())
)
for (const type of [...routed].sort()) {
  if (exercised.has(type)) continue
  problems.push(
    `\`${type}\` has a destination but no row in ${MATRIX_FILE}, so nothing checks where it actually lands.`
  )
}

// F. Every emitter is understood. An emitter this guard cannot read is an
//    emitter it is not checking, and a silent gap is how a guard stops being
//    true without anybody noticing.
for (const item of unresolved) {
  problems.push(`Unresolved notification emitter -- ${item}`)
}

if (problems.length > 0) {
  console.error("FAIL  notification catalogue")
  for (const problem of problems) console.error(`        ${problem}`)
  process.exit(1)
}

console.log(
  `ok    notification_catalogue             ${emitted.size} emitted / ${registry.size} registered / ` +
    `${routed.size} routed across ${topics.size} topics; every emitted type registered, every registered type routed`
)
