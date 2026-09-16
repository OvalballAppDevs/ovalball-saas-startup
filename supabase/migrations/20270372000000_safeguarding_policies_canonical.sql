-- =====================================================================================================
-- SLICE 4G (3/3) — THE POLICIES, AND THE TRANSITIONAL KEYS RETIRED
--
-- Contract stage. Everything this file removes has a canonical replacement installed by 20270370 and
-- 20270371, which is why it is a separate migration: between the two there is a window in which both
-- answers exist, and nothing is ever without one.
--
-- Slice 3 recorded club.safeguarding.view and club.safeguarding.message as capability_key_map rows
-- that map to THEMSELVES -- deliberately, at legacy parity, "until 4g". They are Club-Admin-only keys
-- standing in for two capabilities J.12 gives to most of a club, and while they stood the safeguarding
-- contact card was hidden from parents and a member could open a safeguarding thread and then be
-- refused permission to reply in it. This is 4g.
-- =====================================================================================================

-- 1. The last two gates still asking the transitional keys ---------------------------------------------
create or replace function public.start_or_get_safeguarding_officer_conversation(p_club_id uuid, p_officer_id uuid, p_first_message text)
returns table(conversation_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_officer_user_id uuid;
  v_conversation_id uuid;
  v_is_new boolean := false;
begin
  if not internal.can('safeguarding.conversation.start', 'club', p_club_id, null, null) then
    raise exception 'Not authorized to message this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_message), '') = '' then
    raise exception 'A message is required.';
  end if;

  select user_id into v_officer_user_id
  from public.club_safeguarding_officers
  where id = p_officer_id and club_id = p_club_id and status = 'active';

  -- The officer must be CONFIRMED, not merely listed. A nomination awaiting AN-6 is not somebody a
  -- member should be able to raise a safeguarding concern with: they hold nothing yet, so they could
  -- not read the reply.
  if v_officer_user_id is null or not internal.is_active_safeguarding_officer(v_officer_user_id, p_club_id) then
    raise exception 'This club has no active, registered Safeguarding Officer to message on Ovalball -- use the email fallback instead.' using errcode = '22023';
  end if;
  if v_officer_user_id = auth.uid() then
    raise exception 'You are the Safeguarding Officer for this club.' using errcode = '22023';
  end if;

  select c.id into v_conversation_id from public.club_safeguarding_officer_conversations c
  where c.club_id = p_club_id and c.requester_user_id = auth.uid() and c.officer_user_id = v_officer_user_id;

  if v_conversation_id is null then
    insert into public.club_safeguarding_officer_conversations (club_id, requester_user_id, officer_user_id)
    values (p_club_id, auth.uid(), v_officer_user_id) returning id into v_conversation_id;
    v_is_new := true;
    insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body, kind)
    values (v_conversation_id, auth.uid(), trim(p_first_message), 'message');
  end if;

  return query select v_conversation_id, v_is_new;
end;
$$;

-- The three invitation-administration RPCs. Their INVITATION behaviour is untouched -- that is Slice 5's
-- and D-S4-2 says so -- but who may operate them is a safeguarding appointment question, which is this
-- slice's. Mechanical: the legacy key they asked already mapped to exactly this canonical one.
do $$
declare r record; v_src text;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('invite_safeguarding_officer', 'resend_safeguarding_officer_invitation', 'revoke_safeguarding_officer_invitation')
      and p.prosrc like '%club.safeguarding.manage_contact%'
  loop
    v_src := replace(r.def,
      'internal.has_capability(''club.safeguarding.manage_contact'', ''club'', ',
      'internal.can(''safeguarding.officer.nominate'', ''club'', ');
    -- internal.can takes five arguments where has_capability took four; close the extra scope columns.
    v_src := regexp_replace(v_src,
      'internal\.can\(''safeguarding\.officer\.nominate'', ''club'', ([a-zA-Z0-9_\.]+)\)',
      'internal.can(''safeguarding.officer.nominate'', ''club'', \1, null, null)', 'g');
    execute v_src;
  end loop;
end $$;

-- 2. The policies --------------------------------------------------------------------------------------
-- club_safeguarding_officer_conversations: the blanket site read, gone. Section T is explicit -- "No RLS
-- read" for Ovalball -- and public.site_safeguarding_review is the way in, with a reason attached.
drop policy if exists club_safeguarding_officer_conversations_select on public.club_safeguarding_officer_conversations;
create policy club_safeguarding_officer_conversations_select on public.club_safeguarding_officer_conversations
  for select to authenticated using (
    requester_user_id = (select auth.uid())
    or (select auth.uid()) = any (internal.active_safeguarding_officer_ids(club_id))
  );

-- The contact card, and the invitation list beside it.
drop policy if exists club_safeguarding_officers_select on public.club_safeguarding_officers;
create policy club_safeguarding_officers_select on public.club_safeguarding_officers
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select internal.can('safeguarding.contact.view', 'club', club_id, null, null))
    or (select internal.has_site_capability('site.support.view_club'))
  );

drop policy if exists club_safeguarding_officer_invitations_select on public.club_safeguarding_officer_invitations;
create policy club_safeguarding_officer_invitations_select on public.club_safeguarding_officer_invitations
  for select to authenticated using (
    (select internal.can('safeguarding.officer.nominate', 'club', club_id, null, null))
    or (select internal.has_site_capability('site.support.view_club'))
  );

-- player_team_dispensation, the policy AA.3 row 4g assigns to this slice. Two changes: the club's
-- Safeguarding Officer can see a dispensation for a child at their club, which J.12 line 547 says they
-- may and which nothing implemented; and the blanket site read becomes the canonical site master.
-- can_manage_team and can_manage_club_fixtures stay -- deciding a dispensation is a fixtures question
-- and those are 4B's and 4C's helpers, not this slice's to re-point.
drop policy if exists player_team_dispensation_select on public.player_team_dispensation;
create policy player_team_dispensation_select on public.player_team_dispensation
  for select to authenticated using (
    internal.can_manage_team(source_team_id)
    or internal.can_manage_team(target_team_id)
    or internal.can_manage_club_fixtures((select t.club_id from public.teams t where t.id = player_team_dispensation.source_team_id))
    or (select internal.can('safeguarding.dispensation.view', 'club',
                            (select t.club_id from public.teams t where t.id = player_team_dispensation.source_team_id), null, null))
    or (select internal.has_site_capability('site.support.view_club'))
  );

-- 3. The transitional keys, retired --------------------------------------------------------------------
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal')
    and p.prosrc ~ 'club\.safeguarding\.(view|message|manage_contact)';
  if cardinality(v_bad) > 0 then
    raise exception 'a transitional safeguarding key still has callers: %', array_to_string(v_bad, ', ');
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'club\.safeguarding\.';
  if cardinality(v_bad) > 0 then
    raise exception 'a transitional safeguarding key is still in a policy: %', array_to_string(v_bad, ', ');
  end if;
end $$;

delete from public.capability_key_map
where legacy_key in ('club.safeguarding.view', 'club.safeguarding.message', 'club.safeguarding.manage_contact');

update public.capabilities
set status = 'DEPRECATED'
where key in ('club.safeguarding.view', 'club.safeguarding.message')
  and exists (select 1 from public.capabilities c2 where c2.key = capabilities.key);

do $$
begin
  if exists (select 1 from public.capability_key_map where legacy_key like 'club.safeguarding.%') then
    raise exception 'a transitional safeguarding adapter row survived.';
  end if;
  if exists (select 1 from pg_policies
             where tablename in ('club_safeguarding_officer_conversations','club_safeguarding_officers',
                                 'club_safeguarding_officer_invitations','player_team_dispensation','safeguarding_thread_reviews')
               and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '\mis_site_admin\(') then
    raise exception 'a safeguarding policy still carries a blanket Site Admin read.';
  end if;
end $$;

-- 4. The dispensation policy, hoisted ------------------------------------------------------------------
-- Measured, not guessed. EXPLAIN (ANALYZE) on 200 dispensations read by a Safeguarding Officer showed
-- ~110ms, with the time in can_manage_team and can_manage_club_fixtures -- 4B's and 4C's helpers --
-- running once per row and answering NO for an officer every time, before the term that says yes was
-- ever reached. Postgres cannot inline a SECURITY DEFINER function, so the only way an officer stops
-- paying for three fixture-authority questions per row is to answer the safeguarding one first.
--
-- internal.safeguarding_dispensation_team_ids is caller-dependent but row-independent, so it becomes
-- an InitPlan: evaluated once per query rather than once per row. Putting it first costs a Club Admin
-- one extra uncorrelated evaluation and saves an officer 200 correlated ones.
--
-- EQUIVALENCE, which is the part that matters. The set is built from the caller's ACTIVE memberships,
-- and that is sound rather than convenient: safeguarding.dispensation.view is a club-scoped key held
-- only by the SO bundle, internal.bundle_source requires an ACTIVE membership for the role branch, and
-- rule 5 ignores an override whose holder's membership is not ACTIVE. There is no route to this key
-- without an active membership of the club. safeguarding_authority_matrix SA-P asserts the hoisted set
-- and the per-row answer agree rather than leaving that argument to the comment.
create or replace function internal.safeguarding_dispensation_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}')
  from public.club_memberships cm
  join public.teams t on t.club_id = cm.club_id
  where cm.user_id = auth.uid() and cm.state = 'ACTIVE'
    and internal.can('safeguarding.dispensation.view', 'club', cm.club_id, null, null);
$$;

comment on function internal.safeguarding_dispensation_team_ids() is
  'Slice 4G: the teams whose club dispensations the caller may see as a Safeguarding Officer. Hoisted '
  'out of player_team_dispensation_select so it is an InitPlan rather than a per-row SECURITY DEFINER '
  'call. Caller-dependent, row-independent, and equivalent to the per-row question (SA-P).';

revoke execute on function internal.safeguarding_dispensation_team_ids() from public, anon;
grant execute on function internal.safeguarding_dispensation_team_ids() to authenticated, service_role;

drop policy if exists player_team_dispensation_select on public.player_team_dispensation;
create policy player_team_dispensation_select on public.player_team_dispensation
  for select to authenticated using (
    source_team_id in (select unnest(internal.safeguarding_dispensation_team_ids()))
    or (select internal.has_site_capability('site.support.view_club'))
    or internal.can_manage_team(source_team_id)
    or internal.can_manage_team(target_team_id)
    or internal.can_manage_club_fixtures((select t.club_id from public.teams t where t.id = player_team_dispensation.source_team_id))
  );
