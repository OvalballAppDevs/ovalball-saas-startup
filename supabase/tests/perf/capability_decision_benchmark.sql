-- CAPABILITY DECISION BENCHMARK (Identity/Auth Slice 3, Phase 2 K.5).
--
-- Gates: p95 under 2 ms per decision with 10,000 memberships; and a fixture list page (and, as the heaviest
-- capability consumer, an attendance register) adds under 15% against the pre-Slice 3 helper on the same data.
-- The pre-Slice 3 helper is reconstructed here from its last migrations (reading the archived role
-- defaults) and swapped in inside this transaction, so both are timed on identical rows.
--
-- Not part of run-platform-tests.sh (it seeds 10,000 people). Run with scripts/verify-capability-performance.sh.
-- Rolled back.

\set ON_ERROR_STOP on
\pset pager off
\timing off

begin;

set local client_min_messages = notice;

-- ---------------------------------------------------------------------------------------------
-- the pre-Slice 3 resolver, reconstructed (20260923000000, 20261020000000, 20270113000000, 20270230000000)
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.legacy_club_role(p_club_id uuid, p_key text) returns boolean language sql stable as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN')
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'club' and d.role_key = 'CLUB_ADMIN' and d.capability_key = p_key)
    when exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY')
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'club' and d.role_key = 'FIXTURE_SECRETARY' and d.capability_key = p_key)
    when exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false)
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'club' and d.role_key = 'CLUB_MEMBER' and d.capability_key = p_key)
    else false end;
$$;

create or replace function pg_temp.legacy_team_role(p_team_id uuid, p_club_id uuid, p_key text) returns boolean language sql stable as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN')
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'team' and d.role_key = 'CLUB_ADMIN' and d.capability_key = p_key)
    when exists (select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
                 where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and tp.permission in ('team_admin', 'manager'))
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'team' and d.role_key = 'TEAM_MANAGER' and d.capability_key = p_key)
    when exists (select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
                 where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and tp.permission = 'coach')
      then exists (select 1 from public.role_capability_defaults_legacy d where d.scope_type = 'team' and d.role_key = 'TEAM_STAFF' and d.capability_key = p_key)
    else false end;
$$;

create or replace function pg_temp.legacy_has_capability(p_key text, p_scope text, p_club uuid, p_team uuid) returns boolean language plpgsql stable as $$
declare v_team_club uuid; v_scopes text[];
begin
  if not internal.is_account_active(auth.uid()) then return false; end if;
  select applicable_scopes into v_scopes from public.capabilities where key = p_key;
  if v_scopes is null or not (p_scope = any (v_scopes)) then return false; end if;
  if p_scope = 'team' then
    if p_team is null or p_club is null then return false; end if;
    select club_id into v_team_club from public.teams where id = p_team;
    if v_team_club is null or v_team_club <> p_club then return false; end if;
  elsif p_scope = 'club' then
    if p_club is null or p_team is not null then return false; end if;
  end if;
  if exists (select 1 from public.capability_overrides co where co.user_id = auth.uid() and co.capability_key = p_key and co.status = 'active'
             and co.effect = 'deny' and co.scope_type = p_scope and co.club_id is not distinct from p_club and co.team_id is not distinct from p_team) then
    return false;
  end if;
  if exists (select 1 from public.capability_overrides co where co.user_id = auth.uid() and co.capability_key = p_key and co.status = 'active'
             and co.effect = 'grant' and co.scope_type = p_scope and co.club_id is not distinct from p_club and co.team_id is not distinct from p_team) then
    return true;
  end if;
  if p_scope = 'club' then return pg_temp.legacy_club_role(p_club, p_key); end if;
  return pg_temp.legacy_team_role(p_team, p_club, p_key);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10,000 memberships across 50 clubs, 4 teams each; staff and players on every team
-- ---------------------------------------------------------------------------------------------
create temp table bench_people (n int primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into bench_people (n) select g from generate_series(1, 10000) g;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bench-' || n || '@ovalball.test', '',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
from bench_people;
insert into public.profiles (id, first_name, surname, email) select id, 'Bench', 'Person ' || n, 'bench-' || n || '@ovalball.test' from bench_people
on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname;

create temp table bench_clubs (n int primary key, dir uuid, club uuid) on commit drop;
insert into bench_clubs (n) select g from generate_series(1, 50) g;
with d as (
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  select 'Bench RUFC ' || n, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'bench-' || n from bench_clubs
  returning id, normalized_key)
update bench_clubs b set dir = d.id from d where d.normalized_key = 'bench-' || b.n;
with c as (insert into public.clubs (directory_id, slug, status) select dir, 'bench-' || n, 'active' from bench_clubs returning id, slug)
update bench_clubs b set club = c.id from c where c.slug = 'bench-' || b.n;

create temp table bench_teams on commit drop as
select b.n as club_n, b.club, t.age, gen_random_uuid() as id from bench_clubs b cross join (values ('U13'), ('U12'), ('U14'), ('U16')) t (age);
insert into public.teams (id, club_id, display_name, slug, category, age_group, gender, rugby_code, active)
select id, club, 'Under ' || substr(age, 2) || ' Boys', 'bench-' || club_n || '-' || lower(age), 'youth', age, 'boys', 'union', true from bench_teams;

-- person n belongs to club ((n-1) % 50) + 1; persons 1-50 are each club's Club Admin, 51-100 its Fixtures Secretary
insert into public.club_memberships (club_id, user_id, role, status)
select c.club, p.id, case when p.n <= 50 then 'CLUB_ADMIN' when p.n <= 100 then 'FIXTURE_SECRETARY' else 'BASIC_USER' end, 'active'
from bench_people p join bench_clubs c on c.n = ((p.n - 1) % 50) + 1;

-- every 20th person coaches (or manages) a team at their club
insert into public.team_permissions (membership_id, team_id, permission)
select cm.id, t.id, case when p.n % 40 = 3 then 'manager' else 'coach' end
from bench_people p
join bench_clubs c on c.n = ((p.n - 1) % 50) + 1
join public.club_memberships cm on cm.user_id = p.id and cm.club_id = c.club
join bench_teams t on t.club = c.club and t.age = (array['U13', 'U12', 'U14', 'U16'])[1 + (p.n % 4)]
where p.n % 20 = 3;

analyze public.role_assignments; analyze public.club_memberships; analyze public.capability_overrides; analyze public.bundle_capabilities;

select 'seeded' as step, (select count(*) from public.club_memberships cm join bench_clubs b on b.club = cm.club_id) as memberships,
       (select count(*) from public.role_assignments ra join bench_clubs b on b.club = ra.club_id) as role_assignments;

-- ---------------------------------------------------------------------------------------------
-- 2,000 questions: random person, random key (legacy keys the app and policies actually ask), club or team scope
-- ---------------------------------------------------------------------------------------------
create temp table bench_questions on commit drop as
select q, p.id as subject, c.club, t.id as team,
  (array['club.profile.edit', 'fixture.edit', 'fixture.view', 'club.view', 'team.attendance.view', 'club.training.manage',
         'manage_fixture_callups', 'team.roster.manage', 'finance.subscription.view', 'fixture.create'])[1 + (q % 10)] as key,
  case when q % 3 = 0 then 'team' else 'club' end as scope
from generate_series(1, 2000) q
join bench_people p on p.n = 1 + ((q * 7919) % 10000)
join bench_clubs c on c.n = ((p.n - 1) % 50) + 1
join bench_teams t on t.club = c.club and t.age = (array['U13', 'U12', 'U14', 'U16'])[1 + (q % 4)];

create temp table bench_timings (impl text, q int, ms double precision, result boolean) on commit drop;

do $bench$
declare r record; t0 timestamptz; v boolean; i int;
begin
  for i in 1..2 loop  -- pass 1 warms caches; pass 2 is recorded
    for r in select * from bench_questions order by q loop
      perform set_config('request.jwt.claims', jsonb_build_object('sub', r.subject, 'role', 'authenticated')::text, true);
      t0 := clock_timestamp();
      v := (internal.capability_decision(r.subject,
             coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = r.key and m.legacy_scope = r.scope), r.key),
             r.scope, r.club, case when r.scope = 'team' then r.team end, null, true, false)).allowed;
      if i = 2 then insert into bench_timings values ('capability_decision', r.q, extract(epoch from clock_timestamp() - t0) * 1000, v); end if;
      t0 := clock_timestamp();
      v := internal.has_capability(r.key, r.scope, r.club, case when r.scope = 'team' then r.team end);
      if i = 2 then insert into bench_timings values ('has_capability (Slice 3)', r.q, extract(epoch from clock_timestamp() - t0) * 1000, v); end if;
      t0 := clock_timestamp();
      v := pg_temp.legacy_has_capability(r.key, r.scope, r.club, case when r.scope = 'team' then r.team end);
      if i = 2 then insert into bench_timings values ('has_capability (pre-Slice 3)', r.q, extract(epoch from clock_timestamp() - t0) * 1000, v); end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $bench$;

select impl, count(*) as decisions,
       round(percentile_cont(0.50) within group (order by ms)::numeric, 3) as p50_ms,
       round(percentile_cont(0.95) within group (order by ms)::numeric, 3) as p95_ms,
       round(percentile_cont(0.99) within group (order by ms)::numeric, 3) as p99_ms,
       round(avg(ms)::numeric, 3) as mean_ms
from bench_timings group by impl order by impl;

select case when p95 < 2 then 'PASS' else 'FAIL' end || ' K.5 gate: capability_decision p95 ' || round(p95::numeric, 3) || ' ms (< 2 ms) with 10,000 memberships' as gate
from (select percentile_cont(0.95) within group (order by ms) as p95 from bench_timings where impl = 'capability_decision') x;

select 'INFO has_capability mean over the resolver vs the pre-Slice 3 helper: ' || round(n.m::numeric, 3) || ' ms vs ' || round(o.m::numeric, 3)
       || ' ms (' || round(((n.m / nullif(o.m, 0)) - 1) * 100) || '%)' as comparison
from (select avg(ms) m from bench_timings where impl = 'has_capability (Slice 3)') n,
     (select avg(ms) m from bench_timings where impl = 'has_capability (pre-Slice 3)') o;

-- ---------------------------------------------------------------------------------------------
-- page level: one club's fixture list and attendance register, as its coach and as its Club Admin
-- ---------------------------------------------------------------------------------------------
create temp table bench_page on commit drop as
select b.club, t.id as team,
  (select cm.user_id from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id where tp.team_id = t.id and tp.permission = 'coach' limit 1) as coach,
  (select cm.user_id from public.club_memberships cm where cm.club_id = b.club and cm.role = 'CLUB_ADMIN' limit 1) as admin
from bench_clubs b join bench_teams t on t.club = b.club
where exists (select 1 from public.team_permissions tp where tp.team_id = t.id and tp.permission = 'coach')
  and exists (select 1 from public.club_memberships cm where cm.club_id = b.club and cm.role = 'CLUB_ADMIN')
order by b.n
limit 1;

do $seed$
declare r record; v_fixture uuid; v_player uuid; i int; j int;
begin
  select * into r from bench_page;
  for j in 1..25 loop
    insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Bench', 'Player ' || j, (current_date - interval '11 years 6 months')::date, 'MALE') returning id into v_player;
    insert into public.player_team_memberships (player_id, team_id, status) values (v_player, r.team, 'active');
  end loop;
  for i in 1..40 loop
    insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
    values (r.team, 'Home', 'Bench Opponent ' || i, current_date + i, '10:30', 'Booked', 'club_created') returning id into v_fixture;
    insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
    select v_fixture, ptm.player_id, 'ATTENDING', r.coach, 'staff' from public.player_team_memberships ptm where ptm.team_id = r.team and ptm.state = 'ACTIVE';
  end loop;
end $seed$;
analyze public.fixtures; analyze public.player_fixture_attendance;

create temp table bench_page_timings (impl text, who text, page text, run int, ms double precision, rows bigint) on commit drop;

create or replace function pg_temp.time_pages(p_impl text) returns void language plpgsql as $f$
declare r record; t0 timestamptz; n1 bigint; n2 bigint; ms1 double precision; ms2 double precision; i int; who record;
begin
  select * into r from bench_page;
  for who in select * from (values ('coach', r.coach), ('club admin', r.admin)) w (label, uid) loop
    for i in 1..25 loop
      perform set_config('request.jwt.claims', jsonb_build_object('sub', who.uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      t0 := clock_timestamp();
      select count(*) into n1 from public.fixtures f where f.owning_team_id in (select id from public.teams where club_id = r.club);
      ms1 := extract(epoch from clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      select count(*) into n2 from public.player_fixture_attendance a where a.fixture_id in (select f.id from public.fixtures f where f.owning_team_id = r.team);
      ms2 := extract(epoch from clock_timestamp() - t0) * 1000;
      perform set_config('role', 'none', true);
      perform set_config('request.jwt.claims', '', true);
      if i > 5 then
        insert into bench_page_timings values (p_impl, who.label, 'fixture list', i, ms1, n1), (p_impl, who.label, 'attendance register', i, ms2, n2);
      end if;
    end loop;
  end loop;
end $f$;

select pg_temp.time_pages('Slice 3');
create or replace function internal.has_capability(p_capability_key text, p_scope_type text, p_club_id uuid default null, p_team_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $f$
  select pg_temp.legacy_has_capability(p_capability_key, p_scope_type, p_club_id, p_team_id)
$f$;
select pg_temp.time_pages('pre-Slice 3');

select page, who, max(rows) as rows,
       round((percentile_cont(0.5) within group (order by ms) filter (where impl = 'pre-Slice 3'))::numeric, 2) as legacy_p50_ms,
       round((percentile_cont(0.5) within group (order by ms) filter (where impl = 'Slice 3'))::numeric, 2) as slice3_p50_ms,
       round((((percentile_cont(0.5) within group (order by ms) filter (where impl = 'Slice 3'))
         / nullif(percentile_cont(0.5) within group (order by ms) filter (where impl = 'pre-Slice 3'), 0)) - 1) * 100)::numeric as change_pct
from bench_page_timings group by page, who order by page, who;

select case when coalesce(max(pct), 0) < 15 then 'PASS' else 'FAIL' end || ' K.5 gate: the fixture list page adds ' || round(coalesce(max(pct), 0)::numeric, 1) || '% (< 15%)' as gate
from (select ((percentile_cont(0.5) within group (order by ms) filter (where impl = 'Slice 3'))
         / nullif(percentile_cont(0.5) within group (order by ms) filter (where impl = 'pre-Slice 3'), 0) - 1) * 100 as pct
      from bench_page_timings where page = 'fixture list' group by who) x;

rollback;
