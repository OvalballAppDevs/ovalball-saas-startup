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

-- =====================================================================================================
-- CONVERGENCE STEP 8 / SLICE 8. Four migrations, and every one of them is the kind whose mistake is
-- invisible until somebody is given authority they should not have: a preset catalogue that could carry
-- a key a club may not delegate, a club timeline that could reach another club or publish forensic
-- fields, a role catalogue label, and the seat rule moving out of a plpgsql literal into the catalogue.
-- =====================================================================================================
do $$
declare v_bad text; v_seat text; v_def text;
begin
  -- A preset may only carry what a club could have granted one at a time.
  if to_regprocedure('public.apply_capability_preset(uuid,text,uuid,text)') is null then
    raise exception 'CLEAN BOOT: the preset applier does not exist';
  end if;
  select string_agg(distinct pc.capability_key, ', ') into v_bad
  from public.capability_preset_capabilities pc
  left join public.capabilities c on c.key = pc.capability_key
  join public.capability_presets p on p.key = pc.preset_key
  where c.key is null or c.status <> 'ACTIVE' or not c.delegable or c.safeguarding_sensitive
     or c.domain in ('people', 'finance') or c.key like 'site.%'
     or not (p.scope_type = any (c.valid_scopes));
  if v_bad is not null then
    raise exception 'CLEAN BOOT: a preset carries capabilities it must not: %', v_bad;
  end if;
  if (select count(*) from public.capability_presets where status = 'ACTIVE') <> 3 then
    raise exception 'CLEAN BOOT: the three presets the design names are not all present from empty';
  end if;
  -- And it must go through set_capability_override rather than writing overrides itself.
  if position('set_capability_override' in pg_get_functiondef('public.apply_capability_preset(uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'CLEAN BOOT: the preset applier writes overrides itself instead of calling the canonical function';
  end if;

  -- The club timeline is scoped to one club and publishes no forensic field.
  if to_regprocedure('public.club_access_history(uuid,uuid,integer)') is null then
    raise exception 'CLEAN BOOT: the club access timeline does not exist';
  end if;
  select pg_get_function_result('public.club_access_history(uuid,uuid,integer)'::regprocedure) into v_def;
  if v_def like '%ip_hash%' or v_def like '%user_agent_hash%' or v_def like '%request_id%'
     or v_def like '%metadata%' or v_def like '%impersonation%' then
    raise exception 'CLEAN BOOT: the club timeline publishes a forensic field: %', v_def;
  end if;
  if position('e.club_id = p_club_id' in pg_get_functiondef('public.club_access_history(uuid,uuid,integer)'::regprocedure)) = 0 then
    raise exception 'CLEAN BOOT: the club timeline is not scoped to the club it was asked about';
  end if;
  if has_function_privilege('anon', 'public.club_access_history(uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can execute the club access timeline';
  end if;

  -- One spelling for one role, in every catalogue a person reads.
  if exists (select 1 from public.role_definitions where label like '%Fixtures%')
     or exists (select 1 from public.capability_bundles where label like '%Fixtures%') then
    raise exception 'CLEAN BOOT: a catalogue still says "Fixtures" where the product says "Fixture"';
  end if;

  -- The seat rule lives in the catalogue, and the function reads it.
  select string_agg(role_key, ',' order by role_key) into v_seat
    from public.role_definitions where is_primary_seat;
  if v_seat is distinct from 'CLUB_ADMIN,FIXTURES_SECRETARY,MEMBER' then
    raise exception 'CLEAN BOOT: the primary seat is %', coalesce(v_seat, '(none)');
  end if;
  if position('is_primary_seat' in pg_get_functiondef('internal.apply_primary_club_role'::regproc)) = 0 then
    raise exception 'CLEAN BOOT: apply_primary_club_role does not read the catalogue for the seat';
  end if;

  raise notice 'PASS clean boot: Step 8''s objects are correct from empty, and grant nothing a club could not grant by hand';
end $$;

-- =====================================================================================================
-- CONVERGENCE STEP 9. One rule and one narrow write, and both are the kind whose mistake is a privacy
-- failure: a transition resolver that answered for anybody who asked, or an adult's decision that
-- reached further than the one relationship it was about.
-- =====================================================================================================
do $$
declare v_def text;
begin
  if to_regprocedure('public.player_adult_transition(uuid,date)') is null then
    raise exception 'CLEAN BOOT: the adult transition resolver does not exist';
  end if;
  if to_regprocedure('public.end_my_guardian_access(uuid,text)') is null then
    raise exception 'CLEAN BOOT: the adult player''s own decision does not exist';
  end if;
  if has_function_privilege('anon', 'public.player_adult_transition(uuid,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.end_my_guardian_access(uuid,text)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can reach a family function';
  end if;

  -- The authority check must not be able to fail open through three-valued
  -- logic. A player with no linked account has user_id = null, and a bare
  -- `user_id = actor()` makes the whole OR chain NULL rather than false, so
  -- `if not (...)` never fires. Step 9's own suite found exactly that.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'player_adult_transition';
  if position('v_user is not null and v_user = internal.actor()' in v_def) = 0 then
    raise exception 'CLEAN BOOT: the transition resolver compares a nullable user id without guarding for null';
  end if;

  -- The adult's decision uses the canonical age predicate and touches one table.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'end_my_guardian_access';
  if position('internal.player_effective_age' in v_def) = 0 then
    raise exception 'CLEAN BOOT: the adult decision does not use the canonical age predicate';
  end if;
  if v_def ~ 'update public\.(players|club_memberships|player_team_memberships|role_assignments)' then
    raise exception 'CLEAN BOOT: the adult decision writes to something other than the relationship';
  end if;

  raise notice 'PASS clean boot: Step 9''s family rule is correct from empty, and reaches exactly one relationship';
end $$;

-- =====================================================================================================
-- CONVERGENCE STEP 10. One reader and one column. The reader's mistake would be a badge that outlives
-- the relationship it names, or a team another club can enumerate; the column's would be a second media
-- architecture beside the one Club Home already has.
-- =====================================================================================================
do $$
declare v_def text;
begin
  if to_regprocedure('public.my_team_relationship(uuid)') is null then
    raise exception 'CLEAN BOOT: the team relationship reader does not exist';
  end if;
  if has_function_privilege('anon', 'public.my_team_relationship(uuid)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can ask who they are to a team';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_team_relationship';
  if v_def ~ '''TEAM_ADMIN''' then
    raise exception 'CLEAN BOOT: the team relationship reader names the retired team_admin role';
  end if;
  if v_def !~ 'ra.state = ''ACTIVE''' or v_def !~ 'cm.state = ''ACTIVE''' then
    raise exception 'CLEAN BOOT: a badge could outlive a revoked role or a suspended membership';
  end if;
  if v_def !~ 'team.team.view' then
    raise exception 'CLEAN BOOT: the team relationship reader does not gate on seeing the team';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'teams' and column_name = 'cover_image_path') then
    raise exception 'CLEAN BOOT: the team cover column does not exist';
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name like '%team_media%') then
    raise exception 'CLEAN BOOT: a second media architecture appeared for team covers';
  end if;

  raise notice 'PASS clean boot: Step 10''s team reader is correct from empty, and no badge outlives its relationship';
end $$;

-- CONVERGENCE STEP 11 -- the community layer, from empty.
do $$
begin
  if to_regprocedure('public.get_match_community(uuid)') is null then
    raise exception 'CLEAN BOOT: the match community reader does not exist';
  end if;
  if has_function_privilege('anon', 'public.cast_match_award_vote(uuid, uuid)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can vote';
  end if;
  -- The canonical catalogue must arrive seeded, with the age-dependent category intact.
  if not exists (select 1 from public.match_award_categories
                  where category_key = 'FAMILY_OR_SELF_PLAYER'
                    and electorate = 'FAMILY_OR_SELF'
                    and name_youth = 'Parents'' Player' and name_adult = 'Players'' Player') then
    raise exception 'CLEAN BOOT: the age-dependent award category is missing or has lost its two names';
  end if;
  if (select count(*) from public.match_kudos_kinds where active) < 3 then
    raise exception 'CLEAN BOOT: the kudos vocabulary did not arrive';
  end if;
  -- One vote per person is a constraint from the first migration onward, not something added later.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.match_award_votes'::regclass and c.contype = 'u'
                    and pg_get_constraintdef(c.oid) ~ 'voter_user_id') then
    raise exception 'CLEAN BOOT: nothing stops one person voting twice';
  end if;
  -- No free text about children, and no currency.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'match_kudos'
                and column_name in ('note','message','body','comment')) then
    raise exception 'CLEAN BOOT: match_kudos grew a free-text field';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('match_kudos','match_awards')
                and column_name ~ 'points|amount|balance|credit|pence') then
    raise exception 'CLEAN BOOT: a points or currency column appeared in recognition';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'club_articles' and column_name = 'fixture_id') then
    raise exception 'CLEAN BOOT: the match report has no match to belong to';
  end if;
  raise notice 'PASS clean boot: Step 11''s recognition arrives seeded, positive, one-vote-per-person and without a currency';
end $$;

-- CONVERGENCE STEP 12 -- age grade, from empty.
do $$
begin
  if to_regprocedure('public.team_age_grade_attention(uuid, date)') is null
     or to_regprocedure('public.my_player_age_grade_status(uuid, date)') is null then
    raise exception 'CLEAN BOOT: the age-grade readers do not exist';
  end if;
  if has_function_privilege('anon', 'public.team_age_grade_attention(uuid, date)', 'EXECUTE') then
    raise exception 'CLEAN BOOT: anon can read age-grade status';
  end if;
  -- The readers must lean on the canonical resolvers, not on arithmetic of their own.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'team_age_grade_status') !~ 'resolve_season_for_date' then
    raise exception 'CLEAN BOOT: age grade does not resolve its season from the canonical register';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'team_age_grade_status') !~ 'resolve_player_age_grade' then
    raise exception 'CLEAN BOOT: age grade does not read the canonical age-grade resolver';
  end if;
  -- ONE ADULT ANSWER: Match Centre's electorate test must delegate, not decide again.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'match_side_is_adult') !~ 'team_is_adult_side' then
    raise exception 'CLEAN BOOT: the electorate adult test decides adulthood for itself again';
  end if;
  -- Status, never evidence: no operational reader may return a date of birth or anything medical.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join unnest(p.proallargtypes, p.proargnames) as a(t, nm) on true
     where n.nspname = 'public' and p.proname in ('team_age_grade_attention', 'my_player_age_grade_status')
       and a.nm ~* 'dob|date_of_birth|birth|medical|emergency|note') then
    raise exception 'CLEAN BOOT: an operational age-grade reader returns evidence';
  end if;
  -- The safeguarding confirmation seam exists from empty.
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.role_assignments'::regclass
                  and pg_get_constraintdef(c.oid) ~ 'SAFEGUARDING_OFFICER'
                  and pg_get_constraintdef(c.oid) ~ 'confirmation_state') then
    raise exception 'CLEAN BOOT: the safeguarding confirmation seam is missing';
  end if;
  raise notice 'PASS clean boot: Step 12 reports age grade from the canonical resolvers and the canonical season, without evidence, sharing one adult answer';
end $$;
SQL
STATUS=$?

echo "-- running the estate's own assertions against the fresh database"
for suite in auth_flow_state_authority definer_rpc_session_contract security_perimeter_guard site_admin_users_access_closure authority_helper_retirement club_venue_pitch_integrity club_directory_privacy fixture_availability_summary fixture_search_and_venue_authority step8_operational_access step9_family_and_availability step10_team_experience step11_match_community step12_safeguarding_and_age_grade; do
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
