-- =====================================================================================================
-- CONVERGENCE STEP 6 (2/n) -- a venue address has one writer.
--
-- WHAT WAS WRONG. `venues` carries a structured address (address_line_1/2, town, county, country,
-- postcode, lat/long, address_provider_ref) and a DERIVED single-line `address`. set_venue_address
-- writes the structured columns and regenerates the derived line from them, saying so in its own
-- comment: "the legacy column stays truthful rather than becoming stale".
--
-- create_venue and update_venue wrote the DERIVED column directly and never touched the structured
-- ones. So the first-run wizard (create_venue -> set_venue_address) produced a correct venue, and
-- editing that venue afterwards in Club Settings (update_venue) set
--
--     address = 'New Street, Newtown'
--
-- while address_line_1 still said 'Belvedere Road'. The derived column stopped being derived, and every
-- structured reader -- including the wizard's own step 2 -- kept showing the old address.
--
-- It also inverted the rule the whole step is built on: the GUIDED flow wrote the canonical form and
-- the ordinary administration surface wrote a weaker one. Setup is a presentation over club
-- administration; it must never be the more capable of the two.
--
-- WHAT CHANGES. create_venue and update_venue stop being address writers at all. They own the venue's
-- name, its directions and its default flag. set_venue_address owns the address, all of it, including
-- the postcode -- because a postcode is part of an address and splitting it across two writers is how
-- this defect happened in the first place.
--
-- NOTHING IS LOST. Every field a club could set before is still settable: name and directions through
-- these, the full address through set_venue_address, which both callers now use. The wizard already
-- called the pair; Club Settings now does too, which is the convergence.
--
-- THE OLD SIGNATURES ARE DROPPED, NOT LEFT. An overload that still accepts an address would be a second
-- writer with a dormant bug in it, and PostgREST would happily route to it. Same reasoning as
-- 20261017000000 dropping create_club_pitch's three-argument form rather than replacing it.
-- =====================================================================================================

drop function if exists public.create_venue(uuid, text, text, text, text, boolean);
drop function if exists public.update_venue(uuid, text, text, text, text);

create or replace function public.create_venue(p_club_id uuid, p_name text, p_directions text, p_set_default boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_name text := trim(p_name);
  v_id uuid;
begin
  if not (internal.can_manage_venue(p_club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A venue name is required.';
  end if;
  if exists (select 1 from public.venues where club_id = p_club_id and lower(name) = lower(v_name)) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  if p_set_default then
    update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = p_club_id and is_default_home;
  end if;

  -- No address columns here, by design. A venue is created named, and addressed by set_venue_address --
  -- which is also what makes the address arrive structured rather than as one line somebody has to
  -- take apart later.
  insert into public.venues (name, slug, club_id, directions, is_default_home, active, created_by, updated_by)
  values (
    v_name,
    trim(both '-' from regexp_replace(lower(v_name || '-' || substr(p_club_id::text, 1, 8)), '[^a-z0-9]+', '-', 'g')),
    p_club_id, nullif(trim(coalesce(p_directions, '')), ''),
    coalesce(p_set_default, false), true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.update_venue(p_id uuid, p_name text, p_directions text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_name text := trim(p_name);
  v_club uuid;
begin
  select club_id into v_club from public.venues where id = p_id;
  if v_club is null then
    raise exception 'No such venue.';
  end if;
  if not (internal.can_manage_venue(v_club)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A venue name is required.';
  end if;
  if exists (select 1 from public.venues where club_id = v_club and lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  update public.venues
  set name = v_name,
      directions = nullif(trim(coalesce(p_directions, '')), ''),
      updated_by = auth.uid()
  where id = p_id;
end;
$function$;

revoke all on function public.create_venue(uuid, text, text, boolean) from public, anon;
revoke all on function public.update_venue(uuid, text, text) from public, anon;
grant execute on function public.create_venue(uuid, text, text, boolean) to authenticated;
grant execute on function public.update_venue(uuid, text, text) to authenticated;

do $$
declare v_writers text;
begin
  if to_regprocedure('public.create_venue(uuid,text,text,text,text,boolean)') is not null then
    raise exception 'STEP 6: the old create_venue signature still exists and would be a second address writer';
  end if;
  if to_regprocedure('public.update_venue(uuid,text,text,text,text)') is not null then
    raise exception 'STEP 6: the old update_venue signature still exists and would be a second address writer';
  end if;
  if to_regprocedure('public.create_venue(uuid,text,text,boolean)') is null
     or to_regprocedure('public.update_venue(uuid,text,text)') is null then
    raise exception 'STEP 6: the replacement venue functions were not created';
  end if;

  -- THE POINT, asserted: exactly one function in the schema writes a venue address column.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind = 'f'
    and p.prosrc ~ 'update\s+public\.venues'
    and p.prosrc ~ '(address_line_1|address\s*=|postcode\s*=)';
  if v_writers <> 'set_venue_address' then
    raise exception 'STEP 6: a venue address must have exactly one writer; found: %', v_writers;
  end if;

  raise notice 'Step 6: set_venue_address is the only writer of a venue address';
end $$;
