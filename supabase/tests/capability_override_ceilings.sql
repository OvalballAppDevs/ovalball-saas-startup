-- EXPLICIT ALLOWS AND WITHHOLDS: LEVELS AND CEILINGS (Identity/Auth Slice 3, Phase 2 K.3, S, V, AH R19, AC).
--
--   OC1-OC4   a Club Admin allows and withholds delegable club keys (a withhold needs a reason); never a
--             non-delegable or safeguarding-sensitive key
--   OC5-OC8   Team Administration decides at TEAM level on its own team only, never above its own ceiling
--             (a key it does not hold), never over a Club decision; the Club replaces a Team decision
--   OC9-OC14  refused: self, a minor for a minor-prohibited key, a non-member, a forged scope, a Volunteer
--             given people or finance authority, an expiry in the past; an expiry honoured when reached
--   OC15      a legacy key is recorded under its canonical key
--   OC16      Club Permissions provenance: source, rule, level, editability; only people.capability.manage
--   OC17-OC18 levels for Site Admins: SITE only with site.capabilities.override; a Site Admin who is also
--             Club Admin decides their club as the club, and reaches SITE only where it is needed
--   OC19      the actor is the session: no caller-supplied actor, grantor or level; events attributed
--   OC20      R19 in sequence: SITE after CLUB replaces it, CLUB after SITE is refused; one active decision
--   OC21      revocation records its level and reason and is idempotent
--
-- Concurrent R19 is js/capability_override_races.test.mts. Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ptt-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Ptt', p_label, 'ptt-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PTT ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ptt-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ptt-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'ptt-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true) returning id into v;
  return v;
end $$;

-- A legacy membership row; the Slice 2 triggers create the canonical membership state and role.
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text) returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership, p_team, p_permission);
end $$;

create or replace function pg_temp.override(p_user uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_effect text, p_level text,
                                            p_by uuid, p_expires timestamptz default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, expires_at, reason)
  values (p_user, p_key, p_scope, p_club, p_team, p_effect, 'active', p_by, p_level, p_expires, 'truth table')
  returning id into v;
  return v;
end $$;

-- The decision for a subject, evaluated as that subject's own request (rule 0 applies).
create or replace function pg_temp.decide(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns table (allowed boolean, decisive_rule text, reason_code text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  return query select d.allowed, d.decisive_rule, d.reason_code
    from internal.capability_decision(p_subject, p_key, p_scope, p_club, p_team, p_player, true, false) d;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- What internal.can says for the same question, run as the browser role.
create or replace function pg_temp.can_as(p_subject uuid, p_key text, p_scope text, p_club uuid default null, p_team uuid default null,
                                          p_player uuid default null, p_claims jsonb default null)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('sub', p_subject, 'role', 'authenticated'))::text, true);
  perform set_config('role', 'authenticated', true);
  v := internal.can(p_key, p_scope, p_club, p_team, p_player);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- Runs one statement as a signed-in person (the browser role) and returns OK or the SQLSTATE.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_subject, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

-- Evaluates a boolean expression as a signed-in person.
create or replace function pg_temp.bool_as(p_subject uuid, p_expr text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select (' || p_expr || ')::boolean' into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v, false);
end $$;

grant execute on function pg_temp.can_as(uuid, text, text, uuid, uuid, uuid, jsonb) to public;

do $body$
declare
  k constant text := 'fixture.fixture.edit';
  v_club uuid; v_club_b uuid; v_team uuid; v_team2 uuid; v_team_b uuid;
  v_ca uuid; v_full uuid; v_data uuid; v_member uuid; v_member_ms uuid; v_coach uuid; v_coach_ms uuid; v_ta uuid; v_ta_ms uuid;
  v_vol uuid; v_minor uuid; v_outsider uuid; v_sa_ca uuid;
  v_state text; v_id uuid; v_id2 uuid; v_n int; r record; v_bool boolean;
begin
  v_club := pg_temp.club('Ceil'); v_club_b := pg_temp.club('Ceil B');
  v_team := pg_temp.team(v_club); v_team2 := pg_temp.team(v_club, 'U14'); v_team_b := pg_temp.team(v_club_b);
  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_full := pg_temp.person('Full'); insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');
  v_data := pg_temp.person('Data'); insert into public.site_admins (user_id, status, admin_role) values (v_data, 'active', 'club_data');
  v_member := pg_temp.person('Member'); v_member_ms := pg_temp.member(v_club, v_member);
  v_coach := pg_temp.person('Coach'); v_coach_ms := pg_temp.member(v_club, v_coach); perform pg_temp.team_role(v_coach_ms, v_team, 'coach');
  -- Team Administration resting on Coach (not Team Manager), so its ceiling is the Coach bundle
  v_ta := pg_temp.person('Coach TA'); v_ta_ms := pg_temp.member(v_club, v_ta); perform pg_temp.team_role(v_ta_ms, v_team, 'coach');
  perform pg_temp.try_as(v_ca, format('select public.assign_role(%L, ''TEAM_ADMINISTRATION'', %L, null)', v_ta_ms, v_team));
  v_vol := pg_temp.person('Volunteer'); perform pg_temp.member(v_club, v_vol);
  perform pg_temp.try_as(v_ca, format('select public.assign_role((select id from public.club_memberships where user_id = %L and club_id = %L), ''VOLUNTEER'', null, null)', v_vol, v_club));
  v_minor := pg_temp.person('Minor'); perform pg_temp.member(v_club, v_minor);
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Oc', 'Minor', (current_date - interval '14 years')::date, 'MALE', v_minor);
  v_outsider := pg_temp.person('Outsider');

  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_ta_ms and role_key = 'TEAM_ADMINISTRATION' and state = 'ACTIVE')
                        and exists (select 1 from public.role_assignments where user_id = v_vol and role_key = 'VOLUNTEER' and state = 'ACTIVE'),
    'OC0: fixtures seeded (Team Administration on a Coach, a Volunteer)');

  -- OC1-OC4
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''grant'', null)', v_member, k, v_club));
  select * into r from public.capability_overrides where user_id = v_member and capability_key = k and status = 'active';
  perform pg_temp.check(v_state = 'OK' and r.granted_level = 'CLUB' and r.granted_by = v_ca and pg_temp.can_as(v_member, k, 'club', v_club)
                        and exists (select 1 from public.security_events e where e.event_type = 'override.granted' and e.subject_user_id = v_member
                                    and e.actor_user_id = v_ca and e.metadata ->> 'override_id' = r.id::text and e.club_id = v_club),
    'OC1: a Club Admin allows a delegable key, recorded at CLUB level with a session-attributed event (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''club.profile.edit'', ''club'', %L, null, ''deny'', null)', v_member, v_club));
  perform pg_temp.check(v_state = '22023', 'OC2a: a club withhold needs a reason (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''club.profile.view'', ''club'', %L, null, ''deny'', ''not needed'')', v_coach, v_club));
  perform pg_temp.check(v_state in ('OK', '42501'), 'OC2b: (club.profile.view is not delegable, so a club cannot withhold it either) (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''calendar.event.manage'', ''club'', %L, null, ''deny'', ''reason given'')', v_member, v_club));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.can_as(v_member, 'calendar.event.manage', 'club', v_club), 'OC2c: with a reason the withhold is recorded and effective (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''people.role.assign_club'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = '42501', 'OC3: a non-delegable key cannot be given by the club (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''family.relationship.approve'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = '42501', 'OC4: nor a safeguarding-sensitive key (' || v_state || ')');

  -- OC5-OC8: Team Administration
  v_state := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''training.communication.send'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team));
  perform pg_temp.check(v_state = 'OK' and (select granted_level from public.capability_overrides where user_id = v_member and capability_key = 'training.communication.send' and status = 'active') = 'TEAM'
                        and pg_temp.can_as(v_member, 'training.communication.send', 'team', v_club, v_team)
                        and not pg_temp.can_as(v_member, 'training.communication.send', 'team', v_club, v_team2),
    'OC5: Team Administration allows a team key on its own team, at TEAM level, for that team only (' || v_state || ')');
  v_state := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''training.communication.send'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team2));
  perform pg_temp.check(v_state = '42501', 'OC6a: not on another team (' || v_state || ')');
  v_state := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''training.communication.send'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = '42501', 'OC6b: not club-wide (' || v_state || ')');
  v_state := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''fixture.request.respond'', ''team'', %L, %L, ''grant'', null)', v_member, v_club, v_team));
  perform pg_temp.check(v_state = '42501', 'OC6c: not a key above its own ceiling (a Coach base does not respond to fixture requests) (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''training.session.cancel'', ''team'', %L, %L, ''deny'', ''club decision'')', v_coach, v_club, v_team));
  select id into v_id from public.capability_overrides where user_id = v_coach and capability_key = 'training.session.cancel' and status = 'active';
  v_state := pg_temp.try_as(v_ta, format('select public.set_capability_override(%L, ''training.session.cancel'', ''team'', %L, %L, ''grant'', null)', v_coach, v_club, v_team));
  perform pg_temp.check(v_state = '42501' and exists (select 1 from public.capability_overrides where id = v_id and status = 'active'),
    'OC7a: Team Administration cannot overwrite a Club decision (' || v_state || ')');
  v_state := pg_temp.try_as(v_ta, format('select public.revoke_capability_override(%L, null)', v_id));
  perform pg_temp.check(v_state = '42501', 'OC7b: nor remove it (' || v_state || ')');
  select id into v_id2 from public.capability_overrides where user_id = v_member and capability_key = 'training.communication.send' and status = 'active';
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''training.communication.send'', ''team'', %L, %L, ''deny'', ''the club decides'')', v_member, v_club, v_team));
  perform pg_temp.check(v_state = 'OK'
      and (select status from public.capability_overrides where id = v_id2) = 'revoked'
      and (select revoked_level from public.capability_overrides where id = v_id2) = 'CLUB'
      and exists (select 1 from public.security_events where event_type = 'override.revoked' and metadata ->> 'override_id' = v_id2::text and actor_user_id = v_ca),
    'OC8: the Club replaces a Team decision, and the replaced decision is revoked with an event (' || v_state || ')');

  -- OC9-OC14
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''deny'', ''self'')', v_ca, k, v_club));
  perform pg_temp.check(v_state = '42501', 'OC9: nobody decides their own permissions (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''grant'', null)', v_minor, k, v_club));
  perform pg_temp.check(v_state = '23514', 'OC10a: a minor-prohibited key is never given to a minor (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''deny'', ''safety'')', v_minor, k, v_club));
  perform pg_temp.check(v_state = 'OK', 'OC10b: though it can be withheld (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''grant'', null)', v_outsider, k, v_club));
  perform pg_temp.check(v_state = '23514', 'OC11: a decision adjusts real membership; it never creates one (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, %L, ''team'', %L, %L, ''grant'', null)', v_member, k, v_club, v_team_b));
  perform pg_temp.check(v_state = '42501', 'OC12: a forged scope (another club''s team named under this club) is refused (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''finance.subscription.view'', ''club'', %L, null, ''grant'', null)', v_vol, v_club));
  perform pg_temp.check(v_state = '23514', 'OC13a: a Volunteer is not given finance authority by the club (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''venue.pitch_allocation.manage'', ''club'', %L, null, ''grant'', null)', v_vol, v_club));
  perform pg_temp.check(v_state = 'OK' and pg_temp.can_as(v_vol, 'venue.pitch_allocation.manage', 'club', v_club),
    'OC13b: the Volunteer - Pitch Allocation addition is allowed (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''venue.venue.manage'', ''club'', %L, null, ''grant'', null, now() - interval ''1 day'')', v_member, v_club));
  perform pg_temp.check(v_state = '22023', 'OC14a: an expiry in the past is refused (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''venue.venue.manage'', ''club'', %L, null, ''grant'', null, now() + interval ''1 hour'')', v_member, v_club));
  perform pg_temp.check(v_state = 'OK' and pg_temp.can_as(v_member, 'venue.venue.manage', 'club', v_club), 'OC14b: a future expiry is honoured until reached (' || v_state || ')');
  update public.capability_overrides set expires_at = now() - interval '1 second' where user_id = v_member and capability_key = 'venue.venue.manage' and status = 'active';
  perform pg_temp.check(not pg_temp.can_as(v_member, 'venue.venue.manage', 'club', v_club), 'OC14c: and ends when it is reached');

  -- OC15
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''fixture.cancel'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = 'OK' and exists (select 1 from public.capability_overrides where user_id = v_member and capability_key = 'fixture.fixture.cancel' and status = 'active')
                        and not exists (select 1 from public.capability_overrides where capability_key = 'fixture.cancel'),
    'OC15: a legacy key is recorded under its canonical key (' || v_state || ')');

  -- OC16
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  create temp table cmc on commit drop as select * from public.club_member_capabilities(v_club, array['fixture.fixture.edit', 'fixture.fixture.view', 'club.edit_profile']);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(
    (select source from cmc where user_id = v_member and capability_key = k) = 'granted'
    and (select override_level from cmc where user_id = v_member and capability_key = k) = 'CLUB'
    and (select editable from cmc where user_id = v_member and capability_key = k)
    and (select source from cmc where user_id = v_coach and capability_key = 'fixture.fixture.view') = 'role'
    and not exists (select 1 from cmc where capability_key not in ('fixture.fixture.edit', 'fixture.fixture.view', 'club.profile.edit'))
    and not (select editable from cmc where user_id = v_ca limit 1),
    'OC16a: Club Permissions shows source, level and editability for exactly the requested keys (legacy names accepted)');
  v_state := pg_temp.try_as(v_member, format('select * from public.club_member_capabilities(%L)', v_club));
  perform pg_temp.check(v_state = '42501', 'OC16b: only people.capability.manage (or site.users.view) reads it (' || v_state || ')');

  -- OC17-OC18
  v_state := pg_temp.try_as(v_data, format('select public.set_capability_override(%L, %L, ''club'', %L, null, ''deny'', ''no'')', v_member, 'club.logo.manage', v_club));
  perform pg_temp.check(v_state = '42501', 'OC18a: a non-Full Site Admin cannot decide permissions (' || v_state || ')');
  v_state := pg_temp.try_as(v_full, format('select public.set_capability_override(%L, ''club.logo.manage'', ''club'', %L, null, ''deny'', ''Ovalball decision'')', v_member, v_club));
  perform pg_temp.check(v_state = 'OK' and (select granted_level from public.capability_overrides where user_id = v_member and capability_key = 'club.logo.manage' and status = 'active') = 'SITE',
    'OC18b: a Full Site Admin decides at SITE level anywhere (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''club.logo.manage'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = '42501', 'OC18c: and the club cannot overturn it (' || v_state || ')');
  v_sa_ca := pg_temp.person('Site Admin and Club Admin');
  insert into public.site_admins (user_id, status, admin_role) values (v_sa_ca, 'active', 'full');
  perform pg_temp.member(v_club, v_sa_ca, 'CLUB_ADMIN');
  v_state := pg_temp.try_as(v_sa_ca, format('select public.set_capability_override(%L, ''club.referrals.view'', ''club'', %L, null, ''grant'', null)', v_coach, v_club));
  perform pg_temp.check(v_state = 'OK' and (select granted_level from public.capability_overrides where user_id = v_coach and capability_key = 'club.referrals.view' and status = 'active') = 'CLUB',
    'OC17a: a Site Admin who is also this club''s admin decides their club as the club (' || v_state || ')');
  v_state := pg_temp.try_as(v_sa_ca, format('select public.set_capability_override(%L, ''club.logo.manage'', ''club'', %L, null, ''grant'', null)', v_member, v_club));
  perform pg_temp.check(v_state = 'OK' and (select granted_level from public.capability_overrides where user_id = v_member and capability_key = 'club.logo.manage' and status = 'active') = 'SITE',
    'OC17b: and reaches SITE level only where the existing decision needs it (' || v_state || ')');

  -- OC19
  perform pg_temp.check(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proargnames, '{}'), coalesce(p.proargmodes::text[], array_fill('i'::text, array[cardinality(coalesce(p.proargnames, '{}'))]))) as a (name, mode)
      where n.nspname = 'public' and p.proname in ('set_capability_override', 'revoke_capability_override', 'club_member_capabilities', 'explain_access', 'my_capabilities')
        and a.mode in ('i', 'b') and a.name ~* '(actor|granted_by|performed_by|level|subject_as|as_user)'),
    'OC19: no caller-supplied actor, grantor or level parameter on any decision entry point');

  -- OC20: R19 in sequence
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''club.documents.manage'', ''club'', %L, null, ''grant'', null)', v_coach, v_club));
  v_state := v_state || '/' || pg_temp.try_as(v_full, format('select public.set_capability_override(%L, ''club.documents.manage'', ''club'', %L, null, ''deny'', ''Ovalball'')', v_coach, v_club));
  perform pg_temp.check(v_state = 'OK/OK' and (select count(*) from public.capability_overrides where user_id = v_coach and capability_key = 'club.documents.manage' and status = 'active') = 1
                        and (select granted_level from public.capability_overrides where user_id = v_coach and capability_key = 'club.documents.manage' and status = 'active') = 'SITE',
    'OC20a: SITE after CLUB replaces it, leaving one active decision (' || v_state || ')');
  v_state := pg_temp.try_as(v_ca, format('select public.set_capability_override(%L, ''club.documents.manage'', ''club'', %L, null, ''grant'', null)', v_coach, v_club));
  perform pg_temp.check(v_state = '42501', 'OC20b: CLUB after SITE is refused (' || v_state || ')');
  begin
    insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, status, granted_by, granted_level)
    values (v_coach, 'club.documents.manage', 'club', v_club, 'grant', 'active', v_ca, 'CLUB');
    perform pg_temp.check(false, 'OC20c: two active decisions for one person, key and scope');
  exception when unique_violation then
    perform pg_temp.check(true, 'OC20c: the database keeps one active decision per person, key and scope');
  end;

  -- OC21
  select id into v_id from public.capability_overrides where user_id = v_member and capability_key = k and status = 'active';
  v_state := pg_temp.try_as(v_ca, format('select public.revoke_capability_override(%L, ''no longer needed'')', v_id));
  v_state := v_state || '/' || pg_temp.try_as(v_ca, format('select public.revoke_capability_override(%L, ''again'')', v_id));
  perform pg_temp.check(v_state = 'OK/OK' and (select revoked_level from public.capability_overrides where id = v_id) = 'CLUB'
                        and (select revocation_reason from public.capability_overrides where id = v_id) = 'no longer needed'
                        and not pg_temp.can_as(v_member, k, 'club', v_club)
                        and (select count(*) from public.security_events where event_type = 'override.revoked' and metadata ->> 'override_id' = v_id::text) = 1,
    'OC21: revocation records level and reason, ends authority, and a repeat is a no-op (' || v_state || ')');
end $body$;

rollback;
