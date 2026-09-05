-- Completion pass Sections 5-7, 31-40: Pitch Allocation needs a real Club
-- Settings surface. club_scheduling_policy previously had no write UI at
-- all (Pitch Allocation's data.ts only ever read it, falling back to
-- DEFAULT_SCHEDULING_POLICY when absent) -- this adds the columns that
-- surface needs, on the same row-per-club table, rather than a new one.
--
-- auto_allocate_home_fixtures: Section 5's "Automatically allocate home
-- fixtures" toggle. OFF by default (existing clubs must opt in -- this
-- must never start silently generating/committing allocations for a club
-- that never asked for it).
--
-- warm_up_minutes / pack_up_minutes: Section 31-40's allocation buffer
-- periods. Deliberately a SEPARATE pair of columns from turnaround_minutes
-- (the existing generic between-fixtures gap used by autoAllocate's own
-- slot search) rather than folded into it -- turnaround_minutes already
-- has an independent, real meaning (gap between two different fixtures on
-- the same pitch) and reusing it for "buffer around this fixture's own
-- occupancy window" would silently double-count once both are applied to
-- the same conflict check. 5-minute increments, 0-60 range, per Section 31.
alter table public.club_scheduling_policy
  add column if not exists auto_allocate_home_fixtures boolean not null default false,
  add column if not exists warm_up_minutes integer not null default 0,
  add column if not exists pack_up_minutes integer not null default 0;

alter table public.club_scheduling_policy
  drop constraint if exists club_scheduling_policy_warm_up_range,
  add constraint club_scheduling_policy_warm_up_range check (warm_up_minutes >= 0 and warm_up_minutes <= 60 and warm_up_minutes % 5 = 0);

alter table public.club_scheduling_policy
  drop constraint if exists club_scheduling_policy_pack_up_range,
  add constraint club_scheduling_policy_pack_up_range check (pack_up_minutes >= 0 and pack_up_minutes <= 60 and pack_up_minutes % 5 = 0);

comment on column public.club_scheduling_policy.auto_allocate_home_fixtures is 'Section 5: when true, Pitch Allocation auto-generates a proposal on page load for any fixture not yet manually allocated. Never auto-APPLIES -- a human still reviews/applies the proposal.';
comment on column public.club_scheduling_policy.warm_up_minutes is 'Section 31: buffer BEFORE kickoff reserved on the pitch, in 5-minute increments 0-60. Stored separately from turnaround_minutes (the gap between two different fixtures) so the two are never double-counted.';
comment on column public.club_scheduling_policy.pack_up_minutes is 'Section 31: buffer AFTER a fixture''s final whistle reserved on the pitch, in 5-minute increments 0-60. See warm_up_minutes comment for why this is separate from turnaround_minutes.';
