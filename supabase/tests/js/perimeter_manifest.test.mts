import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * THE DATABASE/API PERIMETER MATCHES ITS CHECKED-IN CONTRACT.
 *
 * supabase/security/perimeter-manifest.json (Identity/Auth Slice 1) records
 * every privilege a browser role holds, and why. This compares the live
 * database with that file and fails on drift that matters:
 *
 *   - an anonymous read of a table, column or view the manifest does not list
 *   - any anonymous write, or any TRUNCATE/TRIGGER/REFERENCES for a browser role
 *   - a signed-in direct write the manifest does not list
 *   - a function executable by anon, authenticated or PUBLIC that is not listed
 *   - an owner-rights view the manifest does not name as a public projection
 *   - default privileges that would expose objects created later
 *   - a storage bucket whose public flag changed, or an anonymous storage
 *     write policy that does not call an authority helper
 *   - a table or view that exists but is not in the manifest at all
 *   - the internal schema exposed through the API
 *   - an audit or security-event store that an API role can write, or whose
 *     append-only guard is missing or disabled
 *
 * Granting something new is not wrong; doing it without recording why is.
 * Update the manifest in the same change, with the consumer and the reason.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
type Access = "none" | "all" | string[]

interface TableEntry {
  classification: string
  anon: { select: Access }
  authenticated: { select: Access; insert?: Access; update?: Access; delete?: Access }
}
interface ViewEntry {
  classification: string
  security_invoker: boolean
  anon: { select: Access }
}
interface Signature {
  signature: string
  schema?: string
}
interface Manifest {
  exposed_api_schemas: string[]
  tables: Record<string, TableEntry>
  views: Record<string, ViewEntry>
  functions: {
    anon_public_rpc: Signature[]
    anon_internal_policy_helpers: Signature[]
    authenticated_public: Signature[]
    authenticated_internal: string[]
    service_role_only_public: Signature[]
  }
  storage: { buckets: Record<string, { public: boolean }> }
  append_only_history: {
    tables: Record<string, { service_role: string[]; guard_triggers: string[]; attribution_trigger: string }>
  }
}

const manifest: Manifest = JSON.parse(readFileSync(path.join(ROOT, "supabase/security/perimeter-manifest.json"), "utf8"))

function rows(sql: string): string[][] {
  const out = execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "\t", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"))
}

function sameAccess(actual: Access, expected: Access): boolean {
  if (typeof actual === "string" || typeof expected === "string") return actual === expected
  return [...actual].sort().join(",") === [...expected].sort().join(",")
}

// Per-table, per-role, per-privilege: "all" when granted at table level,
// the column list when granted on columns only, "none" otherwise.
function accessMap(kinds: string): Map<string, Access> {
  const map = new Map<string, Access>()
  const tableLevel = rows(`
    select c.relname, r.rolname, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and c.relkind in (${kinds}) and r.rolname in ('anon', 'authenticated')`)
  for (const [rel, role, priv] of tableLevel) map.set(`${rel}|${role}|${priv}`, "all")
  const columnLevel = rows(`
    select c.relname, r.rolname, a.privilege_type, string_agg(att.attname, ',' order by att.attname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
    cross join lateral aclexplode(att.attacl) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and c.relkind in (${kinds}) and r.rolname in ('anon', 'authenticated')
    group by 1, 2, 3`)
  for (const [rel, role, priv, columns] of columnLevel) {
    const key = `${rel}|${role}|${priv}`
    if (map.get(key) !== "all") map.set(key, columns.split(","))
  }
  return map
}

test("the internal schema is never exposed through the API", () => {
  const config = readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8")
  const schemas = config.match(/^\s*schemas\s*=\s*\[([^\]]*)\]/m)
  assert.ok(schemas, "supabase/config.toml must declare [api] schemas")
  const exposed = schemas![1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)
  assert.deepEqual(exposed.sort(), [...manifest.exposed_api_schemas].sort())
  assert.ok(!exposed.includes("internal"))
})

test("every public table and view is in the manifest, and nothing in the manifest is missing", () => {
  const relations = rows(`select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m')`)
  const tables = relations.filter(([, k]) => k === "r" || k === "p").map(([r]) => r).sort()
  const views = relations.filter(([, k]) => k === "v" || k === "m").map(([r]) => r).sort()
  assert.deepEqual(tables, Object.keys(manifest.tables).sort(), "table set differs from the manifest")
  assert.deepEqual(views, Object.keys(manifest.views).sort(), "view set differs from the manifest")
})

test("anonymous and signed-in table access matches the manifest exactly", () => {
  const map = accessMap("'r','p'")
  const problems: string[] = []
  for (const [table, entry] of Object.entries(manifest.tables)) {
    const anonSelect = map.get(`${table}|anon|SELECT`) ?? "none"
    if (!sameAccess(anonSelect, entry.anon.select)) problems.push(`${table}: anon SELECT is ${JSON.stringify(anonSelect)}, manifest ${JSON.stringify(entry.anon.select)}`)
    for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
      const a = map.get(`${table}|anon|${priv}`)
      if (a) problems.push(`${table}: anon holds ${priv}`)
    }
    const authSelect = map.get(`${table}|authenticated|SELECT`) ?? "none"
    if (!sameAccess(authSelect, entry.authenticated.select)) problems.push(`${table}: authenticated SELECT is ${JSON.stringify(authSelect)}, manifest ${JSON.stringify(entry.authenticated.select)}`)
    for (const op of ["insert", "update", "delete"] as const) {
      const actual = map.get(`${table}|authenticated|${op.toUpperCase()}`) ?? "none"
      const expected: Access = entry.authenticated[op] ?? "none"
      if (!sameAccess(actual, expected)) problems.push(`${table}: authenticated ${op.toUpperCase()} is ${JSON.stringify(actual)}, manifest ${JSON.stringify(expected)}`)
    }
  }
  assert.deepEqual(problems, [])
})

test("no browser role holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN, or any sequence privilege", () => {
  const bad = rows(`
    select c.relname, r.rolname, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S' else 'r' end::"char", c.relowner))) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and r.rolname in ('anon', 'authenticated')
      and (c.relkind = 'S' or a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))`)
  assert.deepEqual(bad, [])
})

test("views: security mode and access match the manifest; no unlisted owner-rights view", () => {
  const map = accessMap("'v','m'")
  const modes = rows(`
    select c.relname, coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m')`)
  const problems: string[] = []
  for (const [view, mode] of modes) {
    const entry = manifest.views[view]
    if (!entry) continue
    const invoker = ["true", "on", "1"].includes(mode)
    if (invoker !== entry.security_invoker) problems.push(`${view}: security_invoker ${invoker}, manifest ${entry.security_invoker}`)
    if (!invoker && entry.classification !== "PUBLIC_PROJECTION") problems.push(`${view}: owner-rights view that is not a public projection`)
    const anon = map.get(`${view}|anon|SELECT`) ?? "none"
    if (!sameAccess(anon, entry.anon.select)) problems.push(`${view}: anon SELECT ${JSON.stringify(anon)}, manifest ${JSON.stringify(entry.anon.select)}`)
    for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
      if (map.get(`${view}|anon|${priv}`) || map.get(`${view}|authenticated|${priv}`)) problems.push(`${view}: browser role holds ${priv}`)
    }
  }
  assert.deepEqual(problems, [])
})

const FUNCTION_ROWS = rows(`
  select n.nspname, p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
         has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)

test("anonymous EXECUTE is exactly the manifest's public entry points and policy helpers", () => {
  const actual = FUNCTION_ROWS.filter(([, , anon]) => anon === "t").map(([schema, sig]) => `${schema}.${sig}`).sort()
  const expected = [
    ...manifest.functions.anon_public_rpc.map((f) => `public.${f.signature}`),
    ...manifest.functions.anon_internal_policy_helpers.map((f) => `${f.schema}.${f.signature}`),
  ].sort()
  assert.deepEqual(actual, expected)
})

test("signed-in EXECUTE never exceeds the manifest", () => {
  const allowed = new Set<string>([
    ...manifest.functions.anon_public_rpc.map((f) => `public.${f.signature}`),
    ...manifest.functions.anon_internal_policy_helpers.map((f) => `${f.schema}.${f.signature}`),
    ...manifest.functions.authenticated_public.map((f) => `public.${f.signature}`),
    ...manifest.functions.authenticated_internal.map((s: string) => `internal.${s}`),
  ])
  const unexpected = FUNCTION_ROWS.filter(([, , , auth]) => auth === "t").map(([schema, sig]) => `${schema}.${sig}`).filter((s) => !allowed.has(s))
  assert.deepEqual(unexpected, [], "a function is executable by authenticated without a manifest entry")
  const serverOnly = new Set(manifest.functions.service_role_only_public.map((f) => `public.${f.signature}`))
  const leaked = FUNCTION_ROWS.filter(([schema, sig, anon, auth]) => serverOnly.has(`${schema}.${sig}`) && (anon === "t" || auth === "t"))
  assert.deepEqual(leaked, [], "a server-only function is executable by a browser role")
})

test("no application function is executable through PUBLIC", () => {
  const viaPublic = FUNCTION_ROWS.filter(([, , , , pub]) => pub === "t").map(([schema, sig]) => `${schema}.${sig}`)
  assert.deepEqual(viaPublic, [])
})

test("default privileges expose nothing created later", () => {
  const acl = rows(`
    select case when defaclnamespace = 0 then '(global)' else defaclnamespace::regnamespace::text end, defaclobjtype, coalesce(array_to_string(defaclacl, ' '), '')
    from pg_default_acl where pg_get_userbyid(defaclrole) = 'postgres'`)
  const publicEntries = acl.filter(([schema]) => schema === "public")
  for (const [, type, grants] of publicEntries) {
    assert.ok(!/\banon=/.test(grants) && !/\bauthenticated=/.test(grants), `postgres default ACL in public (${type}) still grants a browser role: ${grants}`)
  }
  const globalFunctions = acl.find(([schema, type]) => schema === "(global)" && type === "f")
  assert.ok(globalFunctions, "postgres has no global function default ACL, so new functions get PUBLIC EXECUTE")
  assert.ok(!/(^|\s)=X/.test(globalFunctions![2]), `new functions still get PUBLIC EXECUTE: ${globalFunctions![2]}`)
})

test("storage buckets and anonymous storage writes match the manifest", () => {
  const buckets = rows(`select id, public::text from storage.buckets`)
  const actual = Object.fromEntries(buckets.map(([id, pub]) => [id, pub === "true"]))
  const expected = Object.fromEntries(Object.entries(manifest.storage.buckets).map(([id, b]) => [id, b.public]))
  assert.deepEqual(actual, expected)
  const anonWrites = rows(`
    select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies
    where schemaname = 'storage' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and (roles @> '{anon}' or roles @> '{public}')`)
  const unguarded = anonWrites.filter(([, expr]) => !/internal\.|auth\.uid\(\)/.test(expr)).map(([name]) => name)
  assert.deepEqual(unguarded, [], "a storage write policy admits anonymous callers without an authority helper")
})

test("audit and security-event history is append-only for every API role", () => {
  const stores = manifest.append_only_history.tables
  const privileges = rows(`
    select c.relname, r.rolname, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and c.relname in (${Object.keys(stores).map((t) => `'${t}'`).join(",")})
      and r.rolname in ('anon', 'authenticated', 'service_role')`)
  const problems: string[] = []
  for (const [table, store] of Object.entries(stores)) {
    const held = privileges.filter(([rel]) => rel === table)
    const writes = held.filter(([, , priv]) => priv !== "SELECT").map(([, role, priv]) => `${role} ${priv}`)
    if (writes.length) problems.push(`${table}: API roles hold ${writes.join(", ")}`)
    const service = held.filter(([, role]) => role === "service_role").map(([, , priv]) => priv).sort()
    if (service.join(",") !== [...store.service_role].sort().join(",")) problems.push(`${table}: service_role holds ${service.join(",")}`)
    const triggers = rows(`select tgname from pg_trigger where tgrelid = 'public.${table}'::regclass and not tgisinternal and tgenabled in ('O', 'A')`).map(([t]) => t)
    for (const name of [...store.guard_triggers, store.attribution_trigger]) {
      if (!triggers.includes(name)) problems.push(`${table}: trigger ${name} missing or disabled`)
    }
  }
  assert.deepEqual(problems, [])
})
