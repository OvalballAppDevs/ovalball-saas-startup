-- LOCAL UAT: ENOUGH CONVERSATION TO REVIEW MESSAGES WITH.
--
-- The seeded review world had no messages at all, so Messages could be opened and not looked at. This
-- adds two conversations and nothing else: one with an unread message waiting, one already read, so
-- both states are visible on the phone without anybody having to manufacture them by hand.
--
-- IT SEEDS ONLY PAIRS THE PLATFORM ITSELF ALLOWS. Every pair below is checked against
-- internal.may_direct_message before a row is written -- the same predicate the picker and the send
-- path apply. So this file cannot create a conversation the product would refuse, and if the
-- safeguarding rules tighten, it seeds less rather than seeding something illegal. That is why the
-- checks are here rather than a comment asserting the pairs are fine.
--
-- Deterministic and idempotent: re-running changes nothing, and `supabase start` re-creates it.

do $$
declare
  v_coach uuid;        -- Priya Nair, Club Admin at Ovalball UAT RUFC
  v_guardian_one uuid; -- Marcus Bell
  v_guardian_two uuid; -- Dana Whitaker
  v_conversation uuid;
begin
  select id into v_coach from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_guardian_one from auth.users where email = 'uat.guardian.one@ovalball.test';
  select id into v_guardian_two from auth.users where email = 'uat.guardian.two@ovalball.test';

  if v_coach is null or v_guardian_one is null or v_guardian_two is null then
    raise notice 'local_uat_messaging: review identities not present, nothing seeded';
    return;
  end if;

  -- THE CANONICAL PREDICATE DECIDES, and it runs as the coach because that is whose eligibility is
  -- being asked about. If it says no, nothing is written and the seed says so out loud.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------- unread
  if internal.may_direct_message(v_guardian_one) then
    insert into public.direct_conversations (user_a, user_b, created_by)
    values (least(v_coach, v_guardian_one), greatest(v_coach, v_guardian_one), v_coach)
    on conflict do nothing;

    select id into v_conversation from public.direct_conversations
     where user_a = least(v_coach, v_guardian_one) and user_b = greatest(v_coach, v_guardian_one);

    if not exists (select 1 from public.fixture_messages where direct_conversation_id = v_conversation) then
      insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
      values
        (v_conversation, v_coach, 'Hi Marcus — training moves to pitch 2 this Thursday, 6pm.', 'message', 'text', now() - interval '2 days'),
        (v_conversation, v_guardian_one, 'Thanks Priya, that works. Will Leo need his gumshield?', 'message', 'text', now() - interval '2 days' + interval '20 minutes'),
        (v_conversation, v_coach, 'Yes please — contact session this week.', 'message', 'text', now() - interval '2 days' + interval '35 minutes'),
        -- The last word is the guardian's, so the coach opens Ovalball to something waiting.
        (v_conversation, v_guardian_one, 'Understood. See you Thursday.', 'message', 'text', now() - interval '3 hours');
    end if;
  else
    raise notice 'local_uat_messaging: coach may not message guardian one, skipped';
  end if;

  -- ---------------------------------------------------------------- read
  if internal.may_direct_message(v_guardian_two) then
    insert into public.direct_conversations (user_a, user_b, created_by)
    values (least(v_coach, v_guardian_two), greatest(v_coach, v_guardian_two), v_guardian_two)
    on conflict do nothing;

    select id into v_conversation from public.direct_conversations
     where user_a = least(v_coach, v_guardian_two) and user_b = greatest(v_coach, v_guardian_two);

    if not exists (select 1 from public.fixture_messages where direct_conversation_id = v_conversation) then
      insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
      values
        (v_conversation, v_guardian_two, 'Could I have a quick word about Saturday''s kick-off time?', 'message', 'text', now() - interval '6 days'),
        (v_conversation, v_coach, 'Of course — it is 10:30, meeting at 9:45.', 'message', 'text', now() - interval '6 days' + interval '1 hour');
    end if;

    -- READ, THROUGH THE CANONICAL MUTATION. Not by writing a read column: this is the same RPC the
    -- product calls when somebody opens a thread, so the seeded state is a state the product can
    -- actually produce.
    perform public.mark_direct_conversation_read(v_conversation);
  else
    raise notice 'local_uat_messaging: coach may not message guardian two, skipped';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'local_uat_messaging: review conversations ready';
end $$;
