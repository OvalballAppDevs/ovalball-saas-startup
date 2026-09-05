-- 24-hour dispute window, automatic finalization, the new 'unverified'
-- result state, and mirror-row propagation for the result workflow.
--
-- Reconciliation approach (documented per the brief's own requirement):
-- this environment has no scheduled-job/cron infrastructure wired up, so
-- rather than fake a background timer, public.reconcile_overdue_fixture_
-- results() is a plain, idempotent, safely-repeatable SET-BASED update --
-- calling it twice (or concurrently, via FOR UPDATE SKIP LOCKED) has no
-- additional effect beyond the first genuine transition. Every read
-- surface that shows fixture results (fixture conversation, Fixture
-- Management, club/team fixture lists, calendar, dashboard) calls it
-- before rendering, so "any later read safely finalizes overdue results
-- exactly once" holds without a real scheduler. If this project later
-- adds one (pg_cron, a Supabase Edge Function on a schedule, a Vercel
-- Cron route), that job should simply call this same function -- no
-- second implementation.

alter table public.fixtures drop constraint fixtures_result_status_check;
alter table public.fixtures add constraint fixtures_result_status_check
  check (result_status in ('none', 'awaiting_confirmation', 'final', 'disputed', 'amendment_pending', 'external_recorded', 'unverified'));

alter table public.fixtures add column result_deadline_at timestamptz;

comment on column public.fixtures.result_deadline_at is
  'Set to now()+24h when a result enters awaiting_confirmation (undisputed -> final if this passes) or disputed (unresolved -> unverified if this passes). Null whenever the current result_status has no deadline (none/final/amendment_pending/external_recorded/unverified). Read by reconcile_overdue_fixture_results(), never by a client-side timer.';

create index fixtures_result_deadline_idx on public.fixtures (result_status, result_deadline_at) where result_deadline_at is not null;

alter table public.fixture_result_submissions drop constraint fixture_result_submissions_kind_check;
alter table public.fixture_result_submissions add constraint fixture_result_submissions_kind_check
  check (kind in ('initial', 'confirmation', 'dispute', 'amendment_proposal', 'amendment_confirmation', 'amendment_dispute', 'site_admin_resolution', 'external_recorded', 'auto_finalized', 'auto_unverified'));

-- ============================================================
-- submit_fixture_result: re-declared with the SAME signature, purely to
-- add (a) result_deadline_at bookkeeping, (b) mirror-row propagation of
-- every field it changes -- home_score/away_score/result_status/etc. are
-- never swapped, the mirror row gets the identical values. Every existing
-- state-machine branch and every existing chat system event/notification
-- is unchanged.
-- ============================================================

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

  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t join public.clubs c on c.id = t.club_id where t.id = f.opponent_team_id and c.status = 'active');

  if v_is_external then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'external_recorded', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'external_recorded', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_confirmed_by = null, result_confirmed_at = null, result_deadline_at = null
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'external_recorded', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_confirmed_by = null, result_confirmed_at = null, result_deadline_at = null
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result recorded: %s - %s (external opponent, not mutually confirmed through Ovalball).', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'none' or f.result_status is null then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_deadline_at = now() + interval '24 hours'
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_deadline_at = now() + interval '24 hours'
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result submitted: %s - %s. Awaiting confirmation (24 hours).', p_home_score, p_away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_awaiting_confirmation', 'Result awaiting your confirmation',
      format('A result of %s - %s has been submitted for your fixture. You have 24 hours to confirm or dispute it.', p_home_score, p_away_score));
    return;
  end if;

  if f.result_status = 'awaiting_confirmation' then
    if v_caller_club_id = f.result_submitted_by_club_id then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set home_score = p_home_score, away_score = p_away_score, result_submitted_by = auth.uid(), result_submitted_at = now() where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set home_score = p_home_score, away_score = p_away_score, result_submitted_by = auth.uid(), result_submitted_at = now() where id = f.mirror_fixture_id;
      end if;
      return;
    end if;

    if p_home_score = f.home_score and p_away_score = f.away_score then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'confirmation', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(), result_deadline_at = null where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(), result_deadline_at = null where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result confirmed: %s - %s. Fixture completed.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result confirmed', format('The result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result disputed: submitted %s - %s, but the original submission was %s - %s. Result requires agreement.', p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result disputed', 'The submitted result did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'final' then
    if p_home_score = f.home_score and p_away_score = f.away_score then
      return;
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'amendment_pending',
        result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score,
        result_amendment_proposed_by = auth.uid(), result_amendment_proposed_by_club_id = v_caller_club_id, result_amendment_proposed_at = now()
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'amendment_pending',
          result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score,
          result_amendment_proposed_by = auth.uid(), result_amendment_proposed_by_club_id = v_caller_club_id, result_amendment_proposed_at = now()
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment proposed: %s - %s (original: %s - %s). Awaiting the other club''s confirmation.', p_home_score, p_away_score, f.home_score, f.away_score));
    perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_amendment_proposed', 'Result amendment proposed',
      format('An amendment to %s - %s (originally %s - %s) has been proposed.', p_home_score, p_away_score, f.home_score, f.away_score));
    return;
  end if;

  if f.result_status = 'amendment_pending' then
    if v_caller_club_id = f.result_amendment_proposed_by_club_id then
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_proposal', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score, result_amendment_proposed_at = now() where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_amendment_proposed_home_score = p_home_score, result_amendment_proposed_away_score = p_away_score, result_amendment_proposed_at = now() where id = f.mirror_fixture_id;
      end if;
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
      if f.mirror_fixture_id is not null then
        update public.fixtures
        set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
            result_confirmed_by = auth.uid(), result_confirmed_at = now(),
            result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
            result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null
        where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result amendment confirmed. New final result: %s - %s.', p_home_score, p_away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result amendment confirmed', format('The amended result %s - %s is now final.', p_home_score, p_away_score));
    else
      insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
      values (p_fixture_id, 'amendment_dispute', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
      update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = p_fixture_id;
      if f.mirror_fixture_id is not null then
        update public.fixtures set result_status = 'disputed', result_deadline_at = now() + interval '24 hours' where id = f.mirror_fixture_id;
      end if;
      perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Amendment disputed: proposed %s - %s, but a different amendment (%s - %s) was submitted. The prior final result (%s - %s) is preserved until this is resolved.', f.result_amendment_proposed_home_score, f.result_amendment_proposed_away_score, p_home_score, p_away_score, f.home_score, f.away_score));
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_disputed', 'Result amendment disputed', 'A proposed amendment did not match -- this fixture''s result now needs agreement.');
    end if;
    return;
  end if;

  if f.result_status = 'disputed' or f.result_status = 'unverified' then
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, submitted_by_club_id)
    values (p_fixture_id, 'initial', p_home_score, p_away_score, auth.uid(), v_caller_club_id);
    update public.fixtures
    set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
        result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
        result_deadline_at = now() + interval '24 hours'
    where id = p_fixture_id;
    if f.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'awaiting_confirmation', home_score = p_home_score, away_score = p_away_score,
          result_submitted_by = auth.uid(), result_submitted_by_club_id = v_caller_club_id, result_submitted_at = now(),
          result_deadline_at = now() + interval '24 hours'
      where id = f.mirror_fixture_id;
    end if;
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('New result submitted to resolve the dispute: %s - %s. Awaiting confirmation.', p_home_score, p_away_score));
    return;
  end if;
end;
$$;

revoke execute on function public.submit_fixture_result(uuid, integer, integer) from public;
grant execute on function public.submit_fixture_result(uuid, integer, integer) to authenticated;

-- ============================================================
-- resolve_fixture_result_dispute: re-declared purely to also propagate to
-- a linked mirror row and clear result_deadline_at -- every other line
-- unchanged. Now the sanctioned resolution path for 'unverified' too, not
-- only 'disputed'/'amendment_pending' (a Site Admin/Fixture Ops resolving
-- an unverified result is exactly the same operation).
-- ============================================================

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
      result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null,
      result_deadline_at = null
  where id = p_fixture_id;
  if f.mirror_fixture_id is not null then
    update public.fixtures
    set result_status = 'final', home_score = p_home_score, away_score = p_away_score,
        result_site_admin_resolved_by = auth.uid(), result_site_admin_resolved_at = now(), result_site_admin_resolution_reason = p_reason,
        result_amendment_proposed_home_score = null, result_amendment_proposed_away_score = null,
        result_amendment_proposed_by = null, result_amendment_proposed_by_club_id = null, result_amendment_proposed_at = null,
        result_deadline_at = null
    where id = f.mirror_fixture_id;
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('Result resolved by Site Admin: %s - %s. Reason: %s', p_home_score, p_away_score, p_reason));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_result_final', 'Result resolved by Site Admin', format('A Site Admin has resolved this fixture''s result as %s - %s.', p_home_score, p_away_score));
end;
$$;

revoke execute on function public.resolve_fixture_result_dispute(uuid, integer, integer, text) from public;
grant execute on function public.resolve_fixture_result_dispute(uuid, integer, integer, text) to authenticated;

-- ============================================================
-- reconcile_overdue_fixture_results: the idempotent reconciliation path
-- (see migration header comment). FOR UPDATE SKIP LOCKED makes concurrent
-- calls (e.g. two page loads racing) safe -- each overdue fixture is
-- transitioned by exactly one caller, others skip it rather than block or
-- double-process.
-- ============================================================

create or replace function public.reconcile_overdue_fixture_results()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, mirror_fixture_id, home_score, away_score, result_submitted_by
    from public.fixtures
    where result_status = 'awaiting_confirmation' and result_deadline_at is not null and result_deadline_at < now()
    for update skip locked
  loop
    update public.fixtures
    set result_status = 'final', result_confirmed_by = r.result_submitted_by, result_confirmed_at = now(), result_deadline_at = null
    where id = r.id;
    if r.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'final', result_confirmed_by = r.result_submitted_by, result_confirmed_at = now(), result_deadline_at = null
      where id = r.mirror_fixture_id;
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, note)
    values (r.id, 'auto_finalized', r.home_score, r.away_score, r.result_submitted_by, 'Automatically finalized -- no dispute within 24 hours.');
    perform internal.fixture_result_system_event(r.id, r.result_submitted_by, format('Result automatically finalized after 24 hours with no dispute: %s - %s.', r.home_score, r.away_score));
    v_count := v_count + 1;
  end loop;

  for r in
    select id, mirror_fixture_id, home_score, away_score, result_submitted_by
    from public.fixtures
    where result_status = 'disputed' and result_deadline_at is not null and result_deadline_at < now()
    for update skip locked
  loop
    update public.fixtures set result_status = 'unverified', result_deadline_at = null where id = r.id;
    if r.mirror_fixture_id is not null then
      update public.fixtures set result_status = 'unverified', result_deadline_at = null where id = r.mirror_fixture_id;
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, note)
    values (r.id, 'auto_unverified', r.home_score, r.away_score, r.result_submitted_by, 'Automatically marked Unverified -- unresolved 24 hours after the dispute.');
    perform internal.fixture_result_system_event(r.id, r.result_submitted_by, 'Result marked Unverified -- the clubs did not resolve their disagreement within 24 hours. A Site Admin can still resolve this.');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.reconcile_overdue_fixture_results() is
  'Idempotent, safe to call from any read path or (if this project ever adds one) a real scheduled job -- transitions exactly the fixtures whose deadline has genuinely passed, exactly once each (FOR UPDATE SKIP LOCKED). Never invents a background timer.';

grant execute on function public.reconcile_overdue_fixture_results() to authenticated;
