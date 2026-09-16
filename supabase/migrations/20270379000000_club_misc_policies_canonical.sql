-- =====================================================================================================
-- SLICE 4I (3/3) — THE POLICIES, AND THE ADAPTER ROWS
--
-- Contract stage. Six row policies on the document library, and the eleven rollover, graduation,
-- season, partnership and referral policies the programme ledger assigns to this slice.
--
-- SHAPE: every one of these calls was already correlated -- internal.can_manage_document_library and
-- internal.can_manage_club_fixtures each run once per row today. The rewrite swaps the question for a
-- hoisted set, which the planner folds into an InitPlan, so these reads get cheaper rather than
-- dearer. internal.club_ids_with is Slice 4H's, already in production, and its candidate set mirrors
-- internal.bundle_source, which is why it is safe to ask a document question with.
-- =====================================================================================================

-- 1. The document library ------------------------------------------------------------------------------
drop policy if exists club_documents_insert on public.club_documents;
create policy club_documents_insert on public.club_documents
  for insert with check (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists club_documents_update on public.club_documents;
create policy club_documents_update on public.club_documents
  for update using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists club_documents_delete on public.club_documents;
create policy club_documents_delete on public.club_documents
  for delete using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists club_documents_select_owner on public.club_documents;
create policy club_documents_select_owner on public.club_documents
  for select using (
    (select internal.has_site_capability('site.clubs.view'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.view')))
  );

drop policy if exists document_folders_insert on public.document_folders;
create policy document_folders_insert on public.document_folders
  for insert with check (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists document_folders_update on public.document_folders;
create policy document_folders_update on public.document_folders
  for update using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists document_folders_delete on public.document_folders;
create policy document_folders_delete on public.document_folders
  for delete using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.manage')))
  );

drop policy if exists document_folders_select on public.document_folders;
create policy document_folders_select on public.document_folders
  for select using (
    (select internal.has_site_capability('site.clubs.view'))
    or club_id in (select unnest(internal.club_ids_with('club.documents.view')))
  );

-- 2. Rollover, graduation and season transition ---------------------------------------------------------
-- These are the READ side of a season handover, so they ask the key J.5 line 426 gives to preparing one
-- -- which is CA and FS, exactly who could see them before through can_manage_club_fixtures.
drop policy if exists age_grade_rollovers_select on public.age_grade_rollovers;
create policy age_grade_rollovers_select on public.age_grade_rollovers
  for select using (
    (select internal.has_site_capability('site.support.view_club'))
    or club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))
  );

drop policy if exists age_grade_rollover_group_flags_select on public.age_grade_rollover_group_flags;
create policy age_grade_rollover_group_flags_select on public.age_grade_rollover_group_flags
  for select using (
    exists (select 1 from public.age_grade_rollovers r
            where r.id = age_grade_rollover_group_flags.rollover_id
              and ((select internal.has_site_capability('site.support.view_club'))
                   or r.club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))))
  );

drop policy if exists rollover_planned_teams_select on public.age_grade_rollover_planned_teams;
create policy rollover_planned_teams_select on public.age_grade_rollover_planned_teams
  for select using (
    exists (select 1 from public.age_grade_rollovers r
            where r.id = age_grade_rollover_planned_teams.rollover_id
              and ((select internal.has_site_capability('site.support.view_club'))
                   or r.club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))))
  );

drop policy if exists rollover_player_proposals_select on public.age_grade_rollover_player_proposals;
create policy rollover_player_proposals_select on public.age_grade_rollover_player_proposals
  for select to authenticated using (
    exists (select 1 from public.age_grade_rollovers r
            where r.id = age_grade_rollover_player_proposals.rollover_id
              and ((select internal.has_site_capability('site.support.view_club'))
                   or r.club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))))
  );

drop policy if exists age_grade_rollover_team_proposals_select on public.age_grade_rollover_team_proposals;
create policy age_grade_rollover_team_proposals_select on public.age_grade_rollover_team_proposals
  for select using (
    exists (select 1 from public.age_grade_rollovers r
            where r.id = age_grade_rollover_team_proposals.rollover_id
              and ((select internal.has_site_capability('site.support.view_club'))
                   or r.club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))))
  );

drop policy if exists player_graduation_queue_select on public.player_graduation_queue;
create policy player_graduation_queue_select on public.player_graduation_queue
  for select using (
    (select internal.has_site_capability('site.support.view_club'))
    or club_id in (select unnest(internal.club_ids_with('team.graduation.place')))
  );

drop policy if exists season_transitions_select on public.season_transitions;
create policy season_transitions_select on public.season_transitions
  for select using (
    (select internal.has_site_capability('site.support.view_club'))
    or club_id in (select unnest(internal.club_ids_with('team.handover.prepare')))
  );

-- 3. Partnerships and referrals ---------------------------------------------------------------------------
-- J.4 line 409 gives club.partners.manage to CA and FS, which is who can_manage_club_fixtures reached.
-- The partner club's own read stays: a partnership is a relationship, and both ends can see it.
drop policy if exists club_partnerships_select_scoped on public.club_partnerships;
create policy club_partnerships_select_scoped on public.club_partnerships
  for select using (
    (select internal.has_site_capability('site.clubs.view'))
    or requesting_club_id in (select unnest(internal.club_ids_with('club.partners.manage')))
    or partner_club_id in (select unnest(internal.club_ids_with('club.partners.manage')))
  );

drop policy if exists club_partnerships_insert_scoped on public.club_partnerships;
create policy club_partnerships_insert_scoped on public.club_partnerships
  for insert with check (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or requesting_club_id in (select unnest(internal.club_ids_with('club.partners.manage')))
  );

-- Inviting another club ONTO Ovalball is a partnership act, not a commercial one. The table's own
-- founding migration says so: it scopes these rows to "the same boundary club_partnerships already
-- uses". J.4 line 409 makes that boundary club.partners.manage, which the Club Admin AND the Fixtures
-- Secretary hold, so this is a rename and nobody gains or loses the invitation.
--
-- club.referrals.view and club.referrals.manage are a DIFFERENT surface: the referral ledger, whose
-- site master is site.commercial.* and which J.4 lines 410-411 keep Club-Admin-only. That is the
-- attribution record and the claim RPC, not the invitation that happens to create one.
-- supabase/tests/referral_attribution_integrity.sql holds the distinction: a Fixtures Secretary's
-- invitation still attributes to their club, and claim_club_referral still refuses them.
drop policy if exists club_ovalball_invitations_select_scoped on public.club_ovalball_invitations;
create policy club_ovalball_invitations_select_scoped on public.club_ovalball_invitations
  for select using (
    (select internal.has_site_capability('site.clubs.view'))
    or inviting_club_id in (select unnest(internal.club_ids_with('club.partners.manage')))
  );

drop policy if exists club_ovalball_invitations_insert_scoped on public.club_ovalball_invitations;
create policy club_ovalball_invitations_insert_scoped on public.club_ovalball_invitations
  for insert with check (
    inviting_club_id in (select unnest(internal.club_ids_with('club.partners.manage')))
    and invited_by = (select auth.uid())
  );

do $$
declare v_bad text[];
begin
  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname in ('public','storage')
    and tablename in ('club_documents','document_folders','age_grade_rollovers','age_grade_rollover_group_flags',
                      'age_grade_rollover_planned_teams','age_grade_rollover_player_proposals',
                      'age_grade_rollover_team_proposals','player_graduation_queue','season_transitions',
                      'club_partnerships','club_ovalball_invitations')
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
        '\m(can_manage_document_library|can_view_document_library|can_manage_club_fixtures|is_club_admin|is_site_admin|is_full_site_admin)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4I policy still asks a legacy helper: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- 4. The last two 4I call sites, and the adapter rows they empty --------------------------------------
-- public.place_graduating_player is the last caller of the place_graduating_players alias, and J.5 line
-- 428 renames it to team.graduation.place: CA and FS at the club, TM at the team. The existing gate
-- asked the alias at both scopes, so the rename preserves exactly who could place a graduating player.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_graduating_player';
  if v_def is not null and position('place_graduating_players' in v_def) > 0 then
    v_def := replace(v_def, '''place_graduating_players''', '''team.graduation.place''');
    v_def := regexp_replace(v_def, 'internal\.has_capability\(''team\.graduation\.place'', ''(club|team)'', ([^)]+)\)',
                            'internal.can(''team.graduation.place'', ''\1'', \2, null)', 'g');
    v_def := regexp_replace(v_def, '(internal\.can\(''team\.graduation\.place'', ''club'', [a-zA-Z0-9_\.]+), null, null\)', '\1, null, null)', 'g');
    execute v_def;
  end if;
end $$;

-- Three aliases whose last caller this slice removed. NOT retired, and named so the omission reads as a
-- decision: club.teams.manage still answers for set_team_alias and clear_team_alias, which are AA.3 row
-- 4b's; the fixture and safeguarding aliases still have application call sites owned by 4c and 4g; and
-- the site.* rows are Slice 7's. This slice did not reach zero by taking another's work.
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(k order by k), '{}') into v_bad
  from unnest(array['club.season_rollover.manage','club.team_lifecycle.manage','partner.manage']) k
  where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public','internal') and p.prosrc like '%'||k||'%')
     or exists (select 1 from pg_policies pol
                where (coalesce(pol.qual,'') || ' ' || coalesce(pol.with_check,'')) like '%'||k||'%');
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4I alias still has a database caller: %', array_to_string(v_bad, ', ');
  end if;
end $$;

delete from public.capability_key_map
where legacy_key in ('club.season_rollover.manage', 'club.team_lifecycle.manage', 'partner.manage');

do $$
begin
  if exists (select 1 from public.capability_key_map
             where legacy_key in ('club.season_rollover.manage','club.team_lifecycle.manage','partner.manage')) then
    raise exception 'a Slice 4I adapter row survived.';
  end if;
  -- The ones that stay, and whose staying is the point.
  if not exists (select 1 from public.capability_key_map where legacy_key = 'club.teams.manage')
     or not exists (select 1 from public.capability_key_map where legacy_key = 'club.guardians.manage')
     or not exists (select 1 from public.capability_key_map where legacy_key = 'fixture.edit') then
    raise exception 'an adapter row belonging to another slice was retired by 4I.';
  end if;
end $$;
