-- =====================================================================
-- A PLATFORM DEFAULT IS A FULL SITE ADMIN DECISION
--
-- public.set_platform_scheduling_defaults gated on internal.is_site_admin(),
-- which is true for EVERY active Site Admin -- including the narrow
-- admin_role = 'club_data' accounts that exist to do club data work and
-- nothing else. This value reaches every club on the platform that has not
-- set its own, so it is not a club-data decision.
--
-- internal.is_full_site_admin() already exists and is the same predicate the
-- rest of the platform's genuinely global settings use. This is a narrowing:
-- nobody who could legitimately change this before loses anything.
-- =====================================================================
create or replace function public.set_platform_scheduling_defaults(
  p_warm_up_minutes integer,
  p_pack_up_minutes integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can change the platform scheduling defaults.' using errcode = '42501';
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
