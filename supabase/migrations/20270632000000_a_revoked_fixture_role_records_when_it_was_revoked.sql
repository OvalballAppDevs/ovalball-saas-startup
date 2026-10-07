-- =====================================================================================================
-- A REVOKED FIXTURE ROLE RECORDS WHEN IT WAS REVOKED.
--
-- `testing.team_roles` derives an assignment's state from the membership's, exactly as a real grant
-- does -- and a role seeded onto a membership that is neither ACTIVE nor SUSPENDED is born REVOKED.
-- The insert set the state and nothing else, and `role_assignments_revocation_shape` says what that is
-- wrong about:
--
--     check ((state = 'REVOKED') = (revoked_at is not null))
--
-- A revoked row must say WHEN. The compatibility trigger this surface replaces stamped the timestamp;
-- the replacement did not, so `identity_security_containment` -- which seeds a role onto a revoked
-- membership deliberately -- stopped at the first insert.
-- =====================================================================================================

create or replace function testing.team_roles_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_membership public.club_memberships;
  v_state text;
  v_attributes jsonb;
  v_base_role text;
  v_base_id uuid;
  v_id uuid;
  v_revoked_at timestamptz;
  v_revocation_reason text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.role_assignments
    set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = 'Removed by a test fixture', suspended_level = null
    where membership_id = old.membership_id and team_id = old.team_id
      and role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION') and state <> 'REVOKED';
    if tg_op = 'DELETE' then return old; end if;
  end if;

  select * into v_membership from public.club_memberships where id = new.membership_id;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = '23503';
  end if;
  if new.role_key not in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION') then
    raise exception
      'testing.team_roles takes a canonical team role key (COACH, TEAM_MANAGER, TEAM_ADMINISTRATION), not %. '
      'There is no canonical role for the legacy ''view_only'' value: a parent or player with no staff '
      'role simply holds no role assignment.', new.role_key using errcode = '23514';
  end if;

  v_state := case v_membership.state when 'ACTIVE' then 'ACTIVE' when 'SUSPENDED' then 'SUSPENDED' else 'REVOKED' end;
  -- A REVOKED ROW SAYS WHEN AND WHY, which is what the shape constraint is for.
  v_revoked_at := case when v_state = 'REVOKED' then now() end;
  v_revocation_reason := case when v_state = 'REVOKED' then 'Membership not active' end;
  v_attributes := case when new.assigned_group_id is not null
                       then jsonb_build_object('assigned_group_id', new.assigned_group_id)
                       else '{}'::jsonb end;
  v_base_role := case new.role_key when 'COACH' then 'COACH' else 'TEAM_MANAGER' end;

  select id into v_base_id from public.role_assignments
  where membership_id = v_membership.id and team_id = new.team_id
    and role_key = v_base_role and state in ('ACTIVE', 'SUSPENDED');
  if v_base_id is null then
    insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state,
                                         suspended_level, source, granted_by, granted_at,
                                         revoked_at, revocation_reason, attributes)
    values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, v_base_role, v_state,
            case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
            'CLUB_ADMIN_ASSIGNMENT', coalesce(new.created_by, auth.uid()), coalesce(new.created_at, now()),
            v_revoked_at, v_revocation_reason, v_attributes)
    returning id into v_base_id;
  end if;
  v_id := v_base_id;

  if new.role_key = 'TEAM_ADMINISTRATION' then
    select id into v_id from public.role_assignments
    where membership_id = v_membership.id and team_id = new.team_id
      and role_key = 'TEAM_ADMINISTRATION' and state in ('ACTIVE', 'SUSPENDED');
    if v_id is null then
      insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key,
                                           base_assignment_id, state, suspended_level, source,
                                           granted_by, granted_at, revoked_at, revocation_reason, attributes)
      values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, 'TEAM_ADMINISTRATION',
              v_base_id, v_state, case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
              'CLUB_ADMIN_ASSIGNMENT', coalesce(new.created_by, auth.uid()), coalesce(new.created_at, now()),
              v_revoked_at, v_revocation_reason, v_attributes)
      returning id into v_id;
    end if;
  end if;

  new.id := v_id;
  return new;
end;
$function$;
