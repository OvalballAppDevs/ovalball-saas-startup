-- =====================================================================================================
-- TEAM CODES PLACE PLAYERS (20270741000000) -- People & Invitations, the owner's decisions of 2026-10-05
--
-- WHAT THIS GUARDS
--
--   F. FIT: whether somebody may use a team's code is the canonical age grade (the season register and
--      resolve_player_age_grade) and the canonical pathway rule, asked of a date of birth and a gender;
--      an adult side asks only for an adult. Proved against the live season, not assumed.
--   C. CHOICES: the holder of a live team code sees the team, themselves and their own children with each
--      one's fit -- nobody else's children; a code that is not a live team code answers nothing.
--   R. USING IT FOR SOMEBODY: a request for THAT team, one per player; an older app's plain use still asks
--      to join the club; refusals spend nothing and write nothing; somebody else's child is unknown; a
--      parent may add a child (player, pending guardianship, pending place); a child who may already be at
--      the club is reviewed by the club and the parent is told nothing a probe could use; a child's own
--      login waits for a linked parent; the approvers are told, and only them.
--   G. A PARENT'S ANSWER: only a linked guardian confirms or declines; until then the team cannot approve
--      and its staff cannot see who it is.
--   A. ONE APPROVAL: only that team's Team Admin or Team Manager, or a Club Admin -- never a coach, never
--      the person asking for themselves or their own child; it confirms the guardianship, places the
--      player and admits the parent (and an adult player) as Members; a decline tells the parent even
--      when it ends their pending guardianship; other team places are approved exactly as before.
--   V. THE CARD: the approver's reader says what approving does, and refuses everybody else.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create temp table secrets (k text primary key, token text) on commit drop;
create temp table dates (k text primary key, d date) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.dob(p_k text) returns date language sql as $$ select d from dates where k = p_k $$;
create or replace function pg_temp.token(p_k text) returns text language sql as $$ select token from secrets where k = p_k $$;

create or replace function pg_temp.person(p_label text, p_email text, p_dob date default (current_date - interval '35 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v,'Code',p_label,p_email,p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims','', true);
end $$;

-- Runs one statement as a person; returns OK, or the SQLSTATE and the sentence a person would read.
create or replace function pg_temp.refusal_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  execute p_sql into v;
  perform pg_temp.off();
  return v;
end $$;

-- Uses a team code as a person, for a subject (null: an older app, which names nobody).
create or replace function pg_temp.use_code(p_subject uuid, p_code text, p_for jsonb) returns jsonb language plpgsql as $$
begin
  return pg_temp.json_as(p_subject, format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token(p_code), p_for));
end $$;

-- What the read policy lets a person count, asked as that person in the browser's own role.
create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_name, 'code-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.child(p_parent uuid, p_first text, p_dob date, p_pathway text, p_user uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values (p_first, 'Codechild', p_dob, true, p_pathway, p_user) returning id into v;
  if p_parent is not null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (p_parent, v, 'parent', 'active');
  end if;
  return v;
end $$;

create or replace function pg_temp.notified(p_user uuid, p_type text, p_membership uuid) returns boolean language sql as $$
  select exists (select 1 from public.notifications n
                  where n.user_id = p_user and n.type = p_type and n.data ->> 'membership_id' = p_membership::text)
$$;

create or replace function pg_temp.place(p_player uuid, p_team uuid) returns public.player_team_memberships language sql as $$
  select * from public.player_team_memberships where player_id = p_player and team_id = p_team order by created_at desc limit 1
$$;

-- =====================================================================================================
-- SEED: a club with Under 14 Boys, Under 14 Girls and Men's 1st; another club; staff; families.
-- =====================================================================================================
do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_season date;
  v_dir uuid; v_club uuid; v_fdir uuid; v_far uuid;
  v_u14 uuid; v_g14 uuid; v_m1 uuid;
  v record;
begin
  -- Dates of birth from the season the register says is current: never a hard-coded year.
  select s.starts_on into v_season from public.seasons s where s.id = internal.resolve_season_for_date('union', current_date);
  insert into dates values
    ('u14', (v_season - interval '13 years 6 months')::date),
    ('u14b', (v_season - interval '13 years 4 months')::date),
    ('u12', (v_season - interval '11 years 6 months')::date),
    ('u16', (v_season - interval '15 years 6 months')::date),
    ('seventeen', (current_date - interval '17 years 2 months')::date),
    ('nineteen', (current_date - interval '19 years')::date),
    ('adult', (current_date - interval '30 years')::date);

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Code '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','code-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'code-'||v_tag,'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Code Far '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','code-far-'||v_tag) returning id into v_fdir;
  insert into public.clubs (directory_id, slug, status) values (v_fdir,'code-far-'||v_tag,'active') returning id into v_far;
  perform pg_temp.put('club', v_club); perform pg_temp.put('far', v_far);

  v_u14 := pg_temp.put('u14', pg_temp.team(v_club, 'Under 14 Boys', 'youth', 'U14', 'boys'));
  v_g14 := pg_temp.put('g14', pg_temp.team(v_club, 'Under 14 Girls', 'youth', 'U14', 'girls'));
  v_m1 := pg_temp.put('m1', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));

  -- Staff: a Club Admin, the Under 14s' Team Admin, Team Manager and Coach, another club's admin.
  perform pg_temp.put('ca', pg_temp.person('Admin', 'tc-ca-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('ta', pg_temp.person('TeamAdmin', 'tc-ta-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('tm', pg_temp.person('Manager', 'tc-tm-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('coach', pg_temp.person('Coach', 'tc-co-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('farca', pg_temp.person('FarAdmin', 'tc-farca-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('m_ca', pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN'));
  perform pg_temp.put('m_ta', pg_temp.member(v_club, pg_temp.id('ta')));
  perform pg_temp.put('m_tm', pg_temp.member(v_club, pg_temp.id('tm')));
  perform pg_temp.put('m_coach', pg_temp.member(v_club, pg_temp.id('coach')));
  perform pg_temp.put('m_farca', pg_temp.member(v_far, pg_temp.id('farca'), 'CLUB_ADMIN'));
  perform internal.grant_role(pg_temp.id('m_ta'), 'COACH', v_u14, 'LEGACY_BACKFILL', 'code seed');
  perform internal.grant_role(pg_temp.id('m_ta'), 'TEAM_ADMINISTRATION', v_u14, 'LEGACY_BACKFILL', 'code seed');
  perform internal.grant_role(pg_temp.id('m_tm'), 'TEAM_MANAGER', v_u14, 'LEGACY_BACKFILL', 'code seed');
  perform internal.grant_role(pg_temp.id('m_coach'), 'COACH', v_u14, 'LEGACY_BACKFILL', 'code seed');

  -- Families. Sarah: a son who fits Under 14 and a younger one who does not. Anita: Jamie, 13, with his
  -- own login. Ruth: no children yet. Omar: a stranger to everybody. Lee: an adult player. Kim: an adult
  -- with no player record. Mo: a 15-year-old with a login and nobody linked. Dana: another parent.
  perform pg_temp.put('sarah', pg_temp.person('Sarah', 'tc-sarah-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('anita', pg_temp.person('Anita', 'tc-anita-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('ruth', pg_temp.person('Ruth', 'tc-ruth-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('omar', pg_temp.person('Omar', 'tc-omar-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('lee', pg_temp.person('Lee', 'tc-lee-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('kim', pg_temp.person('Kim', 'tc-kim-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('dana', pg_temp.person('Dana', 'tc-dana-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('jamie', pg_temp.person('Jamie', 'tc-jamie-'||v_tag||'@ovalball.test', pg_temp.dob('u14b')));
  perform pg_temp.put('mo', pg_temp.person('Mo', 'tc-mo-'||v_tag||'@ovalball.test', pg_temp.dob('u16')));
  -- The Team Manager is also a parent here, which is exactly the case self-approval must refuse.
  perform pg_temp.put('harry', pg_temp.child(pg_temp.id('sarah'), 'Harry', pg_temp.dob('u14'), 'MALE'));
  perform pg_temp.put('oliver', pg_temp.child(pg_temp.id('sarah'), 'Oliver', pg_temp.dob('u12'), 'MALE'));
  perform pg_temp.put('jamie_p', pg_temp.child(pg_temp.id('anita'), 'Jamie', pg_temp.dob('u14b'), 'MALE', pg_temp.id('jamie')));
  perform pg_temp.put('mo_p', pg_temp.child(null, 'Mo', pg_temp.dob('u16'), 'MALE', pg_temp.id('mo')));
  perform pg_temp.put('tm_kid', pg_temp.child(pg_temp.id('tm'), 'Teddy', pg_temp.dob('u14'), 'MALE'));
  perform pg_temp.put('ella', pg_temp.child(pg_temp.id('dana'), 'Ella', pg_temp.dob('u14'), 'FEMALE'));
  perform pg_temp.put('lee_p', pg_temp.child(null, 'Lee', pg_temp.dob('adult'), 'MALE', pg_temp.id('lee')));
  -- A boy already at the club whom a different parent will try to add again.
  perform pg_temp.put('known', pg_temp.child(null, 'Known', pg_temp.dob('u14'), 'MALE'));
  insert into public.player_team_memberships (player_id, team_id, status) values (pg_temp.id('known'), v_u14, 'active');
  -- An ordinary waiting place, not from a code, to prove approval is unchanged for it.
  perform pg_temp.put('plain', pg_temp.child(pg_temp.id('omar'), 'Plain', pg_temp.dob('u14'), 'MALE'));
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (pg_temp.id('plain'), v_u14, 'pending', 'PENDING', 'GUARDIAN_ADDED_CHILD');

  -- The codes, issued the canonical way: the Under 14s' by their Team Manager, Men's 1st by the Club Admin.
  perform pg_temp.as_(pg_temp.id('tm'));
  select * into v from public.issue_invitation('TEAM_JOIN_CODE', null, v_u14, null, null, null, null, '{}'::jsonb, 50);
  insert into secrets values ('u14', v.token); perform pg_temp.put('inv_u14', v.invitation_id);
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('TEAM_JOIN_CODE', null, v_m1, null, null, null, null, '{}'::jsonb, 50);
  insert into secrets values ('m1', v.token); perform pg_temp.put('inv_m1', v.invitation_id);
  select * into v from public.issue_invitation('TEAM_JOIN_CODE', null, v_g14, null, null, null, null, '{}'::jsonb, 50);
  insert into secrets values ('g14', v.token); perform pg_temp.put('inv_g14', v.invitation_id);
  select * into v from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null, 'tc-staff-'||v_tag||'@ovalball.test',
                                               jsonb_build_object('roles', jsonb_build_array('MEMBER')));
  insert into secrets values ('staff', v.token);
  perform pg_temp.off();
end $$;

-- =====================================================================================================
-- F. FIT
-- =====================================================================================================
do $$
declare v_season uuid := internal.resolve_season_for_date('union', current_date);
begin
  perform pg_temp.check((select canonical_age_group from internal.resolve_player_age_grade('union', v_season, pg_temp.dob('u14'))) = 'U14'
                        and (select canonical_age_group from internal.resolve_player_age_grade('union', v_season, pg_temp.dob('u12'))) = 'U12',
    'F0 the suite''s dates of birth are what the canonical resolver says they are (U14, U12) this season');
  perform pg_temp.check(internal.team_code_fit(pg_temp.id('u14'), pg_temp.dob('u14'), 'MALE') = 'FITS',
    'F1 a boy of Under 14 age fits Under 14 Boys');
  perform pg_temp.check(internal.team_code_fit(pg_temp.id('u14'), pg_temp.dob('u12'), 'MALE') = 'TOO_YOUNG'
                        and internal.team_code_fit(pg_temp.id('u14'), pg_temp.dob('u16'), 'MALE') = 'TOO_OLD',
    'F2 an Under 12 is too young and an Under 16 too old for it');
  perform pg_temp.check(internal.team_code_fit(pg_temp.id('u14'), pg_temp.dob('u14'), 'FEMALE') = 'OTHER_PATHWAY'
                        and internal.team_code_fit(pg_temp.id('g14'), pg_temp.dob('u14'), 'FEMALE') = 'FITS',
    'F3 the pathway is the canonical rule: a girl of the age is the other pathway for the boys, and fits the girls');
  perform pg_temp.check(internal.team_code_fit(pg_temp.id('m1'), pg_temp.dob('adult'), 'MALE') = 'FITS'
                        and internal.team_code_fit(pg_temp.id('m1'), pg_temp.dob('seventeen'), 'MALE') = 'UNDER_18'
                        and internal.team_code_fit(pg_temp.id('m1'), pg_temp.dob('adult'), 'FEMALE') = 'OTHER_PATHWAY',
    'F4 an adult side asks for an adult of its pathway: a 17-year-old is under 18, a woman is the other pathway');
  perform pg_temp.check(internal.team_code_fit(pg_temp.id('u14'), null, 'MALE') = 'NO_DATE_OF_BIRTH'
                        and internal.team_code_fit(pg_temp.id('u14'), pg_temp.dob('u14'), null) = 'NO_PATHWAY',
    'F5 nothing is assumed: no date of birth, or no gender for a boys'' side, is said as such');
end $$;

-- =====================================================================================================
-- C. CHOICES
-- =====================================================================================================
do $$
declare v jsonb;
begin
  v := pg_temp.json_as(pg_temp.id('sarah'), format('select public.team_code_choices(%L, null)', pg_temp.token('u14')));
  perform pg_temp.check(v -> 'team' ->> 'label' = 'Under 14 Boys' and (v -> 'team' ->> 'adult_side')::boolean = false
                        and v -> 'team' ->> 'age_group' = 'U14' and v -> 'team' ->> 'gender' = 'boys',
    'C1 the holder of the code sees the team it is for: Under 14, a boys'' side');
  perform pg_temp.check(jsonb_array_length(v -> 'children') = 2
                        and exists (select 1 from jsonb_array_elements(v -> 'children') c where c ->> 'first_name' = 'Harry' and c ->> 'fit' = 'FITS')
                        and exists (select 1 from jsonb_array_elements(v -> 'children') c where c ->> 'first_name' = 'Oliver' and c ->> 'fit' = 'TOO_YOUNG'),
    'C2 and their own two children, each with the canonical answer: Harry fits, Oliver is too young');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v -> 'children') c
                                     where c ->> 'player_id' in (pg_temp.id('ella')::text, pg_temp.id('jamie_p')::text, pg_temp.id('known')::text)),
    'C3 and nobody else''s child');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('sarah'), format('select public.team_code_choices(%L, null)', 'not-a-real-token')) is null
                        and pg_temp.json_as(pg_temp.id('sarah'), format('select public.team_code_choices(%L, null)', pg_temp.token('staff'))) is null,
    'C4 an unknown code, or an invitation that is not a team code, answers nothing at all');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.team_code_choices(%L, null)', pg_temp.token('m1')));
  perform pg_temp.check(v -> 'member' ->> 'membership' = 'ACTIVE' and (v -> 'team' ->> 'adult_side')::boolean,
    'C5 a member is told they already are one; Men''s 1st is an adult side');
  perform pg_temp.check(pg_temp.refusal_as(null, format('select public.team_code_choices(%L, null)', pg_temp.token('u14'))) like '42501%',
    'C6 nobody signed out reads the choices');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('ruth'), format('select to_jsonb(public.team_code_fit_check(%L, %L, %L, null))', pg_temp.dob('u14'), 'MALE', pg_temp.token('u14'))) = '"FITS"'::jsonb
                        and pg_temp.json_as(pg_temp.id('ruth'), format('select to_jsonb(public.team_code_fit_check(%L, %L, %L, null))', pg_temp.dob('u12'), 'MALE', pg_temp.token('u14'))) = '"TOO_YOUNG"'::jsonb
                        and pg_temp.json_as(pg_temp.id('ruth'), format('select to_jsonb(public.team_code_fit_check(%L, %L, %L, null))', pg_temp.dob('nineteen'), 'MALE', pg_temp.token('u14'))) = '"ADULT_OWN_ACCOUNT"'::jsonb
                        and pg_temp.json_as(pg_temp.id('ruth'), format('select coalesce(to_jsonb(public.team_code_fit_check(%L, %L, %L, null)), ''null''::jsonb)', pg_temp.dob('u14'), 'MALE', pg_temp.token('staff'))) = 'null'::jsonb,
    'C7 the form can ask the same canonical answer of what a parent is typing, and only of a live team code');
end $$;

-- =====================================================================================================
-- R. USING IT FOR SOMEBODY
-- =====================================================================================================
do $$
declare v jsonb; v_uses int; v_place public.player_team_memberships; v_players int;
begin
  -- An older app names nobody: exactly what a team code did before.
  v := pg_temp.use_code(pg_temp.id('omar'), 'u14', null);
  perform pg_temp.check(v ->> 'outcome' = 'JOIN_REQUEST_PENDING'
                        and exists (select 1 from public.club_join_requests r where r.requesting_user_id = pg_temp.id('omar')
                                      and r.club_id = pg_temp.id('club') and r.source_invitation_id = pg_temp.id('inv_u14')),
    'R1 an older app''s plain use still asks to join the club, exactly as before');

  select use_count into v_uses from public.access_invitations where id = pg_temp.id('inv_u14');
  v := pg_temp.use_code(pg_temp.id('sarah'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('harry')));
  v_place := pg_temp.place(pg_temp.id('harry'), pg_temp.id('u14'));
  perform pg_temp.put('req_harry', v_place.id);
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v ->> 'membership_id')::uuid = v_place.id
                        and v_place.state = 'PENDING' and v_place.source = 'TEAM_CODE' and v_place.source_invitation_id = pg_temp.id('inv_u14')
                        and v_place.created_by = pg_temp.id('sarah') and v_place.guardian_confirmation is null,
    'R2 a parent using the code for their child asks for a place on THAT team, recording the code and who asked');
  perform pg_temp.check((select use_count from public.access_invitations where id = pg_temp.id('inv_u14')) = v_uses + 1
                        and exists (select 1 from public.invitation_redemptions r where r.invitation_id = pg_temp.id('inv_u14')
                                      and r.user_id = pg_temp.id('sarah') and r.subject_player_id = pg_temp.id('harry')),
    'R3 one use of the code, recorded against that child');
  perform pg_temp.check(pg_temp.notified(pg_temp.id('ta'), 'team_place_requested', v_place.id)
                        and pg_temp.notified(pg_temp.id('tm'), 'team_place_requested', v_place.id)
                        and pg_temp.notified(pg_temp.id('ca'), 'team_place_requested', v_place.id),
    'R4 the people who can approve it are told: the Team Admin, the Team Manager and the Club Admin');
  perform pg_temp.check(not pg_temp.notified(pg_temp.id('coach'), 'team_place_requested', v_place.id)
                        and not pg_temp.notified(pg_temp.id('sarah'), 'team_place_requested', v_place.id)
                        and not pg_temp.notified(pg_temp.id('farca'), 'team_place_requested', v_place.id),
    'R5 and nobody else: not a coach, not the parent, not another club');

  v := pg_temp.use_code(pg_temp.id('sarah'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('harry')));
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v ->> 'already')::boolean
                        and (select count(*) from public.player_team_memberships where player_id = pg_temp.id('harry') and team_id = pg_temp.id('u14')) = 1
                        and (select use_count from public.access_invitations where id = pg_temp.id('inv_u14')) = v_uses + 1,
    'R6 asking again for the same child answers with the request they already have, and spends nothing');

  select use_count into v_uses from public.access_invitations where id = pg_temp.id('inv_u14');
  v := pg_temp.use_code(pg_temp.id('sarah'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('oliver')));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' = 'NOT_ELIGIBLE' and v ->> 'verdict' = 'TOO_YOUNG'
                        and pg_temp.place(pg_temp.id('oliver'), pg_temp.id('u14')) is null
                        and (select use_count from public.access_invitations where id = pg_temp.id('inv_u14')) = v_uses,
    'R7 a child of the wrong age grade is refused, saying why, with nothing written and nothing spent');

  v := pg_temp.use_code(pg_temp.id('omar'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('ella')));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' is null
                        and v ->> 'message' = 'That invitation or code can''t be used.'
                        and pg_temp.place(pg_temp.id('ella'), pg_temp.id('u14')) is null,
    'R8 somebody else''s child is as unknown as no child: the generic refusal, nothing written');

  -- A child not on Ovalball yet.
  select count(*) into v_players from public.players;
  v := pg_temp.use_code(pg_temp.id('ruth'), 'u14', jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Archie', 'surname', 'Newman',
                                                                      'date_of_birth', pg_temp.dob('u14')::text, 'playing_pathway', 'MALE'));
  perform pg_temp.put('archie', (v ->> 'player_id')::uuid);
  perform pg_temp.put('req_archie', (v ->> 'membership_id')::uuid);
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v ->> 'new_child')::boolean
                        and (select count(*) from public.players) = v_players + 1
                        and exists (select 1 from public.guardians g where g.player_id = pg_temp.id('archie') and g.guardian_user_id = pg_temp.id('ruth')
                                      and g.state = 'PENDING_APPROVAL' and g.source = 'TEAM_CODE' and g.source_invitation_id = pg_temp.id('inv_u14'))
                        and (pg_temp.place(pg_temp.id('archie'), pg_temp.id('u14'))).state = 'PENDING',
    'R9 a parent adds a child with the code: the player, a guardianship waiting on approval, and a waiting place');
  perform pg_temp.check(not exists (select 1 from public.guardians g where g.player_id = pg_temp.id('archie') and g.state = 'ACTIVE'),
    'R10 and the parent holds no authority over that child until the club approves');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('ruth'), 'select public.my_team_requests()')) r
                                  where r ->> 'membership_id' = pg_temp.id('req_archie')::text and r ->> 'first_name' = 'Archie'
                                    and r ->> 'team_label' = 'Under 14 Boys' and not (r ->> 'for_self')::boolean)
                        and pg_temp.json_as(pg_temp.id('omar'), 'select public.my_team_requests()') = '[]'::jsonb,
    'R10b but she can see that her request for him waits, and nobody else can');

  v := pg_temp.use_code(pg_temp.id('ruth'), 'u14', jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Bea', 'surname', 'Newman',
                                                                      'date_of_birth', pg_temp.dob('u14')::text));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' = 'DETAILS_REQUIRED'
                        and not exists (select 1 from public.players where first_name = 'Bea' and surname = 'Newman'),
    'R11 a child without a gender is not created: the parent is asked for it');
  v := pg_temp.use_code(pg_temp.id('ruth'), 'm1', jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Grown', 'surname', 'Newman',
                                                                     'date_of_birth', pg_temp.dob('nineteen')::text, 'playing_pathway', 'MALE'));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'verdict' = 'ADULT_OWN_ACCOUNT'
                        and not exists (select 1 from public.players where first_name = 'Grown' and surname = 'Newman'),
    'R12 an adult is never added as somebody''s child: they join with their own account');

  -- A child who may already be at the club, added by somebody who is not their parent.
  select count(*) into v_players from public.players;
  v := pg_temp.use_code(pg_temp.id('dana'), 'u14', jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Known', 'surname', 'Codechild',
                                                                      'date_of_birth', pg_temp.dob('u14')::text, 'playing_pathway', 'MALE'));
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v ->> 'under_review')::boolean and v ->> 'membership_id' is null
                        and (select count(*) from public.players) = v_players
                        and exists (select 1 from public.player_duplicate_reviews r where r.requesting_guardian_user_id = pg_temp.id('dana')
                                      and r.matched_player_id = pg_temp.id('known') and r.status = 'pending'),
    'R13 a child who may already be at the club goes to the club''s duplicate review, and the parent is told only that it waits');
  perform pg_temp.check(not exists (select 1 from public.guardians g where g.player_id = pg_temp.id('known') and g.guardian_user_id = pg_temp.id('dana')),
    'R14 nobody is linked to an existing child by typing their name and birthday');

  -- Adults on their own account.
  v := pg_temp.use_code(pg_temp.id('lee'), 'm1', jsonb_build_object('for', 'SELF'));
  perform pg_temp.put('req_lee', (v ->> 'membership_id')::uuid);
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and not (v ->> 'awaiting_guardian')::boolean
                        and (pg_temp.place(pg_temp.id('lee_p'), pg_temp.id('m1'))).state = 'PENDING'
                        and pg_temp.notified(pg_temp.id('ca'), 'team_place_requested', pg_temp.id('req_lee')),
    'R15 an adult player asks for a place on Men''s 1st for themselves, and the Club Admin is told');
  v := pg_temp.use_code(pg_temp.id('kim'), 'm1', jsonb_build_object('for', 'SELF'));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' = 'DETAILS_REQUIRED',
    'R16 an adult with no player record is asked for a date of birth and gender first');
  v := pg_temp.use_code(pg_temp.id('kim'), 'm1', jsonb_build_object('for', 'SELF', 'date_of_birth', pg_temp.dob('adult')::text, 'playing_pathway', 'MALE'));
  perform pg_temp.put('req_kim', (v ->> 'membership_id')::uuid);
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING'
                        and exists (select 1 from public.players p where p.user_id = pg_temp.id('kim') and p.date_of_birth = pg_temp.dob('adult')
                                      and p.playing_pathway = 'MALE'),
    'R17 given them, their own player record is made the one canonical way, and the request is filed');

  -- A child's own login.
  v := pg_temp.use_code(pg_temp.id('jamie'), 'u14', jsonb_build_object('for', 'SELF'));
  perform pg_temp.put('req_jamie', (v ->> 'membership_id')::uuid);
  v_place := pg_temp.place(pg_temp.id('jamie_p'), pg_temp.id('u14'));
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v ->> 'awaiting_guardian')::boolean
                        and v_place.guardian_confirmation = 'AWAITING' and v_place.created_by = pg_temp.id('jamie'),
    'R18 a 13-year-old''s own request waits for a parent to confirm it');
  perform pg_temp.check(pg_temp.notified(pg_temp.id('anita'), 'team_place_confirm_requested', v_place.id)
                        and not pg_temp.notified(pg_temp.id('ta'), 'team_place_requested', v_place.id)
                        and not pg_temp.notified(pg_temp.id('ca'), 'team_place_requested', v_place.id),
    'R19 their parent is asked; the team is not told anything yet');
  v := pg_temp.use_code(pg_temp.id('mo'), 'u14', jsonb_build_object('for', 'SELF'));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' = 'GUARDIAN_REQUIRED'
                        and pg_temp.place(pg_temp.id('mo_p'), pg_temp.id('u14')) is null,
    'R20 a child with nobody linked to confirm is asked to have a parent use the code for them');
end $$;

-- =====================================================================================================
-- G. A PARENT'S ANSWER
-- =====================================================================================================
do $$
declare v_res text; v jsonb;
begin
  perform pg_temp.check(pg_temp.count_as(pg_temp.id('ta'), format('select count(*) from public.player_team_memberships where id = %L', pg_temp.id('req_jamie'))) = 0
                        and pg_temp.count_as(pg_temp.id('anita'), format('select count(*) from public.player_team_memberships where id = %L', pg_temp.id('req_jamie'))) = 1
                        and pg_temp.count_as(pg_temp.id('jamie'), format('select count(*) from public.player_team_memberships where id = %L', pg_temp.id('req_jamie'))) = 1,
    'G1 while it waits, the team''s staff cannot see the request at all; the child and their parent can');
  perform pg_temp.check(pg_temp.count_as(pg_temp.id('ta'), format('select count(*) from public.team_people(%L) p where p.row_id = %L', pg_temp.id('u14'), pg_temp.id('req_jamie'))) = 0
                        and pg_temp.count_as(pg_temp.id('ta'), format('select count(*) from public.team_people(%L) p where p.row_id = %L', pg_temp.id('u14'), pg_temp.id('req_harry'))) = 1,
    'G2 nor does it appear among the team''s people, where a request from a parent does');
  v := pg_temp.json_as(pg_temp.id('ta'), format('select public.team_place_requests(%L)', pg_temp.id('u14')));
  perform pg_temp.check((v ->> 'awaiting_guardian')::int = 1
                        and not exists (select 1 from jsonb_array_elements(v -> 'requests') r where r ->> 'membership_id' = pg_temp.id('req_jamie')::text),
    'G3 the staff are told one more is waiting for a parent, and not who');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('jamie'), format('select public.team_code_choices(%L, null)', pg_temp.token('u14'))) #>> '{me,place}' = 'AWAITING'
                        and exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('anita'), format('select public.team_code_choices(%L, null)', pg_temp.token('u14'))) -> 'children') c
                                     where c ->> 'player_id' = pg_temp.id('jamie_p')::text and c ->> 'place' = 'AWAITING'),
    'G3b opening the code again, the child and their parent both read that it waits on the parent, not the team');

  v_res := pg_temp.refusal_as(pg_temp.id('ta'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_jamie')));
  perform pg_temp.check(v_res like '23514%' and (pg_temp.place(pg_temp.id('jamie_p'), pg_temp.id('u14'))).state = 'PENDING',
    'G4 the team cannot approve it before the parent confirms');
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('omar'), format('select public.confirm_team_place_request(%L)', pg_temp.id('req_jamie'))) like '42501%'
                        and pg_temp.refusal_as(pg_temp.id('jamie'), format('select public.confirm_team_place_request(%L)', pg_temp.id('req_jamie'))) like '42501%'
                        and pg_temp.refusal_as(pg_temp.id('ta'), format('select public.confirm_team_place_request(%L)', pg_temp.id('req_jamie'))) like '42501%',
    'G5 only a linked parent confirms: not a stranger, not the child, not the team');

  v := pg_temp.json_as(pg_temp.id('anita'), 'select public.family_team_requests()');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v) r where r ->> 'membership_id' = pg_temp.id('req_jamie')::text
                                  and r ->> 'team_label' = 'Under 14 Boys' and r ->> 'first_name' = 'Jamie')
                        and pg_temp.json_as(pg_temp.id('omar'), 'select public.family_team_requests()') = '[]'::jsonb
                        and pg_temp.json_as(pg_temp.id('jamie'), 'select public.family_team_requests()') = '[]'::jsonb,
    'G5b the parent''s app lists what waits on them, naming the child and the team; nobody else''s, and not the child''s own');
  v_res := pg_temp.refusal_as(pg_temp.id('anita'), format('select public.confirm_team_place_request(%L)', pg_temp.id('req_jamie')));
  perform pg_temp.check(v_res = 'OK' and (pg_temp.place(pg_temp.id('jamie_p'), pg_temp.id('u14'))).guardian_confirmation = 'CONFIRMED'
                        and (pg_temp.place(pg_temp.id('jamie_p'), pg_temp.id('u14'))).guardian_confirmed_by = pg_temp.id('anita'),
    'G6 their parent confirms it');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('anita'), 'select public.family_team_requests()')) r
                                     where r ->> 'membership_id' = pg_temp.id('req_jamie')::text),
    'G6b and it no longer waits on them');
  perform pg_temp.check(pg_temp.notified(pg_temp.id('ta'), 'team_place_requested', pg_temp.id('req_jamie'))
                        and pg_temp.notified(pg_temp.id('ca'), 'team_place_requested', pg_temp.id('req_jamie'))
                        and pg_temp.count_as(pg_temp.id('ta'), format('select count(*) from public.player_team_memberships where id = %L', pg_temp.id('req_jamie'))) = 1,
    'G7 and only now are the approvers told, and can see it');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('jamie'), format('select public.team_code_choices(%L, null)', pg_temp.token('u14'))) #>> '{me,place}' = 'PENDING',
    'G7b and the child now reads that the team decides');
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('anita'), format('select public.confirm_team_place_request(%L)', pg_temp.id('req_jamie'))) like '23514%',
    'G8 an answered request cannot be answered again');
end $$;

-- A second child's own request, which the parent declines.
do $$
declare v jsonb; v_kid uuid; v_child_user uuid; v_res text;
begin
  v_child_user := pg_temp.person('Second', 'tc-second-'||substr(gen_random_uuid()::text,1,8)||'@ovalball.test', pg_temp.dob('u14'));
  v_kid := pg_temp.child(pg_temp.id('anita'), 'Second', pg_temp.dob('u14'), 'MALE', v_child_user);
  v := pg_temp.use_code(v_child_user, 'u14', jsonb_build_object('for', 'SELF'));
  v_res := pg_temp.refusal_as(pg_temp.id('anita'), format('select public.decline_team_place_request(%L, %L)', (v ->> 'membership_id')::uuid, 'Not this season'));
  perform pg_temp.check(v_res = 'OK'
                        and (pg_temp.place(v_kid, pg_temp.id('u14'))).state = 'DECLINED'
                        and exists (select 1 from public.notifications n where n.user_id = v_child_user and n.type = 'add_child_declined'),
    'G9 a parent may decline their child''s request instead, and the child is told');

  -- Using the same code again for the same player is answered, never an error -- and asks nobody again.
  v := pg_temp.use_code(v_child_user, 'u14', jsonb_build_object('for', 'SELF'));
  perform pg_temp.check(v ->> 'outcome' = 'REFUSED' and v ->> 'reason' = 'ALREADY_USED'
                        and v ->> 'message' = 'You''ve already used this code. To ask again, talk to the team.'
                        and (select count(*) from public.player_team_memberships where player_id = v_kid and team_id = pg_temp.id('u14')) = 1,
    'G10 the child using the code again is told they already have, and no second request is made');
  perform pg_temp.check(pg_temp.json_as(v_child_user, format('select public.team_code_choices(%L, null)', pg_temp.token('u14'))) #>> '{me,place}' = 'USED',
    'G10b and the code shows them that, before they try');
  v := pg_temp.use_code(pg_temp.id('anita'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', v_kid));
  -- By id: the declined place and this one were made in one transaction, so "the latest" is a tie.
  perform pg_temp.check(v ->> 'outcome' = 'TEAM_PLACE_PENDING' and not (v ->> 'awaiting_guardian')::boolean
                        and (select state from public.player_team_memberships where id = (v ->> 'membership_id')::uuid) = 'PENDING'
                        and (select count(*) from public.player_team_memberships where player_id = v_kid and team_id = pg_temp.id('u14') and state = 'PENDING') = 1,
    'G11 their parent may still use it for them: one use per person, for each player');
end $$;

-- =====================================================================================================
-- A. ONE APPROVAL
-- =====================================================================================================
do $$
declare v_res text; v jsonb;
begin
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('coach'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_harry'))) like '42501%'
                        and pg_temp.refusal_as(pg_temp.id('farca'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_harry'))) like '42501%',
    'A1 a coach cannot approve, and nor can another club''s administrator');

  -- The Team Manager's own child: asked for with the code, then the Team Manager tries to approve it.
  v := pg_temp.use_code(pg_temp.id('tm'), 'u14', jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('tm_kid')));
  perform pg_temp.put('req_teddy', (v ->> 'membership_id')::uuid);
  v_res := pg_temp.refusal_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_teddy')));
  perform pg_temp.check(v_res like '42501%approve a request for yourself or your own child%'
                        and (pg_temp.place(pg_temp.id('tm_kid'), pg_temp.id('u14'))).state = 'PENDING',
    'A2 nobody approves their own child''s request: the Team Manager is refused, and told another approver will');
  perform pg_temp.check(not pg_temp.notified(pg_temp.id('tm'), 'team_place_requested', pg_temp.id('req_teddy'))
                        and pg_temp.notified(pg_temp.id('ta'), 'team_place_requested', pg_temp.id('req_teddy')),
    'A3 so they are not asked to, and the other approvers are');
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('lee'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_lee'))) like '42501%',
    'A4 nor does anybody approve their own');

  -- The Team Admin approves a child a parent added: one approval, the whole answer.
  v_res := pg_temp.refusal_as(pg_temp.id('ta'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_archie')));
  perform pg_temp.check(v_res = 'OK' and (pg_temp.place(pg_temp.id('archie'), pg_temp.id('u14'))).state = 'ACTIVE',
    'A5 the Team Admin approves Archie: he is on Under 14 Boys');
  perform pg_temp.check(exists (select 1 from public.guardians g where g.player_id = pg_temp.id('archie') and g.guardian_user_id = pg_temp.id('ruth')
                                  and g.state = 'ACTIVE' and g.approved_by = pg_temp.id('ta')),
    'A6 his parent is now his guardian, on the same approval');
  perform pg_temp.check(exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club') and m.user_id = pg_temp.id('ruth')
                                  and m.state = 'ACTIVE' and m.source = 'TEAM_CODE' and m.source_invitation_id = pg_temp.id('inv_u14')),
    'A7 and a Member of the club, recorded as having come through the team code');
  perform pg_temp.check(exists (select 1 from public.notifications n where n.user_id = pg_temp.id('ruth') and n.type = 'add_child_approved'),
    'A8 and she is told');

  -- The Team Manager approves a request from a family they are not part of.
  v_res := pg_temp.refusal_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_harry')));
  perform pg_temp.check(v_res = 'OK'
                        and (pg_temp.place(pg_temp.id('harry'), pg_temp.id('u14'))).state = 'ACTIVE'
                        and exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club') and m.user_id = pg_temp.id('sarah') and m.state = 'ACTIVE'),
    'A9 a Team Manager approves Harry, and his parent joins the club too');

  -- A child's confirmed own request: placed, nobody admitted as a member on the child's behalf.
  v_res := pg_temp.refusal_as(pg_temp.id('ta'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_jamie')));
  perform pg_temp.check(v_res = 'OK'
                        and (pg_temp.place(pg_temp.id('jamie_p'), pg_temp.id('u14'))).state = 'ACTIVE'
                        and not exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club') and m.user_id = pg_temp.id('jamie')),
    'A10 Jamie''s confirmed request is approved: he is on the team, and a child is not made a club member by it');

  -- The Club Admin approves an adult on Men's 1st: the owner-approved widening.
  v_res := pg_temp.refusal_as(pg_temp.id('ca'), format('select public.approve_pending_team_membership(%L)', pg_temp.id('req_lee')));
  perform pg_temp.check(v_res = 'OK'
                        and exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club') and m.user_id = pg_temp.id('lee')
                                      and m.state = 'ACTIVE' and m.source = 'TEAM_CODE'),
    'A11 an adult player approved onto Men''s 1st is admitted to the club as a Member');

  -- Other team places are exactly as they were.
  v_res := pg_temp.refusal_as(pg_temp.id('ta'), format('select public.approve_pending_team_membership(%L)', (pg_temp.place(pg_temp.id('plain'), pg_temp.id('u14'))).id));
  perform pg_temp.check(v_res = 'OK'
                        and (pg_temp.place(pg_temp.id('plain'), pg_temp.id('u14'))).state = 'ACTIVE'
                        and not exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club') and m.user_id = pg_temp.id('omar') and m.state = 'ACTIVE'),
    'A12 a place that did not come from a code is approved exactly as before, admitting nobody');
end $$;

-- A decline ends a parent's pending guardianship and still tells them.
do $$
declare v jsonb; v_kid uuid; v_mid uuid; v_res text;
begin
  v := pg_temp.use_code(pg_temp.id('omar'), 'u14', jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Zed', 'surname', 'Declined',
                                                                      'date_of_birth', pg_temp.dob('u14')::text, 'playing_pathway', 'MALE'));
  v_kid := (v ->> 'player_id')::uuid; v_mid := (v ->> 'membership_id')::uuid;
  v_res := pg_temp.refusal_as(pg_temp.id('ta'), format('select public.reject_pending_team_membership(%L, %L)', v_mid, 'No room this season'));
  perform pg_temp.check(v_res = 'OK'
                        and (pg_temp.place(v_kid, pg_temp.id('u14'))).state = 'DECLINED'
                        and exists (select 1 from public.guardians g where g.player_id = v_kid and g.guardian_user_id = pg_temp.id('omar') and g.state = 'DECLINED'),
    'A13 a declined request declines the guardianship it would have confirmed');
  perform pg_temp.check(exists (select 1 from public.notifications n where n.user_id = pg_temp.id('omar') and n.type = 'add_child_declined'
                                  and n.body like 'Zed''s request to join Under 14 Boys was declined%'),
    'A14 and the parent is still told, by name and team');
end $$;

-- =====================================================================================================
-- V. THE CARD
-- =====================================================================================================
do $$
declare v jsonb; v_teddy jsonb; v_kim jsonb;
begin
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('coach'), format('select public.team_place_requests(%L)', pg_temp.id('u14'))) like '42501%'
                        and pg_temp.refusal_as(pg_temp.id('farca'), format('select public.team_place_requests(%L)', pg_temp.id('u14'))) like '42501%'
                        and pg_temp.refusal_as(pg_temp.id('sarah'), format('select public.team_place_requests(%L)', pg_temp.id('u14'))) like '42501%',
    'V1 the card is read by the approvers alone: not a coach, another club or a parent');
  v := pg_temp.json_as(pg_temp.id('ta'), format('select public.team_place_requests(%L)', pg_temp.id('u14')));
  select r into v_teddy from jsonb_array_elements(v -> 'requests') r where r ->> 'membership_id' = pg_temp.id('req_teddy')::text;
  perform pg_temp.check(v_teddy ->> 'fit' = 'FITS' and v_teddy ->> 'asked_by' = 'PARENT'
                        and v_teddy ->> 'requester_name' = 'Code Manager' and not (v_teddy ->> 'decided_by_others')::boolean
                        and v_teddy -> 'admits_members' = '[]'::jsonb,
    'V2 it says the child fits, a parent asked, who, and admits nobody new (the parent already belongs)');
  v := pg_temp.json_as(pg_temp.id('tm'), format('select public.team_place_requests(%L)', pg_temp.id('u14')));
  select r into v_teddy from jsonb_array_elements(v -> 'requests') r where r ->> 'membership_id' = pg_temp.id('req_teddy')::text;
  perform pg_temp.check((v_teddy ->> 'decided_by_others')::boolean,
    'V3 and tells the Team Manager this one is for another approver');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.team_place_requests(%L)', pg_temp.id('m1')));
  select r into v_kim from jsonb_array_elements(v -> 'requests') r where r ->> 'membership_id' = pg_temp.id('req_kim')::text;
  perform pg_temp.check(v_kim ->> 'asked_by' = 'OWN_ACCOUNT' and v_kim -> 'admits_members' = '["Code Kim"]'::jsonb,
    'V4 an adult''s own request says approving makes them a Member');
  perform pg_temp.check(v -> 'team' ->> 'label' = 'Men''s 1st Team' and (v -> 'team' ->> 'adult_side')::boolean and v -> 'team' ->> 'gender' = 'mens',
    'V5 the card carries its team''s own words: the name, an adult side, a men''s side');
end $$;

rollback;
