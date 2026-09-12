-- =====================================================================
-- A CLUB MAY CHOOSE, WITHIN WHAT OVALBALL ALLOWS
--
-- message_policies already exists and already has the right shape: one row
-- with club_id IS NULL holding the platform position, one row per club
-- holding that club's choice, and a *_club_override_allowed flag per feature
-- saying whether a club is permitted an opinion at all. This migration adds
-- the communication features to that table rather than building a second
-- settings domain beside it.
--
-- WHAT IS BEING ADDED, and why each is a separate switch
--
--   allow_direct_messaging            one person, one person
--   allow_multi_person_conversations  an explicitly chosen group
--   allow_team_conversations          the standing team conversation
--   allow_team_announcements          a team telling its own families
--   allow_club_announcements          a club telling everybody
--   allow_platform_announcements      Ovalball telling everybody
--   allow_private_replies             a recipient may answer, privately
--   allow_group_discussion            a bounded audience may talk
--   allow_personal_blocking           a person may refuse another person
--
-- They are separate because clubs genuinely differ on them. A club that is
-- content for coaches to message parents directly may still not want a
-- four-hundred-person discussion thread; one flag covering both would force
-- it to give up the first to prevent the second.
--
-- TWO OF THEM ARE NOT A CLUB'S TO DECIDE
--
-- allow_platform_announcements is Ovalball's own channel. A club switching
-- off the platform's ability to reach its members would be a club deciding
-- it need not receive a safeguarding or service notice.
--
-- allow_personal_blocking is an individual's own safety control. A club being
-- able to switch off a person's ability to refuse contact from another person
-- inverts who the protection is for. Both are held at platform level with
-- club override permanently disallowed, and CHECK constraints say so rather
-- than an application remembering to.
--
-- A READ-TIME DEFECT THIS ALSO CLOSES
--
-- update_club_message_policy refuses to WRITE an override where the platform
-- has withdrawn permission -- but get_effective_message_policy then returned
-- coalesce(club, global) unconditionally. So a club that set an override
-- while it was permitted kept winning after the platform revoked permission:
-- the ceiling applied to new decisions and not to standing ones. The rewrite
-- below applies the ceiling at READ time, which is the only place that makes
-- a stale override stop mattering. Existing behaviour is otherwise unchanged.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE COLUMNS
-- ---------------------------------------------------------------------
-- Deliberately NO column default. The original five default to true, which
-- means a club row created without naming them silently PINS them rather
-- than inheriting. Null here means "no opinion -- follow the platform", and
-- a club row that never mentions a feature genuinely has no opinion on it.
alter table public.message_policies
  add column if not exists allow_direct_messaging boolean,
  add column if not exists allow_multi_person_conversations boolean,
  add column if not exists allow_team_conversations boolean,
  add column if not exists allow_team_announcements boolean,
  add column if not exists allow_club_announcements boolean,
  add column if not exists allow_platform_announcements boolean,
  add column if not exists allow_private_replies boolean,
  add column if not exists allow_group_discussion boolean,
  add column if not exists allow_personal_blocking boolean;

alter table public.message_policies
  add column if not exists allow_direct_messaging_club_override_allowed boolean not null default true,
  add column if not exists allow_multi_person_conversations_club_override_allowed boolean not null default true,
  add column if not exists allow_team_conversations_club_override_allowed boolean not null default true,
  add column if not exists allow_team_announcements_club_override_allowed boolean not null default true,
  add column if not exists allow_club_announcements_club_override_allowed boolean not null default true,
  add column if not exists allow_platform_announcements_club_override_allowed boolean not null default false,
  add column if not exists allow_private_replies_club_override_allowed boolean not null default true,
  add column if not exists allow_group_discussion_club_override_allowed boolean not null default true,
  add column if not exists allow_personal_blocking_club_override_allowed boolean not null default false;

-- THE TWO THAT ARE NOT NEGOTIABLE, stated as constraints so no future writer
-- -- RPC, migration or console session -- can quietly grant them.
alter table public.message_policies
  drop constraint if exists message_policies_platform_only_overrides;
alter table public.message_policies
  add constraint message_policies_platform_only_overrides check (
    allow_platform_announcements_club_override_allowed = false
    and allow_personal_blocking_club_override_allowed = false
  );

alter table public.message_policies
  drop constraint if exists message_policies_platform_only_not_club_held;
alter table public.message_policies
  add constraint message_policies_platform_only_not_club_held check (
    club_id is null
    or (allow_platform_announcements is null and allow_personal_blocking is null)
  );

-- The platform's opening position. Everything on: Ovalball does not ship
-- with communication switched off, and a club that wants less says so.
update public.message_policies
set allow_direct_messaging           = coalesce(allow_direct_messaging, true),
    allow_multi_person_conversations = coalesce(allow_multi_person_conversations, true),
    allow_team_conversations         = coalesce(allow_team_conversations, true),
    allow_team_announcements         = coalesce(allow_team_announcements, true),
    allow_club_announcements         = coalesce(allow_club_announcements, true),
    allow_platform_announcements     = coalesce(allow_platform_announcements, true),
    allow_private_replies            = coalesce(allow_private_replies, true),
    allow_group_discussion           = coalesce(allow_group_discussion, true),
    allow_personal_blocking          = coalesce(allow_personal_blocking, true)
where club_id is null;

comment on column public.message_policies.allow_platform_announcements is
  'Whether Ovalball itself may announce to a club''s people. Held at platform level only -- see message_policies_platform_only_overrides. A club cannot opt out of the platform''s own channel.';
comment on column public.message_policies.allow_personal_blocking is
  'Whether a person may block another person. Held at platform level only: a club switching this off would be a club removing an individual''s protection from another individual.';

-- ---------------------------------------------------------------------
-- 2. THE EFFECTIVE ANSWER
-- ---------------------------------------------------------------------
-- Dropped and recreated rather than replaced, because the return type grows.
-- The original columns keep their names, order and meaning, so existing
-- callers (create_fixture_message_with_attachment, the Club and Site Admin
-- settings screens) are unaffected.
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
  allow_group_discussion_club_override_allowed boolean,
  allow_personal_blocking boolean,
  allow_personal_blocking_origin text,
  allow_personal_blocking_club_override_allowed boolean
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
    -- THE CEILING IS APPLIED HERE. A club override counts only while the
    -- platform still permits one; withdrawing permission takes effect on
    -- standing overrides, not merely on new ones.
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

    case when g.allow_direct_messaging_club_override_allowed
         then coalesce(c.allow_direct_messaging, g.allow_direct_messaging)
         else g.allow_direct_messaging end,
    case when g.allow_direct_messaging_club_override_allowed and c.allow_direct_messaging is not null
         then 'club_override' else 'global_default' end,
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

    -- Platform-only: the club row cannot hold a value for these at all, so
    -- the answer is the platform's, always.
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
    g.allow_group_discussion_club_override_allowed,

    g.allow_personal_blocking,
    'global_default'::text,
    g.allow_personal_blocking_club_override_allowed;
end;
$$;

comment on function public.get_effective_message_policy(uuid) is
  'The messaging features actually in force for a club: the platform position, overridden by the club only where the platform still permits an override. The ceiling is applied here rather than only at write time, so withdrawing an override permission takes effect on standing overrides too.';

revoke all on function public.get_effective_message_policy(uuid) from public, anon;
grant execute on function public.get_effective_message_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. ONE WRITER FOR THE COMMUNICATION FEATURES
-- ---------------------------------------------------------------------
-- A jsonb payload rather than eighteen more positional booleans, and only
-- the keys PRESENT are changed -- so a settings screen saves what the person
-- actually touched, and adding the tenth feature later does not change this
-- function's signature and break every caller.
--
-- Value semantics, which differ by scope on purpose:
--   global scope   true / false        the platform's position
--                  <key>_club_override_allowed   whether clubs may differ
--   club scope     true / false        this club's override
--                  JSON null           no opinion; follow the platform
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
    'allow_private_replies', 'allow_group_discussion', 'allow_personal_blocking'
  ];
  v_platform_only constant text[] := array['allow_platform_announcements', 'allow_personal_blocking'];
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'No settings were supplied.';
  end if;

  -- Every key must be one we know. A typo silently doing nothing is how a
  -- settings screen ends up lying about what it saved.
  for k in select jsonb_object_keys(p_settings) loop
    if not (k = any (v_features) or replace(k, '_club_override_allowed', '') = any (v_features)) then
      raise exception 'Unknown messaging setting: %', k;
    end if;
  end loop;

  select * into g from public.message_policies where club_id is null;

  -- =================================================================
  -- GLOBAL SCOPE
  -- =================================================================
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
      allow_personal_blocking = case when p_settings ? 'allow_personal_blocking'
        then (p_settings ->> 'allow_personal_blocking')::boolean else allow_personal_blocking end,

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

  -- =================================================================
  -- CLUB SCOPE
  -- =================================================================
  if not (internal.is_club_admin(p_club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may change its messaging settings.' using errcode = '42501';
  end if;

  foreach k in array v_features loop
    if p_settings ? (k || '_club_override_allowed') then
      raise exception 'Whether clubs may override % is set by Ovalball, not by a club.', k using errcode = '42501';
    end if;
    -- A club naming a feature it is not permitted to hold an opinion on is
    -- refused rather than silently ignored, so the screen cannot report a
    -- save that did not happen. A JSON null is "no opinion", which is always
    -- allowed -- clearing an override is never itself an override.
    if p_settings ? k and jsonb_typeof(p_settings -> k) <> 'null' then
      if k = any (v_platform_only) then
        raise exception '% is set by Ovalball and is not a club setting.', k using errcode = '42501';
      end if;
      if not (
        case k
          when 'allow_direct_messaging' then g.allow_direct_messaging_club_override_allowed
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

comment on function public.update_message_communication_policy(uuid, jsonb) is
  'The one writer for Ovalball''s communication feature switches. Null club id writes the platform position (Full Site Admin); a club id writes that club''s overrides (its Club Admin), where the platform permits one. Only the keys present are changed.';

revoke all on function public.update_message_communication_policy(uuid, jsonb) from public, anon;
grant execute on function public.update_message_communication_policy(uuid, jsonb) to authenticated;
