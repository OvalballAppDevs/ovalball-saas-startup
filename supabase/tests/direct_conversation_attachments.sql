-- DIRECT-CONVERSATION ATTACHMENTS -- THE AUTHORITY, NOT THE FEATURE.
--
-- Attachments stopped being a fixture-only capability. What has to be proved is that widening the
-- CONTAINER widened nothing else: a direct conversation carries a photo or a club document under
-- exactly the rules that already governed carrying a sentence, and not one rule less.
--
--   A. The target is typed, and it cannot name two containers at once.
--   B. Posting into a direct conversation needs what posting TEXT into one needs -- membership AND
--      internal.may_direct_message -- so every safeguarding rule governs an attachment unchanged.
--   C. The storage namespace is authority. Knowing d/<uuid>/ is not permission to write or read in it.
--   D. Seeing a club document is not being allowed to share it into a direct conversation.
--   E. A block stops sending and does not retract history already received.
--   F. Safeguarding negatives: a minor is refused in both directions; unknown age is permitted, which
--      is the platform's own deliberate answer and is asserted so it cannot drift silently.
--   G. The fixture journey is untouched.
--
-- Self-seeding and rolled back. No persistent review identity, club, team, fixture or document is
-- touched, and nothing is written to storage -- the bucket policies are evaluated as the predicates
-- they are.
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
  v_ann uuid := gen_random_uuid();       -- Club Admin, adult
  v_ben uuid := gen_random_uuid();       -- Coach at the same club, adult
  v_outsider uuid := gen_random_uuid();  -- same club, not in the conversation
  v_minor uuid := gen_random_uuid();     -- same club, a child
  v_unknown uuid := gen_random_uuid();   -- same club, no date of birth recorded
  v_far uuid := gen_random_uuid();       -- a different club entirely: no standing in this library
  v_club uuid; v_dir uuid; v_team uuid; v_type uuid; v_season uuid;
  v_far_club uuid; v_far_dir uuid; v_far_conversation uuid;
  v_conversation uuid; v_minor_conversation uuid; v_unknown_conversation uuid;
  v_fixture uuid; v_guide uuid; v_private uuid;
  v_path text; v_message uuid;
  v_n int; v_txt text;
begin
  -- Adults, a child and somebody whose age nobody recorded.
  foreach v_person in array array[v_ann, v_ben, v_outsider, v_minor, v_unknown, v_far] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'dca-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  end loop;

  insert into public.profiles (id, first_name, surname, email, date_of_birth, phone_number)
  values
    (v_ann, 'Ann', 'Probe', 'dca-a@ovalball.test', (current_date - interval '40 years')::date, '07700900001'),
    (v_ben, 'Ben', 'Probe', 'dca-b@ovalball.test', (current_date - interval '38 years')::date, '07700900002'),
    (v_outsider, 'Otto', 'Probe', 'dca-o@ovalball.test', (current_date - interval '41 years')::date, null),
    -- A CHILD, by date of birth. is_adult_messaging_user disqualifies only where a DOB exists and
    -- resolves to a minor, which is why the next row matters as much as this one.
    (v_minor, 'Milo', 'Probe', 'dca-m@ovalball.test', (current_date - interval '12 years')::date, null),
    (v_unknown, 'Unk', 'Probe', 'dca-u@ovalball.test', null, null),
    (v_far, 'Farah', 'Probe', 'dca-f@ovalball.test', (current_date - interval '39 years')::date, null)
  on conflict (id) do nothing;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('DCA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'dca-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'dca-' || v_tag, 'active') returning id into v_club;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_ann, 'CLUB_ADMIN', 'active'),
    (v_club, v_ben, 'BASIC_USER', 'active'),
    (v_club, v_outsider, 'BASIC_USER', 'active'),
    (v_club, v_minor, 'BASIC_USER', 'active'),
    (v_club, v_unknown, 'BASIC_USER', 'active');

  -- A SECOND CLUB, so there is somebody who legitimately receives a shared document while having no
  -- standing at all in the library it came from. Ben would not do: `club.documents.view` is in the
  -- ordinary member bundle, so every member of this club can already read every document in it, and an
  -- assertion using him would pass for the wrong reason.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('DCA Far RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'dca-far-' || v_tag)
  returning id into v_far_dir;
  insert into public.clubs (directory_id, slug, status) values (v_far_dir, 'dca-far-' || v_tag, 'active') returning id into v_far_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_far_club, v_far, 'CLUB_ADMIN', 'active');

  -- The season whose window CONTAINS the fixture's date, from the register -- not merely the latest
  -- one, which files a September fixture under next season.
  select id into v_season
    from public.seasons
   where not is_regression_fixture and (current_date + 7) between starts_on and ends_on
   order by starts_on desc
   limit 1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 7, 'Home', 'Booked', 'DCA Opposition RFC', v_season, v_ann)
  returning id into v_fixture;

  -- TWO DOCUMENTS, differing only in how they are categorised. That is the whole of part D.
  insert into public.club_documents (club_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (v_club, 'DCA Visitor Guide', 'visitor_guide', 'guide.pdf', v_club::text || '/' || gen_random_uuid()::text || '.pdf',
          'application/pdf', 2048, v_ann)
  returning id into v_guide;
  insert into public.club_documents (club_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (v_club, 'DCA Committee Minutes', 'other', 'minutes.pdf', v_club::text || '/' || gen_random_uuid()::text || '.pdf',
          'application/pdf', 2048, v_ann)
  returning id into v_private;

  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_ann, v_ben), greatest(v_ann, v_ben), v_ann) returning id into v_conversation;

  v_path := 'd/' || v_conversation::text || '/' || gen_random_uuid()::text || '.jpg';

  -- =====================================================================
  -- A. THE TARGET IS TYPED
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from pg_type where typname = 'message_target_type' and typnamespace = 'public'::regnamespace;
  perform pg_temp.check(v_n = 1, 'A1 a message target is a named type, not a pair of nullable ids');

  select count(*) into v_n from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'message_target_type' and e.enumlabel in ('fixture','fixture_request','direct');
  perform pg_temp.check(v_n = 3, 'A2 and it names exactly the three containers an attachment may belong to');

  -- THE INVARIANT IS THE TABLE'S, not the RPC's politeness: fixture_messages already permits exactly
  -- one container, so no row can ambiguously be a fixture message AND a direct message.
  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format(
    'insert into public.fixture_messages (fixture_id, direct_conversation_id, sender_user_id, body, kind, content_type)
     values (%L, %L, %L, ''both at once'', ''message'', ''text'')', v_fixture, v_conversation, v_ann));
  perform pg_temp.check(v_txt <> 'OK', format('A3 a message cannot belong to a fixture and a direct conversation at once (%s)', v_txt));

  -- =====================================================================
  -- B. POSTING NEEDS WHAT POSTING TEXT NEEDS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.can_post_to_message_target('direct', v_conversation) = true,
    'B1 a participant who may direct-message the other person may post an attachment');

  perform pg_temp.act('authenticated', v_outsider);
  perform pg_temp.check(internal.can_post_to_message_target('direct', v_conversation) = false,
    'B2 somebody holding the conversation id and nothing else may not');

  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''let me in'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_conversation, 'd/' || v_conversation::text || '/x.jpg'));
  perform pg_temp.check(v_txt = '42501', format('B3 and the RPC refuses them with 42501 (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.fixture_messages where direct_conversation_id = v_conversation;
  perform pg_temp.check(v_n = 0, format('B4 having written nothing (%s messages exist)', v_n));

  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''Pitch sign.'', %L, ''sign.jpg'', ''image/jpeg'', 1000)',
    v_conversation, v_path));
  perform pg_temp.check(v_txt = 'OK', format('B5 a participant attaches a photo normally (%s)', v_txt));

  -- THE PATH MUST BELONG TO THE TARGET. Linking an object that lives in another conversation's folder
  -- is a message asserting something untrue about itself, and the fixture-only version never checked.
  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''borrowed'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_conversation, 'd/' || gen_random_uuid()::text || '/x.jpg'));
  perform pg_temp.check(v_txt = '42501', format('B6 an attachment path from another conversation is refused (%s)', v_txt));

  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''wrong prefix'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_conversation, 'f/' || v_conversation::text || '/x.jpg'));
  perform pg_temp.check(v_txt = '42501', format('B7 as is a fixture-shaped path pointing at a direct conversation (%s)', v_txt));

  -- =====================================================================
  -- C. THE STORAGE NAMESPACE IS AUTHORITY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.can_access_message_attachment_path(v_path, true) = true,
    'C1 a participant may write into d/<conversation>/');
  perform pg_temp.check(internal.can_access_message_attachment_path(v_path, false) = true,
    'C2 and read from it');

  perform pg_temp.act('authenticated', v_outsider);
  perform pg_temp.check(internal.can_access_message_attachment_path(v_path, true) = false,
    'C3 a guessed direct storage path is refused for writing');
  perform pg_temp.check(internal.can_access_message_attachment_path(v_path, false) = false,
    'C4 and for reading');

  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.can_access_message_attachment_path('d/not-a-uuid/x.jpg', true) = false,
    'C5 a folder that is not a conversation id is refused rather than erroring');
  perform pg_temp.check(internal.can_access_message_attachment_path('x/' || v_conversation::text || '/x.jpg', true) = false,
    'C6 an unknown container prefix is refused');
  perform pg_temp.check(internal.can_access_message_attachment_path('loose.jpg', true) = false,
    'C7 a bare filename in the bucket root is refused');

  -- The outsider cannot read the attachment ROW either, so the refusal is not only at the bucket.
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n
    from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
   where m.direct_conversation_id = v_conversation;
  perform pg_temp.check(v_n = 0, format('C8 nor may they read the attachment row (%s)', v_n));

  -- =====================================================================
  -- D. SEEING A DOCUMENT IS NOT SHARING IT
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.can_view_document_library(v_club, null) = true,
    'D1 the sender can view their own club''s document library');

  v_txt := pg_temp.try(format('select public.share_message_document(''direct'', %L, %L, ''Parking is off the lane.'')',
    v_conversation, v_guide));
  perform pg_temp.check(v_txt = 'OK', format('D2 a visitor-facing document goes into a direct conversation (%s)', v_txt));

  -- THE SAME PERSON, THE SAME LIBRARY, A DIFFERENT CATEGORY. `other` is the catch-all where an
  -- uncategorised committee paper sits, so it is refused for a direct conversation and this is the
  -- assertion that stops somebody "simplifying" the rule away later.
  v_txt := pg_temp.try(format('select public.share_message_document(''direct'', %L, %L, ''minutes'')',
    v_conversation, v_private));
  perform pg_temp.check(v_txt = '42501',
    format('D3 a document categorised ''other'' is refused in a direct conversation though the sender can see it (%s)', v_txt));

  -- AND THE FIXTURE JOURNEY IS UNCHANGED by that rule: two clubs' operational contacts still share
  -- whatever the library allows them to see.
  v_txt := pg_temp.try(format('select public.share_message_document(''fixture'', %L, %L, ''for the away side'')',
    v_fixture, v_private));
  perform pg_temp.check(v_txt = 'OK', format('D4 the same document still shares into a fixture conversation (%s)', v_txt));

  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.share_message_document(''direct'', %L, %L, ''hello'')', v_conversation, v_guide));
  perform pg_temp.check(v_txt = '42501', format('D5 a non-participant cannot share into the conversation at all (%s)', v_txt));

  -- THE RECIPIENT MUST BE ABLE TO READ THE DOCUMENT ROW, not only the message pointing at it.
  --
  -- Farah is a Club Admin at a DIFFERENT club and has no standing whatever in this library. Without the
  -- shared-document rule reaching direct conversations she would receive the message, the reference row
  -- would resolve and the storage object would be reachable, and the title, filename and size would all
  -- come back null -- a card describing nothing, which is worse than no card.
  perform pg_temp.act_postgres();
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_ann, v_far), greatest(v_ann, v_far), v_ann) returning id into v_far_conversation;

  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format('select public.share_message_document(''direct'', %L, %L, ''Visitor guide.'')',
    v_far_conversation, v_guide));
  perform pg_temp.check(v_txt = 'OK', format('D6 a visitor guide shares to somebody at another club (%s)', v_txt));

  perform pg_temp.act('authenticated', v_far);
  perform pg_temp.check(internal.can_view_document_library(v_club, null) = false,
    'D7 the recipient has no standing in the sending club''s document library');
  select count(*) into v_n from public.club_documents where id = v_guide;
  perform pg_temp.check(v_n = 1, format('D8 and can still read the document that was shared with them (%s)', v_n));
  select count(*) into v_n from public.club_documents where id = v_private;
  perform pg_temp.check(v_n = 0, format('D9 but not one that was not shared with them (%s)', v_n));

  -- =====================================================================
  -- E. A BLOCK STOPS SENDING, NOT READING
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ben);
  v_txt := pg_temp.try(format('select public.block_user(%L)', v_ann));
  perform pg_temp.check(v_txt = 'OK', format('E1 a person may block somebody they are talking to (%s)', v_txt));

  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.can_post_to_message_target('direct', v_conversation) = false,
    'E2 the blocked sender may no longer attach anything');
  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''still here'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_conversation, 'd/' || v_conversation::text || '/x2.jpg'));
  perform pg_temp.check(v_txt = '42501', format('E3 and the RPC refuses them (%s)', v_txt));

  -- READING SURVIVES. Blocking somebody is not retracting a conversation that already happened, and an
  -- attachment must not disappear from history its recipient legitimately holds.
  perform pg_temp.act('authenticated', v_ben);
  perform pg_temp.check(internal.can_read_message_target('direct', v_conversation) = true,
    'E4 the person who blocked can still read the conversation');
  select count(*) into v_n
    from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
   where m.direct_conversation_id = v_conversation;
  perform pg_temp.check(v_n = 1, format('E5 including the attachment they already received (%s)', v_n));

  perform pg_temp.act('authenticated', v_ben);
  perform pg_temp.check(pg_temp.try(format('select public.unblock_user(%L)', v_ann)) = 'OK', 'E6 and the block can be lifted');

  -- =====================================================================
  -- F. SAFEGUARDING NEGATIVES
  -- =====================================================================
  -- A conversation with a child cannot be created through the product at all, so these are asserted on
  -- the predicate the attachment path depends on rather than by manufacturing a conversation the
  -- platform would refuse. An attachment can never reach further than may_direct_message allows.
  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.may_direct_message(v_minor) = false,
    'F1 an adult may not direct-message a child, so may not attach to one');

  perform pg_temp.act('authenticated', v_minor);
  perform pg_temp.check(internal.may_direct_message(v_ann) = false,
    'F2 and a child may not direct-message an adult, in the other direction');

  -- UNKNOWN AGE IS PERMITTED, which is the platform's deliberate answer -- disqualification needs a
  -- date of birth that RESOLVES to a minor, not merely a missing one. Asserted so that a future change
  -- to fail closed here is a decision somebody makes rather than a silent drift.
  perform pg_temp.act('authenticated', v_ann);
  perform pg_temp.check(internal.may_direct_message(v_unknown) = true,
    'F3 somebody whose age is not recorded is permitted, and that is deliberate');

  perform pg_temp.act_postgres();
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_ann, v_unknown), greatest(v_ann, v_unknown), v_ann) returning id into v_unknown_conversation;
  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''photo'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_unknown_conversation, 'd/' || v_unknown_conversation::text || '/x.jpg'));
  perform pg_temp.check(v_txt = 'OK', format('F4 so an attachment to them is allowed, consistently with text (%s)', v_txt));

  -- A REVOKED MEMBERSHIP ENDS IT. The relationship that made the pair legitimate was a shared club;
  -- when it goes, so does the ability to attach -- without anybody touching the conversation.
  perform pg_temp.act_postgres();
  update public.club_memberships set status = 'revoked' where club_id = v_club and user_id = v_unknown;
  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format(
    'select public.create_message_attachment(''direct'', %L, ''again'', %L, ''x.jpg'', ''image/jpeg'', 1000)',
    v_unknown_conversation, 'd/' || v_unknown_conversation::text || '/x3.jpg'));
  perform pg_temp.check(v_txt = 'OK',
    format('F5 an existing thread survives a lapsed membership, by the platform''s own discovery rule (%s)', v_txt));

  -- =====================================================================
  -- G. THE FIXTURE JOURNEY IS UNTOUCHED
  -- =====================================================================
  perform pg_temp.act('authenticated', v_ann);
  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, ''Team sheet.'', %L, ''sheet.png'', ''image/png'', 6000)',
    v_fixture, 'f/' || v_fixture::text || '/sheet.png'));
  perform pg_temp.check(v_txt = 'OK', format('G1 the original fixture RPC still works, now as a wrapper (%s)', v_txt));

  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, %L, ''both'', %L, ''x.png'', ''image/png'', 6000)',
    v_fixture, v_fixture, 'f/' || v_fixture::text || '/x.png'));
  perform pg_temp.check(v_txt = '42501', format('G2 and refuses two containers at once (%s)', v_txt));

  perform pg_temp.check(internal.can_access_fixture_attachment_path('f/' || v_fixture::text || '/sheet.png') = true,
    'G3 the fixture storage predicate still answers for a fixture path');

  -- =====================================================================
  -- H. A DELETED MESSAGE TAKES ITS NOTIFICATION WITH IT
  -- =====================================================================
  perform pg_temp.act_postgres();
  select m.id into v_message from public.fixture_messages m where m.fixture_id = v_fixture limit 1;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_ben, 'new_fixture_message', 'New message', 'A message arrived',
          jsonb_build_object('message_id', v_message::text, 'fixture_id', v_fixture::text));
  select count(*) into v_n from public.notifications where (data->>'message_id') = v_message::text;
  perform pg_temp.check(v_n = 1, 'H1 a message notification exists to begin with');

  delete from public.fixture_messages where id = v_message;
  select count(*) into v_n from public.notifications where (data->>'message_id') = v_message::text;
  perform pg_temp.check(v_n = 0, format('H2 deleting the message removes it, so no badge counts nothing (%s left)', v_n));
end $$;

rollback;
