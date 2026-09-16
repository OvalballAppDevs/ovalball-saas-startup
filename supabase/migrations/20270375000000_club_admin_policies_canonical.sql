-- =====================================================================================================
-- SLICE 4H (3/3) — THE TWENTY-THREE POLICIES, AND THE CLUB-ADMINISTRATION GATES
--
-- Contract stage. AA.3 row 4h's legacy item is internal.is_club_admin, and the ledger assigns ten
-- tables to this slice. Every replacement key is already ACTIVE with exactly the bundles J.3/J.4/J.5
-- specify; what changes is which question the policy asks.
--
-- THE SHAPE MATTERS AS MUCH AS THE KEY. internal.is_club_admin(club_id) is correlated, so in a policy
-- it runs once per row, and replacing it with a correlated internal.can(...) would keep that shape and
-- make each call heavier -- the mistake this programme has paid for in 4E, 4F and 4G. Each policy asks
-- internal.club_ids_with(key) instead, which is caller-dependent and row-independent and therefore an
-- InitPlan: once per query.
--
-- WRITTEN AS A SUBQUERY, and that is not a style choice. `club_id = any (internal.club_ids_with(...))`
-- is a plain expression, and Postgres evaluates a stable function in one once per ROW even when its
-- argument is constant -- EXPLAIN showed exactly that, with the call sitting in the Filter beside two
-- InitPlans that had been folded. `club_id in (select unnest(internal.club_ids_with(...)))` is a
-- subquery, and an uncorrelated one, so the planner hoists it. Same answer, once instead of 401 times.
--
-- The site branches become the site master J.3/J.4/J.5 record for each key, never a bare role check.
-- The public branches -- an active club, an active team, a contact marked is_public -- are untouched:
-- they are the public directory, not an authority question.
-- =====================================================================================================

-- 1. clubs and teams ---------------------------------------------------------------------------------
-- J.4 line 405 governs clubs_select with club.profile.view; J.5 line 418 governs teams_select with
-- team.team.view. INTENDED CHANGE, small and stated: a DEACTIVATED club's or an ARCHIVED team's row was
-- visible only to a Club Admin and to any site admin, and is now visible to the people J.4 and J.5 name
-- -- that club's own members, its officer, its coaches and managers. They are the club's own people
-- looking at their own club; nobody outside it gains anything.
drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs
  for select using (
    status = 'active'
    or (select internal.has_site_capability('site.clubs.view'))
    or id in (select unnest(internal.club_ids_with('club.profile.view')))
  );

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using (
    active = true
    or (select internal.has_site_capability('site.clubs.view'))
    or club_id in (select unnest(internal.club_ids_with('team.team.view')))
  );

drop policy if exists teams_insert_admin on public.teams;
create policy teams_insert_admin on public.teams
  for insert with check (
    ((select internal.has_site_capability('site.team_roles.manage'))
     or club_id in (select unnest(internal.club_ids_with('team.team.manage'))))
    and canonical_team_type_id is not null
  );

-- 2. memberships, roles and join requests --------------------------------------------------------------
-- The site master here is the one J.3 records for the key the policy actually asks. This is a SELECT,
-- so its club branch is people.member.view, whose master is site.users.view (J.3 line 385) -- not
-- site.memberships.manage, which belongs to suspend and revoke. The first draft used the latter and
-- the shadow comparison caught it immediately: a user-support Site Admin stopped being able to read a
-- club's membership list, which is most of what user support does.
drop policy if exists club_memberships_select_scoped on public.club_memberships;
create policy club_memberships_select_scoped on public.club_memberships
  for select using (
    user_id = (select auth.uid())
    or (select internal.has_site_capability('site.users.view'))
    or club_id in (select unnest(internal.club_ids_with('people.member.view')))
  );

-- This one keeps the narrower master, and deliberately. Its site branch was is_FULL_site_admin, so
-- only a Full Site Admin could read who holds which role in a club. site.club_roles.manage is what
-- J.3 line 391 records for the key, and it sits in SITE_FULL alone -- so the canonical answer and the
-- old answer are the same people. Reaching for site.users.view here, as the two policies above do,
-- would have quietly handed every site profile a read of every club's role assignments; the shadow
-- comparison showed it as a widening and that is why it is not here.
drop policy if exists role_assignments_select on public.role_assignments;
create policy role_assignments_select on public.role_assignments
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select internal.has_site_capability('site.club_roles.manage'))
    or club_id in (select unnest(internal.club_ids_with('people.role.assign_club')))
  );

-- Reading a join request is a user-support question and keeps site.users.view; DECIDING one is
-- membership administration and takes site.memberships.manage, which is SITE_FULL alone.
drop policy if exists club_join_requests_select_scoped on public.club_join_requests;
create policy club_join_requests_select_scoped on public.club_join_requests
  for select using (
    (select internal.has_site_capability('site.users.view'))
    or club_id in (select unnest(internal.club_ids_with('people.join_request.review')))
  );

drop policy if exists club_join_requests_select_self on public.club_join_requests;
create policy club_join_requests_select_self on public.club_join_requests
  for select using (
    requesting_user_id = (select auth.uid())
    or (select internal.has_site_capability('site.users.view'))
    or club_id in (select unnest(internal.club_ids_with('people.join_request.review')))
  );

drop policy if exists club_join_requests_update_scoped on public.club_join_requests;
create policy club_join_requests_update_scoped on public.club_join_requests
  for update using (
    (select internal.has_site_capability('site.memberships.manage'))
    or club_id in (select unnest(internal.club_ids_with('people.join_request.review')))
  );

-- 3. invitations ---------------------------------------------------------------------------------------
-- J.3 lines 387-388: creating an invitation is people.invitation.create, revoking it is
-- people.invitation.revoke. Reading the list is the creator's question -- somebody who may not issue an
-- invitation has no business reading the club's outstanding ones.
drop policy if exists invitations_select_club_scoped on public.invitations;
create policy invitations_select_club_scoped on public.invitations
  for select using (
    (select internal.has_site_capability('site.invitations.manage'))
    or club_id in (select unnest(internal.club_ids_with('people.invitation.create')))
  );

drop policy if exists invitations_insert_club_scoped on public.invitations;
create policy invitations_insert_club_scoped on public.invitations
  for insert with check (
    (select internal.has_site_capability('site.invitations.manage'))
    or club_id in (select unnest(internal.club_ids_with('people.invitation.create')))
  );

drop policy if exists invitations_update_club_scoped on public.invitations;
create policy invitations_update_club_scoped on public.invitations
  for update using (
    (select internal.has_site_capability('site.invitations.manage'))
    or club_id in (select unnest(internal.club_ids_with('people.invitation.revoke')))
  );

drop policy if exists invitation_teams_select_scoped on public.invitation_teams;
create policy invitation_teams_select_scoped on public.invitation_teams
  for select using (
    exists (
      select 1 from public.invitations i
      where i.id = invitation_teams.invitation_id
        and ((select internal.has_site_capability('site.invitations.manage'))
             or i.club_id in (select unnest(internal.club_ids_with('people.invitation.create'))))
    )
  );

drop policy if exists invitation_teams_insert_scoped on public.invitation_teams;
create policy invitation_teams_insert_scoped on public.invitation_teams
  for insert with check (
    exists (
      select 1 from public.invitations i
      join public.teams t on t.id = invitation_teams.team_id
      where i.id = invitation_teams.invitation_id
        and t.club_id = i.club_id
        and ((select internal.has_site_capability('site.invitations.manage'))
             or i.club_id in (select unnest(internal.club_ids_with('people.invitation.create'))))
    )
  );

drop policy if exists invitation_teams_delete_scoped on public.invitation_teams;
create policy invitation_teams_delete_scoped on public.invitation_teams
  for delete using (
    exists (
      select 1 from public.invitations i
      where i.id = invitation_teams.invitation_id
        and ((select internal.has_site_capability('site.invitations.manage'))
             or i.club_id in (select unnest(internal.club_ids_with('people.invitation.revoke'))))
    )
  );

-- 4. contact cards -------------------------------------------------------------------------------------
-- The is_public branch is the public club and team directory and is left exactly as it is.
drop policy if exists club_contacts_select on public.club_contacts;
create policy club_contacts_select on public.club_contacts
  for select using (
    is_public = true
    or (select internal.has_site_capability('site.clubs.view'))
    or club_id in (select unnest(internal.club_ids_with('club.profile.view')))
  );

drop policy if exists club_contacts_write_admin on public.club_contacts;
create policy club_contacts_write_admin on public.club_contacts
  for insert with check (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.profile.edit')))
  );

drop policy if exists club_contacts_update_admin on public.club_contacts;
create policy club_contacts_update_admin on public.club_contacts
  for update using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.profile.edit')))
  );

drop policy if exists club_contacts_delete_admin on public.club_contacts;
create policy club_contacts_delete_admin on public.club_contacts
  for delete using (
    (select internal.has_site_capability('site.clubs.profile.manage'))
    or club_id in (select unnest(internal.club_ids_with('club.profile.edit')))
  );

drop policy if exists team_contacts_select on public.team_contacts;
create policy team_contacts_select on public.team_contacts
  for select using (
    is_public = true
    or (select internal.has_site_capability('site.clubs.view'))
    or (select t.club_id from public.teams t where t.id = team_contacts.team_id) in (select unnest(internal.club_ids_with('team.team.view')))
  );

drop policy if exists team_contacts_write_admin on public.team_contacts;
create policy team_contacts_write_admin on public.team_contacts
  for insert with check (
    (select internal.has_site_capability('site.team_roles.manage'))
    or (select t.club_id from public.teams t where t.id = team_contacts.team_id) in (select unnest(internal.club_ids_with('team.team.manage')))
  );

drop policy if exists team_contacts_update_admin on public.team_contacts;
create policy team_contacts_update_admin on public.team_contacts
  for update using (
    (select internal.has_site_capability('site.team_roles.manage'))
    or (select t.club_id from public.teams t where t.id = team_contacts.team_id) in (select unnest(internal.club_ids_with('team.team.manage')))
  );

drop policy if exists team_contacts_delete_admin on public.team_contacts;
create policy team_contacts_delete_admin on public.team_contacts
  for delete using (
    (select internal.has_site_capability('site.team_roles.manage'))
    or (select t.club_id from public.teams t where t.id = team_contacts.team_id) in (select unnest(internal.club_ids_with('team.team.manage')))
  );

-- 5. opponent notes -------------------------------------------------------------------------------------
-- A club's private notes about the clubs it plays. Written and read by the club's administration, and
-- J names no key of its own for them; club.settings.manage is the club-administration key that already
-- covers a club's own private operating record, and the site answer is the support master rather than a
-- bare role, so nobody reads one club's notes about another without an explicit site capability.
drop policy if exists club_opponent_notes_all_scoped on public.club_opponent_notes;
create policy club_opponent_notes_all_scoped on public.club_opponent_notes
  for all using (
    (select internal.has_site_capability('site.support.act_in_club'))
    or owning_club_id in (select unnest(internal.club_ids_with('club.settings.manage')))
  ) with check (
    (select internal.has_site_capability('site.support.act_in_club'))
    or owning_club_id in (select unnest(internal.club_ids_with('club.settings.manage')))
  );

-- 6. One site-only policy on a 4H table -----------------------------------------------------------------
-- club_memberships_insert_admin is gated on nothing but internal.is_site_admin(). AA.3 puts the bulk
-- site-side removal in Slice 7, and this is NOT that: it is a single policy on a table this slice owns,
-- whose site master J.3 line 389 already records as site.memberships.manage. Taking it here is a
-- one-line canonicalisation that leaves 4H's own ten tables free of raw role checks; leaving it would
-- have meant weakening the assertion below to let one through, which is the wrong way round.
drop policy if exists club_memberships_insert_admin on public.club_memberships;
create policy club_memberships_insert_admin on public.club_memberships
  for insert with check ((select internal.has_site_capability('site.memberships.manage')));

do $$
declare v_bad text[];
begin
  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname in ('public','storage')
    and tablename in ('clubs','teams','club_memberships','role_assignments','club_join_requests',
                      'invitations','invitation_teams','club_contacts','team_contacts','club_opponent_notes')
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '\m(is_club_admin|is_site_admin|is_full_site_admin)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4H policy still decides authority by a raw role helper: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- 7. The club-administration gates -----------------------------------------------------------------------
-- Six function bodies that decide a CLUB ADMINISTRATION question by asking internal.is_club_admin. The
-- other fourteen callers of that helper are deliberately left: can_manage_club_fixtures is 4C's,
-- can_manage_team is 4B's, and the rollover, graduation, handover and tournament-team functions are
-- AA.3 row 4i's. This slice does not improve its own retirement number by taking them.
create or replace function internal.can_address_club_audience(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.has_site_capability('site.support.act_in_club')
      or internal.can('messaging.announcement.send_club', 'club', p_club_id, null, null);
$$;

comment on function internal.can_address_club_audience(uuid) is
  'May the caller address this club''s audience? Slice 4H completes what 4F began: the site branch was '
  'canonicalised then and the club branch asked is_club_admin, carried to this slice. J.10 line 514 '
  'gives speaking to a club messaging.announcement.send_club, which is the Club Admin''s.';

do $$
declare r record; v_new text; v_touched int := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname || '.' || p.proname) in (
      'public.decide_player_dispensation', 'public.revoke_player_dispensation',
      'public.get_club_member_directory', 'public.update_message_communication_policy',
      'public.list_fixtures_since_deactivation')
  loop
    v_new := r.def;
    if r.proname in ('decide_player_dispensation', 'revoke_player_dispensation') then
      -- Section T: "the club stage needs CA". fixture.dispensation.approve_club is ACTIVE and held by
      -- CA alone, which is that sentence written as a capability. The SOURCE-TEAM stage beside it keeps
      -- asking approve_player_dispensations: that is a fixtures question and AA.3 row 4c's to retire.
      v_new := regexp_replace(v_new, 'internal\.is_club_admin\(([a-zA-Z0-9_\.]+)\)',
        'internal.can(''fixture.dispensation.approve_club'', ''club'', \1, null, null)', 'g');
    elsif r.proname = 'get_club_member_directory' then
      v_new := regexp_replace(v_new, 'internal\.is_club_admin\(([a-zA-Z0-9_\.]+)\)',
        'internal.can(''people.member.view'', ''club'', \1, null, null)', 'g');
    elsif r.proname = 'update_message_communication_policy' then
      -- J.4 line 403: club.settings.manage is the key for "communication policy, scheduling policy".
      v_new := regexp_replace(v_new, 'internal\.is_club_admin\(([a-zA-Z0-9_\.]+)\)',
        'internal.can(''club.settings.manage'', ''club'', \1, null, null)', 'g');
    else
      -- A club's own fixtures since it was deactivated, read while deciding whether to reactivate.
      -- Nothing in the application calls this yet; canonicalising it rather than leaving a raw-role
      -- gate on a zero-caller RPC is the same reasoning that dropped staffs_team in 4F.
      v_new := regexp_replace(v_new, 'internal\.is_club_admin\(([a-zA-Z0-9_\.]+)\)',
        'internal.can(''club.profile.edit'', ''club'', \1, null, null)', 'g');
    end if;
    -- The site branch beside each of them becomes the recorded master, never a bare role. Both
    -- spellings are handled: update_message_communication_policy asks is_FULL_site_admin, which is a
    -- different literal and was missed on the first pass -- the assertion below is what caught it.
    -- J.4 line 403 gives club.settings.manage the site master site.clubs.profile.manage.
    v_new := replace(v_new, 'internal.is_full_site_admin()', 'internal.has_site_capability(''site.clubs.profile.manage'')');
    v_new := replace(v_new, 'internal.is_site_admin()', 'internal.has_site_capability(''site.support.act_in_club'')');
    if v_new <> r.def then execute v_new; v_touched := v_touched + 1; end if;
  end loop;
  raise notice 'Slice 4H: % club-administration gates canonicalised', v_touched;
end $$;

do $$
declare v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname || '.' || p.proname) in (
      'internal.can_address_club_audience', 'public.decide_player_dispensation',
      'public.revoke_player_dispensation', 'public.get_club_member_directory',
      'public.update_message_communication_policy', 'public.list_fixtures_since_deactivation')
    and p.prosrc ~ '\m(is_club_admin|is_site_admin|is_full_site_admin)\(';
  if cardinality(v_bad) > 0 then
    raise exception 'a Slice 4H gate still decides authority by a raw role helper: %', array_to_string(v_bad, ', ');
  end if;
end $$;
