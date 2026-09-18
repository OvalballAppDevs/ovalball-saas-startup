-- =====================================================================================================
-- THE DEFINER-RPC SESSION CONTRACT (Slice 6b.2a; Phase 2 D.2 / S6-9)
--
-- SECURITY DEFINER functions do not run RLS. That is the whole point of them, and it is also why the
-- RESTRICTIVE `session_ok_required` policy on 209 tables -- the thing that makes layer 1 authoritative
-- -- never protected them. Twenty-six browser-callable definer functions performed mutations while
-- authorising on `auth.uid()` alone, and `auth.uid()` reads a claim out of a token that stays
-- cryptographically valid after sign-out-everywhere, after suspension and after disablement.
--
-- WHAT THIS SUITE IS FOR, AND WHAT IT REFUSES TO ACCEPT AS EVIDENCE
--
-- "It threw something" is not a passing security assertion. Every refusal below is matched against the
-- EXACT refusal text of the session gate, and every one is paired with a positive control in which the
-- same call, with the same arguments, under a LIVE session, is shown NOT to produce that text -- it
-- either succeeds or is refused by its own original authority for its own original reason.
--
-- That pairing is the load-bearing part. Without it, a suite that asserts "refused" proves only that
-- the arguments were rubbish.
--
-- Deterministic and self-seeding.
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
  values (v,'RPC',p_label,p_email,(current_date - interval '34 years')::date,'ACTIVE')
  on conflict (id) do update set account_state = 'ACTIVE';
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.session_for(p_user uuid) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), 'aal1');
  return v;
end $$;

create or replace function pg_temp.as_session(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
end $$;

/**
 * Runs one call and reports what came back, so a refusal can be compared against an exact expected
 * string rather than against "something happened". Each call runs in its own subtransaction, so a
 * refusal cannot poison the rest of the run.
 */
create or replace function pg_temp.outcome(p_call text) returns text language plpgsql as $$
begin
  begin
    execute 'select ' || p_call;
    return '(no refusal)';
  exception when others then
    return sqlerrm;
  end;
end $$;

-- The one refusal text this contract adds. Anything else is a different refusal with a different cause.
create or replace function pg_temp.session_refusal() returns text language sql immutable as $$
  select 'Your session is no longer valid. Sign in again.'
$$;

do $$
declare
  v_tag   text := substr(gen_random_uuid()::text,1,8);
  v_user  uuid;
  v_other uuid;
  v_sess  uuid;
  v_calls text[];
  v_call  text;
  v_name  text;
  v_out   text;
  v_bad   int;
  v_bad_names text;
  v_n     int;
  v_prefs int;
  v_blocks int;
  v_deliv int;
  v_active timestamptz;
begin
  v_user  := pg_temp.person('Caller', 'rpc-'||v_tag||'@ovalball.test');
  v_other := pg_temp.person('Other',  'rpc-other-'||v_tag||'@ovalball.test');
  v_sess  := pg_temp.session_for(v_user);

  -- ===========================================================================================
  -- The twenty-five gated calls, each with arguments that name nothing real. That is deliberate:
  -- if the session gate is first, the arguments never get looked at, and the refusal text proves
  -- which check spoke.
  -- ===========================================================================================
  v_calls := array[
    $q$accept_guardian_invitation|public.accept_guardian_invitation('no-such-token-'||%s)$q$,
    $q$accept_site_admin_invitation|public.accept_site_admin_invitation('no-such-token-'||%s)$q$,
    $q$add_support_followup|public.add_support_followup(gen_random_uuid(), 'hello')$q$,
    $q$block_user|public.block_user(gen_random_uuid())$q$,
    $q$cancel_guardian_link_request|public.cancel_guardian_link_request(gen_random_uuid())$q$,
    $q$claim_disabled_email_suppression|public.claim_disabled_email_suppression('evt-'||%s,'occ-'||%s,'user')$q$,
    $q$claim_email_delivery|public.claim_email_delivery('evt-'||%s,'idem-'||%s,'occ-'||%s,'user')$q$,
    $q$claim_responsible_payer|public.claim_responsible_payer(gen_random_uuid(), gen_random_uuid())$q$,
    $q$exit_diagnostic_club|public.exit_diagnostic_club(gen_random_uuid())$q$,
    $q$mark_announcement_read|public.mark_announcement_read(gen_random_uuid())$q$,
    $q$mark_direct_conversation_read|public.mark_direct_conversation_read(gen_random_uuid())$q$,
    $q$record_billing_request|public.record_billing_request(gen_random_uuid(), gen_random_uuid(), 'a','b','c')$q$,
    $q$record_email_delivery_result|public.record_email_delivery_result(gen_random_uuid(), 'sent')$q$,
    $q$record_own_date_of_birth|public.record_own_date_of_birth((current_date + 1)::date, 'A', 'B')$q$,
    $q$record_session_version|public.record_session_version(1)$q$,
    $q$redeem_my_recovery_code|public.redeem_my_recovery_code('not-a-code')$q$,
    $q$request_to_join_club|public.request_to_join_club(gen_random_uuid(), gen_random_uuid())$q$,
    $q$respond_to_attendance|public.respond_to_attendance(gen_random_uuid(), gen_random_uuid(), 'ATTENDING')$q$,
    $q$respond_to_event_attendance|public.respond_to_event_attendance(gen_random_uuid(), gen_random_uuid(), 'ATTENDING')$q$,
    $q$respond_to_training_attendance|public.respond_to_training_attendance(gen_random_uuid(), gen_random_uuid(), 'ATTENDING')$q$,
    $q$set_notification_preference|public.set_notification_preference('no_such_topic_'||%s, true, true)$q$,
    $q$soft_delete_own_message|public.soft_delete_own_message(gen_random_uuid())$q$,
    $q$touch_last_active|public.touch_last_active()$q$,
    $q$unblock_user|public.unblock_user(gen_random_uuid())$q$,
    $q$withdraw_player_club_join_request|public.withdraw_player_club_join_request(gen_random_uuid())$q$
  ];

  perform pg_temp.check(array_length(v_calls,1) = 25,
    'RPC-00 the matrix covers all 25 gated functions (found '||array_length(v_calls,1)||')');

  -- ===========================================================================================
  -- A. LIVE, ACTIVE CALLER -- the positive control that makes every refusal below mean something.
  --    None of these may produce the session refusal. Each either succeeds or is turned away by
  --    its own original authority, which is exactly what must not change.
  -- ===========================================================================================
  perform pg_temp.as_session(v_user, v_sess);
  v_bad := 0; v_bad_names := '';
  foreach v_call in array v_calls loop
    v_name := substring(v_call from 1 for position('|' in v_call) - 1);
    v_out  := pg_temp.outcome(replace(substring(v_call from position('|' in v_call) + 1), '%s', quote_literal(v_tag)));
    if v_out = pg_temp.session_refusal() or v_out ~* 'syntax error|does not exist' then
      v_bad := v_bad + 1; v_bad_names := v_bad_names || v_name || '=>' || v_out || ' ';
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0,
    'RPC-01 A: with a LIVE session on an ACTIVE account, not one of the 25 is refused for session '
    'reasons -- the gate is additive and changed no existing authority ('||coalesce(nullif(v_bad_names,''),'none')||')');

  -- D. INVALID EXISTING AUTHORITY, LIVE SESSION -- still refused, and refused for the ORIGINAL reason.
  --    The same bogus arguments as above: the ones that carry a real authority check must still fail
  --    it, and must not be silently rescued or newly blamed on the session.
  perform pg_temp.check(
    pg_temp.outcome('public.accept_guardian_invitation('||quote_literal('no-such-token-'||v_tag)||')') = 'Invitation not found.',
    'RPC-02 D: a live session naming an invitation that does not exist is still refused by the '
    'invitation check, in its own words');
  perform pg_temp.check(
    pg_temp.outcome('public.add_support_followup(gen_random_uuid(), ''hello'')') = 'Support ticket not found.',
    'RPC-03 D: a live session naming somebody else''s support ticket is still refused by the ownership check');
  perform pg_temp.check(
    pg_temp.outcome('public.record_own_date_of_birth((current_date + 1)::date, ''A'', ''B'')')
      = 'A date of birth cannot be in the future.',
    'RPC-04 D: a live session supplying an impossible date is still refused by the validation, not by the gate');
  perform pg_temp.check(
    pg_temp.outcome('public.set_notification_preference('||quote_literal('no_such_topic_'||v_tag)||', true, true)')
      = 'Unknown notification category.',
    'RPC-05 D: a live session naming a topic that does not exist is still refused by the topic check');
  perform pg_temp.check(
    pg_temp.outcome('public.soft_delete_own_message(gen_random_uuid())') = 'Message not found.',
    'RPC-06 D: a live session naming a message that does not exist is still refused by the ownership check');

  -- A, observable: the calls that really do write, really do write.
  perform public.touch_last_active();
  select last_active_at into v_active from public.profiles where id = v_user;
  perform pg_temp.check(v_active is not null,
    'RPC-07 A: touch_last_active still writes under a live session (observed on the row, not inferred '
    'from the absence of an exception)');

  perform public.record_session_version(1);
  perform pg_temp.check(exists (select 1 from public.user_session_versions where user_id = v_user),
    'RPC-08 A: record_session_version still writes under a live session');

  perform public.block_user(v_other);
  perform pg_temp.check(
    exists (select 1 from public.user_message_blocks where blocker_user_id = v_user and blocked_user_id = v_other),
    'RPC-09 A: block_user still writes under a live session');
  perform public.unblock_user(v_other);
  perform pg_temp.check(
    exists (select 1 from public.user_message_blocks
             where blocker_user_id = v_user and blocked_user_id = v_other and lifted_at is not null),
    'RPC-10 A: unblock_user still writes under a live session');

  perform pg_temp.check(public.redeem_my_recovery_code('not-a-code') = false,
    'RPC-11 A: redeem_my_recovery_code still reaches its own one-time-code rule and answers false, '
    'rather than being turned away at the door');

  -- The state that must not move while the session is dead.
  select count(*) into v_prefs  from public.notification_preferences where user_id = v_user;
  select count(*) into v_blocks from public.user_message_blocks where blocker_user_id = v_user;
  select count(*) into v_deliv  from public.email_deliveries where idempotency_key like 'idem-'||v_tag||'%';
  select last_active_at into v_active from public.profiles where id = v_user;

  -- ===========================================================================================
  -- B. THE REVOKED SESSION. This is the original bypass, exactly as an attacker would hold it:
  --    the access token is untouched and still cryptographically valid, and `auth.uid()` still
  --    answers. Only the auth.sessions row is gone -- which is all "sign out everywhere" does.
  -- ===========================================================================================
  delete from auth.sessions where id = v_sess;
  v_bad := 0; v_bad_names := '';
  foreach v_call in array v_calls loop
    v_name := substring(v_call from 1 for position('|' in v_call) - 1);
    v_out  := pg_temp.outcome(replace(substring(v_call from position('|' in v_call) + 1), '%s', quote_literal(v_tag)));
    if v_out is distinct from pg_temp.session_refusal() then
      v_bad := v_bad + 1; v_bad_names := v_bad_names || v_name || '=>' || v_out || ' ';
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0,
    'RPC-12 B: all 25 refuse a REVOKED session -- a still-valid token whose session row is gone -- '
    'and every one of them refuses with the session gate''s own words ('||coalesce(nullif(v_bad_names,''),'none')||')');

  -- ...and nothing moved while it was refusing.
  perform pg_temp.check(
    (select count(*) from public.notification_preferences where user_id = v_user) = v_prefs
    and (select count(*) from public.user_message_blocks where blocker_user_id = v_user) = v_blocks
    and (select count(*) from public.email_deliveries where idempotency_key like 'idem-'||v_tag||'%') = v_deliv
    and (select last_active_at from public.profiles where id = v_user) is not distinct from v_active,
    'RPC-13 B: and the revoked run wrote nothing -- preferences, blocks, email deliveries and '
    'last_active_at are all exactly where they were');

  -- ===========================================================================================
  -- C. THE SUSPENDED, AND THEN DISABLED, ACCOUNT. The session row is live again: what is refused
  --    here is the ACCOUNT, which is a different question, and the one D-S6B-AUTO-10 settles.
  -- ===========================================================================================
  v_sess := pg_temp.session_for(v_user);
  perform pg_temp.as_session(v_user, v_sess);
  update public.profiles set account_state = 'SUSPENDED', state_reason = 'definer rpc contract fixture'
    where id = v_user;

  v_bad := 0; v_bad_names := '';
  foreach v_call in array v_calls loop
    v_name := substring(v_call from 1 for position('|' in v_call) - 1);
    v_out  := pg_temp.outcome(replace(substring(v_call from position('|' in v_call) + 1), '%s', quote_literal(v_tag)));
    if v_out is distinct from pg_temp.session_refusal() then
      v_bad := v_bad + 1; v_bad_names := v_bad_names || v_name || '=>' || v_out || ' ';
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0,
    'RPC-14 C: all 25 refuse a SUSPENDED account even though its session row is perfectly live '
    '('||coalesce(nullif(v_bad_names,''),'none')||')');

  update public.profiles set account_state = 'DISABLED' where id = v_user;
  v_bad := 0; v_bad_names := '';
  foreach v_call in array v_calls loop
    v_name := substring(v_call from 1 for position('|' in v_call) - 1);
    v_out  := pg_temp.outcome(replace(substring(v_call from position('|' in v_call) + 1), '%s', quote_literal(v_tag)));
    if v_out is distinct from pg_temp.session_refusal() then
      v_bad := v_bad + 1; v_bad_names := v_bad_names || v_name || '=>' || v_out || ' ';
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0,
    'RPC-15 C: all 25 refuse a DISABLED account too ('||coalesce(nullif(v_bad_names,''),'none')||')');

  perform pg_temp.check(
    (select count(*) from public.notification_preferences where user_id = v_user) = v_prefs
    and (select count(*) from public.user_message_blocks where blocker_user_id = v_user) = v_blocks
    and (select last_active_at from public.profiles where id = v_user) is not distinct from v_active,
    'RPC-16 C: and neither the suspended nor the disabled run wrote anything');

  -- POSITIVE CONTROL. Reinstate, and the same twenty-five stop refusing -- so RPC-14/15 measured the
  -- account state and not a fixture that was broken from the start.
  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  v_bad := 0; v_bad_names := '';
  foreach v_call in array v_calls loop
    v_name := substring(v_call from 1 for position('|' in v_call) - 1);
    v_out  := pg_temp.outcome(replace(substring(v_call from position('|' in v_call) + 1), '%s', quote_literal(v_tag)));
    if v_out = pg_temp.session_refusal() or v_out ~* 'syntax error|does not exist' then
      v_bad := v_bad + 1; v_bad_names := v_bad_names || v_name || '=>' || v_out || ' ';
    end if;
  end loop;
  perform pg_temp.check(v_bad = 0,
    'RPC-17 POSITIVE CONTROL: reinstating the account lets all 25 through the gate again '
    '('||coalesce(nullif(v_bad_names,''),'none')||')');

  -- ===========================================================================================
  -- THE DECLARED EXCEPTION. The public contact form is granted to anon on purpose, and gating it
  -- would refuse the people it exists for. It is named here so that "it is ungated" is a recorded
  -- decision with a test behind it, rather than something nobody got round to.
  -- ===========================================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  perform pg_temp.check(
    pg_temp.outcome('public.submit_public_support_ticket(''A Person'', ''someone-'||v_tag||'@example.com'', ''bug'', ''Subject'', ''Description'')')
      = '(no refusal)',
    'RPC-18 the declared public exception still works with NO session at all -- gating it would have '
    'been an outage on the contact form, not a win');

  -- ===========================================================================================
  -- NO SESSION AT ALL. Not revoked, not suspended -- simply nobody. The gate must still speak.
  -- ===========================================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  perform pg_temp.check(
    pg_temp.outcome('public.touch_last_active()') = pg_temp.session_refusal()
    and pg_temp.outcome('public.mark_direct_conversation_read(gen_random_uuid())') = pg_temp.session_refusal(),
    'RPC-19 the two LANGUAGE sql functions refuse an absent session as firmly as the plpgsql ones -- '
    'they carry the guard as their first statement rather than being quietly skipped');
end $$;

-- =====================================================================================================
-- THE ENROLMENT TRAP, IN THE DATABASE
--
-- `internal.session_ok()` folds `session_aal_ok()`. The moment an MFA enforcement group is switched on,
-- every person in it who has not enrolled fails it. That is correct for ordinary work and catastrophic
-- for exactly one function: `redeem_my_recovery_code` exists to rescue somebody who cannot reach their
-- authenticator, so gating it on the unqualified predicate would lock the door from the inside -- the
-- same shape that locked the platform owner out on 17 September.
--
-- So it, alone, passes p_allow_aal_elevation. This proves the distinction is real rather than declared:
-- under an enforced group at AAL1, the recovery function still works and its neighbours do not.
-- =====================================================================================================
do $$
declare
  v_tag  text := substr(gen_random_uuid()::text,1,8);
  v_user uuid;
  v_sess uuid;
  v_group text;
  v_had_policy boolean;
  v_from timestamptz;
  v_grace timestamptz;
begin
  v_user := pg_temp.person('Enforced', 'rpc-enf-'||v_tag||'@ovalball.test');
  v_sess := pg_temp.session_for(v_user);
  perform pg_temp.as_session(v_user, v_sess);

  -- Switch enforcement on for whichever group this person actually resolves to, rather than inventing
  -- a role for them: the property under test is "enforced and unenrolled", not which group does it.
  -- Nothing here touches the production policy -- the suite runs inside a transaction that is rolled back.
  select coalesce(s.enforcement_group, internal.derive_enforcement_group(v_user))
    into v_group
  from public.account_security_state s where s.user_id = v_user;
  v_group := coalesce(v_group, internal.derive_enforcement_group(v_user));

  -- Remember exactly what was there, so the fixture puts it back rather than leaving an enforcement
  -- group switched on for every assertion that follows. (It did, once, and the next block failed at
  -- its own setup -- which is the only reason that bug was visible at all.)
  select true, p.require_aal2_from, p.grace_until into v_had_policy, v_from, v_grace
  from public.mfa_enforcement_policy p where p.enforcement_group = v_group;

  insert into public.mfa_enforcement_policy (enforcement_group, require_aal2_from, grace_until, reason)
  values (v_group, now() - interval '1 day', now() - interval '1 day', 'definer rpc contract fixture')
  on conflict (enforcement_group) do update
    set require_aal2_from = now() - interval '1 day', grace_until = now() - interval '1 day';

  perform pg_temp.check(internal.mfa_enforced_for_group(v_group),
    'RPC-20 SETUP: enforcement is switched on for the group this person is in ('||v_group||')');
  perform pg_temp.check(internal.session_aal_ok() = false and internal.session_ok() = false,
    'RPC-21 SETUP: and at AAL1 under that group the canonical predicate refuses -- which is the whole '
    'hazard this assertion exists to measure');

  perform pg_temp.check(
    pg_temp.outcome('public.touch_last_active()') = pg_temp.session_refusal(),
    'RPC-22 an ordinary self-service function refuses an enforced-but-unenrolled session, exactly as '
    'every RESTRICTIVE table policy already would');

  perform pg_temp.check(
    pg_temp.outcome('public.redeem_my_recovery_code(''not-a-code'')') = '(no refusal)',
    'RPC-23 but redeem_my_recovery_code still reaches its own rule -- the one function whose purpose is '
    'to rescue somebody who cannot produce a second factor is not refused for failing to produce one');

  -- ...and the stand-down is only about assurance. It is not a way round revocation or suspension.
  update public.profiles set account_state = 'SUSPENDED' where id = v_user;
  perform pg_temp.check(
    pg_temp.outcome('public.redeem_my_recovery_code(''not-a-code'')') = pg_temp.session_refusal(),
    'RPC-24 and the stand-down does NOT survive suspension -- it stands down the assurance question '
    'only, never the account or the session');

  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    pg_temp.outcome('public.redeem_my_recovery_code(''not-a-code'')') = pg_temp.session_refusal(),
    'RPC-25 nor revocation -- a token whose session row is gone cannot redeem a recovery code and strip '
    'the account''s second factor');

  -- Put the enforcement policy back exactly as it was found.
  if coalesce(v_had_policy, false) then
    update public.mfa_enforcement_policy
       set require_aal2_from = v_from, grace_until = v_grace
     where enforcement_group = v_group;
  else
    delete from public.mfa_enforcement_policy where enforcement_group = v_group;
  end if;
  perform pg_temp.check(not internal.mfa_enforced_for_group(v_group),
    'RPC-26 the fixture restored the enforcement policy it borrowed, so nothing after this runs under '
    'a group it did not ask for');
end $$;

-- =====================================================================================================
-- THE INVITATION BOUNDARY IS STILL MANDATORY
--
-- The one function in the set that touches another person's authority is `accept_guardian_invitation`,
-- and the authorisation is explicit that adding a session check must not widen it. So the original
-- boundary -- a PENDING invitation, matched by token, and an EXACT email match against the signed-in
-- account -- is asserted here on a real invitation rather than on a token that names nothing.
--
-- Without this, a mutant that keeps the session gate and drops the email match would survive, which is
-- precisely the "preserved session check, bypassed original condition" case the campaign asks for.
-- =====================================================================================================
do $$
declare
  v_tag    text := substr(gen_random_uuid()::text,1,8);
  v_owner  uuid;
  v_other  uuid;
  v_sess   uuid;
  v_dir    uuid;
  v_club   uuid;
  v_team   uuid;
  v_token  text := 'rpc-inv-'||substr(gen_random_uuid()::text,1,12);
  v_inv    uuid;
  v_out    text;
begin
  v_owner := pg_temp.person('Invitee',  'rpc-inv-'||v_tag||'@ovalball.test');
  v_other := pg_temp.person('Stranger', 'rpc-str-'||v_tag||'@ovalball.test');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RPC Contract RUFC '||v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rpc-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rpc-'||v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'rpc-u12-'||v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;

  insert into public.guardian_invitations (club_id, team_id, invited_email, token, invited_by_user_id)
  values (v_club, v_team, 'rpc-inv-'||v_tag||'@ovalball.test', v_token, v_other)
  returning id into v_inv;

  -- A live session belonging to SOMEBODY ELSE, holding the real token.
  v_sess := pg_temp.session_for(v_other);
  perform pg_temp.as_session(v_other, v_sess);
  perform pg_temp.check(
    pg_temp.outcome('public.accept_guardian_invitation('||quote_literal(v_token)||')')
      = 'This invitation was sent to a different email address.',
    'RPC-32 the exact-email boundary still refuses a live session holding a real token that was not '
    'sent to them -- the session gate was added in front of that check, never instead of it');
  perform pg_temp.check(
    (select status from public.guardian_invitations where id = v_inv) = 'pending',
    'RPC-33 and the refused attempt did not consume the invitation');

  -- The revoked session of the RIGHT person: refused by the gate, and still without consuming it.
  v_sess := pg_temp.session_for(v_owner);
  perform pg_temp.as_session(v_owner, v_sess);
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    pg_temp.outcome('public.accept_guardian_invitation('||quote_literal(v_token)||')') = pg_temp.session_refusal(),
    'RPC-34 and the rightful invitee, holding a revoked session, is refused by the gate');
  perform pg_temp.check(
    (select status from public.guardian_invitations where id = v_inv) = 'pending',
    'RPC-35 with the invitation still pending -- a failed session check must never spend it');

  -- POSITIVE CONTROL: the rightful invitee with a live session accepts it, exactly as before.
  v_sess := pg_temp.session_for(v_owner);
  perform pg_temp.as_session(v_owner, v_sess);
  -- Two statements, not one expression: SQL does not promise left-to-right evaluation inside an AND,
  -- so reading the status in the same expression that performs the acceptance read it too early and
  -- reported a failure that had not happened.
  v_out := pg_temp.outcome('public.accept_guardian_invitation('||quote_literal(v_token)||')');
  perform pg_temp.check(
    v_out = '(no refusal)' and (select status from public.guardian_invitations where id = v_inv) = 'accepted',
    'RPC-36 POSITIVE CONTROL: the rightful invitee with a live session still accepts it -- so RPC-32/34 '
    'measured the boundaries and not an invitation that was broken from the start');
end $$;

-- =====================================================================================================
-- TOCTOU. The authority decision has to happen at the mutation, from database state, not from something
-- the application checked a moment earlier. These two assertions are what makes that concrete: the
-- revocation and the suspension land in the SAME transaction as the call that follows them, so an
-- application check that had already passed cannot help.
-- =====================================================================================================
do $$
declare
  v_tag  text := substr(gen_random_uuid()::text,1,8);
  v_user uuid;
  v_sess uuid;
  v_before timestamptz;
begin
  v_user := pg_temp.person('Race', 'rpc-race-'||v_tag||'@ovalball.test');
  v_sess := pg_temp.session_for(v_user);
  perform pg_temp.as_session(v_user, v_sess);

  -- The application has just decided this request may proceed.
  perform public.touch_last_active();
  select last_active_at into v_before from public.profiles where id = v_user;
  perform pg_temp.check(v_before is not null, 'RPC-27 SETUP: the request was authorised a moment ago');

  -- An administrator suspends the account while the request is still in flight.
  update public.profiles set account_state = 'SUSPENDED' where id = v_user;
  perform pg_temp.check(
    pg_temp.outcome('public.touch_last_active()') = pg_temp.session_refusal(),
    'RPC-28 RACE: suspension landing mid-request is seen by the very next statement -- the authority is '
    'read at the mutation, so a request cannot finish under authority it has already lost');

  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    pg_temp.outcome('public.touch_last_active()') = pg_temp.session_refusal(),
    'RPC-29 RACE: and sign-out-everywhere landing mid-request takes effect at the next statement rather '
    'than when the access token happens to expire');
end $$;

-- =====================================================================================================
-- THE ARCHAEOLOGY, RE-RUN AS A PERMANENT TEST
--
-- The migration checks this once, when it is applied. This checks it for ever: the day somebody adds a
-- browser-callable SECURITY DEFINER function that mutates and does not reach the gate, this goes red
-- and names it. It is a fixpoint over the call graph rather than a grep, so reaching the gate through a
-- helper counts, and so that a function cannot be declared safe by being written in a different style.
-- =====================================================================================================
do $$
declare v_count int; v_names text;
begin
  with recursive allfn as (
    select ((n.nspname||'.'||p.proname)::text collate "default") as qname, p.prosrc, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','internal') and p.prokind = 'f'
  ),
  seeds as (
    select unnest(array[
      'internal.session_ok','internal.session_live','internal.session_live_only',
      'internal.capability_decision','internal.can','internal.has_site_capability',
      'internal.club_ids_with','internal.is_account_active','internal.session_aal_ok',
      'internal.require_live_session'
    ]) as fn
  ),
  edges as (
    select a.qname as caller, b.qname as callee
    from allfn a join allfn b
      on a.oid <> b.oid
     and a.prosrc ~ ('(^|[^a-zA-Z0-9_.])' || replace(b.qname,'.','\.') || '\s*\(')
  ),
  closure as (
    select fn as qname from seeds
    union
    select e.caller from edges e join closure c on e.callee = c.qname
  )
  select count(*), coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into v_count, v_names
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
    and (has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('anon', p.oid, 'execute'))
    and p.prosrc ~* '(^|[^a-zA-Z_])(insert|update|delete|merge)\s'
    and ('public.'||p.proname) not in (select qname from closure)
    and p.proname <> 'submit_public_support_ticket';

  perform pg_temp.check(v_count = 0,
    'RPC-30 S6-9 CLOSURE: no browser-callable SECURITY DEFINER mutation path bypasses the canonical '
    'session gate, bar the one declared public exception ('||coalesce(nullif(v_names,''),'none')||')');
end $$;

-- The stand-down stays narrow. One caller, named, for ever.
do $$
declare v_users text;
begin
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '(nobody)')
    into v_users
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~ 'require_live_session\s*\(\s*true\s*\)';
  perform pg_temp.check(v_users = 'redeem_my_recovery_code',
    'RPC-31 the assurance stand-down is used by redeem_my_recovery_code and nothing else (found: '||v_users||')');
end $$;

rollback;
