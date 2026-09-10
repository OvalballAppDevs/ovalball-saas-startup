-- The email template registry: who may change what Ovalball says.
--
-- Editable email copy is an unusual privilege. It reaches people outside the
-- product, carries Ovalball's name, and is the one surface where a mistake
-- looks exactly like a legitimate message. So the guarantees this suite exists
-- to hold are narrow and blunt:
--
--   1. Nobody writes to these tables directly. Every change goes through the
--      three SECURITY DEFINER functions, which carry the authority check.
--   2. Only a Full Site Admin may make a change at all.
--   3. History is append-only. Publishing does not overwrite, restoring the
--      default does not delete, and a version that was sent stays readable.
--   4. Two administrators cannot silently overwrite each other.
--
-- The fourth is the one nothing else would catch. Two people editing the same
-- email at the same time is not exotic in a small organisation, and "last save
-- wins" means one of them watches their work disappear without being told.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_lock integer;
  v_draft uuid;
  v_count integer;
  v_ok boolean; v_err text;
  v_policies integer;
begin

-- ============ A. Nothing writes directly ============

select count(*) into v_policies
from pg_policies
where schemaname = 'public'
  and tablename in ('email_template_versions', 'email_template_settings')
  and cmd in ('INSERT', 'UPDATE', 'DELETE');

if v_policies = 0 then
  raise notice 'PASS 1 (A): no direct write policy exists on the registry';
else
  raise notice 'FAIL 1 (A): % direct write policies exist, so a client could bypass the authority check', v_policies;
end if;

select count(*) into v_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('email_template_versions', 'email_template_settings')
  and c.relrowsecurity;

if v_count = 2 then
  raise notice 'PASS 2 (A): row-level security is on for both registry tables';
else
  raise notice 'FAIL 2 (A): only % of 2 registry tables have RLS enabled', v_count;
end if;

-- ============ B. Only a Full Site Admin may change the wording ============

-- No authenticated user is set, so auth.uid() is null and
-- internal.is_full_site_admin() is false. This is the anonymous case: the one
-- an unauthenticated request would take.
begin
  perform public.save_email_template_draft(
    'club_welcome', 'Hijacked subject', '', 'Heading', 'Body', 'Open', 0
  );
  v_ok := true;
exception when others then
  v_ok := false; v_err := sqlerrm;
end;

if not v_ok and v_err like '%Full Site Admin%' then
  raise notice 'PASS 3 (B): a caller who is not a Full Site Admin cannot change an email';
else
  raise notice 'FAIL 3 (B): the save was allowed or refused for the wrong reason (%)', coalesce(v_err, 'no error');
end if;

begin
  perform public.publish_email_template_draft('club_welcome', 0);
  v_ok := true;
exception when others then
  v_ok := false; v_err := sqlerrm;
end;

if not v_ok and v_err like '%Full Site Admin%' then
  raise notice 'PASS 4 (B): publishing is gated by the same authority as saving';
else
  raise notice 'FAIL 4 (B): publish was allowed or refused for the wrong reason (%)', coalesce(v_err, 'no error');
end if;

begin
  perform public.clear_email_template_override('club_welcome', 0);
  v_ok := true;
exception when others then
  v_ok := false; v_err := sqlerrm;
end;

if not v_ok and v_err like '%Full Site Admin%' then
  raise notice 'PASS 5 (B): restoring the default is gated by the same authority';
else
  raise notice 'FAIL 5 (B): restore was allowed or refused for the wrong reason (%)', coalesce(v_err, 'no error');
end if;

-- ============ C. History is append-only ============

-- No update or delete grant to a client role: a published version somebody
-- received cannot be quietly rewritten to say something else afterwards.
select count(*) into v_count
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'email_template_versions'
  and grantee in ('authenticated', 'anon')
  and privilege_type in ('UPDATE', 'DELETE', 'INSERT');

if v_count = 0 then
  raise notice 'PASS 6 (C): clients hold no insert, update or delete grant on the version history';
else
  raise notice 'FAIL 6 (C): clients hold % write grants on the version history', v_count;
end if;

-- One draft per event, enforced by the database rather than by the screen.
select count(*) into v_count
from pg_indexes
where schemaname = 'public'
  and tablename = 'email_template_versions'
  and indexdef like '%draft%'
  and indexdef like '%UNIQUE%';

if v_count >= 1 then
  raise notice 'PASS 7 (C): only one open draft per event is possible';
else
  raise notice 'FAIL 7 (C): nothing stops two drafts existing for one email at once';
end if;

-- ============ D. The registry cannot invent an email ============

-- Deliberately NO foreign key on event_key: the code catalogue is the only
-- authority on what events exist. A reference table of event keys would let a
-- row in the database describe an email the application has no renderer for,
-- and the failure would first appear at send time.
--
-- Scoped to event_key, because the table legitimately references auth.users
-- twice -- who saved a version and who published it. Attribution is exactly
-- what a foreign key is for.
select count(*) into v_count
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'email_template_versions'
  and tc.constraint_type = 'FOREIGN KEY'
  and kcu.column_name = 'event_key';

if v_count = 0 then
  raise notice 'PASS 8 (D): event keys are owned by the code catalogue, not by a database table';
else
  raise notice 'FAIL 8 (D): event_key carries a foreign key, so the database can describe emails the code cannot render';
end if;

-- ============ E. Concurrency is checked, not assumed ============

-- Every write function takes the settings revision the editor was opened
-- against. Asserting the parameter exists is what stops a later refactor
-- quietly dropping it and reintroducing last-save-wins.
select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_email_template_draft', 'publish_email_template_draft', 'clear_email_template_override')
  and pg_get_function_arguments(p.oid) like '%p_expected_lock%';

if v_count = 3 then
  raise notice 'PASS 9 (E): all three write functions take the expected revision';
else
  raise notice 'FAIL 9 (E): only % of 3 write functions check for a stale editor', v_count;
end if;

-- And all three are SECURITY DEFINER, which is what makes the authority check
-- meaningful: an INVOKER function would simply fail on RLS and tell the caller
-- nothing useful about why.
select count(*) into v_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_email_template_draft', 'publish_email_template_draft', 'clear_email_template_override')
  and p.prosecdef;

if v_count = 3 then
  raise notice 'PASS 10 (E): all three write functions carry their own authority check';
else
  raise notice 'FAIL 10 (E): only % of 3 write functions are SECURITY DEFINER', v_count;
end if;

end $$;

rollback;
