-- =====================================================================
-- A MESSAGE IS TEXT, OR A PICTURE, OR BOTH
--
-- THE DEFECT THIS CLOSES
--
-- fixture_messages.body is NOT NULL, so an image with no caption had nowhere
-- to live. The send path worked around it by inventing one:
--
--     p_body := coalesce(nullif(trim(p_body), ''), 'Attached: ' || filename)
--
-- so a person who attached a photo and wrote nothing sent a message whose
-- content was the words "Attached: IMG_4821.HEIC". That is not what they
-- said. It is not what the recipient should read. And it is not a caption --
-- it is the schema's NOT NULL constraint leaking into the product as text.
--
-- WHY NOT SIMPLY MAKE body NULLABLE
--
-- Because "nullable" says nothing about what a valid message IS, and four SQL
-- functions plus four TypeScript consumers read that column expecting words.
-- Dropping the constraint would permit a row that is neither text nor
-- picture -- an empty message -- and every reader would then need its own
-- opinion about what to render.
--
-- So the column becomes nullable and a DISCRIMINATOR says which shape this
-- message is. The check then enforces the product rule directly:
--
--     text          body required
--     system_event  body required
--     image         body optional (it is the caption)
--
-- An empty message remains impossible. Every existing row is text or a system
-- event and keeps its body, so nothing is rewritten and no reader changes
-- behaviour for content that already exists.
--
-- THE ATTACHMENT ITSELF is enforced by the send path rather than by a CHECK:
-- a constraint cannot see fixture_message_attachments, and the RPC that
-- creates an image message inserts both rows in one transaction. Direct
-- inserts are RLS-gated to the same paths.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE DISCRIMINATOR
-- ---------------------------------------------------------------------
alter table public.fixture_messages
  add column if not exists content_type text not null default 'text';

-- Existing rows: a system event is a system event, everything else is text.
-- Both keep a body, so both satisfy the check added below.
update public.fixture_messages
set content_type = 'system_event'
where kind = 'system_event' and content_type <> 'system_event';

alter table public.fixture_messages
  drop constraint if exists fixture_messages_content_type_check;
alter table public.fixture_messages
  add constraint fixture_messages_content_type_check
  check (content_type in ('text', 'image', 'system_event'));

comment on column public.fixture_messages.content_type is
  'What shape this message is: text (words), image (a picture, with an optional caption in body), or system_event. Decides whether body may be null.';

-- ---------------------------------------------------------------------
-- 2. BODY BECOMES OPTIONAL -- FOR PICTURES ONLY
-- ---------------------------------------------------------------------
alter table public.fixture_messages alter column body drop not null;

alter table public.fixture_messages
  drop constraint if exists fixture_messages_content_present;
alter table public.fixture_messages
  add constraint fixture_messages_content_present
  check (
    -- A picture may speak for itself; its body, when present, is a caption.
    content_type = 'image'
    -- Everything else must actually say something. btrim so that a message of
    -- three spaces is not a message.
    or (body is not null and btrim(body) <> '')
  );

comment on constraint fixture_messages_content_present on public.fixture_messages is
  'A message is text, a picture, or both -- never nothing. Text and system events require a body; an image may omit one because the picture is the content.';

-- ---------------------------------------------------------------------
-- 3. THE SEND PATH STOPS INVENTING WORDS
-- ---------------------------------------------------------------------
-- Same signature, same authorisation, same attachment handling. The only
-- change is that an empty caption is now stored as an empty caption rather
-- than as a sentence the sender never wrote.
create or replace function public.create_fixture_message_with_attachment(
  p_fixture_id uuid,
  p_fixture_request_id uuid,
  p_body text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_message_id uuid;
  v_policy record;
  v_caption text := nullif(btrim(coalesce(p_body, '')), '');
  v_is_image boolean := p_mime_type like 'image/%';
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send a message.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  -- Feature policy, resolved the canonical way: platform ceiling, then club
  -- override where the platform allows one.
  select * into v_policy
  from public.get_effective_message_policy(internal.resolve_my_fixture_club_id(p_fixture_id, p_fixture_request_id));

  if v_is_image and not coalesce(v_policy.allow_image_uploads, true) then
    raise exception 'Image messages are turned off.' using errcode = '42501';
  end if;
  if not v_is_image and not coalesce(v_policy.allow_direct_attachments, true) then
    raise exception 'Attachments are turned off.' using errcode = '42501';
  end if;

  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'Invalid attachment storage path.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind, content_type)
  values (
    p_fixture_id,
    p_fixture_request_id,
    auth.uid(),
    v_caption,
    'message',
    -- A non-image attachment still needs words, because a filename is not a
    -- message; the check above enforces that rather than this function.
    case when v_is_image then 'image' else 'text' end
  )
  returning id into v_message_id;

  insert into public.fixture_message_attachments
    (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by)
  values
    (v_message_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, auth.uid());

  return v_message_id;
end;
$$;

revoke all on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) to authenticated;
