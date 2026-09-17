-- =====================================================================================================
-- SLICE 5 (11/n) -- retiring the plaintext legacy invitation tokens (Phase 2 O.5)
--
-- Six legacy tables store their invitation token in PLAINTEXT. Anybody who can read the row can use
-- the invitation, which includes a database backup, a support query and a leaked replica. Phase 2
-- line 54 assigns this to Slice 5, and O.5 states the disposition exactly:
--
--   "Legacy plaintext token columns are nulled for REDEEMED, REVOKED and EXPIRED rows in Slice 5,
--    and after their expiry for ISSUED rows."
--
-- Nothing is invented here and nothing legitimate is invalidated. A terminal row's token cannot be
-- used for anything, so nulling it removes a credential and no capability. A live pending invitation
-- keeps its token until it expires, exactly as O.5 requires, and then loses it to the job below.
--
-- Production at the time of writing holds SEVEN site_admin_invitations rows, all with plaintext
-- tokens: six REVOKED and one pending, all expiring 2026-09-21. The six revoked ones are plaintext
-- credentials for PLATFORM authority sitting in a table with no remaining purpose; they go now. The
-- pending one is honoured.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 0. D-S5-AUTO-5: the legacy token columns become nullable.
--
-- All six are NOT NULL, which makes O.5's disposition impossible to carry out -- "null the plaintext
-- token" cannot be done to a column that refuses null. The constraint was protecting an invariant
-- that no longer holds: a legacy invitation used to need its token for its whole life, and now a
-- terminal one must not have it.
--
-- This cannot break a writer. Every legacy issuing RPC supplies a token, and the only thing that ever
-- writes null is the retirement job below. Alternatives rejected: writing a sentinel like '' or
-- 'RETIRED' (a value that still has to be excluded everywhere, and reads as a token in a backup);
-- deleting terminal rows outright (destroys the audit history O.5 explicitly keeps as read-only).
-- ---------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select unnest(array[
      'invitations','guardian_invitations','player_account_invitations',
      'site_admin_invitations','club_safeguarding_officer_invitations','club_ovalball_invitations']) as t
  loop
    execute format('alter table public.%I alter column token drop not null', r.t);
  end loop;
  raise notice 'Slice 5: legacy token columns are now nullable, so a terminal row can lose its secret';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 1. The job. One place that knows the rule, so it can be re-run and scheduled.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.null_legacy_invitation_tokens()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_total integer := 0; v_n integer; r record;
begin
  for r in select unnest(array[
      'invitations','guardian_invitations','player_account_invitations',
      'site_admin_invitations','club_safeguarding_officer_invitations','club_ovalball_invitations']) as t
  loop
    -- Terminal now, or past its expiry whatever the status says. A row whose expiry has passed is
    -- not honoured by anything, so holding its secret has no purpose either.
    execute format(
      'update public.%I set token = null where token is not null and (status in (''accepted'',''revoked'',''expired'') or expires_at <= now())',
      r.t);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

revoke all on function internal.null_legacy_invitation_tokens() from public, anon, authenticated;

comment on function internal.null_legacy_invitation_tokens() is
  'Phase 2 O.5. Clears the plaintext token from legacy invitation rows that are terminal or past '
  'expiry. A live pending invitation keeps its token until it expires, so nothing legitimate is '
  'invalidated. Safe to re-run.';

-- ---------------------------------------------------------------------------------------------------
-- 2. Run it now.
-- ---------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  v_n := internal.null_legacy_invitation_tokens();
  raise notice 'Slice 5: cleared the plaintext token from % legacy invitation row(s)', v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Stop the surface growing back.
--
-- The legacy issuing RPCs still write a plaintext token, and they cannot be retired until the
-- application moves to the canonical issuer -- doing it now would break live flows and would breach
-- O.5's own instruction that legacy invitations are honoured until expiry. What CAN be closed now is
-- the read surface: the token column is not needed by any browser query, and nothing reads it through
-- the API today. A column-level revoke means a stray `select *` cannot carry a secret to a client
-- even if a future policy is written too loosely.
-- ---------------------------------------------------------------------------------------------------
-- A column-level REVOKE does nothing while a table-level SELECT grant exists: in PostgreSQL the
-- table grant already covers every column. So the table grant is replaced by an explicit grant of
-- every column EXCEPT token, generated from the catalogue rather than typed out, so a column added
-- later is not silently dropped from the grant.
do $$
declare r record; v_cols text;
begin
  for r in select unnest(array[
      'invitations','guardian_invitations','player_account_invitations',
      'site_admin_invitations','club_safeguarding_officer_invitations','club_ovalball_invitations']) as t
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.t and c.column_name <> 'token';
    execute format('revoke select on public.%I from authenticated, anon', r.t);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, r.t);
  end loop;
  raise notice 'Slice 5: the legacy token columns are no longer selectable by any browser role';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Assertions.
-- ---------------------------------------------------------------------------------------------------
do $$
declare r record; v_n integer;
begin
  for r in select unnest(array[
      'invitations','guardian_invitations','player_account_invitations',
      'site_admin_invitations','club_safeguarding_officer_invitations','club_ovalball_invitations']) as t
  loop
    execute format(
      'select count(*) from public.%I where token is not null and (status in (''accepted'',''revoked'',''expired'') or expires_at <= now())',
      r.t) into v_n;
    if v_n > 0 then
      raise exception 'Slice 5: public.% still holds % plaintext token(s) on terminal or expired rows.', r.t, v_n;
    end if;
    if has_column_privilege('authenticated', format('public.%I', r.t)::regclass, 'token', 'SELECT')
       or has_column_privilege('anon', format('public.%I', r.t)::regclass, 'token', 'SELECT') then
      raise exception 'Slice 5: a browser role can still select public.%.token', r.t;
    end if;
  end loop;
  raise notice 'Slice 5: legacy plaintext token retirement verified';
end $$;
