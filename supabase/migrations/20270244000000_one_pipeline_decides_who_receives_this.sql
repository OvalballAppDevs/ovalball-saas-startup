-- =====================================================================
-- ONE PIPELINE DECIDES WHO RECEIVES THIS
--
-- Ovalball already resolves audiences in three places -- team, club and
-- platform -- and all three do the same two things: check the sender's
-- authority, then hand a player list to the canonical safeguarding answer.
-- They are correct, and this migration does not replace them.
--
-- What they cannot do is the rest of the question. Each returns a bare
-- set of user ids, which throws away WHY somebody is being written to. A
-- delivery row needs to record that Sarah is receiving this as Harry's
-- guardian rather than as a player herself; "who" without "why" cannot be
-- audited, cannot be explained to the recipient, and cannot be filtered.
--
-- Nor do they cover the four newer stages: an explicitly selected audience,
-- Exclude U18, personal blocks, and the feature policy. Adding those to each
-- of the three separately is how the three drift apart -- and an audience
-- resolver that drifts sends a child's information to the wrong adult.
--
-- So: ONE pipeline, in a fixed order, reusing the existing primitives at
-- every stage rather than re-deriving them.
--
--   1  SENDER AUTHORITY     can this actor address this audience at all
--   2  FEATURE POLICY       is this kind of message switched on here
--   3  REQUESTED AUDIENCE   what was asked for, as criteria
--   4  CANONICAL MEMBERSHIP who is actually in it, now
--   5  EXCLUDE-U18 FILTER   before routing, not after -- see below
--   6  CANONICAL SAFEGUARDING  internal.player_contact_eligibility, always
--   7  PERSONAL BLOCKS      people only; organisations are not blockable
--   8  DEDUPLICATION        one person, one delivery, one stated reason
--
-- ON STAGE ORDER. The approved order lists the feature policy at stage 7.
-- It is applied at stage 2 here because it is a GATE that raises, not a
-- filter that removes -- the outcome is identical either way, and failing
-- before resolving several hundred people is the difference between a
-- refusal and a refusal that costs a table scan first. Every stage that
-- actually removes recipients is in the approved order exactly.
--
-- ON EXCLUDE-U18 RUNNING BEFORE SAFEGUARDING. It filters the AUDIENCE, not
-- the address list: an under-18 player is removed from the audience, so
-- neither they NOR their guardian receives the message. The alternative --
-- filtering after routing -- would send "adults only" content to a child's
-- parent about that child, which is the opposite of what the sender asked
-- for. An adult who is in the audience for a second reason still receives
-- it by that route, which is what stage 8 is for.
--
-- WHAT THIS DOES NOT DO. It does not open Player->Player, Player->Staff or
-- Guardian->Staff messaging. A selected audience is authorised against the
-- SAME team and club audience authority the other three resolvers use, so
-- this function can only reach people the sender could already address.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MAY THIS ACTOR ADDRESS THIS SPECIFIC PLAYER?
-- ---------------------------------------------------------------------
-- The per-person authority behind a 'selected' audience. Deliberately built
-- from the existing audience authorities rather than from a new rule: a
-- selected audience is a SUBSET of someone the sender could already address
-- wholesale, never a way to reach further.
create or replace function internal.may_address_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id
      and ptm.status = 'active'
      and (internal.can_address_team_audience(t.id)
           or internal.can_address_club_audience(t.club_id))
  );
$$;

comment on function internal.may_address_player(uuid) is
  'May the caller address this player''s recipients? True only where they could already address a team or club audience containing that player -- a selected audience narrows reach, it never widens it.';

revoke all on function internal.may_address_player(uuid) from public, anon;
grant execute on function internal.may_address_player(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. THE PIPELINE
-- ---------------------------------------------------------------------
create or replace function internal.resolve_audience(
  p_scope text,
  p_scope_id uuid,
  p_audience_spec jsonb default '{}'::jsonb,
  p_exclude_u18 boolean default false,
  p_sender_identity_type text default 'person',
  p_reply_mode text default 'NO_REPLY'
)
returns table (
  recipient_user_id uuid,
  safeguarding_route text,
  concerning_player_id uuid,
  inclusion_reason text
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_policy record;
  v_player_ids uuid[];
  v_named_user_ids uuid[];
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_scope not in ('team', 'club', 'platform', 'selected') then
    raise exception 'Unknown audience scope: %', p_scope;
  end if;

  -- =================================================================
  -- STAGE 1: SENDER AUTHORITY
  -- The same three checks the existing resolvers make, so authority has
  -- one definition and not two.
  -- =================================================================
  if p_scope = 'team' then
    if p_scope_id is null then
      raise exception 'A team audience needs a team.';
    end if;
    if not internal.can_address_team_audience(p_scope_id) then
      raise exception 'You are not authorised to address this team''s audience.' using errcode = '42501';
    end if;
    select t.club_id into v_club_id from public.teams t where t.id = p_scope_id;

  elsif p_scope = 'club' then
    if p_scope_id is null then
      raise exception 'A club audience needs a club.';
    end if;
    if not internal.can_address_club_audience(p_scope_id) then
      raise exception 'You are not authorised to address this club''s audience.' using errcode = '42501';
    end if;
    v_club_id := p_scope_id;

  elsif p_scope = 'platform' then
    if not internal.is_full_site_admin() then
      raise exception 'Only a Full Site Admin may address the platform-wide audience.' using errcode = '42501';
    end if;
  end if;

  -- =================================================================
  -- STAGE 2: FEATURE POLICY
  -- Resolved against the club whose people are being written to, so a club
  -- that has switched something off is not reached through it by someone
  -- outside the club either.
  -- =================================================================
  select * into v_policy from public.get_effective_message_policy(v_club_id);

  if p_scope = 'team' and not coalesce(v_policy.allow_team_announcements, true) then
    raise exception 'Team announcements are turned off.' using errcode = '42501';
  end if;
  if p_scope = 'club' and not coalesce(v_policy.allow_club_announcements, true) then
    raise exception 'Club announcements are turned off.' using errcode = '42501';
  end if;
  if p_scope = 'platform' and not coalesce(v_policy.allow_platform_announcements, true) then
    raise exception 'Platform announcements are turned off.' using errcode = '42501';
  end if;
  if p_scope = 'selected' and not coalesce(v_policy.allow_multi_person_conversations, true) then
    raise exception 'Messaging a chosen group of people is turned off.' using errcode = '42501';
  end if;
  if p_reply_mode = 'GROUP_DISCUSSION' and not coalesce(v_policy.allow_group_discussion, true) then
    raise exception 'Group discussion is turned off.' using errcode = '42501';
  end if;
  if p_reply_mode = 'PRIVATE_REPLY' and not coalesce(v_policy.allow_private_replies, true) then
    raise exception 'Private replies are turned off.' using errcode = '42501';
  end if;

  -- =================================================================
  -- STAGE 3-4: THE REQUEST, THEN WHO IS ACTUALLY IN IT NOW
  -- The spec holds criteria; membership is read live at send time, so an
  -- announcement composed yesterday does not reach somebody who left.
  -- =================================================================
  if p_scope = 'team' then
    select array_agg(player_id) into v_player_ids
    from internal.team_playing_group_player_ids(p_scope_id);

  elsif p_scope = 'club' then
    select array_agg(player_id) into v_player_ids
    from internal.club_playing_group_player_ids(p_scope_id);

  elsif p_scope = 'platform' then
    select array_agg(player_id) into v_player_ids
    from internal.platform_playing_group_player_ids();

  else
    -- SELECTED. Every named player is authorised individually; one the
    -- sender may not address fails the whole send rather than being quietly
    -- dropped, because a composer that silently shortens its own recipient
    -- list is worse than one that refuses.
    select array_agg(value::uuid) into v_player_ids
    from jsonb_array_elements_text(coalesce(p_audience_spec -> 'player_ids', '[]'::jsonb));

    if v_player_ids is not null then
      if exists (
        select 1 from unnest(v_player_ids) pid
        where not internal.may_address_player(pid)
      ) then
        raise exception 'You are not authorised to message one or more of the people selected.'
          using errcode = '42501';
      end if;
    end if;

    -- Named adults -- staff colleagues, an adult player addressed directly.
    -- Authorised by shared club membership with a club the sender may
    -- address, which is the same rule list_addable_club_members applies.
    select array_agg(value::uuid) into v_named_user_ids
    from jsonb_array_elements_text(coalesce(p_audience_spec -> 'user_ids', '[]'::jsonb));

    if v_named_user_ids is not null then
      if exists (
        select 1 from unnest(v_named_user_ids) uid
        where not exists (
          select 1 from public.club_memberships m
          where m.user_id = uid and internal.can_address_club_audience(m.club_id)
        )
      ) then
        raise exception 'You are not authorised to message one or more of the people selected.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);
  v_named_user_ids := coalesce(v_named_user_ids, array[]::uuid[]);

  -- =================================================================
  -- STAGE 5: EXCLUDE U18 -- ON THE AUDIENCE, BEFORE ROUTING
  -- =================================================================
  if p_exclude_u18 then
    select coalesce(array_agg(pid), array[]::uuid[]) into v_player_ids
    from unnest(v_player_ids) pid
    where internal.player_effective_age(pid) >= 18;

    -- A named adult who is in fact an under-18 player with their own login
    -- is excluded by the same rule. Having an account is not being an adult.
    select coalesce(array_agg(uid), array[]::uuid[]) into v_named_user_ids
    from unnest(v_named_user_ids) uid
    where not exists (
      select 1 from public.players p
      where p.user_id = uid and internal.player_effective_age(p.id) < 18
    );
  end if;

  -- =================================================================
  -- STAGE 6-8: SAFEGUARDING, BLOCKS, DEDUPLICATION
  -- =================================================================
  return query
  with routed as (
    -- STAGE 6. The one canonical answer to "who may be written to about
    -- this child, and as what". Never re-derived here.
    select
      e.user_id as ruser,
      case when e.relationship = 'guardian' then 'guardian' else 'direct' end as rroute,
      case when e.relationship = 'guardian' then e.player_id else null end as rplayer,
      case when e.relationship = 'guardian'
           then 'Guardian of a player in this audience'
           else 'Player in this audience' end as rreason
    from internal.player_contact_eligibility(v_player_ids) e
    where e.user_id is not null

    union all

    select uid, 'direct', null::uuid, 'Named individually'
    from unnest(v_named_user_ids) uid
  ),
  permitted as (
    -- STAGE 7. A personal block stops a PERSON. It does not stop a team,
    -- a club or Ovalball -- see 20270241000000 for why that asymmetry is
    -- the point rather than a gap.
    select * from routed r
    where p_sender_identity_type <> 'person'
       or not internal.is_personally_blocked(v_actor, r.ruser)
  )
  -- STAGE 8. One person, one delivery. Where somebody qualifies twice --
  -- an adult player who is also a guardian -- the direct route wins, because
  -- a message reaching you about yourself is the more specific fact.
  select distinct on (p.ruser) p.ruser, p.rroute, p.rplayer, p.rreason
  from permitted p
  order by p.ruser, p.rroute;
end;
$$;

comment on function internal.resolve_audience(text, uuid, jsonb, boolean, text, text) is
  'The one server-authoritative audience pipeline: authority, feature policy, requested audience, live membership, Exclude U18, canonical safeguarding, personal blocks, deduplication. Returns why each person is included, not just that they are.';

revoke all on function internal.resolve_audience(text, uuid, jsonb, boolean, text, text) from public, anon;
grant execute on function internal.resolve_audience(text, uuid, jsonb, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. WHO THIS WILL NOT REACH, AND WHY
-- ---------------------------------------------------------------------
-- A resolver that silently returns a shorter list is the failure mode that
-- matters here: the sender believes they told everybody. This is the same
-- audience, resolved the same way, reporting the players who have NO route.
-- The composer shows it before sending; nothing is hidden by being empty.
create or replace function public.audience_unreachable(
  p_scope text,
  p_scope_id uuid,
  p_audience_spec jsonb default '{}'::jsonb,
  p_exclude_u18 boolean default false
)
returns table (player_id uuid, outcome text)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare v_player_ids uuid[];
begin
  -- Authority is re-checked by going through the same resolver, so this can
  -- never become a way to read an audience the caller may not address.
  perform 1 from internal.resolve_audience(
    p_scope, p_scope_id, p_audience_spec, p_exclude_u18, 'person', 'NO_REPLY') limit 1;

  if p_scope = 'team' then
    select array_agg(t.player_id) into v_player_ids from internal.team_playing_group_player_ids(p_scope_id) t;
  elsif p_scope = 'club' then
    select array_agg(c.player_id) into v_player_ids from internal.club_playing_group_player_ids(p_scope_id) c;
  elsif p_scope = 'platform' then
    select array_agg(pl.player_id) into v_player_ids from internal.platform_playing_group_player_ids() pl;
  else
    select array_agg(value::uuid) into v_player_ids
    from jsonb_array_elements_text(coalesce(p_audience_spec -> 'player_ids', '[]'::jsonb));
  end if;

  v_player_ids := coalesce(v_player_ids, array[]::uuid[]);

  if p_exclude_u18 then
    select coalesce(array_agg(pid), array[]::uuid[]) into v_player_ids
    from unnest(v_player_ids) pid
    where internal.player_effective_age(pid) >= 18;
  end if;

  return query
    select e.player_id, e.outcome
    from internal.player_recipient_exclusions(v_player_ids) e;
end;
$$;

comment on function public.audience_unreachable(text, uuid, jsonb, boolean) is
  'The players in this audience who have no eligible recipient, with the canonical reason. Shown before sending so a sender is never told they reached everybody when they did not.';

revoke all on function public.audience_unreachable(text, uuid, jsonb, boolean) from public, anon;
grant execute on function public.audience_unreachable(text, uuid, jsonb, boolean) to authenticated;
