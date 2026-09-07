-- Canonical Constituent Body directory.
--
-- A club's governing body is a controlled identity, not a string. What
-- matters: the seed is the RFU's real list and nothing else; a union club
-- references a canonical row by stable id; a league club needs none and is
-- never offered an invented one; and an ordinary user cannot bring a new
-- governing body into existence.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_site  uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_dir_union uuid; v_dir_league uuid;
  v_lancs uuid; v_kent uuid;
  v_count int; v_text text; v_uuid uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_site, 'cbsite@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin,'cbadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_site,'CB','Site','cbsite@ovalball-test.invalid'),
    (v_admin,'CB','Admin','cbadmin@ovalball-test.invalid');
  insert into public.site_admins (user_id, status, admin_role) values (v_site,'active','full')
  on conflict (user_id) do update set status='active', admin_role='full';

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('CB Union Test RUFC','union','England','England','manual','verified','cb-union-test'),
    ('CB League Test RLFC','league','England','England','manual','verified','cb-league-test');
  select id into v_dir_union  from public.club_directory where normalized_key='cb-union-test';
  select id into v_dir_league from public.club_directory where normalized_key='cb-league-test';

  select id into v_lancs from public.constituent_bodies where canonical_name = 'Lancashire RFU';
  select id into v_kent  from public.constituent_bodies where canonical_name = 'Kent RFU';

  -- =================================================================
  -- A. The seed is the RFU's actual list
  -- =================================================================
  select count(*) into v_count from public.constituent_bodies
  where rugby_code='union' and nation='England' and body_type='GEOGRAPHIC';
  if v_count = 28 then
    raise notice 'PASS 1 (A): exactly 28 geographic RFU Constituent Bodies';
  else
    raise notice 'FAIL 1 (A): % geographic bodies', v_count;
  end if;

  select count(*) into v_count from public.constituent_bodies
  where rugby_code='union' and nation='England' and body_type <> 'GEOGRAPHIC';
  if v_count = 7 then
    raise notice 'PASS 2 (A): exactly 7 non-geographic Constituent Bodies';
  else
    raise notice 'FAIL 2 (A): % non-geographic bodies', v_count;
  end if;

  -- The specific wrong entry an earlier hand-assembled list contained.
  -- Huntingdonshire & Peterborough is a sub-county of East Midlands RFU.
  select count(*) into v_count from public.constituent_bodies
  where canonical_name ilike '%hunt%' or canonical_name ilike '%peterborough%';
  if v_count = 0 then
    raise notice 'PASS 3 (A): Hunts & Peterborough is not seeded as a Constituent Body';
  else
    raise notice 'FAIL 3 (A): it is present as a top-level body';
  end if;

  -- Bodies the official list confirms, which a wrong list might drop.
  select count(*) into v_count from public.constituent_bodies
  where canonical_name in ('Surrey RFU','Sussex RFU','Warwickshire RFU','East Midlands RFU');
  if v_count = 4 then
    raise notice 'PASS 4 (A): Surrey, Sussex, Warwickshire and East Midlands are all present';
  else
    raise notice 'FAIL 4 (A): only % of the four are present', v_count;
  end if;

  -- Every row carries provenance -- no body of unknown origin.
  select count(*) into v_count from public.constituent_bodies
  where source is null or source_url is null or source_checked_on is null;
  if v_count = 0 then
    raise notice 'PASS 5 (A): every canonical body records where it came from';
  else
    raise notice 'FAIL 5 (A): % bodies have no provenance', v_count;
  end if;

  -- =================================================================
  -- B. Rugby league has none, and none is invented
  -- =================================================================
  select count(*) into v_count from public.constituent_bodies where rugby_code = 'league';
  if v_count = 0 then
    raise notice 'PASS 6 (B): rugby league has no Constituent Bodies';
  else
    raise notice 'FAIL 6 (B): % league bodies were invented', v_count;
  end if;

  -- Nothing borrowed from the league competition structure either.
  select count(*) into v_count from public.constituent_bodies
  where canonical_name ilike '%BARLA%' or canonical_name ilike '%conference%'
     or canonical_name ilike '%community rugby league%' or canonical_name ilike '%county championship%';
  if v_count = 0 then
    raise notice 'PASS 7 (B): no league competition structure is masquerading as a governing body';
  else
    raise notice 'FAIL 7 (B): % competition rows present', v_count;
  end if;

  -- A league club simply has none, and that is a valid, complete state.
  update public.club_directory set constituent_body_id = null where id = v_dir_league;
  select count(*) into v_count from public.club_directory
  where id = v_dir_league and constituent_body_id is null;
  if v_count = 1 then
    raise notice 'PASS 8 (B): a league club needs no Constituent Body';
  else
    raise notice 'FAIL 8 (B): a league club was forced to have one';
  end if;

  -- =================================================================
  -- C. A club references a canonical body by stable id
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.club_directory set constituent_body_id = v_lancs where id = v_dir_union;
  reset role;

  select cb.canonical_name into v_text
  from public.club_directory d join public.constituent_bodies cb on cb.id = d.constituent_body_id
  where d.id = v_dir_union;
  if v_text = 'Lancashire RFU' then
    raise notice 'PASS 9 (C): a union club references a canonical body';
  else
    raise notice 'FAIL 9 (C): resolved to %', coalesce(v_text,'(null)');
  end if;

  -- The id is the identity: renaming the body changes every consumer at
  -- once and breaks no reference.
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.constituent_bodies set canonical_name = 'Lancashire Rugby Football Union' where id = v_lancs;
  reset role;

  select cb.canonical_name, d.constituent_body_id into v_text, v_uuid
  from public.club_directory d join public.constituent_bodies cb on cb.id = d.constituent_body_id
  where d.id = v_dir_union;
  if v_text = 'Lancashire Rugby Football Union' and v_uuid = v_lancs then
    raise notice 'PASS 10 (C): a display-name change propagates from one place and the id is unchanged';
  else
    raise notice 'FAIL 10 (C): name=% id=%', v_text, v_uuid;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.constituent_bodies set canonical_name = 'Lancashire RFU' where id = v_lancs;
  reset role;

  -- A body a club still references cannot be deleted out from under it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  begin
    delete from public.constituent_bodies where id = v_lancs;
    raise notice 'FAIL 11 (C): a referenced Constituent Body was deleted';
  exception when others then
    raise notice 'PASS 11 (C): a Constituent Body in use cannot be deleted';
  end;
  reset role;

  -- =================================================================
  -- D. No duplicates, ever
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  begin
    insert into public.constituent_bodies (rugby_code, nation, canonical_name, body_type)
    values ('union','England','Lancashire RFU','GEOGRAPHIC');
    raise notice 'FAIL 12 (D): a duplicate Constituent Body was created';
  exception when others then
    raise notice 'PASS 12 (D): a duplicate canonical body is refused';
  end;
  reset role;

  -- =================================================================
  -- E. Ordinary users cannot invent a governing body
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated', 'email','cbadmin@ovalball-test.invalid')::text, true);
  set local role authenticated;
  begin
    insert into public.constituent_bodies (rugby_code, nation, canonical_name, body_type)
    values ('union','England','Invented County RFU','GEOGRAPHIC');
    reset role;
    raise notice 'FAIL 13 (E): a club user invented a governing body';
  exception when others then
    reset role;
    raise notice 'PASS 13 (E): a non-Site-Admin cannot create a Constituent Body';
  end;

  select count(*) into v_count from public.constituent_bodies where canonical_name = 'Invented County RFU';
  if v_count = 0 then
    raise notice 'PASS 13b (E): no invented body reached the table';
  else
    raise notice 'FAIL 13b (E): an invented body exists';
  end if;

  -- But they CAN read the list, or the selector could not be populated.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated', 'email','cbadmin@ovalball-test.invalid')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.constituent_bodies where rugby_code='union';
  reset role;
  if v_count = 35 then
    raise notice 'PASS 14 (E): an ordinary user can read the canonical list to select from it';
  else
    raise notice 'FAIL 14 (E): they see % bodies', v_count;
  end if;

  -- =================================================================
  -- F. Code scoping
  -- =================================================================
  -- Nothing offers a union body to a league club: the scoped query a
  -- league club's selector runs returns nothing at all.
  select count(*) into v_count from public.constituent_bodies cb
  join public.club_directory d on d.id = v_dir_league
  where cb.rugby_code = d.rugby_code and cb.nation = d.nation and cb.active;
  if v_count = 0 then
    raise notice 'PASS 15 (F): a league club''s scoped selector offers nothing';
  else
    raise notice 'FAIL 15 (F): % bodies offered to a league club', v_count;
  end if;

  select count(*) into v_count from public.constituent_bodies cb
  join public.club_directory d on d.id = v_dir_union
  where cb.rugby_code = d.rugby_code and cb.nation = d.nation and cb.active;
  if v_count = 35 then
    raise notice 'PASS 16 (F): a union club''s scoped selector offers all 35';
  else
    raise notice 'FAIL 16 (F): % offered', v_count;
  end if;

  -- =================================================================
  -- G. Existing values reconciled, unknown text never discarded
  -- =================================================================
  select count(*) into v_count from public.club_directory d
  join public.constituent_bodies cb on cb.id = d.constituent_body_id
  where cb.canonical_name = 'Lancashire RFU' and d.id <> v_dir_union;
  if v_count >= 5 then
    raise notice 'PASS 17 (G): the pre-existing Lancashire clubs reconciled to the canonical body (%)', v_count;
  else
    raise notice 'FAIL 17 (G): only % reconciled', v_count;
  end if;

  select count(*) into v_count from public.club_directory d
  join public.constituent_bodies cb on cb.id = d.constituent_body_id
  where cb.canonical_name = 'Hertfordshire RFU';
  if v_count >= 1 then
    raise notice 'PASS 18 (G): the pre-existing Hertfordshire club reconciled';
  else
    raise notice 'FAIL 18 (G): it did not reconcile';
  end if;

  -- An unrecognised import keeps its text and stays visible for review
  -- rather than being silently dropped or silently guessed at.
  update public.club_directory
  set constituent_body = 'Some Unrecognised County RFU', constituent_body_id = null
  where id = v_dir_union;

  select constituent_body into v_text from public.club_directory where id = v_dir_union;
  if v_text = 'Some Unrecognised County RFU' then
    raise notice 'PASS 19 (G): unmatched imported text is preserved, not discarded';
  else
    raise notice 'FAIL 19 (G): the text was lost';
  end if;

  select count(*) into v_count from public.club_directory
  where constituent_body is not null and btrim(constituent_body) <> '' and constituent_body_id is null;
  if v_count >= 1 then
    raise notice 'PASS 20 (G): unreconciled values are findable for Site Admin review (% row(s))', v_count;
  else
    raise notice 'FAIL 20 (G): the review queue cannot be built';
  end if;

  -- =================================================================
  -- H. The legacy text is not the source of truth
  -- =================================================================
  -- Text and reference disagreeing must resolve to the REFERENCE.
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','cbsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.club_directory set constituent_body = 'Kent RFU', constituent_body_id = v_lancs where id = v_dir_union;
  reset role;

  select cb.canonical_name into v_text
  from public.club_directory d join public.constituent_bodies cb on cb.id = d.constituent_body_id
  where d.id = v_dir_union;
  if v_text = 'Lancashire RFU' then
    raise notice 'PASS 21 (H): the canonical reference wins over stale legacy text';
  else
    raise notice 'FAIL 21 (H): resolved to %', v_text;
  end if;
end;
$$;

rollback;
