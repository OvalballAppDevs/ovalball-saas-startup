-- =====================================================================================================
-- SLICE 5 (16/n) -- the legacy plaintext token stops being readable
--
-- D-S5-AUTO-6 kept the read surface because three server actions inserted a legacy invitation and read
-- its token straight back to build the emailed link. Revoking the grant then would have shipped a real
-- regression -- invitation emails with no link in them -- to close a theoretical exposure.
--
-- All three now issue through public.issue_invitation, which returns the secret once and stores only
-- its hash. Nothing reads a legacy token any more (scripts/verify-legacy-invitation-token-readers.mjs
-- asserts that, and its allow-list is empty), so the condition that decision set is met and the grant
-- goes.
--
-- PostgreSQL will not let a column-level REVOKE take effect while a table-level SELECT grant exists,
-- so the table grant is replaced by an explicit column list that simply omits the token.
-- =====================================================================================================

do $$
declare
  t text;
  v_cols text;
begin
  foreach t in array array['invitations','guardian_invitations','player_account_invitations',
                           'site_admin_invitations','club_safeguarding_officer_invitations']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'token') then
      continue;
    end if;

    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name <> 'token';

    -- The table grant has to go first: a column REVOKE is silently pointless underneath one.
    execute format('revoke select on public.%I from authenticated', t);
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, t);
  end loop;
end $$;

-- The old accept-by-token RPCs still need to FIND a row by its token. They are security definer and
-- run as the owner, so they are unaffected by the grants above -- which is the point: matching a token
-- you already hold stays possible, and reading one you do not stays impossible.
do $$
declare t text; n int := 0;
begin
  foreach t in array array['invitations','guardian_invitations','player_account_invitations',
                           'site_admin_invitations','club_safeguarding_officer_invitations']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=t and column_name='token') then continue; end if;
    if has_column_privilege('authenticated', format('public.%I', t)::regclass, 'token', 'SELECT') then
      raise exception 'Slice 5: % still exposes its plaintext token to a browser role.', t;
    end if;
    if not has_column_privilege('authenticated', format('public.%I', t)::regclass, 'id', 'SELECT') then
      raise exception 'Slice 5: revoking the token on % took the whole table with it.', t;
    end if;
    n := n + 1;
  end loop;
  raise notice 'Slice 5: % legacy invitation tables keep their rows readable and their secret not', n;
end $$;
