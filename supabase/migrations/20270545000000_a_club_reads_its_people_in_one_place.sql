-- ===========================================================================
-- A CLUB READS ITS PEOPLE IN ONE PLACE (CA-M3)
-- ===========================================================================
--
-- THE FINDING. The website's People page assembled every row itself: a direct read of
-- club_memberships (active only), the team_permissions view, role_assignments, the invitations
-- projection, and `get_club_member_directory` for names and emails -- five reads stitched in the
-- page, no search, no paging, suspended and pending memberships invisible, and email returned to
-- any holder of people.member.view although the catalogue reserves contact details to
-- people.member.view_contact. A second client would have had to copy the stitching.
--
-- THE READ MODEL. `club_people` answers the club-administration question -- who is associated
-- with THIS club in the People product -- one row per association, paged and searchable:
--
--   member    a club membership (an account) in any live state: ACTIVE, SUSPENDED or PENDING,
--             with its primary club role, its team roles (the team_permissions view) and its
--             additional club-wide roles (role_assignments), and whether it is the caller's own
--   invited   an issued CLUB_STAFF invitation that has not expired -- who was asked, for what
--
-- Players and guardians are deliberately NOT rows here. They are their own products with their
-- own authority (team.roster.*, family.*), and the club People page never listed them.
--
-- AUTHORITY is asked of the canonical engine: people.member.view at the club (or the site
-- support capability) to read; people.member.view_contact for an email address -- without it the
-- column is null and the search does not match on email. Nothing here decides who may CHANGE a
-- person; every mutation keeps its own operation and its own check.
--
-- No DOB, no age, no relationship, no child appears: none of that is a club membership.
-- Forward-only. No data changed.
-- ===========================================================================

create or replace function public.club_people(
  p_club_id uuid,
  p_search text default null,
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_membership_id uuid default null
)
returns table(
  kind text,
  membership_id uuid,
  user_id uuid,
  first_name text,
  surname text,
  email text,
  avatar_storage_path text,
  role text,
  state text,
  since timestamptz,
  team_roles jsonb,
  additional_roles jsonb,
  invitation_id uuid,
  invitation_email text,
  invitation_role text,
  invitation_expires_at timestamptz,
  is_self boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_contact boolean;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('people.member.view', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club')) then
    raise exception 'You do not have permission to see this club''s people.' using errcode = '42501';
  end if;
  if v_filter not in ('all', 'staff', 'members', 'suspended', 'pending', 'invited') then
    raise exception 'Unknown people filter.' using errcode = '22023';
  end if;
  v_contact := internal.can('people.member.view_contact', 'club', p_club_id, null, null) or internal.has_site_capability('site.support.act_in_club');

  return query
  with members as (
    select
      'member'::text as kind,
      m.id as membership_id,
      m.user_id,
      p.first_name,
      p.surname,
      case when v_contact then p.email else null end as email,
      p.avatar_storage_path,
      m.role,
      m.state,
      m.created_at as since,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', tp.id, 'team_id', tp.team_id, 'team_display_name', t.display_name, 'permission', tp.permission) order by t.display_name)
        from public.team_permissions tp join public.teams t on t.id = tp.team_id
        where tp.membership_id = m.id
      ), '[]'::jsonb) as team_roles,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', ra.id, 'role_key', ra.role_key, 'label', rd.label, 'state', ra.state, 'confirmation_state', ra.confirmation_state) order by rd.label)
        from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
        where ra.membership_id = m.id and ra.team_id is null and ra.state in ('ACTIVE', 'SUSPENDED')
          and not rd.is_primary_seat
      ), '[]'::jsonb) as additional_roles,
      null::uuid as invitation_id,
      null::text as invitation_email,
      null::text as invitation_role,
      null::timestamptz as invitation_expires_at,
      (m.user_id = auth.uid()) as is_self,
      (m.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        or exists (select 1 from public.team_permissions tp where tp.membership_id = m.id)
        or exists (select 1 from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key where ra.membership_id = m.id and ra.state = 'ACTIVE' and not rd.is_primary_seat)
      ) as is_staff
    from public.club_memberships m
    join public.profiles p on p.id = m.user_id
    where m.club_id = p_club_id
      and m.state in ('ACTIVE', 'SUSPENDED', 'PENDING')
      and (p_membership_id is null or m.id = p_membership_id)
  ),
  invited as (
    select
      'invited'::text as kind,
      null::uuid as membership_id,
      null::uuid as user_id,
      null::text as first_name,
      null::text as surname,
      null::text as email,
      null::text as avatar_storage_path,
      null::text as role,
      'INVITED'::text as state,
      i.created_at as since,
      '[]'::jsonb as team_roles,
      '[]'::jsonb as additional_roles,
      i.id as invitation_id,
      case when v_contact then i.invited_email_normalised else regexp_replace(i.invited_email_normalised, '^(.).*(@.*)$', '\1…\2') end as invitation_email,
      coalesce(i.intended_outcome ->> 'declared_role', i.intended_outcome ->> 'role_key', i.intended_outcome ->> 'club_role') as invitation_role,
      i.expires_at as invitation_expires_at,
      false as is_self,
      true as is_staff
    from public.access_invitations i
    where i.club_id = p_club_id and i.kind = 'CLUB_STAFF' and i.state = 'ISSUED'
      and (i.expires_at is null or i.expires_at > now()) and i.use_count < i.max_uses
      and p_membership_id is null
  ),
  rows_all as (
    select * from members
    union all
    select * from invited
  ),
  filtered as (
    select r.*
    from rows_all r
    where (v_filter = 'all'
        or (v_filter = 'staff' and r.kind = 'member' and r.is_staff)
        or (v_filter = 'members' and r.kind = 'member' and not r.is_staff)
        or (v_filter = 'suspended' and r.state = 'SUSPENDED')
        or (v_filter = 'pending' and (r.state = 'PENDING' or r.kind = 'invited'))
        or (v_filter = 'invited' and r.kind = 'invited'))
      and (v_search is null
        or (r.first_name || ' ' || r.surname) ilike '%' || v_search || '%'
        or (v_contact and r.email ilike '%' || v_search || '%')
        or (v_contact and r.invitation_email ilike '%' || v_search || '%'))
  )
  select f.kind, f.membership_id, f.user_id, f.first_name, f.surname, f.email, f.avatar_storage_path, f.role, f.state, f.since,
    f.team_roles, f.additional_roles, f.invitation_id, f.invitation_email, f.invitation_role, f.invitation_expires_at, f.is_self,
    count(*) over () as total_count
  from filtered f
  order by
    case f.state when 'PENDING' then 0 when 'INVITED' then 1 when 'SUSPENDED' then 3 else 2 end,
    lower(coalesce(f.surname, f.invitation_email, '')), lower(coalesce(f.first_name, ''))
  limit v_limit offset v_offset;
end;
$function$;

comment on function public.club_people(uuid, text, text, integer, integer, uuid) is
  'The club-administration People read model: one row per club membership (ACTIVE, SUSPENDED, PENDING) with roles, team roles and additional roles, plus issued staff invitations; paged, searchable, filterable (all/staff/members/suspended/pending/invited). Requires people.member.view at the club; email only under people.member.view_contact. Players and guardians are not rows here -- they have their own products.';

-- The catalogue of additional club roles a club may assign (what the website''s person page filters in TypeScript).
create or replace function public.club_assignable_roles(p_club_id uuid)
returns table(role_key text, label text, scope text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select rd.role_key, rd.label, rd.scope
  from public.role_definitions rd
  where rd.visible
    and 'CLUB' = any(rd.assignable_by)
    and not rd.is_primary_seat
    and rd.role_key <> 'SAFEGUARDING_OFFICER'
    and rd.scope in ('CLUB', 'CLUB_OR_TEAM')
    and internal.can('people.member.view', 'club', p_club_id, null, null)
  order by rd.label;
$function$;

revoke execute on function public.club_people(uuid, text, text, integer, integer, uuid) from public, anon;
revoke execute on function public.club_assignable_roles(uuid) from public, anon;
grant execute on function public.club_people(uuid, text, text, integer, integer, uuid) to authenticated, service_role;
grant execute on function public.club_assignable_roles(uuid) to authenticated, service_role;

do $$
declare v_src text;
begin
  if has_function_privilege('anon', 'public.club_people(uuid, text, text, integer, integer, uuid)', 'EXECUTE') then
    raise exception 'club_people must not be executable by anon';
  end if;
  select pg_get_functiondef('public.club_people(uuid, text, text, integer, integer, uuid)'::regprocedure) into v_src;
  -- no child, no date of birth, no relationship leaves this read model
  if v_src ~ 'date_of_birth' or v_src ~ 'public\.players' or v_src ~ 'public\.guardians' or v_src ~ 'player_team_memberships' then
    raise exception 'club_people must not read players, guardians or dates of birth';
  end if;
  if v_src !~ 'people\.member\.view_contact' then
    raise exception 'club_people must gate email on people.member.view_contact';
  end if;
end $$;
