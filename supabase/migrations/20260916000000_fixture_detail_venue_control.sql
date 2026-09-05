-- Reconciliation pass, Section 6: Fixture Detail currently has no way to
-- change a fixture's venue at all (only pitch) -- venue selection only
-- ever happened at fixture-creation time. Mirrors update_fixture_pitch's
-- exact authorization/home-fixture-only shape: a named venue may only be
-- assigned on a HOME fixture, and only from the home club's own active
-- venues -- an away club can never assign its opponent's venue.

create or replace function public.update_fixture_venue(p_fixture_id uuid, p_venue_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_home_club_id uuid;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to set the venue for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  if p_venue_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A venue can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_home_club_id and v.active) then
      raise exception 'That venue does not belong to this fixture''s home club, or is archived.';
    end if;
  end if;

  update public.fixtures set venue_id = p_venue_id where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), jsonb_build_object('venue_id', f.venue_id), jsonb_build_object('venue_id', p_venue_id));
end;
$$;

revoke execute on function public.update_fixture_venue(uuid, uuid) from public;
grant execute on function public.update_fixture_venue(uuid, uuid) to authenticated;

comment on function public.update_fixture_venue is
  'Reconciliation pass Section 6/17: lets Fixture Detail change a fixture''s venue after creation, not just at Add Fixture time -- mirrors update_fixture_pitch''s exact home-fixture-only, home-club-owned-venue authorization shape.';
