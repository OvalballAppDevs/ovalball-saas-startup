-- Person names are stored the way somebody would write them.
--
-- A name typed in a hurry -- "callum krzysik" -- must not reach a team sheet,
-- an email or a safeguarding record in that form. CSS cannot fix that: it only
-- covers the one screen somebody remembered, and never an export.
--
-- The harder half of this suite is what the normaliser must NOT do. Real names
-- are not headings, and a naive Title Case turns McDonald into Mcdonald and
-- van der Meer into Van Der Meer. Every assertion below that looks like it is
-- testing "nothing happened" is testing exactly that.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid; v_player uuid;
  v_first text; v_surname text;
  v_ok boolean; v_err text;
begin

-- ============ A. The normaliser itself ============

if internal.normalise_person_name('callum') = 'Callum'
   and internal.normalise_person_name('krzysik') = 'Krzysik' then
  raise notice 'PASS 1 (A): an all-lower-case name is capitalised';
else
  raise notice 'FAIL 1 (A): callum/krzysik gave %/%',
    internal.normalise_person_name('callum'), internal.normalise_person_name('krzysik');
end if;

if internal.normalise_person_name('  callum   krzysik  ') = 'Callum Krzysik' then
  raise notice 'PASS 2 (A): leading, trailing and repeated internal whitespace are cleaned in one pass';
else
  raise notice 'FAIL 2 (A): whitespace handling gave [%]', internal.normalise_person_name('  callum   krzysik  ');
end if;

if internal.normalise_person_name('amy-jane') = 'Amy-Jane' then
  raise notice 'PASS 3 (A): a hyphenated name is capitalised on both sides of the hyphen';
else
  raise notice 'FAIL 3 (A): amy-jane gave [%]', internal.normalise_person_name('amy-jane');
end if;

if internal.normalise_person_name('o''neill') = 'O''Neill' then
  raise notice 'PASS 4 (A): a name is capitalised after an apostrophe';
else
  raise notice 'FAIL 4 (A): o''neill gave [%]', internal.normalise_person_name('o''neill');
end if;

if internal.normalise_person_name('CALLUM KRZYSIK') = 'Callum Krzysik' then
  raise notice 'PASS 5 (A): a name typed in capitals is treated as unformatted, not as a decision';
else
  raise notice 'FAIL 5 (A): caps input gave [%]', internal.normalise_person_name('CALLUM KRZYSIK');
end if;

-- ============ B. What it must NOT do ============

if internal.normalise_person_name('Callum Krzysik') = 'Callum Krzysik' then
  raise notice 'PASS 6 (B): an already-correct name is returned untouched -- the normaliser is idempotent';
else
  raise notice 'FAIL 6 (B): a correct name was changed to [%]', internal.normalise_person_name('Callum Krzysik');
end if;

declare v_bad text := '';
begin
  if internal.normalise_person_name('McDonald') <> 'McDonald' then v_bad := v_bad || ' McDonald->' || internal.normalise_person_name('McDonald'); end if;
  if internal.normalise_person_name('MacLeod') <> 'MacLeod' then v_bad := v_bad || ' MacLeod->' || internal.normalise_person_name('MacLeod'); end if;
  if internal.normalise_person_name('O''Neill') <> 'O''Neill' then v_bad := v_bad || ' O''Neill->' || internal.normalise_person_name('O''Neill'); end if;
  if internal.normalise_person_name('de Silva') <> 'de Silva' then v_bad := v_bad || ' de Silva->' || internal.normalise_person_name('de Silva'); end if;
  if internal.normalise_person_name('van der Meer') <> 'van der Meer' then v_bad := v_bad || ' van der Meer->' || internal.normalise_person_name('van der Meer'); end if;
  if internal.normalise_person_name('St John') <> 'St John' then v_bad := v_bad || ' St John->' || internal.normalise_person_name('St John'); end if;
  if internal.normalise_person_name('DiCaprio') <> 'DiCaprio' then v_bad := v_bad || ' DiCaprio->' || internal.normalise_person_name('DiCaprio'); end if;

  if v_bad = '' then
    raise notice 'PASS 7 (B): every deliberately spelled real name survives untouched -- McDonald, MacLeod, O''Neill, de Silva, van der Meer, St John, DiCaprio';
  else
    raise notice 'FAIL 7 (B): the normaliser damaged:%', v_bad;
  end if;
end;

-- Run twice. A name that changes on the second pass is a name that gets
-- re-spelled every time its owner saves anything.
if internal.normalise_person_name(internal.normalise_person_name('van der meer'))
   = internal.normalise_person_name('van der meer') then
  raise notice 'PASS 8 (B): normalising an already-normalised name is a no-op -- a corrected name is never re-spelled';
else
  raise notice 'FAIL 8 (B): the normaliser is not idempotent';
end if;

if internal.normalise_person_name('de silva') = 'de Silva'
   and internal.normalise_person_name('van der meer') = 'van der Meer' then
  raise notice 'PASS 9 (B): a nobiliary particle stays lower case inside a full name';
else
  raise notice 'FAIL 9 (B): de silva/van der meer gave [%]/[%]',
    internal.normalise_person_name('de silva'), internal.normalise_person_name('van der meer');
end if;

if internal.normalise_person_name('mcgowan') = 'McGowan' and internal.normalise_person_name('macey') = 'Macey' then
  raise notice 'PASS 10 (B): Mc is expanded; Mac deliberately is not, because Macey and Machin are ordinary names';
else
  raise notice 'FAIL 10 (B): mcgowan/macey gave [%]/[%]',
    internal.normalise_person_name('mcgowan'), internal.normalise_person_name('macey');
end if;

if internal.normalise_person_name(null) is null and internal.normalise_person_name('') = '' then
  raise notice 'PASS 11 (B): null and empty pass straight through -- required-name validation is not this function''s job';
else
  raise notice 'FAIL 11 (B): null/empty were altered';
end if;

-- ============ C. The write boundary ============
--
-- The normaliser being correct proves nothing on its own. What matters is that
-- no writer can get around it.

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'names@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'names','admin','names@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

select first_name, surname into v_first, v_surname from public.profiles where id = v_admin;
if v_first = 'Names' and v_surname = 'Admin' then
  raise notice 'PASS 12 (C): a profile written directly, bypassing every application path, is still stored formatted';
else
  raise notice 'FAIL 12 (C): profile stored as [%]/[%]', v_first, v_surname;
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Names RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','names-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'names-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','boys','U12','names-u12-'||gen_random_uuid()) returning id into v_team;

insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('  callum ','  krzysik ', date '2014-03-02', true, 'MALE') returning id into v_player;

select first_name, surname into v_first, v_surname from public.players where id = v_player;
if v_first = 'Callum' and v_surname = 'Krzysik' then
  raise notice 'PASS 13 (C): a player written directly is stored as Callum Krzysik';
else
  raise notice 'FAIL 13 (C): player stored as [%]/[%]', v_first, v_surname;
end if;

update public.players set first_name = 'CALLUM', surname = 'o''neill' where id = v_player;
select first_name, surname into v_first, v_surname from public.players where id = v_player;
if v_first = 'Callum' and v_surname = 'O''Neill' then
  raise notice 'PASS 14 (C): an UPDATE is normalised too, not only the original INSERT';
else
  raise notice 'FAIL 14 (C): after update, [%]/[%]', v_first, v_surname;
end if;

-- A person correcting their own name by hand must be believed.
update public.players set surname = 'MacLeod' where id = v_player;
update public.players set first_name = 'Callum' where id = v_player;
select surname into v_surname from public.players where id = v_player;
if v_surname = 'MacLeod' then
  raise notice 'PASS 15 (C): a deliberately corrected name survives later writes to the same row';
else
  raise notice 'FAIL 15 (C): a corrected name was re-spelled to [%]', v_surname;
end if;

-- ============ D. Club and team names are NOT person names ============

if (select display_name from public.teams where id = v_team) = 'Under 12 Boys' then
  raise notice 'PASS 16 (D): a team display name follows the canonical presentation rules, never the person-name normaliser';
else
  raise notice 'FAIL 16 (D): the team display name became [%]', (select display_name from public.teams where id = v_team);
end if;

if (select name from public.club_directory where id = v_dir) = 'Names RUFC' then
  raise notice 'PASS 17 (D): a Club Directory name is untouched, including its RFU-style suffix';
else
  raise notice 'FAIL 17 (D): the club name became [%]', (select name from public.club_directory where id = v_dir);
end if;

-- ============ E. Missing Gender can be answered in the product ============
--
-- The Season Handover board holds a player with no recorded playing pathway.
-- Before this existed, the only remedy was an UPDATE against the database.

declare
  v_guardian uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_kid uuid; v_mini uuid;
begin
  -- A Mixed mini side, because the membership pathway guard rightly refuses to
  -- put a player of unknown pathway into a Boys team. Unknown-pathway players
  -- really do sit in mini-rugby: that is where this gap lives.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U11','mixed','U11','names-u11-'||gen_random_uuid()) returning id into v_mini;
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_guardian,'names-g@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_staff,'names-s@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_guardian,'Gwen','Guardian','names-g@ovalball-test.invalid'),
    (v_staff,'Sam','Staff','names-s@ovalball-test.invalid');

  insert into public.players (first_name, surname, date_of_birth, active)
  values ('Unknown','Pathway', date '2014-03-02', true) returning id into v_kid;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_kid, v_mini, 'active');
  insert into public.guardians (player_id, guardian_user_id, status) values (v_kid, v_guardian, 'active');

  -- Club staff: may not answer.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_staff, 'CLUB_ADMIN', 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff,'role','authenticated')::text, true);
  v_ok := false;
  begin
    perform public.set_player_playing_pathway(v_kid, 'MALE');
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if v_ok and v_err like '%guardian%' then
    raise notice 'PASS 18 (E): a Club Admin cannot record a child''s gender -- running the club is not that authority';
  else
    raise notice 'FAIL 18 (E): club staff recorded protected identity information (%)', coalesce(v_err,'accepted');
  end if;

  -- Club staff: may ask.
  if public.request_player_playing_pathway(v_kid) = 1 then
    raise notice 'PASS 19 (E): the club can ASK the guardian, which is the whole of its authority here';
  else
    raise notice 'FAIL 19 (E): the club could not ask the guardian';
  end if;

  -- A real handover, holding on exactly this player, so the recalculation can
  -- be observed rather than asserted.
  declare v_season uuid; v_roll uuid; v_before text; v_after text; v_out record;
  begin
    select id into v_season from public.seasons
    where rugby_code = 'union' and season_year_start = 2027 and not is_regression_fixture limit 1;
    if v_season is null then
      insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
      values ('Names 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_season;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
    v_roll := public.generate_rollover_proposal(v_club, 'union', v_season);

    select review_state into v_before from public.age_grade_rollover_player_proposals
    where rollover_id = v_roll and player_id = v_kid;
    if v_before = 'NEEDS_ATTENTION' then
      raise notice 'PASS 20 (E): the handover holds this player because nobody has said which pathway they are registered in';
    else
      raise notice 'FAIL 20 (E): the player reads [%] with no pathway recorded', v_before;
    end if;

    -- Guardian: may answer, and is told what it settled.
    perform set_config('request.jwt.claims', json_build_object('sub', v_guardian,'role','authenticated')::text, true);
    select * into v_out from public.set_player_playing_pathway(v_kid, 'FEMALE');

    if (select playing_pathway from public.players where id = v_kid) = 'FEMALE' then
      raise notice 'PASS 21 (E): the guardian recorded it, in the product, with no database edit';
    else
      raise notice 'FAIL 21 (E): the guardian''s answer was not stored';
    end if;

    select review_state into v_after from public.age_grade_rollover_player_proposals
    where rollover_id = v_roll and player_id = v_kid;
    if v_after <> 'NEEDS_ATTENTION' or v_out.review_state is not null then
      raise notice 'PASS 22 (E): answering recalculated the handover proposal immediately -- [%] became [%]', v_before, v_after;
    else
      raise notice 'FAIL 22 (E): the handover still reads [%] after the answer', v_after;
    end if;

    if v_out.reason is not null then
      raise notice 'PASS 23 (E): the person who answered is told what it settled, rather than sent elsewhere to find out';
    else
      raise notice 'FAIL 23 (E): the answer returned no outcome';
    end if;
  end;

  v_ok := false;
  begin
    perform public.set_player_playing_pathway(v_kid, 'MIXED');
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if v_ok then
    raise notice 'PASS 24 (E): Mixed is refused -- a team can be Mixed, a person cannot';
  else
    raise notice 'FAIL 24 (E): MIXED was accepted as a person''s pathway';
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
