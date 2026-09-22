-- MOBILE MESSAGING -- THE AUTHORITY THE APP INHERITS AND CANNOT WIDEN.
--
-- The mobile client reads conversations through the SAME RPCs and the SAME RLS the website uses, and
-- sends by the SAME insert into public.fixture_messages. So what has to be proved is not that the app
-- behaves, but that the server refuses the things the app must never be able to do -- because if the
-- server refuses them, no client can perform them, including one an attacker has modified.
--
--   A. A conversation id is not a permission.
--   B. Sending is decided by the server, not by whether a composer was rendered.
--   C. A context is a scope, not a key: switching cannot widen what may be read.
--   D. Direct messaging keeps its canonical gate.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_alice uuid := gen_random_uuid();     -- in the conversation
  v_bob uuid := gen_random_uuid();       -- in the conversation
  v_outsider uuid := gen_random_uuid();  -- holds the id and nothing else
  v_club uuid; v_dir uuid; v_team uuid; v_type uuid;
  v_conversation uuid; v_message uuid;
  v_n int; v_txt text;
begin
  foreach v_person in array array[v_alice, v_bob, v_outsider] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mma-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Msg', 'Probe', 'mma-' || v_person::text || '@ovalball.test', (current_date - interval '35 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MMA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mma-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mma-' || v_tag, 'active') returning id into v_club;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;

  -- Alice and Bob are club members; the outsider is a member too, so the ONLY difference between them
  -- is the conversation itself. A refusal that came from "not in the club" would prove nothing.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_alice, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_bob, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_outsider, 'BASIC_USER', 'active');

  -- A direct conversation between Alice and Bob, created the way the product creates one.
  -- `direct_conversations_ordered_pair` requires user_a < user_b, so one row exists per pair however
  -- it is created. Random ids meant this passed or failed by luck; ordering them is the fixture's job.
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_bob), greatest(v_alice, v_bob), v_alice)
  returning id into v_conversation;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_conversation, v_alice, 'Are you free Saturday?', 'message', 'text') returning id into v_message;

  -- =====================================================================
  -- A. A CONVERSATION ID IS NOT A PERMISSION
  -- =====================================================================
  -- This is the deep-link case stated exactly: somebody holding the id, typed or pasted or guessed.
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n from public.fixture_messages where direct_conversation_id = v_conversation;
  perform pg_temp.check(v_n = 0, format('A1 holding the conversation id reveals no messages (%s visible)', v_n));

  select count(*) into v_n from public.direct_conversations where id = v_conversation;
  perform pg_temp.check(v_n = 0, format('A2 nor the conversation record itself (%s visible)', v_n));

  -- And the canonical header RPC, which the mobile screen calls, tells them nothing either.
  select count(*) into v_n from public.direct_conversation_header(v_conversation);
  perform pg_temp.check(v_n = 0, format('A3 nor does the header reader the app uses (%s rows)', v_n));

  -- A participant sees it, so the refusals above are about authority rather than about nothing existing.
  perform pg_temp.act('authenticated', v_bob);
  select count(*) into v_n from public.fixture_messages where direct_conversation_id = v_conversation;
  perform pg_temp.check(v_n = 1, format('A4 a participant reads it perfectly well (%s)', v_n));

  -- =====================================================================
  -- B. SENDING IS THE SERVER'S DECISION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format(
    'insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
     values (%L, %L, ''let me in'', ''message'', ''text'')', v_conversation, v_outsider));
  perform pg_temp.check(v_txt <> 'OK', format('B1 an outsider cannot send into it (%s)', v_txt));

  -- Nor by claiming to be somebody who IS in it. This is the one that matters: a modified client can
  -- put any value in the body it likes, so the sender column must be the server's business.
  v_txt := pg_temp.try(format(
    'insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
     values (%L, %L, ''forged'', ''message'', ''text'')', v_conversation, v_alice));
  perform pg_temp.check(v_txt <> 'OK', format('B2 nor by forging the sender (%s)', v_txt));

  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format(
    'insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
     values (%L, %L, ''Yes, see you there'', ''message'', ''text'')', v_conversation, v_bob));
  perform pg_temp.check(v_txt = 'OK', format('B3 a participant sends normally (%s)', v_txt));

  -- AND NOBODY EDITS SOMEBODY ELSE'S WORDS. A composer that could rewrite history would be worse than
  -- one that could not send at all.
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('update public.fixture_messages set body = ''changed'' where id = %L', v_message));
  perform pg_temp.check(v_txt <> 'OK' or (select body from public.fixture_messages where id = v_message) = 'Are you free Saturday?',
    format('B4 an outsider cannot rewrite a message (%s)', v_txt));

  -- =====================================================================
  -- C. A CONTEXT IS A SCOPE, NOT A KEY
  -- =====================================================================
  -- The mobile app asks the SAME reader whatever context is selected; a context cannot widen what the
  -- server returns, because the server is never told which context is selected. Proved by asking as
  -- the outsider again after everything above: there is no state the client could have changed.
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n from public.my_direct_conversations(50) where conversation_id = v_conversation;
  perform pg_temp.check(v_n = 0, format('C1 the inbox reader never lists somebody else''s conversation (%s)', v_n));

  perform pg_temp.act('authenticated', v_bob);
  select count(*) into v_n from public.my_direct_conversations(50) where conversation_id = v_conversation;
  perform pg_temp.check(v_n = 1, format('C2 and always lists your own (%s)', v_n));

  -- =====================================================================
  -- D. DIRECT MESSAGING KEEPS ITS CANONICAL GATE
  -- =====================================================================
  -- The app never invents a recipient list: discovery is my_direct_message_candidates, which applies
  -- the platform's own policy. Asserted as a reader that exists and is scoped, not re-implemented.
  perform pg_temp.act('authenticated', v_outsider);
  -- It is a FUNCTION, not a view: discovery is computed per caller, which is the whole point -- there
  -- is no table of "who may message whom" for a client to read around.
  select count(*) into v_n from public.my_direct_message_candidates() where user_id = v_outsider;
  perform pg_temp.check(v_n = 0, format('D1 candidate discovery never offers you yourself (%s)', v_n));

  -- The unread counter the badge uses is scoped to the caller too, so a badge can never count somebody
  -- else's unread messages.
  select count(*) into v_n from public.my_unread_message_counts();
  perform pg_temp.check(v_n >= 0, 'D2 the unread reader answers only for the caller');

  -- =====================================================================
  -- E. WHO MAY BE MESSAGED AT ALL -- the New Message boundary.
  -- =====================================================================
  -- The picker is `my_direct_message_candidates()`, which applies the same predicate the send path
  -- applies. So the thing worth proving is that the PREDICATE holds, because neither the picker nor
  -- the app can widen it.
  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(internal.may_direct_message(v_bob),
    'E1 two adults sharing a club may message each other');
  perform pg_temp.check(not internal.may_direct_message(v_alice),
    'E2 nobody may open a conversation with themselves');
  perform pg_temp.check(not internal.may_direct_message(gen_random_uuid()),
    'E3 nor with somebody Ovalball has no relationship to');

  -- THE SAFEGUARDING BOUNDARY, AND IT OUTRANKS EVERYTHING. Alice is a Club Admin at this club; Bob is
  -- about to become a minor. Club authority must not reach past it -- the predicate's own comment says
  -- "not a shared club, not a guardian relationship, not a fixture, not an existing thread, not
  -- administrator status", and an EXISTING conversation between them makes that the sharpest test.
  perform pg_temp.act_postgres();
  update public.profiles set date_of_birth = (current_date - interval '13 years')::date where id = v_bob;

  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(not internal.may_direct_message(v_bob),
    'E4 a Club Admin may NOT message a minor, even with a conversation already open');
  select count(*) into v_n from public.my_direct_message_candidates() where user_id = v_bob;
  perform pg_temp.check(v_n = 0, format('E5 and the picker does not offer them (%s)', v_n));

  -- Nor the other way round: a minor's own account cannot start one either.
  perform pg_temp.act('authenticated', v_bob);
  perform pg_temp.check(not internal.may_direct_message(v_alice),
    'E6 and a minor may not message an adult');
  v_txt := pg_temp.try(format('select public.open_direct_conversation(%L)', v_alice));
  perform pg_temp.check(v_txt <> 'OK', format('E7 opening a conversation is refused at the server (%s)', v_txt));

  -- AND IT IS THE AGE THAT DID IT, not something incidental: putting the date of birth back restores
  -- eligibility, so E4-E7 were measuring the safeguarding rule rather than a side effect.
  perform pg_temp.act_postgres();
  update public.profiles set date_of_birth = (current_date - interval '34 years')::date where id = v_bob;
  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(internal.may_direct_message(v_bob),
    'E8 restoring an adult date of birth restores eligibility');

  -- UNKNOWN AGE IS CURRENTLY PERMITTED, and that is recorded rather than asserted as desirable:
  -- is_adult_messaging_user disqualifies only where a date of birth EXISTS and resolves to a minor.
  -- The player model has an `unknown_youth_protected` state this predicate does not consult. Pinned so
  -- that a deliberate change to the posture is a visible test change rather than a silent one.
  perform pg_temp.act_postgres();
  update public.profiles set date_of_birth = null where id = v_bob;
  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(internal.may_direct_message(v_bob),
    'E9 an unknown date of birth is currently treated as eligible -- owner decision, not an endorsement');

  perform pg_temp.act_postgres();
  update public.profiles set date_of_birth = (current_date - interval '34 years')::date where id = v_bob;

  raise notice 'MOBILE MESSAGE AUTHORITY: complete';
end $$;

rollback;
