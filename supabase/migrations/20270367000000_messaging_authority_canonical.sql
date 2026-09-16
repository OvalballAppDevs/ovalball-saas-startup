-- Slice 4F (messaging and notifications) -- part 1: move the messaging authority gates onto the
-- canonical capability decision (Phase 2 AA.3 row 4f, design J.10 lines 511-523).
--
-- AA.3 row 4f retires three things: `staffs_team`, `is_messaging_staff`, and the Site Admin
-- conversation read. All three are here.
--
--   is_messaging_staff   already 0 policies / 0 bodies. Nothing to retire; the matrix asserts it
--                        stays at zero rather than quietly coming back.
--   staffs_team          0 policies / 3 bodies, all of them messaging.
--   Site Admin read      three policies carry is_site_admin(); TWO of them are this slice's. The
--                        third, club_safeguarding_officer_conversations_select, is a safeguarding
--                        thread and belongs to 4G under locked decision D-S4-2. It is not touched.
--
-- EXPAND STEP. Every function is replaced in place and every caller already calls it, so this
-- changes answers without changing shapes. No privilege is withdrawn and no object the deployed
-- application needs is added.

-- 1. The third-party predicate ------------------------------------------------------------------
-- internal.staffs_team is not a caller-authority helper: it takes a USER ID and asks whether THAT
-- person staffs a team, which is how two people on opposing fixture staff are allowed to message
-- each other. internal.can() reads auth.uid() and therefore cannot answer it. The canonical form of
-- a third-party question is internal.capability_decision, which takes a subject.
--
-- p_check_session is deliberately FALSE. Session checks -- AAL, session version -- are properties of
-- the caller's live session, and this asks what somebody else's standing authority is. Applying the
-- caller's session rules to a third party would make "may I message this person" depend on whether
-- THEY happen to be signed in.
--
-- The replacement was proved behaviour-preserving before it was written: across CA, FS, TM, CO, MB,
-- SO, Site Admin, another club's admin and a stranger, the canonical decision returns exactly what
-- the role-string body returned. That matters more here than elsewhere, because widening this gate
-- would widen who may direct-message whom.
create or replace function internal.team_messaging_staff(p_user_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_user_id is not null and p_team_id is not null and coalesce((
    select d.allowed
    from internal.capability_decision(
      p_user_id,
      'messaging.fixture_conversation.participate',
      'team',
      (select t.club_id from public.teams t where t.id = p_team_id),
      p_team_id, null, false, false) d
  ), false);
$$;

comment on function internal.team_messaging_staff(uuid, uuid) is
  'Slice 4F: does THIS PERSON hold messaging.fixture_conversation.participate for this team. The '
  'canonical replacement for internal.staffs_team, which matched membership role strings directly. '
  'Subject-taking, so it uses capability_decision rather than can(); session checks are off because '
  'the question is about someone else''s standing authority, not their live session.';

-- 2. Fixture conversations -----------------------------------------------------------------------
-- J.10 line 511: "Site Admin blanket read removed". The bare internal.is_site_admin() goes, and a
-- site answer arrives through site.messages.moderate, which J.10 marks "(reported only)" -- the
-- moderation capability, not a general read of every club's conversations.
create or replace function internal.can_access_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  -- NOTHING ASKED, NOTHING ANSWERED. With both identifiers null there is no fixture conversation
  -- under discussion, so the honest answer is false. Without this line the site branch below fires
  -- on a question about nothing, and because fixture_messages_select_scoped evaluates
  -- can_access_any_conversation as its FIRST term on every row, that "yes" reaches rows belonging
  -- to team, direct and safeguarding threads -- exactly the blanket read J.10 line 511 removes,
  -- arriving through the back of the same policy it was removed from the front of.
  --
  -- It is also where the slice's read-path cost was going: EXPLAIN on a 300-message team
  -- conversation showed every row paying a full capability decision to answer a question with no
  -- subject. The guard is one boolean and it removes that entirely.
  select (p_fixture_id is not null or p_fixture_request_id is not null) and (
    internal.has_site_capability('site.messages.moderate')
    or (p_fixture_id is not null and exists (
      select 1 from public.fixtures f
      where f.conversation_id = (select conversation_id from public.fixtures where id = p_fixture_id)
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = f.owning_team_id), f.owning_team_id, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = f.opponent_team_id), f.opponent_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club',
                             (select club_id from public.teams where id = f.owning_team_id), null, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club',
                                  (select club_id from public.teams where id = f.opponent_team_id), null, null)))
    ))
    or (p_fixture_request_id is not null and exists (
      select 1 from public.fixture_requests r
      join public.fixture_request_groups g on g.id = r.group_id
      where r.id = p_fixture_request_id
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = r.requesting_team_id), r.requesting_team_id, null)
             or (r.target_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = r.target_team_id), r.target_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club', g.requesting_club_id, null, null)
             or (g.opponent_club_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club', g.opponent_club_id, null, null)))
    ))
    -- KEPT, and its absence was a bug in the first draft of this function. Someone explicitly added
    -- to a conversation by public.add_fixture_conversation_participant reaches it because they were
    -- invited to, not because of any capability they hold -- a referee or a neutral-ground contact
    -- has no club or team standing here at all. Rewriting the capability branches quietly removed
    -- this one, which would have locked every named participant out of the thread they were added
    -- to. The table is empty in development, so nothing failed; the performance work is what put
    -- the old body side by side with the new one and made the missing branch visible.
    --
    -- This is not new invitation machinery and does not touch D-S4-2: the table, both RPCs and this
    -- branch all predate Slice 4 and are restored exactly as they were.
    or (auth.uid() is not null and exists (
      select 1 from public.fixture_conversation_participants p
      where p.user_id = auth.uid()
        and ((p_fixture_id is not null and p.fixture_id = p_fixture_id)
             or (p_fixture_request_id is not null and p.fixture_request_id = p_fixture_request_id))
    )));
$$;

comment on function internal.can_access_fixture_conversation(uuid, uuid) is
  'Slice 4F: messaging.fixture_conversation.participate at either side''s club or team, the '
  'explicit site.messages.moderate, or an explicit conversation participant row. The Site Admin '
  'blanket read is gone (J.10 line 511).';

-- 3. The other conversation readers ---------------------------------------------------------------
-- Same shape, same three legacy pieces: the bare is_site_admin(), can_manage_team (4B's helper) and
-- can_manage_club_fixtures (4C's). All three are answering a MESSAGING question here -- "may you
-- take part in this conversation" -- which is why J.10 gives it its own key rather than borrowing
-- the fixtures one.
create or replace function internal.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.messages.moderate')
    or exists (
      select 1 from public.fixtures f
      where f.conversation_id = p_conversation_id
        and (internal.can('messaging.fixture_conversation.participate', 'team',
                          (select club_id from public.teams where id = f.owning_team_id), f.owning_team_id, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'team',
                                  (select club_id from public.teams where id = f.opponent_team_id), f.opponent_team_id, null))
             or internal.can('messaging.fixture_conversation.participate', 'club',
                             (select club_id from public.teams where id = f.owning_team_id), null, null)
             or (f.opponent_team_id is not null
                 and internal.can('messaging.fixture_conversation.participate', 'club',
                                  (select club_id from public.teams where id = f.opponent_team_id), null, null)))
    );
$$;

-- A club-to-club conversation is club business, so J.10 line 516 gives it its own key,
-- messaging.club_conversation.manage (CA and FS), rather than 4C's fixture-planning gate.
create or replace function internal.can_access_any_conversation(p_fixture_id uuid, p_fixture_request_id uuid, p_club_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    (p_club_conversation_id is null and internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id))
    or (p_club_conversation_id is not null and (
      internal.has_site_capability('site.support.act_in_club')
      or exists (
        select 1 from public.club_conversations cc
        where cc.id = p_club_conversation_id
          and (internal.can('messaging.club_conversation.manage', 'club', cc.requesting_club_id, null, null)
               or internal.can('messaging.club_conversation.manage', 'club', cc.recipient_club_id, null, null))
      )
    ));
$$;

-- 4. Team conversations ----------------------------------------------------------------------------
-- J.10 lines 512-513 mark these KEEP LOGIC, and the logic is kept: only the STAFF branch changes.
-- The guardian and linked-player branches below it decide whether a parent or a child may read their
-- own team's conversation, which is Slice 4A's family question, and 4A owns its meaning.
--
-- The club-scope disjunct asks messaging.fixture_conversation.participate rather than the team key,
-- because that is the key J.10 gives CA and FS at CLUB scope; the team keys are CO, TM, PL and PG.
-- Without it a Club Admin would lose the moderation read of their own club's team conversations.
CREATE OR REPLACE FUNCTION internal.can_view_team_conversation(p_team_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;

  -- Staff read the history whether or not the conversation is currently
  -- running, because moderation and accountability outlive the switch.
  if internal.has_site_capability('site.messages.moderate')
     or internal.can('messaging.team_conversation.view', 'team', v_club_id, p_team_id, null)
     or internal.can('messaging.fixture_conversation.participate', 'club', v_club_id, null, null) then
    return true;
  end if;

  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active'
      and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  return internal.guardian_permission_effective(v_linked_player_id, 'view_team_conversation');
end;
$function$;

CREATE OR REPLACE FUNCTION internal.can_send_team_conversation(p_team_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
  v_policy record;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;

  -- IS THERE A CONVERSATION TO SPEAK IN? Asked before who is asking,
  -- because a message nobody can read is not a message.
  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  select * into v_policy from public.get_effective_message_policy(v_club_id);
  if not coalesce(v_policy.allow_team_conversations, true) then
    return false;
  end if;

  if internal.has_site_capability('site.messages.moderate')
     or internal.can('messaging.team_conversation.send', 'team', v_club_id, p_team_id, null)
     or internal.can('messaging.fixture_conversation.participate', 'club', v_club_id, null, null) then
    return true;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active'
      and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  -- The canonical guardian permission, unchanged. A young player speaks in
  -- their team's conversation only where their guardian has said they may.
  return internal.guardian_permission_effective(v_linked_player_id, 'send_team_messages');
end;
$function$;

-- 5. The staffs_team call sites, and the announcement SPLIT ---------------------------------------
-- Three functions asked internal.staffs_team; all three now ask internal.team_messaging_staff, which
-- is the same question resolved canonically. The rewrite is mechanical -- each body is otherwise
-- untouched -- because these decide who may direct-message whom, and changing anything else about
-- them while migrating the gate would make the diff impossible to review honestly.
--
-- may_send_as carries J.10's SPLIT: team.community.manage becomes messaging.announcement.send_club
-- at club scope and messaging.announcement.send_team at team scope. That mapping is not invented
-- here -- public.capability_key_map already records exactly those two targets for the deprecated
-- key, which is why the shadow comparison showed no behaviour change for either announcement
-- question across all nine personas.
--
-- set_team_conversation_active and team_conversation_state follow the same split: enabling or
-- reading a team conversation is the same authority as speaking to that team.
CREATE OR REPLACE FUNCTION internal.may_direct_message(p_other_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return false;
  end if;

  -- THE SAFEGUARDING BOUNDARY, FIRST AND UNCONDITIONAL. Nothing below can
  -- reach past this: not a shared club, not a guardian relationship, not a
  -- fixture, not an existing thread, not administrator status.
  if not internal.is_adult_messaging_user(v_me)
     or not internal.is_adult_messaging_user(p_other_user_id) then
    return false;
  end if;

  -- A BLOCK IS ABSOLUTE, in both directions.
  if internal.is_personally_blocked(v_me, p_other_user_id)
     or internal.is_personally_blocked(p_other_user_id, v_me) then
    return false;
  end if;

  -- SITE, THEN EVERY CLUB EITHER PERSON BELONGS TO.
  if not internal.direct_messaging_allowed_for_pair(v_me, p_other_user_id) then
    return false;
  end if;

  -- DISCOVERY: is there a relationship Ovalball actually knows about?

  -- Already talking.
  if exists (
    select 1 from public.direct_conversations d
    where d.user_a = least(v_me, p_other_user_id) and d.user_b = greatest(v_me, p_other_user_id)
  ) then
    return true;
  end if;

  -- SAME CLUB, by any of the three routes. One clause now covers
  -- coach<->coach, coach<->guardian, guardian<->guardian,
  -- coach<->adult player and adult player<->adult player.
  if exists (
    select 1
    from internal.messaging_club_ids(v_me) a
    join internal.messaging_club_ids(p_other_user_id) b on b.club_id = a.club_id
  ) then
    return true;
  end if;

  -- Same team staff, even across clubs.
  if exists (
    select 1
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = v_me and ca.status = 'active'
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.user_id = p_other_user_id and cb.status = 'active'
  ) then
    return true;
  end if;

  -- Opposite sides of a live fixture. The 60-day window is a product
  -- decision, unchanged from 20270254000000.
  if exists (
    select 1
    from public.fixtures f
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and (
        (internal.team_messaging_staff(v_me, f.owning_team_id) and internal.team_messaging_staff(p_other_user_id, f.opponent_team_id))
        or
        (internal.team_messaging_staff(v_me, f.opponent_team_id) and internal.team_messaging_staff(p_other_user_id, f.owning_team_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fixture_opposition_contacts(p_fixture_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, team_label text, club_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  f public.fixtures;
  v_my_team uuid;
  v_their_team uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into f from public.fixtures where id = p_fixture_id;
  if not found or f.opponent_team_id is null then
    -- No internal opponent: nobody to talk to, and the caller is told that by
    -- getting nothing rather than by an error.
    return;
  end if;

  -- WHICH SIDE AM I ON? Answered from canonical team staffing, never from
  -- the fixture's own text fields.
  if internal.team_messaging_staff(auth.uid(), f.owning_team_id) then
    v_my_team := f.owning_team_id;
    v_their_team := f.opponent_team_id;
  elsif internal.team_messaging_staff(auth.uid(), f.opponent_team_id) then
    v_my_team := f.opponent_team_id;
    v_their_team := f.owning_team_id;
  else
    -- Not involved in this fixture. Nothing, rather than an error: a fixture
    -- id somebody is not part of should not confirm anything about it.
    return;
  end if;

  return query
  select
    cm.user_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    t.display_name,
    d.name
  from public.club_memberships cm
  join public.teams t on t.id = v_their_team
  join public.clubs c on c.id = t.club_id
  join public.club_directory d on d.id = c.directory_id
  join public.profiles p on p.id = cm.user_id
  where cm.club_id = t.club_id
    and cm.status = 'active'
    -- They must actually staff the opposing team, not merely belong to its
    -- club: a fixture is a reason to contact the people running that team,
    -- not everybody the club has ever registered.
    and internal.team_messaging_staff(cm.user_id, v_their_team)
    -- AND THE ONE AUTHORITY. Adults only, policy-permitted on both sides,
    -- never across a block. This is what stops the fixture becoming a way
    -- around any of them.
    and internal.may_direct_message(cm.user_id)
  order by 2;
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_direct_message_candidates()
 RETURNS TABLE(user_id uuid, display_name text, context_label text, context_detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  with me as (select auth.uid() as id),
  my_clubs as (select club_id from internal.messaging_club_ids((select id from me))),
  club_people as (
    -- Everybody connected to one of my clubs, by any of the three routes.
    select distinct x.user_id, 'Your club'::text as label, d.name as detail
    from my_clubs mc
    join public.clubs c on c.id = mc.club_id
    join public.club_directory d on d.id = c.directory_id
    cross join lateral (
      select cm.user_id from public.club_memberships cm
      where cm.club_id = mc.club_id and cm.status = 'active'
      union
      select pl.user_id from public.players pl
      join public.player_team_memberships ptm on ptm.player_id = pl.id and ptm.status = 'active'
      join public.teams t on t.id = ptm.team_id
      where t.club_id = mc.club_id and pl.user_id is not null
      union
      select g.guardian_user_id from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
      join public.teams t on t.id = ptm.team_id
      where t.club_id = mc.club_id and g.status = 'active'
    ) x
  ),
  team_mates as (
    select distinct cb.user_id, 'Your team'::text as label, t.display_name as detail
    from public.team_permissions ta
    join public.club_memberships ca on ca.id = ta.membership_id and ca.user_id = (select id from me) and ca.status = 'active'
    join public.teams t on t.id = ta.team_id
    join public.team_permissions tb on tb.team_id = ta.team_id
    join public.club_memberships cb on cb.id = tb.membership_id and cb.status = 'active'
  ),
  fixture_contacts as (
    select distinct cm.user_id, 'Fixture contact'::text as label, opp.display_name as detail
    from public.fixtures f
    join public.teams mine on mine.id in (f.owning_team_id, f.opponent_team_id)
    join public.teams opp on opp.id in (f.owning_team_id, f.opponent_team_id) and opp.id <> mine.id
    join public.club_memberships cm on cm.club_id = opp.club_id and cm.status = 'active'
    where f.kickoff_date >= current_date - interval '60 days'
      and coalesce(f.status, '') <> 'Cancelled'
      and internal.team_messaging_staff((select id from me), mine.id)
      and internal.team_messaging_staff(cm.user_id, opp.id)
  ),
  everyone as (
    select * from team_mates
    union all select * from club_people
    union all select * from fixture_contacts
  ),
  ranked as (
    select e.user_id, e.label, e.detail,
           row_number() over (
             partition by e.user_id
             order by case e.label when 'Your team' then 1 when 'Your club' then 2 else 3 end
           ) as rn
    from everyone e
  )
  select r.user_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
         r.label,
         r.detail
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
    -- THE SAME AUTHORITY THE SEND PATH APPLIES: this removes minors, blocked
    -- pairs and policy-disabled pairs without the list saying which.
    and internal.may_direct_message(r.user_id)
  order by 2;
$function$;

CREATE OR REPLACE FUNCTION internal.may_send_as(p_identity_type text, p_identity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Speaking as yourself needs no authority beyond being signed in.
  if p_identity_type = 'person' then
    return p_identity_id is null;
  end if;

  -- Ovalball speaks for Ovalball. Deliberately the narrowest test in this
  -- function: an ordinary Site Admin role is not enough to issue platform
  -- communication in every recipient's Messenger.
  if p_identity_type = 'platform' then
    return p_identity_id is null and internal.is_full_site_admin();
  end if;

  if p_identity_type = 'team' then
    if p_identity_id is null then
      return false;
    end if;
    select club_id into v_club_id from public.teams where id = p_identity_id;
    if v_club_id is null then
      return false;
    end if;
    -- The SAME capability that already governs team community management,
    -- and the same club-scoped audience authority the email side uses. No
    -- new authority is invented here.
    return internal.can('messaging.announcement.send_team', 'team', v_club_id, p_identity_id, null)
        or internal.can('messaging.announcement.send_club', 'club', v_club_id, null, null)
        or internal.can_address_team_audience(p_identity_id)
        or internal.is_full_site_admin();
  end if;

  if p_identity_type = 'club' then
    if p_identity_id is null then
      return false;
    end if;
    return internal.can_address_club_audience(p_identity_id)
        or internal.can_manage_club_fixtures(p_identity_id)
        or internal.is_full_site_admin();
  end if;

  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_team_conversation_active(p_team_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  -- The SAME capability the table's own write policy names. Not a new
  -- authority, and not a wider one.
  if not (internal.can('messaging.announcement.send_team', 'team', v_club_id, p_team_id, null)
          or internal.can('messaging.announcement.send_club', 'club', v_club_id, null, null)
          or internal.is_full_site_admin()) then
    raise exception 'You are not authorised to manage this team''s conversation.' using errcode = '42501';
  end if;

  -- Turning it ON is subject to the feature policy; turning it OFF never is.
  -- A club that has switched team conversations off must still be able to
  -- close one that is already running.
  if p_active then
    select * into v_policy from public.get_effective_message_policy(v_club_id);
    if not coalesce(v_policy.allow_team_conversations, true) then
      raise exception 'Team conversations are turned off.' using errcode = '42501';
    end if;
  end if;

  insert into public.team_conversations (team_id, active, enabled_by, enabled_at)
  values (p_team_id, p_active,
          case when p_active then auth.uid() end,
          case when p_active then now() end)
  on conflict (team_id) do update set
    active = excluded.active,
    enabled_by  = case when p_active then auth.uid() else public.team_conversations.enabled_by end,
    enabled_at  = case when p_active then now()      else public.team_conversations.enabled_at end,
    disabled_by = case when p_active then null       else auth.uid() end,
    disabled_at = case when p_active then null       else now() end,
    updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.team_conversation_state(p_team_id uuid)
 RETURNS TABLE(active boolean, allowed_by_policy boolean, may_manage boolean, may_send boolean, enabled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
  v_policy record;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  select * into v_policy from public.get_effective_message_policy(v_club_id);

  return query
  select
    coalesce(tc.active, false),
    coalesce(v_policy.allow_team_conversations, true),
    internal.can('messaging.announcement.send_team', 'team', v_club_id, p_team_id, null)
      or internal.can('messaging.announcement.send_club', 'club', v_club_id, null, null)
      or internal.is_full_site_admin(),
    internal.can_send_team_conversation(p_team_id),
    tc.enabled_at
  from (select p_team_id as team_id) t
  left join public.team_conversations tc on tc.team_id = t.team_id;
end;
$function$;

-- 6. The messaging RPCs ----------------------------------------------------------------------------
--   update_club_message_policy      is_club_admin           -> messaging.policy.manage       (J.10 517)
--   update_global_message_policy    is_full_site_admin      -> site.messages.policy.manage   (J.10 522)
--   block_user_from_club_messages   deprecated fixture key  -> messaging.block.manage        (J.10 518)
--   lift_club_message_block                 + is_site_admin -> site.messages.moderate
--   start_or_get_club_conversation  can_manage_club_fixtures-> messaging.club_conversation.manage (J.10 516)
--   respond_to_club_conversation            + is_site_admin -> site.support.act_in_club
--
-- The block pair is the one with a visible consequence, and it is intended: a Fixtures Secretary
-- held the deprecated fixture-editing key and so could block someone from a club's conversations;
-- J.10 line 518 gives messaging.block.manage to a Club Admin and a Safeguarding Officer instead.
-- The stale comment explaining the old borrow is replaced rather than left to mislead -- and
-- deliberately without quoting the retired key, because the retirement assertions grep for exactly
-- that literal and a comment carrying it would flag for ever.
CREATE OR REPLACE FUNCTION public.update_club_message_policy(p_club_id uuid, p_use_default_direct_attachments boolean, p_allow_direct_attachments boolean, p_use_default_document_library_sharing boolean, p_allow_document_library_sharing boolean, p_use_default_image_uploads boolean, p_allow_image_uploads boolean, p_use_default_contact_card_sharing boolean, p_allow_contact_card_sharing boolean, p_use_default_participant_management boolean, p_allow_participant_management boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.message_policies;
  v_direct boolean; v_docs boolean; v_images boolean; v_cards boolean; v_participants boolean;
begin
  if not (internal.can('messaging.policy.manage', 'club', p_club_id, null, null) or internal.has_site_capability('site.messages.policy.manage')) then
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
$function$;

CREATE OR REPLACE FUNCTION public.update_global_message_policy(p_allow_direct_attachments boolean, p_allow_document_library_sharing boolean, p_allow_image_uploads boolean, p_allow_contact_card_sharing boolean, p_allow_participant_management boolean, p_allow_direct_attachments_club_override_allowed boolean, p_allow_document_library_sharing_club_override_allowed boolean, p_allow_image_uploads_club_override_allowed boolean, p_allow_contact_card_sharing_club_override_allowed boolean, p_allow_participant_management_club_override_allowed boolean, p_max_attachment_size_bytes integer, p_allowed_file_types text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not internal.has_site_capability('site.messages.policy.manage') then
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
$function$;

CREATE OR REPLACE FUNCTION public.block_user_from_club_messages(p_club_id uuid, p_user_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- Slice 4F: messaging.block.manage, which design J.10 line 518 gives to a Club Admin and a
  -- Safeguarding Officer. This previously borrowed the deprecated fixture-editing key, because at
  -- the time no messaging key existed and an absent key fails closed for everybody. The messaging
  -- key exists now, so the borrow goes: blocking somebody from a club's conversations is
  -- moderation, not fixture management. A Fixtures Secretary therefore no longer holds it, and a
  -- Safeguarding Officer now does.
  if not (internal.can('messaging.block.manage', 'club', p_club_id, null, null) or internal.has_site_capability('site.messages.moderate')) then
    raise exception 'You are not authorised to block someone from this club''s conversations.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot block yourself.';
  end if;
  -- Blocking somebody who could block you back is a moderation fight, not
  -- moderation. Club-level authority is settled by a Club Admin, not in a
  -- message thread.
  if internal.can('messaging.block.manage', 'club', p_club_id, null, null) then
    if exists (
      select 1 from public.club_memberships cm
      where cm.user_id = p_user_id and cm.club_id = p_club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active'
    ) and not internal.has_site_capability('site.messages.moderate') then
      raise exception 'A Club Admin cannot be blocked from their own club''s conversations.' using errcode = '42501';
    end if;
  end if;

  insert into public.club_message_blocks (club_id, blocked_user_id, blocked_by, reason)
  values (p_club_id, p_user_id, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (club_id, blocked_user_id) where lifted_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.club_message_blocks
    where club_id = p_club_id and blocked_user_id = p_user_id and lifted_at is null;
  end if;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lift_club_message_block(p_club_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if not (internal.can('messaging.block.manage', 'club', p_club_id, null, null) or internal.has_site_capability('site.messages.moderate')) then
    raise exception 'You are not authorised to change this club''s message blocks.' using errcode = '42501';
  end if;
  update public.club_message_blocks
  set lifted_at = now(), lifted_by = auth.uid()
  where club_id = p_club_id and blocked_user_id = p_user_id and lifted_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_or_get_club_conversation(p_my_club_id uuid, p_target_club_id uuid, p_first_message text)
 RETURNS TABLE(conversation_id uuid, status text, is_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.club_conversations;
  v_target_status text;
  v_are_partners boolean;
  v_new_id uuid;
  v_pending_outgoing_count integer;
  v_trimmed_message text;
  v_my_club_name text;
begin
  if not (internal.has_site_capability('site.support.act_in_club') or internal.can('messaging.club_conversation.manage', 'club', p_my_club_id, null, null)) then
    raise exception 'Not authorized to message on behalf of this club.' using errcode = '42501';
  end if;
  if p_my_club_id = p_target_club_id then
    raise exception 'You cannot start a conversation with your own club.';
  end if;

  select c.status into v_target_status from public.clubs c where c.id = p_target_club_id;
  if v_target_status is null then
    raise exception 'Club not found.';
  end if;
  if v_target_status <> 'active' then
    raise exception 'This club is not currently active on Ovalball -- direct messaging is not available yet.' using errcode = 'P0001';
  end if;

  select cc.* into v_existing from public.club_conversations cc
  where least(cc.requesting_club_id, cc.recipient_club_id) = least(p_my_club_id, p_target_club_id)
    and greatest(cc.requesting_club_id, cc.recipient_club_id) = greatest(p_my_club_id, p_target_club_id)
    and cc.status <> 'declined'
  order by cc.created_at desc
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.status, false;
    return;
  end if;

  v_trimmed_message := nullif(trim(coalesce(p_first_message, '')), '');
  if v_trimmed_message is null then
    raise exception 'A first message is required to start a conversation.';
  end if;

  if exists (
    select 1 from public.club_conversations cc
    where least(cc.requesting_club_id, cc.recipient_club_id) = least(p_my_club_id, p_target_club_id)
      and greatest(cc.requesting_club_id, cc.recipient_club_id) = greatest(p_my_club_id, p_target_club_id)
      and cc.status = 'declined' and cc.responded_at > now() - interval '48 hours'
  ) then
    raise exception 'This club recently declined a message request -- please wait before trying again.' using errcode = 'P0001';
  end if;

  select count(*) into v_pending_outgoing_count from public.club_conversations cc
  where cc.requesting_club_id = p_my_club_id and cc.status = 'pending';
  if v_pending_outgoing_count >= 5 then
    raise exception 'You have too many pending message requests already -- wait for one to be answered before starting another.' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      and least(cp.requesting_club_id, cp.partner_club_id) = least(p_my_club_id, p_target_club_id)
      and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(p_my_club_id, p_target_club_id)
  ) into v_are_partners;

  insert into public.club_conversations (requesting_club_id, recipient_club_id, status, requested_by, responded_by, responded_at)
  values (
    p_my_club_id, p_target_club_id, case when v_are_partners then 'accepted' else 'pending' end, auth.uid(),
    case when v_are_partners then auth.uid() else null end, case when v_are_partners then now() else null end
  )
  returning id into v_new_id;

  insert into public.fixture_messages (club_conversation_id, sender_user_id, body, kind)
  values (v_new_id, auth.uid(), v_trimmed_message, 'message');

  if not v_are_partners then
    select cd.name into v_my_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_my_club_id;
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'club_message_request_received', 'New message request',
      format('%s wants to start a conversation with your club.', coalesce(v_my_club_name, 'A club')),
      jsonb_build_object('club_conversation_id', v_new_id, 'requesting_club_id', p_my_club_id)
    from public.club_memberships cm
    where cm.club_id = p_target_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return query select v_new_id, (case when v_are_partners then 'accepted' else 'pending' end)::text, true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_club_conversation(p_conversation_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c public.club_conversations;
  v_recipient_club_name text;
begin
  select * into v_c from public.club_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Message request not found.'; end if;
  if v_c.status <> 'pending' then raise exception 'This request has already been answered.'; end if;

  if not (internal.has_site_capability('site.support.act_in_club') or internal.can('messaging.club_conversation.manage', 'club', v_c.recipient_club_id, null, null)) then
    raise exception 'Only the invited club may respond to this message request.' using errcode = '42501';
  end if;

  update public.club_conversations
  set status = case when p_approve then 'accepted' else 'declined' end,
      responded_by = auth.uid(), responded_at = now()
  where id = p_conversation_id;

  if p_approve then
    select cd.name into v_recipient_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_c.recipient_club_id;
    insert into public.fixture_messages (club_conversation_id, sender_user_id, body, kind)
    values (p_conversation_id, auth.uid(), format('Message request accepted by %s', coalesce(v_recipient_club_name, 'the club')), 'system_event');
  else
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'club_message_request_declined', 'Message request declined',
      format('Your message request to %s was declined.', coalesce((select cd.name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_c.recipient_club_id), 'the club')),
      jsonb_build_object('club_conversation_id', p_conversation_id)
    from public.club_memberships cm
    where cm.club_id = v_c.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;
end;
$function$;

-- 7. Site moderation: the RENAME -------------------------------------------------------------------
-- J.10 line 521 marks site.messages.moderate a RENAME from a "message_moderator literal", and that
-- is exactly what was there: a string comparison against internal.site_admin_role(auth.uid()).
-- A role literal is the oldest form of raw-role authority in this codebase, and it is the last one
-- in the messaging domain.
CREATE OR REPLACE FUNCTION public.moderator_delete_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may delete a reported message.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fixture_messages where id = p_message_id) then
    raise exception 'Message not found.';
  end if;

  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'moderator'
  where id = p_message_id and deleted_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_message_thread_content(p_fixture_id uuid DEFAULT NULL::uuid, p_fixture_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, sender_user_id uuid, sender_name text, body text, created_at timestamp with time zone, report_status text, report_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may open message content.' using errcode = '42501';
  end if;
  if p_fixture_id is null and p_fixture_request_id is null then
    raise exception 'A fixture or fixture request must be specified.';
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('fixture_messages_content_view', coalesce(p_fixture_id, p_fixture_request_id), 'update', auth.uid(),
    jsonb_build_object('fixture_id', p_fixture_id, 'fixture_request_id', p_fixture_request_id, 'viewed_at', now()));

  return query
  select fm.id, fm.sender_user_id, coalesce(p.first_name || ' ' || p.surname, 'Unknown'), fm.body, fm.created_at, fm.report_status, fm.report_reason
  from public.fixture_messages fm
  left join public.profiles p on p.id = fm.sender_user_id
  where (p_fixture_id is not null and fm.fixture_id = p_fixture_id)
     or (p_fixture_request_id is not null and fm.fixture_request_id = p_fixture_request_id)
  order by fm.created_at;
end;
$function$;

-- The same literal decided three more messaging functions that J.10 does not name individually:
-- delete_fixture_message_attachment, mark_message_report_reviewed and resolve_message_report.
-- They carry the identical check, they are all moderation, and leaving them would have meant
-- the slice retired a role literal in two places and left it deciding authority in three.
-- The assertion at the end of this migration is what found them.

CREATE OR REPLACE FUNCTION public.delete_fixture_message_attachment(p_attachment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.fixture_message_attachments;
  m public.fixture_messages;
begin
  select * into a from public.fixture_message_attachments where id = p_attachment_id;
  if not found then
    raise exception 'Attachment not found.';
  end if;
  select * into m from public.fixture_messages where id = a.message_id;

  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may remove an attachment.' using errcode = '42501';
  end if;

  delete from public.fixture_message_attachments where id = p_attachment_id;
  if m.fixture_id is not null then
    perform internal.fixture_result_system_event(m.fixture_id, auth.uid(), 'An attachment was removed by a Site Admin.');
  end if;

  return a.storage_path;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_message_report_reviewed(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may review a reported message.' using errcode = '42501';
  end if;
  update public.fixture_messages
  set report_status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_message_id and report_status = 'open';
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_message_report(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.has_site_capability('site.messages.moderate')) then
    raise exception 'Only a Full Site Admin or Message Moderator may resolve a reported message.' using errcode = '42501';
  end if;
  update public.fixture_messages
  set report_status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_message_id and report_status in ('open', 'reviewed');
end;
$function$;

-- 8. Retire the raw-role helper --------------------------------------------------------------------
-- internal.staffs_team matched team_permissions ('team_admin','coach','manager') and membership
-- roles ('CLUB_ADMIN','FIXTURE_SECRETARY') directly. Its three callers now ask
-- internal.team_messaging_staff, so it has none: no policy, no function, no application code.
--
-- It is dropped rather than left in place, for the reason Slices 4C and 4D dropped theirs: a
-- zero-caller raw-role helper is a hazard, because the next person needing "does this person staff
-- this team" would find the role-string answer before the canonical one.
drop function if exists internal.staffs_team(uuid, uuid);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'internal' and p.proname = 'staffs_team') then
    raise exception 'internal.staffs_team survived; a caller must still exist.';
  end if;
  -- internal.admin_role_for_site_profile and internal.site_profile_for_admin_role are excluded by
  -- name, and deliberately: they TRANSLATE between the legacy site-admin role string and the
  -- Slice 3 site profile (SITE_MOD <-> 'message_moderator'). Naming the string is their whole job;
  -- they decide no authority. Site-side is_site_admin removal is Slice 7 and is not pulled forward.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public','internal')
               and p.proname not in ('admin_role_for_site_profile','site_profile_for_admin_role')
               and p.prosrc like '%message_moderator%') then
    raise exception 'the message_moderator role literal still decides authority somewhere.';
  end if;
end $$;

-- 9. The last borrow in may_send_as ----------------------------------------------------------------
-- Speaking AS A CLUB asked internal.can_manage_club_fixtures -- 4C's fixture-planning gate answering
-- "may you issue communication in this club's name". J.10 line 514 gives that to
-- messaging.announcement.send_club.
--
-- The three internal.is_full_site_admin() branches beside it are NOT one question, and the
-- retirement ledger is what made that clear: two of them have a recorded canonical answer and one
-- does not.
--
--   team, club   J.10 lines 514-515 give both announcement keys the SAME site master equivalent,
--                site.support.act_in_club. So `or is_full_site_admin()` in those two branches is
--                not unmapped site-side residue at all -- it is the site master, written as a role
--                string. It becomes internal.has_site_capability('site.support.act_in_club'),
--                exactly as 4E did for the venue and calendar gates. No authority moves: that key
--                sits in SITE_FULL and in no other bundle, so the same people answer the same way,
--                and they now answer through the canonical decision rather than a role literal.
--
--   platform     "May you speak as Ovalball itself" has NO row in J.10 and no key in the
--                catalogue -- there is no messaging.announcement.send_platform. Borrowing
--                site.messages.policy.manage would give the check a meaning the catalogue does not
--                give it, and minting a key is outside AA.3 row 4f. AA.3 closes by assigning
--                site-side is_site_admin removal to Slice 7, and this one call waits for it.
--                authority_helper_retirement records it as the single permitted residue, by name,
--                so that a NEW legacy call in any 4f function still fails the ledger.
CREATE OR REPLACE FUNCTION internal.may_send_as(p_identity_type text, p_identity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_club_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Speaking as yourself needs no authority beyond being signed in.
  if p_identity_type = 'person' then
    return p_identity_id is null;
  end if;

  -- Ovalball speaks for Ovalball. Deliberately the narrowest test in this
  -- function: an ordinary Site Admin role is not enough to issue platform
  -- communication in every recipient's Messenger.
  if p_identity_type = 'platform' then
    return p_identity_id is null and internal.is_full_site_admin();
  end if;

  if p_identity_type = 'team' then
    if p_identity_id is null then
      return false;
    end if;
    select club_id into v_club_id from public.teams where id = p_identity_id;
    if v_club_id is null then
      return false;
    end if;
    -- The SAME capability that already governs team community management,
    -- and the same club-scoped audience authority the email side uses. No
    -- new authority is invented here.
    return internal.can('messaging.announcement.send_team', 'team', v_club_id, p_identity_id, null)
        or internal.can('messaging.announcement.send_club', 'club', v_club_id, null, null)
        or internal.can_address_team_audience(p_identity_id)
        or internal.has_site_capability('site.support.act_in_club');
  end if;

  if p_identity_type = 'club' then
    if p_identity_id is null then
      return false;
    end if;
    return internal.can_address_club_audience(p_identity_id)
        or internal.can('messaging.announcement.send_club', 'club', p_identity_id, null, null)
        or internal.has_site_capability('site.support.act_in_club');
  end if;

  return false;
end;
$function$;

-- 10. The audience helpers may_send_as leans on ------------------------------------------------------
-- FOUND BY MA-K, not by reading the diff. may_send_as delegates its team and club branches to
-- internal.can_address_team_audience / can_address_club_audience -- "the same club-scoped audience
-- authority the email side uses", as the original comment put it. Both of those open with a bare
-- internal.is_site_admin().
--
-- That is a blanket Site Admin bypass sitting directly under the send path, and it is reachable in
-- production: ANY site-admin role -- read_only, content, fixture_ops, club_data, user_access,
-- message_moderator -- could post in any club's or any team's name, and could read the recipient
-- list behind that audience. Canonicalising may_send_as's own branches while leaving this in place
-- would have moved the bypass one function further away rather than closing it, which is why MA-K9
-- and MA-K10 assert through may_send_as rather than at it.
--
-- The site branch becomes site.support.act_in_club: the site master J.10 lines 514-515 record for
-- BOTH announcement keys, already used by 4E for the venue and calendar gates. It sits in SITE_FULL
-- and in no other bundle, so a Full Site Admin is unaffected and every narrower site profile loses
-- an authority it should never have held. That is an INTENDED CHANGE of exactly the same kind as
-- J.10 line 511's removal of the Site Admin blanket conversation read.
--
-- DELIBERATELY NOT TOUCHED, and carried: the club branch still asks internal.is_club_admin and the
-- team branch still asks team.attendance.view. Those are club-level questions, not the bypass, and
-- is_club_admin is AA.3 row 4h's to retire. Moving them here would change who inside a club may
-- broadcast, on no contract from J.10, in a slice that has no mandate for it.
create or replace function internal.can_address_club_audience(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.has_site_capability('site.support.act_in_club')
      or internal.is_club_admin(p_club_id);
$$;

comment on function internal.can_address_club_audience(uuid) is
  'May the caller address this club''s audience? Slice 4F: the site branch is the canonical site '
  'master site.support.act_in_club (J.10 lines 514-515), not a bare is_site_admin bypass. The '
  'club branch still asks is_club_admin and is Slice 4H''s to retire.';

create or replace function internal.can_address_team_audience(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.has_site_capability('site.support.act_in_club')
    or internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = p_team_id), p_team_id)
    or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = p_team_id), null);
$$;

comment on function internal.can_address_team_audience(uuid) is
  'May the caller address this team''s audience? Slice 4F: the site branch is the canonical site '
  'master site.support.act_in_club (J.10 lines 514-515), not a bare is_site_admin bypass. The '
  'team.attendance.view branches are the existing club-level contract and are left as they are.';

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'internal'
               and p.proname in ('can_address_club_audience','can_address_team_audience')
               and p.prosrc ~ '\mis_site_admin\(') then
    raise exception 'an audience helper still carries the blanket Site Admin bypass.';
  end if;
end $$;
