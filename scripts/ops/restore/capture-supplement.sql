-- Ovalball logical-backup SUPPLEMENT: everything `supabase db dump` leaves out that a restore needs.
--
-- READ-ONLY. Every statement is a SELECT that prints SQL text; nothing is written. Run it in a session that is
-- itself read-only, so that guarantee does not rest on this file alone:
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$SOURCE_DB_URL" -X -tA -v ON_ERROR_STOP=1 \
--     -v part=<part> -f capture-supplement.sql > <part>.sql
--
-- with part one of:
--   managed     project triggers and policies living in Supabase-managed schemas (auth, storage, realtime)
--   defer       drops for CHECK constraints that call project functions (applied after schema, before data)
--   recheck     re-adds those constraints NOT VALID, then validates them (applied after data)
--   cron        pg_cron jobs, with their active flag
--   ledger      the migration ledger (supabase_migrations.schema_migrations)
--   vaultnames  the NAMES of Vault secrets, for the restore checklist (values are never read here)
--
-- Secret VALUES are deliberately out of scope: they come from the owner's secret manager at restore time.
select set_config('search_path', '', false) \g /dev/null

\if :{?part}
\else
  \echo 'set -v part=managed|defer|recheck|cron|ledger|vaultnames'
  \quit
\endif

select set_config('ovalball.capture_part', :'part', false) \g /dev/null

-- managed -------------------------------------------------------------------------------------------------
select '-- project triggers on managed schemas' where current_setting('ovalball.capture_part') = 'managed';
select pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
 where current_setting('ovalball.capture_part') = 'managed'
   and not t.tgisinternal and n.nspname in ('auth', 'storage', 'realtime') and pn.nspname not in ('auth', 'storage', 'realtime')
 order by 1;
select '-- project policies on managed schemas' where current_setting('ovalball.capture_part') = 'managed';
select format('create policy %I on %I.%I as %s for %s to %s%s%s;',
              policyname, schemaname, tablename, permissive, cmd,
              (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
              case when qual is not null then ' using (' || qual || ')' else '' end,
              case when with_check is not null then ' with check (' || with_check || ')' else '' end)
  from pg_catalog.pg_policies
 where current_setting('ovalball.capture_part') = 'managed' and schemaname in ('storage', 'auth', 'realtime')
 order by schemaname, tablename, policyname;

-- defer / recheck -----------------------------------------------------------------------------------------
with fc as (
  select c.oid, n.nspname, cl.relname, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
   where c.contype = 'c'
     and exists (select 1 from pg_depend d join pg_proc p on p.oid = d.refobjid join pg_namespace pn on pn.oid = p.pronamespace
                  where d.classid = 'pg_constraint'::regclass and d.objid = c.oid and d.refclassid = 'pg_proc'::regclass
                    and pn.nspname not in ('pg_catalog', 'information_schema'))
)
select line from (
  select 1 as o, nspname, relname, conname, format('alter table %I.%I drop constraint %I;', nspname, relname, conname) as line
    from fc where current_setting('ovalball.capture_part') = 'defer'
  union all
  select 1, nspname, relname, conname, format('alter table %I.%I add constraint %I %s not valid;', nspname, relname, conname, def)
    from fc where current_setting('ovalball.capture_part') = 'recheck'
  union all
  select 2, nspname, relname, conname, format('alter table %I.%I validate constraint %I;', nspname, relname, conname)
    from fc where current_setting('ovalball.capture_part') = 'recheck'
) x order by o, nspname, relname, conname;

-- cron ----------------------------------------------------------------------------------------------------
select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
  from cron.job where current_setting('ovalball.capture_part') = 'cron' order by jobname;
select format('select cron.alter_job((select jobid from cron.job where jobname = %L), active := false);', jobname)
  from cron.job where current_setting('ovalball.capture_part') = 'cron' and not active order by jobname;

-- ledger --------------------------------------------------------------------------------------------------
select 'create schema if not exists supabase_migrations;' where current_setting('ovalball.capture_part') = 'ledger';
select 'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);'
 where current_setting('ovalball.capture_part') = 'ledger';
select format('insert into supabase_migrations.schema_migrations (version, name, statements) values (%L, %L, %L) on conflict (version) do nothing;',
              version, name, statements)
  from supabase_migrations.schema_migrations where current_setting('ovalball.capture_part') = 'ledger' order by version;

-- vaultnames ----------------------------------------------------------------------------------------------
select '-- ' || name from vault.secrets where current_setting('ovalball.capture_part') = 'vaultnames' order by name;
