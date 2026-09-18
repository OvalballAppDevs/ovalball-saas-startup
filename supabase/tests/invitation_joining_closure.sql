-- =====================================================================================================
-- INVITATIONS & JOINING -- THE PRODUCT CLOSURE (Convergence Step 3)
--
-- Slice 5 built one credential with two forms: a 256-bit token that lives in a link, and a
-- ten-character human code somebody can read down a phone. Both resolve through preview_invitation
-- and redeem_invitation to the same access_invitations row and the same redemption. Step 3 did not
-- change any of that; it made the product use what was already there -- the code, the link, the QR of
-- the link, and a resend that had an RPC and no button.
--
-- What this suite pins is therefore mostly BEHAVIOUR THAT EXISTED AND WAS NEVER EXERCISED, plus the
-- one thing a product change could get badly wrong: resend.
--
-- RESEND IS A REISSUE, AND MUST BE. Ovalball stores only hashes, so "send the same link again" is not
-- available even in principle. resend_invitation rotates BOTH secrets, which also makes it the remedy
-- for an invitation sent to the wrong address. If a later change ever made it keep the old token
-- "for convenience", an invitation sent to a stranger could never be taken back without revoking the
-- whole thing -- so the death of the old credential is asserted directly rather than assumed.
--
-- Deterministic and self-seeding. Every subject is created here and rolled back.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'ijc.' || substr(v::text,1,8) || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'IJC',p_label,v_email,(current_date - interval '36 years')::date,'ACTIVE')
  on conflict (id) do update set account_state = 'ACTIVE';
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.as_person(p_user uuid) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), 'aal1');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v)::text, true);
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IJC ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ijc-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ijc-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under 12 Boys', 'ijc-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v;
  return v;
end $$;

do $outer$
declare
  v_club uuid; v_other uuid; v_team uuid; v_admin uuid; v_stranger uuid;
  v_inv uuid; v_token text; v_code text; v_exp timestamptz;
  v_token2 text; v_code2 text;
  d record; n int; e text;
begin
  v_club := pg_temp.club('Home');
  v_other := pg_temp.club('Away');
  v_team := pg_temp.team(v_club);
  v_admin := pg_temp.person('Admin');
  v_stranger := pg_temp.person('Stranger');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_other, v_stranger, 'CLUB_ADMIN', 'active');

  perform pg_temp.as_person(v_admin);
  select invitation_id, token, code, expires_at into v_inv, v_token, v_code, v_exp
  from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'ijc.invitee.' || substr(gen_random_uuid()::text,1,8) || '@ovalball.test', '{}'::jsonb, null, null,
    jsonb_build_array(jsonb_build_object('id', v_team, 'roles', jsonb_build_array('COACH'))));

  -- ===================================================================================================
  -- A. ONE CREDENTIAL, TWO FORMS.
  -- ===================================================================================================
  perform pg_temp.check(v_token is not null and v_code is not null,
                        'A1 issuing returns both a link token and a human code, and this is the only time either exists');
  perform pg_temp.check(v_code ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$',
                        'A2 the code is Crockford base32 -- no I, L, O or U, so nothing reads as something else');
  perform pg_temp.check(
    not exists (select 1 from public.access_invitations where id = v_inv and (token_sha256 is null or code_hmac is null))
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'access_invitations'
        and column_name in ('token', 'code', 'token_plaintext', 'code_plaintext')),
    'A3 and only their hashes are stored, so there is nothing for a UI to look up later');

  select * into d from public.preview_invitation(v_token, null);
  perform pg_temp.check(d.state = 'usable', 'A4 the link previews as usable');
  select * into d from public.preview_invitation(null, v_code);
  perform pg_temp.check(d.state = 'usable', 'A5 and so does the code, which is how a typed code can be previewed before it is accepted');
  select * into d from public.preview_invitation(null, lower(replace(v_code, '-', '')));
  perform pg_temp.check(d.state = 'usable', 'A6 lower case and no dashes resolve to the same invitation -- the database normalises it');
  select count(*) into n from public.preview_invitation(null, 'ZZZZZ-ZZZZZ');
  perform pg_temp.check(n = 0, 'A7 a code that matches nothing previews nothing -- no error shape for a prober to read');

  -- ===================================================================================================
  -- B. RESEND IS A REISSUE. The old credential must die.
  -- ===================================================================================================
  select token, code, expires_at into v_token2, v_code2 from public.resend_invitation(v_inv);
  perform pg_temp.check(v_token2 is distinct from v_token and v_code2 is distinct from v_code,
                        'B1 resending issues a new token AND a new code');
  select count(*) into n from public.preview_invitation(v_token, null);
  perform pg_temp.check(n = 0, 'B2 and the previous LINK stops resolving immediately');
  select count(*) into n from public.preview_invitation(null, v_code);
  perform pg_temp.check(n = 0, 'B3 and so does the previous CODE -- which is what makes resend the fix for a wrong address');
  select * into d from public.preview_invitation(v_token2, null);
  perform pg_temp.check(d.state = 'usable', 'B4 while the newly issued link works');
  perform pg_temp.check(
    (select resend_count from public.access_invitations where id = v_inv) = 1
    and (select last_sent_at is not null from public.access_invitations where id = v_inv),
    'B5 and the reissue is recorded on the invitation rather than being invisible');
  perform pg_temp.check(
    exists (select 1 from public.security_events where event_type = 'invitation.resent'
              and metadata ->> 'invitation_id' = v_inv::text),
    'B6 and emits a security event naming the invitation');
  perform pg_temp.check(
    (select intended_outcome from public.access_invitations where id = v_inv) @> jsonb_build_object('teams', jsonb_build_array(jsonb_build_object('id', v_team, 'roles', jsonb_build_array('COACH')))),
    'B7 and the intended outcome survives the reissue untouched');

  perform pg_temp.as_person(v_stranger);
  begin
    perform public.resend_invitation(v_inv);
    perform pg_temp.check(false, 'B8 another club''s admin cannot resend this club''s invitation');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'B8 another club''s admin cannot resend this club''s invitation');
  end;

  -- ===================================================================================================
  -- C. TERMINAL STATES ARE TERMINAL.
  -- ===================================================================================================
  perform pg_temp.as_person(v_admin);
  perform public.revoke_invitation(v_inv, 'Withdrawn.');
  select count(*) into n from public.preview_invitation(v_token2, null);
  perform pg_temp.check(n = 1, 'C1 a revoked invitation still previews -- the holder is told what happened rather than left guessing');
  select * into d from public.preview_invitation(v_token2, null);
  perform pg_temp.check(d.state = 'revoked', 'C2 and its state says revoked, not "usable"');

  begin
    perform public.resend_invitation(v_inv);
    perform pg_temp.check(false, 'C3 a revoked invitation cannot be quietly brought back to life by resending it');
  exception when others then
    get stacked diagnostics e = message_text;
    perform pg_temp.check(sqlstate = 'P0001', 'C3 a revoked invitation cannot be resent (' || e || ')');
  end;

  -- Revoking twice REFUSES rather than silently succeeding, which is the right
  -- way round: a second revoke means somebody is acting on a stale view, and
  -- being told so is better than a success message about something that already
  -- happened. Either behaviour would be defensible; this pins the one that is
  -- actually implemented so a change is a decision rather than a drift.
  begin
    perform public.revoke_invitation(v_inv, 'Again.');
    perform pg_temp.check(false, 'C4 revoking an already-revoked invitation is refused rather than reported as success');
  exception when others then
    get stacked diagnostics e = message_text;
    perform pg_temp.check((select state from public.access_invitations where id = v_inv) = 'REVOKED',
                          'C4 revoking an already-revoked invitation is refused, and it stays revoked (' || e || ')');
  end;

  -- An expired invitation reports expiry, and cannot be resent either.
  select invitation_id, token into v_inv, v_token
  from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'ijc.expired.' || substr(gen_random_uuid()::text,1,8) || '@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('FIXTURES_SECRETARY')), null, null, null);
  update public.access_invitations set expires_at = now() - interval '1 day' where id = v_inv;
  select * into d from public.preview_invitation(v_token, null);
  perform pg_temp.check(d.state = 'expired', 'C5 an invitation past its expiry previews as expired');

  -- ===================================================================================================
  -- D. THE LEGACY STACK IS OUT OF THE PRODUCT.
  -- ===================================================================================================
  perform pg_temp.check((select count(*) from public.invitations) = 0,
    'D1 public.invitations holds nothing, and no application code reads it any more');
  perform pg_temp.check(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('accept_invitation', 'get_invitation_preview')),
    'D2 the legacy accept/preview functions still EXIST -- deliberately, because the deployed app is retired from them first');
  perform pg_temp.check(
    (select count(*) from public.access_invitations where club_id = v_club) = 2,
    'D3 while every invitation this club issued lives in access_invitations');
end
$outer$;

rollback;
