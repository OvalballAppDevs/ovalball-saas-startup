-- =====================================================================================================
-- CONVERGENCE STEP 6 (5/n) -- the Site Admin directory editor reads its own record through a capability.
--
-- 20270511000000 closed L17 by taking the table-wide SELECT on club_directory away from every session.
-- One surface legitimately needs the private columns: the Site Admin directory editor at
-- /admin/clubs/[directoryId], which reads and then writes notes, official_email, the research
-- provenance and the admin verification state.
--
-- The first attempt pointed it at admin_club_overview, on the strength of that page's own comment
-- calling the view "a superset view of the club_directory row". It is not: the view renames `id` to
-- `directory_id`, drops `active` in favour of its own flags, and omits admin_verification_status,
-- constituent_body_id, created_at and updated_at. Reshaping a view that the club list, the CSV export
-- and the data-quality counts all read, in order to serve one editor, would be the wrong direction --
-- so the editor gets its own narrow read instead, which is the shape Slice 7e used for
-- site_player_team_memberships.
--
-- One record at a time, by id, gated on the same capability the list is gated on. It cannot become a
-- directory export by being called in a loop with a different argument than the page has, because
-- every call is one row and the caller already needs site.clubs.view to see that row in the list.
-- =====================================================================================================

create or replace function public.site_club_directory_record(p_directory_id uuid)
returns setof public.club_directory
language sql
stable
security definer
set search_path = ''
as $$
  select cd.*
    from public.club_directory cd
   where internal.has_site_capability('site.clubs.view')
     and cd.id = p_directory_id;
$$;

comment on function public.site_club_directory_record(uuid) is
  'Step 6 (L17). The Site Admin directory editor''s read of one club_directory row, including the '
  'private columns -- notes, official_email, research provenance -- that stopped being readable by '
  'every session. Gated on site.clubs.view, one record per call.';

revoke all on function public.site_club_directory_record(uuid) from public, anon;
grant execute on function public.site_club_directory_record(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.site_club_directory_record(uuid)') is null then
    raise exception 'STEP 6: site_club_directory_record was not created';
  end if;
  if has_function_privilege('anon', 'public.site_club_directory_record(uuid)', 'EXECUTE') then
    raise exception 'STEP 6: anon can read a club''s private directory record';
  end if;
  raise notice 'Step 6: the directory editor reads its record through a capability, one row at a time';
end $$;
