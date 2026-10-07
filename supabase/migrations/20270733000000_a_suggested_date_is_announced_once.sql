-- =====================================================================================================
-- A SUGGESTED DATE IS ANNOUNCED ONCE
--
-- `counter_fixture_request` updated the request -- which fires `internal.notify_fixture_request_recipients`,
-- whose counter branch tells the side whose turn it now is -- and then inserted a `fixture_request_countered`
-- of its own as well, to the legacy `team_permissions` list rather than the canonical role assignments. One
-- "Suggest Another Date" therefore reached a coach on both lists twice (integration audit, "no duplicate
-- notification because one Save did two things").
--
-- One emitter now: the trigger, which fires for any counter however it is written, addressed by the
-- canonical role assignments -- and which now carries the RPC's more useful words (the suggested date and
-- kick-off) instead of "a different date/time".
-- =====================================================================================================

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

CREATE OR REPLACE FUNCTION public.counter_fixture_request(p_request_id uuid, p_date date, p_kickoff_time time without time zone, p_venue_preference text, p_note text DEFAULT NULL::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_current_proposer_team_id uuid;
  v_responder_team_id uuid;
  v_responder_club_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'Fixture request not found.' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and v_req.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request has changed since you last viewed it. Please refresh and try again.' using errcode = '40001';
  end if;

  if v_req.target_team_id is null then
    raise exception 'A counter-proposal needs a specific opposing team, not a shared scheduling group.';
  end if;
  if v_req.existing_fixture_id is not null then
    raise exception 'This request is confirming an existing fixture and cannot be countered.';
  end if;
  if v_req.status not in ('sent', 'counter_proposed') then
    raise exception 'This request is no longer open for negotiation (current status: %).', v_req.status;
  end if;
  if p_venue_preference not in ('home', 'away', 'either') then
    raise exception 'Not a recognised venue preference.';
  end if;
  if p_date is null then
    raise exception 'A proposed date is required.';
  end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  -- Whoever's proposal currently stands; the responder (the only one authorised to counter now) is
  -- always the OTHER side.
  v_current_proposer_team_id := coalesce(v_req.last_proposed_by_team_id, v_req.requesting_team_id);
  v_responder_team_id := case when v_current_proposer_team_id = v_req.requesting_team_id then v_req.target_team_id else v_req.requesting_team_id end;
  select club_id into v_responder_club_id from public.teams where id = v_responder_team_id;

  -- Same authority as accept_fixture_request's responder branch (Slice 4C: fixture.request.respond).
  if not (
    (v_responder_club_id is not null and internal.can('fixture.request.respond', 'team', v_responder_club_id, v_responder_team_id, null))
    or (v_responder_club_id is not null and internal.can('fixture.request.respond', 'club', v_responder_club_id, null, null))
    or internal.has_site_capability('site.fixtures.support')
  ) then
    raise exception 'You are not authorized to respond to this fixture request.' using errcode = '42501';
  end if;

  update public.fixture_requests
  set status = 'counter_proposed',
      countered_date = p_date,
      countered_kickoff_time = p_kickoff_time,
      countered_venue_preference = p_venue_preference,
      counter_note = nullif(btrim(p_note), ''),
      countered_by = auth.uid(),
      countered_at = now(),
      last_proposed_by_team_id = v_responder_team_id
  where id = p_request_id;

  -- THE COUNTER IS ANNOUNCED ONCE, by the table's own notification trigger
  -- (`internal.notify_fixture_request_recipients`), which fires on exactly this update. This function used to
  -- insert a second `fixture_request_countered` of its own to a second recipient list, so a coach on both
  -- was told twice about one suggestion (integration audit).
end;
$function$;
