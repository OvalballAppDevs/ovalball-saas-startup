-- TEAM STAFF -- the canonical reader Team Profiles Section 4 needs, and the one the Section 3 audit
-- found could not be built on `team_people`'s existing staff branch.
--
-- WHY A NEW READER. `team_people`'s "coach" rows come from `public.team_permissions`, a compatibility
-- view over `role_assignments` that (a) represents only TEAM_ADMINISTRATION/TEAM_MANAGER/COACH -- never
-- FIRST_AIDER or any future team role -- and (b) is `distinct on (membership_id, team_id)`, so a person
-- holding two of those three collapses onto whichever the view's own priority order picks, silently
-- losing the other. Both are correct FOR team_permissions' own job (one legacy single-slot permission
-- per person per team, still read by the older `set_team_access` path this migration does not touch),
-- and wrong for a screen whose whole job is showing every role a person actually holds.
--
-- ONE PERSON, ZERO OR MORE ROLES. This reads `role_assignments` directly, scoped to one team and to
-- `state = 'ACTIVE'`, and aggregates every active role a membership holds on that team into one row --
-- Coach and First Aider is one row with two roles, never two rows or one row that forgot the second
-- fact. The membership is the identity; the roles are what changes about it.
--
-- THE SAME AUTHORITY THE ROSTER ALREADY USES. `internal.team_people_authority` already answers "may
-- this viewer see who is on this team's roster" for players; staff is the same roster, so it is the
-- same question, asked the same way -- never a second, staff-specific view capability invented for
-- this one reader.
create or replace function public.team_staff(p_team_id uuid)
returns table(
  membership_id uuid,
  person_id uuid,
  display_name text,
  avatar_storage_path text,
  roles jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_may_view boolean;
begin
  select a.may_view into v_may_view from internal.team_people_authority(p_team_id) a;
  if not coalesce(v_may_view, false) then
    raise exception 'Not authorized to view this team''s staff.' using errcode = '42501';
  end if;

  return query
  select
    cm.id,
    cm.user_id,
    coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
    pr.avatar_storage_path,
    jsonb_agg(
      jsonb_build_object(
        'assignmentId', ra.id,
        'roleKey', ra.role_key,
        'label', rd.label,
        -- THE ONLY PLACE A COACH'S DISPLAYED TITLE LIVES (Section 13/14): free of any bearing on
        -- authority, which stays exactly COACH either way -- `set_team_role_title` below is the one
        -- door that writes it, and only onto a COACH row.
        'title', ra.attributes ->> 'staff_title'
      )
      order by
        case ra.role_key
          when 'TEAM_ADMINISTRATION' then 1
          when 'TEAM_MANAGER' then 2
          when 'COACH' then 3
          when 'FIRST_AIDER' then 4
          else 5
        end,
        rd.label
    ) as roles
  from public.role_assignments ra
  join public.role_definitions rd on rd.role_key = ra.role_key
  join public.club_memberships cm on cm.id = ra.membership_id
  left join public.profiles pr on pr.id = cm.user_id
  where ra.team_id = p_team_id
    and ra.state = 'ACTIVE'
    and cm.state = 'ACTIVE'
  group by cm.id, cm.user_id, pr.first_name, pr.surname, pr.avatar_storage_path;
end;
$function$;

comment on function public.team_staff(uuid) is
  'One row per person holding at least one active team role on this team, with every active role they hold on it -- never one row per role. Same team.roster.view gate team_people already uses for the same roster. Section 4.';

revoke all on function public.team_staff(uuid) from public;
grant execute on function public.team_staff(uuid) to authenticated;

-- A COACH'S DISPLAYED TITLE -- presentation metadata, never a second authority. `role_definitions` has
-- no HEAD_COACH/ASSISTANT_COACH role_key (Section 13's own instruction not to invent one merely to
-- match a mockup): every holder of this attribute is, and remains, exactly a COACH, asked and granted
-- and revoked through the same `assign_role`/`transition_role_assignment` every other team role uses.
-- This function only ever touches `attributes`, on a row already proven to be a COACH assignment, and
-- re-asks the identical `people.role.assign_team` authority `assign_role` itself asks -- setting a
-- label is not a lesser action than granting the role that carries it.
create or replace function public.set_team_role_title(p_assignment_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.role_assignments;
  v_role public.role_definitions;
  v_level text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_title is not null and p_title not in ('HEAD_COACH', 'ASSISTANT_COACH') then
    raise exception 'Not a recognised coaching title.' using errcode = '22023';
  end if;

  select * into v_assignment from public.role_assignments where id = p_assignment_id for update;
  if v_assignment.id is null then
    raise exception 'That role assignment was not found.' using errcode = 'P0002';
  end if;
  if v_assignment.role_key <> 'COACH' then
    raise exception 'A coaching title can only be set on a Coach role.' using errcode = '23514';
  end if;
  if v_assignment.state <> 'ACTIVE' then
    raise exception 'That role is not currently active.' using errcode = '23514';
  end if;

  select * into v_role from public.role_definitions where role_key = v_assignment.role_key;
  -- THE SAME TEST assign_role/transition_role_assignment RUN before touching this exact role
  -- assignment: whoever may grant or revoke someone's Coach role may also relabel it.
  v_level := internal.team_people_level(v_assignment.club_id, v_assignment.team_id);
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to change this team''s staff titles.' using errcode = '42501';
  end if;

  update public.role_assignments
  set attributes = case when p_title is null then attributes - 'staff_title' else jsonb_set(attributes, '{staff_title}', to_jsonb(p_title)) end,
      updated_at = now()
  where id = p_assignment_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('role_assignments', p_assignment_id, 'update', auth.uid(), jsonb_build_object('staff_title', p_title));
end;
$function$;

comment on function public.set_team_role_title(uuid, text) is
  'The presentational Head Coach / Assistant Coach label on a COACH role assignment -- attributes only, authority stays exactly COACH. Section 4/13-14.';

revoke all on function public.set_team_role_title(uuid, text) from public;
grant execute on function public.set_team_role_title(uuid, text) to authenticated;
