-- CA-M11.5 -- FIXTURE EXCHANGE: CANONICAL COUNTER-PROPOSAL (Section 17-20, 56, 63-64 of the brief).
--
-- CA-M11.4's own audit confirmed 'counter_proposed' has existed in fixture_requests_status_check since
-- the table's creation, and has display labels in four places across both clients -- but NOTHING has
-- ever written it. This migration is the smallest safe canonical extension that makes it real, exactly
-- as designed in docs/mobile/CA_M11_4_FIXTURE_REQUEST_PARTNER_CALENDAR_MAP.md's own "Proposed
-- counter-proposal extension" section.
--
-- SCOPE, DELIBERATELY NARROWED. Countering only applies to an ordinary team-to-team request
-- (target_team_id is not null) that is negotiating a NEW fixture (existing_fixture_id is null -- a
-- request raised from the fixture editor to confirm which of the opponent's teams plays an ALREADY
-- existing fixture has nothing to renegotiate a date/time for). The rarer scheduling-group-targeted
-- path (a Mini-Rugby shared calendar as the opponent) keeps its existing accept/decline-only behaviour.
-- This is a real, stated scope boundary, not an oversight -- extending accept_fixture_request's already
-- complex 14-revision history further than necessary in one pass was the exact risk the CA-M11.4 map
-- document flagged.
--
-- THE STANDING PROPOSAL. `countered_date`/`countered_kickoff_time`/`countered_venue_preference` always
-- hold the CURRENT proposal on the table once status = 'counter_proposed' -- never a diff against the
-- original, so accept_fixture_request never has to walk a chain of prior counters. `last_proposed_by_
-- team_id` names whichever team's proposal currently stands (the requesting team initially, whichever
-- team last countered thereafter); the side that may accept/decline/counter next is always the OTHER
-- one. This is the whole state machine: two sides, and whoever did not make the last move.
--
-- THE ORIGINAL PROPOSAL IS NEVER DESTROYED. fixture_request_groups.proposed_date and this row's own
-- preferred_kickoff_time/venue_preference are untouched by a counter -- the negotiation HISTORY (this
-- migration's own fixture_request_history()) reads the existing, generic audit_log rows this table's
-- pre-existing audit_row_change trigger already writes on every insert/update, so "how was this agreed"
-- survives acceptance rather than being overwritten in place.
--
-- STALE-PROPOSAL PROTECTION (Section 63). Both accept_fixture_request and counter_fixture_request take
-- an OPTIONAL p_expected_updated_at. When supplied and it no longer matches the row's own updated_at
-- (maintained by the pre-existing set_updated_at trigger), the mutation is refused with a specific,
-- actionable error rather than silently acting against a proposal the caller's own screen no longer
-- reflects -- exactly Section 63's own worked example (A looks at proposal #2, B sends #3, A must not
-- silently accept #3 while believing they accepted #2). Optional and defaulting to null so every
-- EXISTING caller of accept_fixture_request keeps working completely unchanged; only callers that pass
-- the value they last read gain the protection.

alter table public.fixture_requests
  add column countered_date date,
  add column countered_kickoff_time time without time zone,
  add column countered_venue_preference text check (countered_venue_preference in ('home', 'away', 'either')),
  add column counter_note text check (counter_note is null or char_length(btrim(counter_note)) <= 500),
  add column countered_by uuid references auth.users(id),
  add column countered_at timestamptz,
  add column last_proposed_by_team_id uuid references public.teams(id);

comment on column public.fixture_requests.countered_date is 'CA-M11.5: the CURRENT standing proposal''s date once status=counter_proposed -- always the latest round, never a diff against the original. Null (fall back to fixture_request_groups.proposed_date) when the current round did not change the date.';
comment on column public.fixture_requests.countered_kickoff_time is 'CA-M11.5: as countered_date, for kick-off time -- null falls back to preferred_kickoff_time.';
comment on column public.fixture_requests.countered_venue_preference is 'CA-M11.5: as countered_date, for venue preference -- null falls back to venue_preference. Same home/away/either vocabulary, same "relative to the ORIGINAL requesting team" convention as venue_preference itself, so accept_fixture_request''s existing home/away resolution needs no new interpretation.';
comment on column public.fixture_requests.last_proposed_by_team_id is 'CA-M11.5: whichever team''s proposal currently stands -- the requesting team when status=sent (implicitly; only set explicitly once a counter occurs), or whichever team most recently countered. The OTHER side is always the one who may accept/decline/counter next.';

-- ============================================================
-- counter_fixture_request -- the one canonical write for a counter-proposal, both clients.
-- ============================================================
create or replace function public.counter_fixture_request(
  p_request_id uuid,
  p_date date,
  p_kickoff_time time without time zone,
  p_venue_preference text,
  p_note text default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_current_proposer_team_id uuid;
  v_responder_team_id uuid;
  v_responder_club_id uuid;
  v_notify_club_name text;
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

  select cd.name into v_notify_club_name
  from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory cd on cd.id = c.directory_id
  where t.id = v_responder_team_id;

  -- Notify whoever must now respond to THIS counter -- the side that is NOT the one who just made it.
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_countered', 'Alternative date proposed',
    format('%s suggested %s at %s for your fixture request.', coalesce(v_notify_club_name, 'The other club'), to_char(p_date, 'DD Mon YYYY'), coalesce(to_char(p_kickoff_time, 'HH24:MI'), 'a time to confirm')),
    jsonb_build_object('fixture_request_id', p_request_id, 'group_id', v_req.group_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = (case when v_responder_team_id = v_req.requesting_team_id then v_req.target_team_id else v_req.requesting_team_id end)
    and tp.permission in ('team_admin', 'coach', 'manager');
end;
$$;

comment on function public.counter_fixture_request(uuid, date, time, text, text, timestamptz) is 'CA-M11.5: propose an alternative date/kick-off/venue for an open fixture request. Only the side that did NOT make the current standing proposal may call this. Preserves the original proposal (fixture_request_groups.proposed_date, this row''s own preferred_kickoff_time/venue_preference) untouched -- history survives in audit_log, read via fixture_request_history(). Optional p_expected_updated_at protects against acting on a stale view (Section 63).';

grant execute on function public.counter_fixture_request(uuid, date, time, text, text, timestamptz) to authenticated;
grant execute on function public.counter_fixture_request(uuid, date, time, text, text, timestamptz) to service_role;

-- ============================================================
-- accept_fixture_request -- extended to resolve a standing counter-proposal correctly.
-- ============================================================
-- Every line preserved from the prior revision except: (a) an optional p_expected_updated_at parameter
-- for the same stale-protection as the counter RPC, (b) the request-is-open check now accepts
-- 'counter_proposed' as well as 'sent', (c) authority when countered is checked against whichever side
-- did NOT make the standing proposal (never simply "the target team", which would let the side that
-- JUST countered immediately accept their own counter), (d) the effective date/kick-off/venue actually
-- applied to the resulting fixture are the CURRENT standing values (countered_* when present) rather
-- than always the original proposal.
--
-- ADDING A PARAMETER MEANS A NEW SIGNATURE. `create or replace function` only replaces a function with
-- the EXACT SAME argument list -- since p_expected_updated_at is new, the two-argument original would
-- otherwise survive alongside this one as a second, unpatched overload, silently reachable by any
-- existing two-argument call and refusing a legitimate counter-proposal acceptance outright (it still
-- believes only 'sent' is answerable). Drop it explicitly rather than leave two versions of the same
-- canonical operation disagreeing with each other.
drop function if exists public.accept_fixture_request(uuid, uuid);

create or replace function public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid default null::uuid, p_expected_updated_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_target_group_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_both_clubs_active boolean;
  v_pitch_id uuid;
  v_venue_id uuid;
  v_venue_address text;
  v_effective_date date;
  v_effective_kickoff_time time without time zone;
  v_effective_venue_preference text;
  v_accepting_team_id uuid;
  v_accepting_club_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and v_req.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request has changed since you last viewed it. Please refresh and try again.' using errcode = '40001';
  end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if v_req.requesting_team_id is not null then
    v_requesting_team_id := v_req.requesting_team_id;
  else
    select min(team_id) into v_requesting_team_id from public.scheduling_group_members where group_id = v_req.requesting_scheduling_group_id;
    if v_requesting_team_id is null then
      raise exception 'This shared calendar has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
      v_target_group_id := null;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      end if;
      v_target_team_id := v_auto_resolved_team_id;
      v_target_group_id := v_req.target_scheduling_group_id;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
    v_target_group_id := null;
  end if;

  if v_target_team_id is not null then
    select club_id into v_target_club_id from public.teams where id = v_target_team_id;
  else
    v_target_club_id := v_group.opponent_club_id;
  end if;

  if v_req.status = 'counter_proposed' then
    -- CA-M11.5: whoever did NOT make the standing counter is the only side who may accept it -- never
    -- simply "the target team", which would otherwise let the side that just countered immediately
    -- accept their own counter (Section 19's own state-machine requirement).
    v_accepting_team_id := case when v_req.last_proposed_by_team_id = v_req.requesting_team_id then v_target_team_id else v_req.requesting_team_id end;
    select club_id into v_accepting_club_id from public.teams where id = v_accepting_team_id;
    if not (
      (v_accepting_club_id is not null and internal.can('fixture.request.respond', 'team', v_accepting_club_id, v_accepting_team_id, null))
      or (v_accepting_club_id is not null and internal.can('fixture.request.respond', 'club', v_accepting_club_id, null, null))
      or internal.has_site_capability('site.fixtures.support')
    ) then
      raise exception 'You are not authorized to respond to this fixture request.' using errcode = '42501';
    end if;
  else
    -- Slice 4C: responding to a fixture request is fixture.request.respond, at the team being asked
    -- or at its club. J.6 line 466 grants it to CA, FS and TM -- a Coach may raise a request but not
    -- answer one.
    if not ((v_target_team_id is not null and v_target_club_id is not null
             and internal.can('fixture.request.respond', 'team', v_target_club_id, v_target_team_id, null))
            or (v_target_club_id is not null
                and internal.can('fixture.request.respond', 'club', v_target_club_id, null, null))
            or internal.has_site_capability('site.fixtures.support')) then
      raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
    end if;
  end if;
  if v_req.status not in ('sent', 'counter_proposed') then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  -- CA-M11.5: the CURRENT standing proposal -- the original when never countered, or the latest round.
  v_effective_date := coalesce(v_req.countered_date, v_group.proposed_date);
  v_effective_kickoff_time := coalesce(v_req.countered_kickoff_time, v_req.preferred_kickoff_time);
  v_effective_venue_preference := coalesce(v_req.countered_venue_preference, v_req.venue_preference);

  v_requesting_club_venue := case v_effective_venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_effective_venue_preference
    when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end;

  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;
  v_venue_id := case when v_requesting_club_venue = 'Home' then v_req.venue_id else null end;

  -- AN AWAY REQUEST'S PROPOSED GROUND. The host is accepting the fixture at the
  -- ground it was asked about. When that names one of the host's own venues it
  -- becomes that venue record; otherwise it is kept as the ground's text.
  if v_requesting_club_venue = 'Away' and nullif(btrim(v_req.proposed_ground), '') is not null then
    select v.id into v_venue_id
    from public.venues v
    where v.club_id = v_target_club_id and v.active and lower(btrim(v.name)) = lower(btrim(v_req.proposed_ground))
    order by v.is_default_home desc, v.id
    limit 1;
    if v_venue_id is null then
      v_venue_address := btrim(v_req.proposed_ground)
        || coalesce(', ' || nullif(btrim(v_req.proposed_pitch), ''), '');
    elsif nullif(btrim(v_req.proposed_pitch), '') is not null then
      select p.id into v_pitch_id
      from public.club_pitches p
      where p.venue_id = v_venue_id and p.active and lower(btrim(p.display_name)) = lower(btrim(v_req.proposed_pitch))
      limit 1;
    end if;
  end if;

  -- AN EXISTING FIXTURE, CONFIRMED. A request raised from the fixture editor
  -- asks the opposition to confirm which of their teams plays a fixture that
  -- already exists; accepting it completes that fixture rather than creating
  -- a second one. Anything else is the ordinary new fixture.
  if v_req.existing_fixture_id is not null then
    update public.fixtures f
    set opponent_team_id = v_target_team_id,
        opponent_directory_id = coalesce((select c.directory_id from public.clubs c where c.id = v_target_club_id), f.opponent_directory_id),
        updated_by = auth.uid()
    where f.id = v_req.existing_fixture_id
      and f.status <> 'Cancelled'
      and f.opponent_team_id is null
      and f.owning_team_id = v_requesting_team_id
    returning f.id into v_fixture_id;
    if v_fixture_id is null then
      raise exception 'That fixture has been cancelled or changed since this request was sent, so there is nothing to confirm.' using errcode = '23514';
    end if;
  else
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id, opponent_scheduling_group_id,
      game_type, competition_edition_id, pitch_id, venue_id, venue_address,
      created_by, updated_by
    )
    values (
      v_requesting_team_id, v_req.requesting_scheduling_group_id, v_effective_date, v_effective_kickoff_time,
      v_requesting_club_venue, 'Booked',
      v_group.raw_opponent_text,
      -- A fixture carries ONE canonical opponent identity: either an
      -- opponent scheduling group or an opponent directory club, never
      -- both (fixtures_opponent_group_excludes_directory). When the
      -- request resolves against a Mini-Rugby Group, the group IS the
      -- opponent identity, so the directory reference must be dropped.
      case when v_target_group_id is not null then null else v_group.opponent_directory_id end,
      v_target_team_id, v_target_group_id,
      v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id, v_venue_address,
      v_req.created_by, auth.uid()
    )
    returning id into v_fixture_id;
  end if;

  update public.fixture_requests
  set status = 'accepted', target_team_id = v_target_team_id,
      resulting_fixture_id = v_fixture_id, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_effective_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_requesting_team_id;

  if v_target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
      format('Your fixture on %s has been confirmed.', to_char(v_effective_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_target_team_id;
  end if;

  if v_target_club_id is not null and v_group.requesting_club_id <> v_target_club_id then
    select (select status from public.clubs where id = v_group.requesting_club_id) = 'active'
           and (select status from public.clubs where id = v_target_club_id) = 'active'
      into v_both_clubs_active;

    if v_both_clubs_active and not exists (
      select 1 from public.club_partnerships cp
      where cp.status <> 'revoked'
        and least(cp.requesting_club_id, cp.partner_club_id) = least(v_group.requesting_club_id, v_target_club_id)
        and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(v_group.requesting_club_id, v_target_club_id)
    ) then
      begin
        insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by, source_fixture_id)
        values (v_group.requesting_club_id, v_target_club_id, v_req.created_by, v_fixture_id);
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$$;

grant execute on function public.accept_fixture_request(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.accept_fixture_request(uuid, uuid, timestamptz) to service_role;

-- ============================================================
-- Notification on a counter-proposal (extends the existing per-transition trigger, same established
-- role-string recipient pattern its sibling branches already use -- not modernised to full capability-
-- decision recipient resolution in this pass, matching the rest of this trigger, a documented pre-
-- existing debt (CA-M11.4 map), not something this migration's own scope should touch).
-- ============================================================
create or replace function internal.notify_fixture_request_recipients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.requesting_team_id and tp.permission in ('team_admin', 'coach', 'manager')
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
      format('%s suggested a different date/time for your fixture request.', coalesce(v_proposer_club_name, 'The other club')),
      jsonb_build_object('fixture_request_id', new.id, 'group_id', new.group_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_notify_team_id and tp.permission in ('team_admin', 'coach', 'manager');

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
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = new.target_team_id and tp.permission in ('team_admin', 'coach', 'manager');
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

-- ============================================================
-- fixture_request_history -- the negotiation history, read from the existing generic audit_log
-- (already populated by this table's own pre-existing audit_row_change trigger), never exposed
-- directly (audit_log's own RLS requires site.audit.view -- a Site Admin capability ordinary club/team
-- staff do not and should not hold). Re-checks the SAME select authority as fixture_requests itself,
-- and returns only the columns relevant to fixture negotiation -- never a raw jsonb diff.
-- ============================================================
create or replace function public.fixture_request_history(p_request_id uuid)
returns table(
  changed_at timestamptz,
  changed_by_club_name text,
  status_before text,
  status_after text,
  date_after text,
  kickoff_time_after text,
  note_after text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
begin
  select * into v_req from public.fixture_requests where id = p_request_id;
  if not found then
    raise exception 'Fixture request not found.' using errcode = '42501';
  end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if not (
    (internal.can('fixture.request.create', 'team', (select t.club_id from public.teams t where t.id = v_req.requesting_team_id), v_req.requesting_team_id, null))
    or (v_req.target_team_id is not null and internal.can('fixture.request.respond', 'team', (select t.club_id from public.teams t where t.id = v_req.target_team_id), v_req.target_team_id, null))
    or internal.can('fixture.request.create', 'club', v_group.requesting_club_id, null, null)
    or (v_group.opponent_club_id is not null and internal.can('fixture.request.respond', 'club', v_group.opponent_club_id, null, null))
    or internal.has_site_capability('site.fixtures.support')
  ) then
    raise exception 'You are not authorized to view this fixture request.' using errcode = '42501';
  end if;

  return query
  select
    a.changed_at,
    cd.name,
    a.before ->> 'status',
    a.after ->> 'status',
    coalesce(a.after ->> 'countered_date', case when a.action = 'insert' then to_char(v_group.proposed_date, 'YYYY-MM-DD') end),
    coalesce(a.after ->> 'countered_kickoff_time', case when a.action = 'insert' then a.after ->> 'preferred_kickoff_time' end),
    coalesce(a.after ->> 'counter_note', a.after ->> 'note')
  from public.audit_log a
  left join public.club_memberships cm on cm.user_id = a.changed_by and cm.status = 'active'
  left join public.clubs c on c.id = cm.club_id
  left join public.club_directory cd on cd.id = c.directory_id
  where a.table_name = 'fixture_requests' and a.record_id = p_request_id
  order by a.changed_at;
end;
$$;

comment on function public.fixture_request_history(uuid) is 'CA-M11.5 (Section 20/59): the auditable negotiation history for one fixture request, read from the existing generic audit_log rather than a second history table. Same view authority as reading the request itself. Never exposes a raw jsonb diff -- only the columns relevant to fixture negotiation.';

grant execute on function public.fixture_request_history(uuid) to authenticated;
grant execute on function public.fixture_request_history(uuid) to service_role;
