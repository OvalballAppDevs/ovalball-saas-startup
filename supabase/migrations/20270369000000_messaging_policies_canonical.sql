-- Slice 4F -- part 3: the messaging row policies and the retirement of the community adapter
-- (Phase 2 AA.3 row 4f, design J.10 lines 511-523).
--
-- CONTRACT STEP. It removes the Site Admin blanket read from the two messaging conversation
-- policies AA.3 row 4f names, and deletes the team.community.manage adapter rows. Whether that
-- needs staging is derived from the compatibility matrix rather than assumed; the answer and the
-- evidence are in the release report.

-- 1. Team conversations ----------------------------------------------------------------------------
-- The ledger names team_conversations_select_scoped as 4F's policy from the fixtures helper, and it
-- carried all three legacy pieces at once: the bare is_site_admin(), 4B's can_manage_team and 4C's
-- can_manage_club_fixtures. The family branch underneath is Slice 4A's question -- a player reading
-- their own team's conversation, or their active guardian -- and is kept exactly as it is.
drop policy if exists team_conversations_select_scoped on public.team_conversations;
create policy team_conversations_select_scoped on public.team_conversations
for select using (
  internal.has_site_capability('site.messages.moderate')
  or internal.can('messaging.team_conversation.view', 'team',
                  (select t.club_id from public.teams t where t.id = team_conversations.team_id),
                  team_conversations.team_id, null)
  or internal.can('messaging.fixture_conversation.participate', 'club',
                  (select t.club_id from public.teams t where t.id = team_conversations.team_id), null, null)
  or exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = team_conversations.team_id
      and ptm.status = 'active'
      and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
  )
);

comment on policy team_conversations_select_scoped on public.team_conversations is
  'Slice 4F: messaging.team_conversation.view at the team, the club-scope participate key that CA '
  'and FS hold, site.messages.moderate, or the Slice 4A family branch. The Site Admin blanket read '
  'is gone (AA.3 row 4f).';

-- Enabling or disabling a team conversation is the same authority as speaking to that team, which
-- is what the adapter already said: team.community.manage@team resolved to
-- messaging.announcement.send_team and @club to messaging.announcement.send_club.
drop policy if exists team_conversations_write_scoped on public.team_conversations;
create policy team_conversations_write_scoped on public.team_conversations
for all using (
  internal.can('messaging.announcement.send_team', 'team',
               (select t.club_id from public.teams t where t.id = team_conversations.team_id),
               team_conversations.team_id, null)
  or internal.can('messaging.announcement.send_club', 'club',
                  (select t.club_id from public.teams t where t.id = team_conversations.team_id), null, null)
  or internal.has_site_capability('site.support.act_in_club')
) with check (
  internal.can('messaging.announcement.send_team', 'team',
               (select t.club_id from public.teams t where t.id = team_conversations.team_id),
               team_conversations.team_id, null)
  or internal.can('messaging.announcement.send_club', 'club',
                  (select t.club_id from public.teams t where t.id = team_conversations.team_id), null, null)
  or internal.has_site_capability('site.support.act_in_club')
);

-- 2. Club message blocks ----------------------------------------------------------------------------
-- The read follows the write: J.10 line 518 gives messaging.block.manage to a Club Admin and a
-- Safeguarding Officer, so those are the people who see who is blocked, plus Ovalball moderation.
drop policy if exists club_message_blocks_select_staff on public.club_message_blocks;
create policy club_message_blocks_select_staff on public.club_message_blocks
for select using (
  internal.can('messaging.block.manage', 'club', club_id, null, null)
  or internal.has_site_capability('site.messages.moderate')
);

-- 3. Retire the community adapter -----------------------------------------------------------------
-- team.community.manage is the legacy key J.10 lines 514-515 SPLIT into the two announcement keys.
-- With every consumer migrated it has no caller, and a zero-caller legacy adapter is the same hazard
-- Slice 4B named when it retired team.view and Slice 4E when it retired calendar.manage: the next
-- person needing "may you speak to this team" would find the deprecated answer first.
--
-- The assertion runs BEFORE the delete, so a missed consumer stops the migration rather than
-- silently losing its authority.
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(x order by x), '{}') into v_bad from (
    select n.nspname || '.' || p.proname as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.proname not in ('capability_decision', 'has_capability')
      and p.prosrc like '%team.community.manage%'
    union all
    select 'policy ' || tablename || '.' || policyname
    from pg_policies
    where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%team.community.manage%'
  ) q;
  if cardinality(v_bad) > 0 then
    raise exception 'team.community.manage still has consumers: %', array_to_string(v_bad, ', ');
  end if;
end $$;

delete from public.capability_key_map where legacy_key = 'team.community.manage';

-- 4. The last raw-role messaging helper ------------------------------------------------------------
-- AA.3 row 4f lists is_messaging_staff as "already 0/0", and it is: no function, no policy and no
-- application code calls it. But the FUNCTION was still installed, and its body still matched the
-- membership role strings 'CLUB_ADMIN', 'FIXTURE_SECRETARY', 'team_admin', 'coach' and 'manager'
-- directly. "Retired" has meant dropped for every other helper in this programme -- fixture_visible_row
-- in 4C, is_club_fixture_administrator in 4D, staffs_team earlier in this migration's sibling -- and
-- a zero-caller raw-role helper is a hazard precisely because it looks available.
--
-- This was found by the assertion below rather than by reading the count: 0/0 describes references,
-- not existence.
drop function if exists internal.is_messaging_staff(uuid);

do $$
begin
  if exists (select 1 from public.capability_key_map where legacy_key = 'team.community.manage') then
    raise exception 'the team.community.manage adapter rows survived.';
  end if;
  -- AA.3 row 4f, asserted where it is cheapest to assert: the three named items, at zero.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'internal' and p.proname in ('staffs_team', 'is_messaging_staff')) then
    raise exception 'a retired messaging helper is still installed.';
  end if;
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename in ('team_conversations', 'club_message_blocks')
               and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '\mis_site_admin\(') then
    raise exception 'a messaging conversation policy still carries the Site Admin blanket read.';
  end if;
end $$;

-- 4. The read policy's first term ------------------------------------------------------------------
-- fixture_messages_select_scoped opens with an UNGUARDED call:
--
--     internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
--     or (team_conversation_id is not null and internal.can_view_team_conversation(...))
--     or (safeguarding_conversation_id is not null and ...)
--     ...
--
-- Every other term tests its own column first. The first one does not, so it runs on EVERY row of
-- the table -- including team, safeguarding, announcement and direct rows, where all three of its
-- arguments are null and there is nothing for it to answer about.
--
-- That costs real time. EXPLAIN (ANALYZE) on a 300-message team conversation showed the whole read
-- at 169ms with this term evaluating on all 300 rows; a micro-benchmark put 72ms of that in calls
-- whose every argument was null. Postgres cannot inline a SECURITY DEFINER function, so there is no
-- plan-level escape from it: the guard has to be written.
--
-- It is behaviour-preserving by construction. can_access_fixture_conversation now returns false
-- when it is given no identifier at all, and the club-conversation branch was already null-guarded
-- inside the function, so a row with all three columns null already answered false. This only stops
-- asking. messaging_authority_matrix MA-L asserts that equivalence row by row rather than assuming
-- it, on exactly the thread kinds the guard changes.
drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
  for select using (
    ((fixture_id is not null or fixture_request_id is not null or club_conversation_id is not null)
      and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id))
    or (team_conversation_id is not null and internal.can_view_team_conversation(team_conversation_id))
    or (safeguarding_conversation_id is not null and internal.can_view_safeguarding_conversation(safeguarding_conversation_id))
    or (announcement_id is not null and internal.can_view_announcement_reply(announcement_id, sender_user_id))
    -- READING IS MEMBERSHIP OF THE THREAD, not current authority to send.
    -- A blocked or lapsed relationship stops new messages; it does not
    -- retrospectively confiscate a conversation somebody already had.
    or (direct_conversation_id is not null and internal.can_view_direct_conversation(direct_conversation_id))
  );

-- 5. The old reporting RPC, kept and made harmless -------------------------------------------------
-- public.report_fixture_message is NOT dropped, and that is a release-order decision rather than
-- tidiness. Migrations are applied before the push that deploys the app, so between the two there
-- is a window in which the CURRENT app is running against this schema. Dropping the RPC would make
-- every report in that window fail; leaving its body alone would make every report in that window
-- overwrite somebody else's, which is the exact defect section T exists to fix.
--
-- So it delegates. Same name, same signature, same callers -- one row per report either way. It
-- also means that if any caller anywhere was missed, the worst case is a correct report through an
-- old name rather than a silent overwrite. (One was missed: Match Centre's own reportMessage still
-- named the old RPC, and it was the compatibility question, not the test suite, that surfaced it.)
create or replace function public.report_fixture_message(p_message_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.report_message(p_message_id, p_reason);
end;
$$;

comment on function public.report_fixture_message(uuid, text) is
  'Slice 4F: retained for release-order compatibility and delegates to public.report_message, which '
  'writes one row per report (section T). Kept so the previous app build keeps working in the window '
  'between the migration and the deploy; new call sites use report_message directly.';

do $$
begin
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'report_fixture_message') !~ 'report_message' then
    raise exception 'report_fixture_message no longer delegates; the overwrite defect is reachable again.';
  end if;
end $$;
