-- ===========================================================================
-- A VENUE IS SAVED IN ONE OPERATION (CA-M2)
-- ===========================================================================
--
-- The website saved a club venue by choreography: `create_venue` (or `update_venue`), then
-- `set_venue_address` -- two round trips from a Next.js action, with "which order" and "what if the
-- second fails" living in TypeScript. A second client would have had to copy the choreography, and
-- a half-saved venue (named, unaddressed) was possible between the calls.
--
-- OWNER DECISION 3 -- DOMAIN OPERATION FIRST. `save_club_venue` is now the one way either client
-- names and addresses a club venue: one transaction, composed from the existing canonical
-- operations so that nothing about authority or validation moves --
--
--   create_venue / update_venue   name required, trimmed, unique per club (case-insensitive),
--                                 directions empty -> null, default handling; venue.venue.manage
--   set_venue_address             THE one writer of a venue's address columns (20270509): parts
--                                 trimmed, empty -> null, country defaults, display line regenerated,
--                                 existing coordinates and provider reference kept
--   set_default_venue             an inactive venue cannot become the default
--
-- Each of those still asks `internal.can_manage_venue` itself; this wrapper asks `internal.session_ok`
-- first so a stale or AAL-short session is refused before any of them runs, exactly as the row
-- policies would refuse a direct write. Coordinates are NOT taken here: the pin is derived from the
-- postcode by the geocoding step (postcodes.io) that the website runs after a save and the Site Admin
-- backfill runs at will -- a venue saved from the app is `geocode_status = 'pending'` until one of
-- those runs, and no surface offers a pending pin (see packages/contracts/src/fixtures/venue.ts).
--
-- Forward-only. No data changed. No grant widened.
-- ===========================================================================

create or replace function public.save_club_venue(
  p_club_id uuid,
  p_venue_id uuid default null,
  p_name text default null,
  p_directions text default null,
  p_line1 text default null,
  p_line2 text default null,
  p_town text default null,
  p_county text default null,
  p_postcode text default null,
  p_country text default null,
  p_set_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_club uuid;
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can_manage_venue(p_club_id) then
    raise exception 'You do not have permission to manage this club''s venues.' using errcode = '42501';
  end if;

  if p_venue_id is null then
    v_id := public.create_venue(p_club_id, p_name, p_directions, coalesce(p_set_default, false));
  else
    select v.club_id into v_club from public.venues v where v.id = p_venue_id;
    if v_club is null or v_club <> p_club_id then
      raise exception 'Venue not found.' using errcode = 'P0002';
    end if;
    perform public.update_venue(p_venue_id, p_name, p_directions);
    v_id := p_venue_id;
    if coalesce(p_set_default, false) then
      perform public.set_default_venue(p_venue_id);
    end if;
  end if;

  perform public.set_venue_address(v_id, p_line1, p_line2, p_town, p_county, p_postcode, p_country, null, null, null);
  return v_id;
end;
$function$;

comment on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean) is
  'Name and address a club venue in one transaction: create_venue or update_venue, then set_venue_address (the one writer of the address columns), then set_default_venue when asked. Requires venue.venue.manage at the club. Coordinates are derived later from the postcode; never taken here.';

revoke execute on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean)', 'EXECUTE') then
    raise exception 'save_club_venue must not be executable by anon';
  end if;
  -- the one address writer is still the one address writer
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_club_venue' and p.prosrc ~ 'set_venue_address\(') then
    raise exception 'save_club_venue must write the address through set_venue_address';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_club_venue' and p.prosrc ~ 'update public\.venues') then
    raise exception 'save_club_venue must not write venues directly';
  end if;
end $$;
