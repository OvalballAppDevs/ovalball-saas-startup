#!/usr/bin/env node
/**
 * MESSENGER + NOTIFICATIONS ARCHITECTURE GUARD (audit-as-code)
 *
 * This SP4 slice found that Messenger and Notifications already exist as
 * mature, committed Main Project functionality -- not a gap for SP4 to
 * build. Per the standing "never touch Main Project" rule, this script
 * does not modify anything; it locks in the invariants the audit found
 * ALREADY TRUE, the same way scripts/verify-email-wiring.mjs pins email's
 * own architecture, so a future change (in Main Project or SP4) that
 * quietly breaks one of them is caught rather than discovered in
 * production. See docs/MESSENGER_NOTIFICATIONS_ARCHITECTURE_AUDIT.md for
 * the full audit this was built from.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")
const problems = []

function findFiles(dir, exts, matches = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) findFiles(rel, exts, matches)
    else if (exts.some((e) => entry.name.endsWith(e))) matches.push(rel)
  }
  return matches
}

// ---------------------------------------------------------------------
// 1. One canonical message/conversation/notification store -- no "_v2",
//    "_new" or a second mobile-specific table, in any migration, ever.
// ---------------------------------------------------------------------
const migrationFiles = findFiles("supabase/migrations", [".sql"])
const bannedTablePattern = /create\s+table\s+(if not exists\s+)?public\.(messages_v2|conversations_v2|notifications_new|notification_events_v2|mobile_notifications|push_notifications)\b/i
for (const file of migrationFiles) {
  const source = read(file)
  const match = source.match(bannedTablePattern)
  if (match) {
    problems.push(`${file} creates "${match[2]}" -- a second messaging/notification store. One canonical message store, one canonical notification store; no "_v2"/"_new"/mobile-specific duplicate.`)
  }
}

// ---------------------------------------------------------------------
// 2. Notifications must have a stable, server-issued id (uuid PK) and no
//    client-supplied identity -- checked against the table's own
//    definition, wherever it currently lives across migrations.
// ---------------------------------------------------------------------
const notificationsTableDef = migrationFiles
  .map((f) => read(f))
  .find((s) => /create table (if not exists )?public\.notifications\s*\(/i.test(s))
if (!notificationsTableDef) {
  problems.push("No migration defines public.notifications -- the canonical notification store does not exist.")
} else {
  const tableBlock = notificationsTableDef.slice(notificationsTableDef.search(/create table (if not exists )?public\.notifications/i))
  if (!/id\s+uuid\s+(not null\s+)?(default\s+gen_random_uuid\(\)|primary key)/i.test(tableBlock)) {
    problems.push("public.notifications does not appear to have a server-generated uuid id -- notification identity must never be client-issued.")
  }
}

// ---------------------------------------------------------------------
// 3. Email channel policy (email_events.active) must remain structurally
//    independent of notification creation -- no migration wires the two
//    together. This is the direct, explicit lesson from the Email
//    Delivery Policy correction: classification/channel state for one
//    channel must never gate another channel or the underlying domain
//    event.
// ---------------------------------------------------------------------
for (const file of migrationFiles) {
  const source = read(file)
  const mentionsNotificationsInsert = /insert into public\.notifications/i.test(source)
  const mentionsEmailEvents = /\bemail_events\b|\bemail_deliveries\b|\bemail_event_active\b/i.test(source)
  if (mentionsNotificationsInsert && mentionsEmailEvents) {
    problems.push(`${file} both inserts into public.notifications AND references the email delivery-policy tables/functions in the same file -- verify by hand that in-app notification creation does not check email_events.active (it must not: Email OFF must never suppress the in-app notification).`)
  }
}

// ---------------------------------------------------------------------
// 4. Notification destinations must be built from stable entity ids
//    (fixture_id, conversation_id, etc.) in the `data` jsonb column, never
//    a stored, arbitrary client-supplied URL string as source of truth.
// ---------------------------------------------------------------------
const insertNotificationCalls = migrationFiles
  .flatMap((f) => {
    const source = read(f)
    return [...source.matchAll(/insert into public\.notifications[\s\S]{0,400}?jsonb_build_object\(([^)]*)\)/gi)].map((m) => ({ file: f, args: m[1] }))
  })
for (const call of insertNotificationCalls) {
  if (/['"]url['"]|['"]href['"]|['"]link['"]/i.test(call.args)) {
    problems.push(`${call.file} builds a notification's data with a raw "url"/"href"/"link" key ("${call.args.trim()}") -- destinations must be derived from stable entity ids (fixture_id, conversation_id, ...) at read time, never stored as an arbitrary URL.`)
  }
}

if (problems.length > 0) {
  console.error("FAIL  messenger_notifications_architecture")
  for (const p of problems) console.error(`        ${p}`)
  process.exit(1)
}

console.log("ok    messenger_notifications_architecture  one canonical message/notification store, server-issued ids, channel independence, stable destinations")
