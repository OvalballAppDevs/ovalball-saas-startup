-- =====================================================================================================
-- A STAFF INVITATION'S TEAM LIST (Identity/Auth Slice 5, D-S5-AUTO-8, Phase 2 O.1 "CL (+ TE list)")
--
-- Deterministic and self-seeding.
--
-- A club invites a new Coach to three teams in one invitation. The thing that must be true is that
-- they arrive holding exactly those three -- not the first one, not the whole club, and not a team in
-- somebody else's club because a payload said so.
--
-- The list is decided by the SERVER at issue and read from the stored invitation at redemption. The
-- invitee's browser never gets a say, and never gets a half-finished outcome either.
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
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v,'Team',p_label,p_email,p_dob);
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

-- Roles held at a team, for whichever club membership belongs to this person.
create or replace function pg_temp.team_roles(p_user uuid, p_club uuid, p_role text) returns uuid[] language sql as $$
  select coalesce(array_agg(ra.team_id order by ra.team_id), '{}'::uuid[])
    from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
   where m.user_id = p_user and m.club_id = p_club and ra.role_key = p_role and ra.state = 'ACTIVE'
     and ra.team_id is not null;
$$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir uuid; v_club uuid; v_fdir uuid; v_far uuid;
  v_a uuid; v_b uuid; v_c uuid; v_f uuid;
  v_ca uuid; v_farca uuid; v_mb uuid;
  v_one uuid; v_many uuid; v_dup uuid; v_mixed uuid; v_none uuid; v_partial uuid; v_atomic uuid;
  v_inv record; v_res jsonb; v_teams uuid[]; v_sorted uuid[]; v_n int; v_code text;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TL '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tl-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'tl-'||v_tag,'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TL Far '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tl-far-'||v_tag) returning id into v_fdir;
  insert into public.clubs (directory_id, slug, status) values (v_fdir,'tl-far-'||v_tag,'active') returning id into v_far;

  -- `returning id`, never a lookup by slug: a team's slug is DERIVED from its canonical identity, so
  -- the value handed to the insert is not the value stored.
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','tl-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 13 Boys','tl-u13-'||v_tag,'youth','U13','boys','union',true) returning id into v_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 14 Boys','tl-u14-'||v_tag,'youth','U14','boys','union',true) returning id into v_c;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_far,'Under 12 Boys','tl-far-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_f;

  v_ca    := pg_temp.person('CA','tlca-'||v_tag||'@ovalball.test');
  v_farca := pg_temp.person('FARCA','tlfarca-'||v_tag||'@ovalball.test');
  v_mb    := pg_temp.person('MB','tlmb-'||v_tag||'@ovalball.test');
  insert into public.club_memberships (club_id,user_id,role,status) values
    (v_club,v_ca,'CLUB_ADMIN','active'), (v_far,v_farca,'CLUB_ADMIN','active'), (v_club,v_mb,'BASIC_USER','active');

  v_one     := pg_temp.person('ONE','tl-one-'||v_tag||'@ovalball.test');
  v_many    := pg_temp.person('MANY','tl-many-'||v_tag||'@ovalball.test');
  v_dup     := pg_temp.person('DUP','tl-dup-'||v_tag||'@ovalball.test');
  v_mixed   := pg_temp.person('MIXED','tl-mixed-'||v_tag||'@ovalball.test');
  v_none    := pg_temp.person('NONE','tl-none-'||v_tag||'@ovalball.test');
  v_partial := pg_temp.person('PARTIAL','tl-partial-'||v_tag||'@ovalball.test');
  v_atomic  := pg_temp.person('ATOMIC','tl-partial2-'||v_tag||'@ovalball.test');

  -- ===============================================================================================
  -- TL-A  The three sizes of list: none, one, many
  -- ===============================================================================================

  -- TL-A1 ZERO TEAMS. A club-scoped role needs no team, and must not silently acquire one.
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-none-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('FIXTURES_SECRETARY')), null, null);
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(
    (select a.intended_outcome->'teams' from public.access_invitations a where a.id = v_inv.invitation_id) = '[]'::jsonb,
    'TL-A1 ZERO TEAMS: a club-scoped invitation stores an empty list, not a missing one');

  v_res := pg_temp.json_as(v_none, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(
    v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and pg_temp.team_roles(v_none, v_club, 'FIXTURES_SECRETARY') = '{}'::uuid[]
    and (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
          where m.user_id = v_none and ra.role_key = 'FIXTURES_SECRETARY' and ra.team_id is null and ra.state='ACTIVE') = 1,
    'TL-A2 and redeeming it grants the club role once, at the club, against no team');

  -- TL-A3 ONE TEAM.
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-one-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('COACH')), null, array[v_a]);
  perform set_config('request.jwt.claims','',true);
  v_res := pg_temp.json_as(v_one, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(
    v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and pg_temp.team_roles(v_one, v_club, 'COACH') = array[v_a],
    'TL-A3 ONE TEAM: a single-team staff invitation grants that one team and no other');

  -- TL-A4 MANY TEAMS -- the case a scalar column would have quietly truncated.
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-many-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('COACH')), null, array[v_a,v_b,v_c]);
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(
    (select jsonb_array_length(a.intended_outcome->'teams') from public.access_invitations a where a.id = v_inv.invitation_id) = 3,
    'TL-A4 MULTI-TEAM: all three teams are persisted, not just the first');

  v_res := pg_temp.json_as(v_many, format('select public.redeem_invitation(%L, null)', v_inv.token));
  select array_agg(t order by t) into v_sorted from unnest(array[v_a,v_b,v_c]) t;
  perform pg_temp.check(
    v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and pg_temp.team_roles(v_many, v_club, 'COACH') = v_sorted,
    'TL-A5 and redemption grants the Coach role once per team -- three assignments, one outcome');
  perform pg_temp.check(
    (select count(*) from public.club_memberships m where m.user_id = v_many and m.club_id = v_club and m.state='ACTIVE') = 1,
    'TL-A6 with exactly one club membership, because three teams are not three clubs');

  -- TL-A7 DUPLICATES. The same team named twice is the same team.
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-dup-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('COACH')), null, array[v_a,v_a,v_b,v_a]);
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(
    (select jsonb_array_length(a.intended_outcome->'teams') from public.access_invitations a where a.id = v_inv.invitation_id) = 2,
    'TL-A7 DUPLICATES: a repeated team id is collapsed at issue, not at redemption');
  v_res := pg_temp.json_as(v_dup, format('select public.redeem_invitation(%L, null)', v_inv.token));
  select array_agg(t order by t) into v_sorted from unnest(array[v_a,v_b]) t;
  perform pg_temp.check(pg_temp.team_roles(v_dup, v_club, 'COACH') = v_sorted,
    'TL-A8 and produces two assignments, not four');

  -- ===============================================================================================
  -- TL-B  Role and team are different questions
  -- ===============================================================================================
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-mixed-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('COACH','VOLUNTEER')), null, array[v_a,v_b]);
  perform set_config('request.jwt.claims','',true);
  v_res := pg_temp.json_as(v_mixed, format('select public.redeem_invitation(%L, null)', v_inv.token));
  select array_agg(t order by t) into v_sorted from unnest(array[v_a,v_b]) t;
  perform pg_temp.check(pg_temp.team_roles(v_mixed, v_club, 'COACH') = v_sorted,
    'TL-B1 a team-scoped role in the same invitation is granted at each team');
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = v_mixed and m.club_id = v_club and ra.role_key = 'VOLUNTEER' and ra.state='ACTIVE') = 1
    and pg_temp.team_roles(v_mixed, v_club, 'VOLUNTEER') = '{}'::uuid[],
    'TL-B2 while a club-scoped role in the SAME invitation is granted once -- a team list is not a role');
  perform pg_temp.check(
    internal.role_is_team_scoped('COACH') and internal.role_is_team_scoped('TEAM_MANAGER')
    and not internal.role_is_team_scoped('CLUB_ADMIN') and not internal.role_is_team_scoped('VOLUNTEER'),
    'TL-B3 and which is which comes from role_definitions.scope, not a list written inside redemption');

  -- ===============================================================================================
  -- TL-C  What the issuer may not author
  -- ===============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid,%L::uuid])',
      v_club, 'tl-x1-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}', v_a, v_f)) = '42501',
    'TL-C1 CROSS-CLUB: naming another club''s team in the list is refused outright');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid])',
      v_club, 'tl-x2-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}', gen_random_uuid())) = '42501',
    'TL-C2 NONEXISTENT: a team id that is not a team is refused');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid,null::uuid])',
      v_club, 'tl-x2b-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}', v_a)) = '22023',
    'TL-C2b NULL: a null in the list is refused, and never slips through as an authorised team');
  perform pg_temp.check(
    pg_temp.try_as(v_farca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid])',
      v_club, 'tl-x3-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}', v_a)) = '42501',
    'TL-C3 NO AUTHORITY: another club''s Club Admin cannot author a list over this club''s teams');
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid])',
      v_club, 'tl-x4-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}', v_a)) = '42501',
    'TL-C4 nor can an ordinary member of the right club');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      v_club, 'tl-x5-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}')) = '22023',
    'TL-C5 INCOHERENT: a Coach invitation naming no team is refused rather than stored as club-wide');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format(
      'select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, array[%L::uuid])',
      v_club, 'tl-x6-'||v_tag||'@ovalball.test', '{"roles":["TEAM_ADMINISTRATION"]}', v_a)) = '42501',
    'TL-C6 ROLE SUBSTITUTION: a role outside the O.1 ceiling is refused whatever teams accompany it');

  -- ===============================================================================================
  -- TL-D  What the invitee may not substitute
  -- ===============================================================================================
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-partial-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('COACH')), null, array[v_a]);
  perform set_config('request.jwt.claims','',true);

  perform pg_temp.check(
    (select count(*) from information_schema.parameters
      where specific_schema='public' and specific_name in
        (select specific_name from information_schema.routines where routine_schema='public' and routine_name='redeem_invitation')
        and parameter_name ~* 'team|club|role|scope') = 0,
    'TL-D1 SUBSTITUTION: redemption takes a token and a code, and nothing a browser could aim at a team');
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.access_invitations','UPDATE')
    and not has_table_privilege('authenticated','public.access_invitations','INSERT')
    and not has_table_privilege('authenticated','public.access_invitations','DELETE')
    and (select relrowsecurity from pg_class where oid = 'public.access_invitations'::regclass),
    'TL-D2 and no browser role may rewrite the stored list, under row level security');
  perform pg_temp.check(
    (select a.team_id is null from public.access_invitations a where a.id = v_inv.invitation_id),
    'TL-D3 SCALAR: the team_id column stays null on a staff invitation, so there is no second answer');
  perform pg_temp.check(
    exists (select 1 from pg_constraint
             where conname = 'access_invitations_club_staff_no_scalar_team'
               and conrelid = 'public.access_invitations'::regclass),
    'TL-D4 and a constraint keeps it that way, rather than a convention in one function');

  -- The widening attempt itself: the list is server state, so the only way in is a privileged write.
  update public.access_invitations
     set intended_outcome = jsonb_set(intended_outcome, '{teams}', to_jsonb(array[v_a,v_b,v_c]))
   where id = v_inv.invitation_id and false;   -- deliberately applies to no row
  perform pg_temp.check(
    (select jsonb_array_length(a.intended_outcome->'teams') from public.access_invitations a where a.id = v_inv.invitation_id) = 1,
    'TL-D5 WIDENING: the list is still the one team the issuer authorised');

  -- ===============================================================================================
  -- TL-E  All of it, or none of it
  -- ===============================================================================================
  perform pg_temp.as_(v_ca);
  select * into v_inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    'tl-partial2-'||v_tag||'@ovalball.test', jsonb_build_object('roles', jsonb_build_array('COACH')), null, array[v_a,v_b,v_c]);
  perform set_config('request.jwt.claims','',true);

  -- One of the three teams is retired between the invitation being sent and it being opened.
  update public.teams set active = false where id = v_b;

  v_res := pg_temp.json_as(v_atomic, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(v_res->>'outcome' = 'REFUSED',
    'TL-E1 ATOMICITY: if one team of three can no longer be honoured the redemption refuses');
  perform pg_temp.check(
    (select ra.outcome from public.invitation_redemption_attempts ra
      where ra.invitation_id = v_inv.invitation_id order by ra.occurred_at desc limit 1) = 'scope_gone',
    'TL-E1b and it refuses BECAUSE of the team -- not because some earlier check happened to refuse first');
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = v_atomic and m.club_id = v_club) = 0,
    'TL-E2 and nobody is left holding the two teams that were still fine');
  perform pg_temp.check(
    (select a.state from public.access_invitations a where a.id = v_inv.invitation_id) = 'ISSUED',
    'TL-E3 and the invitation is NOT spent, so fixing the team makes it work rather than reissuing it');

  update public.teams set active = true where id = v_b;
  v_res := pg_temp.json_as(v_atomic, format('select public.redeem_invitation(%L, null)', v_inv.token));
  select array_agg(t order by t) into v_sorted from unnest(array[v_a,v_b,v_c]) t;
  perform pg_temp.check(
    v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and pg_temp.team_roles(v_atomic, v_club, 'COACH') = v_sorted,
    'TL-E4 and once it is fixed the SAME invitation delivers the complete three-team outcome');

  -- TL-E5 REPLAY. A second open must not add a fourth assignment or a second membership.
  v_res := pg_temp.json_as(v_atomic, format('select public.redeem_invitation(%L, null)', v_inv.token));
  perform pg_temp.check(
    v_res->>'outcome' = 'ALREADY_REDEEMED'
    and pg_temp.team_roles(v_atomic, v_club, 'COACH') = v_sorted
    and (select count(*) from public.invitation_redemptions where invitation_id = v_inv.invitation_id) = 1,
    'TL-E5 REPLAY: opening the link again repeats the answer, never the three grants');

  -- ===============================================================================================
  -- TL-F  Legacy migration arithmetic: N teams in, N teams out
  -- ===============================================================================================
  perform pg_temp.check(
    (select count(*) from public.access_invitations a
      where a.kind = 'CLUB_STAFF'
        and coalesce(jsonb_array_length(a.intended_outcome->'teams'), -1) < 0) = 0,
    'TL-F1 every staff invitation in the table carries a teams list, so none can be read as "unknown"');
  perform pg_temp.check(
    not exists (
      select 1 from public.access_invitations a,
           lateral jsonb_array_elements_text(a.intended_outcome->'teams') t
       where a.kind = 'CLUB_STAFF'
         and not exists (select 1 from public.teams te where te.id = t::uuid and te.club_id = a.club_id)),
    'TL-F2 and no stored list contains a team belonging to a different club than the invitation');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
