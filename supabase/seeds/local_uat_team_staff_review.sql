-- Local UAT data for TEAM PROFILE STAFF PHYSICAL REVIEW (Section 4, extended for the owner-review
-- addendum's Team Safeguarding Lead).
--
-- WHY THIS FILE EXISTS
--
-- Before this seed, no UAT team had a First Aider or a person holding two roles on the same team, so
-- Staff's multi-role rendering and the FIRST_AIDER row could not be visually reviewed. This adds a
-- small number of facts, all onto EXISTING UAT identities rather than new ones, chosen deliberately to
-- avoid the shared, heavily-reused CA-M3/CA-M4 proof personas on the same team:
--
--   Ffion Meredith, already the review club's dedicated "role-switching review identity" (already
--   CLUB_ADMIN + FIXTURES_SECRETARY + COACH + SAFEGUARDING_OFFICER), gains FIRST_AIDER on Under 12
--   Boys -- her existing COACH role stands alongside it, giving one real multi-role staff member
--   (Coach + First Aider) without disturbing anything the other role-switching tests already assert
--   about her. Her COACH role also gets the presentational title HEAD_COACH.
--
--   Priya Nair (uat.coach@ovalball.test, this session's own physical-review persona) has her existing
--   Women's 1st Team COACH role's presentational title set to ASSISTANT_COACH, exercising the other
--   title alongside the first -- she is untouched everywhere else, and her Men's 1st Team COACH role
--   is left titled exactly as it already was.
--
--   Bethan Price, Under 12 Boys' other existing Coach, gains TEAM_SAFEGUARDING_LEAD alongside her
--   existing COACH role -- a second, independent multi-role example (Coach + Team Safeguarding Lead,
--   deliberately a different role combination from Ffion's Coach + First Aider) so the new role can be
--   visually reviewed without inventing a third identity. She has an adult DOB already on file.
--
-- All ATTRIBUTES-only or ADDITIVE-role changes on ACTIVE rows: no existing role_assignments row's
-- role_key, state, team_id or membership_id changes, so nothing that already depended on those facts
-- can break. Committed, idempotent, additive and local-only, like every UAT seed.

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Team Staff review UAT seed is local-only.';
  end if;
end $$;

do $$
declare
  v_u12_team uuid := '5f868069-b6ca-4bcd-8306-f73d234031d9'; -- Under 12 Boys, Ovalball UAT RUFC
  v_ffion_membership uuid := 'f8423d60-9e9d-4be9-8357-95ab1760bbe3'; -- Ffion Meredith
  v_ffion_coach_assignment uuid := 'f1cff195-98b9-491e-a36d-e591fe448fcd';
  v_womens_team uuid := 'c06be292-cebb-4bcc-bfca-81258cfaf100'; -- Women's 1st Team, Ovalball UAT RUFC
  v_priya_womens_coach_assignment uuid := '002799db-4441-4774-a19a-d410a2914e86';
  v_bethan_membership uuid := '14a91142-7514-4a5e-9d0a-6529cb0a79d7'; -- Bethan Price
  v_bethan_coach_assignment uuid := '2078d07a-c84f-4d07-9b2d-7f699d05935a';
begin
  if not exists (select 1 from public.role_assignments where id = v_ffion_coach_assignment and role_key = 'COACH' and team_id = v_u12_team and state = 'ACTIVE')
     or not exists (select 1 from public.role_assignments where id = v_priya_womens_coach_assignment and role_key = 'COACH' and team_id = v_womens_team and state = 'ACTIVE')
     or not exists (select 1 from public.role_assignments where id = v_bethan_coach_assignment and role_key = 'COACH' and team_id = v_u12_team and state = 'ACTIVE') then
    return; -- the exact review identities/assignments this seed enriches don't exist in this database; nothing to add.
  end if;

  -- FFION MEREDITH GAINS FIRST AIDER on Under 12 Boys -- one real multi-role staff member.
  if not exists (select 1 from public.role_assignments where membership_id = v_ffion_membership and team_id = v_u12_team and role_key = 'FIRST_AIDER' and state = 'ACTIVE') then
    insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source, reason)
    select cm.user_id, cm.club_id, v_u12_team, v_ffion_membership, 'FIRST_AIDER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', 'Local UAT Staff review: multi-role (Coach + First Aider)'
    from public.club_memberships cm where cm.id = v_ffion_membership;
  end if;

  -- Ffion's existing Coach role on Under 12 Boys is presented as Head Coach.
  update public.role_assignments
  set attributes = jsonb_set(attributes, '{staff_title}', '"HEAD_COACH"')
  where id = v_ffion_coach_assignment and coalesce(attributes ->> 'staff_title', '') <> 'HEAD_COACH';

  -- Priya's existing Coach role on Women's 1st Team is presented as Assistant Coach.
  update public.role_assignments
  set attributes = jsonb_set(attributes, '{staff_title}', '"ASSISTANT_COACH"')
  where id = v_priya_womens_coach_assignment and coalesce(attributes ->> 'staff_title', '') <> 'ASSISTANT_COACH';

  -- BETHAN PRICE GAINS TEAM SAFEGUARDING LEAD on Under 12 Boys -- a second, independent multi-role
  -- example (Coach + Team Safeguarding Lead), distinct from Ffion's Coach + First Aider.
  if not exists (select 1 from public.role_assignments where membership_id = v_bethan_membership and team_id = v_u12_team and role_key = 'TEAM_SAFEGUARDING_LEAD' and state = 'ACTIVE') then
    insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source, reason)
    select cm.user_id, cm.club_id, v_u12_team, v_bethan_membership, 'TEAM_SAFEGUARDING_LEAD', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', 'Local UAT Staff review: multi-role (Coach + Team Safeguarding Lead)'
    from public.club_memberships cm where cm.id = v_bethan_membership;
  end if;
end $$;
