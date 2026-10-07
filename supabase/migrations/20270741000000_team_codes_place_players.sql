-- =====================================================================================================
-- TEAM CODES PLACE PLAYERS (People & Invitations -- the product owner's decisions of 2026-10-05)
--
-- A team's joining code, or a personal link for one player, used to produce a club-level join request
-- with no team on it: approving it made somebody a Member and put nobody on the squad. Now a code asks
-- for THAT team, and one approval answers the whole question.
--
--   * WHO IT IS FOR is chosen when the code is used: the person themselves, one of their children, a
--     child not on Ovalball yet (the code may create them: name, date of birth, gender), or -- for an
--     adult who does not play -- a plain request to join the club, exactly as before.
--   * ONE ENTITY. A request is a `player_team_memberships` row in PENDING with source TEAM_CODE and the
--     code that made it. There is no new request table: approval is the existing
--     approve_pending_team_membership, refusal the existing reject_pending_team_membership.
--   * WHO DECIDES: that team's Team Admin or Team Manager, or a Club Admin (team.roster.manage at the
--     team, club.roster.manage at the club -- coaches hold neither). Approving admits an adult player to
--     the club as a Member: an owner-approved widening of what team staff can do.
--   * A CHILD'S OWN LOGIN WAITS FOR A PARENT. An under-18 using a code themselves files a request that a
--     linked guardian must confirm before the team's staff see it at all. Staff are shown how many are
--     waiting and nothing about who.
--   * A PARENT WHO ADDS A CHILD becomes that child's guardian, and a Member of the club, on the same one
--     approval.
--   * A WRONG AGE GRADE OR PATHWAY IS REFUSED by the canonical rules, never a second copy of them.
--
-- A code still grants nothing by itself (L14): every path ends in a request a person with authority
-- decides. Refusals RETURN rather than raise, like every other redemption refusal, so the attempt record
-- and the rate limits survive them and a fixable refusal leaves the code usable.
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 1. THE REQUEST IS A TEAM PLACE
-- -----------------------------------------------------------------------------------------------------
alter table public.player_team_memberships
  add column source_invitation_id uuid references public.access_invitations(id),
  add column guardian_confirmation text,
  add column guardian_confirmed_by uuid references auth.users(id),
  add column guardian_confirmed_at timestamptz;

alter table public.player_team_memberships
  add constraint player_team_memberships_guardian_confirmation_check
    check (guardian_confirmation is null or guardian_confirmation in ('AWAITING', 'CONFIRMED')),
  -- coalesce: a CHECK passes on NULL, so the comparison is made on values that are never NULL.
  add constraint player_team_memberships_guardian_confirmed_shape
    check ((coalesce(guardian_confirmation, '') = 'CONFIRMED')
           = (guardian_confirmed_at is not null and guardian_confirmed_by is not null));

create index player_team_memberships_awaiting_idx
  on public.player_team_memberships (team_id) where guardian_confirmation = 'AWAITING' and state = 'PENDING';

-- The player and their family read whether their own request is still waiting for a parent.
grant select (guardian_confirmation) on public.player_team_memberships to authenticated;

-- A guardianship a parent asked for through a team code.
alter table public.guardians drop constraint guardians_source_check;
alter table public.guardians add constraint guardians_source_check check (source = any (array[
  'GUARDIAN_INVITATION', 'LINK_REQUEST', 'ADDITIONAL_GUARDIAN_REQUEST', 'SELF_ADDED_CHILD', 'CLUB_CREATED',
  'SITE_ADMIN_ASSIGNMENT', 'DUPLICATE_RESOLUTION', 'LEGACY_BACKFILL', 'TEAM_CODE']));

-- ONE REDEMPTION PER PERSON PER PLAYER. A parent with two children uses one team code twice, once for
-- each; the same person asking twice for the same player is still answered with what they already have.
alter table public.invitation_redemptions add column subject_player_id uuid references public.players(id);
alter table public.invitation_redemptions drop constraint invitation_redemptions_invitation_id_user_id_key;
create unique index invitation_redemptions_one_per_subject on public.invitation_redemptions
  (invitation_id, user_id, coalesce(subject_player_id, '00000000-0000-0000-0000-000000000000'::uuid));

insert into public.notification_types (type_key, topic_key, mandatory_override) values
  ('team_place_requested', 'access_invitations', null),
  ('team_place_confirm_requested', 'access_invitations', null)
on conflict (type_key) do nothing;

-- A parent's confirmation of their child's own request, in the club's history of that place.
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('player_team.guardian_confirmed', 'FAMILY', 'INFO', true, false, false)
on conflict (event_type) do nothing;


-- -----------------------------------------------------------------------------------------------------
-- 2. A REQUEST WAITING FOR A PARENT CANNOT BE LET IN
--
-- The canonical team-place facts, unchanged but for one rule: PENDING -> ACTIVE is refused while a
-- guardian's confirmation is still awaited, whoever asks.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.player_team_membership_facts()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    -- state defaults to ACTIVE, so a legacy insert that names another status
    -- is read from that status.
    if new.state is null or (new.state = 'ACTIVE' and lower(coalesce(new.status, 'active')) <> 'active') then
      new.state := upper(coalesce(new.status, 'active'));
    end if;
    new.source := coalesce(new.source, 'LEGACY_BACKFILL');
    new.granted_by := coalesce(new.granted_by, new.created_by);
  else
    if new.state is not distinct from old.state and new.status is distinct from old.status then
      new.state := upper(new.status);
    end if;
    if new.state is distinct from old.state then
      if old.state in ('ENDED', 'DECLINED') then
        raise exception 'A finished team place cannot be switched back on. Add the player to the team again.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state not in ('ACTIVE', 'DECLINED', 'ENDED') then
        raise exception 'A team join request can only be approved or declined.' using errcode = '23514';
      end if;
      if old.state <> 'PENDING' and new.state in ('PENDING', 'DECLINED') then
        raise exception 'Only a team join request can be declined, and nothing returns to being a request.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state = 'ACTIVE' and coalesce(new.guardian_confirmation, '') = 'AWAITING' then
        raise exception 'A parent or guardian has to confirm this request before the team can approve it.' using errcode = '23514';
      end if;
      if new.state in ('ENDED', 'DECLINED') then
        new.ended_at := coalesce(new.ended_at, now());
        new.ended_by := coalesce(new.ended_by, auth.uid());
      end if;
    end if;
    if new.player_id <> old.player_id then
      raise exception 'A team place''s player never changes.' using errcode = '23514';
    end if;
  end if;
  new.status := lower(new.state);
  return new;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 3. WHETHER SOMEBODY FITS A TEAM -- the canonical rules, asked of a date of birth and a pathway
--
-- The age grade is team_age_grade_status's comparison: the season from the register, the player's grade
-- from resolve_player_age_grade, against the team's own grade; an adult side asks only whether they are
-- an adult. The pathway is assert_player_team_pathway_compatible's rule, which the place trigger enforces
-- on every row anyway: boys' and men's sides MALE, girls' and women's FEMALE, mixed anybody. Asked of a
-- date of birth rather than a player, because a child not yet on Ovalball has no player to ask about.
-- A dispensation is a club's decision, never something a code can claim.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.team_code_fit(p_team_id uuid, p_dob date, p_pathway text, p_as_of date default current_date)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_code text; v_category text; v_age_group text; v_gender text;
  v_season uuid; v_grade record; v_mine int; v_theirs int;
begin
  select t.rugby_code, t.category, t.age_group, ctt.gender into v_code, v_category, v_age_group, v_gender
    from public.teams t
    left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
   where t.id = p_team_id;
  if v_code is null then return 'UNKNOWN_TEAM'; end if;
  if p_dob is null then return 'NO_DATE_OF_BIRTH'; end if;

  if internal.team_is_adult_side(p_team_id) then
    if p_dob > (p_as_of - interval '18 years')::date then return 'UNDER_18'; end if;
  else
    v_season := internal.resolve_season_for_date(v_code, p_as_of);
    if v_season is null then return 'SEASON_NOT_ESTABLISHED'; end if;
    select * into v_grade from internal.resolve_player_age_grade(v_code, v_season, p_dob);
    if v_grade.status = 'TOO_YOUNG' then return 'TOO_YOUNG'; end if;
    if v_grade.status = 'OUT_OF_YOUTH_RANGE' then return 'TOO_OLD'; end if;
    if v_grade.canonical_age_group is null then return 'AGE_GRADE_NOT_ESTABLISHED'; end if;
    if v_grade.canonical_age_group is distinct from v_age_group then
      v_mine := nullif(regexp_replace(v_grade.canonical_age_group, '\D', '', 'g'), '')::int;
      v_theirs := nullif(regexp_replace(coalesce(v_age_group, ''), '\D', '', 'g'), '')::int;
      if v_mine is null or v_theirs is null then return 'AGE_GRADE_NOT_ESTABLISHED'; end if;
      return case when v_mine < v_theirs then 'TOO_YOUNG' else 'TOO_OLD' end;
    end if;
  end if;

  if v_gender is null or v_gender = 'mixed' then return 'FITS'; end if;
  if p_pathway is null then return 'NO_PATHWAY'; end if;
  if (v_gender in ('boys', 'mens') and upper(p_pathway) = 'MALE')
     or (v_gender in ('girls', 'womens') and upper(p_pathway) = 'FEMALE') then
    return 'FITS';
  end if;
  return 'OTHER_PATHWAY';
end;
$function$;

revoke all on function internal.team_code_fit(uuid, date, text, date) from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 4. WHO IS TOLD
-- -----------------------------------------------------------------------------------------------------

-- The people who can approve this request, asked of the capability engine for each candidate -- so an
-- override or a suspension is honoured -- and never the people who may not decide it: the player, the
-- person who asked, or anyone who is (or is becoming) the player's guardian.
create or replace function internal.notify_team_place_approvers(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_team public.teams;
  v_player public.players;
begin
  select * into m from public.player_team_memberships where id = p_membership_id;
  select * into v_team from public.teams where id = m.team_id;
  select * into v_player from public.players where id = m.player_id;
  if m.id is null or v_team.id is null or v_player.id is null then return; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select c.user_id, 'team_place_requested',
         format('%s is waiting to join %s', concat_ws(' ', v_player.first_name, v_player.surname), v_team.display_name),
         format('Approve or decline on %s''s Squad tab.', v_team.display_name),
         jsonb_build_object('team_id', m.team_id, 'club_id', v_team.club_id, 'membership_id', m.id, 'player_id', m.player_id)
    from (select distinct ra.user_id
            from public.role_assignments ra
           where ra.state = 'ACTIVE' and ra.club_id = v_team.club_id
             and (ra.team_id = m.team_id or ra.team_id is null)) c
   where c.user_id is distinct from m.created_by
     and c.user_id is distinct from v_player.user_id
     and not exists (select 1 from public.guardians g
                      where g.player_id = m.player_id and g.guardian_user_id = c.user_id
                        and g.state in ('ACTIVE', 'PENDING_APPROVAL'))
     and ((internal.capability_decision(c.user_id, 'team.roster.manage', 'team', v_team.club_id, m.team_id, null)).allowed
          or (internal.capability_decision(c.user_id, 'club.roster.manage', 'club', v_team.club_id, null, null)).allowed);
end;
$function$;

revoke all on function internal.notify_team_place_approvers(uuid) from public, anon, authenticated;

-- A child's own request, put to every parent or guardian who can answer it.
create or replace function internal.notify_team_place_guardians(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_team public.teams;
  v_player public.players;
  v_club text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id;
  select * into v_team from public.teams where id = m.team_id;
  select * into v_player from public.players where id = m.player_id;
  select d.name into v_club from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v_team.club_id;

  insert into public.notifications (user_id, type, title, body, data)
  select g.guardian_user_id, 'team_place_confirm_requested',
         format('Confirm %s''s request', v_player.first_name),
         format('%s asked to join %s at %s. Nothing happens until you confirm.', v_player.first_name, v_team.display_name, coalesce(v_club, 'the club')),
         jsonb_build_object('membership_id', m.id, 'player_id', m.player_id, 'team_id', m.team_id, 'club_id', v_team.club_id)
    from public.guardians g
   where g.player_id = m.player_id and g.state = 'ACTIVE' and g.guardian_user_id is distinct from m.created_by;
end;
$function$;

revoke all on function internal.notify_team_place_guardians(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 5. USING A TEAM CODE FOR SOMEBODY
--
-- Called by redeem_invitation once the code itself has passed every check there (found, live, the
-- issuer still holds the authority, the club and the team still active), holding the code's row lock --
-- so two uses of one code never race. Returns the outcome; a refusal is returned, never raised, and the
-- caller leaves the code unspent.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.team_code_request(p_invitation_id uuid, p_actor uuid, p_subject jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  p_invitation public.access_invitations;
  v_for text := upper(coalesce(p_subject ->> 'for', ''));
  v_team public.teams;
  v_player public.players;
  v_first text := nullif(btrim(coalesce(p_subject ->> 'first_name', '')), '');
  v_surname text := nullif(btrim(coalesce(p_subject ->> 'surname', '')), '');
  v_pathway text := upper(nullif(btrim(coalesce(p_subject ->> 'playing_pathway', '')), ''));
  v_dob date;
  v_fit text;
  v_place public.player_team_memberships;
  v_membership uuid;
  v_awaiting boolean := false;
  v_new_child boolean := false;
  v_match uuid;
  v_profile public.profiles;
  v_generic constant text := 'That invitation or code can''t be used.';
begin
  -- Already found, checked and locked by redeem_invitation in this same transaction.
  select * into p_invitation from public.access_invitations where id = p_invitation_id;
  select * into v_team from public.teams where id = p_invitation.team_id;
  if v_team.id is null or v_for not in ('SELF', 'CHILD', 'NEW_CHILD') then
    return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
  end if;

  -- A date that is not a date is no date at all, never an error that would roll the attempt back.
  begin
    v_dob := nullif(p_subject ->> 'date_of_birth', '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_pathway is not null and v_pathway not in ('MALE', 'FEMALE') then v_pathway := null; end if;

  -- ---------------------------------------------------------------- the person themselves
  if v_for = 'SELF' then
    select * into v_player from public.players where user_id = p_actor;
    if internal.person_is_minor(p_actor) then
      -- A CHILD'S OWN REQUEST. Their record must already be whole -- only a parent or guardian records a
      -- child's gender -- and somebody must be there to confirm it.
      if v_player.id is null or v_player.date_of_birth is null or v_player.playing_pathway is null
         or not exists (select 1 from public.guardians g where g.player_id = v_player.id and g.state = 'ACTIVE') then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'GUARDIAN_REQUIRED',
          'message', 'Ask your parent or guardian to use this code for you.');
      end if;
      v_awaiting := true;
    elsif v_player.id is null or v_player.date_of_birth is null or v_player.playing_pathway is null then
      -- An adult -- or somebody with no date of birth on file yet -- completes their own record first, the
      -- one canonical way: create_own_player_profile, which keeps its own rules.
      if coalesce(v_player.date_of_birth, v_dob) is null or coalesce(v_player.playing_pathway, v_pathway) is null then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
          'message', 'Add your date of birth and gender first.');
      end if;
      if coalesce(v_player.date_of_birth, v_dob) > (current_date - interval '18 years')::date then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'GUARDIAN_REQUIRED',
          'message', 'Ask your parent or guardian to use this code for you.');
      end if;
      if v_player.id is null then
        if not internal.can('player.self_register', 'self') then
          return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
        end if;
        select * into v_profile from public.profiles where id = p_actor;
        if nullif(btrim(coalesce(v_profile.first_name, '')), '') is null or nullif(btrim(coalesce(v_profile.surname, '')), '') is null then
          return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
            'message', 'Add your name to your account first.');
        end if;
      end if;
      perform public.create_own_player_profile(v_profile.first_name, v_profile.surname, v_dob, v_pathway);
      select * into v_player from public.players where user_id = p_actor;
    end if;

  -- ---------------------------------------------------------------- one of their children
  elsif v_for = 'CHILD' then
    if coalesce(p_subject ->> 'player_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
    end if;
    select p.* into v_player from public.players p
     where p.id = (p_subject ->> 'player_id')::uuid
       and exists (select 1 from public.guardians g
                    where g.player_id = p.id and g.guardian_user_id = p_actor and g.state = 'ACTIVE');
    -- Somebody else's child is exactly as unknown as no child at all.
    if v_player.id is null then
      return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
    end if;

  -- ---------------------------------------------------------------- a child not on Ovalball yet
  else
    if v_first is null or v_surname is null or v_dob is null or v_pathway is null then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
        'message', 'Add their first name, last name, date of birth and gender.');
    end if;
    if v_dob > current_date then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
        'message', 'That date of birth is in the future.');
    end if;
    if v_dob <= (current_date - interval '18 years')::date then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', 'ADULT_OWN_ACCOUNT',
        'message', 'Players aged 18 or over join with their own account.');
    end if;
    v_fit := internal.team_code_fit(v_team.id, v_dob, v_pathway);
    if v_fit <> 'FITS' then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', v_fit,
        'message', format('That child can''t join %s with this code.', v_team.display_name));
    end if;

    -- THEIR OWN CHILD ALREADY: the same name and date of birth under this parent is that child.
    select p.* into v_player from public.players p
      join public.guardians g on g.player_id = p.id and g.guardian_user_id = p_actor and g.state in ('ACTIVE', 'PENDING_APPROVAL')
     where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth = v_dob
     order by (g.state = 'ACTIVE') desc
     limit 1;

    if v_player.id is not null then
      v_fit := null;  -- judged below on the record they already have, not on what was typed
    else
      -- A CHILD WHO MAY ALREADY BE AT THE CLUB. Same name, same date of birth, a place at this club: the
      -- club checks it through its existing duplicate review, and the parent is told exactly what they
      -- would be told otherwise -- a code must never reveal whether a particular child plays somewhere.
      select ptm.player_id into v_match
        from public.player_team_memberships ptm
        join public.players p on p.id = ptm.player_id
        join public.teams t on t.id = ptm.team_id
       where t.club_id = v_team.club_id and ptm.state in ('PENDING', 'ACTIVE')
         and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth = v_dob
       order by (ptm.state = 'ACTIVE') desc
       limit 1;
      if v_match is not null then
        if not exists (select 1 from public.player_duplicate_reviews r
                        where r.requesting_guardian_user_id = p_actor and r.status = 'pending'
                          and lower(r.submitted_first_name) = lower(v_first) and lower(r.submitted_surname) = lower(v_surname)
                          and r.submitted_date_of_birth = v_dob) then
          insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth,
                                                      submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
          values (v_team.id, v_first, v_surname, v_dob, v_pathway, v_match, p_actor, p_actor);
        end if;
        return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'club_id', v_team.club_id, 'team_id', v_team.id,
          'new_child', true, 'under_review', true, 'awaiting_guardian', false, 'already', false);
      end if;

      insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
      values (v_first, v_surname, v_dob, v_pathway, p_actor)
      returning * into v_player;
      -- The parent's relationship waits for the same one approval as the team place.
      insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, source_invitation_id, created_by)
      values (p_actor, v_player.id, 'guardian', 'pending', 'PENDING_APPROVAL', 'TEAM_CODE', p_invitation.id, p_actor);
      v_new_child := true;
    end if;
  end if;

  -- ---------------------------------------------------------------- the place itself
  select * into v_place from public.player_team_memberships
   where player_id = v_player.id and team_id = v_team.id and state in ('PENDING', 'ACTIVE')
   order by (state = 'ACTIVE') desc
   limit 1;
  if v_place.state = 'ACTIVE' then
    return jsonb_build_object('outcome', 'REFUSED', 'reason', 'ALREADY_ON_TEAM',
      'message', format('%s is already on %s.', v_player.first_name, v_team.display_name));
  elsif v_place.state = 'PENDING' then
    return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'membership_id', v_place.id, 'player_id', v_player.id,
      'club_id', v_team.club_id, 'team_id', v_team.id, 'new_child', false, 'under_review', false,
      'awaiting_guardian', coalesce(v_place.guardian_confirmation, '') = 'AWAITING', 'already', true);
  end if;

  -- ONE USE OF A CODE FOR EACH PLAYER. Somebody who has used this code for this player before -- the request
  -- was declined, or the place has since ended -- is told so. Asking again is a conversation with the team,
  -- not a second use; and without this answer the second use failed on the one-redemption-per-player record.
  if exists (select 1 from public.invitation_redemptions r
              where r.invitation_id = p_invitation.id and r.user_id = p_actor and r.subject_player_id = v_player.id) then
    return jsonb_build_object('outcome', 'REFUSED', 'reason', 'ALREADY_USED',
      'message', case when v_for = 'SELF' then 'You''ve already used this code. To ask again, talk to the team.'
                      else format('You''ve already used this code for %s. To ask again, talk to the team.', v_player.first_name) end);
  end if;

  if v_fit is null then
    v_fit := internal.team_code_fit(v_team.id, v_player.date_of_birth, v_player.playing_pathway);
  end if;
  if v_fit <> 'FITS' then
    return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', v_fit,
      'message', format('%s can''t join %s with this code.', v_player.first_name, v_team.display_name));
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, state, created_by, source, source_invitation_id, guardian_confirmation, reason)
  values (v_player.id, v_team.id, 'pending', 'PENDING', p_actor, 'TEAM_CODE', p_invitation.id,
          case when v_awaiting then 'AWAITING' end, 'asked with a team code')
  returning id into v_membership;

  if v_awaiting then
    perform internal.notify_team_place_guardians(v_membership);
  else
    perform internal.notify_team_place_approvers(v_membership);
  end if;

  return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'membership_id', v_membership, 'player_id', v_player.id,
    'club_id', v_team.club_id, 'team_id', v_team.id, 'new_child', v_new_child, 'under_review', false,
    'awaiting_guardian', v_awaiting, 'already', false);
end;
$function$;

revoke all on function internal.team_code_request(uuid, uuid, jsonb) from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 6. redeem_invitation LEARNS WHO A TEAM CODE IS FOR
--
-- One new argument, read by TEAM_JOIN_CODE alone. Without it -- an older app -- a team code does exactly
-- what it did before: a plain request to join the club. Every other kind is unchanged.
-- -----------------------------------------------------------------------------------------------------
drop function public.redeem_invitation(text, text);

create function public.redeem_invitation(p_token text default null, p_code text default null, p_subject jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v record;
  v_email text;
  v_failures int;
  v_membership uuid;
  v_role text;
  v_roles text[];
  v_result jsonb := '{}'::jsonb;
  v_existing uuid;
  v_teams jsonb;
  v_officer text;
  v_team uuid;
  v_team_roles text[];
  v_id uuid;
  v_generic constant text := 'That invitation or code can''t be used.';
  -- ONE WAY TO BRING PEOPLE IN
  v_club_roles text[];
  v_seat text;
  v_held text;
  v_titles jsonb;
  v_declared text;
  v_prev text;
  -- TEAM CODES PLACE PLAYERS
  v_for_somebody boolean := upper(coalesce(p_subject ->> 'for', 'MEMBER')) <> 'MEMBER';
  v_subject_player uuid;
begin
  -- Step 0. Redemption is an authenticated act. session_ok() is the canonical session gate; when
  -- Slice 6 adds the AAL2 requirement to it, redemption inherits that without being changed here.
  if v_actor is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session cannot be used for this.' using errcode = '42501';
  end if;
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;

  -- Step 3. Rate limits BEFORE any lookup, so guessing is capped whether or not the guess is close.
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    perform internal.invitation_refused(null, 'throttled');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts', '{}'::jsonb);
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  select count(*) into v_failures from public.invitation_redemption_attempts a
   where a.user_id = v_actor and a.outcome <> 'redeemed' and a.occurred_at > now() - interval '1 day';
  if v_failures >= 20 then
    perform internal.invitation_refused(null, 'throttled_day');
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('invitation.attempts_throttled', v_actor, 'too many invitation attempts today', '{}'::jsonb);
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 5 (first half). Terminal states are persisted BEFORE any refusal, because a raise rolls
  -- back whatever the same transaction wrote -- the M-5 lesson.
  perform internal.expire_due_invitations();

  -- Steps 1, 4. Find it by hash, and hold the row for the rest of the transaction.
  select * into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1
   for update;

  if v.id is null then
    perform internal.invitation_refused(null, 'not_found');
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 11 (multi-use idempotency). A second redemption by the same person returns what they already
  -- have rather than making a second request. A team code used for a PLAYER is answered per player,
  -- inside its own branch: one parent may use one code once for each of their children.
  if not (v.kind = 'TEAM_JOIN_CODE' and v_for_somebody) then
    select r.id into v_existing from public.invitation_redemptions r
     where r.invitation_id = v.id and r.user_id = v_actor and r.subject_player_id is null;
    if v_existing is not null then
      return jsonb_build_object('outcome','ALREADY_REDEEMED','invitation_id',v.id,'kind',v.kind);
    end if;
  end if;

  -- Step 5. Missing, revoked, expired or used all give the SAME answer: a prober must not be able to
  -- tell a revoked invitation from one that never existed.
  if v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    perform internal.invitation_refused(v.id, lower(v.state));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 6. Personal invitations are bound to a verified email. The comparison is against the
  -- session's own confirmed address, never anything the caller supplied.
  if v.invited_email_normalised is not null then
    select lower(u.email) into v_email from auth.users u
     where u.id = v_actor and u.email_confirmed_at is not null;
    if v_email is null or v_email <> v.invited_email_normalised then
      perform internal.invitation_refused(v.id, 'wrong_identity');
      insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
      values ('invitation.identity_mismatch', v_actor, v.club_id, 'invitation opened by another identity',
              jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
  end if;
  if v.kind = 'ACCOUNT_SETUP' and v.target_user_id is distinct from v_actor then
    perform internal.invitation_refused(v.id, 'wrong_identity');
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 7. The scope must still be real and usable.
  if v.club_id is not null and not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.team_id is not null and not exists (select 1 from public.teams t where t.id = v.team_id and t.active) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;
  if v.player_id is not null and not exists (select 1 from public.players p where p.id = v.player_id) then
    perform internal.invitation_refused(v.id, 'scope_gone'); return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- Step 8. The issuer's authority is re-checked NOW. An invitation sent by somebody who has since
  -- lost the authority to send it must not still work.
  if not (
      (v.club_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed)
      or (v.team_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed)
      or (v.player_id is not null and (internal.capability_decision(v.issued_by, v.issuer_capability, 'child', null, null, v.player_id)).allowed)
      or (v.issued_level = 'SITE' and exists (
            select 1 from public.site_admins sa where sa.user_id = v.issued_by and sa.status = 'active'))
      -- CONVERGENCE STEP 16. The same rule as every line above it: an invitation must not still work
      -- if the person who sent it has since lost the authority to send it. Asked of the ISSUER, by id,
      -- so it is their standing at the organisation that is re-checked and not the redeemer's.
      or (v.constituent_body_id is not null
          and (internal.body_role(v.constituent_body_id, v.issued_by) = 'BODY_ADMIN'
               or exists (select 1 from public.site_admins sa
                           where sa.user_id = v.issued_by and sa.status = 'active')))
    ) then
    perform internal.invitation_refused(v.id, 'issuer_authority_lost');
    insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
    values ('invitation.issuer_authority_lost', v_actor, v.club_id, 'issuer no longer holds the authority',
            jsonb_build_object('invitation_id', v.id, 'kind', v.kind));
    return jsonb_build_object('outcome','REFUSED','message',v_generic);
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- Steps 9 and 10. The outcome, through the canonical transitions and nothing else.
  --
  -- D-S5-1 is NOT re-implemented here. Every path below ends in internal.grant_role or
  -- internal.enter_safeguarding_nomination, which carry the gate, so a caller who reaches this
  -- function through some other route still meets it. What this function does is refuse BEFORE
  -- consuming the invitation, so a fixable refusal leaves the invitation usable.
  -- ---------------------------------------------------------------------------------------------
  if v.kind = 'SITE_ADMIN' and not internal.person_is_established_adult(v_actor) then
    perform internal.invitation_refused(v.id, 'age_eligibility_required');
    -- NOT consumed: the invitation stays usable once a date of birth is on file.
    return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
  end if;

  if v.kind in ('CLUB_STAFF','SAFEGUARDING_OFFICER') then
    v_roles := case when v.kind = 'SAFEGUARDING_OFFICER' then array['SAFEGUARDING_OFFICER']
                    else coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'roles')), '{}') end;
    if exists (select 1 from unnest(v_roles) r
                join public.role_definitions rd on rd.role_key = r
               where rd.minor_prohibited)
       and not internal.person_is_established_adult(v_actor) then
      perform internal.invitation_refused(v.id, 'age_eligibility_required');
      -- NOT consumed: the invitation stays usable once a date of birth is on file.
      return jsonb_build_object('outcome','REFUSED','reason','AGE_ELIGIBILITY_REQUIRED','message','Before you can accept this, Ovalball needs a date of birth on file showing you are an adult.');
    end if;
  end if;

  if v.kind = 'CLUB_STAFF' then
    -- The authorised teams come from the STORED invitation. Redemption takes no team argument, so
    -- there is nothing for a browser to substitute.
    v_teams := coalesce(v.intended_outcome->'teams', '[]'::jsonb);

    -- Validated here, before ANY part of the outcome is written: every team must still be an active
    -- team of this club, or the invitation stays unspent and the person is left exactly as they were.
    if exists (select 1 from jsonb_array_elements(v_teams) t
                where not exists (select 1 from public.teams te
                                   where te.id = (t->>'id')::uuid and te.club_id = v.club_id and te.active)) then
      perform internal.invitation_refused(v.id, 'scope_gone');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;

    -- ONE ADMISSION PATH (People & Invitations). This used to INSERT the membership itself, which
    -- recorded no source and no invitation (the provenance trigger stamped LEGACY_BACKFILL) and failed on
    -- the one-open-membership index for anybody who had already asked to join. admit_club_member is the
    -- path every other entrance uses: it approves a waiting membership, keeps an active one, and records
    -- INVITATION with this invitation as the source -- under the club's people lock, as every other
    -- admission is.
    perform internal.lock_club_people(v.club_id);

    -- A DEACTIVATED MEMBERSHIP IS NOT RESURRECTED BY AN INVITATION. Refused by RETURNING, which is this
    -- function's contract (a raise would roll back the attempt record and the rate limit with it), and
    -- before anything is written, so the invitation is left usable once the club has deliberately
    -- reactivated them -- the same rule the governing-body branch below keeps for a suspended officer.
    if exists (select 1 from public.club_memberships m
                where m.club_id = v.club_id and m.user_id = v_actor and m.state = 'SUSPENDED') then
      perform internal.invitation_refused(v.id, 'membership_deactivated');
      return jsonb_build_object('outcome','REFUSED','reason','ORGANISATION_ACCESS_SUSPENDED',
        'message','Your membership of this club is deactivated. The club must reactivate it before you can accept an invitation.');
    end if;

    v_membership := internal.admit_club_member(v.club_id, v_actor, 'INVITATION', 'accepted invitation ' || v.id::text, v.id, null);

    -- What is given at the club, as the invitation stored it. An invitation issued before club roles
    -- were stored apart falls back to the old reading, which was correct while nothing club-or-team
    -- could be named at a team.
    v_club_roles := case when v.intended_outcome ? 'club_roles'
                         then coalesce(array(select jsonb_array_elements_text(v.intended_outcome->'club_roles')), '{}')
                         else coalesce(array(select r from unnest(v_roles) r where not internal.role_is_team_scoped(r)), '{}') end;

    -- CLUB ACCESS IS RAISED, NEVER LOWERED. One seat, through the canonical swap: an invitation to a
    -- Club Admin who already holds Club Admin, or to a Fixture Secretary offered Member, changes nothing,
    -- because accepting an invitation must never take authority away.
    v_seat := (select r from unnest(v_club_roles) r where r in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
                order by case r when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end limit 1);
    v_held := (select ra.role_key from public.role_assignments ra
                where ra.membership_id = v_membership and ra.team_id is null and ra.state = 'ACTIVE'
                  and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
                order by case ra.role_key when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end limit 1);
    if v_seat is not null
       and (case v_seat when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 else 3 end)
           < (case v_held when 'CLUB_ADMIN' then 1 when 'FIXTURES_SECRETARY' then 2 when 'MEMBER' then 3 else 4 end) then
      perform internal.apply_primary_club_role(v_membership,
        case v_seat when 'FIXTURES_SECRETARY' then 'FIXTURE_SECRETARY' when 'MEMBER' then 'BASIC_USER' else v_seat end,
        'INVITATION', 'accepted invitation ' || v.id::text, false);
    end if;

    foreach v_role in array v_club_roles loop
      if v_role not in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') then
        perform internal.grant_role(v_membership, v_role, null, 'INVITATION',
                                    'accepted invitation ' || v.id::text);
      end if;
    end loop;

    -- Each team's roles, each carrying the title the club gave it ("Physio" on a First Aider). A role
    -- the person already holds keeps its own title: grant_role returns the existing assignment as it is.
    for v_team, v_team_roles, v_titles in
      select (t->>'id')::uuid, array(select jsonb_array_elements_text(t->'roles')), coalesce(t->'titles', '{}'::jsonb)
        from jsonb_array_elements(v_teams) t
    loop
      foreach v_role in array v_team_roles loop
        perform internal.grant_role(v_membership, v_role, v_team, 'INVITATION',
                                    'accepted invitation ' || v.id::text,
                                    case when internal.team_title_value(v_role, v_titles->>v_role) is null then '{}'::jsonb
                                         else jsonb_build_object('staff_title', internal.team_title_value(v_role, v_titles->>v_role)) end);
      end loop;
    end loop;

    -- What they do at the club, in the words the invitation used, unless the club already says.
    v_declared := nullif(btrim(regexp_replace(coalesce(v.intended_outcome->>'declared_role', ''), '\s+', ' ', 'g')), '');
    if v_declared is not null and length(v_declared) <= 80 and internal.descriptive_title_ok(v_declared) then
      v_prev := internal.membership_sync_on();
      update public.club_memberships set governance_title = v_declared
       where id = v_membership and governance_title is null;
      perform internal.membership_sync_restore(v_prev);
    end if;
    v_result := jsonb_build_object('outcome','MEMBERSHIP_ACTIVE','membership_id',v_membership,
                                   'roles',to_jsonb(v_roles),'teams',v_teams);

  elsif v.kind = 'SAFEGUARDING_OFFICER' then
    -- D-S4-2: Slice 5 owns the email-bound entry, 4G owns the state machine. Admit the person, then
    -- enter the one state machine -- which is the shape 4G said Slice 5 inherits, and the reason an
    -- EXTERNAL nominee can accept at all. Requiring a membership first would have made the
    -- email-bound invitation useful only to people who did not need it.
    v_officer := v.intended_outcome->>'officer_id';
    perform internal.lock_club_people(v.club_id);
    v_membership := internal.admit_club_member(v.club_id, v_actor, 'SAFEGUARDING_APPOINTMENT', null, null, null);

    if v_officer is not null then
      update public.club_safeguarding_officers
         set user_id = v_actor, status = 'active', activated_at = now(),
             updated_by = v_actor, updated_at = now()
       where id = v_officer::uuid;
    end if;

    -- The officer record says active; the AUTHORITY does not. enter_safeguarding_nomination forces
    -- PENDING_CONFIRMATION whoever calls it, so this is a contact record that has been claimed and an
    -- appointment still waiting on Ovalball (AN-6).
    v_id := internal.enter_safeguarding_nomination(
      v.club_id, v_actor, coalesce(v.intended_outcome->>'officer_type','primary'),
      'SAFEGUARDING_APPOINTMENT', v.id, 'accepted invitation',
      case when v_officer is null then null else v_officer::uuid end);

    insert into public.notifications (user_id, type, title, body, data)
    values (v.issued_by, 'safeguarding_officer_invitation_accepted',
            'Safeguarding Officer invitation accepted',
            format('Your Safeguarding Officer invitation for %s was accepted. Ovalball must confirm the appointment before it grants anything.',
                   v.invited_email_normalised),
            jsonb_build_object('officer_id', v_officer, 'invitation_id', v.id));

    v_result := jsonb_build_object('outcome','PENDING_CONFIRMATION','assignment_id',v_id,
                                   'membership_id',v_membership);

  elsif v.kind = 'TEAM_JOIN_CODE' and v_for_somebody then
    -- TEAM CODES PLACE PLAYERS. A request for THIS team, for the person it is for. Refusals and a request
    -- they already have spend nothing.
    v_result := internal.team_code_request(v.id, v_actor, p_subject);
    if v_result ->> 'outcome' = 'REFUSED' then
      perform internal.invitation_refused(v.id, lower(coalesce(v_result ->> 'reason', 'team_code_refused')));
      return v_result || jsonb_build_object('invitation_id', v.id, 'kind', v.kind);
    end if;
    if coalesce((v_result ->> 'already')::boolean, false) or coalesce((v_result ->> 'under_review')::boolean, false) then
      return v_result || jsonb_build_object('invitation_id', v.id, 'kind', v.kind);
    end if;
    v_subject_player := (v_result ->> 'player_id')::uuid;

  elsif v.kind = 'TEAM_JOIN_CODE' then
    -- L14: a code never grants access. It produces a REQUEST somebody with authority must decide.
    insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, 'BASIC_USER', 'pending', v.id)
    on conflict do nothing;
    v_result := jsonb_build_object('outcome','JOIN_REQUEST_PENDING','club_id',v.club_id,'team_id',v.team_id);

  elsif v.kind = 'SITE_ADMIN' then
    perform internal.apply_site_admin_grant(
      v_actor, internal.site_profile_for_admin_role(coalesce(v.intended_outcome->>'admin_role','read_only')));
    v_result := jsonb_build_object('outcome','SITE_ADMIN_ACTIVE');

  elsif v.kind = 'ACCOUNT_SETUP' then
    -- The identity is confirmed here; the password and MFA setup itself is Slice 6.
    v_result := jsonb_build_object('outcome','ACCOUNT_SETUP_CONFIRMED','user_id',v_actor);

  elsif v.kind = 'PLAYER_ACCOUNT' then
    -- One account is one person. Linking an account that is already somebody, or a player who
    -- already has a login, would merge two identities -- so both refuse, and neither spends the
    -- invitation, because the person can be told what is wrong and it can still be used after.
    if not internal.can('player.account.link', 'self', null, null, null)
       or exists (select 1 from public.players pl where pl.user_id = v_actor)
       or exists (select 1 from public.players pl where pl.id = v.player_id and pl.user_id is not null) then
      perform internal.invitation_refused(v.id, 'player_account_link_unavailable');
      return jsonb_build_object('outcome','REFUSED','message',v_generic);
    end if;
    update public.players set user_id = v_actor where id = v.player_id;
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);

  -- CONVERGENCE STEP 16 -- A GOVERNING BODY OFFICER.
  --
  -- SERVER-AUTHORED, like every other outcome here: the role comes from the invitation the
  -- administrator fixed, never from anything the redeemer sends. The organisation comes from the
  -- invitation's own column, and the address was already matched against this session's CONFIRMED
  -- email at step 6, so a link forwarded to somebody else cannot be redeemed by them.
  elsif v.kind = 'GOVERNING_BODY_OFFICER' then
    -- A SUSPENSION IS NOT LIFTED BY ACCEPTING AN INVITATION.
    --
    -- The upsert below sets state = 'ACTIVE', and its conflict target is `state <> 'REVOKED'` -- so it
    -- matches a SUSPENDED row as readily as an ACTIVE one. Accepting an invitation therefore used to
    -- reinstate suspended authority as a side effect, and raise the role while doing it: measured, a
    -- SUSPENDED BODY_COMPETITIONS officer redeemed and came back as an ACTIVE BODY_ADMIN.
    --
    -- That contradicts the rule this platform states for the club role machine, where suspended
    -- authority survives even a full club reactivation: "reactivate_club() deliberately does NOT clear
    -- it -- only restore_club_membership_authority(), one membership at a time, does ... data returns,
    -- privileged authority does not silently return with it." A governing body is a smaller
    -- organisation, not a laxer one.
    --
    -- REFUSED BY RETURNING, NOT BY RAISING, which is this function's contract (IN-K1/IN-K2): a raise
    -- rolls back the attempt record and defeats the redemption rate limits. The reason is specific
    -- rather than the generic message because identity was already established at step 6 -- this is the
    -- invited person, being told something they need and can act on, exactly as
    -- AGE_ELIGIBILITY_REQUIRED is. The invitation is left ISSUED, so it still works once an
    -- administrator has deliberately restored them.
    --
    -- Nothing writes SUSPENDED today -- it is vocabulary the table and the People page carry, and no
    -- control sets it -- so this closes the path before it is reachable rather than after.
    if exists (select 1 from public.constituent_body_roles r
                where r.constituent_body_id = v.constituent_body_id
                  and r.user_id = v_actor and r.state = 'SUSPENDED') then
      perform internal.invitation_refused(v.id, 'organisation_access_suspended');
      return jsonb_build_object('outcome','REFUSED','reason','ORGANISATION_ACCESS_SUSPENDED',
        'message','Your access to this organisation is suspended. An administrator there must restore it before you can accept an invitation.');
    end if;
    insert into public.constituent_body_roles (constituent_body_id, user_id, role_key, granted_by, reason)
    values (v.constituent_body_id, v_actor, v.intended_outcome->>'role_key', v.issued_by,
            'Accepted an invitation to this organisation')
    on conflict (constituent_body_id, user_id) where state <> 'REVOKED'
    do update set role_key = excluded.role_key, state = 'ACTIVE', updated_at = now()
    returning id into v_id;
    v_result := jsonb_build_object('outcome','BODY_ROLE_ACTIVE','role_id',v_id,
      'constituent_body_id',v.constituent_body_id,'role_key',v.intended_outcome->>'role_key');

  elsif v.kind in ('GUARDIAN','CLUB_REFERRAL') then
    v_result := jsonb_build_object('outcome','ACCEPTED','kind',v.kind,'club_id',v.club_id,
                                   'team_id',v.team_id,'player_id',v.player_id);
  end if;

  -- Step 11. Consumption, only now that the outcome has actually been applied.
  insert into public.invitation_redemptions (invitation_id, user_id, result_ref, subject_player_id)
  values (v.id, v_actor, v_result, v_subject_player);
  update public.access_invitations
     set use_count = use_count + 1,
         state = case when use_count + 1 >= max_uses then 'REDEEMED' else state end,
         redeemed_by = case when max_uses = 1 then v_actor else redeemed_by end,
         redeemed_at = case when max_uses = 1 then now() else redeemed_at end,
         updated_at = now()
   where id = v.id;

  perform internal.invitation_refused(v.id, 'redeemed');
  insert into public.security_events (event_type, actor_user_id, club_id, team_id, reason, metadata)
  values ('invitation.redeemed', v_actor, v.club_id, v.team_id, 'invitation redeemed',
          jsonb_build_object('invitation_id', v.id, 'kind', v.kind)
            || case when v_subject_player is null then '{}'::jsonb
                    else jsonb_build_object('team_membership_id', v_result ->> 'membership_id') end);

  return v_result || jsonb_build_object('invitation_id', v.id, 'kind', v.kind);
end $function$;

revoke all on function public.redeem_invitation(text, text, jsonb) from public, anon;
grant execute on function public.redeem_invitation(text, text, jsonb) to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 7. WHO A CODE COULD BE FOR -- the choices, with each one's answer, before anything is asked
--
-- For the signed-in person holding a live team code: the team, themselves, and the children they are an
-- active guardian of, each with the canonical fit. Nothing about anybody else; for a code that is not a
-- live team code, nothing at all -- the same empty answer preview_invitation gives a stranger.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.team_code_choices(p_token text default null, p_code text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v public.access_invitations;
  v_team public.teams;
  v_club text;
  v_me public.players;
  v_membership text;
  v_request boolean;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;

  select i.* into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1;
  if v.id is null or v.kind <> 'TEAM_JOIN_CODE' or v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    return null;
  end if;
  select * into v_team from public.teams t where t.id = v.team_id and t.active;
  if v_team.id is null or not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    return null;
  end if;
  if not ((internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed
          or (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed) then
    return null;
  end if;

  select d.name into v_club from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id;
  select * into v_me from public.players where user_id = v_actor;
  select m.state into v_membership from public.club_memberships m
   where m.club_id = v.club_id and m.user_id = v_actor and m.state in ('PENDING', 'ACTIVE', 'SUSPENDED')
   limit 1;
  v_request := exists (select 1 from public.club_join_requests r
                        where r.club_id = v.club_id and r.requesting_user_id = v_actor and r.status = 'pending');

  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'label', v_team.display_name, 'club_name', v_club,
                               'adult_side', internal.team_is_adult_side(v_team.id), 'age_group', v_team.age_group,
                               'gender', (select ctt.gender from public.canonical_team_types ctt where ctt.id = v_team.canonical_team_type_id)),
    'me', jsonb_build_object(
      'player_id', v_me.id,
      'fit', case when v_me.id is null then null else internal.team_code_fit(v_team.id, v_me.date_of_birth, v_me.playing_pathway) end,
      'minor', internal.person_is_minor(v_actor),
      'established_adult', internal.person_is_established_adult(v_actor),
      'has_guardian', v_me.id is not null and exists (select 1 from public.guardians g where g.player_id = v_me.id and g.state = 'ACTIVE'),
      'needs_details', v_me.id is null or v_me.date_of_birth is null or v_me.playing_pathway is null,
      -- AWAITING is a child's own request that a parent has not confirmed yet: it is not the team's to
      -- decide, and saying "the team will decide" would tell the child the wrong next step. USED is this
      -- person's earlier use of this code for this player, with no place now: shown, not offered again.
      'place', coalesce(
                 (select case when ptm.state = 'PENDING' and ptm.guardian_confirmation = 'AWAITING' then 'AWAITING' else ptm.state end
                    from public.player_team_memberships ptm
                   where ptm.player_id = v_me.id and ptm.team_id = v_team.id and ptm.state in ('PENDING', 'ACTIVE')
                   order by (ptm.state = 'ACTIVE') desc limit 1),
                 case when exists (select 1 from public.invitation_redemptions r
                                    where r.invitation_id = v.id and r.user_id = v_actor and r.subject_player_id = v_me.id) then 'USED' end)),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', p.id, 'first_name', p.first_name, 'surname', p.surname,
               'birth_year', extract(year from p.date_of_birth)::int,
               'fit', internal.team_code_fit(v_team.id, p.date_of_birth, p.playing_pathway),
               'place', coalesce(
                          (select case when ptm.state = 'PENDING' and ptm.guardian_confirmation = 'AWAITING' then 'AWAITING' else ptm.state end
                             from public.player_team_memberships ptm
                            where ptm.player_id = p.id and ptm.team_id = v_team.id and ptm.state in ('PENDING', 'ACTIVE')
                            order by (ptm.state = 'ACTIVE') desc limit 1),
                          case when exists (select 1 from public.invitation_redemptions r
                                             where r.invitation_id = v.id and r.user_id = v_actor and r.subject_player_id = p.id) then 'USED' end))
             order by p.date_of_birth desc nulls last, p.first_name)
        from public.players p
       where exists (select 1 from public.guardians g
                      where g.player_id = p.id and g.guardian_user_id = v_actor and g.state = 'ACTIVE')
         and p.user_id is distinct from v_actor), '[]'::jsonb),
    'member', jsonb_build_object('membership', v_membership, 'requested', v_request));
end;
$function$;

revoke all on function public.team_code_choices(text, text) from public, anon;
grant execute on function public.team_code_choices(text, text) to authenticated, service_role;

-- The same canonical answer for a child not on Ovalball yet, asked of what a parent is typing -- so the
-- form can say "Fits Under 14" before anything is sent. Only for a live team code; only the verdict.
create or replace function public.team_code_fit_check(p_date_of_birth date, p_playing_pathway text, p_token text default null, p_code text default null)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v public.access_invitations;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select i.* into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1;
  if v.id is null or v.kind <> 'TEAM_JOIN_CODE' or v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses
     or not exists (select 1 from public.teams t where t.id = v.team_id and t.active) then
    return null;
  end if;
  if p_date_of_birth is not null and p_date_of_birth <= (current_date - interval '18 years')::date
     and not internal.team_is_adult_side(v.team_id) then
    return 'ADULT_OWN_ACCOUNT';
  end if;
  return internal.team_code_fit(v.team_id, p_date_of_birth, upper(nullif(btrim(coalesce(p_playing_pathway, '')), '')));
end;
$function$;

revoke all on function public.team_code_fit_check(date, text, text, text) from public, anon;
grant execute on function public.team_code_fit_check(date, text, text, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 8. A PARENT'S ANSWER TO THEIR CHILD'S OWN REQUEST
-- -----------------------------------------------------------------------------------------------------
create or replace function public.confirm_team_place_request(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  -- The same answer for "no such request" and "not your child's", so ids cannot be probed.
  if m.id is null or not exists (select 1 from public.guardians g
                                  where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if m.state <> 'PENDING' or coalesce(m.guardian_confirmation, '') <> 'AWAITING' then
    raise exception 'This request has already been answered.' using errcode = '23514';
  end if;

  update public.player_team_memberships
     set guardian_confirmation = 'CONFIRMED', guardian_confirmed_by = auth.uid(), guardian_confirmed_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = m.id;

  select club_id into v_club from public.teams where id = m.team_id;
  perform internal.emit_security_event('player_team.guardian_confirmed', auth.uid(), 'SUCCESS', null,
    jsonb_build_object('team_membership_id', m.id), v_club, m.team_id, m.player_id);
  perform internal.notify_team_place_approvers(m.id);
end;
$function$;

-- What a parent is being asked: every request their children made themselves that waits on them, with
-- the team and club named -- read by the parent's own app for the confirm screen and its Action Required
-- row. Nothing about anybody else's child.
create or replace function public.family_team_requests()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'membership_id', m.id,
             'player_id', p.id,
             'first_name', p.first_name,
             'surname', p.surname,
             'team_id', t.id,
             'team_label', t.display_name,
             'club_id', t.club_id,
             'club_name', d.name,
             'requested_at', m.created_at)
           order by m.created_at)
      from public.player_team_memberships m
      join public.players p on p.id = m.player_id
      join public.teams t on t.id = m.team_id
      left join public.clubs c on c.id = t.club_id
      left join public.club_directory d on d.id = c.directory_id
     where m.state = 'PENDING' and m.guardian_confirmation = 'AWAITING'
       and exists (select 1 from public.guardians g
                    where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE')), '[]'::jsonb);
end;
$function$;

revoke all on function public.family_team_requests() from public, anon;
grant execute on function public.family_team_requests() to authenticated, service_role;

-- What a person has asked for with a team code and is still waiting on -- so somebody whose only link to
-- Ovalball so far is that request (a parent new to it who has just added their child) is shown it, rather
-- than told to add a child they have already added. Only their own requests; nothing about anybody else.
create or replace function public.my_team_requests()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'membership_id', m.id,
             'first_name', p.first_name,
             'for_self', p.user_id is not distinct from auth.uid(),
             'team_label', t.display_name,
             'club_name', d.name,
             'awaiting_guardian', m.guardian_confirmation = 'AWAITING',
             'requested_at', m.created_at)
           order by m.created_at)
      from public.player_team_memberships m
      join public.players p on p.id = m.player_id
      join public.teams t on t.id = m.team_id
      left join public.clubs c on c.id = t.club_id
      left join public.club_directory d on d.id = c.directory_id
     where m.state = 'PENDING' and m.source = 'TEAM_CODE' and m.created_by = auth.uid()), '[]'::jsonb);
end;
$function$;

revoke all on function public.my_team_requests() from public, anon;
grant execute on function public.my_team_requests() to authenticated, service_role;

revoke all on function public.confirm_team_place_request(uuid) from public, anon;
grant execute on function public.confirm_team_place_request(uuid) to authenticated, service_role;

create or replace function public.decline_team_place_request(p_membership_id uuid, p_reason text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_team public.teams;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if m.id is null or not exists (select 1 from public.guardians g
                                  where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if m.state <> 'PENDING' or coalesce(m.guardian_confirmation, '') <> 'AWAITING' then
    raise exception 'This request has already been answered.' using errcode = '23514';
  end if;

  update public.player_team_memberships
     set state = 'DECLINED', ended_by = auth.uid(), end_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_by = auth.uid(), updated_at = now()
   where id = m.id;

  select * into v_team from public.teams where id = m.team_id;
  -- Told to the person who asked: the child, on their own account.
  insert into public.notifications (user_id, type, title, body, data)
  select m.created_by, 'add_child_declined', 'Team join declined',
         format('Your parent or guardian declined your request to join %s.', v_team.display_name),
         jsonb_build_object('player_id', m.player_id, 'team_id', m.team_id, 'membership_id', m.id)
   where m.created_by is not null and m.created_by is distinct from auth.uid();
end;
$function$;

revoke all on function public.decline_team_place_request(uuid, text) from public, anon;
grant execute on function public.decline_team_place_request(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 9. ONE APPROVAL ANSWERS THE WHOLE QUESTION
--
-- approve_pending_team_membership, unchanged for every other kind of team place. For a team code's
-- request it also: refuses while a parent is still to confirm; refuses the people who may not decide it
-- (the player, the person who asked, anyone who is or is becoming the player's guardian); confirms the
-- parent who asked as the child's guardian; and admits to the club, as a Member, an adult player on their
-- own account and the parent who asked for a child -- the owner-approved widening of team authority.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.approve_pending_team_membership(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player public.players;
  v_player_first_name text;
  v_guardian public.guardians;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.state <> 'PENDING' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to approve this request.' using errcode = '42501';
  end if;

  select * into v_player from public.players where id = m.player_id;

  if m.source = 'TEAM_CODE' then
    if coalesce(m.guardian_confirmation, '') = 'AWAITING' then
      raise exception 'A parent or guardian has to confirm this request before the team can approve it.' using errcode = '23514';
    end if;
    if auth.uid() = v_player.user_id or auth.uid() = m.created_by
       or exists (select 1 from public.guardians g
                   where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state in ('ACTIVE', 'PENDING_APPROVAL')) then
      raise exception 'You can''t approve a request for yourself or your own child. Another approver at the club will.' using errcode = '42501';
    end if;

    perform internal.lock_club_people(v_club_id);

    -- The parent who asked for a child they added becomes that child's guardian on this approval.
    select * into v_guardian from public.guardians g
     where g.player_id = m.player_id and g.guardian_user_id = m.created_by and g.state = 'PENDING_APPROVAL' and g.source = 'TEAM_CODE'
     for update;
    if v_guardian.id is not null then
      update public.guardians
         set state = 'ACTIVE', status = 'active', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
       where id = v_guardian.id;
      perform internal.emit_security_event('guardian.link_approved', m.created_by, 'SUCCESS', null,
        jsonb_build_object('relationship_id', v_guardian.id, 'source', 'TEAM_CODE', 'team_membership_id', m.id),
        v_club_id, m.team_id, m.player_id);
    end if;

    -- An adult player, on their own account, joins the club.
    if v_player.user_id is not null and internal.person_is_established_adult(v_player.user_id) then
      perform internal.admit_club_member(v_club_id, v_player.user_id, 'TEAM_CODE',
        'team place approved ' || m.id::text, m.source_invitation_id, null);
    end if;
    -- The parent who asked joins the club too.
    if m.created_by is not null and m.created_by is distinct from v_player.user_id
       and exists (select 1 from public.guardians g
                    where g.player_id = m.player_id and g.guardian_user_id = m.created_by and g.state = 'ACTIVE') then
      perform internal.admit_club_member(v_club_id, m.created_by, 'TEAM_CODE',
        'team place approved ' || m.id::text, m.source_invitation_id, null);
    end if;
  end if;

  update public.player_team_memberships
  set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
  where id = p_membership_id;

  v_player_first_name := v_player.first_name;

  -- EVERY legitimate recipient, not the earliest-created guardian. One parent
  -- being told and the other not was never a decision anybody made -- it was
  -- an `order by created_at asc limit 1` nobody revisited.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_approved', 'Team join confirmed',
         case when e.relationship = 'self'
              then 'You have been confirmed onto the team.'
              else v_player_first_name || ' has been confirmed onto the team.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$function$;

create or replace function public.reject_pending_team_membership(p_membership_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player_first_name text;
  v_team_label text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.state <> 'PENDING' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id, display_name into v_club_id, v_team_label from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to reject this request.' using errcode = '42501';
  end if;

  select p.first_name into v_player_first_name from public.players p where p.id = m.player_id;

  -- A team code's request: whoever asked is told, even if that leaves them no longer a contact of the
  -- player -- a parent whose new guardianship is declined with it would otherwise hear nothing.
  if m.source = 'TEAM_CODE' then
    update public.guardians
       set state = 'DECLINED', status = 'declined', updated_by = auth.uid()
     where player_id = m.player_id and guardian_user_id = m.created_by and state = 'PENDING_APPROVAL' and source = 'TEAM_CODE';
    insert into public.notifications (user_id, type, title, body, data)
    select m.created_by, 'add_child_declined', 'Team join declined',
           case when m.created_by = (select p.user_id from public.players p where p.id = m.player_id)
                then format('Your request to join %s was declined by the club.', v_team_label)
                else format('%s''s request to join %s was declined by the club.', v_player_first_name, v_team_label) end,
           jsonb_build_object('player_id', m.player_id)
     where m.created_by is not null
       and not exists (select 1 from internal.player_contact_eligibility(array[m.player_id]) e where e.user_id = m.created_by);
  end if;

  update public.player_team_memberships
  set state = 'DECLINED', ended_by = auth.uid(), end_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = auth.uid()
  where id = p_membership_id;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_declined', 'Team join declined',
         case when e.relationship = 'self'
              then 'Your team join request was declined by the club.'
              else v_player_first_name || '''s team join request was declined by the club.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 10. WHAT THE TEAM'S STAFF SEE
--
-- A request waiting for a parent is not yet the team's business: team_people leaves it out, the read
-- policy hides it from anybody who sees the roster only by authority (the player and their family still
-- read their own), and the staff reader below counts it without naming anybody.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.team_people(p_team_id uuid)
 returns table(kind text, row_id uuid, person_id uuid, name text, detail text, status text, requested_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_may_view boolean;
begin
  select a.may_view into v_may_view from internal.team_people_authority(p_team_id) a;
  if not coalesce(v_may_view, false) then
    raise exception 'Not authorized to view this team''s people.' using errcode = '42501';
  end if;

  return query
  -- COACHES. Everyone holding a permission on this team, described by the
  -- permission they hold. Their standing is their club membership's: someone
  -- suspended at the club is not an active coach of one of its teams.
  select
    'coach'::text,
    tp.id,
    cm.user_id,
    coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
    coalesce(internal.team_role_label(tp.role_key), 'Parent or player access'),
    case when cm.status = 'active' then 'active' else 'archived' end,
    null::timestamptz
  from internal.team_role_assignments tp
  join public.club_memberships cm on cm.id = tp.membership_id
  left join public.profiles pr on pr.id = cm.user_id
  where tp.team_id = p_team_id

  union all

  -- PLAYERS. Their place in THIS team, not their existence at the club: a
  -- player archived here may be perfectly active in another side. A request
  -- still waiting for a parent to confirm it is not the team's yet.
  select
    'player'::text,
    ptm.id,
    pl.id,
    coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'Unknown'),
    null::text,
    case ptm.status when 'active' then 'active' when 'pending' then 'requested' else 'archived' end,
    case when ptm.status = 'pending' then ptm.created_at end
  from public.player_team_memberships ptm
  join public.players pl on pl.id = ptm.player_id
  where ptm.team_id = p_team_id
    and not (ptm.state = 'PENDING' and coalesce(ptm.guardian_confirmation, '') = 'AWAITING')

  union all

  -- PARENTS AND GUARDIANS. Reached through the players in this team, which is
  -- the only relationship a team has to them, and de-duplicated: one adult
  -- with two children in the same side is one person on this list.
  select * from (
    select distinct on (g.guardian_user_id)
      'guardian'::text,
      g.id,
      g.guardian_user_id,
      coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
      'Parent or guardian of ' || coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'a player'),
      case when g.status = 'active' then 'active' else 'archived' end,
      null::timestamptz
    from public.guardians g
    join public.players pl on pl.id = g.player_id
    join public.player_team_memberships ptm
      on ptm.player_id = g.player_id and ptm.team_id = p_team_id and ptm.status = 'active'
    left join public.profiles pr on pr.id = g.guardian_user_id
    -- DISTINCT ON needs its own ORDER BY, and it cannot live at the end of a
    -- UNION -- the aliases are out of scope there. An active link wins over an
    -- ended one for the same adult.
    order by g.guardian_user_id, g.status
  ) guardians;
end;
$function$;

drop policy player_team_memberships_select on public.player_team_memberships;
create policy player_team_memberships_select on public.player_team_memberships for select
using (
  (internal.can('team.roster.view'::text, 'team'::text,
                (select t.club_id from public.teams t where t.id = player_team_memberships.team_id),
                team_id, null::uuid)
   and coalesce(guardian_confirmation, '') <> 'AWAITING')
  or internal.is_own_linked_player(player_id)
  or internal.is_active_player_guardian(player_id)
);

-- The approver's card: what each request is, how it was asked, whether the player fits, and exactly
-- what approving it does -- for the people who may approve, and only them. Requests waiting for a
-- parent are counted, never described.
create or replace function public.team_place_requests(p_team_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null or not (internal.has_capability('team.roster.manage', 'team', v_club, p_team_id)
                            or internal.has_capability('club.roster.manage', 'club', v_club, null)) then
    raise exception 'Not authorized to review this team''s requests.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'team', (select jsonb_build_object('id', t.id, 'label', t.display_name, 'club_name', d.name,
                                       'adult_side', internal.team_is_adult_side(t.id), 'age_group', t.age_group,
                                       'gender', ctt.gender)
               from public.teams t
               left join public.clubs c on c.id = t.club_id
               left join public.club_directory d on d.id = c.directory_id
               left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
              where t.id = p_team_id),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'membership_id', m.id,
               'player_id', p.id,
               'first_name', p.first_name,
               'surname', p.surname,
               'date_of_birth', p.date_of_birth,
               'fit', internal.team_code_fit(m.team_id, p.date_of_birth, p.playing_pathway),
               'source', m.source,
               'requested_at', m.created_at,
               'asked_by', case when m.source <> 'TEAM_CODE' then 'CLUB'
                                when m.created_by = p.user_id then 'OWN_ACCOUNT'
                                else 'PARENT' end,
               'requester_name', nullif(btrim(concat_ws(' ', rq.first_name, rq.surname)), ''),
               'confirmed_by_name', nullif(btrim(concat_ws(' ', cf.first_name, cf.surname)), ''),
               'confirms_guardian', exists (select 1 from public.guardians g
                                             where g.player_id = p.id and g.guardian_user_id = m.created_by
                                               and g.state = 'PENDING_APPROVAL' and g.source = 'TEAM_CODE'),
               'admits_members', case when m.source <> 'TEAM_CODE' then '[]'::jsonb else coalesce((
                 select jsonb_agg(x.name order by x.ord) from (
                   select 1 as ord, nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), '') as name
                     from public.profiles pr
                    where pr.id = p.user_id and internal.person_is_established_adult(p.user_id)
                      and not exists (select 1 from public.club_memberships cm
                                       where cm.club_id = v_club and cm.user_id = p.user_id and cm.state = 'ACTIVE')
                   union all
                   select 2, nullif(btrim(concat_ws(' ', rq.first_name, rq.surname)), '')
                    where m.created_by is distinct from p.user_id
                      and not exists (select 1 from public.club_memberships cm
                                       where cm.club_id = v_club and cm.user_id = m.created_by and cm.state = 'ACTIVE')
                 ) x where x.name is not null), '[]'::jsonb) end,
               'decided_by_others', coalesce(auth.uid() = p.user_id, false) or coalesce(auth.uid() = m.created_by, false)
                                    or exists (select 1 from public.guardians g
                                                where g.player_id = p.id and g.guardian_user_id = auth.uid()
                                                  and g.state in ('ACTIVE', 'PENDING_APPROVAL')))
             order by m.created_at)
        from public.player_team_memberships m
        join public.players p on p.id = m.player_id
        left join public.profiles rq on rq.id = m.created_by
        left join public.profiles cf on cf.id = m.guardian_confirmed_by
       where m.team_id = p_team_id and m.state = 'PENDING'
         and coalesce(m.guardian_confirmation, '') <> 'AWAITING'), '[]'::jsonb),
    'awaiting_guardian', (select count(*) from public.player_team_memberships m
                           where m.team_id = p_team_id and m.state = 'PENDING' and m.guardian_confirmation = 'AWAITING'));
end;
$function$;

revoke all on function public.team_place_requests(uuid) from public, anon;
grant execute on function public.team_place_requests(uuid) to authenticated, service_role;
