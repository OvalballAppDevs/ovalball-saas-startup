-- =====================================================================================================
-- A NAMED PLACE FOR TEST ROLE FIXTURES.
--
-- A hundred and twenty-three suites and scripts give somebody a team role before asserting anything,
-- and every one of them did it by writing through `public.team_permissions` -- the Slice 2
-- compatibility view that Slice 10 drops. That is not a product defect, but it is a real problem:
--
--   * the day the view goes, a hundred suites stop compiling at once;
--   * and until then, the whole regression estate exercises the legacy write path rather than the
--     canonical one, so it cannot tell us whether the canonical path works.
--
-- The owner's instruction is to centralise canonical role setup rather than migrate text file by file,
-- and to make the exemption an INTENTIONAL ARCHITECTURAL CATEGORY rather than a raised ceiling. So:
--
--   `testing` is a schema that exists only for test fixtures. No browser role can reach it, production
--   code may never reference it (the retirement verifier asserts that), and anything inside it is
--   structurally identifiable as test setup by its name alone.
--
-- `testing.team_roles` is a WRITABLE PROJECTION, not a second model. It reads
-- `internal.team_role_assignments` -- the one canonical projection -- and its INSTEAD OF triggers write
-- real `role_assignments` rows with CANONICAL role keys. A fixture using it produces exactly the rows a
-- club admin assigning that role produces.
--
-- IT IS A VIEW RATHER THAN A FUNCTION for one practical reason: of the hundred and forty-three fixture
-- writes, forty-seven are multi-row `values` lists or `insert ... select`, and a function call cannot
-- stand in for those. A view is a drop-in in every form, at the top level of a .sql file and inside a
-- plpgsql block alike.
--
-- WHY NOT `internal.grant_role`. It is the canonical write and it is right to be strict: a staff role
-- needs a date of birth on file showing the holder is an adult. Test fixtures create users with no date
-- of birth, so every one of them would fail -- and loosening `grant_role` to accommodate tests would
-- weaken a real safeguarding guard to make a counter move. The fixture surface writes rows; the
-- production surface keeps its rules.
-- =====================================================================================================

create schema if not exists testing;

comment on schema testing is
  'Test fixtures only. Never reachable by a browser role, never referenced by production code -- '
  'scripts/verify-slice10-retirement.mjs asserts both. Everything here writes canonical rows; it '
  'exists so a suite can arrange state without reaching for a compatibility surface.';

revoke all on schema testing from public, anon, authenticated;

create or replace view testing.team_roles as
select
  tra.id,
  tra.membership_id,
  tra.team_id,
  tra.role_key,
  tra.assigned_group_id,
  tra.granted_by as created_by,
  tra.granted_at as created_at
from internal.team_role_assignments tra;

comment on view testing.team_roles is
  'A team''s staff for test fixtures: reads the canonical projection, writes canonical role_assignments '
  'rows with canonical role keys. The replacement for suites that wrote through public.team_permissions.';

revoke all on testing.team_roles from public, anon, authenticated;

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
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Removing a team role means revoking every live assignment on that team, which is what deleting
    -- the compatibility row did.
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
    raise exception 'testing.team_roles takes a canonical team role key, not %.', new.role_key using errcode = '23514';
  end if;

  -- THE ASSIGNMENT'S STATE FOLLOWS THE MEMBERSHIP'S, exactly as a real grant does: a role on a
  -- suspended membership is a suspended role, not an active one.
  v_state := case v_membership.state when 'ACTIVE' then 'ACTIVE' when 'SUSPENDED' then 'SUSPENDED' else 'REVOKED' end;
  v_attributes := case when new.assigned_group_id is not null
                       then jsonb_build_object('assigned_group_id', new.assigned_group_id)
                       else '{}'::jsonb end;

  -- TEAM ADMINISTRATION SITS ON A MANAGER BASE, which is how the canonical model records it: the
  -- administration assignment names the assignment it is elevated from.
  v_base_role := case new.role_key when 'COACH' then 'COACH' else 'TEAM_MANAGER' end;

  select id into v_base_id from public.role_assignments
  where membership_id = v_membership.id and team_id = new.team_id
    and role_key = v_base_role and state in ('ACTIVE', 'SUSPENDED');
  if v_base_id is null then
    insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state,
                                         suspended_level, source, granted_by, granted_at, attributes)
    values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, v_base_role, v_state,
            case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
            'CLUB_ADMIN_ASSIGNMENT', coalesce(new.created_by, auth.uid()), coalesce(new.created_at, now()),
            v_attributes)
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
                                           granted_by, granted_at, attributes)
      values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, 'TEAM_ADMINISTRATION',
              v_base_id, v_state, case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
              'CLUB_ADMIN_ASSIGNMENT', coalesce(new.created_by, auth.uid()), coalesce(new.created_at, now()),
              v_attributes)
      returning id into v_id;
    end if;
  end if;

  new.id := v_id;
  return new;
end;
$function$;

drop trigger if exists testing_team_roles_write on testing.team_roles;
create trigger testing_team_roles_write
instead of insert or update or delete on testing.team_roles
for each row execute function testing.team_roles_write();

-- ---- it writes what a real grant writes ---------------------------------------------------------------

do $$
declare
  v_u uuid := gen_random_uuid(); v_dir uuid; v_club uuid; v_team uuid; v_m uuid;
  v_tag text := substr(gen_random_uuid()::text, 1, 8); v_n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
    reauthentication_token)
  values (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'trfix-' || v_tag || '@ovalball.test', '', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email)
  values (v_u, 'Fixture', 'Probe', 'trfix-' || v_tag || '@ovalball.test');
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active,
                                     verification_status, source, normalized_key)
  values ('TRFIX ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified',
          'site_admin_manual', 'trfix-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'trfix-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'trfix-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_u, 'BASIC_USER', 'active') returning id into v_m;

  insert into testing.team_roles (membership_id, team_id, role_key) values (v_m, v_team, 'TEAM_ADMINISTRATION');

  -- The canonical model, not a compatibility row: a manager base and an administration assignment
  -- elevated from it, both ACTIVE, both canonical keys.
  select count(*) into v_n from public.role_assignments
  where membership_id = v_m and team_id = v_team and state = 'ACTIVE'
    and role_key in ('TEAM_MANAGER', 'TEAM_ADMINISTRATION');
  if v_n <> 2 then raise exception 'testing.team_roles wrote % canonical assignment(s), expected 2.', v_n; end if;

  -- And the one canonical projection shows exactly one row, with the highest role winning.
  select count(*) into v_n from internal.team_role_assignments
  where membership_id = v_m and team_id = v_team and role_key = 'TEAM_ADMINISTRATION';
  if v_n <> 1 then raise exception 'the canonical projection does not see the fixture''s role.'; end if;

  -- Deleting through the fixture surface revokes the lot.
  delete from testing.team_roles where membership_id = v_m and team_id = v_team;
  select count(*) into v_n from internal.team_role_assignments where membership_id = v_m and team_id = v_team;
  if v_n <> 0 then raise exception 'deleting through testing.team_roles left % live role(s).', v_n; end if;

  raise notice 'testing.team_roles writes and revokes canonical role assignments.';
end $$;
