-- =====================================================================================================
-- SLICE 7 -- A SITE ADMIN CAN SEE THEIR OWN ROW
--
-- Found in a browser, by a Club Data Site Admin who could no longer reach any Site Admin page at all.
--
-- 20270418 replaced the Site Admin label in every RLS policy with the capability that names the
-- operation. For public.site_admins it chose site.admins.manage for all four commands, which is right
-- for INSERT, UPDATE and DELETE -- managing other administrators is SITE_FULL's job -- and wrong for
-- SELECT, because the policy it replaced was
--
--     site_admins_select_site_admin  USING internal.is_site_admin()
--
-- and is_site_admin() is true for ANY active Site Admin. So the rewrite narrowed "every Site Admin may
-- read this table" to "only a Full Site Admin may read this table", and a SITE_DATA, SITE_OPS,
-- SITE_RO, SITE_MOD, SITE_SUPPORT or SITE_CONTENT administrator could not read their OWN row.
--
-- That is not a small permissions detail. lib/app-context/session-context.ts establishes whether the
-- signed-in person is a Site Admin by selecting their row from this table. With the row invisible the
-- answer is no, requireActiveSiteAdmin refuses, and every /admin/* page redirects away. Five of the
-- seven profiles lost the entire Site Admin surface -- not one control, all of it.
--
-- WHY NO SQL SUITE CAUGHT IT. Every database test asks internal.can() or internal.has_site_capability()
-- directly, and both were correct throughout: a Club Data administrator really does hold
-- site.directory.manage and really can write the directory. What broke was the application's ability
-- to FIND OUT that they are an administrator, which only shows up when something reads the table
-- through PostgREST as they would. That is what the browser suite does, and why it is not optional.
--
-- The fix keeps the narrowing that was intended and drops the one that was not: everybody sees
-- themselves, and only site.admins.manage sees the roster. Which is stricter than what Slice 7
-- inherited, where any Site Admin could read every other administrator's row.
-- =====================================================================================================

drop policy if exists site_admins_select_site_admin on public.site_admins;
create policy site_admins_select_site_admin on public.site_admins for select to authenticated
using (
  user_id = (select auth.uid())
  or (select internal.has_site_capability('site.admins.manage'))
);

do $$
declare v_data uuid; v_full uuid; v_own int; v_roster int;
begin
  select user_id into v_data from public.site_admins where profile_key <> 'SITE_FULL' and status = 'active' limit 1;
  select user_id into v_full from public.site_admins where profile_key = 'SITE_FULL' and status = 'active' limit 1;
  if v_data is null or v_full is null then
    raise notice 'Slice 7: site_admins select policy rewritten (no seeded pair to check against here)';
    return;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_data, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_own from public.site_admins where user_id = v_data;
  select count(*) into v_roster from public.site_admins;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_own <> 1 then
    raise exception 'Slice 7: a non-Full Site Admin still cannot see their own row';
  end if;
  if v_roster <> 1 then
    raise exception 'Slice 7: a non-Full Site Admin can see % rows -- they should see only themselves', v_roster;
  end if;
  raise notice 'Slice 7: every Site Admin sees themselves; only site.admins.manage sees the roster';
end $$;
