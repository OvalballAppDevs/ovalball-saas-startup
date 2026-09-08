-- One canonical Team Directory: what a label change does, and what it must not.
--
-- WHY THIS SUITE EXISTS
--
-- Site Admin -> Team Directory offers Add and Deactivate. It offers no rename,
-- because a canonical label is not free text: create_canonical_team_type
-- computes it from the structured identity via compute_canonical_type_label,
-- there is no update RPC, and canonical_team_types has no UPDATE policy. So a
-- browser rename UAT cannot be performed -- and this suite exists to prove the
-- properties that UAT was meant to establish, at the only level where the
-- label can actually be moved.
--
-- THE TWO PRODUCERS
--
-- Ovalball derives team names twice, on purpose:
--
--   compute_canonical_type_label  -> canonical_team_types.label
--        the IDENTITY as the directory describes it: "Men's 1st Team",
--        "Junior Colts (retired -- now U17)".
--
--   compute_team_display_name     -> teams.display_name, team_season_identity,
--        the OPERATIONAL name a club sees: "Men's 1st", "Girls U12 B".
--
-- They are not duplicates -- they say different things, and the senior and
-- colts cases prove it. But for YOUTH age grades they must agree, and nothing
-- enforced that. Change the Girls rule in one and the other silently keeps the
-- old spelling, so a club's teams and the directory that governs them would
-- disagree about the same identity. Assertion 8 pins them together.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid; v_season uuid; v_roll uuid; v_prop uuid;
  v_player uuid;
  v_id uuid; v_before text; v_key text;
  v_type_before uuid; v_normal_before uuid; v_state_before text;
  v_seen text; v_mismatch text := '';
  r record;
begin

select id, label, key into v_id, v_before, v_key
from public.canonical_team_types where key = 'girls_u12';

if v_id is null then
  raise notice 'SKIP: girls_u12 is not in this database''s Team Directory';
  return;
end if;

-- ---------- A club that runs the identity, and a handover holding a player ----------

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'ctdp@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Directory','Admin','ctdp@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Directory RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','ctdp-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'ctdp-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','girls','Girls U12','ctdp-g12-'||gen_random_uuid()) returning id into v_team;

insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Directory','Girl', date '2015-01-15', true, 'FEMALE') returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active');

select id into v_season from public.seasons
where rugby_code='union' and season_year_start=2027 and not is_regression_fixture limit 1;
if v_season is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Directory 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_season;
end if;

v_roll := public.generate_rollover_proposal(v_club,'union',v_season);
select id into v_prop from public.age_grade_rollover_player_proposals where rollover_id=v_roll and player_id=v_player;

select canonical_team_type_id into v_type_before from public.teams where id = v_team;
select normal_canonical_team_type_id, review_state into v_normal_before, v_state_before
from public.age_grade_rollover_player_proposals where id = v_prop;

-- ============ THE LABEL MOVES ============
update public.canonical_team_types set label = 'UAT Renamed Girls U12' where id = v_id;

-- ============ A. Nothing about the identity moves with it ============

if (select id from public.canonical_team_types where key = v_key) = v_id then
  raise notice 'PASS 1 (A): the stable canonical_team_type_id is unchanged by a label change';
else
  raise notice 'FAIL 1 (A): the stable id moved';
end if;

if internal.resolve_canonical_team_type('youth','U12','girls',null) = v_id then
  raise notice 'PASS 2 (A): regulatory allocation still resolves to the same identity -- the label is not the key';
else
  raise notice 'FAIL 2 (A): allocation resolved to a different identity after a rename';
end if;

if (select canonical_team_type_id from public.teams where id = v_team) = v_type_before then
  raise notice 'PASS 3 (A): the operational team still points at the same canonical identity';
else
  raise notice 'FAIL 3 (A): the team''s canonical identity changed';
end if;

if (select normal_canonical_team_type_id from public.age_grade_rollover_player_proposals where id = v_prop) = v_normal_before
   and (select review_state from public.age_grade_rollover_player_proposals where id = v_prop) = v_state_before then
  raise notice 'PASS 4 (A): the handover decision is untouched -- placement and review state both unmoved';
else
  raise notice 'FAIL 4 (A): a display label changed a handover decision';
end if;

if exists (select 1 from public.player_team_memberships where player_id = v_player and team_id = v_team and status = 'active') then
  raise notice 'PASS 5 (A): membership compatibility is unaffected -- the pathway guard reads structure, not strings';
else
  raise notice 'FAIL 5 (A): a membership was disturbed by a label change';
end if;

-- ============ B. Who follows the directory label ============

select label into v_seen from public.canonical_team_types_by_code where id = v_id and rugby_code = 'union';
if v_seen = 'UAT Renamed Girls U12' then
  raise notice 'PASS 6 (B): the per-code projection follows the directory live -- this is what Add Team and the signup checklist read';
else
  raise notice 'FAIL 6 (B): the per-code projection shows [%]', v_seen;
end if;

-- ============ C. Who deliberately does not ============
--
-- Operational names are derived from the team's own structured fields, on
-- purpose: real data shows a stored display_name drifts (a genuine U12 side
-- still reading "U11 Mixed A" from before a rollover), so deriving is correct
-- by construction. That means a directory label is NOT the source of a team's
-- name, and this records that plainly rather than leaving it to be discovered.

if (select display_name from public.teams where id = v_team) = 'Girls U12' then
  raise notice 'PASS 7 (C): a team''s operational name is derived from its own structure, not read from the directory label';
else
  raise notice 'FAIL 7 (C): the team display name became [%]', (select display_name from public.teams where id = v_team);
end if;

-- ============ D. The two producers must agree where they overlap ============
--
-- The pin. Senior and colts legitimately differ ("Men's 1st Team" vs
-- "Men's 1st"), but every youth age grade must read identically in both, or a
-- club's teams and the directory governing them disagree about one identity.

update public.canonical_team_types set label = v_before where id = v_id;

for r in
  select ctt.key, ctt.label, ctt.category, ctt.age_group, ctt.gender
  from public.canonical_team_types ctt
  where ctt.category = 'youth' and ctt.is_active
loop
  if internal.compute_team_display_name(r.category, r.age_group, r.gender, null) is distinct from r.label then
    v_mismatch := v_mismatch || format(' %s(directory=%s, teams=%s)',
      r.key, r.label, internal.compute_team_display_name(r.category, r.age_group, r.gender, null));
  end if;
end loop;

if v_mismatch = '' then
  raise notice 'PASS 8 (D): every active youth identity reads the same in the Team Directory and on a club''s teams';
else
  raise notice 'FAIL 8 (D): the two name producers disagree:%', v_mismatch;
end if;

-- ============ E. Restore ============

if (select label from public.canonical_team_types where id = v_id) = v_before then
  raise notice 'PASS 9 (E): the original label is restored exactly, against the same unchanged stable id';
else
  raise notice 'FAIL 9 (E): the label is now [%]', (select label from public.canonical_team_types where id = v_id);
end if;

-- ============ F. There is no rename in the product ============
--
-- Recorded as an assertion so it cannot change silently. If a rename RPC is
-- ever added, this fails and whoever added it has to decide -- deliberately --
-- what a renamed directory label means for the teams already carrying that
-- identity.

if not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname ~ 'canonical_team_type'
    and pg_get_functiondef(p.oid) ~ 'update public\.canonical_team_types[^;]*set[^;]*label'
) then
  raise notice 'PASS 10 (F): no route renames a canonical identity -- the label is computed from the identity, not typed';
else
  raise notice 'FAIL 10 (F): something can now rename a canonical identity; decide what that means for existing teams';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
