-- SENSITIVE FIXTURE AND CLUB FIELDS CHANGE ONLY THROUGH CONTROLLED ACTIONS; A WELFARE LOOKUP STAYS IN ITS OWN CLUB.
--
-- Blueprint batch B0, owner decisions D-001, D-002 and D-004 (9 October 2026).
--
-- 1. FIXTURES. 20270342000000 granted UPDATE on the whole of public.fixtures to authenticated, and the row policy
--    fixtures_update_scoped (20260926000000) admits fixture staff of EITHER side. Together they let the opposing
--    club's staff -- and a Coach on either side -- change a fixture's status, scores, kick-off, pitch or teams
--    directly over the API, skipping cancel_fixture, the result flow, the pitch allocation checks and the rule that
--    only the owning club edits details (update_fixture_details). Every legitimate edit already has a controlled
--    action (update_fixture_details, update_fixture_schedule, update_fixture_meet_time, cancel_fixture,
--    submit_fixture_result and the rest), all SECURITY DEFINER, so the table grant is simply withdrawn and its
--    policy dropped. The two web Site Admin actions that still wrote directly now call update_fixture_details and
--    cancel_fixture, which already admit `site.fixtures.support`.
--
-- 2. CLUBS. The same perimeter migration granted UPDATE on every column of public.clubs, so anyone passing
--    clubs_update_admin (a Club Admin) could set `status`, `slug`, `directory_id` or the deactivation record
--    directly, bypassing the Site-Admin-only deactivate_club / reactivate_club. The grant is narrowed to the
--    profile and image columns the clients actually write. Club status changes only through deactivate_club,
--    reactivate_club and (new here, for the Site Admin's Active/Suspended setting) set_club_public_status; club
--    identity (slug, directory link, timezone, location) only through its own actions.
--
-- 3. WELFARE LOOKUP. welfare_member_view checked authority against ONE of the player's clubs, chosen by row order,
--    then returned the player's teams at EVERY club. A Safeguarding Officer could therefore see a dual-registered
--    player's teams at another club, and could be refused for their own club's player depending on row order.
--    It now checks each of the player's clubs explicitly and returns only the teams at clubs where the caller holds
--    `safeguarding.welfare.view`; with no such club it refuses. Guardian contact is returned only alongside those
--    teams, so only under the caller's own club authority. The signature, the reason rule and the audited security
--    event (one per club looked at) are unchanged, so the mobile client is untouched.
--
-- Proved by supabase/tests/sensitive_fields_controlled_actions.sql.

-- =====================================================================================================
-- 1. FIXTURES: no direct client writes
-- =====================================================================================================
revoke update on public.fixtures from authenticated;
drop policy if exists fixtures_update_scoped on public.fixtures;

-- =====================================================================================================
-- 2. CLUBS: only profile and image columns are directly writable (rows still decided by clubs_update_admin)
-- =====================================================================================================
revoke update on public.clubs from authenticated;
grant update (bio, website, facebook_url, address_display,
              show_website, show_home_ground, show_address, show_postcode,
              logo_storage_path, cover_storage_path)
  on public.clubs to authenticated;

-- The Site Admin "Club Status" setting (active / suspended: whether the public page shows) was a direct write of
-- `status`. It becomes a controlled action with the same authority the Site Admin club profile already needs. It
-- never touches a deactivated club: that is deactivate_club / reactivate_club, with their reason and record.
create or replace function public.set_club_public_status(p_club_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.has_site_capability('site.clubs.profile.manage') then
    raise exception 'Only a Site Admin may change a club''s status.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'A club''s status here is Active or Suspended.' using errcode = '22023';
  end if;
  select status into v_current from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if v_current = 'deactivated' then
    raise exception 'This club is deactivated. Reactivate it first.' using errcode = '22023';
  end if;
  if v_current is distinct from p_status then
    update public.clubs set status = p_status, updated_by = auth.uid() where id = p_club_id;
  end if;
end;
$$;

revoke execute on function public.set_club_public_status(uuid, text) from public, anon;
grant execute on function public.set_club_public_status(uuid, text) to authenticated, service_role;

-- =====================================================================================================
-- 3. WELFARE LOOKUP: only the caller's own club(s)
-- =====================================================================================================
create or replace function public.welfare_member_view(p_player_id uuid, p_reason text)
returns table (player_name text, team_name text, guardian_name text, guardian_contact text, guardian_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_clubs uuid[];
  v_clubs uuid[];
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Looking up a member''s welfare record needs a reason, and it is recorded.' using errcode = '22023';
  end if;

  select array_agg(distinct t.club_id) into v_player_clubs
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and ptm.state = 'ACTIVE';
  if v_player_clubs is null then
    raise exception 'That player is not in a team at any club.' using errcode = 'P0002';
  end if;

  -- Each club is checked on its own: authority at one club never opens another club's record.
  select array_agg(c) into v_clubs
  from unnest(v_player_clubs) c
  where internal.can('safeguarding.welfare.view', 'club', c, null, null);
  if v_clubs is null then
    raise exception 'You are not authorised to view welfare records for this club.' using errcode = '42501';
  end if;

  foreach v_club in array v_clubs loop
    perform internal.emit_security_event('safeguarding.welfare_viewed', auth.uid(), 'SUCCESS', trim(p_reason),
      jsonb_build_object('player_id', p_player_id), v_club, null, p_player_id);
  end loop;

  return query
    select btrim(coalesce(pl.first_name,'') || ' ' || coalesce(pl.surname,'')),
           t.display_name,
           btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'')),
           pr.email,
           g.state
    from public.players pl
    join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.state = 'ACTIVE'
    join public.teams t on t.id = ptm.team_id and t.club_id = any(v_clubs)
    left join public.guardians g on g.player_id = pl.id and g.state = 'ACTIVE'
    left join public.profiles pr on pr.id = g.guardian_user_id
    where pl.id = p_player_id;
end;
$$;

revoke execute on function public.welfare_member_view(uuid, text) from public, anon;
grant execute on function public.welfare_member_view(uuid, text) to authenticated, service_role;
