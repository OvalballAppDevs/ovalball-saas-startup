-- Pitch/playing-area (already existed as fixtures.pitch_allocation --
-- schema scaffolding from the original migration, never wired up until
-- now) and the full post-match results workflow. Reuses public.fixtures
-- itself as the one canonical record (home_score/away_score already
-- existed there too, unused) -- no separate results-fixture table, per
-- the brief. stage_one_confirmation/final_confirmation were the same kind
-- of unwired scaffolding (never read anywhere in the app) and are dropped
-- in favour of the richer state model below, which a pair of booleans
-- cannot represent (disputed / amendment_pending / external_recorded).

alter table public.fixtures drop column stage_one_confirmation;
alter table public.fixtures drop column final_confirmation;

alter table public.fixtures
  add column result_status text not null default 'none'
    check (result_status in ('none', 'awaiting_confirmation', 'final', 'disputed', 'amendment_pending', 'external_recorded')),
  add column result_submitted_by uuid references auth.users(id),
  add column result_submitted_by_club_id uuid references public.clubs(id),
  add column result_submitted_at timestamptz,
  add column result_confirmed_by uuid references auth.users(id),
  add column result_confirmed_at timestamptz,
  add column result_amendment_proposed_home_score integer,
  add column result_amendment_proposed_away_score integer,
  add column result_amendment_proposed_by uuid references auth.users(id),
  add column result_amendment_proposed_by_club_id uuid references public.clubs(id),
  add column result_amendment_proposed_at timestamptz,
  add column result_site_admin_resolved_by uuid references auth.users(id),
  add column result_site_admin_resolved_at timestamptz,
  add column result_site_admin_resolution_reason text;

comment on column public.fixtures.result_status is
  'none: no result yet. awaiting_confirmation: one side submitted, opponent has not responded. final: both sides agree (or one-sided external/Site-Admin-resolved). disputed: opposing submissions disagree. amendment_pending: a change to a FINAL result was proposed and awaits the other side. external_recorded: one-sided result for a canonical-but-unactivated opponent, honestly labelled as never mutually confirmed.';

-- ============================================================
-- fixture_result_submissions: full, never-destroyed history of every
-- submission/confirmation/dispute/amendment/resolution event. fixtures'
-- own result_* columns hold only the CURRENT state; this table is how a
-- disputed pair of scores, or a superseded pre-amendment final result,
-- stays visible and auditable rather than being silently overwritten.
-- ============================================================

create table public.fixture_result_submissions (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  kind text not null check (kind in ('initial', 'confirmation', 'dispute', 'amendment_proposal', 'amendment_confirmation', 'amendment_dispute', 'site_admin_resolution', 'external_recorded')),
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  submitted_by uuid not null references auth.users(id),
  submitted_by_club_id uuid references public.clubs(id),
  note text,
  created_at timestamptz not null default now()
);

create index fixture_result_submissions_fixture_id_idx on public.fixture_result_submissions (fixture_id, created_at);

comment on table public.fixture_result_submissions is
  'Append-only history for the result workflow -- never updated or deleted by application code. fixtures.result_* holds the current/official state; this table is the full trail behind it (both sides of a dispute, every amendment, every Site Admin resolution with its reason).';

alter table public.fixture_result_submissions enable row level security;

create policy fixture_result_submissions_select_scoped on public.fixture_result_submissions for select
  using (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixtures f
      where f.id = fixture_id
        and (internal.can_manage_team(f.owning_team_id)
             or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id))
             or internal.can_manage_club_fixtures((select club_id from public.teams where id = f.owning_team_id))
             or (f.opponent_team_id is not null
                 and internal.can_manage_club_fixtures((select club_id from public.teams where id = f.opponent_team_id))))
    )
  );

-- No direct insert/update/delete policy -- every row is written exclusively
-- by the SECURITY DEFINER RPCs below, which do their own authorization.

create trigger audit_row_change after insert or update or delete on public.fixture_result_submissions
  for each row execute function internal.audit_row_change();

-- ============================================================
-- Authorization + eligibility helpers
-- ============================================================

create function internal.can_submit_fixture_result(p_fixture_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;
  if not found then
    return false;
  end if;
  return internal.can_manage_team(f.owning_team_id)
    or (f.opponent_team_id is not null and internal.can_manage_team(f.opponent_team_id))
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = f.owning_team_id))
    or (f.opponent_team_id is not null
        and internal.can_manage_club_fixtures((select club_id from public.teams where id = f.opponent_team_id)));
end;
$$;

comment on function internal.can_submit_fixture_result(uuid) is
  'Same participating-club-official boundary as fixture conversation access (Club Admin/Fixtures Admin/relevant Team Admin for either side, or Site Admin) -- never a Parent/Player/View Only/unrelated club, matching the brief.';

grant execute on function internal.can_submit_fixture_result(uuid) to authenticated;

-- Which real club a caller is acting for on this fixture (owning or
-- opponent side) -- used to attribute a submission correctly and to tell
-- whether a second submission is from the SAME side (an amendment/resubmit,
-- never a dispute) or the OPPOSING side (a real confirmation/dispute).
create function internal.caller_fixture_club_id(p_fixture_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
  v_owning_club_id uuid;
  v_opponent_club_id uuid;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;
  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;
  if f.opponent_team_id is not null then
    select club_id into v_opponent_club_id from public.teams where id = f.opponent_team_id;
  end if;

  if internal.can_manage_team(f.owning_team_id) or internal.can_manage_club_fixtures(v_owning_club_id) then
    return v_owning_club_id;
  end if;
  if v_opponent_club_id is not null and (internal.can_manage_team(f.opponent_team_id) or internal.can_manage_club_fixtures(v_opponent_club_id)) then
    return v_opponent_club_id;
  end if;
  return null;
end;
$$;

grant execute on function internal.caller_fixture_club_id(uuid) to authenticated;

-- Server-side eligibility -- never trust client-side "today". Prefers
-- kickoff_date + kickoff_time when known; falls back to end-of-day on
-- kickoff_date when the time is not set (a sensible, documented default
-- rather than allowing same-day-morning results before a fixture some
-- teams haven't even kicked off in yet).
create function internal.fixture_result_eligible(p_fixture_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
begin
  select kickoff_date, kickoff_time, status into f from public.fixtures where id = p_fixture_id;
  if not found or f.status = 'Cancelled' then
    return false;
  end if;
  if f.kickoff_time is not null then
    return (f.kickoff_date + f.kickoff_time) <= now();
  end if;
  return (f.kickoff_date + interval '1 day') <= now();
end;
$$;

comment on function internal.fixture_result_eligible(uuid) is
  'True once the fixture''s real kickoff has passed (date+time when known, else end of kickoff_date) and it is not cancelled. The real, unbypassable gate for submit_fixture_result -- never just a UI affordance.';

grant execute on function internal.fixture_result_eligible(uuid) to authenticated;

-- Recipients for a result-workflow notification: Club Admin/Fixtures
-- Admin/relevant Team Admin at the OTHER side's club, mirroring
-- internal.notify_fixture_message_recipients' own reasoning exactly.
create function internal.fixture_result_notify(p_fixture_id uuid, p_exclude_user_id uuid, p_type text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct recipient, p_type, p_title, p_body, jsonb_build_object('fixture_id', p_fixture_id)
  from (
    select cm.user_id as recipient
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id in (f.owning_team_id, f.opponent_team_id)
      and tp.permission in ('team_admin', 'coach', 'manager')
    union
    select cm.user_id as recipient
    from public.club_memberships cm
    join public.teams t on t.club_id = cm.club_id
    where t.id in (f.owning_team_id, f.opponent_team_id)
      and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  ) recipients
  where recipient <> p_exclude_user_id;
end;
$$;

-- A plain system-event message in the existing fixture conversation --
-- reuses fixture_messages/its own notification trigger rather than a
-- second event feed. kind='system_event' distinguishes it from a real
-- human message in the UI.
create function internal.fixture_result_system_event(p_fixture_id uuid, p_actor uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body, kind)
  values (p_fixture_id, p_actor, p_body, 'system_event');
end;
$$;

-- fixture_messages needs a kind column for the system-event distinction
-- above (see also the fixture_result_submissions integration below).
alter table public.fixture_messages add column kind text not null default 'message' check (kind in ('message', 'system_event'));

comment on column public.fixture_messages.kind is
  'message: a real human wrote this. system_event: an automated record of something happening in the fixture lifecycle (result submitted/confirmed/disputed, pitch changed) -- rendered distinctly in the UI, never presented as if a person typed it.';
