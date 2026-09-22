-- MOBILE MESSAGE ATTACHMENTS -- THE BOUNDARY, THE AUTHORITY AND THE CAPTION RULE.
--
-- The mobile client can now attach a photo, a file and a club document to a conversation. It does it
-- through the canonical RPCs and the canonical storage policies, so what has to be proved is not that
-- the app behaves -- an installed app is modifiable -- but that the SERVER refuses everything the app
-- must never be able to do, and that the rules the interface states are the platform's actual rules.
--
--   A. THE BOUNDARY IS REAL. The attachment RPCs accept a fixture or a request and nothing else, so the
--      app's refusal to offer attachments on a direct or club conversation is describing the platform
--      rather than making a product decision on a handset.
--   B. THE STORAGE PATH IS AUTHORITY, NOT NAMING. `f/<fixture>/...` is checked against the conversation,
--      so an outsider cannot upload into somebody else's folder even knowing its shape.
--   C. SENDING AN ATTACHMENT IS THE SERVER'S DECISION, at the RPC as well as at the bucket.
--   D. A NON-IMAGE ATTACHMENT REQUIRES WORDS. `fixture_messages_content_present` enforces it, which is
--      why the mobile composer asks for a caption BEFORE uploading a document -- this suite is what
--      stops that being quietly removed as an unnecessary restriction.
--   E. A SHARED DOCUMENT IS A REFERENCE, and reading it is still the reader's own authority.
--
-- Self-seeding and rolled back. No persistent review identity, club, team, fixture or document is
-- touched, and nothing is written to storage: the bucket policies are evaluated as predicates, which is
-- what they are.
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
  v_secretary uuid := gen_random_uuid();  -- may post in the fixture conversation
  v_outsider uuid := gen_random_uuid();   -- same club, not in the conversation
  v_club uuid; v_dir uuid; v_team uuid; v_type uuid; v_season uuid;
  v_fixture uuid; v_document uuid; v_message uuid;
  v_n int; v_txt text; v_path text;
begin
  foreach v_person in array array[v_secretary, v_outsider] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mmatt-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Attach', 'Probe', 'mmatt-' || v_person::text || '@ovalball.test', (current_date - interval '35 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MMATT RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mmatt-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mmatt-' || v_tag, 'active') returning id into v_club;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;

  -- BOTH ARE CLUB MEMBERS. The only difference between them is the fixture conversation, so a refusal
  -- that came from "not in the club" would prove nothing about attachments.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_secretary, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_outsider, 'BASIC_USER', 'active');

  -- THE SEASON COMES FROM THE CANONICAL REGISTER, never from a month boundary computed here.
  select id into v_season from public.seasons order by starts_on desc limit 1;

  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 7, 'Home', 'Booked', 'MMATT Opposition RFC', v_season, v_secretary)
  returning id into v_fixture;

  insert into public.club_documents (club_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (v_club, 'MMATT Visitor Guide', 'other', 'guide.pdf', v_club::text || '/' || gen_random_uuid()::text || '.pdf',
          'application/pdf', 2048, v_secretary)
  returning id into v_document;

  -- =====================================================================
  -- A. THE BOUNDARY IS REAL
  -- =====================================================================
  -- The app says attachments are a fixture-and-request capability. That claim is only honest if the RPC
  -- genuinely has nowhere to put a direct or club conversation -- so the SIGNATURE is the assertion.
  select count(*) into v_n
  from pg_proc p
  where p.proname = 'create_fixture_message_with_attachment'
    and pg_get_function_identity_arguments(p.oid) = 'p_fixture_id uuid, p_fixture_request_id uuid, p_body text, p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes integer';
  perform pg_temp.check(v_n = 1,
    'A1 the attachment RPC takes a fixture or a request and no other container, so the app is describing the platform');

  select count(*) into v_n
  from pg_proc p
  where p.proname = 'share_fixture_document'
    and pg_get_function_identity_arguments(p.oid) = 'p_fixture_id uuid, p_fixture_request_id uuid, p_document_id uuid, p_note text';
  perform pg_temp.check(v_n = 1, 'A2 and so does the document-share RPC');

  -- AND IF THAT EVER CHANGES, THIS FAILS. A direct-conversation parameter appearing on either function
  -- means the mobile client's honest "not available in direct messages yet" has become a lie, and the
  -- interface has to be updated in the same change.
  select count(*) into v_n
  from pg_proc p
  where p.proname in ('create_fixture_message_with_attachment', 'share_fixture_document')
    and pg_get_function_identity_arguments(p.oid) like '%direct_conversation%';
  perform pg_temp.check(v_n = 0,
    'A3 neither has gained a direct-conversation parameter without the clients being updated');

  -- =====================================================================
  -- B. THE STORAGE PATH IS AUTHORITY
  -- =====================================================================
  v_path := 'f/' || v_fixture::text || '/' || gen_random_uuid()::text || '.png';

  perform pg_temp.act('authenticated', v_secretary);
  -- ONE PREDICATE GOVERNS BOTH DIRECTIONS on this bucket: `fixture_attachments_storage_insert` and
  -- `..._select` both call this, so who may upload and who may read are the same question, answered once.
  perform pg_temp.check(internal.can_access_fixture_attachment_path(v_path) = true,
    'B1 somebody who may post in the conversation may write into and read its attachment folder');

  perform pg_temp.act('authenticated', v_outsider);
  perform pg_temp.check(internal.can_access_fixture_attachment_path(v_path) = false,
    'B2 a club member who is not in the conversation may neither write nor read it, knowing the exact path');

  -- A PATH IS NOT A PASSWORD. Malformed, unprefixed and foreign-prefixed names are all refused, so the
  -- policy cannot be talked round by a creative filename.
  perform pg_temp.act('authenticated', v_secretary);
  perform pg_temp.check(internal.can_access_fixture_attachment_path('not-a-folder.png') = false,
    'B3 a bare filename with no fixture folder is refused');
  perform pg_temp.check(internal.can_access_fixture_attachment_path('f/not-a-uuid/x.png') = false,
    'B4 a folder that is not a fixture id is refused rather than erroring');
  perform pg_temp.check(internal.can_access_fixture_attachment_path('x/' || v_fixture::text || '/x.png') = false,
    'B5 an unknown container prefix is refused');

  -- =====================================================================
  -- C. SENDING AN ATTACHMENT IS THE SERVER'S DECISION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, ''let me in'', %L, ''x.png'', ''image/png'', 70)',
    v_fixture, v_path));
  perform pg_temp.check(v_txt = '42501', format('C1 the RPC refuses an outsider with 42501 (%s)', v_txt));

  select count(*) into v_n from public.fixture_messages where fixture_id = v_fixture;
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.fixture_messages where fixture_id = v_fixture;
  perform pg_temp.check(v_n = 0, format('C2 and wrote nothing at all (%s messages exist)', v_n));

  perform pg_temp.act('authenticated', v_secretary);
  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, ''Team sheet for Saturday.'', %L, ''sheet.png'', ''image/png'', 6189)',
    v_fixture, v_path));
  perform pg_temp.check(v_txt = 'OK', format('C3 an authorised sender attaches an image normally (%s)', v_txt));

  -- AN IMAGE WITH NO CAPTION IS A MESSAGE. The schema models it, so the composer must not demand words
  -- for a photo.
  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, null, %L, ''sheet2.png'', ''image/png'', 6189)',
    v_fixture, 'f/' || v_fixture::text || '/' || gen_random_uuid()::text || '.png'));
  perform pg_temp.check(v_txt = 'OK', format('C4 an image with no caption is accepted (%s)', v_txt));

  -- =====================================================================
  -- D. A NON-IMAGE ATTACHMENT REQUIRES WORDS
  -- =====================================================================
  -- `fixture_messages_content_present` is CHECK (content_type = 'image' OR body is present), and the RPC
  -- stores a non-image as 'text'. So a PDF with an empty caption is refused by the DATABASE -- which is
  -- why the mobile composer asks for the sentence before it uploads anything, rather than discovering
  -- this after a two-megabyte upload and reporting "couldn't attach that file".
  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, '''', %L, ''agreement.pdf'', ''application/pdf'', 2048)',
    v_fixture, 'f/' || v_fixture::text || '/' || gen_random_uuid()::text || '.pdf'));
  perform pg_temp.check(v_txt = '23514',
    format('D1 a document with no caption is refused by the content-present constraint (%s)', v_txt));

  v_txt := pg_temp.try(format(
    'select public.create_fixture_message_with_attachment(%L, null, ''Signed fixture agreement.'', %L, ''agreement.pdf'', ''application/pdf'', 2048)',
    v_fixture, 'f/' || v_fixture::text || '/' || gen_random_uuid()::text || '.pdf'));
  perform pg_temp.check(v_txt = 'OK', format('D2 the same document with a caption goes (%s)', v_txt));

  -- The constraint itself, named, so removing it fails here rather than silently allowing a captionless
  -- document that the interface has stopped asking about.
  perform pg_temp.act_postgres();
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fixture_messages'::regclass and conname = 'fixture_messages_content_present';
  perform pg_temp.check(v_n = 1, 'D3 the content-present constraint still exists under that name');

  -- =====================================================================
  -- E. A SHARED DOCUMENT IS A REFERENCE, AND READING IT IS STILL AUTHORITY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.share_fixture_document(%L, null, %L, ''here you go'')', v_fixture, v_document));
  perform pg_temp.check(v_txt <> 'OK', format('E1 an outsider cannot share a document into the conversation (%s)', v_txt));

  perform pg_temp.act('authenticated', v_secretary);
  v_txt := pg_temp.try(format('select public.share_fixture_document(%L, null, %L, ''Visitor guide for the away side.'')', v_fixture, v_document));
  perform pg_temp.check(v_txt = 'OK', format('E2 an authorised sender shares one (%s)', v_txt));

  -- A REFERENCE, NOT A COPY. One reference row, and the document's own id on it -- so a later revision
  -- of the club's document is what the conversation points at.
  perform pg_temp.act_postgres();
  select count(*) into v_n
    from public.fixture_message_document_refs r
    join public.fixture_messages m on m.id = r.message_id
   where m.fixture_id = v_fixture and r.document_id = v_document;
  perform pg_temp.check(v_n = 1, format('E3 it is stored as one reference to the club''s own document (%s)', v_n));

  select count(*) into v_n from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
   where m.fixture_id = v_fixture and a.storage_path like '%' || v_document::text || '%';
  perform pg_temp.check(v_n = 0, 'E4 and nothing was copied into the attachments table');

  -- THE OUTSIDER STILL CANNOT READ IT. Sharing a document into a conversation does not publish it.
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n from public.fixture_messages where fixture_id = v_fixture;
  perform pg_temp.check(v_n = 0, format('E5 the outsider reads none of the conversation, attachments included (%s)', v_n));
end $$;

rollback;
