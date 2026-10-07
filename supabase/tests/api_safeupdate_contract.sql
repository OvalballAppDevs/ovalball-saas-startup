-- THE API'S SAFEUPDATE CONTRACT.
--
-- WHAT THIS GUARDS
--
-- Every request that reaches the database through the API (PostgREST) runs as `authenticator`, whose
-- sessions preload `safeupdate`: an UPDATE or a DELETE with no WHERE clause is refused -- "DELETE
-- requires a WHERE clause" -- wherever it is parsed, including inside a SECURITY DEFINER function and
-- inside a trigger. psql sessions, where every other suite runs, do not load it, so a statement like
--
--     delete from pg_temp.working_set;
--
-- passes every suite and fails on every phone and every browser. Arena's Auto Allocate did exactly
-- that in live UAT (25 October busy day: "Couldn't calculate the allocation"), and the tournament
-- scheduler's working set had the same statement. A suite cannot LOAD the library itself here (the
-- `postgres` role is not a superuser and there is no plugins directory), so the contract is checked
-- where it is decided: the source of every function in `public` and `internal`.
--
--   S1. No function in `public` or `internal` holds an UPDATE ... SET or a DELETE FROM without WHERE.
--       Clearing a working table says so: `delete from pg_temp.x where true`.
--   S2. The scan itself still finds the statement it exists to find (a probe function with the old
--       statement is reported, then dropped with the rollback) -- so a quiet scan is never a broken one.
--
-- Comments are stripped before scanning; ON CONFLICT ... DO UPDATE SET and FOR UPDATE [OF/SKIP
-- LOCKED/NOWAIT] are not statements safeupdate refuses and are not reported.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

-- Every UPDATE ... SET / DELETE FROM in a function body that has no WHERE, as "schema.function: statement".
create or replace function pg_temp.unguarded() returns setof text language sql as $$
  with f as (
    select n.nspname, p.proname, regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))
  ),
  stmts as (
    select f.nspname, f.proname, m[1] as stmt
    from f, regexp_matches(f.src, '((?:delete\s+from|update)\s[^;]*;)', 'gi') as m
  )
  select nspname || '.' || proname || ': ' || left(regexp_replace(stmt, '\s+', ' ', 'g'), 120)
  from stmts
  where stmt !~* '\mwhere\M'
    and stmt !~* '^update\s+(set|of|skip|nowait)\M'     -- ON CONFLICT DO UPDATE SET, FOR UPDATE OF / SKIP LOCKED / NOWAIT
    and stmt !~* '^update\s*;'                           -- FOR UPDATE;
    and stmt ~* '^(delete\s+from\s+\S+|update\s+\S+(\s+\w+)?\s+set\M)'
  order by 1;
$$;

do $$
declare v_found text[];
begin
  v_found := array(select pg_temp.unguarded());
  perform pg_temp.check(cardinality(v_found) = 0,
    'S1 no public or internal function holds an UPDATE or DELETE without WHERE (the API''s safeupdate refuses one)'
    || case when cardinality(v_found) > 0 then ': ' || array_to_string(v_found, ' | ') else '' end);
end $$;

-- S2: the scan finds the statement it exists to find.
create or replace function internal.safeupdate_contract_probe() returns void language plpgsql as $$
begin
  create temp table if not exists safeupdate_probe (x int) on commit drop;
  delete from pg_temp.safeupdate_probe;   -- the statement safeupdate refuses
  update pg_temp.safeupdate_probe set x = 1;
  insert into pg_temp.safeupdate_probe values (1) on conflict do nothing;
end $$;

do $$
declare v_found text[];
begin
  v_found := array(select pg_temp.unguarded());
  perform pg_temp.check(
    'internal.safeupdate_contract_probe: delete from pg_temp.safeupdate_probe;' = any (v_found)
    and 'internal.safeupdate_contract_probe: update pg_temp.safeupdate_probe set x = 1;' = any (v_found)
    and cardinality(v_found) = 2,
    'S2 the scan reports a bare DELETE and a bare UPDATE, and nothing else, when a function holds them');
end $$;

rollback;
