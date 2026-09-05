-- SIDE PROJECT 2 -- TRAINING MANAGEMENT, Phase B: canonical data model.
--
-- Reconciles onto the EXISTING public.training_sessions table
-- (20260902160000) rather than creating a second training entity --
-- confirmed by direct audit that it is a real, non-fake calendar event
-- model already reused by the "Schedule Training" Calendar dialog
-- (app/(app)/calendar/schedule-training-dialog.tsx) and already RLS/
-- capability-gated via internal.can_manage_training ->
-- internal.has_capability('fixture.create', ...) (20260924000000). This
-- migration ADDS the recurring-plan layer on top (training_plans,
-- training_plan_schedule_rules) and extends training_sessions with the
-- columns automatic generation needs, without changing the meaning of any
-- existing column or the authority manual "Schedule Training" already has.
--
-- One deliberate architecture decision, documented here since it departs
-- from the spec's own suggested status list: training_sessions.status
-- stores ONLY the real lifecycle (PLANNED / CANCELLED) -- "needs pitch
-- allocation" and "completed" are never stored, because Main's own
-- existing Pitch Allocation feature already treats "allocated vs
-- unallocated" as a COMPUTED property of (pitch_id, kickoff_time)
-- presence, never a persisted status column on fixtures
-- (lib/pitch-allocation/auto-allocate.ts's partitionAllocation). Storing a
-- second, potentially-stale "PITCH_REQUIRED"/"COMPLETED" status on
-- training_sessions would be exactly the redundant-status Section 26 asks
-- us not to invent. See internal.effective_training_session_status() in
-- the next migration for the computed presentation layer.

-- =====================================================================
-- PART A: CAPABILITY (Section 43 -- exactly one new key; view stays on
-- the existing wide-open training_sessions_select policy, matching this
-- table's own established "pitch/training names are not sensitive" posture)
-- =====================================================================
insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('club.training.manage', 'Manage Training Plans', 'Create, edit, and deactivate recurring automatic Training Plans for any team at this club. Deliberately Club-Admin-only -- manual ad-hoc "Schedule Training" on the Calendar is unaffected and keeps its existing fixture.create-based authority for Team Admin/Coach/Manager.', 'team', array['club'])
on conflict (key) do nothing;

-- Club Admin only, per Section 44's explicit instruction not to let every
-- Coach rewrite club-wide automatic Training Plans. Re-derived from this
-- database's CURRENT live definition (confirmed via \sf immediately before
-- writing this migration) so no other role's existing grant is touched.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
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
      'club.training.manage'
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
$function$;

-- =====================================================================
-- PART B: TRAINING PLANS (recurring scheduling intent -- Section 3/4)
-- =====================================================================
create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  team_id uuid not null references public.teams(id),
  -- Required for SEASON / SEASON_PRE_SEASON modes (dates derive from this
  -- row); null only for CUSTOM mode, where each schedule rule carries its
  -- own explicit date range instead (Section 12-14).
  season_id uuid references public.seasons(id),
  schedule_mode text not null check (schedule_mode in ('SEASON', 'SEASON_PRE_SEASON', 'CUSTOM')),
  preferred_venue_id uuid not null references public.venues(id),
  preferred_pitch_id uuid not null references public.club_pitches(id),
  -- ACTIVE = automatic booking on, generates/retains future sessions.
  -- INACTIVE = deliberately deactivated by a Club Admin (Section 24).
  -- NEEDS_ATTENTION = team/venue/pitch went inactive, or (SEASON_PRE_SEASON
  -- mode) the season's pre_season_starts_on is missing (Section 13/46/47)
  -- -- surfaced, never silently generates against a fabricated date.
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION')),
  needs_attention_reason text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deactivated_by uuid references auth.users(id),
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (schedule_mode = 'CUSTOM' or season_id is not null),
  check (status != 'NEEDS_ATTENTION' or needs_attention_reason is not null),
  check (status != 'INACTIVE' or deactivated_at is not null)
);

comment on table public.training_plans is 'Recurring Training scheduling intent for ONE team (Section 3-4: plan is intent, training_sessions are the concrete dated occurrences it generates). One team may have more than one plan (Section 50 -- e.g. Monday morning + Thursday evening as two distinct plans, or two plans for two different date windows), so this is deliberately NOT unique per (team_id, season_id) alone.';
comment on column public.training_plans.season_id is 'Season this plan is scheduled against (Section 41: a 2026/27 plan must never silently generate 2027/28 sessions). Null only for CUSTOM mode.';

create index training_plans_club_id_idx on public.training_plans (club_id);
create index training_plans_team_id_idx on public.training_plans (team_id);
create index training_plans_active_idx on public.training_plans (team_id) where status = 'ACTIVE';

create trigger set_updated_at before update on public.training_plans
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update or delete on public.training_plans
  for each row execute function internal.audit_row_change();

alter table public.training_plans enable row level security;

-- Read: matches training_sessions' own established "not sensitive" posture
-- (a plan's own existence/config is no more sensitive than the sessions it
-- produces, which are already publicly readable).
create policy training_plans_select on public.training_plans for select using (true);

-- Write: RPC-only below (all use security definer + internal.has_capability
-- explicitly), but a direct-table defense-in-depth policy is still correct
-- practice matching this codebase's convention elsewhere.
create policy training_plans_write_scoped on public.training_plans
  for all using (internal.has_capability('club.training.manage', 'club', club_id, null))
  with check (internal.has_capability('club.training.manage', 'club', club_id, null));

-- =====================================================================
-- PART C: SCHEDULE RULES (Section 15 -- structured child records, never a
-- comma-separated weekday string; each rule has its own weekday/dates/
-- time/duration so Monday and Thursday can genuinely differ)
-- =====================================================================
create table public.training_plan_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow from ...).
  weekday integer not null check (weekday between 0 and 6),
  -- CUSTOM mode only: this rule's own explicit date range (Section 14).
  -- SEASON/SEASON_PRE_SEASON modes leave these null -- the effective range
  -- is resolved dynamically from the plan's season_id + schedule_mode by
  -- internal.resolve_training_plan_occurrence_dates() (Section 79's ONE
  -- canonical resolver), never duplicated/hardcoded here, so a season-date
  -- correction never requires editing every rule row.
  starts_on date,
  ends_on date,
  start_time time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

comment on table public.training_plan_schedule_rules is 'One weekly training pattern within a plan (Section 15-16). A plan may have one, two, or more rules (e.g. Monday 18:00/90min + Thursday 19:00/60min) each with independent day/time/duration/date-range.';
comment on column public.training_plan_schedule_rules.starts_on is 'CUSTOM mode only -- null for SEASON/SEASON_PRE_SEASON, whose effective range is resolved dynamically from the parent plan''s season, never stored per-rule.';

create index training_plan_schedule_rules_plan_id_idx on public.training_plan_schedule_rules (training_plan_id);

create trigger set_updated_at before update on public.training_plan_schedule_rules
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update or delete on public.training_plan_schedule_rules
  for each row execute function internal.audit_row_change();

alter table public.training_plan_schedule_rules enable row level security;

create policy training_plan_schedule_rules_select on public.training_plan_schedule_rules for select using (true);

create policy training_plan_schedule_rules_write_scoped on public.training_plan_schedule_rules
  for all using (
    exists (select 1 from public.training_plans tp where tp.id = training_plan_id and internal.has_capability('club.training.manage', 'club', tp.club_id, null))
  )
  with check (
    exists (select 1 from public.training_plans tp where tp.id = training_plan_id and internal.has_capability('club.training.manage', 'club', tp.club_id, null))
  );

-- =====================================================================
-- PART D: EXTEND training_sessions (additive columns only -- every
-- existing column, index, policy, and RPC on this table is untouched)
-- =====================================================================
alter table public.training_sessions
  add column training_plan_id uuid references public.training_plans(id),
  add column schedule_rule_id uuid references public.training_plan_schedule_rules(id),
  add column season_id uuid references public.seasons(id),
  add column venue_id uuid references public.venues(id),
  add column duration_minutes integer check (duration_minutes is null or duration_minutes between 15 and 240),
  -- CANCELLED mirrors the pre-existing cancelled_at/cancellation_reason
  -- columns exactly (kept for backward compatibility with anything already
  -- reading them) -- status is the new single source of truth going
  -- forward; a trigger below keeps both in lockstep so nothing can drift.
  add column status text not null default 'PLANNED' check (status in ('PLANNED', 'CANCELLED')),
  add column source text not null default 'MANUAL' check (source in ('MANUAL', 'AUTOMATIC_PLAN')),
  -- Idempotent-generation identity (Section 22): a given schedule rule can
  -- produce at most one row per local occurrence date.
  add column occurrence_date date,
  -- Section 23/25: once true, plan regeneration/reconciliation must never
  -- touch this row's time/venue/pitch/status again.
  add column is_overridden boolean not null default false;

comment on column public.training_sessions.training_plan_id is 'Null for manual/ad-hoc Calendar training (Section 31) -- populated only for AUTOMATIC_PLAN-sourced sessions.';
comment on column public.training_sessions.source is 'AUTOMATIC_PLAN: generated by a training_plan. MANUAL: created via the Calendar "Schedule Training" dialog, training_plan_id is null (Section 20/31). One physical session = one training_sessions row either way -- never two competing tables.';
comment on column public.training_sessions.status is 'The only stored lifecycle state (Section 26): PLANNED or CANCELLED. "Needs pitch allocation" and "Completed" are deliberately NOT stored here -- see internal.effective_training_session_status() for why and how they are computed instead.';
comment on column public.training_sessions.is_overridden is 'Set true the moment a Club Admin edits a single AUTOMATIC_PLAN-sourced occurrence (time/venue/pitch/cancel) independently of its plan (Section 25). Plan-level regeneration/reconciliation skips every overridden row.';

-- One occurrence per (schedule_rule_id, occurrence_date) -- reruns of the
-- generator are naturally idempotent via ON CONFLICT DO NOTHING against
-- this exact index (Section 22), with no fragile client-side dedup.
create unique index training_sessions_occurrence_key_idx
  on public.training_sessions (schedule_rule_id, occurrence_date)
  where schedule_rule_id is not null and occurrence_date is not null;

create index training_sessions_training_plan_id_idx on public.training_sessions (training_plan_id) where training_plan_id is not null;
create index training_sessions_season_id_idx on public.training_sessions (season_id) where season_id is not null;
create index training_sessions_status_idx on public.training_sessions (status);

-- Keep the new `status` column and the pre-existing `cancelled_at` column
-- in lockstep regardless of which one a caller writes, so no future code
-- path can silently desync them.
create or replace function internal.sync_training_session_cancellation()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'CANCELLED' and new.cancelled_at is null then
    new.cancelled_at := now();
  elsif new.status = 'PLANNED' then
    new.cancelled_at := null;
    new.cancellation_reason := null;
  elsif new.cancelled_at is not null and new.status <> 'CANCELLED' then
    new.status := 'CANCELLED';
  end if;
  return new;
end;
$function$;

create trigger sync_training_session_cancellation
  before insert or update on public.training_sessions
  for each row execute function internal.sync_training_session_cancellation();
