-- =====================================================================
-- WHO YOU ARE TO THIS TEAM, AND WHAT THE TEAM LOOKS LIKE.
--
-- Convergence Step 10. Two small additions, and both exist because the Team
-- page had no way to answer the first question a person asks when they open it.
--
-- 1. THE VIEWER'S OWN RELATIONSHIPS TO ONE TEAM.
--
-- Ovalball already knows, in four separate canonical places, that somebody is
-- the U12s' coach, the manager of the Girls' U14, a player in the Men's 1st,
-- and the parent of two children in the minis. No surface could ask "what am I
-- to THIS team" without assembling that itself, which is how four surfaces come
-- to disagree about one person.
--
-- ROLE IS NOT IDENTITY, and this returns a LIST. One person is often two or
-- three things to one team -- a coach who is also a parent is the most ordinary
-- shape in grassroots rugby -- and collapsing that into a single "primary role"
-- is exactly what the identity programme spent eight slices not doing.
--
-- A BADGE IS PRESENTATION, NEVER AUTHORITY. Nothing authorises off what this
-- returns; every control on the page still asks the capability engine. What it
-- prevents is the opposite error: a badge that still says Coach after the role
-- was revoked or the membership suspended. So each row is read from the
-- canonical state that decides, and a suspended membership returns nothing.
--
-- 2. A TEAM COVER PHOTO.
--
-- An explicit original backlog item. It adds ONE column and reuses the media
-- architecture club news already has -- the same public bucket, the same upload
-- path shape, the same storage policies. No new storage, no new pipeline, no
-- new permission system, because Step 6 and the Club Digital Home already built
-- all three and a second copy of any of them would be the defect.
-- =====================================================================

alter table public.teams
  add column if not exists cover_image_path text;

comment on column public.teams.cover_image_path is
  'Optional team cover photo, stored in the club-news-media bucket alongside article hero images. '
  'Identity imagery, like a club crest: it is published with the club, not member data. Null means '
  'fall back to the club''s own imagery -- one deterministic chain, resolved in lib/teams/team-cover.ts.';

-- ---------------------------------------------------------------------
-- WHAT THIS PERSON IS TO THIS TEAM.
-- ---------------------------------------------------------------------
create or replace function public.my_team_relationship(p_team_id uuid)
returns TABLE(
  relationship text,
  label text,
  subject_player_id uuid,
  subject_name text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_club uuid;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;

  -- SEEING THE TEAM AT ALL IS THE SAME QUESTION THE PAGE ASKS. Without this a
  -- stranger could enumerate which teams they have no relationship with, which
  -- is a small leak and an entirely avoidable one.
  if not (internal.can('team.team.view', 'team', v_club, p_team_id, null)
          or internal.has_site_capability('site.clubs.view')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  -- STAFF ROLES, from the canonical assignments. A revoked or suspended
  -- assignment is not ACTIVE and therefore is not a badge.
  select ra.role_key,
         coalesce(rd.label, ra.role_key),
         null::uuid,
         null::text
    from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id
    left join public.role_definitions rd on rd.role_key = ra.role_key
   where ra.team_id = p_team_id
     and cm.user_id = internal.actor()
     and ra.state = 'ACTIVE'
     -- A suspended membership must not keep a badge alive: the capability
     -- engine already refuses it at rule 1, and the badge must agree.
     and cm.state = 'ACTIVE'

  union all

  -- THE VIEWER AS A PLAYER IN THIS TEAM.
  select 'PLAYER',
         'Player',
         p.id,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')
    from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.team_id = p_team_id
   where p.user_id = internal.actor() and ptm.state = 'ACTIVE'

  union all

  -- AND AS A PARENT OR GUARDIAN OF ONE. One row per child: a parent with two
  -- children in the same team is two relationships, not one, and the child is
  -- named because "Parent/Guardian" alone does not tell them which.
  select 'GUARDIAN',
         'Parent/Guardian',
         p.id,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '')
    from public.guardians g
    join public.players p on p.id = g.player_id
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.team_id = p_team_id
   where g.guardian_user_id = internal.actor() and g.status = 'active' and ptm.state = 'ACTIVE'

  order by 1;
end;
$$;

revoke all on function public.my_team_relationship(uuid) from public;
grant execute on function public.my_team_relationship(uuid) to authenticated;

comment on function public.my_team_relationship(uuid) is
  'Every relationship the signed-in person holds to one team -- staff roles from role_assignments, '
  'their own player placement, and one row per child they are guardian of. Presentation only: nothing '
  'authorises off it, and a revoked role or suspended membership returns no row, so a badge can never '
  'outlive the relationship it describes.';

do $guard$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_team_relationship';

  -- It must never resurrect the retired role by name.
  if v_def ~ '''TEAM_ADMIN''' then
    raise exception 'my_team_relationship names the retired team_admin role.';
  end if;
  -- It must read the canonical assignment state, not a compatibility column.
  if v_def !~ 'role_assignments' or v_def !~ 'ra.state = ''ACTIVE''' then
    raise exception 'my_team_relationship does not read canonical ACTIVE role assignments.';
  end if;
  -- A suspended membership must not keep a badge.
  if v_def !~ 'cm.state = ''ACTIVE''' then
    raise exception 'my_team_relationship would keep a badge alive through a suspended membership.';
  end if;
  if has_function_privilege('anon', 'public.my_team_relationship(uuid)', 'EXECUTE') then
    raise exception 'anon can ask who they are to a team.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'teams' and column_name = 'cover_image_path') then
    raise exception 'the team cover column does not exist';
  end if;
end;
$guard$;
