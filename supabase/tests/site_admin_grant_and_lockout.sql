-- =====================================================================================================
-- THE TWO-PERSON SITE ADMIN GRANT, AND THE LOCKOUT GUARD (Identity/Auth Slice 7c; Phase 2 AN-3, AH, AI)
--
-- Deterministic and self-seeding.
--
-- The claim: nobody becomes a Site Admin because one person decided so. Before Slice 7c there were
-- three ways for one person to do it alone -- write the table, issue a site_admin_invitation, or issue
-- a Slice 5 SITE_ADMIN invitation -- so most of this suite is about the doors, not the rule.
--
-- Every refusal has a positive control. A two-person rule that refuses everybody is indistinguishable
-- from a broken grant, and the refusals below would all pass against one.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'SAG',p_label,p_email,(current_date - interval '36 years')::date,'ACTIVE');
  return v;
end $$;

-- site_admins is no longer writable by any browser role, so the fixture writes it as the owner. That
-- is the harness admitting what it is: seeding state, not exercising the path under test.
create or replace function pg_temp.admin(p_user uuid, p_profile text) returns void language plpgsql as $$
begin
  insert into public.site_admins (user_id, status, profile_key)
  values (p_user, 'active', p_profile)
  on conflict (user_id) do update set status='active', profile_key=excluded.profile_key;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin
    set local role authenticated;
    execute p_sql;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_a uuid; v_b uuid; v_ro uuid; v_target uuid; v_other uuid;
  v_req uuid; v_req2 uuid; v_rc text; v_last uuid;
begin
  v_a      := pg_temp.person('AdminA','sag-a-'||v_tag||'@ovalball.test');
  v_b      := pg_temp.person('AdminB','sag-b-'||v_tag||'@ovalball.test');
  v_ro     := pg_temp.person('ReadOnly','sag-ro-'||v_tag||'@ovalball.test');
  v_target := pg_temp.person('Target','sag-t-'||v_tag||'@ovalball.test');
  v_other  := pg_temp.person('Other','sag-o-'||v_tag||'@ovalball.test');
  perform pg_temp.admin(v_a,'SITE_FULL');
  perform pg_temp.admin(v_b,'SITE_FULL');
  perform pg_temp.admin(v_ro,'SITE_RO');

  -- =============================================================================================
  -- SAG-01..03  THE DOORS. The rule lives in a SECURITY DEFINER function, so it is worth exactly as
  -- much as the table permissions underneath it.
  -- =============================================================================================
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.site_admins','INSERT')
    and not has_table_privilege('authenticated','public.site_admins','UPDATE')
    and not has_table_privilege('authenticated','public.site_admins','DELETE'),
    'SAG-01 no browser role can write public.site_admins at all');
  perform pg_temp.check(
    not exists (select 1 from pg_policies where tablename='site_admins' and cmd in ('INSERT','UPDATE','DELETE')),
    'SAG-01b and no write policy survives that would grant it back');
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.site_admin_invitations','INSERT'),
    'SAG-02 issuing a Site Admin invitation is no longer a single-handed route either');
  perform pg_temp.check(
    not has_function_privilege('authenticated','internal.apply_site_admin_grant(uuid,text)','EXECUTE'),
    'SAG-03 the gate itself is not callable from a browser');

  -- =============================================================================================
  -- SAG-04..08  THE RULE.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_request_site_admin_grant(%L,''SITE_SUPPORT'',''asking for a colleague to get support access'')', v_target)) = '42501',
    'SAG-04 a Read Only Site Admin cannot even ask for somebody to be made an administrator');

  perform pg_temp.check(
    pg_temp.try_as(v_a, format('select public.site_request_site_admin_grant(%L,''SITE_SUPPORT'',''they are taking over support cover from March'')', v_target)) = 'OK',
    'SAG-05 POSITIVE CONTROL: a Full Site Admin can raise a grant request');
  select id into v_req from public.site_admin_grant_requests where target_user_id = v_target and state = 'PENDING';
  perform pg_temp.check(v_req is not null, 'SAG-05b and it is recorded as PENDING, not applied');
  perform pg_temp.check(
    not exists (select 1 from public.site_admins where user_id = v_target and status = 'active'),
    'SAG-05c asking is not granting -- nobody became an administrator');

  perform pg_temp.check(
    pg_temp.try_as(v_a, format('select public.site_approve_site_admin_grant(%L,''approving the request I raised myself'')', v_req)) = '42501',
    'SAG-06 the administrator who asked cannot be the one who approves');
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_approve_site_admin_grant(%L,''read only trying to approve a grant'')', v_req)) = '42501',
    'SAG-07 nor can somebody without site.admins.manage');

  -- POSITIVE CONTROL. Without this every refusal above is satisfied by a grant that never works.
  perform pg_temp.check(
    pg_temp.try_as(v_b, format('select public.site_approve_site_admin_grant(%L,''agreed, they are taking over support cover'')', v_req)) = 'OK',
    'SAG-08 POSITIVE CONTROL: a SECOND Full Site Admin CAN approve it');
  perform pg_temp.check(
    exists (select 1 from public.site_admins where user_id = v_target and status = 'active' and profile_key = 'SITE_SUPPORT'),
    'SAG-08b and only then does the person actually become a Site Admin');
  perform pg_temp.check(
    (select state from public.site_admin_grant_requests where id = v_req) = 'CONSUMED',
    'SAG-08c the approval is consumed, so it cannot be replayed into a second grant');
  perform pg_temp.check(
    (select count(*) from public.security_events
      where subject_user_id = v_target
        and event_type in ('site_admin.grant_requested','site_admin.grant_approved','site_admin.granted')) >= 3,
    'SAG-08d and the ask, the approval and the grant are each on the record');

  -- =============================================================================================
  -- SAG-09  The other two doors, now that there is no approved request left to consume.
  -- =============================================================================================
  perform pg_temp.check(
    (select count(*) from public.site_admin_grant_requests
      where target_user_id = v_other and state = 'APPROVED') = 0,
    'SAG-09 (precondition) there is no approved grant waiting for the second person');
  begin
    perform internal.apply_site_admin_grant(v_other, 'SITE_FULL');
    v_rc := 'OK';
  exception when others then get stacked diagnostics v_rc = returned_sqlstate;
  end;
  perform pg_temp.check(v_rc = '42501',
    'SAG-09b the gate refuses a grant that no second administrator approved, whoever is calling it');

  -- =============================================================================================
  -- SAG-10  Self-approval by the target, which the table also forbids by CHECK.
  -- =============================================================================================
  perform pg_temp.admin(v_target,'SITE_FULL');
  perform pg_temp.check(
    pg_temp.try_as(v_a, format('select public.site_request_site_admin_grant(%L,''SITE_FULL'',''asking for myself to be made full'')', v_a)) = '42501',
    'SAG-10 an administrator cannot raise a request naming themselves');

  -- =============================================================================================
  -- SAG-11  Revocation takes ONE administrator, deliberately, and ends the session immediately.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_revoke_site_admin(%L,''read only attempting a revocation'')', v_target)) = '42501',
    'SAG-11 a Read Only Site Admin cannot revoke anybody');
  perform pg_temp.check(
    pg_temp.try_as(v_a, format('select public.site_revoke_site_admin(%L,''they have left the organisation this week'')', v_target)) = 'OK',
    'SAG-12 POSITIVE CONTROL: ONE Full Site Admin can revoke -- taking authority away is the safe direction');
  perform pg_temp.check(
    (select status from public.site_admins where user_id = v_target) = 'revoked',
    'SAG-12b and it took effect');

  -- =============================================================================================
  -- SAG-13  THE LOCKOUT GUARD. Ovalball must never be left with no recoverable administrator.
  --
  -- Every other Full Site Admin in this database is revoked first, so that the last one really is the
  -- last -- the guard counts rows, and a test that leaves three of them standing proves nothing. All
  -- of it rolls back.
  -- =============================================================================================
  select user_id into v_last from public.site_admins
   where status = 'active' and profile_key = 'SITE_FULL' order by granted_at limit 1;
  update public.site_admins set status = 'revoked'
   where status = 'active' and profile_key = 'SITE_FULL' and user_id <> v_last;
  perform pg_temp.check(
    (select count(*) from public.site_admins where status='active' and profile_key='SITE_FULL') = 1,
    'SAG-13 (precondition) exactly one Full Site Admin is left');

  begin
    update public.site_admins set status = 'revoked' where user_id = v_last;
    v_rc := 'OK';
  exception when others then v_rc := 'REFUSED';
  end;
  perform pg_temp.check(v_rc = 'REFUSED',
    'SAG-13b the last Full Site Admin cannot be revoked -- Ovalball would have no way back in');
  begin
    delete from public.site_admins where user_id = v_last;
    v_rc := 'OK';
  exception when others then v_rc := 'REFUSED';
  end;
  perform pg_temp.check(v_rc = 'REFUSED',
    'SAG-13c nor deleted, which is the same lockout by another verb');
  begin
    update public.site_admins set profile_key = 'SITE_RO' where user_id = v_last;
    v_rc := 'OK';
  exception when others then v_rc := 'REFUSED';
  end;
  perform pg_temp.check(v_rc = 'REFUSED',
    'SAG-13d nor quietly demoted to Read Only, which is how a lockout happens without anybody revoking anything');

  -- =============================================================================================
  -- SAG-14  AN INVITATION THAT CANNOT YET BE HONOURED IS NOT SPENT.
  --
  -- Production holds a Site Admin invitation issued before this rule existed. It now confers nothing
  -- until a second administrator approves, which is deliberate. What must not happen is the link
  -- marking itself accepted on the way to conferring nothing -- the invitee would be told it worked,
  -- the sender would be told it was accepted, and the invitation could never be tried again.
  -- =============================================================================================
  declare v_inv uuid; v_tok text; v_rc2 text; v_invitee uuid;
  begin
    v_invitee := pg_temp.person('Invitee','sag-inv-'||v_tag||'@ovalball.test');
    v_tok := 'sag-token-'||v_tag;
    insert into public.site_admin_invitations (invited_email, admin_role, token, status, expires_at, invited_by)
    values ('sag-inv-'||v_tag||'@ovalball.test', 'full', v_tok, 'pending', now() + interval '7 days', v_a)
    returning id into v_inv;

    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_invitee, 'role', 'authenticated',
                         'email', 'sag-inv-'||v_tag||'@ovalball.test')::text, true);
    begin
      set local role authenticated;
      perform public.accept_site_admin_invitation(v_tok);
      v_rc2 := 'OK';
    exception when others then get stacked diagnostics v_rc2 = returned_sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims','', true);

    perform pg_temp.check(v_rc2 = '42501',
      'SAG-14 a Site Admin invitation alone no longer grants anything');
    perform pg_temp.check(
      not exists (select 1 from public.site_admins where user_id = v_invitee and status = 'active'),
      'SAG-14b and the invitee did not become a Site Admin');
    perform pg_temp.check(
      (select status from public.site_admin_invitations where id = v_inv) = 'pending',
      'SAG-14c and the invitation is STILL PENDING -- it was not spent on an attempt that conferred nothing');
    -- Deliberately NOT asserting that the attempt was recorded. The refusal aborts the transaction,
    -- so nothing written on the way to it survives -- which is why the handler in
    -- accept_site_admin_invitation does not pretend to write anything. This assertion exists to stop
    -- somebody adding that emit back believing it works.
    perform pg_temp.check(
      not exists (select 1 from public.security_events
                   where subject_user_id = v_invitee and event_type like 'site_admin.%'),
      'SAG-14d no site_admin event was recorded, because a refused transaction records nothing -- the
       handler does not pretend otherwise, and this assertion stops the pretence being added back');
  end;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
