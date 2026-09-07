-- Email Communications Foundation: policy, idempotency and authorization.
--
-- The application half of this system (recipient resolution, templates,
-- provider) is TypeScript and is covered by its own tests. What lives here
-- are the invariants the DATABASE has to hold whatever the app does, because
-- an app-layer rule is only as good as the last person who remembered it.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Email Communications Foundation ==='

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid;
  v_delivery uuid; v_second uuid;
  v_count int;
  v_text text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site, 'ecf-site-' || v_site::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin, 'ecf-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site, 'ECF', 'Site', 'ecf-site-' || v_site::text || '@ovalball.test'),
    (v_admin, 'ECF', 'Admin', 'ecf-admin-' || v_admin::text || '@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'ECF Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ecf-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir, 'ecf-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');

  -- =================================================================
  -- A. The catalogue is a controlled vocabulary
  -- =================================================================
  select count(*) into v_count from public.email_events;
  if v_count >= 10 then
    raise notice 'PASS 1 (A): the email event catalogue is seeded (% events)', v_count;
  else
    raise exception 'FAIL 1 (A): expected the catalogue to be seeded, found %', v_count;
  end if;

  begin
    insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
    values ('made_up_event', null, 'NOT_A_REAL_CLASSIFICATION', 'club_invitation', 'x');
    raise exception 'FAIL 2 (A): an unknown classification was accepted';
  exception when check_violation then
    raise notice 'PASS 2 (A): an unknown classification is refused';
  end;

  begin
    insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
    values ('made_up_event', null, 'OPTIONAL_OPERATIONAL', 'club_invitation', 'x');
    raise exception 'FAIL 3 (A): a topic-scoped event with no topic was accepted';
  exception when check_violation then
    raise notice 'PASS 3 (A): a non-identity event MUST name a topic, so preference can be consulted';
  end;

  begin
    insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
    values ('made_up_event', 'messages', 'TRANSACTIONAL_IDENTITY', 'club_invitation', 'x');
    raise exception 'FAIL 4 (A): an identity event was allowed to claim a topic';
  exception when check_violation then
    raise notice 'PASS 4 (A): an identity event cannot claim a topic -- its recipient has no account to hold a preference';
  end;

  begin
    insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
    values ('made_up_event', null, 'TRANSACTIONAL_IDENTITY', 'anything_i_like', 'x');
    raise exception 'FAIL 5 (A): an unknown recipient resolver was accepted';
  exception when check_violation then
    raise notice 'PASS 5 (A): recipient_kind is a controlled vocabulary -- no ad-hoc resolver';
  end;

  -- Safeguarding must never be gated on a preference a marketing checkbox
  -- could switch off.
  select classification into v_text from public.email_events where event_key = 'safeguarding_officer_message';
  if v_text = 'TRANSACTIONAL_IDENTITY' then
    raise notice 'PASS 6 (A): the safeguarding fallback is identity-scoped, so no preference can suppress it';
  else
    raise exception 'FAIL 6 (A): the safeguarding fallback is classified %, which a preference could gate', v_text;
  end if;

  select count(*) into v_count from public.email_events where classification = 'MARKETING';
  if v_count = 0 then
    raise notice 'PASS 7 (A): no marketing classification exists in this pipeline -- it is a transactional sender';
  else
    raise exception 'FAIL 7 (A): a marketing event appeared in the transactional catalogue';
  end if;

  -- =================================================================
  -- B. Idempotency
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);

  select public.claim_email_delivery(
    'club_invitation', 'ecf-test-key-1', 'club_invitation', null,
    'ecf-recipient@ovalball.test', v_club, 'Test subject'
  ) into v_delivery;
  if v_delivery is not null then
    raise notice 'PASS 8 (B): a first claim on an occurrence returns a delivery id';
  else
    raise exception 'FAIL 8 (B): the first claim returned nothing';
  end if;

  select public.claim_email_delivery(
    'club_invitation', 'ecf-test-key-1', 'club_invitation', null,
    'ecf-recipient@ovalball.test', v_club, 'Test subject'
  ) into v_second;
  if v_second is null then
    raise notice 'PASS 9 (B): a REPEAT claim on the same occurrence returns nothing -- a retry cannot send twice';
  else
    raise exception 'FAIL 9 (B): a repeat claim minted a second delivery';
  end if;

  select count(*) into v_count from public.email_deliveries where idempotency_key = 'ecf-test-key-1';
  if v_count = 1 then
    raise notice 'PASS 10 (B): exactly one delivery row exists for the occurrence';
  else
    raise exception 'FAIL 10 (B): % rows for one occurrence', v_count;
  end if;

  -- A genuinely different occurrence is NOT suppressed. Idempotency must
  -- stop retries, never legitimate later messages.
  select public.claim_email_delivery(
    'club_invitation', 'ecf-test-key-2', 'club_invitation', null,
    'ecf-recipient@ovalball.test', v_club, 'Test subject'
  ) into v_second;
  if v_second is not null then
    raise notice 'PASS 11 (B): a different occurrence still sends -- suppression does not swallow follow-ups';
  else
    raise exception 'FAIL 11 (B): a legitimate second occurrence was suppressed';
  end if;

  -- =================================================================
  -- C. Delivery lifecycle
  -- =================================================================
  select status into v_text from public.email_deliveries where id = v_delivery;
  if v_text = 'queued' then
    raise notice 'PASS 12 (C): a claimed delivery starts queued -- claiming is not sending';
  else
    raise exception 'FAIL 12 (C): a new delivery started as %', v_text;
  end if;

  perform public.record_email_delivery_result(v_delivery, 'sent', 'zeptomail', 'msg-123', null, null, null);
  select status into v_text from public.email_deliveries where id = v_delivery;
  if v_text = 'sent' then
    raise notice 'PASS 13 (C): a successful provider result is recorded as sent';
  else
    raise exception 'FAIL 13 (C): status is %', v_text;
  end if;

  select count(*) into v_count from public.email_deliveries
  where id = v_delivery and sent_at is not null and attempts = 1 and provider = 'zeptomail';
  if v_count = 1 then
    raise notice 'PASS 14 (C): sent_at, attempts and provider are all recorded';
  else
    raise exception 'FAIL 14 (C): the delivery result was not fully recorded';
  end if;

  perform public.record_email_delivery_result(v_second, 'failed', 'zeptomail', null, 'TM_3201', 'Sender address not verified', null);
  select count(*) into v_count from public.email_deliveries
  where id = v_second and status = 'failed' and failed_at is not null and error_code = 'TM_3201';
  if v_count = 1 then
    raise notice 'PASS 15 (C): a provider failure keeps its own error code, not a generic one';
  else
    raise exception 'FAIL 15 (C): the failure was not recorded with its provider code';
  end if;
  reset role;

  -- A suppressed delivery must say WHY. "Nothing was sent" with no reason is
  -- indistinguishable from a bug.
  begin
    insert into public.email_deliveries (event_key, idempotency_key, recipient_kind, recipient_email, subject, status)
    values ('club_invitation', 'ecf-suppressed-no-reason', 'club_invitation', 'x@ovalball.test', 's', 'suppressed');
    raise exception 'FAIL 16 (C): a suppressed delivery with no reason was accepted';
  exception when check_violation then
    raise notice 'PASS 16 (C): a suppressed delivery must record why it was suppressed';
  end;

  begin
    insert into public.email_deliveries (event_key, idempotency_key, recipient_kind, recipient_email, subject, status)
    values ('club_invitation', 'ecf-sent-no-time', 'club_invitation', 'x@ovalball.test', 's', 'sent');
    raise exception 'FAIL 17 (C): a delivery claimed sent with no timestamp was accepted';
  exception when check_violation then
    raise notice 'PASS 17 (C): a delivery cannot be "sent" without a send time';
  end;

  begin
    insert into public.email_deliveries (event_key, idempotency_key, recipient_kind, recipient_email, subject, status)
    values ('club_invitation', 'ecf-bad-status', 'club_invitation', 'x@ovalball.test', 's', 'delivered_probably');
    raise exception 'FAIL 18 (C): an invented status was accepted';
  exception when check_violation then
    raise notice 'PASS 18 (C): the delivery lifecycle is a closed set of states';
  end;

  begin
    insert into public.email_deliveries (event_key, idempotency_key, recipient_kind, recipient_email, subject)
    values ('an_event_that_does_not_exist', 'ecf-bad-event', 'club_invitation', 'x@ovalball.test', 's');
    raise exception 'FAIL 19 (C): a delivery for an uncatalogued event was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS 19 (C): a delivery must name a catalogued event -- no ad-hoc email types';
  end;

  -- =================================================================
  -- D. Authorization
  -- =================================================================
  -- The ledger carries real people's addresses.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.email_deliveries;
  if v_count = 0 then
    raise notice 'PASS 20 (D): a Club Admin cannot read the delivery ledger at all';
  else
    raise exception 'FAIL 20 (D): a Club Admin read % delivery rows, including recipient addresses', v_count;
  end if;

  begin
    perform * from public.email_delivery_health();
    raise exception 'FAIL 21 (D): a Club Admin read email delivery health';
  exception when insufficient_privilege then
    raise notice 'PASS 21 (D): email delivery health is Site-Admin-only';
  end;

  -- A client must not be able to forge a delivery record.
  begin
    insert into public.email_deliveries (event_key, idempotency_key, recipient_kind, recipient_email, subject)
    values ('club_invitation', 'ecf-forged', 'club_invitation', 'attacker@example.test', 'forged');
    raise exception 'FAIL 22 (D): an authenticated client inserted a delivery row directly';
  exception when insufficient_privilege then
    raise notice 'PASS 22 (D): direct INSERT into the delivery ledger is refused -- writes go through the definer function';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.email_deliveries;
  if v_count >= 2 then
    raise notice 'PASS 23 (D): a Site Admin can read the ledger (% rows)', v_count;
  else
    raise exception 'FAIL 23 (D): the Site Admin could not read the ledger -- an authorization lockout looks exactly like "no email was sent"';
  end if;

  select count(*) into v_count from public.email_delivery_health();
  if v_count = 1 then
    raise notice 'PASS 24 (D): a Site Admin can read email delivery health';
  else
    raise exception 'FAIL 24 (D): health returned % rows', v_count;
  end if;
  reset role;

  -- =================================================================
  -- E. The policy layer is the EXISTING notification architecture
  -- =================================================================
  select count(*) into v_count from public.notification_topics where email_ready;
  if v_count > 0 then
    raise notice 'PASS 25 (E): % topic(s) are marked email_ready, so the existing preference model gates email', v_count;
  else
    raise exception 'FAIL 25 (E): no topic is email_ready, so no topic-scoped email can be governed';
  end if;

  select count(*) into v_count
  from public.email_events e
  where e.topic_key is not null
    and not exists (select 1 from public.notification_topics t where t.key = e.topic_key);
  if v_count = 0 then
    raise notice 'PASS 26 (E): every topic-scoped email event points at a real notification topic';
  else
    raise exception 'FAIL 26 (E): % event(s) reference a topic that does not exist', v_count;
  end if;

  -- No second preference store was created.
  select count(*) into v_count from pg_tables
  where schemaname = 'public'
    and tablename <> 'notification_preferences'
    and (tablename like '%email_pref%' or tablename like '%email_consent%' or tablename like '%email_subscription%');
  if v_count = 0 then
    raise notice 'PASS 27 (E): no second email preference/consent store exists -- notification_preferences remains the only one';
  else
    raise exception 'FAIL 27 (E): a parallel email consent store appeared (% tables)', v_count;
  end if;

  raise notice 'Email Communications Foundation complete.';
end $$;

rollback;
