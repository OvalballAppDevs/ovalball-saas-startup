-- =====================================================================
-- THE CANONICAL PREDICATE ANSWERS THIS TOO
--
-- 20270244000000 introduced Exclude U18 and implemented it the obvious way:
--
--     where internal.player_effective_age(pid) >= 18
--
-- scripts/verify-recipient-audience-boundary.mjs rejected it, and the guard
-- is right. Ovalball has ONE answer to any age-and-consent question about a
-- player -- internal.player_contact_eligibility -- and a second copy of the
-- rule is exactly how the two drift apart. When they drift, the version that
-- decides who receives a message about a child is the one that was written
-- in a hurry.
--
-- The temptation is to make the guard quieter, or to add a sibling helper
-- with the rule in it. Both are the same mistake wearing a different hat.
-- The correct fix is that the canonical predicate should ANSWER this
-- question, because it is a question about the same thing.
--
-- So player_contact_eligibility gains one column: is_adult. It is computed
-- exactly once, in the one function permitted to compute it, and every
-- caller that needs to know reads it there. Nothing about the existing
-- eligibility rules changes -- the same rows come back with the same
-- outcomes -- so this widens what the predicate can be asked without
-- weakening anything it already decides.
--
-- WHAT THIS MEANS FOR EXCLUDE U18
--
-- The filter now reads: drop every recipient whose inclusion is on account
-- of a player who is not an adult. A guardian row carries that child's
-- player_id, so excluding the child excludes the guardian with them -- which
-- is the behaviour 20270244000000 documented and tested, now expressed
-- through the canonical answer instead of beside it.
--
-- The return type grows, so the function is dropped and recreated. Its four
-- SQL-language callers reference the columns by NAME and hold no recorded
-- dependency on its signature, so they keep working unchanged.
-- =====================================================================

drop function if exists internal.player_contact_eligibility(uuid[]);

create function internal.player_contact_eligibility(p_player_ids uuid[])
returns table (
  player_id uuid,
  user_id uuid,
  relationship text,
  outcome text,
  -- THE NEW COLUMN. Whether the PLAYER this row concerns is an adult -- not
  -- whether the recipient is. On a guardian row it describes the child.
  is_adult boolean
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  with asked as (
    select distinct a.player_id from unnest(coalesce(p_player_ids, array[]::uuid[])) as a(player_id)
  ),
  eligible as (
    select distinct a.player_id, r.user_id, r.relationship
    from asked a
    cross join lateral (
      -- EVERY ACTIVE GUARDIAN. Active is the operative word: a pending
      -- guardian-link request grants nothing, and an ended relationship is
      -- not a relationship. Every active guardian is returned, not the
      -- earliest one -- both parents are the child's guardians.
      select g.guardian_user_id as user_id, 'guardian'::text as relationship
      from public.guardians g
      where g.player_id = a.player_id and g.status = 'active'

      union

      -- THE PLAYER THEMSELVES, only where the canonical consent domain
      -- already allows a young person to be dealt with directly. HAVING A
      -- LOGIN IS NOT THE TEST: a 12-year-old with their own account is still
      -- a 12-year-old.
      select p.user_id, 'self'::text
      from public.players p
      where p.id = a.player_id
        and p.user_id is not null
        and (
          internal.player_effective_age(p.id) >= 18
          or (
            internal.player_effective_age(p.id) in (16, 17)
            and internal.guardian_permission_effective(p.id, 'direct_coach_communication')
          )
        )
    ) r
    where r.user_id is not null
  )
  select e.player_id, e.user_id, e.relationship, 'ELIGIBLE'::text,
         internal.player_effective_age(e.player_id) >= 18
  from eligible e

  union all

  -- NOBODY. The reason comes from the same evaluation rather than a second
  -- age lookup somewhere else, and the row exists so a caller can say what
  -- happened instead of silently sending to a shorter list.
  select a.player_id, null::uuid, null::text,
    case
      when internal.player_effective_age(a.player_id) in (16, 17)
        and exists (select 1 from public.players p where p.id = a.player_id and p.user_id is not null)
        and not internal.guardian_permission_effective(a.player_id, 'direct_coach_communication')
      then 'CONSENT_REQUIRED_NO_GUARDIAN'
      else 'NO_ELIGIBLE_GUARDIAN'
    end,
    internal.player_effective_age(a.player_id) >= 18
  from asked a
  where not exists (select 1 from eligible e where e.player_id = a.player_id);
$$;

comment on function internal.player_contact_eligibility(uuid[]) is
  'The one answer to "who may legitimately be contacted about this player, as what, and is that player an adult". Every recipient-resolution path consumes it and may only NARROW what it returns.';

revoke all on function internal.player_contact_eligibility(uuid[]) from public, anon;

-- ---------------------------------------------------------------------
-- THE PIPELINE READS THE ANSWER RATHER THAN RE-DERIVING IT
-- ---------------------------------------------------------------------
-- Identical to 20270244000000 except for stage 5, which now filters on
-- is_adult from the canonical predicate. The stage ORDER is unchanged in
-- effect: dropping a child's row drops the guardian rows that carry that
-- child's player_id along with it, which is what "filter the audience, not
-- the address list" meant.
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
  v_named_player_ids uuid[];
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_scope not in ('team', 'club', 'platform', 'selected') then
    raise exception 'Unknown audience scope: %', p_scope;
  end if;

  -- STAGE 1: SENDER AUTHORITY
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

  -- STAGE 2: FEATURE POLICY
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

  -- STAGE 3-4: THE REQUEST, THEN WHO IS ACTUALLY IN IT NOW
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

  -- STAGE 5 (named adults). A named recipient who is in fact an under-18
  -- player with their own login is excluded by the SAME canonical answer.
  -- Having an account is not being an adult.
  if p_exclude_u18 and array_length(v_named_user_ids, 1) is not null then
    select coalesce(array_agg(p.id), array[]::uuid[]) into v_named_player_ids
    from public.players p where p.user_id = any (v_named_user_ids);

    select coalesce(array_agg(uid), array[]::uuid[]) into v_named_user_ids
    from unnest(v_named_user_ids) uid
    where not exists (
      select 1
      from public.players p
      join internal.player_contact_eligibility(v_named_player_ids) e on e.player_id = p.id
      where p.user_id = uid and not e.is_adult
    );
  end if;

  -- STAGE 6-8: SAFEGUARDING, EXCLUDE U18, BLOCKS, DEDUPLICATION
  return query
  with routed as (
    -- STAGE 6. The one canonical answer, which now also says whether the
    -- player this row concerns is an adult.
    select
      e.user_id as ruser,
      case when e.relationship = 'guardian' then 'guardian' else 'direct' end as rroute,
      case when e.relationship = 'guardian' then e.player_id else null end as rplayer,
      case when e.relationship = 'guardian'
           then 'Guardian of a player in this audience'
           else 'Player in this audience' end as rreason
    from internal.player_contact_eligibility(v_player_ids) e
    where e.user_id is not null
      -- STAGE 5. Drop every recipient included on account of a player who is
      -- not an adult -- the child, and their guardian along with them.
      and (not p_exclude_u18 or e.is_adult)

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
  -- STAGE 8. One person, one delivery.
  select distinct on (p.ruser) p.ruser, p.rroute, p.rplayer, p.rreason
  from permitted p
  order by p.ruser, p.rroute;
end;
$$;

revoke all on function internal.resolve_audience(text, uuid, jsonb, boolean, text, text) from public, anon;
grant execute on function internal.resolve_audience(text, uuid, jsonb, boolean, text, text) to authenticated;

-- Same correction in the unreachable report, for the same reason.
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

  return query
    select e.player_id, e.outcome
    from internal.player_contact_eligibility(v_player_ids) e
    where e.user_id is null
      -- Excluded players are not "unreachable" -- they were deliberately
      -- left out, which is a different fact and must not be reported as a
      -- problem needing attention.
      and (not p_exclude_u18 or e.is_adult);
end;
$$;

revoke all on function public.audience_unreachable(text, uuid, jsonb, boolean) from public, anon;
grant execute on function public.audience_unreachable(text, uuid, jsonb, boolean) to authenticated;
