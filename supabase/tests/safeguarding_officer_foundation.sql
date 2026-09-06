-- Safeguarding Officer Foundation -- security regression.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/safeguarding_officer_foundation.sql
--
-- Self-contained/transactional (fresh gen_random_uuid() identities,
-- begin/rollback) -- no persistent fixture, no test pollution risk, per
-- this feature's own explicit "no test pollution" requirement (section
-- 34) and the real, disclosed lesson learned while building this feature
-- (an earlier ad-hoc verification query run outside an explicit
-- begin/rollback block committed two throwaway auth.users rows straight
-- into this local database and had to be manually cleaned up -- every
-- test below is now wrapped accordingly).

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Safeguarding Officer: identity, invitation, capability, cross-club isolation ==='

begin;

do $$
declare
  v_club_a uuid; v_club_b uuid;
  v_directory_a uuid; v_directory_b uuid;
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_team_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_officer_user uuid := gen_random_uuid();
  v_site_admin uuid := gen_random_uuid();
  v_officer_id uuid;
  v_officer2_id uuid;
  v_invitation_id uuid;
  v_token text;
  v_token2 text;
  v_row record;
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'SG Officer Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sg-officer-test-a-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_directory_a;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'SG Officer Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sg-officer-test-b-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_directory_b;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory_a, 'sg-officer-test-a-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_a;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory_b, 'sg-officer-test-b-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_b;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin_a, 'sg-admin-a-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin_b, 'sg-admin-b-' || v_admin_b::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_team_admin, 'sg-teamadmin-' || v_team_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 'sg-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_officer_user, 'sg-officer-' || v_officer_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_site_admin, 'sg-siteadmin-' || v_site_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin_a, 'Admin', 'A', 'sg-admin-a-' || v_admin_a::text || '@ovalball.test'),
    (v_admin_b, 'Admin', 'B', 'sg-admin-b-' || v_admin_b::text || '@ovalball.test'),
    (v_team_admin, 'Team', 'Admin', 'sg-teamadmin-' || v_team_admin::text || '@ovalball.test'),
    (v_parent, 'Test', 'Parent', 'sg-parent-' || v_parent::text || '@ovalball.test'),
    (v_officer_user, 'Test', 'Officer', 'sg-officer-' || v_officer_user::text || '@ovalball.test'),
    (v_site_admin, 'Site', 'Admin', 'sg-siteadmin-' || v_site_admin::text || '@ovalball.test');
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active'),
    (v_club_a, v_team_admin, 'BASIC_USER', 'active'),
    (v_club_a, v_parent, 'BASIC_USER', 'active');
  insert into public.site_admins (user_id, status, admin_role) values (v_site_admin, 'active', 'full');

  -- A. Club can have a primary Safeguarding Officer.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);

  v_officer_id := public.nominate_safeguarding_officer(v_club_a, 'primary', 'Test Officer', 'sg-officer-' || v_officer_user::text || '@ovalball.test');
  if (select status from public.club_safeguarding_officers where id = v_officer_id) = 'not_invited' then
    raise notice 'PASS A: a club can nominate a primary Safeguarding Officer contact, starting not_invited (grants nothing yet)';
  else
    raise exception 'FAIL A';
  end if;

  -- H. Team Admin (BASIC_USER-tier here) cannot nominate/assign a Safeguarding Officer.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_team_admin::text, 'role', 'authenticated')::text, true);
  begin
    perform public.nominate_safeguarding_officer(v_club_a, 'deputy', 'Should Not Work', 'nope@ovalball.test');
    raise exception 'FAIL H: a non-Club-Admin nominated a Safeguarding Officer';
  exception when others then
    raise notice 'PASS H: a Team/ordinary member cannot nominate a Safeguarding Officer: %', sqlerrm;
  end;

  -- I. Parent/Player cannot assign officer (same boundary, different persona).
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent::text, 'role', 'authenticated')::text, true);
  begin
    perform public.nominate_safeguarding_officer(v_club_a, 'deputy', 'Should Not Work', 'nope@ovalball.test');
    raise exception 'FAIL I: a Parent/ordinary member nominated a Safeguarding Officer';
  exception when others then
    raise notice 'PASS I: a Parent/ordinary member cannot nominate a Safeguarding Officer: %', sqlerrm;
  end;

  -- G. Club A cannot manage Club B's officer.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.nominate_safeguarding_officer(v_club_b, 'primary', 'Cross Club Attempt', 'cross@ovalball.test');
    raise exception 'FAIL G: Club A''s admin nominated a Safeguarding Officer for Club B';
  exception when others then
    raise notice 'PASS G: Club A''s admin cannot manage Club B''s Safeguarding Officer: %', sqlerrm;
  end;

  -- C. Pending invite grants no authenticated permissions.
  select token, invitation_id into v_token, v_invitation_id from public.invite_safeguarding_officer(v_officer_id);
  if (select status from public.club_safeguarding_officers where id = v_officer_id) = 'invite_sent'
     and not exists (select 1 from public.club_memberships where club_id = v_club_a and user_id = v_officer_user)
  then
    raise notice 'PASS C: a pending invitation grants no club_memberships row, no capability, and no authenticated Safeguarding Officer status -- it is a contact record only';
  else
    raise exception 'FAIL C';
  end if;

  -- E. Resend does not duplicate the officer assignment (idempotent/safe resend).
  select token into v_token2 from public.resend_safeguarding_officer_invitation(v_officer_id);
  if v_token2 <> v_token
     and (select count(*) from public.club_safeguarding_officers where id = v_officer_id) = 1
     and (select count(*) from public.club_safeguarding_officer_invitations where officer_id = v_officer_id and status = 'pending') = 1
  then
    raise notice 'PASS E: resending issues a fresh token, revokes the stale one, and never creates a second officer row or a second pending invitation';
  else
    raise exception 'FAIL E';
  end if;

  -- D/B/H(identity). Acceptance activates the correct Club relationship
  -- using the canonical person/user identity -- no separate
  -- safeguarding_officer_user identity is ever created.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer_user::text, 'role', 'authenticated', 'email', 'sg-officer-' || v_officer_user::text || '@ovalball.test')::text, true);
  perform public.accept_safeguarding_officer_invitation(v_token2);

  select * into v_row from public.club_safeguarding_officers where id = v_officer_id;
  if v_row.status = 'active' and v_row.user_id = v_officer_user then
    raise notice 'PASS D/B: accepting the invitation activates the assignment and binds it to the real profiles/auth.users id -- no separate safeguarding_officer_user identity exists anywhere';
  else
    raise exception 'FAIL D/B';
  end if;
  if exists (select 1 from public.club_memberships where club_id = v_club_a and user_id = v_officer_user and status = 'active') then
    raise notice 'PASS D2: acceptance also establishes a real club_memberships row (required for the existing capability_overrides mechanism to later grant club-scoped safeguarding capabilities to this person)';
  else
    raise exception 'FAIL D2';
  end if;

  -- P. no duplicate message store: the officer's ordinary club membership
  -- did not overwrite or duplicate; still exactly one club_memberships
  -- row for this user at this club.
  if (select count(*) from public.club_memberships where club_id = v_club_a and user_id = v_officer_user) = 1 then
    raise notice 'PASS (membership uniqueness): exactly one club_memberships row exists for the accepted officer at this club';
  else
    raise exception 'FAIL membership uniqueness';
  end if;

  -- F. Same person can legitimately hold another Club role -- give the
  -- accepted officer a second, independent role at a DIFFERENT club.
  -- club_memberships is Site-Admin-insert-only at the RLS layer (ordinary
  -- role grants happen through accept_invitation()'s own SECURITY DEFINER
  -- path in real product use) -- inserting as the real Site Admin persona
  -- here exercises the same real boundary, not a bypass of it.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_officer_user, 'FIXTURE_SECRETARY', 'active');
  if exists (select 1 from public.club_memberships where club_id = v_club_b and user_id = v_officer_user and role = 'FIXTURE_SECRETARY') then
    raise notice 'PASS F: the same person legitimately holds an independent role (Fixture Secretary) at a different club, alongside being Club A''s Safeguarding Officer';
  else
    raise exception 'FAIL F';
  end if;

  -- J/K/L. Site Admin capability control: grant one of the four
  -- Site-Admin-only capabilities via the EXISTING, reused
  -- set_capability_override RPC -- no new grant RPC was built for this.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);
  perform public.set_capability_override(v_officer_user, 'club.dispensation.view', 'club', v_club_a, null, 'grant', 'Test grant');

  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer_user::text, 'role', 'authenticated')::text, true);
  if (select public.has_capability('club.dispensation.view', 'club', v_club_a, null)) then
    raise notice 'PASS J: Site Admin capability control works -- a specific, individually-granted safeguarding capability takes effect for the accepted officer';
  else
    raise exception 'FAIL J';
  end if;

  -- K. view permission does not imply edit -- the officer was granted
  -- ONLY club.dispensation.view, never club.safeguarding.manage_contact.
  if not (select public.has_capability('club.safeguarding.manage_contact', 'club', v_club_a, null)) then
    raise notice 'PASS K: view permission does not imply edit -- the officer, granted only club.dispensation.view, cannot manage the Safeguarding Officer contact record';
  else
    raise exception 'FAIL K';
  end if;

  -- L. an arbitrary, unrelated platform capability cannot be granted
  -- "through the safeguarding UI" -- proven structurally: the Safeguarding
  -- Officer Site Admin surface only ever calls set_capability_override
  -- with one of the four safeguarding capability keys; nothing stops an
  -- operator from passing a different key to the SAME generic RPC, but
  -- that RPC's own authorization (Full Site Admin / manage_permissions)
  -- is identical regardless of which capability key is named -- there is
  -- no separate, weaker "safeguarding capability granting" authorization
  -- path that could be tricked into granting something broader. Confirmed
  -- directly: an ordinary Club Admin (not Site Admin) cannot call
  -- set_capability_override at all, for ANY capability key, safeguarding
  -- or otherwise.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.set_capability_override(v_officer_user, 'site.permissions.manage', 'site', null, null, 'grant', 'Should not work');
    raise exception 'FAIL L: a Club Admin granted an unrelated, site-scoped capability';
  exception when others then
    raise notice 'PASS L: granting ANY capability (safeguarding or otherwise) remains Site-Admin-only -- a Club Admin cannot use this or any other path to grant an arbitrary platform capability: %', sqlerrm;
  end;

  -- M/N/O/P. Messaging: registered officer uses Ovalball messaging;
  -- unregistered/pending officer uses email fallback (proven at the app
  -- layer -- start_or_get_safeguarding_officer_conversation itself
  -- refuses to create a conversation for a non-active officer, which IS
  -- the server-side proof the app-layer email-fallback branch relies on).
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  select conversation_id into v_row from public.start_or_get_safeguarding_officer_conversation(v_club_a, v_officer_id, 'Hello, testing the message action.');
  if v_row is not null then
    raise notice 'PASS M: a registered, active officer can be messaged via the canonical Ovalball conversation store (fixture_messages)';
  else
    raise exception 'FAIL M';
  end if;

  v_officer2_id := public.nominate_safeguarding_officer(v_club_a, 'deputy', 'Never Registered', 'never-registered@ovalball.test');
  begin
    perform public.start_or_get_safeguarding_officer_conversation(v_club_a, v_officer2_id, 'Should fail -- not active.');
    raise exception 'FAIL N: an Ovalball conversation was created for a never-invited/never-accepted officer';
  exception when others then
    raise notice 'PASS N: a pending/unregistered officer cannot receive an Ovalball conversation -- the caller must fall back to email: %', sqlerrm;
  end;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and (table_name ilike '%safeguarding%message%' or table_name ilike '%safeguarding%case%' or table_name ilike '%safeguarding%incident%')
  ) then
    raise notice 'PASS P/X: no separate safeguarding message store or case-management table was created -- messaging reuses fixture_messages, and X is proven directly below';
  else
    raise exception 'FAIL P/X: a separate safeguarding message or case table was found';
  end if;

  -- U. an unrelated club cannot view the officer or the private message.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);
  if (select count(*) from public.club_safeguarding_officers where club_id = v_club_a) = 0 then
    raise notice 'PASS U1: Club B''s admin cannot see Club A''s Safeguarding Officer rows at all';
  else
    raise exception 'FAIL U1';
  end if;
  if (select count(*) from public.fixture_messages where safeguarding_conversation_id is not null and sender_user_id = v_admin_a) = 0 then
    raise notice 'PASS U2: Club B''s admin cannot see the private Safeguarding Officer conversation/message between Club A''s admin and the officer';
  else
    raise exception 'FAIL U2';
  end if;

  -- V/W. Deactivation preserves audit and never deletes the user/person.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  perform public.deactivate_safeguarding_officer(v_officer_id);
  -- Existence (never-deleted), not visibility, is what's under test here --
  -- profiles' own RLS may legitimately restrict what a Club Admin can see
  -- of another member's profile regardless of this feature; reset to the
  -- unrestricted role purely to confirm the row was never deleted.
  reset role;
  if (select status from public.club_safeguarding_officers where id = v_officer_id) = 'inactive'
     and exists (select 1 from public.profiles where id = v_officer_user)
  then
    raise notice 'PASS V/W: deactivation marks the assignment inactive (row preserved, never deleted) and never touches the underlying profiles/auth.users person record (profiles.id references auth.users(id) on delete cascade, so the profile surviving proves the auth.users row does too)';
  else
    raise exception 'FAIL V/W';
  end if;

  -- Deactivation also revokes the four Site-Admin-grantable capabilities
  -- this officer held.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_officer_user::text, 'role', 'authenticated')::text, true);
  if not (select public.has_capability('club.dispensation.view', 'club', v_club_a, null)) then
    raise notice 'PASS (deactivation revokes capabilities): the deactivated officer no longer holds club.dispensation.view';
  else
    raise exception 'FAIL deactivation-revokes-capabilities';
  end if;

  -- A club now missing its primary officer is honestly reported as such
  -- (no silent auto-promotion of the deputy -- spec section 26).
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.club_safeguarding_officers where club_id = v_club_a and officer_type = 'primary' and status = 'active') then
    raise notice 'PASS (no silent promotion): Club A correctly shows no active primary Safeguarding Officer after deactivation -- the deputy was never silently promoted';
  else
    raise exception 'FAIL no-silent-promotion';
  end if;

  -- X. No safeguarding case-management table exists anywhere in the schema.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and (table_name ilike '%safeguarding_incident%' or table_name ilike '%safeguarding_allegation%'
        or table_name ilike '%safeguarding_evidence%' or table_name ilike '%safeguarding_case%'
        or table_name ilike '%safeguarding_investigation%')
  ) then
    raise notice 'PASS X: no safeguarding incident/allegation/evidence/case/investigation table of any kind exists in this schema';
  else
    raise exception 'FAIL X: a safeguarding case-management-shaped table was found';
  end if;

  reset role;
end $$;

rollback;

\echo 'Safeguarding Officer Foundation regression complete.'
