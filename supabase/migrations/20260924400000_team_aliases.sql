-- Club-specific team aliases -- Overnight Master Pass Phase C (Sections
-- 51-54). Canonical B/C squad identity (canonical_team_type_id +
-- squad_designation) stays authoritative everywhere; a club may ALSO
-- give its own B/C team a friendly display name ("Blacks", "Golds")
-- without ever replacing the structured identity with free text.
create table public.team_aliases (
  team_id uuid primary key references public.teams(id) on delete cascade,
  alias text not null check (char_length(trim(alias)) between 1 and 40),
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);

alter table public.team_aliases enable row level security;

create policy team_aliases_select_all on public.team_aliases for select using (true);

-- No direct INSERT/UPDATE/DELETE policy -- set_team_alias()/clear_team_alias()
-- below (SECURITY DEFINER) are the only path, matching this pass's
-- established "delete via safe RPC only" convention. This also means the
-- club.teams.manage/site.team_catalogue.manage check happens exactly
-- once, in one place, never re-implemented per call site.

/**
 * Set (or replace) a team's club-specific alias. Authorization is
 * TEAM-SCOPED via the team's own real club_id -- club.teams.manage at
 * that club (Burnley managing one of Burnley's own teams), OR
 * site.team_catalogue.manage for a Site Admin override (Section 53:
 * "Authorized Site Admin may override/remove inappropriate club
 * aliases... Exact club_id + team_id. Never rename every U12 B globally
 * when editing Burnley's alias" -- this function only ever touches the
 * ONE team_id passed in, never a canonical_team_type-wide update).
 */
create or replace function public.set_team_alias(p_team_id uuid, p_alias text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not (
    internal.has_capability('club.teams.manage', 'club', v_club_id, null)
    or internal.has_capability('site.team_catalogue.manage', 'site')
  ) then
    raise exception 'Not authorized to set this team''s alias.' using errcode = '42501';
  end if;
  if char_length(trim(p_alias)) = 0 then
    raise exception 'Alias cannot be empty -- use clear_team_alias() to remove it.';
  end if;

  insert into public.team_aliases (team_id, alias, set_by, set_at)
  values (p_team_id, trim(p_alias), auth.uid(), now())
  on conflict (team_id) do update set alias = excluded.alias, set_by = excluded.set_by, set_at = excluded.set_at;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('team_aliases', p_team_id, 'update', auth.uid(), jsonb_build_object('alias', trim(p_alias)));
end;
$$;

create or replace function public.clear_team_alias(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not (
    internal.has_capability('club.teams.manage', 'club', v_club_id, null)
    or internal.has_capability('site.team_catalogue.manage', 'site')
  ) then
    raise exception 'Not authorized to clear this team''s alias.' using errcode = '42501';
  end if;

  delete from public.team_aliases where team_id = p_team_id;
  insert into public.audit_log (table_name, record_id, action, changed_by)
  values ('team_aliases', p_team_id, 'delete', auth.uid());
end;
$$;
