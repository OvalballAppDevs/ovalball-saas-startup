-- Manual verification for Partner Club "Invite to Ovalball"
-- (20260917000000_partner_club_invitations). NOT a migration -- run AFTER
-- permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/partner_club_invitations.sql
--
-- Self-contained: a dedicated inviting club + a dedicated unclaimed
-- directory entry, never Burnley/Rossendale, so nothing here collides
-- with any other test file's own partnership/claim fixtures.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99710000-0000-0000-0000-0000000d0001', 'Invite Test Inviting RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'invite-test-inviting-99700000'),
    ('99710000-0000-0000-0000-0000000d0002', 'Invite Test Unclaimed RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'invite-test-unclaimed-99700000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-0000000d0001', 'invite-test-inviting-99700000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99710000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.invitetest.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99710000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.invitetest.claimant@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values
    ('99710000-0000-0000-0000-000000000101', 'Test', 'InviteAdmin', 'test.invitetest.admin@ovalball.local'),
    ('99710000-0000-0000-0000-000000000201', 'Test', 'InviteClaimant', 'test.invitetest.claimant@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('99710000-0000-0000-0000-000000000102', '99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-000000000101', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. A Club Admin of the inviting club can create an invitation for a
--    genuinely unclaimed directory club.
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99710000-0000-0000-0000-000000000101","role":"authenticated"}';

  select public.create_partner_invitation(
    '99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-0000000d0002', 'Jane Contact', 'jane@example.com'
  ) into v_id;

  if v_id is not null then
    raise notice 'PASS 1: Club Admin can create an invitation to an unclaimed directory club';
  else
    raise notice 'FAIL 1: create_partner_invitation returned null';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. A second invitation to the SAME directory club from the SAME
--    inviting club, while the first is still pending, is refused
--    (idempotency).
-- ------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99710000-0000-0000-0000-000000000101","role":"authenticated"}';

  begin
    perform public.create_partner_invitation(
      '99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-0000000d0002', 'Jane Contact', 'jane@example.com'
    );
    raise notice 'FAIL 2: a duplicate pending invitation was accepted';
  exception
    when others then
      raise notice 'PASS 2: a duplicate pending invitation to the same club is refused (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- 3. Inviting a club that is ALREADY claimed/active is refused.
-- ------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99710000-0000-0000-0000-000000000101","role":"authenticated"}';

  begin
    perform public.create_partner_invitation(
      '99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-0000000d0001', 'Jane Contact', 'jane@example.com'
    );
    raise notice 'FAIL 3: inviting an already-claimed club was accepted';
  exception
    when others then
      raise notice 'PASS 3: inviting an already-claimed club is refused (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- 4. A user with no authority at the inviting club cannot create an
--    invitation on its behalf.
-- ------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99710000-0000-0000-0000-000000000201","role":"authenticated"}';

  begin
    perform public.create_partner_invitation(
      '99710000-0000-0000-0000-0000000c0001', '99710000-0000-0000-0000-0000000d0002', 'Jane Contact', 'jane@example.com'
    );
    raise notice 'FAIL 4: an unrelated user created an invitation for a club they do not manage';
  exception
    when others then
      raise notice 'PASS 4: an unrelated user cannot create an invitation for a club they do not manage (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- 5/6/7. Reconciliation: when the invited directory club is genuinely
--         claimed (via approve_club_claim), the pending invitation is
--         marked accepted and a real, PENDING club_partnerships row is
--         created between the two clubs -- never auto-active, so the
--         newly-joined club still explicitly accepts it themselves.
-- ------------------------------------------------------------
do $$
declare
  v_claim_id uuid;
  v_new_club_id uuid;
  v_inv_status text;
  v_partnership_id uuid;
  v_partnership_status text;
begin
  insert into public.club_claims (id, directory_id, claimant_user_id, claimed_role, authority_declaration, status)
  values ('99710000-0000-0000-0000-000000000301', '99710000-0000-0000-0000-0000000d0002', '99710000-0000-0000-0000-000000000201', 'Club Secretary', 'I am the club secretary.', 'pending')
  on conflict (id) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    select id into v_claim_id from public.club_claims where id = '99710000-0000-0000-0000-000000000301';
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select public.approve_club_claim(v_claim_id) into v_new_club_id;
  reset role;

  if v_new_club_id is null then
    raise notice 'FAIL 5/6/7: approve_club_claim did not return a club id';
  else
    select status into v_inv_status from public.club_ovalball_invitations
    where inviting_club_id = '99710000-0000-0000-0000-0000000c0001' and club_directory_id = '99710000-0000-0000-0000-0000000d0002';

    if v_inv_status = 'accepted' then
      raise notice 'PASS 5: the pending invitation is marked accepted once the invited club is claimed';
    else
      raise notice 'FAIL 5: invitation status is % after claim approval, expected accepted', v_inv_status;
    end if;

    select resulting_partnership_id into v_partnership_id from public.club_ovalball_invitations
    where inviting_club_id = '99710000-0000-0000-0000-0000000c0001' and club_directory_id = '99710000-0000-0000-0000-0000000d0002';

    if v_partnership_id is not null then
      select status into v_partnership_status from public.club_partnerships where id = v_partnership_id;
      if v_partnership_status = 'pending' then
        raise notice 'PASS 6: reconciliation creates a real, still-PENDING club_partnerships row (never auto-active)';
      else
        raise notice 'FAIL 6: resulting partnership status is %, expected pending', v_partnership_status;
      end if;

      if exists(
        select 1 from public.club_partnerships
        where id = v_partnership_id
          and ((requesting_club_id = '99710000-0000-0000-0000-0000000c0001' and partner_club_id = v_new_club_id)
            or (requesting_club_id = v_new_club_id and partner_club_id = '99710000-0000-0000-0000-0000000c0001'))
      ) then
        raise notice 'PASS 7: the resulting partnership genuinely links the inviting club and the newly-claimed club';
      else
        raise notice 'FAIL 7: resulting partnership does not link the expected two clubs';
      end if;
    else
      raise notice 'FAIL 6/7: no resulting_partnership_id recorded on the reconciled invitation';
    end if;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. Reconciliation is idempotent: re-approving is impossible (claim is
--    no longer pending), but calling the internal reconcile function a
--    second time directly for the same pair must not create a SECOND
--    partnership row.
-- ------------------------------------------------------------
do $$
declare
  v_new_club_id uuid;
  v_partnership_count integer;
begin
  select id into v_new_club_id from public.clubs where directory_id = '99710000-0000-0000-0000-0000000d0002';

  perform internal.reconcile_partner_invitations('99710000-0000-0000-0000-0000000d0002', v_new_club_id);

  select count(*) into v_partnership_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99710000-0000-0000-0000-0000000c0001'::uuid, v_new_club_id)
    and greatest(requesting_club_id, partner_club_id) = greatest('99710000-0000-0000-0000-0000000c0001'::uuid, v_new_club_id)
    and status <> 'revoked';

  if v_partnership_count = 1 then
    raise notice 'PASS 8: re-running reconciliation for the same pair does not create a duplicate partnership';
  else
    raise notice 'FAIL 8: % non-revoked partnerships exist for the pair after re-running reconciliation, expected 1', v_partnership_count;
  end if;
end $$;
