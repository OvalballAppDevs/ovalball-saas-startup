-- The email registry's history is append-only in the grant table too.
--
-- The previous migration made every write go through the three authority-
-- checked functions, and enabled row-level security with no insert, update or
-- delete policy. That is already sufficient: with RLS on and no write policy,
-- a client write is refused.
--
-- It is sufficient in the way a locked door in an unlocked building is
-- sufficient. Supabase grants ALL on new public tables to `anon` and
-- `authenticated` by default, so both roles currently hold INSERT, UPDATE,
-- DELETE and TRUNCATE on the version history -- privileges nobody chose, held
-- by roles that must never use them, on the one table whose entire purpose is
-- to record what Ovalball told people and when. The day somebody adds a
-- convenience policy for an unrelated reason, those grants are what decides
-- whether the audit trail can be rewritten.
--
-- TRUNCATE is the one that matters most: it is not filtered by RLS at all.
-- A row-level policy has no row to check when the whole table is emptied.
--
-- The SECURITY DEFINER write functions run as the table owner, so revoking
-- these grants does not touch the legitimate path. Read access stays, because
-- Site Admin has to be able to see the history, and that IS policy-filtered.

revoke insert, update, delete, truncate, references, trigger
  on public.email_template_versions from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.email_template_settings from anon, authenticated;

comment on table public.email_template_versions is
  'Append-only history of email wording. Readable by Site Admin, written only by save_email_template_draft / publish_email_template_draft -- clients hold no write grant.';

-- Verification. A migration that silently did nothing would leave exactly the
-- state it was written to fix.
do $$
declare
  v_grants integer;
begin
  select count(*) into v_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('email_template_versions', 'email_template_settings')
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  if v_grants > 0 then
    raise exception 'The email registry still carries % client write grants.', v_grants;
  end if;
end $$;
