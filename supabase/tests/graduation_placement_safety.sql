-- Graduation placement: age direction, membership closure, and the paths that
-- must stay open.
--
-- These assertions exist because the placement control accepted an 18-year-old
-- into an Under-14 squad with no check ("PROBE A -- adult onto U14 ACCEPTED"),
-- and because placement left the player holding an active membership to the
-- archived cohort they had just left.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid;
  v_u18 uuid; v_u14 uuid; v_u16 uuid; v_snr uuid;
  v_adult uuid; v_young uuid; v_nodob uuid;
  v_q uuid; v_n int; v_err text; v_ok boolean; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'grad2@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'G','R','grad2@ovalball-test.invalid');
-- Identity/Auth Slice 3: placing a graduating player is club authority (team.graduation.place). A Site Admin
-- without a club role no longer reaches it through the removed club bypass, so the actor is the club's admin.
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Grad2 RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','grad2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'grad2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U18','boys','x','h1') returning id into v_u18;
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U14','boys','x','h2') returning id into v_u14;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','h3') returning id into v_u16;
insert into public.teams (club_id, rugby_code, category, gender, team_number, display_name, slug)
values (v_club,'union','senior','mens',1,'x','h4') returning id into v_snr;

insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Adult','Grad', (current_date - interval '18 years 2 months')::date, true, 'MALE') returning id into v_adult;
insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Young','Grad', (current_date - interval '15 years 1 month')::date, true, 'MALE') returning id into v_young;
insert into public.players (first_name, surname, active, playing_pathway)
values ('NoDob','Grad', true, 'MALE') returning id into v_nodob;

insert into public.player_team_memberships (player_id, team_id, status) values (v_adult, v_u18,'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_young, v_u18,'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_nodob, v_u18,'active');

perform public.graduate_team(v_u18);

-- ============ 1. An adult must not land in a youth squad ============

select id into v_q from public.player_graduation_queue where player_id = v_adult;
v_ok := false;
begin
  perform public.place_graduating_player(v_q, v_u14);
exception when others then v_ok := true; v_err := sqlerrm;
end;

if v_ok and v_err like '%over-age%' then
  raise notice 'PASS 1: an adult graduate is REFUSED placement into an Under-14 squad';
elsif v_ok then
  raise notice 'FAIL 1: refused, but not for the right reason: %', v_err;
else
  raise notice 'FAIL 1: an adult was placed into an Under-14 squad';
end if;

if v_err like '%Playing up an age group does not%' then
  raise notice 'PASS 2: the refusal explains the direction that IS allowed, so a club is not left guessing';
else
  raise notice 'FAIL 2: the refusal does not explain what is allowed';
end if;

if not exists (select 1 from public.player_team_memberships where player_id=v_adult and team_id=v_u14 and status='active')
   and (select status from public.player_graduation_queue where id=v_q) = 'pending_placement' then
  raise notice 'PASS 3: the refused placement left nothing behind and the player is still queued';
else
  raise notice 'FAIL 3: the refused placement left partial state';
end if;

-- ============ 2. The legitimate destination still works ============

perform public.place_graduating_player(v_q, v_snr);
if exists (select 1 from public.player_team_memberships where player_id=v_adult and team_id=v_snr and status='active') then
  raise notice 'PASS 4: the adult graduate CAN still be placed on the senior team -- the guard did not block the normal path';
else
  raise notice 'FAIL 4: the adult could not be placed anywhere';
end if;

-- ============ 3. Placement closes the old membership ============

select count(*) into v_n from public.player_team_memberships where player_id=v_adult and status='active';
if v_n = 1 then
  raise notice 'PASS 5: after placement the player holds exactly ONE active membership, not two';
else
  select string_agg(t.display_name, ', ') into v_txt
  from public.player_team_memberships m join public.teams t on t.id=m.team_id
  where m.player_id=v_adult and m.status='active';
  raise notice 'FAIL 5: % active memberships (%)', v_n, v_txt;
end if;

if (select status from public.player_team_memberships where player_id=v_adult and team_id=v_u18) = 'ended'
   and (select ended_at is not null from public.player_team_memberships where player_id=v_adult and team_id=v_u18) then
  raise notice 'PASS 6: the archived cohort no longer holds the player as an active member, and the end is dated';
else
  raise notice 'FAIL 6: the source membership was not closed properly';
end if;

-- ============ 4. Playing UP stays ordinary ============

select id into v_q from public.player_graduation_queue where player_id = v_young;
perform public.place_graduating_player(v_q, v_u16);
if exists (select 1 from public.player_team_memberships where player_id=v_young and team_id=v_u16 and status='active') then
  raise notice 'PASS 7: a U16-age player placed into the U16 side is ordinary and still permitted';
else
  raise notice 'FAIL 7: a normal in-band placement was blocked';
end if;

-- ============ 5. No date of birth means no guess ============

select id into v_q from public.player_graduation_queue where player_id = v_nodob;
v_ok := false;
begin
  perform public.place_graduating_player(v_q, v_u14);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%date of birth%' then
  raise notice 'PASS 8: a player with no recorded date of birth cannot be placed into an age-banded team';
else
  raise notice 'FAIL 8: placement without a date of birth was allowed or misreported: %', coalesce(v_err,'(accepted)');
end if;

-- ============ 6. Leaving the club actually ends the membership ============

perform public.mark_graduating_player_left(v_q);
if (select status from public.player_team_memberships where player_id=v_nodob and team_id=v_u18) = 'ended' then
  raise notice 'PASS 9: marking a player as having left the club ends their membership rather than only the queue entry';
else
  raise notice 'FAIL 9: a player recorded as having left is still an active member';
end if;

if (select count(*) from public.player_team_memberships where team_id=v_u18 and status='active') = 0 then
  raise notice 'PASS 10: the archived cohort holds no active members once every graduate is decided';
else
  raise notice 'FAIL 10: the archived cohort still holds % active members',
    (select count(*) from public.player_team_memberships where team_id=v_u18 and status='active');
end if;

-- ============ 7. The under-18 senior guard is untouched ============

insert into public.player_team_memberships (player_id, team_id, status) values (v_young, v_u18,'active');
delete from public.player_graduation_queue where player_id = v_young;
insert into public.player_graduation_queue (player_id, source_team_id, club_id) values (v_young, v_u18, v_club) returning id into v_q;
v_ok := false;
begin
  perform public.place_graduating_player(v_q, v_snr);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%under 18%' then
  raise notice 'PASS 11: the under-18-onto-senior guard still holds and still demands a governing-body dispensation';
else
  raise notice 'FAIL 11: the under-18 senior guard changed: %', coalesce(v_err,'(accepted)');
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
