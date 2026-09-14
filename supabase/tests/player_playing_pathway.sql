-- A player's regulatory playing pathway, and where it does and does not decide.
--
-- The defect this closes: a Union U11 child was told "Union rugby offers no
-- operational team at that age grade" because the resolver was handed 'boys' --
-- a value that came from their TEAM, whose gender was NULL and which
-- defaulted. A silent default about a child's sex, used to allocate them.
--
-- The rule now: below the point where the pathways separate, the canonical
-- identity is Mixed and the pathway is never consulted; at and beyond it, a
-- missing pathway fails closed rather than guessing in either direction.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_union uuid; v_league uuid;
  v_status text; v_key text; v_label text; v_reason text;
begin

select id into v_union from public.seasons where rugby_code='union' and not is_regression_fixture order by starts_on limit 1;
select id into v_league from public.seasons where rugby_code='league' and not is_regression_fixture order by starts_on limit 1;

-- ============ A. The Ben case: mini-rugby, nothing recorded ============

select allocation_status, canonical_key, reason into v_status, v_key, v_reason
from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '10 years')::date, null);

if v_status = 'NORMAL_PLACEMENT' then
  raise notice 'PASS 1 (A): a Union mini-rugby player with NO recorded pathway resolves normally -- the false "no operational team" answer is gone';
else
  raise notice 'FAIL 1 (A): resolved to [%]', v_status;
end if;

if v_key like 'u%' and v_key not like '%girls%' then
  raise notice 'PASS 2 (A): it resolved to the Mixed identity %, not a boys identity invented from a default', v_key;
else
  raise notice 'FAIL 2 (A): resolved to key [%]', coalesce(v_key,'nothing');
end if;

if v_reason ilike '%mixed%' and v_reason ilike '%whatever pathway%' then
  raise notice 'PASS 3 (A): the explanation says mini-rugby is Mixed regardless of pathway, rather than implying anything about the child';
else
  raise notice 'FAIL 3 (A): reason reads [%]', left(coalesce(v_reason,'none'),70);
end if;

-- A recorded pathway must not change the mini-rugby answer either way.
if (select canonical_key from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '10 years')::date, 'FEMALE')) = v_key
   and (select canonical_key from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '10 years')::date, 'MALE')) = v_key then
  raise notice 'PASS 4 (A): a girl and a boy of that age resolve to the SAME Mixed identity -- the pathway does not split mini-rugby';
else
  raise notice 'FAIL 4 (A): the pathway changed the mini-rugby identity';
end if;

-- ============ B/C. Past the split, the pathway decides ============

select canonical_key into v_key
from public.resolve_normal_operational_identity('union', v_union, date '2013-09-01', 'MALE');
if v_key = 'u13' then
  raise notice 'PASS 5 (B): a Union MALE player past the Mixed band takes the boys pathway (%)', v_key;
else
  raise notice 'FAIL 5 (B): MALE resolved to [%]', coalesce(v_key,'nothing');
end if;

select canonical_key into v_key
from public.resolve_normal_operational_identity('union', v_union, date '2013-09-01', 'FEMALE');
if v_key = 'girls_u14' then
  raise notice 'PASS 6 (C/D): a Union FEMALE player takes the girls pathway AND its dual age band -- U13 sits in girls_u14 (RFU Reg 15.6)';
else
  raise notice 'FAIL 6 (C/D): FEMALE resolved to [%]', coalesce(v_key,'nothing');
end if;

if (select canonical_key from public.resolve_normal_operational_identity('union', v_union, date '2012-09-01', 'FEMALE')) = 'girls_u14' then
  raise notice 'PASS 7 (D): the even year of the band resolves to the same girls identity';
else
  raise notice 'FAIL 7 (D): even band year resolved elsewhere';
end if;

-- ============ E. Required but missing fails closed ============

select allocation_status, canonical_team_type_id::text, reason into v_status, v_key, v_reason
from public.resolve_normal_operational_identity('union', v_union, date '2013-09-01', null);

if v_status = 'CLASSIFICATION_REQUIRED' then
  raise notice 'PASS 8 (E): past the Mixed band a missing pathway fails CLOSED';
else
  raise notice 'FAIL 8 (E): missing pathway returned [%]', v_status;
end if;

if v_key is null then
  raise notice 'PASS 9 (E): and no team was guessed -- neither boys nor girls';
else
  raise notice 'FAIL 9 (E): a team was chosen despite the missing pathway';
end if;

if v_reason ilike '%never be assumed%' and v_reason ilike '%team they happen to be in%' then
  raise notice 'PASS 10 (E): the message names both mistakes it exists to prevent';
else
  raise notice 'FAIL 10 (E): reason reads [%]', left(coalesce(v_reason,'none'),70);
end if;

-- An unrecognised value is not silently treated as one of the two.
if (select allocation_status from public.resolve_normal_operational_identity('union', v_union, date '2013-09-01', 'mixed')) = 'CLASSIFICATION_REQUIRED' then
  raise notice 'PASS 11 (E): "mixed" is not accepted as a player pathway -- it describes a team, not a person';
else
  raise notice 'FAIL 11 (E): "mixed" was accepted as a player pathway';
end if;

-- ============ E2. No classification asked where it changes nothing ======

select allocation_status into v_status
from public.resolve_normal_operational_identity('union', v_union, (current_date - interval '19 years')::date, null);
if v_status = 'CLUB_HOLDING' then
  raise notice 'PASS 11b (E): past the top of BOTH Union pathways no classification is demanded -- the answer is the same either way';
else
  raise notice 'FAIL 11b (E): an aged-out Union player was asked for a pathway (%)', v_status;
end if;

-- League's male pathway runs a year longer, so the same age IS pathway-
-- dependent there. Read per code from the directory, never assumed from Union.
if v_league is not null then
  select allocation_status into v_status
  from public.resolve_normal_operational_identity('league', v_league, date '2006-09-01', null);
  if v_status = 'CLASSIFICATION_REQUIRED' then
    raise notice 'PASS 11c (E/F): at U19 League still needs the pathway, because its male pathway runs a year longer than its female one';
  else
    raise notice 'FAIL 11c (E/F): League U19 with no pathway returned %', v_status;
  end if;
end if;

-- ============ F. League is answered by League ============

if v_league is not null then
  select canonical_key into v_key
  from public.resolve_normal_operational_identity('league', v_league, (current_date - interval '10 years')::date, null);
  if v_key is not null then
    raise notice 'PASS 12 (F): League mini-rugby also resolves without a pathway (%), from League''s own offering', v_key;
  else
    raise notice 'FAIL 12 (F): League mini-rugby did not resolve';
  end if;

  -- League runs boys U19; Union does not. If League answers with a Union
  -- fallback this would resolve to nothing.
  select canonical_key into v_key
  from public.resolve_normal_operational_identity('league', v_league, date '2006-09-01', 'MALE');
  if v_key = 'u19' then
    raise notice 'PASS 13 (F): League MALE at U19 resolves to the League-only u19 identity -- no Union fallback';
  else
    raise notice 'FAIL 13 (F): League U19 resolved to [%]', coalesce(v_key,'nothing');
  end if;

  -- The same age in Union has no team, and must NOT borrow League's.
  if (select canonical_team_type_id from public.resolve_normal_operational_identity('union', v_union, date '2006-09-01', 'MALE')) is null then
    raise notice 'PASS 14 (F): Union does not borrow League''s U19 identity';
  else
    raise notice 'FAIL 14 (F): Union resolved a U19 identity it does not offer';
  end if;
end if;

-- ============ G/H. Registration requires it, server-side ============

declare
  v_guardian uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_ok boolean; v_err text;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_guardian,'pw-guardian@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_guardian,'P','W','pw-guardian@ovalball-test.invalid');
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PW RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pw-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'pw-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
  perform set_config('request.jwt.claims', json_build_object('sub',v_guardian,'role','authenticated')::text, true);

  v_ok := false;
  begin
    perform public.add_child_for_guardian('No','Pathway','2015-01-01', v_club, 'union', null);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if v_ok and v_err ilike '%playing pathway%' then
    raise notice 'PASS 15 (G): registration is rejected SERVER-SIDE when the pathway is missing';
  else
    raise notice 'FAIL 15 (G): missing pathway was accepted or misreported (%)', coalesce(v_err,'accepted');
  end if;

  v_ok := false;
  begin
    perform public.add_child_for_guardian('Bad','Value','2015-01-01', v_club, 'union', 'somethingelse');
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if v_ok then
    raise notice 'PASS 16 (H): a free-text value is rejected -- the vocabulary is structured, and the browser is not the authority';
  else
    raise notice 'FAIL 16 (H): free text was accepted as a pathway';
  end if;
end;

-- ============ I/J. Only legitimate authority may set it ============

declare
  v_player uuid; v_outsider uuid := gen_random_uuid(); v_n int;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Protected','Child', date '2013-09-01', 'MALE', true) returning id into v_player;

  insert into auth.users (id, email, instance_id, aud, role)
  values (v_outsider,'pw-outsider@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_outsider,'O','S','pw-outsider@ovalball-test.invalid');

  perform set_config('request.jwt.claims', json_build_object('sub',v_outsider,'role','authenticated')::text, true);
  -- Browser roles hold no direct write on players at all; a refused
  -- statement and a statement that reaches no row are both the protection.
  begin
    perform set_config('role','authenticated', true);
    update public.players set playing_pathway = 'FEMALE' where id = v_player;
    get diagnostics v_n = row_count;
    perform set_config('role','postgres', true);
  exception when insufficient_privilege then
    v_n := 0;
  end;

  if v_n = 0 and (select playing_pathway from public.players where id = v_player) = 'MALE' then
    raise notice 'PASS 17 (I/J): someone with no relationship to this player cannot change their pathway -- the write reaches nothing';
  else
    raise notice 'FAIL 17 (I/J): an unauthorised actor changed a protected player attribute';
  end if;

  -- ============ K. A later change does not rewrite history ============
  declare
    v_dir2 uuid; v_club2 uuid; v_team uuid; v_fx uuid; v_before uuid;
  begin
    insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('PW2 RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pw2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir2;
    insert into public.clubs (directory_id, slug, status) values (v_dir2,'pw2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;
    insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
    values (v_club2,'union','youth','U13','boys','x','pw2t') returning id into v_team;
    insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');
    insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
    values (v_team, date '2026-09-05','Home','Completed','Old Rivals') returning id into v_fx;
    select owning_team_id into v_before from public.fixtures where id = v_fx;

    update public.players set playing_pathway = 'FEMALE' where id = v_player;

    if (select owning_team_id from public.fixtures where id = v_fx) = v_before
       and (select status from public.player_team_memberships where player_id = v_player and team_id = v_team) = 'active' then
      raise notice 'PASS 18 (K): changing the pathway left the played fixture and the existing membership exactly as they were';
    else
      raise notice 'FAIL 18 (K): a profile change rewrote history';
    end if;
  end;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
