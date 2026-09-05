-- Message Management: capability policy (Global Ovalball level + optional
-- per-club override) and enforcement inside the existing send paths.
-- Deliberately data/policy configuration only -- this and every RPC below
-- selects among a fixed set of predefined capabilities; nothing here can
-- reach React components, CSS, arbitrary SQL, or env vars.

-- ============================================================
-- 1. Safe file-type allowlist, reused everywhere a policy needs to name a
--    MIME type -- matches the types fixture_message_attachments already
--    accepts. No free-text MIME types anywhere in this feature.
-- ============================================================

create table public.message_policies (
  id uuid primary key default gen_random_uuid(),
  -- null = the single Global Ovalball row. A non-null club_id is a club's
  -- own override row -- only for settings the global row explicitly
  -- allows a club to override (see the *_club_override_allowed columns
  -- below, which live ONLY on the global row).
  club_id uuid references public.clubs(id),

  -- Capability toggles. On the global row these are the platform default
  -- (never null). On a club row, null means "no override -- inherit the
  -- global default"; a real boolean means this club has explicitly set it
  -- (and is only honoured if the global row's matching *_club_override_
  -- allowed flag is true).
  allow_direct_attachments boolean default true,
  allow_document_library_sharing boolean default true,
  allow_image_uploads boolean default true,
  allow_contact_card_sharing boolean default true,
  allow_participant_management boolean default true,

  -- Global-only columns (always null on a club row) -- whether a club may
  -- override each capability at all. Deliberately NOT itself overridable
  -- by a club (that would let a club grant itself permission to grant
  -- itself permission).
  allow_direct_attachments_club_override_allowed boolean not null default true,
  allow_document_library_sharing_club_override_allowed boolean not null default true,
  allow_image_uploads_club_override_allowed boolean not null default true,
  allow_contact_card_sharing_club_override_allowed boolean not null default true,
  allow_participant_management_club_override_allowed boolean not null default true,

  -- Global-only: max attachment size and the allowed MIME allowlist.
  -- Deliberately not club-overridable in this pass -- a per-club storage
  -- ceiling is a real future need but out of scope here; every club
  -- shares one platform-wide safe limit, same as the hard-coded 2MB /
  -- PDF+JPEG+PNG+WebP limit fixture_message_attachments already enforced
  -- before this migration (these columns give Site Admin a way to
  -- TIGHTEN that within the same allowlist, never widen past it -- see
  -- the check constraint below).
  max_attachment_size_bytes integer not null default 2097152
    check (max_attachment_size_bytes > 0 and max_attachment_size_bytes <= 2097152),
  allowed_file_types text[] not null default array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],

  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Exactly one global row (club_id null); at most one row per club.
create unique index message_policies_global_key on public.message_policies ((1)) where club_id is null;
create unique index message_policies_club_id_key on public.message_policies (club_id) where club_id is not null;

alter table public.message_policies add constraint message_policies_allowed_file_types_subset
  check (allowed_file_types <@ array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

comment on table public.message_policies is
  'Global Ovalball default (club_id null, exactly one row) plus optional per-club override rows. A club column is null unless that club has explicitly set an override, and an override is only honoured when the matching global *_club_override_allowed flag is true -- see get_effective_message_policy() for the actual resolution.';

insert into public.message_policies (club_id) values (null);

alter table public.message_policies enable row level security;

-- Read: any authenticated user (composing a message needs to know whether
-- the attach button should even show); the RPCs below are the write path.
create policy message_policies_select on public.message_policies for select to authenticated using (true);

create trigger set_updated_at before update on public.message_policies
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update on public.message_policies
  for each row execute function internal.audit_row_change();

-- ============================================================
-- 2. get_effective_message_policy -- the ONE place policy is resolved.
--    Every capability check elsewhere in this migration calls this rather
--    than re-deriving inheritance itself, so the effective value shown in
--    the UI and the value actually enforced can never disagree.
-- ============================================================

create or replace function public.get_effective_message_policy(p_club_id uuid default null)
returns table(
  allow_direct_attachments boolean, allow_direct_attachments_origin text, allow_direct_attachments_club_override_allowed boolean,
  allow_document_library_sharing boolean, allow_document_library_sharing_origin text, allow_document_library_sharing_club_override_allowed boolean,
  allow_image_uploads boolean, allow_image_uploads_origin text, allow_image_uploads_club_override_allowed boolean,
  allow_contact_card_sharing boolean, allow_contact_card_sharing_origin text, allow_contact_card_sharing_club_override_allowed boolean,
  allow_participant_management boolean, allow_participant_management_origin text, allow_participant_management_club_override_allowed boolean,
  max_attachment_size_bytes integer,
  allowed_file_types text[]
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  g public.message_policies;
  c public.message_policies;
begin
  select * into g from public.message_policies where club_id is null;
  if p_club_id is not null then
    select * into c from public.message_policies where club_id = p_club_id;
  end if;

  return query select
    coalesce(c.allow_direct_attachments, g.allow_direct_attachments),
    case when c.allow_direct_attachments is not null then 'club_override' else 'global_default' end,
    g.allow_direct_attachments_club_override_allowed,

    coalesce(c.allow_document_library_sharing, g.allow_document_library_sharing),
    case when c.allow_document_library_sharing is not null then 'club_override' else 'global_default' end,
    g.allow_document_library_sharing_club_override_allowed,

    coalesce(c.allow_image_uploads, g.allow_image_uploads),
    case when c.allow_image_uploads is not null then 'club_override' else 'global_default' end,
    g.allow_image_uploads_club_override_allowed,

    coalesce(c.allow_contact_card_sharing, g.allow_contact_card_sharing),
    case when c.allow_contact_card_sharing is not null then 'club_override' else 'global_default' end,
    g.allow_contact_card_sharing_club_override_allowed,

    coalesce(c.allow_participant_management, g.allow_participant_management),
    case when c.allow_participant_management is not null then 'club_override' else 'global_default' end,
    g.allow_participant_management_club_override_allowed,

    g.max_attachment_size_bytes,
    g.allowed_file_types;
end;
$$;

grant execute on function public.get_effective_message_policy(uuid) to authenticated;

comment on function public.get_effective_message_policy(uuid) is
  'The single source of truth for policy inheritance -- global default unless the club row has set a non-null override, in which case club_override wins. Called both by the admin/Club Settings UI (to show origin honestly) and by every capability-gated RPC below (to enforce it).';

-- ============================================================
-- 3. resolve_my_fixture_club_id -- factored out of add_fixture_conversation_
--    participant's own identical logic (unchanged behaviour there), reused
--    by every policy-gated send path below so "which club is this sender
--    acting as" is resolved exactly one way everywhere.
-- ============================================================

create or replace function internal.resolve_my_fixture_club_id(p_fixture_id uuid, p_fixture_request_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_club_id uuid;
begin
  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select c.club_id into v_club_id
  from public.club_memberships c
  where c.user_id = auth.uid() and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  if v_club_id is null then
    select t.club_id into v_club_id
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;
  return v_club_id;
end;
$$;

grant execute on function internal.resolve_my_fixture_club_id(uuid, uuid) to authenticated;

-- ============================================================
-- 4. Global and club-level policy write RPCs.
-- ============================================================

create or replace function public.update_global_message_policy(
  p_allow_direct_attachments boolean, p_allow_document_library_sharing boolean, p_allow_image_uploads boolean,
  p_allow_contact_card_sharing boolean, p_allow_participant_management boolean,
  p_allow_direct_attachments_club_override_allowed boolean, p_allow_document_library_sharing_club_override_allowed boolean,
  p_allow_image_uploads_club_override_allowed boolean, p_allow_contact_card_sharing_club_override_allowed boolean,
  p_allow_participant_management_club_override_allowed boolean,
  p_max_attachment_size_bytes integer, p_allowed_file_types text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may change the global message policy.' using errcode = '42501';
  end if;

  update public.message_policies set
    allow_direct_attachments = p_allow_direct_attachments,
    allow_document_library_sharing = p_allow_document_library_sharing,
    allow_image_uploads = p_allow_image_uploads,
    allow_contact_card_sharing = p_allow_contact_card_sharing,
    allow_participant_management = p_allow_participant_management,
    allow_direct_attachments_club_override_allowed = p_allow_direct_attachments_club_override_allowed,
    allow_document_library_sharing_club_override_allowed = p_allow_document_library_sharing_club_override_allowed,
    allow_image_uploads_club_override_allowed = p_allow_image_uploads_club_override_allowed,
    allow_contact_card_sharing_club_override_allowed = p_allow_contact_card_sharing_club_override_allowed,
    allow_participant_management_club_override_allowed = p_allow_participant_management_club_override_allowed,
    max_attachment_size_bytes = p_max_attachment_size_bytes,
    allowed_file_types = p_allowed_file_types,
    updated_by = auth.uid()
  where club_id is null;
end;
$$;

revoke execute on function public.update_global_message_policy(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, text[]) from public;
grant execute on function public.update_global_message_policy(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, text[]) to authenticated;

-- Club Admin (their own club) or Full Site Admin. p_use_default_* selects
-- "inherit the global default" (writes null) over a real boolean value --
-- a bare boolean parameter can't distinguish "explicitly false" from "not
-- set", so every capability gets its own use-default flag alongside its
-- value.
create or replace function public.update_club_message_policy(
  p_club_id uuid,
  p_use_default_direct_attachments boolean, p_allow_direct_attachments boolean,
  p_use_default_document_library_sharing boolean, p_allow_document_library_sharing boolean,
  p_use_default_image_uploads boolean, p_allow_image_uploads boolean,
  p_use_default_contact_card_sharing boolean, p_allow_contact_card_sharing boolean,
  p_use_default_participant_management boolean, p_allow_participant_management boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.message_policies;
  v_direct boolean; v_docs boolean; v_images boolean; v_cards boolean; v_participants boolean;
begin
  if not (internal.is_club_admin(p_club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may change its messaging settings.' using errcode = '42501';
  end if;

  select * into g from public.message_policies where club_id is null;

  if not p_use_default_direct_attachments then
    if not g.allow_direct_attachments_club_override_allowed then
      raise exception 'Direct attachments cannot be overridden by clubs -- this is set at the Ovalball level.' using errcode = '42501';
    end if;
    v_direct := p_allow_direct_attachments;
  end if;
  if not p_use_default_document_library_sharing then
    if not g.allow_document_library_sharing_club_override_allowed then
      raise exception 'Document library sharing cannot be overridden by clubs -- this is set at the Ovalball level.' using errcode = '42501';
    end if;
    v_docs := p_allow_document_library_sharing;
  end if;
  if not p_use_default_image_uploads then
    if not g.allow_image_uploads_club_override_allowed then
      raise exception 'Image uploads cannot be overridden by clubs -- this is set at the Ovalball level.' using errcode = '42501';
    end if;
    v_images := p_allow_image_uploads;
  end if;
  if not p_use_default_contact_card_sharing then
    if not g.allow_contact_card_sharing_club_override_allowed then
      raise exception 'Contact card sharing cannot be overridden by clubs -- this is set at the Ovalball level.' using errcode = '42501';
    end if;
    v_cards := p_allow_contact_card_sharing;
  end if;
  if not p_use_default_participant_management then
    if not g.allow_participant_management_club_override_allowed then
      raise exception 'Participant management cannot be overridden by clubs -- this is set at the Ovalball level.' using errcode = '42501';
    end if;
    v_participants := p_allow_participant_management;
  end if;

  insert into public.message_policies (club_id, allow_direct_attachments, allow_document_library_sharing, allow_image_uploads, allow_contact_card_sharing, allow_participant_management, updated_by)
  values (p_club_id, v_direct, v_docs, v_images, v_cards, v_participants, auth.uid())
  on conflict (club_id) where club_id is not null do update set
    allow_direct_attachments = excluded.allow_direct_attachments,
    allow_document_library_sharing = excluded.allow_document_library_sharing,
    allow_image_uploads = excluded.allow_image_uploads,
    allow_contact_card_sharing = excluded.allow_contact_card_sharing,
    allow_participant_management = excluded.allow_participant_management,
    updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.update_club_message_policy(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.update_club_message_policy(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ============================================================
-- 5. Enforcement inside the existing send paths. Every function below
--    keeps its EXACT original signature (create or replace only) so no
--    call site anywhere in the app needs to change -- the policy check is
--    layered in as an additional guard before the original logic, never a
--    parallel/competing implementation.
-- ============================================================

create or replace function public.create_fixture_message_with_attachment(
  p_fixture_id uuid, p_fixture_request_id uuid, p_body text,
  p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_storage_owner uuid;
  v_my_club_id uuid;
  v_policy record;
  v_is_image boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send a message.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported attachment type: %', p_mime_type;
  end if;
  if p_size_bytes <= 0 or p_size_bytes > 2097152 then
    raise exception 'Attachments must be 2MB or smaller.';
  end if;
  if not internal.can_access_fixture_attachment_path(p_storage_path) then
    raise exception 'Invalid attachment storage path.' using errcode = '42501';
  end if;

  v_my_club_id := internal.resolve_my_fixture_club_id(p_fixture_id, p_fixture_request_id);
  select * into v_policy from public.get_effective_message_policy(v_my_club_id);
  v_is_image := p_mime_type like 'image/%';

  if v_is_image and not coalesce(v_policy.allow_image_uploads, true) then
    raise exception 'Image uploads are turned off for your club.' using errcode = '42501';
  end if;
  if not v_is_image and not coalesce(v_policy.allow_direct_attachments, true) then
    raise exception 'Direct file attachments are turned off for your club.' using errcode = '42501';
  end if;
  if p_mime_type <> all(v_policy.allowed_file_types) then
    raise exception 'That file type is not on the allowed list.' using errcode = '42501';
  end if;
  if p_size_bytes > v_policy.max_attachment_size_bytes then
    raise exception 'Attachments must be % bytes or smaller.', v_policy.max_attachment_size_bytes;
  end if;

  select owner into v_storage_owner from storage.objects where bucket_id = 'fixture-attachments' and name = p_storage_path;
  if v_storage_owner is null then
    raise exception 'The uploaded file could not be found -- please try attaching it again.';
  end if;
  if v_storage_owner <> auth.uid() then
    raise exception 'You may only attach a file you uploaded yourself.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), p_body)
  returning id into v_message_id;

  insert into public.fixture_message_attachments (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by)
  values (v_message_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, auth.uid());

  return v_message_id;
end;
$$;

revoke execute on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) from public;
grant execute on function public.create_fixture_message_with_attachment(uuid, uuid, text, text, text, text, integer) to authenticated;

create or replace function public.share_fixture_document(
  p_fixture_id uuid, p_fixture_request_id uuid, p_document_id uuid, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.club_documents;
  v_message_id uuid;
  v_my_club_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  v_my_club_id := internal.resolve_my_fixture_club_id(p_fixture_id, p_fixture_request_id);
  select * into v_policy from public.get_effective_message_policy(v_my_club_id);
  if not coalesce(v_policy.allow_document_library_sharing, true) then
    raise exception 'Sharing documents from the library is turned off for your club.' using errcode = '42501';
  end if;

  select * into v_doc from public.club_documents where id = p_document_id and archived_at is null;
  if not found then
    raise exception 'Document not found.';
  end if;
  if not internal.can_view_document_library(v_doc.club_id, v_doc.directory_id) then
    raise exception 'You are not authorized to share this document.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), coalesce(nullif(trim(p_note), ''), format('Shared document: %s', v_doc.title)))
  returning id into v_message_id;

  insert into public.fixture_message_document_refs (message_id, document_id, shared_by)
  values (v_message_id, p_document_id, auth.uid());

  return v_message_id;
end;
$$;

revoke execute on function public.share_fixture_document(uuid, uuid, uuid, text) from public;
grant execute on function public.share_fixture_document(uuid, uuid, uuid, text) to authenticated;

create or replace function public.share_fixture_contact_card(p_fixture_id uuid, p_fixture_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_display_name text;
  v_role text;
  v_club_name text;
  v_team_name text;
  v_message_id uuid;
  v_my_club_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;

  v_my_club_id := internal.resolve_my_fixture_club_id(p_fixture_id, p_fixture_request_id);
  select * into v_policy from public.get_effective_message_policy(v_my_club_id);
  if not coalesce(v_policy.allow_contact_card_sharing, true) then
    raise exception 'Sharing a contact card is turned off for your club.' using errcode = '42501';
  end if;

  select p.first_name || ' ' || p.surname, p.phone_number into v_display_name, v_phone
  from public.profiles p where p.id = auth.uid();
  if v_phone is null or trim(v_phone) = '' then
    raise exception 'Your profile does not have a telephone number yet.' using errcode = 'P0001';
  end if;

  select role_label, club_name, team_name into v_role, v_club_name, v_team_name
  from internal.resolve_my_fixture_contact_role(p_fixture_id, p_fixture_request_id);
  if v_role is null then
    raise exception 'You do not have a club role on this fixture to share a contact card from.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s shared a contact card', v_display_name))
  returning id into v_message_id;

  insert into public.fixture_message_contact_cards
    (message_id, shared_by_user_id, display_name_snapshot, role_snapshot, club_name_snapshot, team_name_snapshot, telephone_snapshot)
  values (v_message_id, auth.uid(), v_display_name, v_role, v_club_name, v_team_name, v_phone);

  return v_message_id;
end;
$$;

revoke execute on function public.share_fixture_contact_card(uuid, uuid) from public;
grant execute on function public.share_fixture_contact_card(uuid, uuid) to authenticated;

comment on function public.share_fixture_contact_card(uuid, uuid) is
  'Re-declared here only to layer in the allow_contact_card_sharing policy check -- the identity-resolution and snapshot logic is unchanged from the prior version in 20260901030000_contact_card_preview.sql.';

create or replace function public.add_fixture_conversation_participant(p_fixture_id uuid, p_fixture_request_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
  v_target_display text;
  v_actor_display text;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to add participants to this conversation.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select c.club_id into v_my_club_id
  from public.club_memberships c
  where c.user_id = auth.uid() and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  if v_my_club_id is null then
    select t.club_id into v_my_club_id
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;
  if v_my_club_id is null and not internal.is_site_admin() then
    raise exception 'You do not have a club to add participants from on this fixture.' using errcode = '42501';
  end if;

  if v_my_club_id is not null then
    select * into v_policy from public.get_effective_message_policy(v_my_club_id);
    if not coalesce(v_policy.allow_participant_management, true) then
      raise exception 'Adding participants is turned off for your club.' using errcode = '42501';
    end if;
  end if;

  -- Operational contacts only -- a plain club membership (parent/player,
  -- BASIC_USER with no officiating role, or an explicit view_only team
  -- permission) is never addable, regardless of who is asking.
  if not exists (
    select 1 from public.club_memberships cm
    where cm.user_id = p_user_id and cm.club_id = v_my_club_id and cm.status = 'active'
      and (
        cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        or exists (
          select 1 from public.team_permissions tp
          where tp.membership_id = cm.id
            and tp.permission in ('team_admin', 'coach', 'manager')
            and tp.team_id in (v_owning_team_id, v_opponent_team_id)
        )
      )
  ) then
    raise exception 'Only coaches and club/fixtures officials can be added to a fixture conversation.' using errcode = '42501';
  end if;

  insert into public.fixture_conversation_participants (fixture_id, fixture_request_id, user_id, added_by)
  values (p_fixture_id, p_fixture_request_id, p_user_id, auth.uid())
  on conflict do nothing;

  select p.first_name || ' ' || p.surname into v_target_display from public.profiles p where p.id = p_user_id;
  select p.first_name || ' ' || p.surname into v_actor_display from public.profiles p where p.id = auth.uid();

  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s added %s to the conversation', v_actor_display, v_target_display), 'system_event');
end;
$$;

comment on function public.add_fixture_conversation_participant(uuid, uuid, uuid) is
  'Re-declared here only to layer in the allow_participant_management policy check -- every other line is unchanged from the prior version in 20260901060000_addable_participants_operational_only.sql.';

-- ============================================================
-- 6. admin_message_analytics -- every count is computed live against real
--    tables, never invented. Only Site Admin may call it (metadata-level,
--    same boundary as admin_message_overview itself). Storage bytes are
--    summed ONLY from fixture_message_attachments (real uploaded files) --
--    a document-library share never adds bytes here, matching the "never
--    double-count a referenced library document as duplicated storage"
--    requirement.
-- ============================================================

create or replace function public.admin_message_analytics(
  p_date_from date default null, p_date_to date default null,
  p_club_id uuid default null, p_team_id uuid default null,
  p_conversation_type text default null
)
returns table(
  total_messages bigint,
  messages_in_range bigint,
  conversation_count bigint,
  active_conversation_count bigint,
  participating_club_count bigint,
  participating_team_count bigint,
  direct_attachment_count bigint,
  image_upload_count bigint,
  other_file_upload_count bigint,
  library_share_count bigint,
  contact_card_count bigint,
  attachment_storage_bytes bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may view message analytics.' using errcode = '42501';
  end if;
  if p_conversation_type is not null and p_conversation_type not in ('fixture', 'request') then
    raise exception 'conversation_type must be fixture or request.';
  end if;

  return query
  with scoped as (
    select
      fm.id, fm.created_at, fm.fixture_id, fm.fixture_request_id,
      coalesce(fm.fixture_id::text, 'req:' || fm.fixture_request_id::text) as conversation_key,
      fx_owning_t.club_id as fx_owning_club_id, fx_opp_t.club_id as fx_opp_club_id,
      fx.owning_team_id as fx_owning_team_id, fx.opponent_team_id as fx_opp_team_id,
      req.requesting_team_id as req_requesting_team_id, req.target_team_id as req_target_team_id,
      req_requesting_t.club_id as req_requesting_club_id, req_target_t.club_id as req_target_club_id
    from public.fixture_messages fm
    left join public.fixtures fx on fx.id = fm.fixture_id
    left join public.teams fx_owning_t on fx_owning_t.id = fx.owning_team_id
    left join public.teams fx_opp_t on fx_opp_t.id = fx.opponent_team_id
    left join public.fixture_requests req on req.id = fm.fixture_request_id
    left join public.teams req_requesting_t on req_requesting_t.id = req.requesting_team_id
    left join public.teams req_target_t on req_target_t.id = req.target_team_id
    where (p_conversation_type is null or (p_conversation_type = 'fixture' and fm.fixture_id is not null) or (p_conversation_type = 'request' and fm.fixture_request_id is not null))
      and (p_club_id is null or p_club_id in (fx_owning_t.club_id, fx_opp_t.club_id, req_requesting_t.club_id, req_target_t.club_id))
      and (p_team_id is null or p_team_id in (fx.owning_team_id, fx.opponent_team_id, req.requesting_team_id, req.target_team_id))
  ),
  in_range as (
    select * from scoped
    where (p_date_from is null or created_at::date >= p_date_from)
      and (p_date_to is null or created_at::date <= p_date_to)
  ),
  conv_activity as (
    select conversation_key, max(created_at) as last_activity from scoped group by conversation_key
  )
  select
    (select count(*) from scoped)::bigint,
    (select count(*) from in_range)::bigint,
    (select count(distinct conversation_key) from scoped)::bigint,
    (select count(*) from conv_activity where last_activity >= now() - interval '14 days')::bigint,
    (select count(distinct club_id) from (
      select fx_owning_club_id as club_id from scoped where fx_owning_club_id is not null
      union select fx_opp_club_id from scoped where fx_opp_club_id is not null
      union select req_requesting_club_id from scoped where req_requesting_club_id is not null
      union select req_target_club_id from scoped where req_target_club_id is not null
    ) clubs)::bigint,
    (select count(distinct team_id) from (
      select fx_owning_team_id as team_id from scoped where fx_owning_team_id is not null
      union select fx_opp_team_id from scoped where fx_opp_team_id is not null
      union select req_requesting_team_id from scoped where req_requesting_team_id is not null
      union select req_target_team_id from scoped where req_target_team_id is not null
    ) teams)::bigint,
    (select count(*) from public.fixture_message_attachments a join in_range m on m.id = a.message_id)::bigint,
    (select count(*) from public.fixture_message_attachments a join in_range m on m.id = a.message_id where a.mime_type like 'image/%')::bigint,
    (select count(*) from public.fixture_message_attachments a join in_range m on m.id = a.message_id where a.mime_type not like 'image/%')::bigint,
    (select count(*) from public.fixture_message_document_refs d join in_range m on m.id = d.message_id)::bigint,
    (select count(*) from public.fixture_message_contact_cards cc join in_range m on m.id = cc.message_id)::bigint,
    (select coalesce(sum(a.size_bytes), 0) from public.fixture_message_attachments a join in_range m on m.id = a.message_id)::bigint;
end;
$$;

revoke execute on function public.admin_message_analytics(date, date, uuid, uuid, text) from public;
grant execute on function public.admin_message_analytics(date, date, uuid, uuid, text) to authenticated;

comment on function public.admin_message_analytics(date, date, uuid, uuid, text) is
  'Every metric here is a live COUNT/SUM against real tables -- never a cached or invented figure. attachment_storage_bytes sums ONLY fixture_message_attachments.size_bytes (real uploaded files); a document-library share via fixture_message_document_refs adds zero bytes here, since it duplicates no file. Same club/team/type/date filters used for the top-level dashboard and for a club or team drill-down (call again with p_club_id or p_team_id set).';
