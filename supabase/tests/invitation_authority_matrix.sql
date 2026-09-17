-- =====================================================================================================
-- CANONICAL INVITATION AUTHORITY (Identity/Auth Slice 5, Phase 2 O.1, O.2, Y.12) + D-S5-1
--
-- Deterministic and self-seeding. Every club, team, identity and invitation it needs, it creates.
--
-- Ovalball had six invitation tables, each storing its token in PLAINTEXT. This suite is about the
-- one canonical replacement: that the secret is never stored, that a modified payload cannot widen
-- what the issuer authorised, and that a one-time invitation is not burnt by a refusal the invitee
-- can fix.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text, p_dob date default (current_date - interval '35 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v,'Inv',p_label,p_email,p_dob);
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  execute p_sql into v;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

-- =====================================================================================================
-- IN-A. Secrecy, structurally. This is the PG-10 obligation.
-- =====================================================================================================
do $$
begin
  perform pg_temp.check(
    not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='access_invitations'
                   and column_name in ('token','code','secret','plaintext')),
    'IN-A1 access_invitations has no plaintext token or code column at all');
  perform pg_temp.check(
    (select count(*) from information_schema.columns where table_schema='public'
      and table_name='access_invitations' and column_name in ('token_sha256','code_hmac')) = 2,
    'IN-A2 it stores a hash of the link token and an HMAC of the human code');
  perform pg_temp.check(
    not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='invitations_admin_view'
                   and column_name in ('token_sha256','code_hmac')),
    'IN-A3 and the administrator''s view cannot select either, by construction');
  perform pg_temp.check(
    not has_function_privilege('authenticated','internal.invitation_code_pepper()','EXECUTE')
    and not has_function_privilege('anon','internal.invitation_code_pepper()','EXECUTE'),
    'IN-A4 no browser role can reach the code pepper -- without it a stolen database is brute-forceable');
  perform pg_temp.check(
    not has_table_privilege('anon','public.access_invitations','SELECT')
    and not has_table_privilege('authenticated','public.access_invitations','INSERT')
    and not has_table_privilege('authenticated','public.access_invitations','UPDATE')
    and not has_table_privilege('authenticated','public.access_invitations','DELETE'),
    'IN-A5 anon reads no invitation and a signed-in browser writes none -- every mutation is a definer RPC');
  perform pg_temp.check(
    has_function_privilege('anon','public.preview_invitation(text,text)','EXECUTE'),
    'IN-A6 while preview IS anon-executable, because somebody holding a link has no account yet');
end $$;

-- =====================================================================================================
-- IN-B .. IN-L. Behaviour.
-- =====================================================================================================
do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir uuid; v_club uuid; v_fdir uuid; v_far uuid; v_team uuid;
  v_ca uuid; v_fs uuid; v_mb uuid; v_farca uuid; v_sa uuid;
  v_invitee uuid; v_other uuid; v_unknown uuid; v_minorless uuid;
  v_inv record; v_inv2 record; v_res jsonb; v_state text; v_id uuid;
  v_email text; v_email2 text; v_emailu text; v_n int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Inv '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','inv-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'inv-'||v_tag,'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Inv Far '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','inv-far-'||v_tag) returning id into v_fdir;
  insert into public.clubs (directory_id, slug, status) values (v_fdir,'inv-far-'||v_tag,'active') returning id into v_far;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','inv-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team;

  v_email  := 'invitee-'||v_tag||'@ovalball.test';
  v_email2 := 'other-'||v_tag||'@ovalball.test';
  v_emailu := 'unknownage-'||v_tag||'@ovalball.test';

  v_ca      := pg_temp.person('CA','ca-'||v_tag||'@ovalball.test');
  v_fs      := pg_temp.person('FS','fs-'||v_tag||'@ovalball.test');
  v_mb      := pg_temp.person('MB','mb-'||v_tag||'@ovalball.test');
  v_farca   := pg_temp.person('FARCA','farca-'||v_tag||'@ovalball.test');
  v_sa      := pg_temp.person('SA','sa-'||v_tag||'@ovalball.test');
  v_invitee := pg_temp.person('INVITEE', v_email);
  v_other   := pg_temp.person('OTHER', v_email2);
  v_unknown := pg_temp.person('UNKNOWN', v_emailu, null);

  insert into public.club_memberships (club_id,user_id,role,status) values
    (v_club,v_ca,'CLUB_ADMIN','active'), (v_club,v_fs,'FIXTURE_SECRETARY','active'),
    (v_club,v_mb,'BASIC_USER','active'), (v_far,v_farca,'CLUB_ADMIN','active');
  insert into public.site_admins (user_id,status,admin_role) values (v_sa,'active','full');

  -- ---------------------------------------------------------------------------------------------
  -- IN-B  issuing: authority, and the ceiling
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, v_team, null, null, null, v_email,
    jsonb_build_object('roles', jsonb_build_array('COACH')));
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(v_inv.invitation_id is not null and v_inv.token is not null and v_inv.code is not null,
    'IN-B1 a Club Admin issues a staff invitation and receives the link token and the code, once');
  perform pg_temp.check(v_inv.code ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$',
    'IN-B2 the code is ten Crockford base32 characters as XXXXX-XXXXX');
  perform pg_temp.check(
    (select count(*) from public.access_invitations a where a.id = v_inv.invitation_id
      and a.token_sha256 = internal.invitation_token_hash(v_inv.token)) = 1,
    'IN-B3 and what is stored is the hash of that token, not the token');

  perform pg_temp.check(
    pg_temp.try_as(v_mb, format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      v_club, 'x-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}')) = '42501',
    'IN-B4 an ordinary member cannot issue one');
  perform pg_temp.check(
    pg_temp.try_as(v_farca, format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      v_club, 'y-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}')) = '42501',
    'IN-B5 nor another club''s Club Admin, naming this club''s id');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      v_club, 'z-'||v_tag||'@ovalball.test', '{"roles":["TEAM_ADMINISTRATION"]}')) = '42501',
    'IN-B6 CEILING: an invitation cannot carry a role outside what O.1 allows the kind to produce');

  -- O.2 uniqueness: a duplicate returns the existing invitation rather than a second live secret.
  perform pg_temp.as_(v_ca);
  select * into v_inv2 from public.issue_invitation('CLUB_STAFF', v_club, v_team, null, null, null, v_email,
    jsonb_build_object('roles', jsonb_build_array('COACH')));
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(v_inv2.already_existed and v_inv2.invitation_id = v_inv.invitation_id and v_inv2.token is null,
    'IN-B7 issuing the same personal invitation twice returns the first and no second secret');

  -- ---------------------------------------------------------------------------------------------
  -- IN-C  preview: enough to decide, never enough to identify
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select count(*) from public.preview_invitation(v_inv.token, null)) = 1,
    'IN-C1 a link previews without an account');
  perform pg_temp.check(
    (select state from public.preview_invitation(v_inv.token, null)) = 'usable',
    'IN-C2 and says it is usable');
  perform pg_temp.check(
    not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'preview_invitation'),
    'IN-C3 preview returns a record, not a table anyone can select from');
  perform pg_temp.check(
    (select count(*) from public.preview_invitation('not-a-real-token', null)) = 0,
    'IN-C4 and a wrong token previews nothing, without saying why');

  -- ---------------------------------------------------------------------------------------------
  -- IN-D  redemption, and the identity binding
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (pg_temp.json_as(v_other, format('select public.redeem_invitation(%L, null)', v_inv.token)))->>'outcome' = 'REFUSED',
    'IN-D1 WRONG IDENTITY: a different signed-in person cannot redeem an email-bound invitation');
  perform pg_temp.check(
    (select state from public.access_invitations where id = v_inv.invitation_id) = 'ISSUED',
    'IN-D2 and the invitation is untouched by that attempt');
  perform pg_temp.check(
    (select count(*) from public.security_events where event_type = 'invitation.identity_mismatch'
      and club_id = v_club) >= 1,
    'IN-D3 which is recorded as an identity mismatch');

  v_res := pg_temp.json_as(v_invitee, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE',
    'IN-D4 the invited person redeems it and becomes an active member');
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = v_invitee and m.club_id = v_club and ra.role_key = 'COACH' and ra.state = 'ACTIVE'
        and ra.source = 'INVITATION') = 1,
    'IN-D5 with the Coach role the invitation carried, recorded as coming from an invitation');
  perform pg_temp.check(
    (select state from public.access_invitations where id = v_inv.invitation_id) = 'REDEEMED',
    'IN-D6 and the invitation is now spent');
  perform pg_temp.check(
    (pg_temp.json_as(v_invitee, format('select public.redeem_invitation(%L, null)', v_inv.token)))->>'outcome' = 'ALREADY_REDEEMED'
    and (select count(*) from public.invitation_redemptions where invitation_id = v_inv.invitation_id) = 1,
    'IN-D7 REPLAY: redeeming again is idempotent -- the same answer, not a second membership');

  -- ---------------------------------------------------------------------------------------------
  -- IN-E  D-S5-1: unknown age, and the invitation that survives the refusal
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, v_team, null, null, null, v_emailu,
    jsonb_build_object('roles', jsonb_build_array('TEAM_MANAGER')));
  perform set_config('request.jwt.claims','',true);
  v_res := pg_temp.json_as(v_unknown, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(v_res->>'outcome' = 'REFUSED' and v_res->>'reason' = 'AGE_ELIGIBILITY_REQUIRED',
    'IN-E1 an identity with no recorded date of birth is refused a minor-prohibited staff role (D-S5-1)');
  perform pg_temp.check(
    (select state from public.access_invitations where id = v_inv.invitation_id) = 'ISSUED'
    and (select use_count from public.access_invitations where id = v_inv.invitation_id) = 0,
    'IN-E2 and the ONE-TIME invitation is not consumed -- a refusal they can fix must not burn it');
  perform pg_temp.check(
    not exists (select 1 from public.club_memberships m where m.user_id = v_unknown and m.club_id = v_club),
    'IN-E3 and no membership was created on the way to the refusal');
  update public.profiles set date_of_birth = (current_date - interval '28 years')::date where id = v_unknown;
  v_res := pg_temp.json_as(v_unknown, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE',
    'IN-E4 once a date of birth establishing adulthood is on file, the SAME invitation still works');

  -- ---------------------------------------------------------------------------------------------
  -- IN-F  expiry, revocation and the generic refusal
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'exp-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('VOLUNTEER')));
  perform set_config('request.jwt.claims','',true);
  update public.access_invitations set expires_at = now() - interval '1 minute' where id = v_inv.invitation_id;
  perform pg_temp.check(
    (pg_temp.json_as(v_invitee, format('select public.redeem_invitation(%L, null)', v_inv.token)))->>'outcome' = 'REFUSED',
    'IN-F1 EXPIRED: an expired invitation is refused');
  perform pg_temp.check(
    (select state from public.access_invitations where id = v_inv.invitation_id) = 'EXPIRED',
    'IN-F2 and the expiry is PERSISTED before the refusal, so a raise does not roll it back (M-5)');

  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'rev-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('VOLUNTEER')));
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.revoke_invitation(%L, ''matrix: revoked'')', v_inv.invitation_id)) = 'OK',
    'IN-F3 the issuing club can revoke an invitation');
  perform pg_temp.check(
    (pg_temp.json_as(v_invitee, format('select public.redeem_invitation(%L, null)', v_inv.token)))->>'outcome' = 'REFUSED',
    'IN-F4 REVOKED: and it stops working immediately');
  perform pg_temp.check(pg_temp.try_as(v_mb, format('select public.revoke_invitation(%L, ''nope'')', v_inv.invitation_id)) <> 'OK',
    'IN-F5 while an ordinary member cannot revoke one');

  -- Resend rotates both secrets, so the old link dies.
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'res-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('VOLUNTEER')));
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.as_(v_ca);
  select * into v_inv2 from public.resend_invitation(v_inv.invitation_id);
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(v_inv2.token is not null and v_inv2.token <> v_inv.token,
    'IN-F6 RESEND rotates the token');
  perform pg_temp.check(
    (select count(*) from public.access_invitations a where a.id = v_inv.invitation_id
      and a.token_sha256 = internal.invitation_token_hash(v_inv.token)) = 0,
    'IN-F7 and the OLD link no longer matches -- which is what makes resend the remedy for a misdirected invitation');

  -- ---------------------------------------------------------------------------------------------
  -- IN-G  the team join code: a request, never access (L14)
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('TEAM_JOIN_CODE', null, v_team, null, null, null, null, '{}'::jsonb, 25);
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(v_inv.invitation_id is not null,
    'IN-G1 a team join code is issued for a team');
  v_res := pg_temp.json_as(v_other, format('select public.redeem_invitation(null, %L)', v_inv.code));
  perform pg_temp.check(v_res->>'outcome' = 'JOIN_REQUEST_PENDING',
    'IN-G2 redeeming it produces a join REQUEST, not access (L14)');
  perform pg_temp.check(
    not exists (select 1 from public.club_memberships m where m.user_id = v_other and m.club_id = v_club and m.state = 'ACTIVE'),
    'IN-G3 and no active membership exists from the code alone');
  perform pg_temp.check(
    (select source_invitation_id from public.club_join_requests where requesting_user_id = v_other and club_id = v_club) = v_inv.invitation_id,
    'IN-G4 the request records which code produced it, so whoever decides it can see that');
  perform pg_temp.check(
    (select state from public.access_invitations where id = v_inv.invitation_id) = 'ISSUED'
    and (select use_count from public.access_invitations where id = v_inv.invitation_id) = 1,
    'IN-G5 and a multi-use code stays usable, with the use counted');

  -- ---------------------------------------------------------------------------------------------
  -- IN-H  the safeguarding path reuses 4G (D-S4-2), and D-S5-1 sits in front of it
  -- ---------------------------------------------------------------------------------------------
  v_unknown := pg_temp.person('SOUNKNOWN','sounknown-'||v_tag||'@ovalball.test', null);
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_unknown,'BASIC_USER','active');
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('SAFEGUARDING_OFFICER', v_club, null, null, null, null,
    'sounknown-'||v_tag||'@ovalball.test', jsonb_build_object('officer_type','primary'));
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(
    (pg_temp.json_as(v_unknown, format('select public.redeem_invitation(%L, null)', v_inv.token)))->>'reason' = 'AGE_ELIGIBILITY_REQUIRED',
    'IN-H1 D-S5-1 refuses an unknown-age identity BEFORE the safeguarding nomination path');
  update public.profiles set date_of_birth = (current_date - interval '33 years')::date where id = v_unknown;
  v_res := pg_temp.json_as(v_unknown, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(v_res->>'outcome' = 'PENDING_CONFIRMATION',
    'IN-H2 with adulthood established it enters 4G''s existing seam and lands in PENDING_CONFIRMATION');
  perform pg_temp.check(
    not (internal.capability_decision(v_unknown, 'safeguarding.welfare.view', 'club', v_club, null, null)).allowed,
    'IN-H3 holding ZERO Safeguarding Officer authority -- the nomination confers nothing');
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = v_unknown and ra.role_key = 'SAFEGUARDING_OFFICER'
        and ra.confirmation_state = 'PENDING_CONFIRMATION') = 1,
    'IN-H4 and AN-6 is still ahead of them: Ovalball has not confirmed anything');

  -- ---------------------------------------------------------------------------------------------
  -- IN-I  no resurrection of terminal authority through an invitation
  -- ---------------------------------------------------------------------------------------------
  v_id := (select m.id from public.club_memberships m where m.user_id = v_other and m.club_id = v_far limit 1);
  insert into public.club_memberships (club_id,user_id,role,status,state) values (v_far,v_mb,'BASIC_USER','revoked','REVOKED');
  perform pg_temp.as_(v_farca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_far, null, null, null, null, 'mb-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('VOLUNTEER')));
  perform set_config('request.jwt.claims','',true);
  v_res := pg_temp.json_as(v_mb, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(
    (select count(*) from public.club_memberships m where m.user_id = v_mb and m.club_id = v_far and m.state = 'REVOKED') = 1,
    'IN-I1 a REVOKED membership is not resurrected by an invitation -- the terminal row stays terminal');
  perform pg_temp.check(
    (select count(*) from public.club_memberships m where m.user_id = v_mb and m.club_id = v_far and m.state = 'ACTIVE') = 1,
    'IN-I2 readmission creates a NEW row through the canonical path, which is what the state machine requires');

  -- ---------------------------------------------------------------------------------------------
  -- IN-J  the audit trail, and what must never be in it
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select count(*) from public.security_events where event_type = 'invitation.issued' and club_id = v_club) >= 1
    and (select count(*) from public.security_events where event_type = 'invitation.redeemed' and club_id = v_club) >= 1,
    'IN-J1 issuing and redeeming are both recorded');
  select count(*) into v_n from public.security_events e
   where e.event_type like 'invitation%'
     and (e.metadata::text ~ '[A-Za-z0-9_-]{43}' or e.metadata::text ~ '[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}');
  perform pg_temp.check(v_n = 0,
    'IN-J2 and no invitation event carries anything shaped like a token or a code');
  perform pg_temp.check(
    (select count(*) from public.invitation_redemption_attempts) >= 1,
    'IN-J3 every attempt is logged, which is what makes the rate limits possible');
end $$;

rollback;
