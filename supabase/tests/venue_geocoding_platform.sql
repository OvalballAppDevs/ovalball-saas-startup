-- THE PLATFORM PINS A VENUE (CA-M3) -- permanent regression.
--
-- Pins: recording a postcode from either client's save enqueues a platform lookup (a pg_net request
-- row appears; no client ever calls a provider); the one writer of a pin refuses a stale answer
-- whose postcode no longer matches; a successful answer records coordinates, a 404 records
-- 'failed' with no coordinates, and no answer leaves the venue 'pending' for the next pass; a
-- venue with no postcode is 'no_postcode'; set_venue_address remains the only writer of an address
-- column; the scheduled pass exists; the re-request RPC asks the venue manager's authority; anon
-- holds nothing. No live HTTP is needed: answers are simulated by writing net._http_response rows
-- for the requests the platform issued, exactly as the worker would.
--
-- Wrapped in begin/rollback: leaves the database (and the pg_net queue) exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_venue uuid; v_venue2 uuid;
  v_req bigint; v_n int; v_state text; v_writers text;
  v_row record;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_admin, 'geo-admin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_stranger, 'geo-stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Geocode Club', 'union', 'England', 'England', 'manual', 'verified', 'geocode-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'geocode-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 1. a save with a postcode enqueues a platform lookup; the client wrote no coordinate
  v_venue := public.save_club_venue(v_club, null, 'Geo Ground', '', '1 Pin Lane', '', 'Ovaltown', '', 'BB10 2LS', '', false);
  select geocode_status, latitude into v_row from public.venues where id = v_venue;
  select q.request_id into v_req from internal.venue_geocode_requests q where q.venue_id = v_venue;
  if v_row.geocode_status = 'pending' and v_row.latitude is null and v_req is not null then
    raise notice 'PASS 1: recording a postcode leaves the venue pending and issues a platform lookup (request %)', v_req;
  else raise notice 'FAIL 1: status % lat % request %', v_row.geocode_status, v_row.latitude, v_req; end if;
  if exists (select 1 from net.http_request_queue where id = v_req and url like 'https://api.postcodes.io/postcodes/BB102LS%') then
    raise notice 'PASS 1b: the request is to postcodes.io for the canonical postcode, issued by the platform';
  else raise notice 'FAIL 1b: no queued request for the postcode'; end if;

  -- 2. the worker answers: simulate the provider's 200 and collect
  delete from net.http_request_queue where id = v_req;
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
  values (v_req, 200, 'application/json', '{}'::jsonb, '{"status":200,"result":{"postcode":"BB10 2LS","latitude":53.819394,"longitude":-2.233}}', false, null, now());
  select internal.collect_venue_geocodes() into v_n;
  select geocode_status, latitude, longitude, geocode_source into v_row from public.venues where id = v_venue;
  if v_n = 1 and v_row.geocode_status = 'success' and v_row.latitude = 53.819394 and v_row.longitude = -2.233 and v_row.geocode_source = 'postcodes.io' then
    raise notice 'PASS 2: the platform records the provider''s answer as the venue''s pin';
  else raise notice 'FAIL 2: n=% row=%', v_n, v_row; end if;
  if not exists (select 1 from internal.venue_geocode_requests where venue_id = v_venue) then raise notice 'PASS 2b: the request is closed';
  else raise notice 'FAIL 2b: request still open'; end if;

  -- 3. a postcode change resets the pin and asks again; a STALE answer for the old postcode is refused
  perform public.save_club_venue(v_club, v_venue, 'Geo Ground', '', '1 Pin Lane', '', 'Ovaltown', '', 'BB11 1AA', '', false);
  select geocode_status, latitude into v_row from public.venues where id = v_venue;
  select q.request_id into v_req from internal.venue_geocode_requests q where q.venue_id = v_venue;
  if v_row.geocode_status = 'pending' and v_row.latitude is null and v_req is not null then raise notice 'PASS 3: a postcode change clears the pin and issues a new lookup';
  else raise notice 'FAIL 3: %', v_row; end if;
  if not internal.record_venue_geocode(v_venue, 'BB10 2LS', 1, 1, 'success', 'postcodes.io') then raise notice 'PASS 3b: an answer for the OLD postcode is refused -- no stale pin';
  else raise notice 'FAIL 3b: a stale answer was recorded'; end if;

  -- 4. the provider does not know the postcode: failed, no coordinates, venue kept
  delete from net.http_request_queue where id = v_req;
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
  values (v_req, 404, 'application/json', '{}'::jsonb, '{"status":404,"error":"Postcode not found"}', false, null, now());
  perform internal.collect_venue_geocodes();
  select geocode_status, latitude, active into v_row from public.venues where id = v_venue;
  if v_row.geocode_status = 'failed' and v_row.latitude is null and v_row.active then raise notice 'PASS 4: an unknown postcode is recorded as failed, with no guessed pin, and the venue is kept';
  else raise notice 'FAIL 4: %', v_row; end if;

  -- 5. a network failure leaves the venue pending for the next pass
  perform public.request_venue_geocoding(v_venue);
  select q.request_id into v_req from internal.venue_geocode_requests q where q.venue_id = v_venue;
  delete from net.http_request_queue where id = v_req;
  insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
  values (v_req, null, null, null, null, true, 'Timeout was reached', now());
  perform internal.collect_venue_geocodes();
  select geocode_status into v_row from public.venues where id = v_venue;
  select count(*) into v_n from internal.venue_geocode_requests where venue_id = v_venue;
  if v_row.geocode_status = 'pending' and v_n = 0 then raise notice 'PASS 5: a provider timeout leaves the venue pending; the scheduled pass will ask again';
  else raise notice 'FAIL 5: status % open requests %', v_row.geocode_status, v_n; end if;
  select internal.geocode_pending_venues() into v_n;
  if v_n >= 1 and exists (select 1 from internal.venue_geocode_requests where venue_id = v_venue) then raise notice 'PASS 5b: the scheduled pass re-requests a pending venue';
  else raise notice 'FAIL 5b: re-request count %', v_n; end if;

  -- 6. no postcode: no_postcode, no request
  v_venue2 := public.save_club_venue(v_club, null, 'Geo Field', '', 'Top Field', '', 'Ovaltown', '', '', '', false);
  select geocode_status into v_row from public.venues where id = v_venue2;
  if v_row.geocode_status = 'no_postcode' and not exists (select 1 from internal.venue_geocode_requests where venue_id = v_venue2) then raise notice 'PASS 6: a venue without a postcode is no_postcode and asks nobody';
  else raise notice 'FAIL 6: %', v_row.geocode_status; end if;

  -- 7. only a venue manager may ask again
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.request_venue_geocoding(v_venue);
    raise notice 'FAIL 7: a stranger re-requested a geocode';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS 7: re-requesting a pin needs venue.venue.manage';
    else raise notice 'FAIL 7: %', v_state; end if;
  end;

  -- 8. structural invariants
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f' and p.prosrc ~ 'update\s+public\.venues' and p.prosrc ~ '(address_line_1|address\s*=|postcode\s*=)';
  if v_writers = 'set_venue_address' then raise notice 'PASS 8: set_venue_address is still the only writer of an address column';
  else raise notice 'FAIL 8: address writers: %', v_writers; end if;
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f' and p.prosrc ~ 'update\s+public\.venues' and p.prosrc ~ 'latitude\s*=';
  if v_writers = 'record_venue_geocode, set_venue_address' then raise notice 'PASS 8b: a pin is written only by the platform recorder (and the address writer''s coalesce)';
  else raise notice 'FAIL 8b: pin writers: %', v_writers; end if;
  if exists (select 1 from cron.job where jobname = 'process-venue-geocoding') then raise notice 'PASS 8c: the platform pass is scheduled';
  else raise notice 'FAIL 8c: no scheduled pass'; end if;
  if has_function_privilege('anon', 'public.request_venue_geocoding(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.geocode_pending_venues()', 'EXECUTE')
     or has_function_privilege('authenticated', 'internal.record_venue_geocode(uuid, text, numeric, numeric, text, text)', 'EXECUTE') then
    raise notice 'FAIL 8d: a geocoding function is too widely executable';
  else raise notice 'PASS 8d: anon asks nothing; clients cannot record a pin'; end if;
end $$;

rollback;
