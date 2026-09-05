-- Historical vs future fixture reconciliation on opponent-club activation.
--
-- Two genuinely different cases share the same trigger (a club activating
-- via approve_club_claim or any future activation path), and they must NOT
-- be treated the same:
--
--  FUTURE: a still-actionable fixture_request_groups/fixture_requests
--  negotiation whose proposed_date has not yet passed. Unchanged from the
--  existing reconciliation -- link opponent_club_id, notify the new club's
--  officials of the outstanding request, let them accept/reject through the
--  existing accept_fixture_request() / fixture_requests_update_scoped path.
--
--  HISTORICAL: either (a) a negotiation whose proposed_date has already
--  passed without ever being accepted -- there is no meaningful "accept" for
--  a date that's already gone, so it quietly expires (reusing the existing
--  'expired' status -- no new status invented) rather than generating a
--  pending-request notification; or (b) a real public.fixtures row created
--  directly against the canonical-but-unactivated opponent (Site Admin Add
--  Fixture / CSV import, both one-sided at creation time, matching how
--  historical data is entered in practice), which fixtures_select_all
--  already makes visible to anyone (it's `using (true)`) but which the
--  newly-activated opponent's officials could not previously ACT on --
--  claim_external_fixture_result() below is the missing write path.

-- ============================================================
-- 1. Date-aware fixture_request_groups/fixture_requests reconciliation
-- ============================================================

create or replace function internal.reconcile_opponent_directory_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_request record;
  v_recipient uuid;
  v_requesting_club_name text;
  v_is_future boolean;
begin
  for v_group in
    select id, requesting_club_id, raw_opponent_text, proposed_date
    from public.fixture_request_groups
    where opponent_directory_id = new.directory_id and opponent_club_id is null
  loop
    update public.fixture_request_groups set opponent_club_id = new.id where id = v_group.id;

    v_is_future := v_group.proposed_date >= current_date;

    if not v_is_future then
      -- The proposed date has already passed and this negotiation was never
      -- accepted -- there is nothing left to accept. Quietly expire it
      -- (reusing the existing fixture_requests.status vocabulary) instead
      -- of surfacing it as a pending request and building a backlog for a
      -- club that just joined.
      update public.fixture_requests
      set status = 'expired', decided_at = now()
      where group_id = v_group.id and status = 'sent';
      continue;
    end if;

    select cd.name into v_requesting_club_name
    from public.clubs c join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id;

    for v_request in
      select id, requesting_team_id from public.fixture_requests where group_id = v_group.id and status = 'sent'
    loop
      for v_recipient in
        select cm.user_id
        from public.club_memberships cm
        where cm.club_id = new.id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_recipient,
          'fixture_request_received',
          'Outstanding fixture request',
          format('%s proposed a fixture on %s, from before your club activated Ovalball.', coalesce(v_requesting_club_name, 'A club'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
          jsonb_build_object('fixture_request_id', v_request.id, 'group_id', v_group.id)
        );
      end loop;
    end loop;
  end loop;

  return new;
end;
$$;

comment on function internal.reconcile_opponent_directory_requests() is
  'Links any fixture_request_groups.opponent_directory_id-only request to a newly-activated clubs row (stable id match, never fuzzy name). A FUTURE (proposed_date not yet passed) outstanding request notifies the new club''s CLUB_ADMIN/FIXTURE_SECRETARY officials as an actionable pending request. A HISTORICAL one (proposed_date already passed, never accepted) is quietly marked expired instead -- it is not a real fixture and there is nothing left to accept, so it must not build a notification backlog for a club that just joined.';

-- ============================================================
-- 2. One non-action-demanding summary notification for directly-created
--    historical fixtures newly linkable to this club (optional per brief,
--    kept intentionally simple: a single count, never one notification per
--    fixture). Future direct fixtures are deliberately excluded from this
--    summary -- the club-facing "propose a fixture" flow already goes
--    through fixture_request_groups (handled above); a Site-Admin-entered
--    future fixture against an unactivated opponent is the rare case and
--    surfaces the same way a historical one does, via ordinary browsing of
--    the public fixtures list (fixtures_select_all already permits it) --
--    not through this summary, which is scoped to "results happened
--    without you" rather than "here is a pending decision".
-- ============================================================

create or replace function internal.notify_historical_fixture_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_recipient uuid;
begin
  select count(*) into v_count
  from public.fixtures f
  where f.opponent_directory_id = new.directory_id
    and f.opponent_team_id is null
    and (f.kickoff_date + coalesce(f.kickoff_time, '23:59:59'::time)) < now();

  if v_count = 0 then
    return new;
  end if;

  for v_recipient in
    select cm.user_id
    from public.club_memberships cm
    where cm.club_id = new.id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  loop
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_recipient,
      'historical_fixtures_linked',
      'Historical fixtures linked to your club',
      format('%s historical fixture%s recorded against your club before it activated Ovalball %s now visible in your fixture history. No action is required -- open a fixture from there if you want to review or dispute its result.',
        v_count, case when v_count = 1 then '' else 's' end, case when v_count = 1 then 'is' else 'are' end),
      jsonb_build_object('directory_id', new.directory_id)
    );
  end loop;

  return new;
end;
$$;

comment on function internal.notify_historical_fixture_links() is
  'Exactly one summary notification on activation (never one per fixture) telling the new club how many historical fixtures already reference it. No acceptance is implied or required -- see claim_external_fixture_result() for the opt-in per-fixture dispute path.';

create constraint trigger notify_historical_fixture_links
  after insert on public.clubs
  deferrable initially deferred
  for each row execute function internal.notify_historical_fixture_links();

-- ============================================================
-- 3. claim_external_fixture_result -- the missing write path for a
--    newly-activated opponent to link one of their own teams to a fixture
--    that was recorded directly against their canonical club before they
--    activated, and either agree with the recorded result (matching
--    scores -> final) or dispute it (differing scores -> disputed,
--    original preserved in history exactly like any other dispute).
--    Never required: "no action = result stands" (external_recorded is
--    already a legitimate, honestly-labelled terminal state on its own).
-- ============================================================

create or replace function public.claim_external_fixture_result(
  p_fixture_id uuid, p_team_id uuid, p_home_score integer, p_away_score integer, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_team public.teams;
  v_caller_club_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be zero or a positive whole number.';
  end if;
  if not internal.can_manage_team(p_team_id) then
    raise exception 'You are not authorized to act for that team.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if f.opponent_team_id is not null then
    raise exception 'This fixture already has a linked opponent team.';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  select club_id into v_caller_club_id from public.teams where id = p_team_id;

  -- Stable canonical-directory match only -- never fuzzy club-name
  -- matching. The claiming team's own club must be the exact canonical
  -- club the fixture already points at.
  if f.opponent_directory_id is null or v_team.club_id is null
     or not exists (
       select 1 from public.clubs c
       where c.id = v_team.club_id and c.directory_id = f.opponent_directory_id
     ) then
    raise exception 'That team does not belong to the canonical opponent club this fixture references.' using errcode = '42501';
  end if;

  if f.result_status is distinct from 'external_recorded' then
    raise exception 'Only a historically-recorded external result can be claimed and disputed this way (current status: %).', f.result_status;
  end if;

  -- Link the team either way -- this is the one-time resolution of "which
  -- of the newly-activated club's teams this fixture was actually against".
  update public.fixtures set opponent_team_id = p_team_id where id = p_fixture_id;

  if p_home_score = f.home_score and p_away_score = f.away_score then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id, note)
    values (p_fixture_id, 'confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id, p_note);
    update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now() where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('%s activated Ovalball and confirmed the historical result: %s - %s.', v_team.display_name, p_home_score, p_away_score));
  else
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id, note)
    values (p_fixture_id, 'dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id, p_note);
    update public.fixtures set result_status = 'disputed' where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('%s activated Ovalball and disputed the historical result (recorded as %s - %s, disputed as %s - %s).%s', v_team.display_name, f.home_score, f.away_score, p_home_score, p_away_score, case when p_note is not null then ' Reason: ' || p_note else '' end));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Historical result disputed',
      format('%s has disputed the historical result recorded for this fixture.', v_team.display_name));
  end if;
end;
$$;

comment on function public.claim_external_fixture_result(uuid, uuid, integer, integer, text) is
  'The opt-in path for a newly-activated opponent to link their own team to a fixture recorded against their canonical club while unactivated, and either confirm (matching scores) or dispute (differing scores) the historical result. Original result/history is always preserved via fixture_result_submissions -- never silently overwritten. Doing nothing is equally valid: the external_recorded result simply stands.';

revoke execute on function public.claim_external_fixture_result(uuid, uuid, integer, integer, text) from public;
grant execute on function public.claim_external_fixture_result(uuid, uuid, integer, integer, text) to authenticated;
