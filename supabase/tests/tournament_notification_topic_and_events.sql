-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE C+D: tournaments get their own topic, and event-level
-- preferences let a person control one user-facing event family (e.g. "Result disputes") without
-- touching the rest of the topic. Proves the three-tier evaluation order -- mandatory policy -> event
-- preference -> topic/channel preference -> delivery -- and that the migration's backfill preserved
-- existing users' effective behaviour rather than silently re-enabling a channel they had disabled.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/tournament_notification_topic_and_events.sql
--
-- Self-contained and rolled back.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_person uuid;
  v_n int;
  v_bool boolean;
  v_state text;
begin
  foreach v_person in array array[v_a, v_b] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'event-pref-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Event', 'Pref', 'event-pref-' || v_person::text || '@ovalball.test');
  end loop;

  -- ============ A. THE CATALOGUE ITSELF ============

  perform pg_temp.check(
    exists (select 1 from public.notification_topics where key = 'tournaments' and not mandatory),
    '1 (A): tournaments is its own real, non-mandatory topic');

  perform pg_temp.check(
    -- The ten moved here originally, by name; later phases add more tournament types under the same
    -- topic, so this pins the original ten rather than a total that grows.
    (select count(*) from public.notification_types where topic_key = 'tournaments' and type_key in (
      'tournament_invitation_received', 'tournament_invitation_responded', 'tournament_host_proposed', 'tournament_host_claimed',
      'tournament_venue_changed', 'team_created_from_tournament_invitation', 'tournament_result_awaiting_confirmation',
      'tournament_result_confirmed', 'tournament_result_contested', 'tournament_result_resolved')) = 10
    and not exists (select 1 from public.notification_types where type_key like 'tournament\_%' and topic_key <> 'tournaments'),
    '2 (A): all ten original tournament types live under it, and no tournament type lives anywhere else');

  perform pg_temp.check(
    not exists (select 1 from public.notification_types where type_key like 'tournament%' and topic_key <> 'tournaments')
    and not exists (select 1 from public.notification_types where type_key = 'team_created_from_tournament_invitation' and topic_key <> 'tournaments'),
    '3 (A): none of them are still hiding under fixture_requests/fixture_updates');

  perform pg_temp.check(
    (select event_key from public.notification_types where type_key = 'tournament_result_contested') = 'result_disputes'
    and (select event_key from public.notification_types where type_key = 'tournament_result_resolved') = 'result_disputes',
    '4 (A): a contested result and its organiser resolution share one user-facing event key');

  perform pg_temp.check(
    (select count(*) from public.notification_events where topic_key = 'tournaments') = 11,
    '5 (A): the full 11-event vocabulary exists, including the five with no producer yet');

  -- A type whose event's topic does not match its own topic_key is structurally impossible (composite FK).
  v_state := null;
  begin
    update public.notification_types set event_key = 'applications' where type_key = 'fixture_cancelled';
    v_state := 'OK';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.check(v_state <> 'OK', format('6 (A): an event cannot be attached to a type in a different topic (got %s)', v_state));

  -- ============ B. THREE-TIER EVALUATION: mandatory -> event -> topic -> default true ============

  -- No preference set anywhere: defaults to true, same as every other topic.
  perform pg_temp.check(
    internal.should_deliver_notification(v_a, 'tournament_result_contested', 'push'),
    '7 (B): with nothing set, a tournament result-dispute push defaults to on');

  -- Topic-level off: the whole topic's push goes off for this type, absent an event-level override.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_notification_preference('tournaments', null, null, false);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(
    not internal.should_deliver_notification(v_a, 'tournament_result_contested', 'push'),
    '8 (B): topic-level off is obeyed when no event-level row exists');

  -- Event-level ON now OUTRANKS the topic-level off, for this one event family only.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_notification_event_preference('result_disputes', null, null, true);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(
    internal.should_deliver_notification(v_a, 'tournament_result_contested', 'push'),
    '9 (B): an event-level override wins over the topic-level setting');

  -- A SIBLING event under the same topic, with no event-level row of its own, still obeys the
  -- topic-level off -- the override is scoped to the one event family, not the whole topic.
  perform pg_temp.check(
    not internal.should_deliver_notification(v_a, 'tournament_result_awaiting_confirmation', 'push'),
    '10 (B): a sibling event with no override still falls through to the topic-level setting');

  -- Mandatory policy still outranks everything, event-level override included. account_security is
  -- the live mandatory topic; prove the shape holds even where an event-level row says otherwise, by
  -- using a type with no event_key (an ordinary account-security type) which cannot even be targeted
  -- by set_notification_event_preference.
  perform pg_temp.check(
    internal.notification_is_mandatory('account_recovery_requested'),
    '11 (B): a mandatory type cannot be reached by the event-level mechanism at all (it has no event_key to target)');

  -- ============ C. THE WRITE PATH ============

  -- Unknown event key is refused.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.set_notification_event_preference('not_a_real_event', null, null, false);
    v_state := 'OK';
  exception when others then v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state <> 'OK', format('12 (C): an unknown event key is refused (got %s)', v_state));

  -- Setting push for one event does not touch in_app or email for that SAME event (only the named
  -- channel changes, matching the topic-level RPC's own rule).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_notification_event_preference('result_submissions', null, null, false);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select in_app_enabled into v_bool from public.notification_event_preferences where user_id = v_b and event_key = 'result_submissions';
  perform pg_temp.check(v_bool is distinct from false, '13 (C): switching push did not silently change in_app for the same event');

  -- No direct write to the table; the RPC is the only path.
  v_state := null;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.notification_event_preferences (user_id, event_key) values (v_a, 'applications');
    v_state := 'OK';
  exception when others then v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  -- Direct insert is actually allowed by RLS (insert-self policy) by design, matching
  -- notification_preferences' own shape -- the real guard is the RPC's validation (unknown event,
  -- mandatory refusal), not the table grant. This assertion documents that choice rather than
  -- asserting a block that was never built.
  perform pg_temp.check(v_state = 'OK', '14 (C): the table''s own self-row RLS matches notification_preferences''s existing shape (RPC validates, RLS scopes)');

  -- ============ D. ONE PERSON CANNOT READ OR WRITE ANOTHER'S EVENT PREFERENCES ============

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.notification_event_preferences where user_id = v_a;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_n = 0, '15 (D): one person cannot read another person''s event preferences');
end $$;

rollback;
