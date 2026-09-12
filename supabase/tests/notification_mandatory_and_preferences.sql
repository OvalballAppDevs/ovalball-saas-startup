-- Mandatory notifications, and the preferences that may not silence them
-- (20270259000000).
--
-- THE DEFECT THIS PINS DOWN. "Mandatory" used to be a property of a TOPIC,
-- and topics are broad. support_moderation held both "your support ticket was
-- updated" and "a safeguarding dispensation was revoked"; fixture_updates held
-- both "kickoff moved by ten minutes" and "the match is off". Because those
-- topics are optional, one switch silenced both halves -- so a guardian who
-- turned off fixture updates stopped being told a match was cancelled, and
-- drove to it.
--
-- The fix is a type-level override on top of the topic default, and the tests
-- below are arranged around the thing that makes it correct: within ONE
-- optional topic, the mandatory event still arrives and its ordinary sibling
-- still obeys the user. If those two ever stop being true together, the
-- mechanism has failed in one direction or the other.
--
-- Also proved: email is governed by the EMAIL classification rather than the
-- in-app rule, so the two classifications the audit found cannot contradict
-- each other; and push honestly reports that it cannot deliver.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/notification_mandatory_and_preferences.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_user uuid;
  v_other uuid;
  n integer;
begin
  select id into v_user  from auth.users where email = 'uat.guardian.one@ovalball.test';
  select id into v_other from auth.users where email = 'uat.guardian.two@ovalball.test';
  if v_user is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- =================================================================
  -- 1-3. THE OVERRIDE RESOLVES CORRECTLY
  -- =================================================================
  if internal.notification_is_mandatory('fixture_cancelled') then
    raise notice 'PASS 1: fixture_cancelled is mandatory despite sitting in an optional topic';
  else raise notice 'FAIL 1: a cancellation is still optional'; end if;

  if not internal.notification_is_mandatory('fixture_kickoff_changed') then
    raise notice 'PASS 2: an ordinary sibling in the same topic stays optional';
  else raise notice 'FAIL 2: the override leaked to the whole topic'; end if;

  if internal.notification_is_mandatory('site_admin_system_access_changed') then
    raise notice 'PASS 3: a type with no override inherits its mandatory topic';
  else raise notice 'FAIL 3: topic inheritance broke'; end if;

  -- =================================================================
  -- 4-7. THE SAFEGUARDING AND CANCELLATION EVENTS
  -- =================================================================
  select count(*) into n from (values
    ('safeguarding_dispensation_requested'),('safeguarding_dispensation_decided'),
    ('safeguarding_dispensation_revoked'),('fixture_cancelled'),
    ('fixture_cancelled_team_folded'),('training_session_cancelled'),('training_plan_cancelled')
  ) t(k) where not internal.notification_is_mandatory(t.k);
  if n = 0 then
    raise notice 'PASS 4: every safeguarding outcome and cancellation is mandatory';
  else raise notice 'FAIL 4: % of them can still be silenced', n; end if;

  -- Ordinary support noise stays optional -- the override is targeted, not a
  -- blanket that would make the setting meaningless.
  if not internal.notification_is_mandatory('support_ticket_update') then
    raise notice 'PASS 5: ordinary support traffic remains optional';
  else raise notice 'FAIL 5: routine support was made mandatory too'; end if;

  -- =================================================================
  -- 6-9. THE GATE HONOURS BOTH HALVES
  -- One user, one topic switched OFF: the cancellation still arrives, the
  -- routine change does not. This is the whole point of the mechanism.
  -- =================================================================
  perform set_config('role', 'postgres', true);
  insert into public.notification_preferences (user_id, topic_key, in_app_enabled)
  values (v_user, 'fixture_updates', false)
  on conflict (user_id, topic_key) do update set in_app_enabled = false;

  if internal.should_deliver_notification(v_user, 'fixture_cancelled', 'in_app') then
    raise notice 'PASS 6: with fixture updates switched off, a cancellation is still delivered';
  else raise notice 'FAIL 6: a cancellation was silenced by a topic preference'; end if;

  if not internal.should_deliver_notification(v_user, 'fixture_kickoff_changed', 'in_app') then
    raise notice 'PASS 7: the routine sibling is correctly suppressed';
  else raise notice 'FAIL 7: the preference did not suppress the optional event'; end if;

  -- 8. Re-enabling restores the optional event.
  update public.notification_preferences set in_app_enabled = true
  where user_id = v_user and topic_key = 'fixture_updates';
  if internal.should_deliver_notification(v_user, 'fixture_kickoff_changed', 'in_app') then
    raise notice 'PASS 8: re-enabling the topic restores the optional event';
  else raise notice 'FAIL 8: re-enabling did not restore delivery'; end if;

  -- 9. A preference belongs to one person only.
  update public.notification_preferences set in_app_enabled = false
  where user_id = v_user and topic_key = 'fixture_updates';
  if v_other is not null and internal.should_deliver_notification(v_other, 'fixture_kickoff_changed', 'in_app') then
    raise notice 'PASS 9: one person''s preference does not affect anybody else';
  else raise notice 'FAIL 9: a preference leaked across users'; end if;

  -- =================================================================
  -- 10-13. EMAIL FOLLOWS THE EMAIL CLASSIFICATION
  -- The audit found two classifications that could disagree. They cannot now:
  -- in-app reads the mandatory rule, email reads the email event.
  -- =================================================================
  -- match_cancelled is OPTIONAL_OPERATIONAL on topic fixture_updates.
  insert into public.notification_preferences (user_id, topic_key, email_enabled)
  values (v_user, 'fixture_updates', false)
  on conflict (user_id, topic_key) do update set email_enabled = false;

  if not internal.should_deliver_notification(v_user, 'fixture_kickoff_changed', 'email') then
    raise notice 'PASS 10: an optional email category obeys the user -- the column is finally consulted';
  else raise notice 'FAIL 10: optional email ignored the preference'; end if;

  update public.notification_preferences set email_enabled = true
  where user_id = v_user and topic_key = 'fixture_updates';
  if internal.should_deliver_notification(v_user, 'fixture_kickoff_changed', 'email') then
    raise notice 'PASS 11: re-enabling optional email restores it';
  else raise notice 'FAIL 11: optional email did not come back'; end if;

  -- A MANDATORY_OPERATIONAL email category ignores the preference.
  insert into public.notification_preferences (user_id, topic_key, email_enabled)
  values (v_user, 'support_moderation', false)
  on conflict (user_id, topic_key) do update set email_enabled = false;
  if internal.should_deliver_notification(v_user, 'support_ticket_update', 'email') then
    raise notice 'PASS 12: a mandatory email classification still delivers';
  else raise notice 'FAIL 12: mandatory email was suppressed by a preference'; end if;

  -- A type with no email event has no email to send.
  if not internal.should_deliver_notification(v_user, 'new_direct_message', 'email') then
    raise notice 'PASS 13: a type with no email event reports no email delivery';
  else raise notice 'FAIL 13: an email was claimed for a type that has none'; end if;

  -- =================================================================
  -- 14. PUSH IS HONEST ABOUT NOT EXISTING
  -- =================================================================
  if not internal.should_deliver_notification(v_user, 'fixture_cancelled', 'push') then
    raise notice 'PASS 14: push reports it cannot deliver, rather than pretending';
  else raise notice 'FAIL 14: push claimed a delivery it cannot make'; end if;

  -- =================================================================
  -- 15-16. WHAT THE SETTINGS SCREEN IS TOLD
  -- =================================================================
  if (select has_mandatory_events from public.notification_topic_settings where key = 'fixture_updates') then
    raise notice 'PASS 15: the settings view warns that this topic still delivers some events when off';
  else raise notice 'FAIL 15: the settings view would let the UI claim the topic is fully off'; end if;

  if not (select push_ready from public.notification_topic_settings where key = 'messages') then
    raise notice 'PASS 16: the settings view does not advertise push';
  else raise notice 'FAIL 16: push is advertised as available'; end if;

  -- =================================================================
  -- 17. ONE WRITER, NOT AN OVERLOADED PAIR
  --
  -- Adding the email argument in 20270263000000 created a SECOND
  -- set_notification_preference rather than replacing the first, because
  -- create-or-replace cannot change a signature. PostgREST resolves an RPC
  -- by the argument names it is given, so an in-app-only call matched both
  -- candidates and was refused outright -- the switch flipped, reverted,
  -- and saved nothing, while the email switch beside it worked.
  --
  -- Nothing about the function's BEHAVIOUR was wrong, which is why the
  -- behavioural tests above all passed while the product could not save a
  -- preference. The invariant worth holding is therefore about the shape
  -- of the API surface, not its logic.
  -- =================================================================
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'set_notification_preference';

  if n = 1 then
    raise notice 'PASS 17: exactly one set_notification_preference exists, so an in-app-only call resolves';
  else
    raise notice 'FAIL 17: % overloads of set_notification_preference -- PostgREST cannot choose', n;
  end if;

  -- =================================================================
  -- 18-19. AN EMAIL OPT-OUT HAS TO BE READABLE BY THE SENDER
  --
  -- notification_preferences is self-only under RLS, and the email send
  -- path runs as whoever TRIGGERED the event -- so it read zero rows for
  -- its recipients and emailed everybody regardless of their setting. An
  -- empty result was indistinguishable from unanimous consent, which is
  -- why nothing ever surfaced.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform public.set_notification_preference('fixture_updates', null, false);

  -- Read as somebody ELSE: this is the situation the send path is in.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);

  select count(*) into n
  from public.email_opted_out_user_ids('fixture_updates', array[v_user]::uuid[]);
  if n = 1 then
    raise notice 'PASS 18: a sender can see a recipient''s email opt-out';
  else
    raise notice 'FAIL 18: a recipient''s opt-out is invisible to the sender -- they would be emailed anyway';
  end if;

  -- 19. And it reports ONLY an opt-out. Somebody who has expressed no
  -- preference, or turned it back on, must not be filtered out.
  select count(*) into n
  from public.email_opted_out_user_ids('fixture_updates', array[v_other]::uuid[]);
  if n = 0 then
    raise notice 'PASS 19: somebody with no opt-out is not reported as opted out';
  else
    raise notice 'FAIL 19: a person who never opted out was reported as having done so';
  end if;
end $$;

rollback;
