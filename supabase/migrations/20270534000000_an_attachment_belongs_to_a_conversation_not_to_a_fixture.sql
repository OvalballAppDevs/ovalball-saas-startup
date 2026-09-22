-- AN ATTACHMENT BELONGS TO A CONVERSATION, NOT TO A FIXTURE.
--
-- Ovalball's attachment model was built when the only conversation that existed was a fixture
-- negotiation, and it still said so in its signature: `create_fixture_message_with_attachment` and
-- `share_fixture_document` took `p_fixture_id` and `p_fixture_request_id` and nothing else. Direct
-- conversations arrived later, reusing `fixture_messages` and its RLS for TEXT -- and inherited an
-- attachment model that had no way to name them.
--
-- The consequence was not a missing feature but a BROKEN ONE. The website's own attach menu appears on
-- a direct conversation, builds `r/<direct-conversation-id>/...` because the kind is not "fixture",
-- passes null for both fixture parameters, and is refused by
-- `internal.can_access_fixture_conversation(null, null)`. A person attaching a photo to a direct
-- message got a raw error. Mobile refused up front and said so, which was honest and still second-class.
--
-- SO THE TARGET BECOMES EXPLICIT AND TYPED. A message attachment now names ONE messaging target --
-- 'fixture', 'fixture_request' or 'direct' -- and every authority question is asked of that target
-- through one chokepoint. The previous shape, two nullable ids with the invariant living in the
-- callers, is what allowed a third container to exist for two years that neither id could describe.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not widen who may hold a direct conversation. Posting an
-- attachment into one requires exactly what posting TEXT into one requires and nothing less:
-- `internal.can_view_direct_conversation` and `internal.may_direct_message`, which is the same pair the
-- `fixture_messages_insert_scoped` policy applies -- so every safeguarding rule (both parties adult,
-- blocks in either direction, club and site messaging policy, discovery) governs an attachment exactly
-- as it governs a sentence. It is reused, never restated.
--
-- READING IS NOT SENDING. A block stops somebody sending; it does not retract a conversation they were
-- legitimately part of. So reading an existing attachment needs only `can_view_direct_conversation`,
-- which is how the canonical thread reader already treats the messages themselves.

begin;

-- ---------------------------------------------------------------------------
-- 1. THE TYPED TARGET
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_target_type' and typnamespace = 'public'::regnamespace) then
    create type public.message_target_type as enum ('fixture', 'fixture_request', 'direct');
  end if;
end $$;

comment on type public.message_target_type is
  'The one messaging container an attachment, document share or contact card belongs to. Replaces the pair of nullable fixture ids, which could not name a direct conversation at all.';

-- ---------------------------------------------------------------------------
-- 2. AUTHORITY, AT ONE CHOKEPOINT
-- ---------------------------------------------------------------------------

-- MAY I POST INTO THIS TARGET AT ALL.
--
-- For a fixture or a request this is the long-standing predicate, unchanged. For a direct conversation
-- it is exactly the pair the insert policy on `fixture_messages` already applies to text, so an
-- attachment can never reach a conversation a sentence could not.
create or replace function internal.can_post_to_message_target(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns boolean
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare v_other uuid;
begin
  if p_target_id is null or auth.uid() is null then
    return false;
  end if;

  if p_target_type = 'fixture' then
    return internal.can_access_fixture_conversation(p_target_id, null);
  elsif p_target_type = 'fixture_request' then
    return internal.can_access_fixture_conversation(null, p_target_id);
  end if;

  -- DIRECT. Membership first, then the safeguarding predicate on the OTHER party. Both, never either.
  if not internal.can_view_direct_conversation(p_target_id) then
    return false;
  end if;
  select case when d.user_a = auth.uid() then d.user_b else d.user_a end
    into v_other
  from public.direct_conversations d
  where d.id = p_target_id;

  return v_other is not null and internal.may_direct_message(v_other);
end $$;

-- MAY I READ WHAT IS IN THIS TARGET.
--
-- Deliberately weaker than posting for a direct conversation: being blocked stops you WRITING, it does
-- not delete a conversation you were legitimately part of. The canonical thread reader already draws
-- that line -- it returns the messages and a separate `canSend` -- and an attachment must not vanish
-- from history that its recipient can still read.
create or replace function internal.can_read_message_target(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns boolean
language sql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
  select case
    when p_target_id is null then false
    when p_target_type = 'fixture' then internal.can_access_fixture_conversation(p_target_id, null)
    when p_target_type = 'fixture_request' then internal.can_access_fixture_conversation(null, p_target_id)
    else internal.can_view_direct_conversation(p_target_id)
  end
$$;

-- The same question asked of a MESSAGE rather than a target, for the attachment tables' own policies.
-- One function so the three of them cannot drift, which is how `fixture_message_document_refs` came to
-- use a narrower predicate than `fixture_message_attachments` beside it.
create or replace function internal.can_read_attached_message(p_message_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
  select exists (
    select 1 from public.fixture_messages m
    where m.id = p_message_id
      and (
        (m.direct_conversation_id is not null and internal.can_view_direct_conversation(m.direct_conversation_id))
        or (m.direct_conversation_id is null
            and internal.can_access_any_conversation(m.fixture_id, m.fixture_request_id, m.club_conversation_id))
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. STORAGE: ONE NAMESPACE PER TARGET, AND THE FOLDER IS THE AUTHORITY
-- ---------------------------------------------------------------------------
--
-- `f/<fixture>/…` and `r/<request>/…` already existed. `d/<direct-conversation>/…` joins them, keeping
-- the property that makes the scheme work: the FIRST TWO SEGMENTS name a conversation, so the policy
-- can answer "may this person touch this object" without consulting any row that references it. An
-- object uploaded before its message exists is therefore already protected, which is what makes
-- upload-then-link safe.
create or replace function internal.message_target_storage_prefix(p_target_type public.message_target_type)
returns text
language sql immutable
as $$
  select case p_target_type
    when 'fixture' then 'f'
    when 'fixture_request' then 'r'
    else 'd'
  end
$$;

create or replace function internal.can_access_message_attachment_path(p_object_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_parts text[];
  v_type public.message_target_type;
  v_id uuid;
begin
  v_parts := storage.foldername(p_object_name);
  if array_length(v_parts, 1) < 2 then
    return false;
  end if;

  v_type := case v_parts[1]
    when 'f' then 'fixture'::public.message_target_type
    when 'r' then 'fixture_request'::public.message_target_type
    when 'd' then 'direct'::public.message_target_type
    else null
  end;
  if v_type is null then
    return false;
  end if;

  v_id := v_parts[2]::uuid;
  return case when p_write
    then internal.can_post_to_message_target(v_type, v_id)
    else internal.can_read_message_target(v_type, v_id)
  end;
exception when invalid_text_representation then
  -- A folder that is not a uuid is refused rather than raised: a policy that errors tells a prober
  -- something, and a malformed path is simply not a path anybody is entitled to.
  return false;
end $$;

-- The one-argument name kept, with READ semantics, because the previous storage policies and the
-- existing test suite both call it. It is now a wrapper rather than a second implementation.
create or replace function internal.can_access_fixture_attachment_path(p_object_name text)
returns boolean
language sql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
  select internal.can_access_message_attachment_path(p_object_name, false)
$$;

drop policy if exists fixture_attachments_storage_insert on storage.objects;
drop policy if exists fixture_attachments_storage_select on storage.objects;

create policy fixture_attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fixture-attachments' and internal.can_access_message_attachment_path(name, true));

create policy fixture_attachments_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'fixture-attachments' and internal.can_access_message_attachment_path(name, false));

-- ---------------------------------------------------------------------------
-- 4. WHICH CLUB'S MESSAGE POLICY APPLIES
-- ---------------------------------------------------------------------------
--
-- A club may turn image uploads, attachments, document sharing or contact cards off. On a fixture the
-- answering club is the one the sender is party to through that fixture. A direct conversation has no
-- fixture, so the answer is the club the two people actually share -- the relationship that made the
-- conversation legitimate in the first place -- and failing that the sender's own. With neither, the
-- platform default applies, which is what `get_effective_message_policy(null)` already returns.
create or replace function internal.resolve_my_message_policy_club(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns uuid
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_other uuid;
  v_club uuid;
begin
  if p_target_type = 'fixture' then
    return internal.resolve_my_fixture_club_id(p_target_id, null);
  elsif p_target_type = 'fixture_request' then
    return internal.resolve_my_fixture_club_id(null, p_target_id);
  end if;

  select case when d.user_a = auth.uid() then d.user_b else d.user_a end
    into v_other
  from public.direct_conversations d where d.id = p_target_id;

  select a.club_id into v_club
  from internal.messaging_club_ids(auth.uid()) a
  join internal.messaging_club_ids(v_other) b on b.club_id = a.club_id
  limit 1;

  if v_club is null then
    select cm.club_id into v_club
    from public.club_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'active'
    limit 1;
  end if;
  return v_club;
end $$;

-- ---------------------------------------------------------------------------
-- 5. SEEING A DOCUMENT IS NOT BEING ALLOWED TO SHARE IT
-- ---------------------------------------------------------------------------
--
-- On a fixture conversation the two sides are operational contacts at two clubs, and the existing rule
-- -- you may share what you may view, if your club allows library sharing -- has stood.
--
-- A DIRECT CONVERSATION IS A DIFFERENT AUDIENCE. The people somebody may direct-message include adults
-- at their own club who are not fixture contacts at all. `club_documents.category` is the library's own
-- classification and every value but one is plainly visitor-facing: a visitor guide, fixture
-- information, ground and pitch information, parking, match-day information, an image. `other` is the
-- catch-all, which is precisely where a document nobody categorised ends up -- a finance paper, a
-- safeguarding note, a committee minute. So `other` is REFUSED for a direct conversation.
--
-- This fails closed, and deliberately fails closed on the SAFE side of a judgement the platform cannot
-- make: a genuinely shareable document in `other` is fixed by categorising it, which is a thirty-second
-- act with an owner, while a mis-shared confidential one is not fixable at all.
create or replace function internal.may_share_document_to_target(
  p_document_id uuid,
  p_target_type public.message_target_type,
  p_target_id uuid
) returns boolean
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare v_doc public.club_documents;
begin
  select * into v_doc from public.club_documents where id = p_document_id and archived_at is null;
  if not found then
    return false;
  end if;
  if not internal.can_view_document_library(v_doc.club_id, v_doc.directory_id) then
    return false;
  end if;
  if p_target_type <> 'direct' then
    return true;
  end if;
  return v_doc.category in ('visitor_guide', 'fixture_information', 'ground_pitch_information', 'parking', 'match_day_information', 'image');
end $$;

-- A DOCUMENT SHARED INTO A CONVERSATION IS READABLE BY THAT CONVERSATION.
--
-- The existing read disjunct only understood fixture and request containers, so a document shared into
-- a direct conversation would have produced a card the recipient could not open. Same rule, one more
-- container.
create or replace function internal.can_access_document_storage_path(p_object_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_owner_id uuid;
begin
  v_owner_id := (storage.foldername(p_object_name))[1]::uuid;
  if p_write then
    return internal.can_manage_document_library(
      (select id from public.clubs where id = v_owner_id),
      (select id from public.club_directory where id = v_owner_id)
    );
  end if;
  return internal.can_view_document_library(
    (select id from public.clubs where id = v_owner_id),
    (select id from public.club_directory where id = v_owner_id)
  )
  or exists (
    select 1 from public.club_documents d
    join public.fixture_message_document_refs r on r.document_id = d.id
    join public.fixture_messages m on m.id = r.message_id
    where d.storage_path = p_object_name
      and internal.can_read_attached_message(m.id)
  );
exception when invalid_text_representation then
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- 6. THE ATTACHMENT TABLES FOLLOW THE MESSAGE
-- ---------------------------------------------------------------------------
drop policy if exists fixture_message_attachments_select_scoped on public.fixture_message_attachments;
create policy fixture_message_attachments_select_scoped on public.fixture_message_attachments
  for select using (internal.can_read_attached_message(message_id));

drop policy if exists fixture_message_document_refs_select on public.fixture_message_document_refs;
create policy fixture_message_document_refs_select on public.fixture_message_document_refs
  for select using (internal.can_read_attached_message(message_id));

drop policy if exists fixture_message_contact_cards_select on public.fixture_message_contact_cards;
create policy fixture_message_contact_cards_select on public.fixture_message_contact_cards
  for select using (internal.can_read_attached_message(message_id));

-- AND THE DOCUMENT ROW ITSELF, which is the half that would have been missed.
--
-- `club_documents_select_shared` already existed: a document shared into a conversation is readable by
-- that conversation even by somebody with no standing in the club's library -- which is the whole point
-- of sharing a visitor guide with the away side. It only understood fixture containers, so a guardian
-- receiving one in a direct message got the MESSAGE and an empty card: the reference row resolved, the
-- storage object was reachable, and the title, filename and size came back null because the document
-- row itself was invisible. A card describing nothing is worse than no card.
drop policy if exists club_documents_select_shared on public.club_documents;
create policy club_documents_select_shared on public.club_documents
  for select using (
    exists (
      select 1
      from public.fixture_message_document_refs r
      join public.fixture_messages m on m.id = r.message_id
      where r.document_id = club_documents.id
        and internal.can_read_attached_message(m.id)
    )
  );

commit;

begin;

-- ---------------------------------------------------------------------------
-- 7. THE CANONICAL MUTATIONS, NAMED FOR WHAT THEY ARE
-- ---------------------------------------------------------------------------

-- ONE ATTACHMENT, ONE TARGET.
--
-- THE STORAGE PATH IS NOW CHECKED AGAINST THE TARGET, which the fixture-only version never did: it
-- accepted any path at all and linked it, so a message could claim an attachment sitting in another
-- conversation's folder. Harmless in practice only because the reader could not then fetch it -- which
-- is a broken card rather than a leak, but still a row asserting something untrue. The prefix and the
-- id must match the target this message is going into.
create or replace function public.create_message_attachment(
  p_target_type public.message_target_type,
  p_target_id uuid,
  p_body text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes integer
) returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_message_id uuid;
  v_policy record;
  v_caption text := nullif(btrim(coalesce(p_body, '')), '');
  v_is_image boolean := p_mime_type like 'image/%';
  v_expected text := internal.message_target_storage_prefix(p_target_type) || '/' || p_target_id::text || '/';
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send a message.' using errcode = '42501';
  end if;
  if not internal.can_post_to_message_target(p_target_type, p_target_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'Invalid attachment storage path.' using errcode = '42501';
  end if;
  if position(v_expected in p_storage_path) <> 1 then
    raise exception 'That attachment does not belong to this conversation.' using errcode = '42501';
  end if;

  select * into v_policy
  from public.get_effective_message_policy(internal.resolve_my_message_policy_club(p_target_type, p_target_id));

  if v_is_image and not coalesce(v_policy.allow_image_uploads, true) then
    raise exception 'Image messages are turned off.' using errcode = '42501';
  end if;
  if not v_is_image and not coalesce(v_policy.allow_direct_attachments, true) then
    raise exception 'Attachments are turned off.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (
    fixture_id, fixture_request_id, direct_conversation_id, sender_user_id, body, kind, content_type)
  values (
    case when p_target_type = 'fixture' then p_target_id end,
    case when p_target_type = 'fixture_request' then p_target_id end,
    case when p_target_type = 'direct' then p_target_id end,
    auth.uid(),
    v_caption,
    'message',
    -- `fixture_messages_content_present` requires words beside a NON-image, so a document carries its
    -- caption and an image may legitimately carry none.
    case when v_is_image then 'image' else 'text' end
  )
  returning id into v_message_id;

  insert into public.fixture_message_attachments
    (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by)
  values (v_message_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, auth.uid());

  return v_message_id;
end $$;

create or replace function public.share_message_document(
  p_target_type public.message_target_type,
  p_target_id uuid,
  p_document_id uuid,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_doc public.club_documents;
  v_message_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_post_to_message_target(p_target_type, p_target_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  select * into v_policy
  from public.get_effective_message_policy(internal.resolve_my_message_policy_club(p_target_type, p_target_id));
  if not coalesce(v_policy.allow_document_library_sharing, true) then
    raise exception 'Sharing documents from the library is turned off for your club.' using errcode = '42501';
  end if;

  select * into v_doc from public.club_documents where id = p_document_id and archived_at is null;
  if not found then
    raise exception 'Document not found.';
  end if;

  -- SEEING IT IS NOT SHARING IT. The message names the category rather than the document, so a refusal
  -- tells somebody how to fix it without confirming anything about a document they cannot see.
  if not internal.may_share_document_to_target(p_document_id, p_target_type, p_target_id) then
    if p_target_type = 'direct' and internal.can_view_document_library(v_doc.club_id, v_doc.directory_id) then
      raise exception 'Only club documents categorised for visitors and match days can be sent in a direct message.'
        using errcode = '42501';
    end if;
    raise exception 'You are not authorized to share this document.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (
    fixture_id, fixture_request_id, direct_conversation_id, sender_user_id, body)
  values (
    case when p_target_type = 'fixture' then p_target_id end,
    case when p_target_type = 'fixture_request' then p_target_id end,
    case when p_target_type = 'direct' then p_target_id end,
    auth.uid(),
    coalesce(nullif(trim(p_note), ''), format('Shared document: %s', v_doc.title))
  )
  returning id into v_message_id;

  insert into public.fixture_message_document_refs (message_id, document_id, shared_by)
  values (v_message_id, p_document_id, auth.uid());

  return v_message_id;
end $$;

-- THE CONTACT-CARD PROJECTION, AND NOTHING ELSE OF A PROFILE.
--
-- Five fields, snapshotted at the moment somebody chose to send them. The existence of a conversation
-- never entitles the other person to inspect a profile; this is an explicit act and the sender sees
-- exactly what it contains first, which is what `preview_my_message_contact_card` is for.
--
-- On a fixture the role comes from the fixture's own teams. In a direct conversation there is no
-- fixture, so it comes from the club the two people SHARE -- the relationship the conversation rests
-- on -- and the team, if any, is the sender's own within that club.
create or replace function internal.resolve_my_direct_contact_role(p_conversation_id uuid)
returns table(role_label text, club_name text, team_name text)
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_other uuid;
  v_club uuid;
begin
  select case when d.user_a = auth.uid() then d.user_b else d.user_a end
    into v_other
  from public.direct_conversations d where d.id = p_conversation_id;

  v_club := internal.resolve_my_message_policy_club('direct', p_conversation_id);
  if v_club is null then
    return;
  end if;

  return query
  select
    coalesce(
      (select case tp.permission when 'team_admin' then 'Team Admin' when 'coach' then 'Coach' when 'manager' then 'Manager' end
         from public.team_permissions tp
         join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
         join public.teams t on t.id = tp.team_id and t.club_id = v_club
        limit 1),
      (select case cm.role when 'CLUB_ADMIN' then 'Club Admin' when 'FIXTURE_SECRETARY' then 'Fixture Secretary' else 'Member' end
         from public.club_memberships cm
        where cm.user_id = auth.uid() and cm.status = 'active' and cm.club_id = v_club
        limit 1)
    ),
    (select cd.name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_club),
    (select t.display_name
       from public.team_permissions tp
       join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
       join public.teams t on t.id = tp.team_id and t.club_id = v_club
      limit 1);
end $$;

create or replace function internal.resolve_my_message_contact_role(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns table(role_label text, club_name text, team_name text)
language sql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
  select * from internal.resolve_my_fixture_contact_role(
    case when p_target_type = 'fixture' then p_target_id end,
    case when p_target_type = 'fixture_request' then p_target_id end)
  where p_target_type <> 'direct'
  union all
  select * from internal.resolve_my_direct_contact_role(p_target_id) where p_target_type = 'direct'
$$;

create or replace function public.preview_my_message_contact_card(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns table(display_name text, role_label text, club_name text, team_name text, telephone text)
language plpgsql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_read_message_target(p_target_type, p_target_id) then
    raise exception 'You are not authorized to view this conversation.' using errcode = '42501';
  end if;

  return query
    select p.first_name || ' ' || p.surname, r.role_label, r.club_name, r.team_name, p.phone_number
    from public.profiles p
    cross join internal.resolve_my_message_contact_role(p_target_type, p_target_id) r
    where p.id = auth.uid();
end $$;

create or replace function public.share_message_contact_card(
  p_target_type public.message_target_type,
  p_target_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
declare
  v_phone text;
  v_display_name text;
  v_role text;
  v_club_name text;
  v_team_name text;
  v_message_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_post_to_message_target(p_target_type, p_target_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  select * into v_policy
  from public.get_effective_message_policy(internal.resolve_my_message_policy_club(p_target_type, p_target_id));
  if not coalesce(v_policy.allow_contact_card_sharing, true) then
    raise exception 'Sharing a contact card is turned off for your club.' using errcode = '42501';
  end if;

  select p.first_name || ' ' || p.surname, p.phone_number into v_display_name, v_phone
  from public.profiles p where p.id = auth.uid();
  if v_phone is null or trim(v_phone) = '' then
    raise exception 'Your profile does not have a telephone number yet.' using errcode = 'P0001';
  end if;

  select role_label, club_name, team_name into v_role, v_club_name, v_team_name
  from internal.resolve_my_message_contact_role(p_target_type, p_target_id);
  if v_role is null then
    raise exception 'You do not have a club role to share a contact card from here.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (
    fixture_id, fixture_request_id, direct_conversation_id, sender_user_id, body)
  values (
    case when p_target_type = 'fixture' then p_target_id end,
    case when p_target_type = 'fixture_request' then p_target_id end,
    case when p_target_type = 'direct' then p_target_id end,
    auth.uid(),
    format('%s shared a contact card', v_display_name)
  )
  returning id into v_message_id;

  insert into public.fixture_message_contact_cards
    (message_id, shared_by_user_id, display_name_snapshot, role_snapshot, club_name_snapshot, team_name_snapshot, telephone_snapshot)
  values (v_message_id, auth.uid(), v_display_name, v_role, v_club_name, v_team_name, v_phone);

  return v_message_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8. THE OLD NAMES BECOME WRAPPERS
-- ---------------------------------------------------------------------------
--
-- Kept so that nothing outside this repository breaks, and so a caller found later is delegated rather
-- than silently running a second implementation. They are wrappers, not an alternative API: every rule
-- lives in the typed function.
create or replace function public.create_fixture_message_with_attachment(
  p_fixture_id uuid, p_fixture_request_id uuid, p_body text, p_storage_path text,
  p_original_filename text, p_mime_type text, p_size_bytes integer
) returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
begin
  if num_nonnulls(p_fixture_id, p_fixture_request_id) <> 1 then
    raise exception 'An attachment must name exactly one conversation.' using errcode = '42501';
  end if;
  return public.create_message_attachment(
    case when p_fixture_id is not null then 'fixture' else 'fixture_request' end::public.message_target_type,
    coalesce(p_fixture_id, p_fixture_request_id),
    p_body, p_storage_path, p_original_filename, p_mime_type, p_size_bytes);
end $$;

create or replace function public.share_fixture_document(
  p_fixture_id uuid, p_fixture_request_id uuid, p_document_id uuid, p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
begin
  if num_nonnulls(p_fixture_id, p_fixture_request_id) <> 1 then
    raise exception 'A document share must name exactly one conversation.' using errcode = '42501';
  end if;
  return public.share_message_document(
    case when p_fixture_id is not null then 'fixture' else 'fixture_request' end::public.message_target_type,
    coalesce(p_fixture_id, p_fixture_request_id), p_document_id, p_note);
end $$;

create or replace function public.share_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
begin
  if num_nonnulls(p_fixture_id, p_fixture_request_id) <> 1 then
    raise exception 'A contact card must name exactly one conversation.' using errcode = '42501';
  end if;
  return public.share_message_contact_card(
    case when p_fixture_id is not null then 'fixture' else 'fixture_request' end::public.message_target_type,
    coalesce(p_fixture_id, p_fixture_request_id));
end $$;

create or replace function public.preview_my_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns table(display_name text, role_label text, club_name text, team_name text, telephone text)
language sql stable security definer set search_path to 'public', 'internal', 'pg_temp'
as $$
  select * from public.preview_my_message_contact_card(
    case when p_fixture_id is not null then 'fixture' else 'fixture_request' end::public.message_target_type,
    coalesce(p_fixture_id, p_fixture_request_id))
$$;

-- EXECUTE, DELIBERATELY NAMED ONE BY ONE.
--
-- A row-level policy runs as the QUERYING role, so `authenticated` must be able to execute every
-- predicate a policy calls -- SECURITY DEFINER decides what the function may then see, not who may
-- call it. Without these the new policies raise "permission denied for function" rather than
-- returning false, which presents as the whole feature being broken instead of as a missing grant.
grant execute on function internal.can_post_to_message_target(public.message_target_type, uuid) to authenticated, service_role;
grant execute on function internal.can_read_message_target(public.message_target_type, uuid) to authenticated, service_role;
grant execute on function internal.can_read_attached_message(uuid) to authenticated, service_role;
grant execute on function internal.can_access_message_attachment_path(text, boolean) to authenticated, service_role;
grant execute on function internal.message_target_storage_prefix(public.message_target_type) to authenticated, service_role;
grant execute on function internal.resolve_my_message_policy_club(public.message_target_type, uuid) to authenticated, service_role;
grant execute on function internal.may_share_document_to_target(uuid, public.message_target_type, uuid) to authenticated, service_role;
grant execute on function internal.resolve_my_direct_contact_role(uuid) to authenticated, service_role;
grant execute on function internal.resolve_my_message_contact_role(public.message_target_type, uuid) to authenticated, service_role;
grant usage on type public.message_target_type to authenticated, service_role;

grant execute on function public.create_message_attachment(public.message_target_type, uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.share_message_document(public.message_target_type, uuid, uuid, text) to authenticated;
grant execute on function public.share_message_contact_card(public.message_target_type, uuid) to authenticated;
grant execute on function public.preview_my_message_contact_card(public.message_target_type, uuid) to authenticated;

commit;

begin;

-- ---------------------------------------------------------------------------
-- 9. A DELETED MESSAGE DOES NOT LEAVE A NOTIFICATION POINTING AT NOTHING
-- ---------------------------------------------------------------------------
--
-- The lifecycle invariant, found the hard way: removing messages left their notifications behind, and
-- the Messages badge went on counting them. A badge said four unread over a conversation containing
-- two, which is not a cosmetic difference -- an unread count is a promise that something is there.
--
-- TWO CASES, AND THEY ARE GENUINELY DIFFERENT.
--
-- A HARD DELETE removes the message, so a notification about it is about nothing. It goes with it.
-- Deliberately narrow: this is a foreign key expressed as a trigger because `notifications.data` is
-- jsonb rather than a column, and it does exactly what a cascade would.
--
-- A SOFT DELETE is a withdrawal, not an erasure -- the row stays as a tombstone so a reply to it still
-- makes sense. The notification stays too, because it is a true record that a message arrived. What
-- ends is the UNREAD state: nobody should be told to go and read something that has been withdrawn.
-- Marking it read rather than deleting it keeps the history and stops the false promise.
create or replace function internal.forget_notifications_for_deleted_message()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  delete from public.notifications n
   where n.data ? 'message_id'
     and (n.data->>'message_id') = old.id::text;
  return old;
end $$;

drop trigger if exists forget_notifications_for_deleted_message on public.fixture_messages;
create trigger forget_notifications_for_deleted_message
  after delete on public.fixture_messages
  for each row execute function internal.forget_notifications_for_deleted_message();

create or replace function internal.settle_notifications_for_withdrawn_message()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.notifications n
       set read_at = now()
     where n.data ? 'message_id'
       and (n.data->>'message_id') = new.id::text
       and n.read_at is null;
  end if;
  return new;
end $$;

drop trigger if exists settle_notifications_for_withdrawn_message on public.fixture_messages;
create trigger settle_notifications_for_withdrawn_message
  after update on public.fixture_messages
  for each row execute function internal.settle_notifications_for_withdrawn_message();

comment on function internal.forget_notifications_for_deleted_message() is
  'A notification about a message that no longer exists is a badge counting nothing. Narrow by design: it is the foreign key that notifications.data cannot declare.';

commit;
