# Perimeter follow-up — `internal` is granted to browser roles

**Recorded by Slice 6b.2a. Not investigated here, not fixed here, and deliberately not expanded into.**
Owner decides when this gets its own unit.

## The finding

`authenticated` holds `USAGE` on the `internal` schema, and **227** functions in `internal` are
`EXECUTE`-able by `authenticated` or `anon`. That includes the session predicates themselves
(`session_ok`, `session_live`, `session_aal_ok`), the capability resolver (`capability_decision`,
`can`, `has_site_capability`, `club_ids_with`), and the guards built on them.

## Why it is not currently reachable from a browser

One reason, and only one: **PostgREST is configured to expose `public` and `graphql_public`, and
nothing else.**

- Local: `supabase/config.toml` → `[api] schemas = ["public", "graphql_public"]`
- Running container: `PGRST_DB_SCHEMAS=public,graphql_public`

`/rest/v1/rpc/<name>` resolves a function name only inside an exposed schema, so `internal.*` cannot be
named over HTTP however generous the `EXECUTE` grant is. Nothing about the grants themselves prevents
it.

## Risk if `internal` were ever exposed

It would become possible to call the authority machinery directly rather than through the functions
that compose it. The concrete shapes worth naming:

- `internal.capability_decision(...)` takes a **subject** parameter. Ovalball's own callers always pass
  `internal.effective_person()`; a direct caller would pass whatever they liked, turning a decision
  function into an oracle for *other people's* authority.
- The session predicates would become directly probeable, which turns "is this account suspended" into
  a question a stranger can ask.
- Any `internal` function that mutates and relies on being called only from a vetted `public` wrapper
  would lose that wrapper.

None of this is a defect today. It is a single configuration line between "irrelevant" and "serious",
which is the reason it is written down rather than remembered.

## Recommendation

Least privilege, in this order:

1. Audit which `internal` functions actually need `EXECUTE` by a browser role **at all**. A function is
   only reachable inside a `SECURITY DEFINER` body, which runs as the owner — so most of the 227 grants
   are very likely unnecessary even today.
2. Revoke `EXECUTE` from `anon` and `authenticated` wherever it is not required by an RLS policy
   expression (policies are evaluated as the invoking role, so a predicate used in a policy **does**
   need the grant).
3. Consider revoking `USAGE` on the schema itself once (2) is done.
4. Keep the exposed-schema list as the belt-and-braces, never as the only control.

Step 2 is the delicate one and is why this is a unit rather than a line: an over-eager revoke breaks
every RLS policy that names the function, and the failure mode is an outage rather than an error at
migration time.

## The guard that exists now

`supabase/tests/js/api_schema_perimeter.test.mts` (3 assertions, wired into the runner) fails if the
exposed-schema list changes at all, if `internal` appears on it, or if a migration grants `ALL` on the
schema to a browser role. It is cheap on purpose: it does not audit the 227 grants, it defends the one
line those grants currently depend on.

**Production API schema configuration was not altered.**
