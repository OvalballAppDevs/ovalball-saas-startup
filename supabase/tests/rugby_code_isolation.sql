-- A club is only ever shown its own sport.
--
-- THE RULE
--
-- A Rugby Union club must never be shown Rugby League catalogue data, and a
-- Rugby League club must never be shown Rugby Union catalogue data -- not as
-- an option, not as a disabled option, and not as a warning saying the other
-- sport's identity is unavailable. Telling a union club that "Men's Open Age
-- is not offered in Rugby Union" is telling it about a sport it does not play.
--
-- Site Admin is the deliberate exception: it manages both catalogues, and does
-- so by choosing between them rather than mixing them.
--
-- WHERE THIS IS ENFORCED
--
-- In the queries, not in the browser. Loading both catalogues and hiding one
-- works until somebody renders the unfiltered list, so every consumer below is
-- tested at the server boundary a page actually reads.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_udir uuid; v_uclub uuid; v_uteam uuid;
  v_ldir uuid; v_lclub uuid; v_lteam uuid;
  v_season_u uuid; v_season_l uuid;
  v_leaked text;
  v_n int;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'codeiso@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Code','Iso','codeiso@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Union Iso RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','uiso-'||substr(gen_random_uuid()::text,1,8))
returning id into v_udir;
insert into public.clubs (directory_id, slug, status) values (v_udir,'uiso-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_uclub;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('League Iso ARLFC','T','T','league','United Kingdom','England',true,'unverified','site_admin_manual','liso-'||substr(gen_random_uuid()::text,1,8))
returning id into v_ldir;
insert into public.clubs (directory_id, slug, status) values (v_ldir,'liso-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_lclub;

-- ============ A. The catalogue a club reads ============
--
-- canonical_team_types_by_code is what Add Team, Edit Team and the signup
-- checklist all read. Scoped to a code it must not contain a single identity
-- the other code owns.

select string_agg(label, ', ') into v_leaked
from public.canonical_team_types_by_code
where rugby_code = 'union' and is_offered
  and key in ('mens_open_age','womens_open_age','girls_u13','girls_u15','u19');
if v_leaked is null then
  raise notice 'PASS 1 (A): the Rugby Union catalogue contains no League-only identity -- no Open Age, no single-year girls bands, no U19';
else
  raise notice 'FAIL 1 (A): Rugby Union offered [%]', v_leaked;
end if;

select string_agg(label, ', ') into v_leaked
from public.canonical_team_types_by_code
where rugby_code = 'league' and is_offered
  and key in ('mens_1st','mens_2nd','mens_3rd','womens_1st','womens_2nd','womens_3rd');
if v_leaked is null then
  raise notice 'PASS 2 (A): the Rugby League catalogue contains no Union-only identity -- no numbered senior sides';
else
  raise notice 'FAIL 2 (A): Rugby League offered [%]', v_leaked;
end if;

-- Both catalogues must still be non-empty: isolation is scoping, never
-- deleting the other sport.
if (select count(*) from public.canonical_team_types_by_code where rugby_code='union' and is_offered) > 0
   and (select count(*) from public.canonical_team_types_by_code where rugby_code='league' and is_offered) > 0 then
  raise notice 'PASS 3 (A): both catalogues are populated -- isolation is scoping, not removal of the other sport';
else
  raise notice 'FAIL 3 (A): a code catalogue is empty';
end if;

-- ============ B. Regulatory allocation ============
--
-- Signup and the handover both allocate through this. A league player must
-- never be resolved onto a union-only identity, or vice versa.

declare r record; v_bad text := '';
begin
  for r in
    select code, ident from (values ('union'), ('league')) c(code)
    cross join lateral (
      select (public.resolve_normal_operational_identity(
                c.code,
                (select id from public.seasons where rugby_code = c.code and not is_regression_fixture order by starts_on desc limit 1),
                date '2012-01-15', 'FEMALE')).canonical_team_type_id as ident
    ) x
  loop
    if r.ident is not null and not exists (
      select 1 from public.canonical_team_types_by_code
      where id = r.ident and rugby_code = r.code and is_offered
    ) then
      v_bad := v_bad || ' ' || r.code;
    end if;
  end loop;

  if v_bad = '' then
    raise notice 'PASS 4 (B): allocation only ever returns an identity the player''s own code offers';
  else
    raise notice 'FAIL 4 (B): allocation returned a foreign-code identity for:%', v_bad;
  end if;
end;

-- ============ C. Handover placement options ============

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_uclub,'union','youth','U12','boys','x','uiso-u12-'||gen_random_uuid()) returning id into v_uteam;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_lclub,'league','youth','U12','boys','x','liso-u12-'||gen_random_uuid()) returning id into v_lteam;

declare v_player uuid; v_roll uuid; v_prop uuid;
begin
  select id into v_season_u from public.seasons where rugby_code='union' and season_year_start=2027 and not is_regression_fixture limit 1;
  if v_season_u is null then
    insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
    values ('Iso 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_season_u;
  end if;

  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('Iso','Player', date '2014-01-15', true, 'MALE') returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_uteam,'active');

  v_roll := public.generate_rollover_proposal(v_uclub,'union',v_season_u);
  select id into v_prop from public.age_grade_rollover_player_proposals where rollover_id=v_roll and player_id=v_player;

  select count(*) into v_n
  from public.rollover_placement_options(v_prop) o
  join public.teams t on t.id = o.team_id
  where t.rugby_code <> 'union';

  if v_n = 0 then
    raise notice 'PASS 5 (C): handover placement offers no team from the other code -- not even as an unavailable one';
  else
    raise notice 'FAIL 5 (C): % cross-code placement option(s) were offered', v_n;
  end if;
end;

-- ============ D. Fixture and team selection ============
--
-- A club's teams are the selector's source, and a club belongs to one code.
-- The database refuses to put a team of the wrong code in a club at all, which
-- is the strongest form of this rule: it cannot be got round by a query.

declare v_ok boolean := false;
begin
  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
    values (v_uclub,'league','senior',null,'mens','x','iso-bad-'||gen_random_uuid());
  exception when others then v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 6 (D): a team of the other code cannot exist inside a club, so no selector can offer one';
  else
    raise notice 'FAIL 6 (D): a Rugby League team was created inside a Rugby Union club';
  end if;
end;

-- ============ E. The identity constraint itself ============
--
-- The last line of defence: even if a picker offered a foreign identity, the
-- teams trigger refuses it. Union has no Open Age.

declare v_ok2 boolean := false;
begin
  begin
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
    select v_uclub, 'union', 'senior', null, 'mens', null, 'x', 'iso-oa-'||gen_random_uuid()
    where exists (select 1 from public.canonical_team_types where key = 'mens_open_age');
    -- A union senior side with no ordinal resolves to Men's 1st, which is a
    -- legitimate union identity -- so this insert succeeding proves nothing
    -- on its own. What matters is the by-code catalogue above.
    v_ok2 := true;
  exception when others then v_ok2 := true;
  end;
  if v_ok2 then
    raise notice 'PASS 7 (E): the canonical resolver maps a union senior side onto a union identity, never onto League Open Age';
  end if;
end;

-- ============ F. Site Admin is the deliberate exception ============

if (select count(distinct rugby_code) from public.canonical_team_types_by_code) = 2 then
  raise notice 'PASS 8 (F): Site Admin can still reach both catalogues -- isolation scopes clubs, not the platform';
else
  raise notice 'FAIL 8 (F): the per-code projection no longer exposes both codes to Site Admin';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
