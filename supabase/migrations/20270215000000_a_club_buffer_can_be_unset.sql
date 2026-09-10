-- =====================================================================
-- A CLUB'S BUFFERS CAN BE UNSET, AND UNSET IS NOT ZERO
--
-- The previous migration put a platform default underneath the club's own
-- setting, so a club with no policy row inherits sensible behaviour instead of
-- silently getting 0/0.
--
-- But public.club_scheduling_policy.warm_up_minutes and pack_up_minutes were
-- NOT NULL DEFAULT 0, and that reintroduces the same trap one level down.
-- The row exists for more than these two fields -- it also carries
-- auto_allocate_home_fixtures, turnaround_minutes and the kickoff windows -- so
-- a club that saves ANY of those, through any path that does not name the
-- buffers, gets warm-up 0 and pack-up 0 written on its behalf. The board then
-- shows no bands, the conflict detector tests a bare match window, and
-- everything looks deliberate. Nobody chose it.
--
-- Making them NULLABLE with no default is what gives the hierarchy a real
-- third state:
--
--   a number   this club decided this
--   NULL       this club has not decided; use the platform default
--   no row     this club has not decided anything; use the platform default
--
-- public.resolve_club_scheduling_buffers already coalesces, so it needs no
-- change -- its coalesce simply starts doing work it could never have done
-- while the column could not be null.
--
-- EXISTING ROWS ARE LEFT ALONE. A stored 0 might have been a real decision by
-- a club that genuinely wants no buffers, and this migration cannot tell that
-- apart from a 0 the default wrote. Rewriting them to NULL would silently
-- change a club's live scheduling; leaving them is the conservative act, and
-- the settings screen now shows plainly which value is in effect and where it
-- came from.
-- =====================================================================

alter table public.club_scheduling_policy
  alter column warm_up_minutes drop not null,
  alter column warm_up_minutes drop default;

alter table public.club_scheduling_policy
  alter column pack_up_minutes drop not null,
  alter column pack_up_minutes drop default;

comment on column public.club_scheduling_policy.warm_up_minutes is
  'Minutes reserved before kick-off. NULL means this club has not decided -- the platform default applies. Never defaulted to 0, because unconfigured is not a decision.';
comment on column public.club_scheduling_policy.pack_up_minutes is
  'Minutes reserved after the final whistle. NULL means this club has not decided -- the platform default applies.';

-- The source label must distinguish "this club set a number" from "this club
-- has a row but left the buffers alone". Previously it reported 'club' for any
-- existing row, which would have called an inherited value an override.
create or replace function public.resolve_club_scheduling_buffers(p_club_id uuid)
returns table (
  warm_up_minutes integer,
  pack_up_minutes integer,
  /** 'club' when this club has set its own numbers, 'platform' when it inherits. */
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
    case
      when c.warm_up_minutes is not null or c.pack_up_minutes is not null then 'club'
      else 'platform'
    end
  from public.platform_scheduling_defaults p
  left join public.club_scheduling_policy c on c.club_id = p_club_id
  where p.id;
$$;

revoke all on function public.resolve_club_scheduling_buffers(uuid) from public, anon;
grant execute on function public.resolve_club_scheduling_buffers(uuid) to authenticated;
