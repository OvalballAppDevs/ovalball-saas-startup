-- Commercial Platform, Phase D -- the trial engine.
--
-- A club's trial is thirty **usable** days, not thirty calendar days. Time
-- only accrues while the trial is running and Ovalball is Live; Beta stops
-- the clock, and so does an explicit pause. A club that spends ten days of
-- its trial inside a Beta period still has the same number of days left
-- when Beta ends.
--
-- That rules out the obvious model. `trial_ends_at = started_at + 30 days`
-- cannot express any of this, because wall-clock time passes whether or not
-- the club can use the product. So the trial stores an entitlement, an
-- accrued consumption, and a mark of when the current accrual started:
--
--   remaining = entitlement_seconds
--             - consumed_seconds
--             - (now() - accruing_since, when accruing)
--
-- Pausing folds the open interval into `consumed_seconds` and clears
-- `accruing_since`; resuming sets it again. Both are idempotent, because
-- pausing an already-paused trial finds `accruing_since` already null and
-- has nothing to fold in.

-- ---------------------------------------------------------------------
-- 1. Club-side capabilities
-- ---------------------------------------------------------------------

-- Named `club.platform_billing.*`, never `club.subscription.*`: the latter
-- already exists and means a club charging its own members. See
-- docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md section 1.
insert into public.capabilities (key, label, description, category, applicable_scopes)
values
  ('club.platform_billing.view', 'View Ovalball billing', 'See this club''s Ovalball trial and subscription with Ovalball.', 'club', array['club']),
  ('club.platform_billing.manage', 'Manage Ovalball billing', 'Start, pause and manage this club''s own subscription to Ovalball.', 'club', array['club'])
on conflict (key) do nothing;

-- Re-declared in full because a function body cannot be amended in place.
-- Every existing key is carried over verbatim; the two
-- club.platform_billing.* keys on the CLUB_ADMIN branch are the only
-- change. Deliberately not granted to FIXTURE_SECRETARY or to an ordinary
-- member: what a club pays Ovalball is a Club Admin matter.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      'team.guardians.invite', 'club.guardians.manage', 'team.community.manage', 'team.attendance.view',
      'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
      'club.subscription.manage_enrolment', 'club.subscription.manage_payment_actions', 'club.subscription.export',
      'club.platform_billing.view', 'club.platform_billing.manage'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- 1b. Changing commercial terms is a Full Site Admin act
-- ---------------------------------------------------------------------

-- Phase C gave Site Admins `site.commercial.view`, which is read-only and
-- delegable. Extending a trial changes what a club owes, so it needs a
-- capability of its own -- a view capability must never authorise a write.
-- It is deliberately NOT delegable: the branch below returns false, and
-- `internal.is_full_site_admin()` has already short-circuited to true above
-- it, so a Full Site Admin holds it and nobody else can be given it.
insert into public.capabilities (key, label, description, category, applicable_scopes)
values ('site.commercial.manage', 'Change commercial terms', 'Extend a trial or otherwise change what a club owes Ovalball. Full Site Admin only.', 'site', array['site'])
on conflict (key) do nothing;

create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when internal.is_full_site_admin() then true
    when p_capability_key = 'site.permissions.manage' then coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.lookups.manage' then coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.team_catalogue.manage' then coalesce((select manage_team_catalogue from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.competitions.manage' then coalesce((select manage_competitions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.fixture_support.manage' then coalesce((select manage_fixture_support from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.diagnostic.access' then coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.seasons.manage' then coalesce((select manage_seasons from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.release.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.beta.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.commercial.view' then coalesce((select view_commercial from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.commercial.manage' then false
    else internal.is_site_admin()
  end;
$$;

-- ---------------------------------------------------------------------
-- 1c. Notification topic
-- ---------------------------------------------------------------------

-- Mandatory, like account_security: a club being told its trial is about to
-- end is not a marketing preference. It decides whether the club keeps
-- working next week.
insert into public.notification_topics (key, label, description, mandatory, sort_order, email_ready, push_ready)
values (
  'platform_billing',
  'Ovalball billing and trial',
  'Your club''s trial and subscription with Ovalball. Separate from any payments your club collects from its own members.',
  true,
  80,
  false,
  false
)
on conflict (key) do nothing;

insert into public.notification_types (type_key, topic_key)
values
  ('platform_trial_ending_soon', 'platform_billing'),
  ('platform_trial_ended', 'platform_billing')
on conflict (type_key) do nothing;

-- The two Phase C access-change notifications belong with their siblings.
insert into public.notification_types (type_key, topic_key)
values
  ('site_admin_system_access_changed', 'account_security'),
  ('site_admin_commercial_access_changed', 'account_security')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------
-- 2. platform_trials
-- ---------------------------------------------------------------------

create table if not exists public.platform_trials (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null unique references public.clubs(id) on delete cascade,

  -- Thirty days, in seconds. Editable per club: a Site Admin may extend a
  -- trial, and the extension belongs here rather than in a second column,
  -- so the arithmetic stays one subtraction.
  entitlement_seconds bigint not null default 2592000,

  -- Time already used and folded in. Only ever increases, and only by a
  -- pause or by the expiry engine closing an open interval.
  consumed_seconds bigint not null default 0,

  -- Non-null exactly while the clock is running.
  accruing_since timestamptz,

  -- Why the clock is stopped. Null exactly while it is running. 'beta' is
  -- the one value the platform sets and clears by itself; leaving Beta must
  -- not resume a trial a club or an admin paused for their own reasons.
  pause_reason text,

  status text not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Thresholds (in whole days remaining) already notified, so a club is
  -- warned once per threshold rather than every time the engine runs.
  notified_thresholds int[] not null default '{}',

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_trials_status_check check (status in ('active', 'paused', 'completed', 'converted')),
  constraint platform_trials_pause_reason_check check (pause_reason is null or pause_reason in ('beta', 'club_request', 'admin')),
  constraint platform_trials_entitlement_positive check (entitlement_seconds > 0),
  constraint platform_trials_consumed_not_negative check (consumed_seconds >= 0),

  -- The three fields cannot disagree about whether the clock is running.
  constraint platform_trials_state_coherent check (
    (status = 'active'   and accruing_since is not null and pause_reason is null     and completed_at is null)
    or (status = 'paused'    and accruing_since is null     and pause_reason is not null and completed_at is null)
    or (status in ('completed', 'converted') and accruing_since is null and pause_reason is null and completed_at is not null)
  )
);

create index if not exists platform_trials_status_idx on public.platform_trials (status);
create index if not exists platform_trials_accruing_idx on public.platform_trials (accruing_since) where accruing_since is not null;

alter table public.platform_trials enable row level security;

-- A club sees its own trial; a Site Admin sees every trial. Nobody writes
-- to this table directly -- every transition goes through a function below,
-- so that the accrual arithmetic has exactly one implementation.
drop policy if exists platform_trials_select on public.platform_trials;
create policy platform_trials_select on public.platform_trials
  for select
  using (internal.has_capability('club.platform_billing.view', 'club', club_id) or internal.is_site_admin());

drop trigger if exists set_updated_at on public.platform_trials;
create trigger set_updated_at
  before update on public.platform_trials
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_trials;
create trigger audit_row_change
  after insert or update or delete on public.platform_trials
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. The arithmetic, in one place
-- ---------------------------------------------------------------------

create or replace function internal.trial_remaining_seconds(
  p_entitlement bigint,
  p_consumed bigint,
  p_accruing_since timestamptz
)
returns bigint
language sql
stable
as $$
  select greatest(
    0,
    p_entitlement - p_consumed - case
      when p_accruing_since is null then 0
      else greatest(0, floor(extract(epoch from (now() - p_accruing_since)))::bigint)
    end
  );
$$;

comment on function internal.trial_remaining_seconds is
  'The only implementation of trial remaining time. Stable, not immutable: it reads now(), so it must never appear in an index expression or a generated column.';

-- ---------------------------------------------------------------------
-- 4. Transitions
-- ---------------------------------------------------------------------

-- Starting a trial. Idempotent: a club that already has one keeps it,
-- untouched, and gets its existing id back. A trial never restarts.
create or replace function public.start_club_trial(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_mode text;
begin
  if not (internal.has_capability('club.platform_billing.manage', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to start a trial for this club.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'No active club found for that id.';
  end if;

  select id into v_id from public.platform_trials where club_id = p_club_id;
  if v_id is not null then
    return v_id;
  end if;

  -- In Beta the clock does not run, so a trial started during Beta starts
  -- paused rather than immediately burning days a club cannot use.
  v_mode := coalesce(internal.current_platform_mode(), 'beta');

  insert into public.platform_trials (club_id, accruing_since, pause_reason, status, created_by, updated_by)
  values (
    p_club_id,
    case when v_mode = 'live' then now() else null end,
    case when v_mode = 'live' then null else 'beta' end,
    case when v_mode = 'live' then 'active' else 'paused' end,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Pausing. Idempotent, and deliberately so: a retried request, or Beta
-- being entered twice, must not double-count anything. An already-paused
-- trial has no open interval to fold in, so the second call changes
-- nothing at all -- not even the recorded reason, because the first reason
-- is the true one.
create or replace function internal.pause_trial_row(p_club_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open timestamptz;
begin
  select accruing_since into v_open
  from public.platform_trials
  where club_id = p_club_id and status = 'active'
  for update;

  if not found or v_open is null then
    return false;
  end if;

  update public.platform_trials
  set consumed_seconds = consumed_seconds + greatest(0, floor(extract(epoch from (now() - v_open)))::bigint),
      accruing_since = null,
      pause_reason = p_reason,
      status = 'paused',
      updated_by = auth.uid()
  where club_id = p_club_id;

  return true;
end;
$$;

-- Resuming. `p_only_reason` lets the Beta transition resume exactly the
-- trials Beta itself paused, and leave alone the ones a club or an admin
-- paused for their own reasons.
create or replace function internal.resume_trial_row(p_club_id uuid, p_only_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_remaining bigint;
begin
  select pause_reason,
         internal.trial_remaining_seconds(entitlement_seconds, consumed_seconds, accruing_since)
    into v_reason, v_remaining
  from public.platform_trials
  where club_id = p_club_id and status = 'paused'
  for update;

  if not found then
    return false;
  end if;

  if p_only_reason is not null and v_reason is distinct from p_only_reason then
    return false;
  end if;

  -- An exhausted trial does not resume; it completes.
  if v_remaining <= 0 then
    update public.platform_trials
    set status = 'completed', pause_reason = null, completed_at = now(), updated_by = auth.uid()
    where club_id = p_club_id;
    return false;
  end if;

  update public.platform_trials
  set accruing_since = now(), pause_reason = null, status = 'active', updated_by = auth.uid()
  where club_id = p_club_id;

  return true;
end;
$$;

create or replace function public.pause_club_trial(p_club_id uuid, p_reason text default 'club_request')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (internal.has_capability('club.platform_billing.manage', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to pause this club''s trial.' using errcode = '42501';
  end if;
  if p_reason not in ('club_request', 'admin') then
    raise exception 'A trial may only be paused for a club request or by an admin. Beta pauses are set by the platform.';
  end if;
  return internal.pause_trial_row(p_club_id, p_reason);
end;
$$;

create or replace function public.resume_club_trial(p_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if not (internal.has_capability('club.platform_billing.manage', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to resume this club''s trial.' using errcode = '42501';
  end if;

  select pause_reason into v_reason from public.platform_trials where club_id = p_club_id;

  -- A Beta pause is the platform's, not the club's. Letting a club resume
  -- out of it would start charging time for a period Ovalball has said it
  -- is not charging for.
  if v_reason = 'beta' then
    raise exception 'This trial is paused because Ovalball is in Beta. It resumes automatically when Beta ends.';
  end if;

  return internal.resume_trial_row(p_club_id, null);
end;
$$;

-- Extending. Site Admin only: it is a commercial decision, and it is the
-- one way entitlement changes after the trial begins.
create or replace function public.extend_club_trial(p_club_id uuid, p_extra_days int, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement bigint;
begin
  if not internal.has_capability('site.commercial.manage', 'site') then
    raise exception 'Not authorized to extend a trial.' using errcode = '42501';
  end if;
  if p_extra_days is null or p_extra_days <= 0 then
    raise exception 'An extension needs a positive number of days.';
  end if;

  update public.platform_trials
  set entitlement_seconds = entitlement_seconds + (p_extra_days::bigint * 86400),
      -- An extension revives a trial that had run out; it does not revive
      -- one the club has already converted away from.
      status = case when status = 'completed' then 'paused' else status end,
      pause_reason = case when status = 'completed' then 'admin' else pause_reason end,
      completed_at = case when status = 'completed' then null else completed_at end,
      notified_thresholds = '{}',
      updated_by = auth.uid()
  where club_id = p_club_id and status <> 'converted'
  returning entitlement_seconds into v_entitlement;

  if v_entitlement is null then
    raise exception 'No extendable trial found for that club.';
  end if;

  return v_entitlement;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Reading a trial
-- ---------------------------------------------------------------------

create or replace function public.club_trial_state(p_club_id uuid)
returns table (
  status text,
  remaining_seconds bigint,
  entitlement_seconds bigint,
  consumed_seconds bigint,
  pause_reason text,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.status,
         internal.trial_remaining_seconds(t.entitlement_seconds, t.consumed_seconds, t.accruing_since),
         t.entitlement_seconds,
         t.consumed_seconds,
         t.pause_reason,
         t.started_at,
         t.completed_at
  from public.platform_trials t
  where t.club_id = p_club_id
    and (internal.has_capability('club.platform_billing.view', 'club', t.club_id) or internal.is_site_admin());
$$;

-- ---------------------------------------------------------------------
-- 6. Beta stops every clock
-- ---------------------------------------------------------------------

create or replace function internal.apply_platform_mode_to_trials(p_mode text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
  v_count integer := 0;
begin
  if p_mode = 'beta' then
    for v_club in select club_id from public.platform_trials where status = 'active' loop
      if internal.pause_trial_row(v_club, 'beta') then
        v_count := v_count + 1;
      end if;
    end loop;
  elsif p_mode = 'live' then
    for v_club in select club_id from public.platform_trials where status = 'paused' and pause_reason = 'beta' loop
      if internal.resume_trial_row(v_club, 'beta') then
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return v_count;
end;
$$;

-- Re-declared from Phase C with the trial hook attached. Everything else is
-- carried over verbatim.
create or replace function public.set_platform_mode(
  p_mode text,
  p_reason text default null,
  p_release_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_id uuid;
begin
  if not internal.has_capability('site.system.beta.manage', 'site') then
    raise exception 'Not authorized to change the platform mode.' using errcode = '42501';
  end if;

  if p_mode not in ('beta', 'live') then
    raise exception 'Unknown platform mode: %.', p_mode;
  end if;

  v_current := internal.current_platform_mode();
  if v_current is not distinct from p_mode then
    return null;
  end if;

  insert into public.platform_mode_events (new_mode, release_id, reason, changed_by)
  values (p_mode, p_release_id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;

  -- Entering Beta stops every running trial clock; leaving Beta restarts
  -- exactly the ones Beta stopped. Beta is paused time, never accrued debt,
  -- so no club is back-billed for it.
  perform internal.apply_platform_mode_to_trials(p_mode);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Expiry and warnings
-- ---------------------------------------------------------------------

-- Idempotent by construction: a completed trial no longer matches the
-- status filter, and a threshold already in `notified_thresholds` is never
-- notified twice. Safe to run every fifteen minutes forever.
create or replace function internal.process_due_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_remaining bigint;
  v_days int;
  v_threshold int;
  v_completed integer := 0;
begin
  for r in
    select club_id, entitlement_seconds, consumed_seconds, accruing_since, notified_thresholds
    from public.platform_trials
    where status = 'active'
    for update
  loop
    v_remaining := internal.trial_remaining_seconds(r.entitlement_seconds, r.consumed_seconds, r.accruing_since);

    if v_remaining <= 0 then
      update public.platform_trials
      set consumed_seconds = entitlement_seconds,
          accruing_since = null,
          pause_reason = null,
          status = 'completed',
          completed_at = now()
      where club_id = r.club_id;

      perform internal.notify_club_platform_billing(
        r.club_id,
        'platform_trial_ended',
        'Your Ovalball trial has ended',
        'Your club''s free trial of Ovalball has now used its full thirty days. Your club data is untouched; choose a plan to carry on.',
        jsonb_build_object('club_id', r.club_id)
      );

      v_completed := v_completed + 1;
      continue;
    end if;

    -- Warn once at each threshold the trial has fallen below.
    v_days := floor(v_remaining / 86400.0)::int;
    foreach v_threshold in array array[14, 7, 3, 1] loop
      if v_days <= v_threshold and not (v_threshold = any(r.notified_thresholds)) then
        perform internal.notify_club_platform_billing(
          r.club_id,
          'platform_trial_ending_soon',
          format('%s day%s left of your Ovalball trial', v_threshold, case when v_threshold = 1 then '' else 's' end),
          'Choose a plan before the trial ends to keep everything running without a break.',
          jsonb_build_object('club_id', r.club_id, 'days_remaining', v_threshold)
        );

        update public.platform_trials
        set notified_thresholds = notified_thresholds || v_threshold
        where club_id = r.club_id;
        exit;
      end if;
    end loop;
  end loop;

  return v_completed;
end;
$$;

-- Notifies the people who can actually act on it: this club's active Club
-- Admins. One `notifications` row each, on the existing single
-- notification system.
create or replace function internal.notify_club_platform_billing(
  p_club_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb)
  from public.club_memberships cm
  where cm.club_id = p_club_id
    and cm.status = 'active'
    and cm.authority_suspended = false
    and cm.role = 'CLUB_ADMIN';
end;
$$;

create or replace function public.run_trial_expiry_check()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may manually trigger the trial expiry check.' using errcode = '42501';
  end if;
  return internal.process_due_trials();
end;
$$;

grant execute on function public.run_trial_expiry_check() to authenticated;

-- Local-only scheduling, exactly as the three existing jobs do it.
-- Provisioning pg_cron on the remote project is a deployment step for
-- whoever operates it; this migration only ever touches the local database.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('process-due-trials');
exception when others then
  null;
end;
$$;

select cron.schedule('process-due-trials', '*/15 * * * *', $$select internal.process_due_trials()$$);
