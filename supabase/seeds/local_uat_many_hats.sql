-- ===========================================================================
-- ONE PERSON, EVERY HAT -- the role-switching review identity
-- ===========================================================================
--
-- A volunteer-run rugby club is not staffed by one person per job. The same
-- person is very often the Club Admin AND the Fixtures Secretary AND the
-- Safeguarding Officer AND somebody's parent, and coaches the Under 12s on a
-- Sunday. Reviewing Ovalball as each of those in turn used to mean five
-- accounts and five sign-ins.
--
-- So this seeds ONE account that genuinely holds all of them, and the context
-- switcher at the top of the app offers each as its own place to stand.
--
-- IT IS NOT A SPECIAL ACCOUNT. Every role below is granted through the
-- canonical path the product itself uses -- `internal.grant_role`, which
-- refuses a role a minor may not hold, refuses a team role on another club's
-- team, and revokes the plain Member seat when a Club Admin or Fixtures
-- Secretary role arrives. Nothing here writes a `role_assignments` row by hand,
-- because a row written by hand is a state the product cannot produce and
-- therefore cannot be reviewed against.
--
-- THE SAFEGUARDING OFFICER IS APPOINTED, NOT ASSIGNED. `grant_role` refuses the
-- role outright from any source but SAFEGUARDING_APPOINTMENT, and a nomination
-- enters PENDING_CONFIRMATION where `internal.bundle_source` grants it nothing.
-- Confirmation needs `safeguarding.officer.confirm`, which is a SITE capability,
-- and the function refuses self-confirmation whatever else the person holds --
-- the second pair of eyes is the point of the rule. So the seed nominates as the
-- club, and confirms as the Full Site Admin persona, which is exactly the
-- two-party sequence a real appointment follows.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It creates no club, no team, no child and no
-- fixture. Every one of those already exists in the review world, and a seed
-- that made its own copies would give the owner a second Under 12s to be
-- confused by. It only grants roles to one new person.
--
-- IDEMPOTENT. Re-running it changes nothing: `grant_role` returns the existing
-- assignment when the role is already held, and every insert below is guarded.
-- ===========================================================================

do $$
declare
  v_email    text := 'uat.manyhats@ovalball.test';
  v_user     uuid;
  v_confirmer uuid;
  v_club     uuid;
  v_u12      uuid;
  v_membership uuid;
  v_child    uuid;
  v_assignment uuid;
  v_state    text;
  v_roles    text;
begin
  select c.id into v_club
    from public.clubs c join public.club_directory d on d.id = c.directory_id
   where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise notice 'SKIPPED: the Ovalball UAT club is not seeded yet.';
    return;
  end if;

  select t.id into v_u12 from public.teams t
   where t.club_id = v_club and t.age_group = 'U12' and t.squad_designation is null and t.active
   limit 1;

  -- ---------------------------------------------------------------------
  -- THE PERSON
  -- ---------------------------------------------------------------------
  -- A DATE OF BIRTH IS NOT OPTIONAL HERE. Every role this account holds is
  -- minor-prohibited, and `grant_role` refuses one without a recorded date of
  -- birth establishing the person is an adult -- unknown age is not adulthood.
  select u.id into v_user from auth.users u where u.email = v_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  end if;

  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v_user, 'Ffion', 'Meredith', v_email, (current_date - interval '41 years')::date)
  on conflict (id) do update
    set first_name = coalesce(nullif(btrim(public.profiles.first_name), ''), excluded.first_name),
        surname    = coalesce(nullif(btrim(public.profiles.surname), ''), excluded.surname),
        date_of_birth = coalesce(public.profiles.date_of_birth, excluded.date_of_birth);

  -- ---------------------------------------------------------------------
  -- THE MEMBERSHIP -- one per club, and every role hangs off it
  -- ---------------------------------------------------------------------
  select cm.id, cm.state into v_membership, v_state
    from public.club_memberships cm where cm.club_id = v_club and cm.user_id = v_user;
  if v_membership is null then
    insert into public.club_memberships (club_id, user_id, role, status)
    values (v_club, v_user, 'BASIC_USER', 'active')
    returning id into v_membership;
  elsif v_state <> 'ACTIVE' then
    raise notice 'SKIPPED: this account''s membership of the club is % rather than active.', v_state;
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- THE HATS
  -- ---------------------------------------------------------------------
  -- CLUB ADMIN and FIXTURES SECRETARY are both CLUB-scoped and both stack:
  -- role_assignments is unique on (user, club, team, ROLE_KEY), and grant_role
  -- refuses neither in the presence of the other. It revokes only the plain
  -- MEMBER seat, because being an ordinary member is what you are when you are
  -- nothing else.
  perform internal.grant_role(v_membership, 'CLUB_ADMIN', null, 'SITE_ADMIN_ASSIGNMENT', 'UAT role-switching review identity');
  perform internal.grant_role(v_membership, 'FIXTURES_SECRETARY', null, 'SITE_ADMIN_ASSIGNMENT', 'UAT role-switching review identity');

  -- COACH is TEAM-scoped, so it names the side.
  if v_u12 is not null then
    perform internal.grant_role(v_membership, 'COACH', v_u12, 'SITE_ADMIN_ASSIGNMENT', 'UAT role-switching review identity');
  else
    raise notice 'NOTE: no Under 12 side at this club, so the Coach hat was not given.';
  end if;

  -- ---------------------------------------------------------------------
  -- THE SAFEGUARDING OFFICER -- nominated by the club, confirmed by Ovalball
  -- ---------------------------------------------------------------------
  select ra.id, ra.confirmation_state into v_assignment, v_state from public.role_assignments ra
   where ra.user_id = v_user and ra.club_id = v_club and ra.role_key = 'SAFEGUARDING_OFFICER' and ra.state = 'ACTIVE';
  if v_assignment is null then
    v_state := null;
    v_assignment := internal.enter_safeguarding_nomination(
      v_club, v_user, 'primary', 'SAFEGUARDING_APPOINTMENT', null, 'UAT role-switching review identity', null);
  end if;

  -- The second pair of eyes. `confirm_safeguarding_officer` refuses
  -- self-confirmation and needs a SITE capability, so the confirmer is a
  -- different person -- the Full Site Admin review persona.
  select u.id into v_confirmer from auth.users u where u.email = 'uat.fullsiteadmin@ovalball.test';
  if v_state = 'CONFIRMED' then
    -- Already appointed on an earlier run. Confirming again raises 23505 by
    -- design, so the seed does not ask.
    null;
  elsif v_confirmer is null then
    raise notice 'NOTE: no Full Site Admin persona, so the Safeguarding Officer nomination stays PENDING_CONFIRMATION (which is the honest state, not a failure).';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_confirmer, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      perform public.confirm_safeguarding_officer(v_assignment, 'UAT role-switching review identity');
    exception when others then
      raise notice 'NOTE: confirmation could not run as the Full Site Admin (%). The nomination stands, unconfirmed.', sqlerrm;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
  end if;

  -- ---------------------------------------------------------------------
  -- THE PARENT/GUARDIAN HAT
  -- ---------------------------------------------------------------------
  -- An EXISTING child of the review world, on the Under 12s -- so this account's
  -- family view shows rugby that is already there, with fixtures and training
  -- against it, rather than an empty week.
  select p.id into v_child
    from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status = 'active'
   where ptm.team_id = v_u12 and p.active
     and not internal.player_is_adult(p.id)
   order by p.first_name
   limit 1;

  if v_child is null then
    raise notice 'NOTE: no child on the Under 12s to be a guardian of, so the Parent/Guardian hat was not given.';
  else
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
    select v_user, v_child, 'guardian', 'active'
    where not exists (
      select 1 from public.guardians g where g.guardian_user_id = v_user and g.player_id = v_child);
  end if;

  -- ---------------------------------------------------------------------
  -- WHAT THEY ENDED UP WITH
  -- ---------------------------------------------------------------------
  select string_agg(
           ra.role_key || coalesce(' (' || t.display_name || ')', '')
             || case when ra.role_key = 'SAFEGUARDING_OFFICER' then ' [' || coalesce(ra.confirmation_state, '?') || ']' else '' end,
           ', ' order by ra.role_key)
    into v_roles
    from public.role_assignments ra
    left join public.teams t on t.id = ra.team_id
   where ra.user_id = v_user and ra.state = 'ACTIVE';

  raise notice 'uat.manyhats@ovalball.test -> %', coalesce(v_roles, 'no roles');
  raise notice 'guardian of % child(ren)', (select count(*) from public.guardians g where g.guardian_user_id = v_user and g.status = 'active');
end $$;
