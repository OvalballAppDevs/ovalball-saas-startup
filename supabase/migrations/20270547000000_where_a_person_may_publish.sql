-- CA-M5 -- WHERE A PERSON MAY PUBLISH.
--
-- News and announcements have had one authority since the Club Digital Home landed:
-- internal.may_edit_club_content(club, team) -- club.news.manage at the club, or team.news.manage on the
-- team -- and internal.may_publish_club_content, its publishing twin. Both are internal, so a client
-- that wants to offer "write for the club" or "write for Under 12 Boys" had to guess from role labels or
-- ask my_capabilities once per team. This read model asks the server the exact question the write will
-- ask, per scope, and returns only the scopes the caller may publish to. The audience picker on both
-- clients is built from it and from nothing else; save_club_article / save_club_announcement decide
-- again on every write.
--
-- Forward-only. No table changes; the audience model is untouched.

create or replace function public.club_publishing_scopes(p_club_id uuid)
returns table(scope_type text, team_id uuid, team_display_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_club_id is null then
    raise exception 'A publishing question names a club.' using errcode = '22023';
  end if;
  return query
  select 'club'::text, null::uuid, null::text
  where internal.may_publish_club_content(p_club_id, null)
  union all
  select 'team'::text, t.id, t.display_name
  from public.teams t
  where t.club_id = p_club_id and t.active and t.folded_at is null and t.archived_at is null
    and internal.may_edit_club_content(p_club_id, t.id)
  order by 1, 3;
end;
$$;
comment on function public.club_publishing_scopes(uuid) is
  'CA-M5: the scopes (the club, and each team) the caller may publish news and announcements to at this club, decided by the same rule the writes apply.';

revoke all on function public.club_publishing_scopes(uuid) from public, anon;
grant execute on function public.club_publishing_scopes(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.club_publishing_scopes(uuid)', 'execute') then
    raise exception 'club_publishing_scopes must not be executable by anon';
  end if;
  if (select prosrc from pg_proc where oid = 'public.club_publishing_scopes'::regproc) not like '%may_edit_club_content%' then
    raise exception 'club_publishing_scopes must ask the same rule the writes ask';
  end if;
end $$;
