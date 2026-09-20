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

-- =====================================================================================================
-- SLICE 7e (Convergence Step 5). The four migrations this step adds, asserted from empty rather than
-- assumed to have applied because the chain did not error. Two of them DELETE something -- the
-- is_site_admin helper, and the old history predicates -- and a migration that removes an object is
-- exactly the kind that passes on a database where the object was never there and fails on a real one.
-- =====================================================================================================
do $$
begin
  if to_regprocedure('public.site_search_users(text,text,text,text,int,int)') is null then
    raise exception 'CLEAN BOOT: AB.3 site_search_users does not exist';
  end if;
  if has_function_privilege('anon', 'public.site_search_users(text,text,text,text,int,int)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can search every account on the platform';
  end if;

  if to_regprocedure('public.site_player_team_memberships(uuid)') is null then
    raise exception 'CLEAN BOOT: the per-person roster read does not exist';
  end if;
  -- The point of that migration was that the fix was NOT a wider policy.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'player_team_memberships'
                and coalesce(qual,'') like '%has_site_capability%') then
    raise exception 'CLEAN BOOT: the roster RLS policy was widened; the definer read exists so it need not be';
  end if;

  if to_regprocedure('public.site_account_history(uuid)') is null then
    raise exception 'CLEAN BOOT: the account timeline does not exist';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'internal' and p.proname = 'is_site_admin') then
    raise exception 'CLEAN BOOT: internal.is_site_admin still exists after the retirement migration';
  end if;
  if pg_get_viewdef('public.admin_club_overview'::regclass, true) !~ 'site\.clubs\.view' then
    raise exception 'CLEAN BOOT: admin_club_overview is not gated on site.clubs.view';
  end if;

  raise notice 'PASS clean boot: Slice 7e''s objects are correct from empty, including what it removed';
end $$;

-- =====================================================================================================
-- CONVERGENCE STEP 6. Five migrations, and three of them REMOVE or NARROW something -- a dropped
-- function signature, a revoked table grant, a view's security mode. Those are exactly the migrations
-- that pass on a database where the thing was never there, so they are asserted from empty explicitly.
-- =====================================================================================================
do $$
declare v_writers text;
begin
  -- A fixture's pitch is at the fixture's ground.
  if position('does not belong to the selected venue' in pg_get_functiondef('public.update_fixture_pitch'::regproc)) = 0
     or position('not at that venue' in pg_get_functiondef('public.update_fixture_venue'::regproc)) = 0 then
    raise exception 'CLEAN BOOT: the fixture writers do not enforce pitch-belongs-to-venue';
  end if;

  -- One writer for a venue address, and the old signatures gone rather than left as overloads.
  if to_regprocedure('public.create_venue(uuid,text,text,text,text,boolean)') is not null
     or to_regprocedure('public.update_venue(uuid,text,text,text,text)') is not null then
    raise exception 'CLEAN BOOT: an address-writing venue signature survived';
  end if;
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','internal') and p.prokind = 'f'
    and p.prosrc ~ 'update\s+public\.venues' and p.prosrc ~ '(address_line_1|address\s*=|postcode\s*=)';
  if v_writers <> 'set_venue_address' then
    raise exception 'CLEAN BOOT: a venue address must have one writer; found %', v_writers;
  end if;

  -- L17: a session is not authority over every club's private columns.
  if has_table_privilege('authenticated', 'public.club_directory', 'SELECT') then
    raise exception 'CLEAN BOOT: authenticated holds a table-wide SELECT on club_directory (L17)';
  end if;
  if has_column_privilege('authenticated', 'public.club_directory', 'notes', 'SELECT')
     or has_column_privilege('authenticated', 'public.club_directory', 'official_email', 'SELECT') then
    raise exception 'CLEAN BOOT: club_directory private columns are readable by every session (L17)';
  end if;
  if not has_column_privilege('authenticated', 'public.club_directory', 'latitude', 'SELECT') then
    raise exception 'CLEAN BOOT: the revoke went too far -- opponent search and the partner map read latitude';
  end if;
  if (select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.admin_club_overview'::regclass) like '%security_invoker=true%' then
    raise exception 'CLEAN BOOT: admin_club_overview is security_invoker and would lose the private columns';
  end if;
  if to_regprocedure('public.site_club_directory_record(uuid)') is null then
    raise exception 'CLEAN BOOT: the directory editor''s narrow read does not exist';
  end if;

  raise notice 'PASS clean boot: Step 6''s objects are correct from empty, including what they revoked';
end $$;

-- =====================================================================================================
-- CONVERGENCE STEP 7. Two migrations. One adds a definer function whose whole value is WHICH authority
-- it asks, and the other WIDENS a public projection -- both are the kind whose mistake is invisible on
-- a database where nobody looks, so both are asserted here from empty.
-- =====================================================================================================
do $$
declare v_cols text;
begin
  -- The availability summary must authorise on the capability that governs the
  -- rows it counts, not on fixture-management authority. A definer function
  -- that asks a different question from the data is how a caller ends up able
  -- to count what they may not read.
  if to_regprocedure('public.fixture_availability_summary(uuid[])') is null then
    raise exception 'CLEAN BOOT: the availability summary does not exist';
  end if;
  if position('team.attendance.view' in pg_get_functiondef('internal.fixture_attendance_readable_team_ids'::regproc)) = 0 then
    raise exception 'CLEAN BOOT: attendance readability is not answered by team.attendance.view';
  end if;
  if position('can_manage_fixture_side' in pg_get_functiondef('internal.fixture_attendance_readable_team_ids'::regproc)) > 0 then
    raise exception 'CLEAN BOOT: attendance readability is answered by fixture-management authority';
  end if;
  -- And it must not be executable by the world.
  if has_function_privilege('anon', 'public.fixture_availability_summary(uuid[])', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can execute the availability summary';
  end if;

  -- The public venue projection publishes exactly what it declares, and stays
  -- owner-rights -- its column list IS its access boundary.
  select string_agg(column_name, ',' order by column_name) into v_cols
  from information_schema.columns where table_schema = 'public' and table_name = 'public_venues';
  if v_cols is distinct from 'club_id,id,is_default_home,name,only_pitch_name' then
    raise exception 'CLEAN BOOT: public_venues publishes %', v_cols;
  end if;
  if (select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.public_venues'::regclass) not like '%security_invoker=false%' then
    raise exception 'CLEAN BOOT: public_venues is no longer an owner-rights projection';
  end if;
  -- It must never carry an address: a venue's address is the club's own
  -- surface, not the anonymous one.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'public_venues'
               and column_name in ('address', 'postcode', 'address_line_1', 'latitude', 'longitude')) then
    raise exception 'CLEAN BOOT: public_venues publishes a venue address';
  end if;

  raise notice 'PASS clean boot: Step 7''s objects are correct from empty, including what they publish';
end $$;
SQL
STATUS=$?

echo "-- running the estate's own assertions against the fresh database"
for suite in auth_flow_state_authority definer_rpc_session_contract security_perimeter_guard site_admin_users_access_closure authority_helper_retirement club_venue_pitch_integrity club_directory_privacy fixture_availability_summary fixture_search_and_venue_authority; do
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
