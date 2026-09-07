-- Site Admin club profile override.
--
-- A Site Admin maintains the public profile of ANY recognised club --
-- including one nobody has claimed on Ovalball. The whole point is that
-- doing so writes `club_directory` and never fabricates a `clubs` row,
-- because a `clubs` row means "activated" and every activation count on the
-- platform reads it.
--
-- The resolution rule mirrors logo_storage_path exactly: the activated
-- club's own value wins, the directory's is the seed underneath.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_site   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_dir_unclaimed uuid;
  v_dir_claimed uuid;
  v_club uuid;
  v_before int; v_after int; v_count int; v_text text;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_site, 'dpsite@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin,'dpadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_site,'DP','Site','dpsite@ovalball-test.invalid'),
    (v_admin,'DP','Admin','dpadmin@ovalball-test.invalid');
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full')
  on conflict (user_id) do update set status='active', admin_role='full';

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key, town)
  values ('DP Unclaimed RUFC','union','England','England','manual','verified','dp-unclaimed','Burnley'),
         ('DP Claimed RUFC','union','England','England','manual','verified','dp-claimed','Burnley');
  select id into v_dir_unclaimed from public.club_directory where normalized_key='dp-unclaimed';
  select id into v_dir_claimed   from public.club_directory where normalized_key='dp-claimed';

  insert into public.clubs (directory_id, slug, status) values (v_dir_claimed,'dp-claimed','active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN','active');

  -- =================================================================
  -- A. THE INVARIANT: editing an unclaimed club creates no clubs row
  -- =================================================================
  select count(*) into v_before from public.clubs;

  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','dpsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.club_directory
  set bio = 'A recognised club that has not claimed its Ovalball page.',
      website = 'https://dp-unclaimed.example',
      facebook_url = 'https://facebook.com/dp-unclaimed'
  where id = v_dir_unclaimed;
  reset role;

  select count(*) into v_after from public.clubs;
  if v_after = v_before then
    raise notice 'PASS 1 (A): editing an unclaimed club''s profile creates no clubs row';
  else
    raise notice 'FAIL 1 (A): clubs went %->%', v_before, v_after;
  end if;

  select count(*) into v_count from public.clubs where directory_id = v_dir_unclaimed;
  if v_count = 0 then
    raise notice 'PASS 2 (A): the unclaimed directory entry still has no activated club';
  else
    raise notice 'FAIL 2 (A): % clubs rows now point at it', v_count;
  end if;

  select bio into v_text from public.club_directory where id = v_dir_unclaimed;
  if v_text = 'A recognised club that has not claimed its Ovalball page.' then
    raise notice 'PASS 3 (A): the profile persisted on the directory row';
  else
    raise notice 'FAIL 3 (A): bio is %', coalesce(v_text, '(null)');
  end if;

  -- =================================================================
  -- B. Only a Site Admin may write it
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated', 'email','dpadmin@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.club_directory set bio = 'Rewritten by a club admin.' where id = v_dir_unclaimed;
  reset role;

  select bio into v_text from public.club_directory where id = v_dir_unclaimed;
  if v_text = 'A recognised club that has not claimed its Ovalball page.' then
    raise notice 'PASS 4 (B): a Club Admin cannot rewrite directory-level profile text';
  else
    raise notice 'FAIL 4 (B): a Club Admin rewrote it to %', v_text;
  end if;

  -- And an anonymous reader certainly cannot.
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  update public.club_directory set bio = 'Rewritten anonymously.' where id = v_dir_unclaimed;
  reset role;
  select bio into v_text from public.club_directory where id = v_dir_unclaimed;
  if v_text = 'A recognised club that has not claimed its Ovalball page.' then
    raise notice 'PASS 5 (B): an anonymous writer cannot change directory profile text';
  else
    raise notice 'FAIL 5 (B): anon rewrote it';
  end if;

  -- =================================================================
  -- C. Resolution: the club's own value wins, the directory is the seed
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated', 'email','dpsite@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.club_directory
  set bio = 'Directory description.', facebook_url = 'https://facebook.com/directory-page'
  where id = v_dir_claimed;
  reset role;

  -- The activated club has written nothing of its own yet, so the
  -- directory's values are what a reader should get.
  select c.bio, d.bio into v_text, v_text from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_club;
  select coalesce(nullif(btrim(c.bio), ''), nullif(btrim(d.bio), '')) into v_text
  from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_club;
  if v_text = 'Directory description.' then
    raise notice 'PASS 6 (C): a claimed club with no bio of its own falls back to the directory';
  else
    raise notice 'FAIL 6 (C): resolved to %', coalesce(v_text, '(null)');
  end if;

  -- Now the club writes its own. Theirs must win, and the directory value
  -- must be left completely alone underneath it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated', 'email','dpadmin@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.clubs set bio = 'The club''s own words.' where id = v_club;
  reset role;

  select coalesce(nullif(btrim(c.bio), ''), nullif(btrim(d.bio), '')) into v_text
  from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_club;
  if v_text = 'The club''s own words.' then
    raise notice 'PASS 7 (C): the club''s own bio outranks the directory seed';
  else
    raise notice 'FAIL 7 (C): resolved to %', coalesce(v_text, '(null)');
  end if;

  select bio into v_text from public.club_directory where id = v_dir_claimed;
  if v_text = 'Directory description.' then
    raise notice 'PASS 8 (C): the club writing its own bio does not overwrite the directory seed';
  else
    raise notice 'FAIL 8 (C): directory bio is now %', coalesce(v_text, '(null)');
  end if;

  -- Clearing the club's own value falls back rather than showing blank.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated', 'email','dpadmin@ovalball-test.invalid')::text, true);
  set local role authenticated;
  update public.clubs set bio = '   ' where id = v_club;
  reset role;
  select coalesce(nullif(btrim(c.bio), ''), nullif(btrim(d.bio), '')) into v_text
  from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_club;
  if v_text = 'Directory description.' then
    raise notice 'PASS 9 (C): a blanked club bio falls back to the directory, not to empty';
  else
    raise notice 'FAIL 9 (C): resolved to %', coalesce(v_text, '(null)');
  end if;

  -- =================================================================
  -- D. The columns stay a genuine fallback, not a second source of truth
  -- =================================================================
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from information_schema.columns
  where table_schema='public' and table_name='club_directory'
    and column_name in ('bio','facebook_url')
    and (is_nullable = 'NO' or column_default is not null);
  if v_count = 0 then
    raise notice 'PASS 10 (D): directory profile columns are nullable with no default';
  else
    raise notice 'FAIL 10 (D): % column(s) would outrank a club''s own value', v_count;
  end if;

  -- Nothing copies between the tables: no trigger on either side touches
  -- the other's bio. If one is ever added, this fails and the "no sync
  -- step" claim in the docs has to be revisited.
  select count(*) into v_count
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
  where c.relname in ('clubs','club_directory') and not t.tgisinternal
    and (p.prosrc like '%club_directory%bio%' or p.prosrc like '%clubs%bio%');
  if v_count = 0 then
    raise notice 'PASS 11 (D): no trigger copies bio between the two tables';
  else
    raise notice 'FAIL 11 (D): % trigger(s) sync bio', v_count;
  end if;

  -- =================================================================
  -- E. An unclaimed club is still not an activated club anywhere
  -- =================================================================
  -- The reason the invariant in A matters: activation counts read `clubs`.
  select count(*) into v_count from public.clubs c
  join public.club_directory d on d.id = c.directory_id
  where d.normalized_key = 'dp-unclaimed';
  if v_count = 0 then
    raise notice 'PASS 12 (E): the profiled-but-unclaimed club counts as zero activated clubs';
  else
    raise notice 'FAIL 12 (E): it is being counted as activated';
  end if;
end;
$$;

rollback;
