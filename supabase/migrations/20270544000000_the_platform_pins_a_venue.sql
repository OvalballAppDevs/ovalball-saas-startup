-- ===========================================================================
-- THE PLATFORM PINS A VENUE (CA-M3, geocoding convergence)
-- ===========================================================================
--
-- THE FINDING. A venue's pin (latitude/longitude from its postcode, via postcodes.io) was derived
-- by the WEBSITE: a Next.js action ran after each web save, and a Site Admin button ran a backfill.
-- Both wrote `public.venues` directly from `lib/geocoding/backfill.ts`. A venue saved from the app
-- therefore sat at `geocode_status = 'pending'` until somebody used the website. That is a client
-- dependency inside the domain, and CA-M2 reported it as such.
--
-- THE ARCHITECTURE. Geocoding is a platform concern, so it now runs IN the platform:
--
--   save_club_venue / set_venue_address  (either client)
--        │  postcode recorded, status 'pending'  (reset trigger on change)
--        ▼
--   venues_request_geocode (AFTER trigger)  ──►  internal.request_venue_geocode
--        │                                        pg_net: GET api.postcodes.io/postcodes/<pc>
--        ▼                                        (keyless public API; no secret anywhere)
--   pg_cron every minute: internal.process_venue_geocoding
--        ├─ collect_venue_geocodes: read net._http_response, record success / failed
--        └─ geocode_pending_venues: re-request anything still pending (retry, restart, backfill)
--        ▼
--   internal.record_venue_geocode  -- the one writer of a pin; refuses a stale answer
--                                     (the postcode must still be the one that was asked about)
--
-- No client calls a geocoding provider, ships a key, or writes a coordinate. Both clients read the
-- same `geocode_status` and show a map only for 'success' (packages/contracts/src/fixtures/venue.ts,
-- club/venues.ts). A provider failure never loses a venue: the venue is saved, the status says
-- 'failed', and the next postcode edit or the scheduled pass tries again. No guessed pin, ever.
--
-- `set_venue_address` stays the one writer of the ADDRESS columns (20270509's assertion holds:
-- nothing here writes address_line_1, address or postcode). Forward-only; no data changed.
-- ===========================================================================

create extension if not exists pg_net;

create table if not exists internal.venue_geocode_requests (
  request_id bigint primary key,
  venue_id uuid not null references public.venues(id) on delete cascade,
  postcode text not null,
  requested_at timestamptz not null default now()
);
create index if not exists venue_geocode_requests_venue_idx on internal.venue_geocode_requests(venue_id);
revoke all on internal.venue_geocode_requests from public, anon, authenticated;

comment on table internal.venue_geocode_requests is
  'Outstanding postcodes.io lookups issued by the platform for venues at geocode_status = pending. One row per pg_net request; collected by internal.collect_venue_geocodes.';

-- ---------------------------------------------------------------------------
-- The one writer of a pin
-- ---------------------------------------------------------------------------
create or replace function internal.record_venue_geocode(
  p_venue_id uuid,
  p_postcode text,
  p_latitude numeric,
  p_longitude numeric,
  p_status text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  if p_status not in ('success', 'failed', 'no_postcode') then
    raise exception 'Unknown geocode status %', p_status using errcode = '22023';
  end if;
  if p_status = 'success' and (p_latitude is null or p_longitude is null) then
    raise exception 'A successful geocode needs both coordinates.' using errcode = '22023';
  end if;
  -- A STALE ANSWER IS NOT AN ANSWER. If the postcode changed after this lookup was issued, the
  -- reset trigger already put the row back to pending and a fresh request follows; this one is dropped.
  update public.venues v
  set latitude = case when p_status = 'success' then p_latitude else null end,
      longitude = case when p_status = 'success' then p_longitude else null end,
      geocoded_at = now(),
      geocode_status = p_status,
      geocode_source = p_source
  where v.id = p_venue_id
    and v.postcode is not distinct from p_postcode;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ask the provider (through the platform's own HTTP worker)
-- ---------------------------------------------------------------------------
create or replace function internal.request_venue_geocode(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_postcode text;
  v_request bigint;
begin
  select v.postcode into v_postcode from public.venues v where v.id = p_venue_id;
  if v_postcode is null or btrim(v_postcode) = '' then
    perform internal.record_venue_geocode(p_venue_id, v_postcode, null, null, 'no_postcode', 'platform');
    return;
  end if;
  delete from internal.venue_geocode_requests q where q.venue_id = p_venue_id;
  select net.http_get(
    url := 'https://api.postcodes.io/postcodes/' || regexp_replace(upper(btrim(v_postcode)), '[^A-Z0-9]', '', 'g'),
    timeout_milliseconds := 8000
  ) into v_request;
  insert into internal.venue_geocode_requests (request_id, venue_id, postcode) values (v_request, p_venue_id, v_postcode);
end;
$function$;

-- Every venue at 'pending' with no live request (or one older than ten minutes) is asked again.
create or replace function internal.geocode_pending_venues()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_n int := 0;
begin
  for v_id in
    select v.id from public.venues v
    where v.geocode_status = 'pending'
      and not exists (select 1 from internal.venue_geocode_requests q where q.venue_id = v.id and q.requested_at > now() - interval '10 minutes')
    order by v.updated_at
    limit 100
  loop
    perform internal.request_venue_geocode(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- Read the answers the worker has collected and record them.
create or replace function internal.collect_venue_geocodes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_body jsonb;
  v_n int := 0;
begin
  for r in
    select q.request_id, q.venue_id, q.postcode, h.status_code, h.content, h.error_msg
    from internal.venue_geocode_requests q
    join net._http_response h on h.id = q.request_id
  loop
    if r.status_code = 200 then
      begin
        v_body := r.content::jsonb;
      exception when others then
        v_body := null;
      end;
      if v_body is not null and (v_body -> 'result' ->> 'latitude') is not null and (v_body -> 'result' ->> 'longitude') is not null then
        perform internal.record_venue_geocode(r.venue_id, r.postcode, (v_body -> 'result' ->> 'latitude')::numeric, (v_body -> 'result' ->> 'longitude')::numeric, 'success', 'postcodes.io');
      else
        perform internal.record_venue_geocode(r.venue_id, r.postcode, null, null, 'failed', 'postcodes.io');
      end if;
      v_n := v_n + 1;
    elsif r.status_code = 404 then
      -- The provider does not know this postcode: a real answer, recorded as failed, no guess.
      perform internal.record_venue_geocode(r.venue_id, r.postcode, null, null, 'failed', 'postcodes.io');
      v_n := v_n + 1;
    end if;
    -- Any other outcome (network error, 5xx) leaves the venue pending; the request row goes so the
    -- next scheduled pass asks again.
    delete from internal.venue_geocode_requests q where q.request_id = r.request_id;
  end loop;
  return v_n;
end;
$function$;

create or replace function internal.process_venue_geocoding()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform internal.collect_venue_geocodes();
  perform internal.geocode_pending_venues();
end;
$function$;

-- A pending venue is asked about the moment its postcode is recorded, from either client.
create or replace function internal.venues_request_geocode_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.geocode_status = 'pending' then
    perform internal.request_venue_geocode(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists venues_request_geocode on public.venues;
create trigger venues_request_geocode
  after insert or update of postcode, geocode_status on public.venues
  for each row execute function internal.venues_request_geocode_trigger();

-- The scheduled pass: collect answers, retry anything still pending.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-venue-geocoding') then
    perform cron.unschedule('process-venue-geocoding');
  end if;
  perform cron.schedule('process-venue-geocoding', '* * * * *', 'select internal.process_venue_geocoding()');
end $$;

-- ---------------------------------------------------------------------------
-- What a client may ask for: "ask again", nothing more
-- ---------------------------------------------------------------------------
create or replace function public.request_venue_geocoding(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid;
begin
  select v.club_id into v_club from public.venues v where v.id = p_venue_id;
  if v_club is null then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() or not internal.can_manage_venue(v_club) then
    raise exception 'You do not have permission to manage this club''s venues.' using errcode = '42501';
  end if;
  update public.venues set geocode_status = 'pending', geocoded_at = null, geocode_source = null where id = p_venue_id and geocode_status <> 'pending';
  perform internal.request_venue_geocode(p_venue_id);
end;
$function$;

-- The Site Admin backfill button: enqueue everything pending; the platform does the rest.
create or replace function public.geocode_pending_venues()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not internal.session_ok() or not internal.has_site_capability('site.clubs.profile.manage') then
    raise exception 'Only a Site Admin may run the venue geocoding pass.' using errcode = '42501';
  end if;
  perform internal.collect_venue_geocodes();
  return internal.geocode_pending_venues();
end;
$function$;

revoke execute on function internal.record_venue_geocode(uuid, text, numeric, numeric, text, text) from public, anon, authenticated;
revoke execute on function internal.request_venue_geocode(uuid) from public, anon, authenticated;
revoke execute on function internal.geocode_pending_venues() from public, anon, authenticated;
revoke execute on function internal.collect_venue_geocodes() from public, anon, authenticated;
revoke execute on function internal.process_venue_geocoding() from public, anon, authenticated;
revoke execute on function public.request_venue_geocoding(uuid) from public, anon;
revoke execute on function public.geocode_pending_venues() from public, anon;
grant execute on function public.request_venue_geocoding(uuid) to authenticated, service_role;
grant execute on function public.geocode_pending_venues() to authenticated, service_role;

-- pg_net's schema carries the extension's own default grants (made by supabase_admin, which the
-- migration role cannot revoke). It is not an API-exposed schema -- PostgREST serves only the schemas
-- the perimeter manifest lists (public, graphql_public) -- so no browser role can reach net.* over
-- the API; the assertion below pins that.

do $$
declare v_writers text;
begin
  -- set_venue_address is still the only writer of an address column
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f'
    and p.prosrc ~ 'update\s+public\.venues'
    and p.prosrc ~ '(address_line_1|address\s*=|postcode\s*=)';
  if v_writers <> 'set_venue_address' then
    raise exception 'a venue address must have exactly one writer; found: %', v_writers;
  end if;
  if not exists (select 1 from cron.job where jobname = 'process-venue-geocoding') then
    raise exception 'the venue geocoding pass is not scheduled';
  end if;
  if has_function_privilege('anon', 'public.request_venue_geocoding(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.geocode_pending_venues()', 'EXECUTE') then
    raise exception 'geocoding requests must not be executable by anon';
  end if;
  if coalesce(current_setting('pgrst.db_schemas', true), 'public, graphql_public') ~ '\mnet\M' then
    raise exception 'the net schema must not be exposed through the API';
  end if;
end $$;
