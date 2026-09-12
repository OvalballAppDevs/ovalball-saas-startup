-- =====================================================================
-- BLOCKING IS NOT AN ADMINISTRATOR'S DECISION
--
-- 20270243000000 added allow_personal_blocking alongside the other
-- communication feature switches. The audit found it has NO consumer: no
-- resolver reads it, no RLS policy mentions it, no screen exposes it. It is
-- dead configuration.
--
-- There are two ways to resolve that, and they are not equivalent.
--
--   WIRE IT UP   would mean an administrator can take away a person's ability
--                to refuse contact from another person. Personal blocking is
--                a safety control belonging to the individual: the whole
--                reason it is separate from club_message_blocks is that a
--                club moderating someone and a person declining contact are
--                different decisions with different owners. A switch that
--                lets the club decide the second one inverts who the
--                protection is for.
--
--   RETIRE IT    leaves personal blocking always available, which is what the
--                product already does in practice and what the platform-only
--                constraint on this flag was already gesturing at.
--
-- Retired. The column is dropped rather than left in place, because dead
-- configuration is not harmless: the next person to find it reasonably
-- assumes it works, and wires a screen to a switch that controls nothing.
--
-- WHAT IS DELIBERATELY KEPT
--
-- allow_platform_announcements keeps its platform-only constraint. That one
-- is genuinely Ovalball's to hold and genuinely does something. Only the
-- blocking half of that constraint goes.
-- =====================================================================

-- The constraint named both platform-only flags; it is rewritten to name only
-- the one that survives.
alter table public.message_policies
  drop constraint if exists message_policies_platform_only_overrides;
alter table public.message_policies
  drop constraint if exists message_policies_platform_only_not_club_held;

alter table public.message_policies
  drop column if exists allow_personal_blocking,
  drop column if exists allow_personal_blocking_club_override_allowed;

alter table public.message_policies
  add constraint message_policies_platform_only_overrides check (
    allow_platform_announcements_club_override_allowed = false
  );

alter table public.message_policies
  add constraint message_policies_platform_only_not_club_held check (
    club_id is null or allow_platform_announcements is null
  );

comment on table public.message_policies is
  'Messaging feature policy: one platform row (club_id is null) and one row per club that has an opinion. Personal blocking is deliberately NOT here -- an individual''s ability to decline contact from another individual is not an administrator''s setting.';

-- ---------------------------------------------------------------------
-- THE RESOLVER LOSES THE COLUMN WITH IT
-- ---------------------------------------------------------------------
-- get_effective_message_policy returned allow_personal_blocking and its
-- origin. Dropping the column means the function has to be rebuilt; the
-- remaining columns keep their names, order and meaning, so existing callers
-- are unaffected.
drop function if exists public.get_effective_message_policy(uuid);

create function public.get_effective_message_policy(p_club_id uuid default null)
returns table (
  allow_direct_attachments boolean,
  allow_direct_attachments_origin text,
  allow_direct_attachments_club_override_allowed boolean,
  allow_document_library_sharing boolean,
  allow_document_library_sharing_origin text,
  allow_document_library_sharing_club_override_allowed boolean,
  allow_image_uploads boolean,
  allow_image_uploads_origin text,
  allow_image_uploads_club_override_allowed boolean,
  allow_contact_card_sharing boolean,
  allow_contact_card_sharing_origin text,
  allow_contact_card_sharing_club_override_allowed boolean,
  allow_participant_management boolean,
  allow_participant_management_origin text,
  allow_participant_management_club_override_allowed boolean,
  max_attachment_size_bytes integer,
  allowed_file_types text[],
  allow_direct_messaging boolean,
  allow_direct_messaging_origin text,
  allow_direct_messaging_club_override_allowed boolean,
  allow_multi_person_conversations boolean,
  allow_multi_person_conversations_origin text,
  allow_multi_person_conversations_club_override_allowed boolean,
  allow_team_conversations boolean,
  allow_team_conversations_origin text,
  allow_team_conversations_club_override_allowed boolean,
  allow_team_announcements boolean,
  allow_team_announcements_origin text,
  allow_team_announcements_club_override_allowed boolean,
  allow_club_announcements boolean,
  allow_club_announcements_origin text,
  allow_club_announcements_club_override_allowed boolean,
  allow_platform_announcements boolean,
  allow_platform_announcements_origin text,
  allow_platform_announcements_club_override_allowed boolean,
  allow_private_replies boolean,
  allow_private_replies_origin text,
  allow_private_replies_club_override_allowed boolean,
  allow_group_discussion boolean,
  allow_group_discussion_origin text,
  allow_group_discussion_club_override_allowed boolean
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
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
    -- The ceiling is applied at READ time, so withdrawing an override
    -- permission reaches standing overrides and not merely new ones.
    case when g.allow_direct_attachments_club_override_allowed
         then coalesce(c.allow_direct_attachments, g.allow_direct_attachments)
         else g.allow_direct_attachments end,
    case when g.allow_direct_attachments_club_override_allowed and c.allow_direct_attachments is not null
         then 'club_override' else 'global_default' end,
    g.allow_direct_attachments_club_override_allowed,

    case when g.allow_document_library_sharing_club_override_allowed
         then coalesce(c.allow_document_library_sharing, g.allow_document_library_sharing)
         else g.allow_document_library_sharing end,
    case when g.allow_document_library_sharing_club_override_allowed and c.allow_document_library_sharing is not null
         then 'club_override' else 'global_default' end,
    g.allow_document_library_sharing_club_override_allowed,

    case when g.allow_image_uploads_club_override_allowed
         then coalesce(c.allow_image_uploads, g.allow_image_uploads)
         else g.allow_image_uploads end,
    case when g.allow_image_uploads_club_override_allowed and c.allow_image_uploads is not null
         then 'club_override' else 'global_default' end,
    g.allow_image_uploads_club_override_allowed,

    case when g.allow_contact_card_sharing_club_override_allowed
         then coalesce(c.allow_contact_card_sharing, g.allow_contact_card_sharing)
         else g.allow_contact_card_sharing end,
    case when g.allow_contact_card_sharing_club_override_allowed and c.allow_contact_card_sharing is not null
         then 'club_override' else 'global_default' end,
    g.allow_contact_card_sharing_club_override_allowed,

    case when g.allow_participant_management_club_override_allowed
         then coalesce(c.allow_participant_management, g.allow_participant_management)
         else g.allow_participant_management end,
    case when g.allow_participant_management_club_override_allowed and c.allow_participant_management is not null
         then 'club_override' else 'global_default' end,
    g.allow_participant_management_club_override_allowed,

    g.max_attachment_size_bytes,
    g.allowed_file_types,

    -- DIRECT MESSAGING IS A CONJUNCTION, not an override: a club may restrict
    -- it and can never re-enable what Ovalball switched off. Reported here so
    -- an admin screen shows the truth; the authority itself is
    -- internal.direct_messaging_allowed_for_pair.
    (coalesce(g.allow_direct_messaging, true) and coalesce(c.allow_direct_messaging, true)),
    case when c.allow_direct_messaging is not null then 'club_override' else 'global_default' end,
    g.allow_direct_messaging_club_override_allowed,

    case when g.allow_multi_person_conversations_club_override_allowed
         then coalesce(c.allow_multi_person_conversations, g.allow_multi_person_conversations)
         else g.allow_multi_person_conversations end,
    case when g.allow_multi_person_conversations_club_override_allowed and c.allow_multi_person_conversations is not null
         then 'club_override' else 'global_default' end,
    g.allow_multi_person_conversations_club_override_allowed,

    case when g.allow_team_conversations_club_override_allowed
         then coalesce(c.allow_team_conversations, g.allow_team_conversations)
         else g.allow_team_conversations end,
    case when g.allow_team_conversations_club_override_allowed and c.allow_team_conversations is not null
         then 'club_override' else 'global_default' end,
    g.allow_team_conversations_club_override_allowed,

    case when g.allow_team_announcements_club_override_allowed
         then coalesce(c.allow_team_announcements, g.allow_team_announcements)
         else g.allow_team_announcements end,
    case when g.allow_team_announcements_club_override_allowed and c.allow_team_announcements is not null
         then 'club_override' else 'global_default' end,
    g.allow_team_announcements_club_override_allowed,

    case when g.allow_club_announcements_club_override_allowed
         then coalesce(c.allow_club_announcements, g.allow_club_announcements)
         else g.allow_club_announcements end,
    case when g.allow_club_announcements_club_override_allowed and c.allow_club_announcements is not null
         then 'club_override' else 'global_default' end,
    g.allow_club_announcements_club_override_allowed,

    g.allow_platform_announcements,
    'global_default'::text,
    g.allow_platform_announcements_club_override_allowed,

    case when g.allow_private_replies_club_override_allowed
         then coalesce(c.allow_private_replies, g.allow_private_replies)
         else g.allow_private_replies end,
    case when g.allow_private_replies_club_override_allowed and c.allow_private_replies is not null
         then 'club_override' else 'global_default' end,
    g.allow_private_replies_club_override_allowed,

    case when g.allow_group_discussion_club_override_allowed
         then coalesce(c.allow_group_discussion, g.allow_group_discussion)
         else g.allow_group_discussion end,
    case when g.allow_group_discussion_club_override_allowed and c.allow_group_discussion is not null
         then 'club_override' else 'global_default' end,
    g.allow_group_discussion_club_override_allowed;
end;
$$;

revoke all on function public.get_effective_message_policy(uuid) from public, anon;
grant execute on function public.get_effective_message_policy(uuid) to authenticated;

-- And the writer stops accepting a key that no longer exists, rather than
-- silently ignoring it.
create or replace function public.update_message_communication_policy(
  p_club_id uuid,
  p_settings jsonb
)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  g public.message_policies;
  k text;
  v_features constant text[] := array[
    'allow_direct_messaging', 'allow_multi_person_conversations',
    'allow_team_conversations', 'allow_team_announcements',
    'allow_club_announcements', 'allow_platform_announcements',
    'allow_private_replies', 'allow_group_discussion'
  ];
  v_platform_only constant text[] := array['allow_platform_announcements'];
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'No settings were supplied.';
  end if;

  for k in select jsonb_object_keys(p_settings) loop
    if not (k = any (v_features) or replace(k, '_club_override_allowed', '') = any (v_features)) then
      raise exception 'Unknown messaging setting: %', k;
    end if;
  end loop;

  select * into g from public.message_policies where club_id is null;

  if p_club_id is null then
    if not internal.is_full_site_admin() then
      raise exception 'Only a Full Site Admin may change the global message policy.' using errcode = '42501';
    end if;

    foreach k in array v_platform_only loop
      if p_settings ? (k || '_club_override_allowed')
         and coalesce((p_settings ->> (k || '_club_override_allowed'))::boolean, false) then
        raise exception '% is held at the Ovalball level and cannot be delegated to clubs.', k using errcode = '42501';
      end if;
    end loop;

    update public.message_policies set
      allow_direct_messaging = case when p_settings ? 'allow_direct_messaging'
        then (p_settings ->> 'allow_direct_messaging')::boolean else allow_direct_messaging end,
      allow_multi_person_conversations = case when p_settings ? 'allow_multi_person_conversations'
        then (p_settings ->> 'allow_multi_person_conversations')::boolean else allow_multi_person_conversations end,
      allow_team_conversations = case when p_settings ? 'allow_team_conversations'
        then (p_settings ->> 'allow_team_conversations')::boolean else allow_team_conversations end,
      allow_team_announcements = case when p_settings ? 'allow_team_announcements'
        then (p_settings ->> 'allow_team_announcements')::boolean else allow_team_announcements end,
      allow_club_announcements = case when p_settings ? 'allow_club_announcements'
        then (p_settings ->> 'allow_club_announcements')::boolean else allow_club_announcements end,
      allow_platform_announcements = case when p_settings ? 'allow_platform_announcements'
        then (p_settings ->> 'allow_platform_announcements')::boolean else allow_platform_announcements end,
      allow_private_replies = case when p_settings ? 'allow_private_replies'
        then (p_settings ->> 'allow_private_replies')::boolean else allow_private_replies end,
      allow_group_discussion = case when p_settings ? 'allow_group_discussion'
        then (p_settings ->> 'allow_group_discussion')::boolean else allow_group_discussion end,

      allow_direct_messaging_club_override_allowed = case when p_settings ? 'allow_direct_messaging_club_override_allowed'
        then (p_settings ->> 'allow_direct_messaging_club_override_allowed')::boolean else allow_direct_messaging_club_override_allowed end,
      allow_multi_person_conversations_club_override_allowed = case when p_settings ? 'allow_multi_person_conversations_club_override_allowed'
        then (p_settings ->> 'allow_multi_person_conversations_club_override_allowed')::boolean else allow_multi_person_conversations_club_override_allowed end,
      allow_team_conversations_club_override_allowed = case when p_settings ? 'allow_team_conversations_club_override_allowed'
        then (p_settings ->> 'allow_team_conversations_club_override_allowed')::boolean else allow_team_conversations_club_override_allowed end,
      allow_team_announcements_club_override_allowed = case when p_settings ? 'allow_team_announcements_club_override_allowed'
        then (p_settings ->> 'allow_team_announcements_club_override_allowed')::boolean else allow_team_announcements_club_override_allowed end,
      allow_club_announcements_club_override_allowed = case when p_settings ? 'allow_club_announcements_club_override_allowed'
        then (p_settings ->> 'allow_club_announcements_club_override_allowed')::boolean else allow_club_announcements_club_override_allowed end,
      allow_private_replies_club_override_allowed = case when p_settings ? 'allow_private_replies_club_override_allowed'
        then (p_settings ->> 'allow_private_replies_club_override_allowed')::boolean else allow_private_replies_club_override_allowed end,
      allow_group_discussion_club_override_allowed = case when p_settings ? 'allow_group_discussion_club_override_allowed'
        then (p_settings ->> 'allow_group_discussion_club_override_allowed')::boolean else allow_group_discussion_club_override_allowed end,

      updated_by = auth.uid()
    where club_id is null;
    return;
  end if;

  if not (internal.is_club_admin(p_club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may change its messaging settings.' using errcode = '42501';
  end if;

  foreach k in array v_features loop
    if p_settings ? (k || '_club_override_allowed') then
      raise exception 'Whether clubs may override % is set by Ovalball, not by a club.', k using errcode = '42501';
    end if;
    if p_settings ? k and jsonb_typeof(p_settings -> k) <> 'null' then
      if k = any (v_platform_only) then
        raise exception '% is set by Ovalball and is not a club setting.', k using errcode = '42501';
      end if;
      -- Direct messaging is exempt from the override ceiling because a club
      -- setting can only ever RESTRICT it -- there is nothing to delegate.
      if k <> 'allow_direct_messaging' and not (
        case k
          when 'allow_multi_person_conversations' then g.allow_multi_person_conversations_club_override_allowed
          when 'allow_team_conversations' then g.allow_team_conversations_club_override_allowed
          when 'allow_team_announcements' then g.allow_team_announcements_club_override_allowed
          when 'allow_club_announcements' then g.allow_club_announcements_club_override_allowed
          when 'allow_private_replies' then g.allow_private_replies_club_override_allowed
          when 'allow_group_discussion' then g.allow_group_discussion_club_override_allowed
          else false
        end
      ) then
        raise exception '% cannot be overridden by clubs -- this is set at the Ovalball level.', k using errcode = '42501';
      end if;
    end if;
  end loop;

  insert into public.message_policies (club_id, updated_by) values (p_club_id, auth.uid())
  on conflict (club_id) where club_id is not null do nothing;

  update public.message_policies set
    allow_direct_messaging = case when p_settings ? 'allow_direct_messaging'
      then (p_settings ->> 'allow_direct_messaging')::boolean else allow_direct_messaging end,
    allow_multi_person_conversations = case when p_settings ? 'allow_multi_person_conversations'
      then (p_settings ->> 'allow_multi_person_conversations')::boolean else allow_multi_person_conversations end,
    allow_team_conversations = case when p_settings ? 'allow_team_conversations'
      then (p_settings ->> 'allow_team_conversations')::boolean else allow_team_conversations end,
    allow_team_announcements = case when p_settings ? 'allow_team_announcements'
      then (p_settings ->> 'allow_team_announcements')::boolean else allow_team_announcements end,
    allow_club_announcements = case when p_settings ? 'allow_club_announcements'
      then (p_settings ->> 'allow_club_announcements')::boolean else allow_club_announcements end,
    allow_private_replies = case when p_settings ? 'allow_private_replies'
      then (p_settings ->> 'allow_private_replies')::boolean else allow_private_replies end,
    allow_group_discussion = case when p_settings ? 'allow_group_discussion'
      then (p_settings ->> 'allow_group_discussion')::boolean else allow_group_discussion end,
    updated_by = auth.uid()
  where club_id = p_club_id;
end;
$$;

revoke all on function public.update_message_communication_policy(uuid, jsonb) from public, anon;
grant execute on function public.update_message_communication_policy(uuid, jsonb) to authenticated;
