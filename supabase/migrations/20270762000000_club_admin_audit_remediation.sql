-- =====================================================================================================================
-- CLUB ADMIN AUDIT REMEDIATION (Codex independent audit, 7 Oct 2026).
--
-- H2  A safeguarding contact card nobody has accepted yet can no longer be edited from another club.
-- H3  Direct messaging asks for POSITIVE adult evidence: unknown age is never adult.
-- H4  A guardian may direct-message only the authorised staff of their own child's teams.
-- H1  Fixture requests change state only through guarded server operations; the table's direct UPDATE is revoked.
-- H5  Pitch placement is pitch-allocation authority (allocate_fixture_pitch), independent of fixture edit.
-- M4  Every answer to a Club Day fixture -- bulk or individual -- refreshes the ONE live summary to the planning club.
-- M5  A club cannot answer its own standing proposal inside a Club Day.
-- M6  A Club Day shows the effective kick-off (a suggested time wins over the original).
-- M9  A Club Day send keeps its complete per-team outcome, so a retried batch reports exactly what happened.
-- =====================================================================================================================


-- H2 ------------------------------------------------------------------------------------------------------------------
-- While a card's user_id is NULL the self-check `user_id = auth.uid()` was NULL, the whole denial NULL, and PL/pgSQL
-- skipped it: any holder of the self-edit capability at ANY club could edit an unaccepted card. Ownership must be
-- explicitly true, and the denial can never be NULL.
create or replace function public.update_safeguarding_officer_contact(p_officer_id uuid, p_contact_name text, p_contact_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer public.club_safeguarding_officers;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'A name and email are both required.' using errcode = '22023';
  end if;

  if not coalesce(
    (v_officer.user_id is not null and v_officer.user_id = auth.uid()
       and internal.can('safeguarding.officer.contact_edit', 'self', null, null, null))
    or internal.can('safeguarding.officer.nominate', 'club', v_officer.club_id, null, null),
    false
  ) then
    raise exception 'You are not authorised to change this Safeguarding Officer record.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set contact_name = trim(p_contact_name), contact_email = lower(trim(p_contact_email)),
      updated_by = auth.uid(), updated_at = now()
  where id = p_officer_id;
end;
$$;


-- H3 ------------------------------------------------------------------------------------------------------------------
-- UNKNOWN AGE IS NEVER ADULT (owner-locked). Sign-up's date of birth is optional and unchecked, so "no DOB and no
-- linked minor" is not evidence of adulthood -- a child can register with no DOB. An account is an adult for direct
-- messaging only with POSITIVE evidence:
--   * a recorded adult date of birth (on the account or on a player the account is), or
--   * an adult standing Ovalball itself grants -- an active guardian of a player, a club role above Basic User, or a
--     team staff role -- and no player record of unknown age attached to the account.
-- Adults are NOT required to record a DOB: guardians and staff without one keep messaging. A player of unknown age, or
-- a bare self-registered account, fails closed until an age is recorded.
create or replace function internal.is_adult_messaging_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
  select
    p_user_id is not null
    -- ANY known minor identity disqualifies the account, whatever else is true of it.
    and not exists (
      select 1 from public.players pl
      cross join lateral internal.resolve_player_chronological_age(pl.date_of_birth) a
      where pl.user_id = p_user_id and pl.date_of_birth is not null and a.is_minor)
    and not exists (
      select 1 from public.profiles pr
      cross join lateral internal.resolve_player_chronological_age(pr.date_of_birth) a
      where pr.id = p_user_id and pr.date_of_birth is not null and a.is_minor)
    and (
      -- A recorded adult age.
      exists (select 1 from public.profiles pr
              cross join lateral internal.resolve_player_chronological_age(pr.date_of_birth) a
              where pr.id = p_user_id and pr.date_of_birth is not null and not a.is_minor)
      or exists (select 1 from public.players pl
                 cross join lateral internal.resolve_player_chronological_age(pl.date_of_birth) a
                 where pl.user_id = p_user_id and pl.date_of_birth is not null and not a.is_minor
                   -- every player the account is must be of known age
                   and not exists (select 1 from public.players q where q.user_id = p_user_id and q.date_of_birth is null))
      -- Or an adult standing, with no player of unknown age attached.
      or (
        not exists (select 1 from public.players q where q.user_id = p_user_id and q.date_of_birth is null)
        and (
          exists (select 1 from public.guardians g where g.guardian_user_id = p_user_id and g.status = 'active')
          or exists (select 1 from public.club_memberships cm
                     where cm.user_id = p_user_id and cm.status = 'active' and cm.role is distinct from 'BASIC_USER')
          or exists (select 1 from internal.team_role_assignments ta
                     join public.club_memberships cm on cm.id = ta.membership_id and cm.status = 'active'
                     where cm.user_id = p_user_id)
        )
      )
    );
$$;

-- H4 ------------------------------------------------------------------------------------------------------------------
-- A FAMILY-ONLY account: a guardian with no standing of their own at a club (no club role above Basic User, no team
-- staff role, no team place as a player). Their direct messaging is limited to their own children's teams' authorised
-- staff -- derived from ACTIVE guardian links and ACTIVE team places, never from which child the app has selected.
create or replace function internal.messaging_family_only(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
  select p_user_id is not null
    and exists (select 1 from public.guardians g where g.guardian_user_id = p_user_id and g.status = 'active')
    and not exists (select 1 from public.club_memberships cm
                    where cm.user_id = p_user_id and cm.status = 'active' and cm.role is distinct from 'BASIC_USER')
    and not exists (select 1 from internal.team_role_assignments ta
                    join public.club_memberships cm on cm.id = ta.membership_id and cm.status = 'active'
                    where cm.user_id = p_user_id)
    and not exists (select 1 from public.players pl
                    join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.status = 'active'
                    where pl.user_id = p_user_id);
$$;

-- Is p_staff authorised team staff for any team one of p_guardian's children actively plays for?
create or replace function internal.is_staff_for_guardians_children(p_staff uuid, p_guardian uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
  select exists (
    select 1
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
    where g.guardian_user_id = p_guardian and g.status = 'active'
      and internal.team_messaging_staff(p_staff, ptm.team_id));
$$;
revoke all on function internal.messaging_family_only(uuid) from public, anon, authenticated;
revoke all on function internal.is_staff_for_guardians_children(uuid, uuid) from public, anon, authenticated;


create or replace function internal.may_direct_message(p_other_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_me uuid := auth.uid();
  v_me_family boolean;
  v_other_family boolean;
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return false;
  end if;

  -- THE SAFEGUARDING BOUNDARY, FIRST AND UNCONDITIONAL: both people positively adults (H3).
  if not internal.is_adult_messaging_user(v_me)
     or not internal.is_adult_messaging_user(p_other_user_id) then
    return false;
  end if;

  -- A BLOCK IS ABSOLUTE, in both directions.
  if internal.is_personally_blocked(v_me, p_other_user_id)
     or internal.is_personally_blocked(p_other_user_id, v_me) then
    return false;
  end if;

  -- SITE, THEN EVERY CLUB EITHER PERSON BELONGS TO.
  if not internal.direct_messaging_allowed_for_pair(v_me, p_other_user_id) then
    return false;
  end if;

  -- A GUARDIAN WITH NO STANDING OF THEIR OWN (H4, owner-locked): only their own children's teams' authorised staff --
  -- not other club staff, not other guardians, not the opposition, and not through an older conversation once the
  -- relationship has ended. Continued sends ask the same question.
  v_me_family := internal.messaging_family_only(v_me);
  v_other_family := internal.messaging_family_only(p_other_user_id);
  if v_me_family and v_other_family then
    return false;
  elsif v_me_family then
    return internal.is_staff_for_guardians_children(p_other_user_id, v_me);
  elsif v_other_family then
    return internal.is_staff_for_guardians_children(v_me, p_other_user_id);
  end if;

  -- EVERYONE ELSE (staff and adult players), as before.
  if exists (
    select 1 from public.direct_conversations d
    where d.user_a = least(v_me, p_other_user_id) and d.user_b = greatest(v_me, p_other_user_id)
  ) then
    return true;
  end if;

  if exists (
    select 1
    from internal.messaging_club_ids(v_me) a
    join internal.messaging_club_ids(p_other_user_id) b on b.club_id = a.club_id
  ) then
    return true;
  end if;

  if exists (
    select 1
    from internal.team_role_assignments ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = v_me and ca.status = 'active'
    join internal.team_role_assignments tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.user_id = p_other_user_id and cb.status = 'active'
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.fixtures f
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and (
        (internal.team_messaging_staff(v_me, f.owning_team_id) and internal.team_messaging_staff(p_other_user_id, f.opponent_team_id))
        or
        (internal.team_messaging_staff(v_me, f.opponent_team_id) and internal.team_messaging_staff(p_other_user_id, f.owning_team_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;


-- H1 ------------------------------------------------------------------------------------------------------------------
-- The table's UPDATE was granted to every signed-in user and its policy let either club's respondents change ANY
-- column: status, decision attribution, counter fields, the resulting fixture. Requests now change state only through
-- guarded operations that derive the side, the turn and the attribution on the server.
revoke update on public.fixture_requests from authenticated;
drop policy if exists fixture_requests_update_scoped on public.fixture_requests;

-- DECLINE: only the side whose turn it is (the side that did NOT make the standing proposal), only while it is open.
create or replace function public.decline_fixture_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_answering_team uuid;
  v_answering_club uuid;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  perform internal.require_live_session();
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  if v_req.status not in ('sent', 'counter_proposed') then
    raise exception 'This request is no longer awaiting an answer.' using errcode = '22023';
  end if;

  -- Whose turn: a standing counter is answered by the side that did not make it; a fresh request by the side asked.
  if v_req.status = 'counter_proposed' and v_req.last_proposed_by_team_id is not null
     and v_req.last_proposed_by_team_id is distinct from v_req.requesting_team_id then
    v_answering_team := v_req.requesting_team_id;
  else
    v_answering_team := v_req.target_team_id;
  end if;
  if v_answering_team is not null then
    select club_id into v_answering_club from public.teams where id = v_answering_team;
  elsif v_req.status = 'sent' then
    v_answering_club := v_group.opponent_club_id;
  end if;

  if not coalesce(
       (v_answering_team is not null and v_answering_club is not null
          and internal.can('fixture.request.respond', 'team', v_answering_club, v_answering_team, null))
       or (v_answering_club is not null and internal.can('fixture.request.respond', 'club', v_answering_club, null, null))
       or internal.has_site_capability('site.fixtures.support'),
       false) then
    raise exception 'You are not authorised to answer this fixture request.' using errcode = '42501';
  end if;

  update public.fixture_requests
     set status = 'declined', decided_by = auth.uid(), decided_at = now(),
         response_note = coalesce(v_note, response_note),
         response_note_by = case when v_note is not null then auth.uid() else response_note_by end,
         response_note_at = case when v_note is not null then now() else response_note_at end
   where id = v_req.id;
end;
$$;
revoke all on function public.decline_fixture_request(uuid, text) from public, anon;
grant execute on function public.decline_fixture_request(uuid, text) to authenticated;

-- WITHDRAW: only the requesting side (fixture.request.create on the requesting team or its club), only while open.
create or replace function public.withdraw_fixture_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_club uuid;
begin
  perform internal.require_live_session();
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to withdraw this fixture request.' using errcode = '42501';
  end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  if v_req.status not in ('sent', 'counter_proposed') then
    raise exception 'This request is no longer open.' using errcode = '22023';
  end if;
  select club_id into v_club from public.teams where id = v_req.requesting_team_id;
  v_club := coalesce(v_club, v_group.requesting_club_id);

  if not coalesce(
       (v_req.requesting_team_id is not null and v_club is not null
          and internal.can('fixture.request.create', 'team', v_club, v_req.requesting_team_id, null))
       or (v_club is not null and internal.can('fixture.request.create', 'club', v_club, null, null))
       or internal.has_site_capability('site.fixtures.support'),
       false) then
    raise exception 'You are not authorised to withdraw this fixture request.' using errcode = '42501';
  end if;

  update public.fixture_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where id = v_req.id;
end;
$$;
revoke all on function public.withdraw_fixture_request(uuid) from public, anon;
grant execute on function public.withdraw_fixture_request(uuid) to authenticated;

-- A request created DIRECTLY by a client starts as a fresh, undecided request in the creator's own name. The server's
-- own operations (security definer, running as the owner) are not affected.
-- SECURITY INVOKER on purpose: `current_user` must be the caller. A client's direct insert runs as `authenticated` and
-- is checked; the server's own operations run as their owner and are not.
create or replace function internal.enforce_fixture_request_client_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if new.status is distinct from 'sent'
       or new.resulting_fixture_id is not null
       or new.decided_by is not null or new.decided_at is not null
       or new.countered_date is not null or new.countered_kickoff_time is not null
       or new.countered_venue_preference is not null or new.countered_by is not null or new.countered_at is not null
       or new.counter_note is not null
       or new.response_note is not null or new.response_note_by is not null or new.response_note_at is not null
       or (new.last_proposed_by_team_id is not null and new.last_proposed_by_team_id is distinct from new.requesting_team_id)
       or new.created_by is distinct from auth.uid() then
      raise exception 'A new fixture request starts as sent, undecided and in your own name.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fixture_requests_client_insert_guard on public.fixture_requests;
create trigger fixture_requests_client_insert_guard
  before insert on public.fixture_requests
  for each row execute function internal.enforce_fixture_request_client_insert();


-- H5 ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_pitch_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
  v_pitch_venue_id uuid;
  v_club uuid;
  v_before text[];
begin
  -- H5: the ordinary fixture editor, OR pitch-allocation management over the club hosting this fixture.
  if not coalesce(
       internal.can_edit_fixture_schedule(p_fixture_id)
       or internal.arena_can_manage((select fh.host_club_id from internal.fixture_host(p_fixture_id) fh)),
       false) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;
  v_club := internal.fixture_estate_club(p_fixture_id);
  if v_club is not null and p_pitch_id is distinct from f.pitch_id then
    v_before := internal.arena_conflict_keys(v_club, array[f.kickoff_date]);
  end if;

  if p_pitch_id is not null then
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;

    -- STEP 6: and it has to be a pitch at the ground the fixture is actually being played at.
    select cp.venue_id into v_pitch_venue_id from public.club_pitches cp where cp.id = p_pitch_id;
    if f.venue_id is not null and v_pitch_venue_id is distinct from f.venue_id then
      raise exception 'The selected pitch does not belong to the selected venue. Choose a pitch at this fixture''s ground, or change the fixture''s venue first.'
        using errcode = '23514';
    end if;

    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
           allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text,
           allocation_auto = internal.allocation_auto_after(allocation_auto, array['pitch']) where id = f.mirror_fixture_id;
  end if;

  if v_club is not null and p_pitch_id is distinct from f.pitch_id then
    perform internal.refuse_new_arena_conflicts(v_club, array[f.kickoff_date], v_before, internal.fixture_pair_ids(p_fixture_id));
  end if;

  if coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id then
    if f.opponent_team_id is not null then
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
        case when v_new_pitch_text is null then 'Pitch allocation removed.'
             else format('Pitch allocated: %s', v_new_pitch_text) end);
    end if;
    -- Told whether or not the opposition is on Ovalball.
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_fixture_facilities(p_fixture_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  f public.fixtures;
  h record;
  v_venue uuid; v_venue_text text; v_pitch uuid; v_pitch_text text;
  v_home_room uuid; v_away_room uuid; v_home_no smallint; v_away_no smallint; v_none boolean;
  v_officials_room uuid;
  v_club uuid; v_days date[]; v_before text[]; v_officials_changed boolean;
  v_notes text; v_catering boolean;
  v_cleared text[] := '{}';
  v_where_changed boolean; v_rooms_changed boolean;
  v_ground text; v_pitch_label text; v_body text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id for update;
  -- H5: the ordinary fixture editor; or, for a PLACEMENT-ONLY change (ground, pitch, changing rooms), pitch-allocation
  -- management over the club hosting this fixture. Anything else (notes, catering, free text) stays fixture edit.
  if not found or not coalesce(
       internal.can_edit_fixture_schedule(p_fixture_id)
       or (not exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k
                        where k not in ('venue_id', 'pitch_id', 'home_room_id', 'away_room_id', 'officials_room_id'))
           and internal.arena_can_manage((select fh.host_club_id from internal.fixture_host(p_fixture_id) fh))),
       false) then
    raise exception 'You are not authorised to arrange this fixture.' using errcode = '42501';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    raise exception 'This fixture has been cancelled.' using errcode = '22023';
  end if;
  select * into h from internal.fixture_host(p_fixture_id);
  if h.mode = 'UNDECIDED' and (p_patch ?| array['venue_id','venue_text','pitch_id','pitch_text','home_room_id','away_room_id',
                                                 'home_room_number','away_room_number','no_changing_rooms','officials_room_id']) then
    raise exception 'Agree home or away first: the ground is the home side''s.' using errcode = '22023';
  end if;

  v_venue := case when p_patch ? 'venue_id' then nullif(p_patch->>'venue_id', '')::uuid else f.venue_id end;
  v_venue_text := case when p_patch ? 'venue_text' then nullif(btrim(coalesce(p_patch->>'venue_text', '')), '') else f.venue_address end;
  v_pitch := case when p_patch ? 'pitch_id' then nullif(p_patch->>'pitch_id', '')::uuid else f.pitch_id end;
  v_pitch_text := case when p_patch ? 'pitch_text' then nullif(btrim(coalesce(p_patch->>'pitch_text', '')), '') else f.pitch_allocation end;
  v_home_room := case when p_patch ? 'home_room_id' then nullif(p_patch->>'home_room_id', '')::uuid else f.home_changing_room_id end;
  v_away_room := case when p_patch ? 'away_room_id' then nullif(p_patch->>'away_room_id', '')::uuid else f.away_changing_room_id end;
  v_officials_room := case when p_patch ? 'officials_room_id' then nullif(p_patch->>'officials_room_id', '')::uuid else f.officials_changing_room_id end;
  v_home_no := case when p_patch ? 'home_room_number' then nullif(p_patch->>'home_room_number', '')::smallint else f.home_changing_room_number end;
  v_away_no := case when p_patch ? 'away_room_number' then nullif(p_patch->>'away_room_number', '')::smallint else f.away_changing_room_number end;
  v_none := case when p_patch ? 'no_changing_rooms' then coalesce((p_patch->>'no_changing_rooms')::boolean, false) else f.no_changing_rooms end;
  v_notes := case when p_patch ? 'changing_room_notes' then nullif(btrim(coalesce(p_patch->>'changing_room_notes', '')), '') else f.changing_room end;
  v_catering := case when p_patch ? 'catering_required' then coalesce((p_patch->>'catering_required')::boolean, false) else f.catering_required end;

  if v_venue_text is not null and length(v_venue_text) > 200 then
    raise exception 'Keep the ground under 200 characters.' using errcode = '22023';
  end if;
  if v_pitch_text is not null and length(v_pitch_text) > 80 then
    raise exception 'Keep the pitch name under 80 characters.' using errcode = '22023';
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Keep the arrival notes under 500 characters.' using errcode = '22023';
  end if;
  if (v_home_no is not null and v_home_no not between 1 and 20) or (v_away_no is not null and v_away_no not between 1 and 20) then
    raise exception 'Choose a changing room from 1 to 20.' using errcode = '22023';
  end if;

  if h.mode = 'CANONICAL' then
    -- The host's records, referenced. A typed ground or numbered room has no place beside them.
    if v_venue is not null then v_venue_text := null; end if;
    if p_patch ? 'pitch_text' and not (p_patch ? 'pitch_id') and v_pitch_text is not null then
      raise exception 'Choose one of the host club''s pitches.' using errcode = '22023';
    end if;
    if p_patch ? 'home_room_number' and v_home_no is not null or p_patch ? 'away_room_number' and v_away_no is not null then
      raise exception 'Choose one of the host club''s changing rooms.' using errcode = '22023';
    end if;
    v_home_no := null; v_away_no := null;
    -- A pitch or room that no longer fits the ground is cleared, and said so.
    if v_pitch is not null and v_venue is not null
       and exists (select 1 from public.club_pitches p where p.id = v_pitch and p.venue_id is not null and p.venue_id <> v_venue)
       and not (p_patch ? 'pitch_id') then
      v_pitch := null; v_cleared := array_append(v_cleared, 'pitch');
    end if;
    if v_home_room is not null and not (p_patch ? 'home_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_home_room and r.venue_id = v_venue) then
      v_home_room := null; v_cleared := array_append(v_cleared, 'home_room');
    end if;
    if v_away_room is not null and not (p_patch ? 'away_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_away_room and r.venue_id = v_venue) then
      v_away_room := null; v_cleared := array_append(v_cleared, 'away_room');
    end if;
    if v_officials_room is not null and not (p_patch ? 'officials_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_officials_room and r.venue_id = v_venue) then
      v_officials_room := null; v_cleared := array_append(v_cleared, 'officials_room');
    end if;
    v_pitch_text := case when v_pitch is not null then (select p.display_name from public.club_pitches p where p.id = v_pitch) end;
  elsif h.mode = 'PROVISIONAL' then
    if v_venue is not null or v_pitch is not null or v_home_room is not null or v_away_room is not null or v_officials_room is not null then
      if p_patch ?| array['venue_id','pitch_id','home_room_id','away_room_id','officials_room_id']
         and (nullif(p_patch->>'venue_id','') is not null or nullif(p_patch->>'pitch_id','') is not null
              or nullif(p_patch->>'home_room_id','') is not null or nullif(p_patch->>'away_room_id','') is not null
              or nullif(p_patch->>'officials_room_id','') is not null) then
        raise exception 'The host club is not on Ovalball, so its ground, pitch and rooms are written for this match.' using errcode = '22023';
      end if;
      v_venue := null; v_pitch := null; v_home_room := null; v_away_room := null; v_officials_room := null;
    end if;
  end if;

  if v_none then
    v_home_room := null; v_away_room := null; v_home_no := null; v_away_no := null; v_officials_room := null;
  end if;

  -- WHERE THE MATCH IS, by what the record references. A ground or pitch held as an id is compared as the
  -- id: its name is only a cached copy (create_fixture stores a pitch without one), so a rooms-only save is
  -- never announced to families as a new location. Typed text is compared only where it is the record.
  v_where_changed := v_venue is distinct from f.venue_id or v_pitch is distinct from f.pitch_id
                  or (v_venue is null and v_venue_text is distinct from f.venue_address)
                  or (v_pitch is null and v_pitch_text is distinct from f.pitch_allocation);
  v_rooms_changed := v_home_room is distinct from f.home_changing_room_id or v_away_room is distinct from f.away_changing_room_id
                  or v_home_no is distinct from f.home_changing_room_number or v_away_no is distinct from f.away_changing_room_number
                  or v_none is distinct from f.no_changing_rooms;

  v_officials_changed := v_officials_room is distinct from f.officials_changing_room_id;
  -- WHAT THE ESTATE LOOKED LIKE BEFORE, so a clash this change causes can be told from one already there.
  v_club := case when h.mode = 'CANONICAL' then h.host_club_id end;
  v_days := array[f.kickoff_date];
  if v_club is not null and (v_where_changed or v_rooms_changed or v_officials_changed) then
    v_before := internal.arena_conflict_keys(v_club, v_days);
  end if;

  update public.fixtures
     set venue_id = v_venue, venue_address = v_venue_text,
         pitch_id = v_pitch, pitch_allocation = v_pitch_text,
         home_changing_room_id = v_home_room, away_changing_room_id = v_away_room,
         home_changing_room_number = v_home_no, away_changing_room_number = v_away_no,
         no_changing_rooms = v_none,
         officials_changing_room_id = v_officials_room,
         allocation_auto = internal.allocation_auto_after(allocation_auto, array_remove(array[
                             case when v_pitch is distinct from f.pitch_id or v_venue is distinct from f.venue_id then 'pitch' end,
                             case when v_home_room is distinct from f.home_changing_room_id then 'home_room' end,
                             case when v_away_room is distinct from f.away_changing_room_id then 'away_room' end,
                             case when v_officials_room is distinct from f.officials_changing_room_id then 'officials_room' end], null)),
         changing_room = v_notes, catering_required = v_catering,
         updated_by = auth.uid(), updated_at = now()
   where id = any (internal.fixture_pair_ids(p_fixture_id));

  if v_club is not null and (v_where_changed or v_rooms_changed or v_officials_changed) then
    perform internal.refuse_new_arena_conflicts(v_club, v_days, v_before, internal.fixture_pair_ids(p_fixture_id));
  end if;

  if f.kickoff_date >= current_date and auth.uid() is not null then
    v_ground := coalesce((select v.name from public.venues v where v.id = v_venue), v_venue_text);
    v_pitch_label := v_pitch_text;
    if v_where_changed then
      -- ALWAYS THE WHOLE LOCATION. A home-or-away switch has already moved the match to the new host's
      -- ground before this save chooses the pitch, so "the pitch has been set" alone would leave a family
      -- driving to the old ground.
      v_body := case
        when v_pitch_label is null and v_pitch is distinct from f.pitch_id and v_ground is not null
             and v_venue is not distinct from f.venue_id and v_venue_text is not distinct from f.venue_address then
          'The pitch for your fixture has been removed. It is still at ' || v_ground || '.'
        else 'Your fixture is now at ' || coalesce(v_ground, 'a ground still to be confirmed')
               || coalesce(', ' || v_pitch_label, '') || '.' end;
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Where the match is', v_body);
    elsif v_rooms_changed and internal.fixture_attendance_is_open(f.id) then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct r.user_id, 'fixture_arrangements_changed',
             case when v_none then 'No changing rooms' else 'Changing rooms allocated' end,
             coalesce(internal.fixture_notice_label(p_fixture_id), 'Your match') || ': '
               || case when v_none then 'there are no changing rooms at the ground for this match. Come changed.'
                       else 'the changing rooms have been set. See Arena Details.' end,
             jsonb_build_object('fixture_id', p_fixture_id)
        from internal.fixture_family_recipients(p_fixture_id) r
       where r.user_id is not null and r.user_id is distinct from auth.uid();
    end if;
  end if;

  return jsonb_build_object('mode', h.mode, 'cleared', to_jsonb(v_cleared));
end;
$function$;


-- THE PITCH ALLOCATION BOARD'S OWN WRITER: pitch-allocation management only. A fixture editor without it is refused
-- here (the board), while the ordinary fixture editor keeps its own writers.
create or replace function public.allocate_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
begin
  perform internal.require_live_session();
  select fh.host_club_id into v_host from internal.fixture_host(p_fixture_id) fh;
  if v_host is null or not coalesce(internal.arena_can_manage(v_host), false) then
    raise exception 'You do not have Pitch Allocation authority for this fixture''s ground.' using errcode = '42501';
  end if;
  perform public.update_fixture_pitch(p_fixture_id, p_pitch_id, null);
end;
$$;
revoke all on function public.allocate_fixture_pitch(uuid, uuid) from public, anon;
grant execute on function public.allocate_fixture_pitch(uuid, uuid) to authenticated;


-- M4 ------------------------------------------------------------------------------------------------------------------
-- ONE LIVE SUMMARY PER CLUB DAY, produced in one place. Every answer to a Club Day fixture -- the grouped response or
-- an individual request screen, on either client -- refreshes it: the newest summary replaces an UNREAD earlier one.
create or replace function internal.publish_club_day_summary(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.fixture_request_groups;
  v_summary jsonb;
  v_opp_name text;
  v_teams uuid[];
begin
  select * into v_group from public.fixture_request_groups where id = p_group_id;
  if not found or v_group.source is distinct from 'season_planner' then
    return;
  end if;
  select jsonb_build_object(
           'accepted', count(*) filter (where r.status = 'accepted'),
           'declined', count(*) filter (where r.status = 'declined'),
           'awaiting', count(*) filter (where r.status in ('sent', 'counter_proposed')))
    into v_summary
    from public.fixture_requests r where r.group_id = p_group_id;
  select d.name into v_opp_name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.opponent_club_id;
  v_teams := array(select r.requesting_team_id from public.fixture_requests r where r.group_id = p_group_id);

  delete from public.notifications n
   where n.type = 'club_day_responded' and n.read_at is null and n.data->>'group_id' = p_group_id::text
     and n.user_id in (select r.user_id from internal.club_day_recipients(v_group.requesting_club_id, v_teams) r);
  insert into public.notifications (user_id, type, title, body, data)
  select r.user_id, 'club_day_responded', 'Club Day answered',
         format('%s responded to your Club Day · %s', coalesce(v_opp_name, 'The other club'),
                concat_ws(' · ',
                  case when (v_summary->>'accepted')::int > 0 then (v_summary->>'accepted') || ' accepted' end,
                  case when (v_summary->>'declined')::int > 0 then (v_summary->>'declined') || ' declined' end,
                  case when (v_summary->>'awaiting')::int > 0 then (v_summary->>'awaiting') || ' awaiting decision' end)),
         jsonb_build_object('group_id', p_group_id, 'club_id', v_group.requesting_club_id)
    from internal.club_day_recipients(v_group.requesting_club_id, v_teams) r;
end;
$$;
revoke all on function internal.publish_club_day_summary(uuid) from public, anon, authenticated;

-- An answer reached the request from anywhere OTHER than the grouped response (which publishes once at its end).
create or replace function internal.club_day_answer_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only an answer from the RECEIVING club: the standing proposal was the planning club's (a fresh request, or the
  -- planning club's own counter). The planning club answering the other club's counter is not "they responded".
  if old.status in ('sent', 'counter_proposed') and new.status in ('accepted', 'declined')
     and (old.last_proposed_by_team_id is null or old.last_proposed_by_team_id = old.requesting_team_id)
     and coalesce(current_setting('ovalball.club_day_response', true), '') <> 'on'
     and exists (select 1 from public.fixture_request_groups g where g.id = new.group_id and g.source = 'season_planner') then
    perform internal.publish_club_day_summary(new.group_id);
  end if;
  return new;
end;
$$;
drop trigger if exists fixture_requests_club_day_summary on public.fixture_requests;
create trigger fixture_requests_club_day_summary
  after update of status on public.fixture_requests
  for each row execute function internal.club_day_answer_published();

CREATE OR REPLACE FUNCTION internal.notify_fixture_request_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group public.fixture_request_groups;
  v_requesting_club_name text;
  v_target_club_name text;
  v_notify_team_id uuid;
  v_proposer_club_name text;
begin
  if tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'declined' then
    select * into v_group from public.fixture_request_groups where id = new.group_id;
    -- A CLUB DAY ANSWERED FROM ITS GROUPED RESPONSE tells the planning club once, from
    -- planner_respond_club_day, rather than once per declined fixture (20270761000000).
    -- A CLUB DAY decline, however it was given, is told through the club day's ONE summary (M4), never per fixture.
    if v_group.source = 'season_planner' then
      return new;
    end if;
    select cd.name into v_target_club_name
    from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory cd on cd.id = c.directory_id
    where t.id = new.target_team_id;

    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_declined', 'Fixture request declined',
      format('%s declined your fixture request for %s.', coalesce(v_target_club_name, 'The opponent'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.requesting_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
    union
    select cm.user_id, 'fixture_request_declined', 'Fixture request declined',
      format('%s declined your fixture request for %s.', coalesce(v_target_club_name, 'The opponent'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.club_memberships cm
    where cm.club_id = v_group.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

    return new;
  end if;

  -- CA-M11.5: a genuine new counter is an UPDATE landing on status='counter_proposed' whose countered_at
  -- just changed -- fires once per round, including a second or third, never on an unrelated column update.
  if tg_op = 'UPDATE' and new.status = 'counter_proposed' and old.countered_at is distinct from new.countered_at then
    select * into v_group from public.fixture_request_groups where id = new.group_id;
    -- Notify whichever side did NOT just make this counter -- the one whose turn it now is.
    v_notify_team_id := case when new.last_proposed_by_team_id = new.requesting_team_id then new.target_team_id else new.requesting_team_id end;
    select cd.name into v_proposer_club_name
    from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory cd on cd.id = c.directory_id
    where t.id = new.last_proposed_by_team_id;

    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_countered', 'Alternative date proposed',
      format('%s suggested %s at %s for your fixture request.', coalesce(v_proposer_club_name, 'The other club'),
             coalesce(to_char(new.countered_date, 'DD Mon YYYY'), 'another date'), coalesce(to_char(new.countered_kickoff_time, 'HH24:MI'), 'a time to confirm')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_notify_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH');

    return new;
  end if;

  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then
    return new;
  end if;

  select * into v_group from public.fixture_request_groups where id = new.group_id;
  -- A SEASON PLANNER CLUB DAY IS ANNOUNCED ONCE, as a club day, by planner_send_club_day -- never as one
  -- "new fixture request" per team to each team's staff (20270761000000).
  if v_group.source = 'season_planner' then
    return new;
  end if;
  select cd.name into v_requesting_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = v_group.requesting_club_id;

  if new.target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from internal.team_role_assignments tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.target_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH');
    -- A NAMED TEAM WITH NOBODY ON IT is asked through its club: when the team has no active staff, the opposing
    -- club's fixture administrators (who hold fixture.request.respond at club scope) are told instead. Without
    -- this a request to an unstaffed team notified nobody at all (20270760000000).
    if not found then
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'fixture_request_received', 'New fixture request',
        format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
        jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
      from public.teams tt
      join public.club_memberships cm on cm.club_id = tt.club_id
      where tt.id = new.target_team_id
        and cm.status = 'active'
        and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
    end if;
  elsif v_group.opponent_club_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_received', 'New fixture request',
      format('%s has requested a fixture on %s.', v_requesting_club_name, to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.club_memberships cm
    where cm.club_id = v_group.opponent_club_id
      and cm.status = 'active'
      and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.planner_respond_club_day(p_group_id uuid, p_action text, p_request_ids uuid[] DEFAULT NULL::uuid[], p_notes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_group public.fixture_request_groups;
  v_req public.fixture_requests;
  v_results jsonb := '[]'::jsonb;
  v_changed int := 0;
  v_fixture uuid;
  v_outcome text;
  v_reason text;
  v_note text;
  v_summary jsonb;
begin
  perform internal.require_live_session();
  if p_action is null or p_action not in ('accept', 'decline') then
    raise exception 'Choose accept or decline.' using errcode = '22023';
  end if;
  -- One answer at a time per club day.
  select * into v_group from public.fixture_request_groups where id = p_group_id for update;
  if not found or v_group.source is distinct from 'season_planner' or internal.club_day_side(v_group) is distinct from 'received' then
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;

  -- The canonical decline trigger stays quiet for this club day; one grouped notice goes instead (below).
  perform set_config('ovalball.club_day_response', 'on', true);

  for v_req in
    select r.* from public.fixture_requests r
     where r.group_id = v_group.id
       and (p_request_ids is null or r.id = any(p_request_ids))
     order by r.created_at, r.id
  loop
    v_outcome := null; v_reason := null; v_fixture := null;
    v_note := case when p_notes is not null then nullif(left(trim(coalesce(p_notes->>v_req.id::text, '')), 500), '') end;

    if v_req.status in ('accepted', 'declined', 'cancelled', 'expired') then
      v_outcome := 'already_resolved';
      v_reason := 'Already ' || case v_req.status when 'accepted' then 'accepted' when 'declined' then 'declined' when 'cancelled' then 'withdrawn' else 'expired' end || '.';
    elsif p_request_ids is null and v_req.status <> 'sent' then
      -- "All remaining" never answers a fixture under discussion: a suggested date is answered on its own.
      v_outcome := 'not_actionable'; v_reason := 'Another date has been suggested -- answer it on its own.';
    elsif v_req.status = 'counter_proposed' and v_req.last_proposed_by_team_id is not null
          and v_req.last_proposed_by_team_id is distinct from v_req.requesting_team_id then
      -- M5: this club made the standing proposal; the planning club answers it, not this one.
      v_outcome := 'not_actionable'; v_reason := 'You suggested this date -- the other club answers it.';
    elsif v_req.target_team_id is null or not internal.can('fixture.request.respond', 'team', v_group.opponent_club_id, v_req.target_team_id, null) then
      v_outcome := 'not_actionable'; v_reason := 'You cannot answer for this team.';
    else
      begin
        -- THE NOTE TRAVELS WITH THE ANSWER: a decline and its note are one change, and an accept's note is in place
        -- before the canonical accept, so the negotiation history records each answer with the words given for it.
        if p_action = 'accept' then
          if v_note is not null then
            update public.fixture_requests set response_note = v_note, response_note_by = v_uid, response_note_at = now() where id = v_req.id;
          end if;
          v_fixture := public.accept_fixture_request(v_req.id);
          v_outcome := 'accepted';
        else
          update public.fixture_requests
             set status = 'declined', decided_by = v_uid, decided_at = now(),
                 response_note = coalesce(v_note, response_note),
                 response_note_by = case when v_note is not null then v_uid else response_note_by end,
                 response_note_at = case when v_note is not null then now() else response_note_at end
           where id = v_req.id and status in ('sent', 'counter_proposed');
          if not found then
            v_outcome := 'already_resolved'; v_reason := 'Already answered.';
          else
            v_outcome := 'declined';
          end if;
        end if;
        if v_outcome in ('accepted', 'declined') then
          v_changed := v_changed + 1;
        end if;
      exception when others then
        v_outcome := 'failed';
        v_reason := case sqlstate when '23514' then sqlerrm
                                  when '40001' then 'It changed while you were answering. Look again.'
                                  when '42501' then 'You cannot answer for this team.'
                                  else coalesce(nullif(sqlerrm, ''), 'This fixture could not be answered.') end;
      end;
    end if;

    v_results := v_results || jsonb_build_object('request_id', v_req.id, 'outcome', v_outcome, 'reason', v_reason, 'fixture_id', v_fixture);
  end loop;

  select jsonb_build_object(
           'total', count(*),
           'accepted', count(*) filter (where r.status = 'accepted'),
           'declined', count(*) filter (where r.status = 'declined'),
           'pending', count(*) filter (where r.status = 'sent'),
           'countered', count(*) filter (where r.status = 'counter_proposed'),
           'withdrawn', count(*) filter (where r.status in ('cancelled', 'expired')))
    into v_summary
    from public.fixture_requests r where r.group_id = v_group.id;

  -- ONE notice back to the planning club, only when something actually changed (a retry changes nothing).
  -- ONE notice back to the planning club, only when something actually changed (a retry changes nothing).
  if v_changed > 0 then
    perform internal.publish_club_day_summary(v_group.id);
  end if;

  return jsonb_build_object('results', v_results, 'summary', v_summary);
end;
$function$;


-- M6: the effective kick-off -- a suggested time wins over the original, as accept_fixture_request applies it.
CREATE OR REPLACE FUNCTION public.planner_club_day_detail(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group public.fixture_request_groups;
  v_side text;
begin
  perform internal.require_live_session();
  select * into v_group from public.fixture_request_groups where id = p_group_id;
  if not found or v_group.source is distinct from 'season_planner' then
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;
  v_side := internal.club_day_side(v_group);
  if v_side is null then
    -- Same answer as a missing one: a club day is never confirmed to exist for somebody it is not for.
    raise exception 'That club day could not be found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'group_id', v_group.id,
    'side', v_side,
    'date', v_group.proposed_date,
    'created_at', v_group.created_at,
    'reverse_of_group_id', v_group.reverse_of_group_id,
    'return_group_ids', coalesce((select jsonb_agg(g.id order by g.proposed_date) from public.fixture_request_groups g where g.reverse_of_group_id = v_group.id), '[]'::jsonb),
    'requesting_club', (select jsonb_build_object('id', c.id, 'name', d.name, 'logo_path', d.logo_storage_path)
                          from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.requesting_club_id),
    'opponent_club', (select jsonb_build_object('id', c.id, 'name', d.name, 'logo_path', d.logo_storage_path)
                        from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_group.opponent_club_id),
    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_id', r.id,
               'status', r.status,
               'requesting_team_id', r.requesting_team_id,
               'requesting_team', rt.display_name,
               'requesting_age_group', rt.age_group,
               'target_team_id', r.target_team_id,
               'target_team', tt.display_name,
               'venue', coalesce(r.countered_venue_preference, r.venue_preference),
               'kickoff', coalesce(r.countered_kickoff_time, r.preferred_kickoff_time),
               'date', coalesce(r.countered_date, v_group.proposed_date),
               'countered', r.status = 'counter_proposed',
               'countered_by_requester', r.last_proposed_by_team_id = r.requesting_team_id,
               'note', r.note,
               'counter_note', r.counter_note,
               'response_note', r.response_note,
               'resulting_fixture_id', r.resulting_fixture_id,
               'decided_at', r.decided_at)
             order by rt.category, rt.age_group nulls last, rt.display_name)
        from public.fixture_requests r
        join public.teams rt on rt.id = r.requesting_team_id
        left join public.teams tt on tt.id = r.target_team_id
       where r.group_id = v_group.id), '[]'::jsonb));
end;
$function$;


-- M9 ------------------------------------------------------------------------------------------------------------------
alter table public.fixture_request_groups add column if not exists planner_results jsonb;
comment on column public.fixture_request_groups.planner_results is
  'The Season Planner send''s complete per-team outcome (sent and not sent, with reasons), returned unchanged when the same batch is retried.';

CREATE OR REPLACE FUNCTION public.planner_send_club_day(p_club_id uuid, p_opponent_club_id uuid, p_date date, p_batch_id uuid, p_items jsonb, p_reverse_of uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_opp_code text;
  v_opp_dir uuid;
  v_opp_name text;
  v_my_name text;
  v_group uuid;
  v_existing public.fixture_request_groups;
  v_reverse public.fixture_request_groups;
  v_item jsonb;
  v_req_team uuid;
  v_target uuid;
  v_venue text;
  v_ack boolean;
  v_note text;
  v_clash record;
  v_request uuid;
  v_results jsonb := '[]'::jsonb;
  v_sent int := 0;
  v_targets uuid[] := '{}';
  v_reason text;
  v_outcome text;
begin
  perform internal.require_live_session();
  if not internal.can_bulk_plan_fixtures(p_club_id) then
    raise exception 'You are not authorised to plan this club''s fixtures.' using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'A planner batch id is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one team.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'A club day can hold at most 40 teams.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planner:' || p_club_id::text, 0));

  select * into v_existing from public.fixture_request_groups where planner_batch_id = p_batch_id;
  if found then
    if v_existing.requesting_club_id is distinct from p_club_id then
      raise exception 'That batch belongs to another club.' using errcode = '42501';
    end if;
    return jsonb_build_object('group_id', v_existing.id, 'replay', true, 'results', coalesce(v_existing.planner_results, (
      select jsonb_agg(jsonb_build_object('requesting_team_id', r.requesting_team_id, 'target_team_id', r.target_team_id,
                                          'outcome', 'sent', 'request_id', r.id, 'reason', null))
        from public.fixture_requests r where r.group_id = v_existing.id), '[]'::jsonb));
  end if;

  select d.rugby_code, d.name into v_code, v_my_name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = p_club_id;
  select d.rugby_code, d.id, d.name into v_opp_code, v_opp_dir, v_opp_name
    from public.clubs c join public.club_directory d on d.id = c.directory_id
   where c.id = p_opponent_club_id and c.status = 'active';
  if v_opp_code is null then
    raise exception 'That club is not on Ovalball, so there is nobody to send a request to.' using errcode = 'P0002';
  end if;
  if v_opp_code is distinct from v_code or p_opponent_club_id = p_club_id then
    raise exception 'That club cannot be asked for these fixtures.' using errcode = '22023';
  end if;
  if internal.resolve_season_for_date(v_code, p_date) is null then
    raise exception 'That date is not inside an Ovalball season.' using errcode = '22023';
  end if;
  if p_date < current_date then
    raise exception 'That date has already passed.' using errcode = '22023';
  end if;
  if p_reverse_of is not null then
    select * into v_reverse from public.fixture_request_groups where id = p_reverse_of;
    if not found or v_reverse.requesting_club_id is distinct from p_club_id or v_reverse.opponent_club_id is distinct from p_opponent_club_id then
      raise exception 'A return club day must return one of this club''s own club days with the same club.' using errcode = '22023';
    end if;
  end if;

  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id,
                                             proposed_date, game_type, source, planner_batch_id, reverse_of_group_id, created_by)
  values (p_club_id, v_opp_name, v_opp_dir, p_opponent_club_id, p_date, 'Friendly', 'season_planner', p_batch_id, p_reverse_of, v_uid)
  returning id into v_group;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_req_team := nullif(v_item->>'requesting_team_id', '')::uuid;
    v_target := nullif(v_item->>'target_team_id', '')::uuid;
    v_venue := v_item->>'venue_preference';
    v_ack := coalesce((v_item->>'acknowledge_pending')::boolean, false);
    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
    v_request := null; v_reason := null; v_outcome := null;

    if v_venue is null or v_venue not in ('home', 'away') then
      v_outcome := 'failed'; v_reason := 'Choose Home or Away.';
    elsif not exists (select 1 from internal.planner_club_teams(p_club_id) t where t.id = v_req_team) then
      v_outcome := 'failed'; v_reason := 'That team is not one of this club''s active teams.';
    elsif v_target is null or not exists (
            select 1 from public.teams o where o.id = v_target and o.club_id = p_opponent_club_id
               and o.active and o.folded_at is null and o.archived_at is null) then
      v_outcome := 'failed'; v_reason := 'The other club no longer has that team.';
    elsif not internal.teams_can_play_fixture(v_req_team, v_target) then
      v_outcome := 'failed'; v_reason := 'Those two teams cannot play each other.';
    else
      select * into v_clash from internal.planner_team_commitments(array[v_req_team], p_date, p_date) c
       where not (c.kind = 'request_out' and c.status = 'declined')
       order by case c.kind when 'fixture' then 0 when 'competition' then 1 when 'request_in' then 2 else 3 end
       limit 1;
      if found and v_clash.kind = 'fixture' then
        v_outcome := 'blocked'; v_reason := 'Already playing ' || coalesce(v_clash.opponent_label, 'another fixture') || ' that day.';
      elsif found and v_clash.kind = 'competition' then
        v_outcome := 'blocked'; v_reason := 'Has a competition match that day.';
      elsif found and v_clash.opponent_club_id = p_opponent_club_id then
        v_outcome := 'blocked'; v_reason := case v_clash.kind when 'request_in' then 'They have already asked you for this day -- reply to their request.'
                                              else 'A request to them for this day is already open.' end;
      elsif found and not v_ack then
        v_outcome := 'needs_acknowledgement';
        v_reason := 'Already has a pending request with ' || coalesce(v_clash.opponent_label, 'another club') || ' that day.';
      else
        begin
          insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, note, created_by)
          values (v_group, v_req_team, v_target, v_venue, 'sent', v_note, v_uid)
          returning id into v_request;
          v_outcome := 'sent'; v_sent := v_sent + 1; v_targets := v_targets || v_target;
        exception when others then
          v_outcome := 'failed';
          v_reason := case sqlstate when '23505' then 'A request between these two teams for this day is already open.'
                                    when '23514' then sqlerrm
                                    else 'This request could not be created.' end;
        end;
      end if;
    end if;

    v_results := v_results || jsonb_build_object('requesting_team_id', v_req_team, 'target_team_id', v_target,
                                                 'outcome', v_outcome, 'request_id', v_request, 'reason', v_reason);
  end loop;

  if v_sent = 0 then
    delete from public.fixture_request_groups where id = v_group;
    v_group := null;
  else
    -- ONE notice for the whole club day. No team or player is named: a club, a count and a date.
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'club_day_request_received',
           case when p_reverse_of is null then 'Club Day request' else 'Return Club Day request' end,
           format('%s sent a %sClub Day request · %s %s · %s', v_my_name, case when p_reverse_of is null then '' else 'return ' end,
                  v_sent, case when v_sent = 1 then 'fixture' else 'fixtures' end, to_char(p_date, 'Dy FMDD Mon')),
           jsonb_build_object('group_id', v_group, 'club_id', p_opponent_club_id, 'requesting_club_id', p_club_id, 'fixture_count', v_sent)
      from internal.club_day_recipients(p_opponent_club_id, v_targets) r;
  end if;

  if v_group is not null then
    update public.fixture_request_groups set planner_results = v_results where id = v_group;
  end if;
  return jsonb_build_object('group_id', v_group, 'replay', false, 'results', v_results);
end;
$function$;
