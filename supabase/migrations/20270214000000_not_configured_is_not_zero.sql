-- =====================================================================
-- "NOT CONFIGURED" IS NOT "NO WARM-UP REQUIRED"
--
-- The original Pitch Allocation regression was not a bug in any calculation.
-- It was this: a club with no row in public.club_scheduling_policy fell back
-- to a code constant whose warm-up and pack-up were BOTH ZERO, and zero-length
-- bands render as nothing. The board looked like the feature had been deleted.
--
-- The silence is the problem. A club that has never opened the settings page
-- has not decided that its teams need no warm-up and that pitches are free the
-- instant the whistle goes -- it has decided nothing. Reading "unconfigured"
-- as "zero" turns an absence of input into a confident operational claim, and
-- that claim then quietly drives conflict detection, auto-allocation and the
-- Move validator.
--
-- THE HIERARCHY, MODELLED ON THE ONE THIS PRODUCT ALREADY USES.
--
--   CLUB OVERRIDE      public.club_scheduling_policy
--   PLATFORM DEFAULT   public.platform_scheduling_defaults   (this table)
--   otherwise          fail clearly, never silently zero
--
-- That is exactly the shape of public.role_capability_defaults (platform) plus
-- public.capability_overrides (scope), which is how configuration already
-- works here. A club row now means "this club has decided something
-- different", and its ABSENCE means "use the platform's answer" rather than
-- "use nothing".
--
-- WHY NOT fixture_scheduling_rules. That table is the other platform-level
-- scheduling authority, and it was the obvious candidate -- but it is keyed by
-- (rugby_code, age_group) and holds half length and minimum pitch size, which
-- are governing-body regulation. Warm-up and pack-up are neither: they are one
-- club's operational habit, identical across its age grades. Putting them
-- there would need fifteen rows to express one number and would imply an U10
-- warms up for a different length of time than an U15 by rule, which is not
-- true of either code.
--
-- ONE ROW, ENFORCED. A second row would be a second platform answer.
-- =====================================================================

create table if not exists public.platform_scheduling_defaults (
  -- A fixed primary key is the simplest honest way to say "there is exactly
  -- one of these". No sequence, no scope column, nothing to disambiguate.
  id boolean primary key default true,
  warm_up_minutes integer not null,
  pack_up_minutes integer not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),

  constraint platform_scheduling_defaults_single_row check (id),
  -- The same 0-60 in 5-minute steps the club settings form already enforces,
  -- so a platform value can never be one a club could not have chosen itself.
  constraint platform_scheduling_defaults_warm_up_check check (warm_up_minutes between 0 and 60 and warm_up_minutes % 5 = 0),
  constraint platform_scheduling_defaults_pack_up_check check (pack_up_minutes between 0 and 60 and pack_up_minutes % 5 = 0)
);

comment on table public.platform_scheduling_defaults is
  'The platform-wide warm-up and pack-up a club inherits until it overrides them in Club Settings. Exactly one row.';

-- THE SEEDED VALUES ARE A PRODUCT DECISION, and a deliberately modest one.
--
-- 15 minutes each way matches turnaround_minutes, which this domain already
-- defaults to 15 -- so the platform's three scheduling intervals are
-- consistent rather than three different guesses. It is short enough that no
-- club is surprised by a pitch it thought was free, and long enough that the
-- reserved window is visibly not the bare match. A club that wants 30 sets 30;
-- a club that genuinely wants none sets 0, and that zero then MEANS something
-- because somebody chose it.
insert into public.platform_scheduling_defaults (id, warm_up_minutes, pack_up_minutes)
values (true, 15, 15)
on conflict (id) do nothing;

alter table public.platform_scheduling_defaults enable row level security;

-- READABLE BY ANY SIGNED-IN USER. It is not sensitive -- it is the number
-- already visible on every pitch board -- and every club's Pitch Allocation
-- read depends on it, so gating it behind club membership would break the
-- surface for exactly the viewers this defaults system exists to serve.
drop policy if exists platform_scheduling_defaults_select on public.platform_scheduling_defaults;
create policy platform_scheduling_defaults_select on public.platform_scheduling_defaults
  for select to authenticated
  using (true);

-- WRITABLE BY PLATFORM AUTHORITY ONLY, through the writer below. No
-- INSERT/UPDATE policy on the table itself: there is one way in and it checks.
create or replace function public.set_platform_scheduling_defaults(
  p_warm_up_minutes integer,
  p_pack_up_minutes integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin can change the platform scheduling defaults.' using errcode = '42501';
  end if;
  if p_warm_up_minutes is null or p_pack_up_minutes is null
     or p_warm_up_minutes < 0 or p_warm_up_minutes > 60 or p_warm_up_minutes % 5 <> 0
     or p_pack_up_minutes < 0 or p_pack_up_minutes > 60 or p_pack_up_minutes % 5 <> 0 then
    raise exception 'Warm-up and pack-up time must be in 5-minute increments between 0 and 60.' using errcode = '22023';
  end if;

  insert into public.platform_scheduling_defaults (id, warm_up_minutes, pack_up_minutes, updated_by, updated_at)
  values (true, p_warm_up_minutes, p_pack_up_minutes, auth.uid(), now())
  on conflict (id) do update set
    warm_up_minutes = excluded.warm_up_minutes,
    pack_up_minutes = excluded.pack_up_minutes,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_platform_scheduling_defaults(integer, integer) from public, anon;
grant execute on function public.set_platform_scheduling_defaults(integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- THE ONE RESOLVER.
--
-- Every reader of a club's scheduling buffers goes through this, so the
-- hierarchy is expressed once and cannot be re-implemented slightly
-- differently by the next caller. Returns the values AND where they came
-- from, because "why is this 15" is a question the settings screen has to be
-- able to answer.
-- ---------------------------------------------------------------------
create or replace function public.resolve_club_scheduling_buffers(p_club_id uuid)
returns table (
  warm_up_minutes integer,
  pack_up_minutes integer,
  /** 'club' when this club has overridden, 'platform' when it inherits. */
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(c.warm_up_minutes, p.warm_up_minutes),
    coalesce(c.pack_up_minutes, p.pack_up_minutes),
    case when c.club_id is not null then 'club' else 'platform' end
  from public.platform_scheduling_defaults p
  left join public.club_scheduling_policy c on c.club_id = p_club_id
  where p.id;
$$;

comment on function public.resolve_club_scheduling_buffers(uuid) is
  'Club override, else platform default. The one place the scheduling-buffer hierarchy is expressed; returns the source so a settings screen can say which is in effect.';

revoke all on function public.resolve_club_scheduling_buffers(uuid) from public, anon;
grant execute on function public.resolve_club_scheduling_buffers(uuid) to authenticated;

-- =====================================================================
-- NO ROW IS MATERIALISED ON CLUB ACTIVATION, DELIBERATELY.
--
-- The brief offered two models. This is the first: the platform default
-- provides safe behaviour, and a club row exists ONLY where that club has
-- genuinely chosen something different.
--
-- Materialising a copy of today's defaults into every club at activation would
-- freeze each club at the value that happened to be current on the day it
-- signed up, and a later change to the platform default would then reach
-- nobody -- while looking, in the settings screen, exactly like a deliberate
-- club decision. The absence of a row is the more honest record: it says this
-- club has not decided, which is true.
-- =====================================================================
