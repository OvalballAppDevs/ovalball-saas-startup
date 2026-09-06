-- R-0, tenth occurrence: restore internal.has_club_role_capability as the
-- UNION of every intended CLUB_ADMIN list.
--
-- WHAT HAPPENED
--
-- `internal.has_club_role_capability` is one function holding one inline
-- list per role. Any migration that needs to add a capability re-declares
-- the whole function, and a re-declaration written from an older copy of
-- the list silently deletes every capability added since. The failure is
-- invisible: nothing errors, a product area simply stops working for every
-- Club Admin on the platform.
--
-- 20260925020000 established the narrow model. 20261011000000 (training)
-- dropped four commercial capabilities; 20261012000000 restored them and
-- added the R-0 regression assertion that has guarded this ever since.
-- The safeguarding foundation migration (20261018000000) re-declared the
-- function again from a pre-commercial copy: it correctly ADDED
-- club.safeguarding.view / manage_contact / message, and silently DROPPED
-- twelve others.
--
-- Caught by that R-0 assertion, which failed with the exact list:
--   club.referrals.view, club.referrals.manage,
--   club.platform_billing.view, club.platform_billing.manage,
--   club.training.manage, club.gocardless.connect,
--   club.subscription.configure
-- and, not covered by the assertion but dropped just the same:
--   club.guardians.manage, club.subscription.view_finance,
--   club.subscription.manage_enrolment,
--   club.subscription.manage_payment_actions, club.subscription.export,
--   team.guardians.invite, team.community.manage, team.attendance.view
--
-- THE FIX
--
-- This declaration is the union of BOTH intended lists. It keeps every
-- safeguarding capability the newer migration added and restores every
-- commercial, training and guardian capability it dropped, so neither line
-- of work loses anything. The guard at the bottom asserts the union
-- resolves before this migration is allowed to finish.
--
-- This does not modify any other migration. It is ordered after them, so it
-- is the last word regardless of the order the others are applied in.

create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      -- Club structure and identity
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      -- Fixtures and calendar
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      -- Guardians, community, attendance
      'team.guardians.invite', 'club.guardians.manage', 'team.community.manage', 'team.attendance.view',
      -- Commercial: the club's own member payments (Domain B) and its
      -- Ovalball subscription (Domain A)
      'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
      'club.subscription.manage_enrolment', 'club.subscription.manage_payment_actions', 'club.subscription.export',
      'club.platform_billing.view', 'club.platform_billing.manage',
      'club.referrals.view', 'club.referrals.manage',
      -- Training
      'club.training.manage',
      -- Safeguarding. Only these three are role defaults: view, contact
      -- management and messaging. club.dispensation.* and
      -- club.transfer.safeguarding_* are granted individually per accepted
      -- Safeguarding Officer and are deliberately NOT here.
      'club.safeguarding.view', 'club.safeguarding.manage_contact', 'club.safeguarding.message'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

comment on function internal.has_club_role_capability is
  'Role-default capabilities per club role. THIS LIST IS THE UNION OF EVERY FEATURE AREA. Re-declaring this function from an older copy silently removes capabilities with no error -- it has happened ten times. If you must re-declare it, start from the CURRENT definition (\df+ internal.has_club_role_capability) and add to it, never from a copy in an older migration.';

-- ---------------------------------------------------------------------
-- Guard: the union must resolve before this migration is allowed to finish
-- ---------------------------------------------------------------------

do $$
declare
  v_club uuid;
  v_user uuid;
  v_key text;
  v_missing text[] := '{}';
begin
  -- A real Club Admin at a real active club, so the check exercises the
  -- actual branch rather than a synthetic one.
  select cm.club_id, cm.user_id into v_club, v_user
  from public.club_memberships cm
  join public.clubs c on c.id = cm.club_id
  where cm.role = 'CLUB_ADMIN' and cm.status = 'active' and cm.authority_suspended = false
    and c.status = 'active'
  limit 1;

  if v_club is null then
    raise notice 'No active Club Admin on this database -- capability union guard skipped.';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  foreach v_key in array array[
    'club.edit_profile', 'club.teams.manage', 'club.venues.manage', 'club.pitches.manage',
    'club.guardians.manage', 'club.training.manage',
    'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
    'club.platform_billing.view', 'club.platform_billing.manage',
    'club.referrals.view', 'club.referrals.manage',
    'club.safeguarding.view', 'club.safeguarding.manage_contact', 'club.safeguarding.message'
  ] loop
    if not internal.has_club_role_capability(v_club, v_key) then
      v_missing := v_missing || v_key::text;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Capability union incomplete after restore. Missing: %', array_to_string(v_missing, ', ');
  end if;
end;
$$;
