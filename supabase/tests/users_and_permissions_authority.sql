-- =====================================================================================================
-- USERS & PERMISSIONS -- THE AUTHORITIES THE CENTRE CONSUMES (Convergence Step 2)
--
-- Step 2 built one Club-scoped Users & Permissions centre out of authorities that already existed. It
-- deliberately added no new rule, no new table and no new predicate: every control on it calls a
-- function the database already owned. That makes this suite's job precise -- pin the authorities the
-- centre now leans on, so that a later change to them is caught HERE rather than by a screen quietly
-- showing the wrong answer.
--
-- Three of them had never been exercised from a product surface before, and each is a different kind
-- of hazard:
--
--   public.explain_access     Reads a decision ABOUT SOMEBODY ELSE and returns the rule and the trail
--                             that produced it. That is a disclosure surface: it must refuse a caller
--                             who is not entitled to look, and what it tells a person about their own
--                             access must be redacted of who granted it and why. Above all it must
--                             AGREE with enforcement -- a screen that says "allowed" where internal.can
--                             says no is worse than no screen, because it is believed.
--
--   public.set_team_access    Hands out a role at a team. Previously reachable only from one team's own
--                             page; now also from the page about a person. Same function, wider reach,
--                             so its refusals are worth pinning: no giving yourself a role, no authority
--                             at a club you do not administer.
--
--   public.revoke_invitation  The real revocation. The /people page used to write status='revoked' into
--                             public.invitations, which has held zero rows since issue_invitation began
--                             writing public.access_invitations -- the update matched nothing and
--                             reported success, and no row was ever drawn to press it on anyway.
--
-- The last two checks pin the shape that defect grew in: the admin view must never expose a secret, and
-- the legacy table must not quietly become a second answer again.
--
-- Deterministic and self-seeding. Everything is created inside the transaction and rolled back.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_adult boolean default true) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'uap.' || substr(v::text,1,8) || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'UAP',p_label,v_email,(current_date - (case when p_adult then interval '34 years' else interval '11 years' end))::date,'ACTIVE')
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
  values ('UAP ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uap-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'uap-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'uap-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

do $outer$
declare
  v_club uuid; v_other_club uuid; v_team uuid;
  v_admin uuid; v_member uuid; v_stranger uuid; v_outsider uuid;
  v_m_admin uuid; v_m_member uuid;
  v_key text := 'fixture.fixture.create';
  v_view_key text := 'fixture.fixture.view';
  d record; e text; v_inv uuid; v_tp uuid; v_n int;
  v_explained_create boolean; v_explained_view boolean;
begin
  v_club := pg_temp.club('Home');
  v_other_club := pg_temp.club('Away');
  v_team := pg_temp.team(v_club, 'U14');
  v_admin := pg_temp.person('Admin');
  v_member := pg_temp.person('Member');
  v_stranger := pg_temp.person('Stranger');
  v_outsider := pg_temp.person('Outsider');
  v_m_admin := pg_temp.member(v_club, v_admin, 'CLUB_ADMIN');
  v_m_member := pg_temp.member(v_club, v_member, 'BASIC_USER');
  perform pg_temp.member(v_other_club, v_outsider, 'CLUB_ADMIN');

  -- ===================================================================================================
  -- A. explain_access -- who may ask, and about whom.
  -- ===================================================================================================
  perform pg_temp.as_person(v_admin);

  select * into d from public.explain_access(v_member, v_key, 'club', v_club, null, null);
  perform pg_temp.check(d.reason_code is not null, 'A1 a club admin may ask why a member of their club can or cannot do something');
  perform pg_temp.check(d.decisive_rule is not null, 'A2 and is told which rule decided it, not just the answer');

  -- THE CHECK THAT MATTERS MOST: what the administrator is SHOWN must be what the member actually
  -- meets. A screen that disagrees with the gate is a screen that lies with authority, so the two
  -- answers are taken from opposite ends -- explain_access as the admin, and internal.can inside the
  -- member's own session, which is the very call the enforcement path makes.
  v_explained_create := d.allowed;
  select * into d from public.explain_access(v_member, v_view_key, 'club', v_club, null, null);
  v_explained_view := d.allowed;

  perform pg_temp.as_person(v_member);
  perform pg_temp.check(v_explained_create = internal.can(v_key, 'club', v_club, null, null),
                        'A3 what the admin is shown matches what the member actually meets, for a capability they lack');
  perform pg_temp.check(v_explained_view = internal.can(v_view_key, 'club', v_club, null, null),
                        'A4 and for one they hold, so the agreement is not two falses agreeing');
  perform pg_temp.check(v_explained_view, 'A5 an ordinary member really can view fixtures');
  perform pg_temp.check(not v_explained_create, 'A6 and really cannot create them');
  perform pg_temp.as_person(v_admin);

  -- A person who is nothing to do with this club is not a subject this club may ask about, even though
  -- the caller is a genuine Club Admin. Scope is about the pair, not about the asker alone.
  begin
    select * into d from public.explain_access(v_stranger, v_key, 'club', v_club, null, null);
    perform pg_temp.check(false, 'A7 a club admin cannot ask about somebody who is not a member of their club');
  exception when others then
    get stacked diagnostics e = message_text;
    perform pg_temp.check(sqlstate = '42501', 'A7 a club admin cannot ask about somebody who is not a member of their club (' || e || ')');
  end;

  -- Another club's Club Admin has the same role and none of the reach.
  perform pg_temp.as_person(v_outsider);
  begin
    select * into d from public.explain_access(v_member, v_key, 'club', v_club, null, null);
    perform pg_temp.check(false, 'A8 another club''s admin cannot ask about this club''s members');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'A8 another club''s admin cannot ask about this club''s members');
  end;

  -- An ordinary member may always ask about themselves, and gets the decision without the paperwork.
  perform pg_temp.as_person(v_member);
  select * into d from public.explain_access(v_member, v_key, 'club', v_club, null, null);
  perform pg_temp.check(d.reason_code is not null, 'A9 anybody may ask why THEY can or cannot do something');
  perform pg_temp.check(not (coalesce(d.decisive_source, '{}'::jsonb) ? 'granted_by')
                    and not (coalesce(d.decisive_source, '{}'::jsonb) ? 'reason'),
                        'A10 and is not told who granted it or what reason they gave');

  begin
    select * into d from public.explain_access(v_admin, v_key, 'club', v_club, null, null);
    perform pg_temp.check(false, 'A11 an ordinary member cannot ask about anybody else');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'A11 an ordinary member cannot ask about anybody else');
  end;

  -- ===================================================================================================
  -- B. set_team_access -- the refusals the person page now depends on.
  -- ===================================================================================================
  perform pg_temp.as_person(v_admin);
  v_tp := public.set_team_access(v_m_member, v_team, 'coach', 'Stepping up to help.');
  perform pg_temp.check(v_tp is not null, 'B1 a club admin can give an existing member a team role without re-inviting them');
  perform pg_temp.check(exists (select 1 from public.team_permissions where id = v_tp and permission = 'coach' and team_id = v_team),
                        'B2 and the role lands on that team, with that permission');

  -- SELF-ASSIGNMENT IS ALLOWED AT CLUB LEVEL, AND THAT IS THE RULE, NOT AN OVERSIGHT.
  -- set_team_access refuses it only from SITE and TEAM_ADMIN callers. A Club Admin already holds
  -- club-wide authority over every team, so putting their own name against the U14s grants them
  -- nothing they did not have -- it records who is actually doing the job. A Team Admin doing it
  -- WOULD widen their reach inside a team, and a Site Admin doing it would be a platform actor
  -- quietly acquiring a club's operational roles; both are refused. This is pinned because the
  -- person page offers the control on your own record, and a later "tidy-up" that blanket-refuses
  -- self-assignment would silently take a club's own ability to staff its teams away.
  perform pg_temp.check(public.set_team_access(v_m_admin, v_team, 'coach', 'Taking the U14s myself.') is not null,
                        'B3 a club admin MAY put themselves against a team, because club authority already covers it');

  perform pg_temp.as_person(v_outsider);
  begin
    perform public.set_team_access(v_m_member, v_team, 'manager', 'Not my club.');
    perform pg_temp.check(false, 'B4 another club''s admin cannot assign roles at this club''s teams');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'B4 another club''s admin cannot assign roles at this club''s teams');
  end;

  perform pg_temp.as_person(v_member);
  begin
    perform public.set_team_access(v_m_member, v_team, 'team_admin', 'Promoting myself.');
    perform pg_temp.check(false, 'B5 an ordinary member cannot assign themselves Team Admin');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'B5 an ordinary member cannot assign themselves Team Admin');
  end;

  -- ===================================================================================================
  -- C. revoke_invitation -- the real revocation, on the table invitations are really in.
  -- ===================================================================================================
  perform pg_temp.as_person(v_admin);
  select invitation_id into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'uap.invitee.' || substr(gen_random_uuid()::text,1,8) || '@ovalball.test', '{}'::jsonb, null, null,
    jsonb_build_array(jsonb_build_object('id', v_team, 'roles', jsonb_build_array('COACH'))));
  perform pg_temp.check(v_inv is not null, 'C1 issuing a club staff invitation returns its id');
  perform pg_temp.check(exists (select 1 from public.access_invitations where id = v_inv and state = 'ISSUED'),
                        'C2 and the invitation is in access_invitations, which is where invitations live');
  select count(*) into v_n from public.invitations where club_id = v_club;
  perform pg_temp.check(v_n = 0, 'C3 and NOT in public.invitations, the table the people page used to read');

  perform pg_temp.as_person(v_outsider);
  begin
    perform public.revoke_invitation(v_inv, 'Not mine to revoke.');
    perform pg_temp.check(false, 'C4 another club''s admin cannot revoke this club''s invitation');
  exception when others then
    perform pg_temp.check(sqlstate = '42501', 'C4 another club''s admin cannot revoke this club''s invitation');
  end;

  perform pg_temp.as_person(v_admin);
  perform public.revoke_invitation(v_inv, 'Withdrawn by the club.');
  perform pg_temp.check(exists (select 1 from public.access_invitations
                                where id = v_inv and state = 'REVOKED' and revoked_by = v_admin
                                  and revocation_reason = 'Withdrawn by the club.'),
                        'C5 a club admin revokes it, and who revoked it and why are both recorded');

  -- ===================================================================================================
  -- D. The shape the defect grew in.
  -- ===================================================================================================
  perform pg_temp.check(not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invitations_admin_view'
      and column_name in ('token_sha256', 'code_hmac')),
    'D1 the admin view a club reads invitations through exposes no token hash and no code HMAC');

  perform pg_temp.check(exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'invitations_admin_view' and grantee = 'authenticated' and privilege_type = 'SELECT'),
    'D2 and is the projection authenticated callers are actually granted');

  perform pg_temp.check((select count(*) from public.invitations) = 0,
    'D3 the legacy public.invitations table is empty, so nothing may treat it as a second answer');
end
$outer$;

rollback;
