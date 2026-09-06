-- Club Kit -- canonical playing-kit configuration.
--
-- Foundation for the future Matchday invitation. What matters here is that
-- kit is CLUB-level presentation data with a controlled vocabulary and
-- server-validated colours, that it is not identity, and that one club
-- cannot touch another's.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin_a uuid := gen_random_uuid();   -- Club Admin, club A
  v_admin_b uuid := gen_random_uuid();   -- Club Admin, club B
  v_coach   uuid := gen_random_uuid();   -- Coach at club A (no edit_profile)
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_kit uuid; v_kit2 uuid;
  v_count int; v_text text; v_int int;
  v_before int; v_after int;
  v_pattern text;
  v_ok boolean;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin_a,'kitadmina@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin_b,'kitadminb@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_coach,  'kitcoach@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin_a,'Kit','AdminA','kitadmina@ovalball-test.invalid'),
    (v_admin_b,'Kit','AdminB','kitadminb@ovalball-test.invalid'),
    (v_coach,'Kit','Coach','kitcoach@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Kit Test A RUFC','union','England','England','manual','verified','kit-test-a'),
    ('Kit Test B RUFC','union','England','England','manual','verified','kit-test-b');
  select id into v_dir_a from public.club_directory where normalized_key='kit-test-a';
  select id into v_dir_b from public.club_directory where normalized_key='kit-test-b';
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'kit-test-a','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'kit-test-b','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN','active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN','active'),
    (v_club_a, v_coach,   'BASIC_USER','active');

  -- ============ A/C. a valid primary kit saves ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  v_kit := public.upsert_club_kit(v_club_a, 'HOOPS', '#5aa9e6', '#7a1f3d', '#7a1f3d');

  select count(*) into v_count from public.club_kits where club_id = v_club_a and variant = 'primary';
  if v_count = 1 and v_kit is not null then
    raise notice 'PASS 1 (A/C): a valid primary kit is stored once';
  else
    raise notice 'FAIL 1 (A/C): % kit rows', v_count;
  end if;

  -- colours are normalised to lower case, so #AABBCC and #aabbcc are one value
  v_kit2 := public.upsert_club_kit(v_club_a, 'HOOPS', '#5AA9E6', '#7A1F3D', null);
  select primary_colour into v_text from public.club_kits where id = v_kit;
  if v_text = '#5aa9e6' then
    raise notice 'PASS 2: colours are normalised to lower case';
  else
    raise notice 'FAIL 2: stored colour is %', v_text;
  end if;

  -- ============ B. controlled pattern vocabulary only ============
  begin
    perform public.upsert_club_kit(v_club_a, 'STRIPEY', '#5aa9e6', '#7a1f3d');
    raise notice 'FAIL 3 (B): an arbitrary pattern name was accepted';
  exception when check_violation then
    raise notice 'PASS 3 (B): only controlled pattern keys are accepted';
  end;

  -- every pattern the renderer supports must be storable, and vice versa
  select count(*)::int into v_count
  from unnest(array['SOLID','HOOPS','HORIZONTAL_BANDS','VERTICAL_STRIPES','HALVES','QUARTERS','SASH','CHEST_BAND','CONTRAST_SLEEVES']) p
  where position('''' || p || '''' in pg_get_constraintdef(
    (select oid from pg_constraint where conname = 'club_kits_pattern_check'))) = 0;
  if v_count = 0 then
    raise notice 'PASS 4 (J): every renderer pattern is accepted by the database';
  else
    raise notice 'FAIL 4 (J): % renderer pattern(s) rejected by the constraint', v_count;
  end if;

  -- ============ D. invalid colour rejected SERVER-side ============
  begin
    perform public.upsert_club_kit(v_club_a, 'SOLID', 'burgundy');
    raise notice 'FAIL 5 (D): a named colour was accepted';
  exception when check_violation then
    raise notice 'PASS 5 (D): a non-hex colour is rejected by the database, not the browser';
  end;

  begin
    perform public.upsert_club_kit(v_club_a, 'SOLID', '#12345');
    raise notice 'FAIL 6 (D): a malformed hex was accepted';
  exception when check_violation then
    raise notice 'PASS 6 (D): a malformed hex colour is rejected';
  end;

  -- a two-tone pattern cannot be stored without its second colour
  begin
    perform public.upsert_club_kit(v_club_a, 'HALVES', '#5aa9e6', null);
    raise notice 'FAIL 7: a two-tone pattern was stored with no secondary colour';
  exception when check_violation then
    raise notice 'PASS 7: a two-tone pattern requires a secondary colour';
  end;

  -- ============ G. retry does not duplicate ============
  select count(*) into v_before from public.club_kits where club_id = v_club_a;
  perform public.upsert_club_kit(v_club_a, 'SASH', '#046a38', '#ffffff');
  perform public.upsert_club_kit(v_club_a, 'SASH', '#046a38', '#ffffff');
  perform public.upsert_club_kit(v_club_a, 'SASH', '#046a38', '#ffffff');
  select count(*) into v_after from public.club_kits where club_id = v_club_a;
  select pattern into v_pattern from public.club_kits where club_id = v_club_a and variant = 'primary';
  if v_before = v_after and v_pattern = 'SASH' then
    raise notice 'PASS 8 (G): a retried save updates the same row -- no duplicate kit';
  else
    raise notice 'FAIL 8 (G): kit rows % -> %', v_before, v_after;
  end if;

  -- ============ K. the alternate kit is optional and separate ============
  select count(*) into v_count from public.club_kits where club_id = v_club_a and variant = 'alternate';
  if v_count = 0 then
    raise notice 'PASS 9 (K): a club with only a home kit is valid -- away is not required';
  else
    raise notice 'FAIL 9 (K): an alternate kit appeared without being set';
  end if;

  perform public.upsert_club_kit(v_club_a, 'SOLID', '#ffffff', null, null, 'alternate');
  select count(*) into v_count from public.club_kits where club_id = v_club_a;
  if v_count = 2 then
    raise notice 'PASS 10 (K): home and away are separate rows for the same club';
  else
    raise notice 'FAIL 10 (K): % kit rows after adding an alternate', v_count;
  end if;

  -- saving the away kit must not disturb the home kit
  select pattern into v_pattern from public.club_kits where club_id = v_club_a and variant = 'primary';
  if v_pattern = 'SASH' then
    raise notice 'PASS 11 (K): saving the away kit leaves the home kit untouched';
  else
    raise notice 'FAIL 11 (K): home kit became %', v_pattern;
  end if;

  -- ============ E/F. kit belongs to its club, and only its club ============
  select club_id into v_text from public.club_kits where id = v_kit;
  if v_text = v_club_a::text then
    raise notice 'PASS 12 (E): the kit belongs to the club that created it';
  else
    raise notice 'FAIL 12 (E): kit club_id is %', v_text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated')::text, true);
  begin
    perform public.upsert_club_kit(v_club_a, 'SOLID', '#000000');
    raise notice 'FAIL 13 (F): Club B''s admin changed Club A''s kit';
  exception when insufficient_privilege then
    raise notice 'PASS 13 (F): a Club Admin cannot change another club''s kit';
  end;

  -- a coach at the SAME club has no profile-edit authority either
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated')::text, true);
  begin
    perform public.upsert_club_kit(v_club_a, 'SOLID', '#000000');
    raise notice 'FAIL 14 (F): a non-admin member changed the club kit';
  exception when insufficient_privilege then
    raise notice 'PASS 14 (F): kit editing requires club.edit_profile';
  end;

  select has_function_privilege('anon','public.upsert_club_kit(uuid,text,text,text,text,text)','EXECUTE') into v_ok;
  if not v_ok then
    raise notice 'PASS 15 (F): anon holds no EXECUTE grant on the kit RPC';
  else
    raise notice 'FAIL 15 (F): anon can execute the kit RPC';
  end if;

  -- ============ H/I. kit, identity and logo are independent ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);

  select slug into v_text from public.clubs where id = v_club_a;
  perform public.upsert_club_kit(v_club_a, 'QUARTERS', '#f2a900', '#111111');
  select count(*) into v_count from public.clubs where id = v_club_a and slug = v_text and directory_id = v_dir_a;
  if v_count = 1 then
    raise notice 'PASS 16 (H): changing the kit does not touch club identity';
  else
    raise notice 'FAIL 16 (H): club identity changed with the kit';
  end if;

  -- kit carries no logo, and the logo column carries no kit
  update public.clubs set logo_storage_path = 'club-logos/kit-test-a.png' where id = v_club_a;
  select pattern into v_pattern from public.club_kits where club_id = v_club_a and variant = 'primary';
  if v_pattern = 'QUARTERS' then
    raise notice 'PASS 17 (I): changing the logo does not alter the kit';
  else
    raise notice 'FAIL 17 (I): kit changed to % when the logo was set', v_pattern;
  end if;

  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='club_kits'
    and (column_name ilike '%logo%' or column_name ilike '%image%' or column_name ilike '%url%' or column_name ilike '%path%');
  if v_count = 0 then
    raise notice 'PASS 18: the kit stores configuration, never an image reference';
  else
    raise notice 'FAIL 18: club_kits has % image-ish column(s)', v_count;
  end if;

  -- ============ L. kit belongs to the CLUB, never to teams ============
  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='teams'
    and (column_name ilike '%kit%' or column_name ilike '%colour%' or column_name ilike '%color%');
  if v_count = 0 then
    raise notice 'PASS 19 (L): kit colours are not duplicated onto teams';
  else
    raise notice 'FAIL 19 (L): teams gained % kit column(s)', v_count;
  end if;

  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='club_kits' and column_name = 'team_id';
  if v_count = 0 then
    raise notice 'PASS 20 (L): kit is club-level -- no team_id on club_kits';
  else
    raise notice 'FAIL 20 (L): club_kits carries a team_id';
  end if;

  -- ============ L (unclaimed opposition). no fake club needed ============
  -- A directory club with no `clubs` row has no kit and needs none: the
  -- fixture card renders a placeholder rather than inventing colours.
  select count(*) into v_count
  from public.club_directory d
  left join public.clubs c on c.directory_id = d.id
  where c.id is null;
  if v_count > 0 then
    raise notice 'PASS 21 (L): unclaimed directory clubs exist with no clubs row and no kit (%)', v_count;
  else
    raise notice 'FAIL 21 (L): no unclaimed directory club to verify against';
  end if;

  select count(*) into v_count from public.club_kits k
  join public.clubs c on c.id = k.club_id;
  select count(*) into v_int from public.club_kits;
  if v_count = v_int then
    raise notice 'PASS 22 (L): every kit belongs to a real activated club -- none invented for opposition';
  else
    raise notice 'FAIL 22 (L): % of % kits have no club', v_int - v_count, v_int;
  end if;

  -- ============ M. the Matchday identity contract ============
  -- The fixture card's second line must come from the season-aware team
  -- identity resolver, never from the club name or a mutable display name.
  select count(*)::int into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('get_team_identity_for_season','project_team_identity');
  if v_count >= 2 then
    raise notice 'PASS 23 (M): the season-aware team identity resolvers exist for Matchday to consume';
  else
    raise notice 'FAIL 23 (M): only % identity resolver(s) found', v_count;
  end if;

  -- and fixtures already snapshot the team's display name at the time,
  -- which is what keeps a historical Under 12 fixture reading Under 12
  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='fixtures'
    and column_name in ('owning_team_display_name_snapshot','owning_team_age_group_snapshot');
  if v_count = 2 then
    raise notice 'PASS 24 (M): fixtures snapshot team identity, so age-grade history stays accurate';
  else
    raise notice 'FAIL 24 (M): % identity snapshot column(s) on fixtures', v_count;
  end if;

  -- ============ N/O. youth photo safety ============
  -- Players carry no avatar column at all today, so no youth photograph can
  -- be required, exposed, or made a condition of taking part.
  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='players'
    and (column_name ilike '%avatar%' or column_name ilike '%photo%' or column_name ilike '%image%');
  if v_count = 0 then
    raise notice 'PASS 25 (N/O): players hold no photograph -- participation cannot depend on one';
  else
    raise notice 'FAIL 25 (N/O): players gained % photo column(s) with no consent model', v_count;
  end if;

  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='player_fixture_attendance'
    and (column_name ilike '%avatar%' or column_name ilike '%photo%' or column_name ilike '%url%');
  if v_count = 0 then
    raise notice 'PASS 26 (N): attendance rows carry no avatar copy -- identity resolves through the person';
  else
    raise notice 'FAIL 26 (N): attendance carries % avatar-ish column(s)', v_count;
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
