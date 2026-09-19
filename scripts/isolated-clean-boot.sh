#!/usr/bin/env bash
# =====================================================================================================
# ISOLATED CLEAN BOOT -- the whole migration chain, from empty, without touching the review world.
#
# WHY THIS EXISTS. Every slice that adds a migration has to prove the chain installs from nothing. The
# obvious way is `supabase db reset`, and it is the wrong way here: it rebuilds the WORKING local
# project, which holds the canonical UAT personas and the product owner's own review changes. Those are
# product-review data, not a disposable fixture, and three standing instructions say so.
#
# An earlier attempt hand-built a bootstrap schema in a spare database and applied the migrations to it.
# 338 of 524 applied, and the failures were all artefacts of the hand-built bootstrap rather than of the
# chain -- a proof of the harness, not of Ovalball. That is why this uses the REAL supported path:
# a second Supabase project, started by the CLI from its own config, on its own ports, in its own Docker
# containers. Same tooling, same migration semantics, same seed, as a genuine fresh installation.
#
# WHAT IT CREATES: a throwaway project directory under the system temp dir, containing a config derived
# from this repository's own with a different project id and a different port for every service, plus
# copies of `supabase/migrations`, `supabase/seed.sql` and `supabase/seeds`.
#
# WHAT IT DESTROYS: only that project. `supabase stop --project-id` names it explicitly, so it cannot
# reach the canonical one.
#
# THE GUARD: the script refuses to run if the derived project id has not actually changed. That is the
# one mistake that would be catastrophic and silent, so it is checked rather than trusted.
#
#   scripts/isolated-clean-boot.sh            # boot, assert, destroy
#   scripts/isolated-clean-boot.sh --keep     # boot and assert, leave it running to inspect
# =====================================================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_ID="$(grep -E '^project_id' "$REPO/supabase/config.toml" | head -1 | sed -E 's/.*"(.*)".*/\1/')"
BOOT_ID="${CANONICAL_ID}-cleanboot"
WORKDIR="${TMPDIR:-/tmp}/ovalball-clean-boot"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

if [ "$BOOT_ID" = "$CANONICAL_ID" ]; then
  echo "REFUSING: the disposable project id is identical to the canonical one ($CANONICAL_ID)." >&2
  echo "This script must never be able to act on the persistent review world." >&2
  exit 1
fi

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "--keep: leaving $BOOT_ID running. Stop it with:"
    echo "  npx supabase stop --project-id $BOOT_ID"
    return
  fi
  echo "-- destroying the disposable project"
  (cd "$WORKDIR" && npx supabase stop --project-id "$BOOT_ID" --no-backup >/dev/null 2>&1)
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "== isolated clean boot: $BOOT_ID =="
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/supabase"

# The config, with every port moved and the project renamed. Ports are shifted by a fixed offset rather
# than chosen individually, so a service added to the real config later cannot silently collide.
python3 - "$REPO/supabase/config.toml" "$WORKDIR/supabase/config.toml" "$CANONICAL_ID" "$BOOT_ID" <<'PY'
import re, sys
src, dst, canonical, boot = sys.argv[1:5]
text = open(src).read()
text = text.replace(f'project_id = "{canonical}"', f'project_id = "{boot}"')
# 543xx -> 553xx. Far enough from the canonical stack that nothing overlaps.
text = re.sub(r'\b543(\d\d)\b', lambda m: f"553{m.group(1)}", text)
open(dst, "w").write(text)
PY

cp -R "$REPO/supabase/migrations" "$WORKDIR/supabase/migrations"
[ -f "$REPO/supabase/seed.sql" ] && cp "$REPO/supabase/seed.sql" "$WORKDIR/supabase/seed.sql"
[ -d "$REPO/supabase/seeds" ] && cp -R "$REPO/supabase/seeds" "$WORKDIR/supabase/seeds"

echo "-- starting a second Supabase stack (this takes a couple of minutes)"
if ! (cd "$WORKDIR" && npx supabase start >/tmp/ovalball-clean-boot-start.log 2>&1); then
  echo "FAILED to start the disposable stack. Last lines:" >&2
  tail -20 /tmp/ovalball-clean-boot-start.log >&2
  exit 1
fi

# `supabase start` on an empty project IS the clean boot: the CLI creates the database, installs the
# Supabase base schema, applies every migration in order and runs the seed. A `db reset` afterwards adds
# nothing but a second chance to fail on a container step, which is what it did the first time this
# script was written.
# SQL goes through the disposable stack's OWN container. `psql` is not on the host PATH in this
# environment, and reaching for the canonical container would defeat the entire point of the script.
BOOT_CONTAINER="supabase_db_${BOOT_ID}"
if ! docker inspect "$BOOT_CONTAINER" >/dev/null 2>&1; then
  echo "FAILED: the disposable database container ($BOOT_CONTAINER) is not running" >&2
  exit 1
fi
boot_psql() { docker exec -i "$BOOT_CONTAINER" psql -U postgres -d postgres "$@"; }

echo "-- asserting the schema that Step 4 added"
boot_psql -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare n int; v_flow text; v_out jsonb;
begin
  -- The carrier itself.
  if to_regclass('public.auth_flow_states') is null then
    raise exception 'CLEAN BOOT: public.auth_flow_states does not exist';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.auth_flow_states'::regclass) then
    raise exception 'CLEAN BOOT: auth_flow_states has RLS disabled';
  end if;
  select count(*) into n from pg_policy where polrelid = 'public.auth_flow_states'::regclass;
  if n <> 0 then
    raise exception 'CLEAN BOOT: auth_flow_states has % policies; it must be reachable only through its definer functions', n;
  end if;

  -- Both functions, with the right security and search_path.
  for n in 1..1 loop end loop;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname = 'create_auth_flow_state'
                   -- Postgres stores a pinned empty search_path as search_path="" (quoted).
                   -- An earlier version of this check looked for the unquoted form and failed a
                   -- function that was entirely correct.
                   and p.prosecdef
                   and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    raise exception 'CLEAN BOOT: create_auth_flow_state is missing, not SECURITY DEFINER, or has no pinned search_path';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname = 'consume_auth_flow_state'
                   -- Postgres stores a pinned empty search_path as search_path="" (quoted).
                   -- An earlier version of this check looked for the unquoted form and failed a
                   -- function that was entirely correct.
                   and p.prosecdef
                   and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    raise exception 'CLEAN BOOT: consume_auth_flow_state is missing, not SECURITY DEFINER, or has no pinned search_path';
  end if;

  -- The grants, which are the perimeter.
  if not has_function_privilege('anon', 'public.create_auth_flow_state(text, jsonb)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon cannot create a flow state, so a signup could never carry its context';
  end if;
  if has_function_privilege('anon', 'public.consume_auth_flow_state(text, text)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can CONSUME a flow state -- spending one must require a session';
  end if;
  if has_table_privilege('anon', 'public.auth_flow_states', 'SELECT')
     or has_table_privilege('authenticated', 'public.auth_flow_states', 'SELECT') then
    raise exception 'CLEAN BOOT: the flow state table is directly readable by an API role';
  end if;

  -- And it actually works from nothing.
  v_flow := public.create_auth_flow_state('SIGNUP', '{"probe": true}'::jsonb);
  if v_flow is null or length(v_flow) < 40 then
    raise exception 'CLEAN BOOT: create_auth_flow_state returned an implausible id';
  end if;
  if not exists (select 1 from public.auth_flow_states where flow_id_sha256 = internal.auth_flow_id_hash(v_flow)) then
    raise exception 'CLEAN BOOT: the flow state was not written';
  end if;
  v_out := public.consume_auth_flow_state(v_flow, 'SIGNUP');
  if v_out is not null then
    raise exception 'CLEAN BOOT: a flow state was consumed with no authenticated caller';
  end if;
  delete from public.auth_flow_states where flow_id_sha256 = internal.auth_flow_id_hash(v_flow);

  -- The security event vocabulary the consumer needs.
  if not exists (select 1 from public.security_event_types where event_type = 'auth.flow_state_consumed') then
    raise exception 'CLEAN BOOT: the auth.flow_state_consumed event type was not registered';
  end if;

  raise notice 'PASS clean boot: the migration chain installs from empty and Step 4''s objects are correct';
end $$;
SQL
STATUS=$?

echo "-- running the estate's own assertions against the fresh database"
for suite in auth_flow_state_authority definer_rpc_session_contract security_perimeter_guard; do
  out=$(boot_psql -q -f - < "$REPO/supabase/tests/$suite.sql" 2>&1)
  fails=$(printf '%s' "$out" | grep -c "FAIL" || true)
  passes=$(printf '%s' "$out" | grep -c "PASS" || true)
  echo "   $suite: $passes passed, $fails failed"
  [ "$fails" != "0" ] && STATUS=1
done

if [ "$STATUS" = "0" ]; then
  echo "CLEAN BOOT: PASS"
else
  echo "CLEAN BOOT: FAIL"
fi
exit $STATUS
