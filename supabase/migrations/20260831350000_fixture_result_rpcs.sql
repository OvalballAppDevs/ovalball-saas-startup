-- submit_fixture_result and resolve_fixture_result_dispute -- the only two
-- paths that may change a fixture's result_* state. Both are SECURITY
-- DEFINER and re-check authorization themselves (RLS is not the boundary
-- here since fixtures.result_* columns are plain UPDATE-able columns on an
-- already-permissive table -- these RPCs ARE the real boundary, matching
-- delete_fixture()/publish_import_row()'s own established pattern in this
-- project of using an RPC as the sole write path for anything with real
-- state-machine semantics).

create or replace function public.submit_fixture_result(p_fixture_id uuid, p_home_score integer, p_away_score integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_caller_club_id uuid;
  v_owning_club_id uuid;
  v_is_external boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to submit a result.' using errcode = '42501';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be zero or a positive whole number.';
  end if;
  if not internal.can_submit_fixture_result(p_fixture_id) then
    raise exception 'You are not authorized to submit a result for this fixture.' using errcode = '42501';
  end if;
  if not internal.fixture_result_eligible(p_fixture_id) then
    if exists (select 1 from public.fixtures where id = p_fixture_id and status = 'Cancelled') then
      raise exception 'This fixture is cancelled -- a cancelled fixture cannot receive a result.';
    end if;
    raise exception 'This fixture has not kicked off yet -- a result cannot be submitted before then.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  v_caller_club_id := internal.caller_fixture_club_id(p_fixture_id);
  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  -- External/unactivated opponent (no resolved opponent team at all, or
  -- the opponent team's club has no active clubs row) -- nobody on the
  -- other side can ever confirm, so this is a one-sided, honestly-labelled
  -- result, finalized immediately.
  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

  if v_is_external then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'external_recorded', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'external_recorded', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_confirmed_by = null, result_confirmed_at = null
    where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result recorded: %s - %s (external opponent, not mutually confirmed through Ovalball).', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'none' or f.result_status is null then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now()
    where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result submitted: %s - %s. Awaiting confirmation.', p_home_score, p_away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_awaiting_confirmation', 'Result awaiting your confirmation',
      format('A result of %s - %s has been submitted for your fixture.', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'awaiting_confirmation' then
    if v_caller_club_id = f.result_submitted_by_club_id then
      -- Same side resubmitting before the other side has responded -- an
      -- update, not a confirmation of anyone else's figure.
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set home_score = p_home_score, away_score = p_away_score, result_submitted_by = auth.uid(), result_submitted_at = now() where id = p_fixture_id;
      return;
    end if;

    if p_home_score = f.home_score and p_away_score = f.away_score then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now() where id = p_fixture_id;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result confirmed: %s - %s. Fixture completed.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result confirmed', format('The result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed' where id = p_fixture_id;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result disputed: submitted %s - %s, but the original submission was %s - %s. Result requires agreement.', p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result disputed', 'The submitted result did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'final' then
    if p_home_score = f.home_score and p_away_score = f.away_score then
      return; -- resubmitting the same already-final score is a harmless no-op
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'amendment_pending',
        result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score,
        result_amendment_proposed_by = auth.uid(), result_amendment_proposed_by_club_id = v_caller_club_id, result_amendment_proposed_at = now()
    where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment proposed: %s - %s (original: %s - %s). Awaiting the other club''s confirmation.', p_home_score, p_away_score, f.home_score, f.away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_amendment_proposed', 'Result amendment proposed',
      format('An amendment to %s - %s (originally %s - %s) has been proposed.', p_home_score, p_away_score, f.home_score, f.away_score));
    return;
  end if;

  if f.result_status = 'amendment_pending' then
    if v_caller_club_id = f.result_amendment_proposed_by_club_id then
      -- The proposing side updating their own still-pending proposal.
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score, result_amendment_proposed_at = now() where id = p_fixture_id;
      return;
    end if;

    if p_home_score = f.result_amendment_proposed_home_score and p_away_score = f.result_amendment_proposed_away_score then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures
      set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
          result_confirmed_by = auth.uid(), result_confirmed_at = now(),
          result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
          result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null
      where id = p_fixture_id;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment confirmed. New final result: %s - %s.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result amendment confirmed', format('The amended result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed' where id = p_fixture_id;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Amendment disputed: proposed %s - %s, but a different amendment (%s - %s) was submitted. The prior final result (%s - %s) is preserved until this is resolved.', f.result_amendment_proposed_home_score, f.result_amendment_proposed_away_score, p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result amendment disputed', 'A proposed amendment did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'disputed' then
    -- Treat a fresh submission during a dispute the same as an initial
    -- submission restarting the awaiting-confirmation cycle -- simplest
    -- correct behaviour, and any genuine impasse still has Site Admin
    -- resolution available.
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now()
    where id = p_fixture_id;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('New result submitted to resolve the dispute: %s - %s. Awaiting confirmation.', p_home_score, p_away_score));
    return;
  end if;
end;
$$;

revoke execute on function public.submit_fixture_result(uuid, integer, integer) from public;
grant execute on function public.submit_fixture_result(uuid, integer, integer) to authenticated;

create or replace function public.resolve_fixture_result_dispute(p_fixture_id uuid, p_home_score integer, p_away_score integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
begin
  if not (internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'fixture_ops') then
    raise exception 'Only a Full Site Admin or Fixture Operations Admin may resolve a disputed result.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to resolve a disputed result.';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be zero or a positive whole number.';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, note)
  values (p_fixture_id, 'site_admin_resolution', p_home_score, p_away_score, auth.uid(), p_reason);

  update public.fixtures
  set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
      result_site_admin_resolved_by = auth.uid(), result_site_admin_resolved_at = now(), result_site_admin_resolution_reason = p_reason,
      result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
      result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null
  where id = p_fixture_id;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result resolved by Site Admin: %s - %s. Reason: %s', p_home_score, p_away_score, p_reason));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result resolved by Site Admin', format('A Site Admin has resolved this fixture''s result as %s - %s.', p_home_score, p_away_score));
end;
$$;

revoke execute on function public.resolve_fixture_result_dispute(uuid, integer, integer, text) from public;
grant execute on function public.resolve_fixture_result_dispute(uuid, integer, integer, text) to authenticated;
