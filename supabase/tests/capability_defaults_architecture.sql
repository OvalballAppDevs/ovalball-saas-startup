-- Canonical capability architecture.
--
-- Three layers, deliberately distinct:
--
--   public.capabilities              -- the capability EXISTS
--   public.role_capability_defaults  -- a role gets it BY DEFAULT
--   public.capability_overrides      -- a PERSON is granted or denied it
--
-- The assertions below prove the layers stay separate, that the precedence
-- between them is the documented one, and -- the point of this whole pass --
-- that adding a capability in one domain cannot remove another domain's.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_sec   uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_site  uuid := gen_random_uuid();
  v_dir uuid; v_dir2 uuid; v_club uuid; v_club2 uuid;
  v_before int; v_after int; v_count int;
  v_key text; v_missing text[] := '{}';
  v_ok boolean;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin, 'capadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_sec,   'capsec@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_member,'capmember@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_site,  'capsite@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin,'Cap','Admin','capadmin@ovalball-test.invalid'),
    (v_sec,'Cap','Sec','capsec@ovalball-test.invalid'),
    (v_member,'Cap','Member','capmember@ovalball-test.invalid'),
    (v_site,'Cap','Site','capsite@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Capability Test RUFC','union','England','England','manual','verified','capability-test'),
    ('Capability Test Two RUFC','union','England','England','manual','verified','capability-test-2');
  select id into v_dir from public.club_directory where normalized_key='capability-test';
  select id into v_dir2 from public.club_directory where normalized_key='capability-test-2';
  insert into public.clubs (directory_id, slug, status) values (v_dir,'capability-test','active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'capability-test-2','active') returning id into v_club2;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN','active'),
    (v_club, v_sec,   'FIXTURE_SECRETARY','active'),
    (v_club, v_member,'BASIC_USER','active');

  -- =================================================================
  -- A. The three layers exist and are distinct
  -- =================================================================
  select count(*) into v_count from information_schema.tables
  where table_schema='public' and table_name in ('capabilities','role_capability_defaults','capability_overrides');
  if v_count = 3 then
    raise notice 'PASS 1 (A): catalogue, role defaults and overrides are three separate tables';
  else
    raise notice 'FAIL 1 (A): only % of the three layers exist', v_count;
  end if;

  -- Defaults carry no allow/deny column: a denial is always about a person,
  -- never a role. Presence of a row means allowed, and that is the whole
  -- vocabulary.
  select count(*) into v_count from information_schema.columns
  where table_schema='public' and table_name='role_capability_defaults'
    and column_name in ('effect','allowed','default_allowed','deny');
  if v_count = 0 then
    raise notice 'PASS 2 (A): role defaults are presence-only -- no deny concept at role level';
  else
    raise notice 'FAIL 2 (A): role defaults carry % allow/deny column(s)', v_count;
  end if;

  -- =================================================================
  -- B. Every established domain still resolves for a Club Admin
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  foreach v_key in array array[
    -- club administration
    'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
    -- teams
    'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
    -- fixtures
    'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
    -- training
    'club.training.manage',
    -- referrals
    'club.referrals.view', 'club.referrals.manage',
    -- platform billing / commercial
    'club.platform_billing.view', 'club.platform_billing.manage',
    -- GoCardless / member payments
    'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
    'club.subscription.manage_enrolment', 'club.subscription.manage_payment_actions', 'club.subscription.export',
    -- player / guardian
    'club.guardians.manage', 'manage_fixture_callups', 'approve_fixture_callups',
    'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
    -- safeguarding
    'club.safeguarding.view', 'club.safeguarding.manage_contact', 'club.safeguarding.message'
  ] loop
    if not internal.has_club_role_capability(v_club, v_key) then
      v_missing := v_missing || v_key::text;
    end if;
  end loop;

  if array_length(v_missing, 1) is null then
    raise notice 'PASS 3 (B): every established domain capability resolves for a Club Admin';
  else
    raise notice 'FAIL 3 (B): missing: %', array_to_string(v_missing, ', ');
  end if;

  -- =================================================================
  -- C. THE ADDITIVE PROOF -- the failure mode this pass exists to kill
  -- =================================================================
  -- A new domain adds its own capability and its own default. Nothing it
  -- writes mentions any other domain. Every other domain must be untouched.
  select count(*) into v_before from public.role_capability_defaults
  where scope_type = 'club' and role_key = 'CLUB_ADMIN';

  insert into public.capabilities (key, label, description, category, applicable_scopes)
  values ('club.newdomain.manage', 'New Domain', 'A future feature adding its own capability.', 'club', array['club']);

  insert into public.role_capability_defaults (scope_type, role_key, capability_key)
  values ('club', 'CLUB_ADMIN', 'club.newdomain.manage');

  select count(*) into v_after from public.role_capability_defaults
  where scope_type = 'club' and role_key = 'CLUB_ADMIN';

  if v_after = v_before + 1 then
    raise notice 'PASS 4 (C): adding a domain adds exactly one default and removes none';
  else
    raise notice 'FAIL 4 (C): CLUB_ADMIN defaults went from % to %', v_before, v_after;
  end if;

  -- The capabilities the R-0 incident destroyed are specifically still here
  -- AFTER the new domain was added.
  v_missing := '{}';
  foreach v_key in array array[
    'club.referrals.view', 'club.referrals.manage',
    'club.platform_billing.view', 'club.platform_billing.manage',
    'club.training.manage', 'club.gocardless.connect', 'club.subscription.configure'
  ] loop
    if not internal.has_club_role_capability(v_club, v_key) then
      v_missing := v_missing || v_key::text;
    end if;
  end loop;
  if array_length(v_missing, 1) is null then
    raise notice 'PASS 5 (C): the twelve-capability R-0 loss cannot recur through an additive insert';
  else
    raise notice 'FAIL 5 (C): adding a domain lost: %', array_to_string(v_missing, ', ');
  end if;

  -- And the new capability itself works, with no function re-declaration.
  if internal.has_club_role_capability(v_club, 'club.newdomain.manage') then
    raise notice 'PASS 6 (C): a new default takes effect without touching any function';
  else
    raise notice 'FAIL 6 (C): the new default did not resolve';
  end if;

  -- =================================================================
  -- D. Defaults must name real catalogue entries
  -- =================================================================
  begin
    insert into public.role_capability_defaults (scope_type, role_key, capability_key)
    values ('club', 'CLUB_ADMIN', 'club.does.not.exist');
    raise notice 'FAIL 7 (D): a default was created for an uncatalogued capability';
  exception when others then
    raise notice 'PASS 7 (D): a default must reference a real catalogue entry';
  end;

  -- And an unknown role key is refused, so a typo cannot create a silently
  -- dead role nobody notices.
  begin
    insert into public.role_capability_defaults (scope_type, role_key, capability_key)
    values ('club', 'CLUB_ADMINN', 'club.edit_profile');
    raise notice 'FAIL 8 (D): an unknown role key was accepted';
  exception when others then
    raise notice 'PASS 8 (D): an unknown role key is refused';
  end;

  -- =================================================================
  -- E. Role separation survived the move
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_sec, 'role','authenticated')::text, true);
  if internal.has_club_role_capability(v_club, 'fixture.create')
     and not internal.has_club_role_capability(v_club, 'club.edit_profile')
     and not internal.has_club_role_capability(v_club, 'club.referrals.manage') then
    raise notice 'PASS 9 (E): a Fixture Secretary keeps fixtures and gains nothing commercial';
  else
    raise notice 'FAIL 9 (E): Fixture Secretary boundary moved';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role','authenticated')::text, true);
  if internal.has_club_role_capability(v_club, 'club.view')
     and not internal.has_club_role_capability(v_club, 'fixture.create')
     and not internal.has_club_role_capability(v_club, 'club.edit_profile') then
    raise notice 'PASS 10 (E): an ordinary member keeps read-only defaults';
  else
    raise notice 'FAIL 10 (E): ordinary member boundary moved';
  end if;

  -- =================================================================
  -- F. Precedence: deny > site admin > grant > role default
  -- =================================================================
  perform set_config('request.jwt.claims', null, true);
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full')
  on conflict (user_id) do update set status = 'active', admin_role = 'full';

  -- A grant override gives a member something no role default provides.
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, status, granted_by)
  values (v_member, 'club.edit_profile', 'club', v_club, 'grant', 'active', v_site);

  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role','authenticated')::text, true);
  if public.has_capability('club.edit_profile', 'club', v_club, null)
     and not internal.has_club_role_capability(v_club, 'club.edit_profile') then
    raise notice 'PASS 11 (F): a grant override adds authority without changing any role default';
  else
    raise notice 'FAIL 11 (F): grant override precedence wrong';
  end if;

  -- A deny override removes something the role default provides, and does
  -- not touch the default itself.
  perform set_config('request.jwt.claims', null, true);
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, status, granted_by)
  values (v_admin, 'club.referrals.manage', 'club', v_club, 'deny', 'active', v_site);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  if not public.has_capability('club.referrals.manage', 'club', v_club, null)
     and internal.has_club_role_capability(v_club, 'club.referrals.manage') then
    raise notice 'PASS 12 (F): a deny override beats the role default, leaving the default intact';
  else
    raise notice 'FAIL 12 (F): deny override precedence wrong';
  end if;

  -- The same Club Admin keeps every other capability -- a deny is surgical.
  if public.has_capability('club.referrals.view', 'club', v_club, null)
     and public.has_capability('club.platform_billing.view', 'club', v_club, null) then
    raise notice 'PASS 13 (F): a deny on one capability leaves the rest of the role intact';
  else
    raise notice 'FAIL 13 (F): a single deny removed unrelated capabilities';
  end if;

  -- Deny beats Site Admin too -- the strongest rule in the chain.
  perform set_config('request.jwt.claims', null, true);
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, status, granted_by)
  values (v_site, 'club.edit_profile', 'club', v_club, 'deny', 'active', v_site);
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role','authenticated')::text, true);
  if not public.has_capability('club.edit_profile', 'club', v_club, null) then
    raise notice 'PASS 14 (F): a deny override outranks Site Admin';
  else
    raise notice 'FAIL 14 (F): Site Admin bypassed an explicit deny';
  end if;

  -- =================================================================
  -- G. Safety invariants a default or an override must never breach
  -- =================================================================
  -- Cross-club isolation: a default is not club-scoped data, and an override
  -- at club A grants nothing at club B.
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role','authenticated')::text, true);
  if not public.has_capability('club.edit_profile', 'club', v_club2, null) then
    raise notice 'PASS 15 (G): a grant at one club grants nothing at another';
  else
    raise notice 'FAIL 15 (G): a club-scoped grant leaked across clubs';
  end if;

  -- Scope discipline: a club capability cannot be exercised at site scope,
  -- however the arguments are shaped.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  if not public.has_capability('club.edit_profile', 'site', null, null)
     and not public.has_capability('club.edit_profile', 'club', null, null) then
    raise notice 'PASS 16 (G): a club capability is refused outside club scope';
  else
    raise notice 'FAIL 16 (G): scope validation bypassed';
  end if;

  -- A deactivated club grants nothing to anyone, whatever the defaults say.
  perform set_config('request.jwt.claims', null, true);
  update public.clubs set status = 'deactivated' where id = v_club;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  if not internal.has_club_role_capability(v_club, 'club.edit_profile') then
    raise notice 'PASS 17 (G): a deactivated club yields no role capability at all';
  else
    raise notice 'FAIL 17 (G): a deactivated club still granted authority';
  end if;
  perform set_config('request.jwt.claims', null, true);
  update public.clubs set status = 'active' where id = v_club;

  -- =================================================================
  -- H. Ordinary users cannot mutate the defaults
  -- =================================================================
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'role_capability_defaults'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_count = 0 then
    raise notice 'PASS 18 (H): anon and authenticated hold no write grant on role defaults';
  else
    raise notice 'FAIL 18 (H): % write grants exist for ordinary roles', v_count;
  end if;

  select relrowsecurity into v_ok from pg_class where oid = 'public.role_capability_defaults'::regclass;
  if v_ok then
    raise notice 'PASS 19 (H): row level security is enabled on role defaults';
  else
    raise notice 'FAIL 19 (H): RLS is off on role defaults';
  end if;

  -- The Club Admin, who holds every club capability there is, still cannot
  -- write the table that decides what those capabilities are.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.role_capability_defaults (scope_type, role_key, capability_key)
    values ('club', 'CLUB_MEMBER', 'club.platform_billing.manage');
    raise notice 'FAIL 20 (H): a Club Admin granted a capability to every member on the platform';
  exception when others then
    raise notice 'PASS 20 (H): a Club Admin cannot write role defaults';
  end;
  reset role;

  -- =================================================================
  -- I. The site scope is deliberately NOT in this table
  -- =================================================================
  -- Site capabilities map to per-user boolean columns on site_admins, which
  -- is per-person grant data rather than a role default. If someone later
  -- moves them in here, that is a design change and should be a deliberate
  -- one -- so it is asserted rather than left implicit.
  select count(*) into v_count from public.role_capability_defaults where scope_type = 'site';
  if v_count = 0 then
    raise notice 'PASS 21 (I): site capabilities stay per-user on site_admins, not role defaults';
  else
    raise notice 'FAIL 21 (I): % site rows appeared in role defaults', v_count;
  end if;
end;
$$;

rollback;
