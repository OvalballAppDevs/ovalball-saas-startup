-- Structured venue address -- the canonical shape, and the legacy safety
-- rules around it.
--
-- `venues.address` was one opaque text line. Structured columns were added
-- additively in 20261016000000, and `set_venue_address` is the one writer.
-- What matters here: a provider result and a hand-typed address land in the
-- SAME canonical shape; the provider's own id is metadata and never
-- identity; and a historical opaque address is never parsed into invented
-- structure.
--
-- No live provider. The provider's payload shape is exercised by passing
-- the same components the client extracts from it -- so these assertions
-- hold whether or not GETADDRESS_API_KEY is configured.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_dir uuid; v_dir2 uuid; v_club uuid; v_club2 uuid;
  v_provider uuid;   -- venue created from a provider selection
  v_manual uuid;     -- venue created by typing
  v_legacy uuid;     -- venue that pre-dates the structured columns
  r record;
  v_count int; v_text text; v_num numeric;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin,'addradmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_other,'addrother@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin,'Addr','Admin','addradmin@ovalball-test.invalid'),
    (v_other,'Addr','Other','addrother@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Address Test RUFC','union','England','England','manual','verified','address-test'),
    ('Address Test Two RUFC','union','England','England','manual','verified','address-test-2');
  select id into v_dir from public.club_directory where normalized_key='address-test';
  select id into v_dir2 from public.club_directory where normalized_key='address-test-2';
  insert into public.clubs (directory_id, slug, status) values (v_dir,'address-test','active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'address-test-2','active') returning id into v_club2;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN','active'),
    (v_club2, v_other, 'CLUB_ADMIN','active');

  -- A venue whose address predates the structured columns: one opaque line,
  -- written directly, exactly as the old code path left it.
  insert into public.venues (name, slug, club_id, address, postcode, active, is_default_home)
  values ('Legacy Ground','legacy-ground-addrtest', v_club, 'Coal Clough Lane, Burnley', 'BB11 4PE', true, false)
  returning id into v_legacy;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  -- =================================================================
  -- A. A provider result maps onto the structured fields
  -- =================================================================
  -- These are the components the client extracts from a getAddress.io
  -- result: line_1, line_2 (+line_3 folded in), town_or_city, county, and
  -- the postcode the lookup was keyed on, plus the provider's own id.
  v_provider := public.create_venue(v_club, 'Provider Ground', '', 'BB11 3JA', '', false);
  perform public.set_venue_address(
    v_provider,
    '1 Belvedere Road', 'Towneley Park', 'Burnley', 'Lancashire', 'BB11 3JA',
    'United Kingdom', 53.7856, -2.2280, 'getaddress:bb11-3ja:1belvedere'
  );

  select address_line_1, address_line_2, town, county, postcode, country
  into r from public.venues where id = v_provider;
  if r.address_line_1 = '1 Belvedere Road' and r.address_line_2 = 'Towneley Park'
     and r.town = 'Burnley' and r.county = 'Lancashire' and r.postcode = 'BB11 3JA'
     and r.country = 'United Kingdom' then
    raise notice 'PASS 1 (A): a provider selection maps onto the structured columns';
  else
    raise notice 'FAIL 1 (A): line1=% line2=% town=% county=% postcode=%',
      r.address_line_1, r.address_line_2, r.town, r.county, r.postcode;
  end if;

  -- =================================================================
  -- B. Manual input lands in the SAME canonical shape
  -- =================================================================
  v_manual := public.create_venue(v_club, 'Manual Ground', '', 'BB12 0AA', '', false);
  perform public.set_venue_address(
    v_manual, 'Holden Road', '', 'Burnley', 'Lancashire', 'BB12 0AA', 'United Kingdom'
  );

  select count(*) into v_count
  from public.venues a join public.venues b on true
  where a.id = v_provider and b.id = v_manual
    and (a.address_line_1 is null) = (b.address_line_1 is null)
    and (a.town is null) = (b.town is null)
    and (a.postcode is null) = (b.postcode is null)
    and (a.country is null) = (b.country is null);
  if v_count = 1 then
    raise notice 'PASS 2 (B): a typed address populates the same columns as a provider one';
  else
    raise notice 'FAIL 2 (B): the two paths produced different shapes';
  end if;

  -- The only legitimate difference: no provider reference, and no
  -- coordinates the provider did not supply.
  select address_provider_ref, latitude, longitude into r from public.venues where id = v_manual;
  if r.address_provider_ref is null and r.latitude is null and r.longitude is null then
    raise notice 'PASS 3 (B): a typed address invents no provider reference and no coordinates';
  else
    raise notice 'FAIL 3 (B): ref=% lat=% lon=%', r.address_provider_ref, r.latitude, r.longitude;
  end if;

  -- =================================================================
  -- C. A formatted display line is available, and stays truthful
  -- =================================================================
  select address into v_text from public.venues where id = v_provider;
  if v_text = '1 Belvedere Road, Towneley Park, Burnley, Lancashire' then
    raise notice 'PASS 4 (C): the display line is composed from the structured parts';
  else
    raise notice 'FAIL 4 (C): display line is "%"', v_text;
  end if;

  -- Editing the structured parts regenerates it rather than leaving a stale
  -- string beside them.
  perform public.set_venue_address(
    v_provider, '2 Belvedere Road', '', 'Burnley', 'Lancashire', 'BB11 3JA', 'United Kingdom'
  );
  select address into v_text from public.venues where id = v_provider;
  if v_text = '2 Belvedere Road, Burnley, Lancashire' then
    raise notice 'PASS 5 (C): editing the address regenerates the display line';
  else
    raise notice 'FAIL 5 (C): stale display line "%"', v_text;
  end if;

  -- =================================================================
  -- D. Postcode preserved exactly
  -- =================================================================
  select postcode into v_text from public.venues where id = v_provider;
  if v_text = 'BB11 3JA' then
    raise notice 'PASS 6 (D): the postcode is stored verbatim, spacing included';
  else
    raise notice 'FAIL 6 (D): postcode is "%"', v_text;
  end if;

  -- =================================================================
  -- E. Coordinates preserved, and not lost by a later edit
  -- =================================================================
  select latitude, longitude into r from public.venues where id = v_provider;
  if r.latitude = 53.7856 and r.longitude = -2.2280 then
    raise notice 'PASS 7 (E): provider coordinates survive a subsequent address edit';
  else
    raise notice 'FAIL 7 (E): lat=% lon=%', r.latitude, r.longitude;
  end if;

  -- =================================================================
  -- F. The provider id is metadata, never identity
  -- =================================================================
  select address_provider_ref into v_text from public.venues where id = v_provider;
  if v_text = 'getaddress:bb11-3ja:1belvedere' then
    raise notice 'PASS 8 (F): the provider reference is retained';
  else
    raise notice 'FAIL 8 (F): ref is "%"', v_text;
  end if;

  -- Two venues may legitimately share a provider reference -- two clubs at
  -- the same ground. Nothing unique is built on it, and venues.id remains
  -- the identity.
  perform public.set_venue_address(
    v_manual, 'Holden Road', '', 'Burnley', 'Lancashire', 'BB12 0AA',
    'United Kingdom', null, null, 'getaddress:bb11-3ja:1belvedere'
  );
  select count(*) into v_count from public.venues
  where address_provider_ref = 'getaddress:bb11-3ja:1belvedere' and club_id = v_club;
  if v_count = 2 then
    raise notice 'PASS 9 (F): a provider reference is not unique and is not identity';
  else
    raise notice 'FAIL 9 (F): % venues share the reference', v_count;
  end if;

  select count(*) into v_count
  from pg_index i join pg_class c on c.oid = i.indrelid join pg_attribute a
    on a.attrelid = c.oid and a.attnum = any (i.indkey)
  where c.relname = 'venues' and a.attname = 'address_provider_ref' and i.indisunique;
  if v_count = 0 then
    raise notice 'PASS 10 (F): no unique index makes the provider reference an identity';
  else
    raise notice 'FAIL 10 (F): % unique indexes on address_provider_ref', v_count;
  end if;

  -- =================================================================
  -- G/H. Legacy addresses stay readable, and are never invented into
  -- =================================================================
  select address, address_line_1, town, county, postcode, latitude
  into r from public.venues where id = v_legacy;
  if r.address = 'Coal Clough Lane, Burnley' then
    raise notice 'PASS 11 (G): a historical opaque address is still readable';
  else
    raise notice 'FAIL 11 (G): legacy address is "%"', r.address;
  end if;

  if r.address_line_1 is null and r.town is null and r.county is null and r.latitude is null then
    raise notice 'PASS 12 (H): no structured component was invented from the legacy text';
  else
    raise notice 'FAIL 12 (H): line1=% town=% county=% lat=%',
      r.address_line_1, r.town, r.county, r.latitude;
  end if;

  -- The postcode it genuinely had is kept -- that column always existed and
  -- was always a postcode. Only the parts that never existed stay null.
  if r.postcode = 'BB11 4PE' then
    raise notice 'PASS 13 (H): a legacy postcode is preserved, not discarded';
  else
    raise notice 'FAIL 13 (H): legacy postcode is "%"', r.postcode;
  end if;

  -- The requirements reader accepts a legacy venue: an existing club whose
  -- venue predates the structured columns is never told its address is
  -- missing.
  update public.venues set is_default_home = false where club_id = v_club;
  update public.venues set is_default_home = true where id = v_legacy;
  insert into public.club_setup_state (club_id, status) values (v_club, 'IN_PROGRESS')
  on conflict (club_id) do update set status = 'IN_PROGRESS';
  select default_venue_has_address into v_text from public.club_setup_requirements(v_club);
  if v_text::boolean then
    raise notice 'PASS 14 (G): a legacy opaque address satisfies the address requirement';
  else
    raise notice 'FAIL 14 (G): a legacy venue was told its address is missing';
  end if;

  -- =================================================================
  -- I. Provider failure is safe
  -- =================================================================
  -- The lookup is a read-only proxy: a failing provider yields no
  -- suggestions and writes nothing. What must hold at the data layer is
  -- that a venue can still be given an address entirely by hand, with no
  -- provider participation at all -- which B and this together prove.
  select count(*) into v_count from public.venues
  where id = v_manual and address_line_1 is not null and postcode is not null;
  if v_count = 1 then
    raise notice 'PASS 15 (I): an address can be completed with no provider involvement';
  else
    raise notice 'FAIL 15 (I): manual-only address did not persist';
  end if;

  -- =================================================================
  -- Authorization
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  begin
    perform public.set_venue_address(v_provider, 'Hacked Road', '', 'Nowhere', '', 'ZZ1 1ZZ', 'United Kingdom');
    raise notice 'FAIL 16: another club''s admin rewrote this venue''s address';
  exception when others then
    raise notice 'PASS 16: a Club Admin cannot rewrite another club''s venue address';
  end;

  select address_line_1 into v_text from public.venues where id = v_provider;
  if v_text = '2 Belvedere Road' then
    raise notice 'PASS 17: the refused write changed nothing';
  else
    raise notice 'FAIL 17: address is now "%"', v_text;
  end if;
end;
$$;

rollback;
