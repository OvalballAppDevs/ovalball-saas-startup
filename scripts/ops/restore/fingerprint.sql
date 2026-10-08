-- Ovalball database fingerprint: one row per category (count + md5), for comparing a restore with its source.
-- READ-ONLY. Run in a read-only session:  PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -f fingerprint.sql
-- Pass -v detail=1 to print one row per object instead (to find WHICH object differs).
--
-- Categories: fn (definitions), col, pol (public/internal/storage/realtime), rel (kind, owner, RLS enabled/forced, ACL),
-- con (constraint definitions + validated), view, idx, seq (last value), pub (publications), evt (event triggers),
-- roleset (role/database settings, secret-like values excluded), grant (EXECUTE for anon/authenticated/service_role on
-- public and internal functions), tgrant (anon/authenticated/service_role table privileges), trigger (incl. auth and storage), rows (count per public
-- table), data (content hash per public table), auth (counts), storage (object and bucket names), vault (secret
-- NAMES only), cron (jobs with schedule and active flag), ext (extensions and versions).
\if :{?detail}
\else
  \set detail 0
\endif
with fp_objects as (
select 'fn' as k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as obj, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','internal','testing') and p.prokind in ('f','p')
union all select 'col', table_schema||'.'||table_name||'.'||column_name, md5(coalesce(data_type,'')||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||coalesce(generation_expression,'')) from information_schema.columns where table_schema in ('public','internal')
union all select 'pol', schemaname||'.'||tablename||'.'||policyname, md5(cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')) from pg_policies where schemaname in ('public','internal','storage','realtime')
union all select 'grant', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(has_function_privilege('anon',p.oid,'execute')::text||has_function_privilege('authenticated',p.oid,'execute')::text||has_function_privilege('service_role',p.oid,'execute')::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','internal')
union all select 'tgrant', table_schema||'.'||table_name||'.'||grantee, md5(string_agg(privilege_type, ',' order by privilege_type)) from information_schema.role_table_grants where table_schema in ('public','internal') and grantee in ('anon','authenticated','service_role') group by table_schema, table_name, grantee
union all select 'trigger', event_object_schema||'.'||event_object_table||'.'||trigger_name||'.'||event_manipulation, md5(action_statement||action_timing) from information_schema.triggers where event_object_schema in ('public','internal','auth','storage')
union all select 'rows', 'public.'||c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'data', 'public.'||c.relname, (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from public.%I t', chr(10), '', c.relname), false, true, '')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'rel', n.nspname||'.'||c.relname, md5(c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity::text||'|'||c.relforcerowsecurity::text||'|'||array_to_string(array(select x::text from unnest(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) x order by 1),' ')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','internal') and c.relkind in ('r','v','m','S','p')
union all select 'con', n.nspname||'.'||cl.relname||'.'||co.conname, md5(pg_get_constraintdef(co.oid)||'|'||co.convalidated::text) from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname in ('public','internal')
union all select 'view', schemaname||'.'||viewname, md5(definition) from pg_views where schemaname in ('public','internal')
union all select 'idx', schemaname||'.'||indexname, md5(indexdef) from pg_indexes where schemaname in ('public','internal')
union all select 'seq', schemaname||'.'||sequencename, coalesce(last_value::text,'') from pg_sequences where schemaname in ('public','internal')
union all select 'pub', 'publications', (select string_agg(pubname||':'||schemaname||'.'||tablename, ',' order by 1) from pg_publication_tables)
union all select 'evt', 'event_triggers', (select string_agg(evtname||'@'||pg_get_userbyid(evtowner)||'@'||evtenabled::text, ',' order by evtname) from pg_event_trigger)
union all select 'roleset', coalesce(pg_get_userbyid(setrole),'*')||'@'||coalesce(setdatabase::text,'*'), md5(array_to_string(array(select x from unnest(setconfig) x where x !~* '(secret|key|password|token)' order by x),' ')) from pg_db_role_setting
union all select 'auth', 'auth.users', (select count(*)::text from auth.users)
union all select 'auth', 'auth.identities', (select count(*)::text from auth.identities)
union all select 'storage', 'storage.objects', (select string_agg(bucket_id||'/'||name, ',' order by name) from storage.objects)
union all select 'storage', 'storage.buckets', (select string_agg(id, ',' order by id) from storage.buckets)
union all select 'vault', 'vault.secrets', (select string_agg(name, ',' order by name) from vault.secrets)
union all select 'cron', 'cron.job', (select string_agg(jobname||'@'||schedule||'@'||active, ',' order by jobname) from cron.job)
union all select 'ext', 'extensions', (select string_agg(extname||'@'||extversion, ',' order by extname) from pg_extension)
), detail as (
  select k, obj, h from fp_objects where :detail = 1
), summary as (
  select k, count(*)::text as obj, md5(string_agg(obj||'='||coalesce(h,''), ',' order by obj)) as h from fp_objects where :detail = 0 group by k
)
select * from detail union all select * from summary order by 1, 2;
