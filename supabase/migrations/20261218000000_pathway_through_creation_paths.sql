-- Every path that creates a player carries the pathway through.
--
-- add_child_for_guardian already required it. Four other functions create a
-- players row and none of them captured it:
--
--   create_player_for_guardian            invitation-based registration
--   request_child_link                    a guardian's link request
--   approve_guardian_link_request         creates the player on approval
--   resolve_player_duplicate_review_as_new  creates it after a duplicate review
--
-- The membership guard already prevents the dangerous consequence -- a player
-- with no recorded pathway cannot join a gendered team at all -- so none of
-- these could place a child wrongly. But leaving a registration flow that
-- never asks means the club discovers the gap later, as profile-completion
-- work, for a question the parent was standing right there to answer.
--
-- The two approval paths do NOT ask. They create a player from a request
-- somebody else submitted, so they read what that request carried and never
-- invent a value. That is why the pathway is stored on the request itself.

alter table public.guardian_link_requests add column if not exists submitted_playing_pathway text;
alter table public.player_duplicate_reviews add column if not exists submitted_playing_pathway text;

alter table public.guardian_link_requests drop constraint if exists guardian_link_requests_pathway_check;
alter table public.guardian_link_requests add constraint guardian_link_requests_pathway_check
  check (submitted_playing_pathway is null or submitted_playing_pathway in ('MALE','FEMALE'));
alter table public.player_duplicate_reviews drop constraint if exists player_duplicate_reviews_pathway_check;
alter table public.player_duplicate_reviews add constraint player_duplicate_reviews_pathway_check
  check (submitted_playing_pathway is null or submitted_playing_pathway in ('MALE','FEMALE'));

comment on column public.guardian_link_requests.submitted_playing_pathway is
  'The playing pathway the requesting guardian gave. Read by approve_guardian_link_request when it creates the player -- the approver never invents one.';

CREATE OR REPLACE FUNCTION public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_candidate_team_count integer;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  -- Required at registration, and enforced here rather than in the browser.
  -- Asked once, now: every child eventually reaches the age where the boys'
  -- and girls' pathways separate, and at that point Ovalball must not have to
  -- guess -- nor infer it from whichever team they happen to have joined.
  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE', 'FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- INVITE-ONLY GUARD (Phase B).
  --
  -- Previously this function guarded only on "is signed in" and "club
  -- exists", then created a players row, a guardians row and a pending
  -- player_team_memberships row at ANY active club. That let an unrelated
  -- signed-in person invent a child at a club they have nothing to do with
  -- and declare themselves its guardian. The pending status meant no team
  -- authority followed, but the identity records were still created.
  --
  -- A guardian must now already have an authorised relationship with THIS
  -- club, by one of three routes:
  --
  --   1. they accepted a guardian invitation from this club
  --      (the canonical way a new parent arrives);
  --   2. they already guardian a player at this club
  --      (an existing parent adding a second child -- this is why existing
  --      users are not disrupted);
  --   3. they hold an active club membership here
  --      (club staff who are also a parent).
  --
  -- Authority is derived server-side from stable IDs. Nothing here trusts a
  -- club id merely because the client sent one.
  if not (
    exists (
      select 1 from public.guardian_invitations gi
      where gi.club_id = p_club_id
        and gi.accepted_by = auth.uid()
        and gi.status = 'accepted'
    )
    or exists (
      select 1
      from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id
      join public.teams t on t.id = ptm.team_id
      where g.guardian_user_id = auth.uid()
        and t.club_id = p_club_id
    )
    or exists (
      select 1 from public.club_memberships cm
      where cm.user_id = auth.uid()
        and cm.club_id = p_club_id
        and cm.status = 'active'
    )
  ) then
    raise exception 'You need an invitation from this club before you can add a child to it.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status in ('pending', 'active')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;
  if v_existing_player_id is not null then
    return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count >= 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  if v_match_count = 1 then
    select ptm.team_id into v_match_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = v_match_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_new_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_new_player_id, 'guardian', auth.uid());

  select count(*) into v_candidate_team_count
  from public.teams t
  where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

  if v_candidate_team_count = 1 then
    select t.id into v_candidate_team_id
    from public.teams t
    where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

    insert into public.player_team_memberships (player_id, team_id, status, created_by)
    values (v_new_player_id, v_candidate_team_id, 'pending', auth.uid());
    v_result := 'created_pending_team';
  else
    v_candidate_team_id := null;
    v_result := 'created_needs_club_review';
  end if;

  return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.create_player_for_guardian(p_guardian_invitation_id uuid, p_first_name text, p_surname text, p_date_of_birth date, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(result text, player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv public.guardian_invitations;
  v_match_player_id uuid;
  v_player_id uuid;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_surname), '') = '' then
    raise exception 'First name and surname are required.';
  end if;

  select ptm.player_id into v_match_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = inv.team_id
    and ptm.status = 'active'
    and lower(p.first_name) = lower(trim(p_first_name))
    and lower(p.surname) = lower(trim(p_surname))
    and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;

  if v_match_player_id is not null then
    insert into public.player_duplicate_reviews (guardian_invitation_id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by)
    values (inv.id, inv.team_id, trim(p_first_name), trim(p_surname), p_date_of_birth, v_match_player_id, auth.uid());
    return query select 'under_review'::text, null::uuid;
    return;
  end if;

  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE','FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (trim(p_first_name), trim(p_surname), p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_player_id, 'guardian', auth.uid());

  insert into public.player_team_memberships (player_id, team_id, created_by)
  values (v_player_id, inv.team_id, auth.uid());

  return query select 'created'::text, v_player_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.request_child_link(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text DEFAULT 'union'::text, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_user uuid := auth.uid();
  v_match_player_id uuid;
  v_match_count integer;
  v_request_id uuid;
  v_recent integer;
  v_season_id uuid;
  v_grade record;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- Anti-abuse. Probable matching is a discovery oracle if it can be run
  -- repeatedly, so cap how many applications one account can have in flight.
  -- Deliberately counts the applicant's OWN rows only -- it never reveals
  -- anything about the club or the children.
  select count(*) into v_recent
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'You have submitted several requests recently. Please wait before submitting another, or contact your club directly.'
      using errcode = '42501';
  end if;

  -- Validate the date of birth against the canonical age-grade domain, so a
  -- request that could never resolve to a real youth team is refused up front
  -- rather than wasting an approver's time. Same messages as the existing
  -- add-a-child path, so the parent sees one consistent product.
  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;
  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  -- Already linked? Answer neutrally rather than confirming anything: the
  -- caller can see their own children elsewhere in the product anyway.
  if exists (
    select 1
    from public.players p
    join public.guardians g on g.player_id = p.id and g.guardian_user_id = v_user and g.status = 'active'
    where lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select null::uuid, 'ALREADY_LINKED'::text;
    return;
  end if;

  -- An existing pending request is idempotent, not an error -- resubmitting
  -- the same child must not create a second application or leak that the
  -- first one matched something.
  select glr.id into v_request_id
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.club_id = p_club_id
    and glr.status = 'PENDING'
    and glr.kind = 'FIRST_CHILD'
    and lower(glr.submitted_first_name) = lower(v_first)
    and lower(glr.submitted_surname) = lower(v_surname)
    and glr.submitted_date_of_birth is not distinct from p_date_of_birth;
  if v_request_id is not null then
    return query select v_request_id, 'PENDING'::text;
    return;
  end if;

  -- PRIVATE probable match. The result is stored for the approver and never
  -- returned. Ambiguity (more than one candidate) is recorded as no match:
  -- guessing which child was meant is exactly what must not happen, so the
  -- approver sees an unmatched application and judges it as a human.
  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id
    and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first)
    and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count = 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id
      and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  insert into public.guardian_link_requests (
    kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code,
    submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id
  )
  values (
    'FIRST_CHILD', 'PENDING', v_user, v_user, p_club_id, p_rugby_code,
    v_first, v_surname, p_date_of_birth, upper(nullif(p_playing_pathway,'')), v_match_player_id
  )
  returning id into v_request_id;

  -- One shape, match or no match.
  return query select v_request_id, 'PENDING'::text;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.approve_guardian_link_request(p_request_id uuid)
 RETURNS TABLE(result text, player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  r public.guardian_link_requests%rowtype;
  v_player_id uuid;
  v_subject uuid;
  v_season_id uuid;
  v_grade record;
  v_team_id uuid;
  v_team_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Lock the row so two approvers cannot both act on one request and
  -- produce two guardian relationships or two players.
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null then
    -- Same message for "does not exist" and "not yours to see", so this
    -- cannot be used to probe for request ids.
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  v_subject := coalesce(r.subject_user_id, r.requested_by_user_id);
  if v_subject is null then
    -- An additional-guardian request for someone with no account yet cannot
    -- be completed here; they must accept the invitation and sign in first.
    raise exception 'This person needs to accept their invitation and sign in before the relationship can be approved.';
  end if;

  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_player_id := r.target_player_id;
  elsif r.matched_player_id is not null then
    -- Existing child: attach to the CANONICAL player. No duplicate is ever
    -- created on this branch -- that is the whole point of matching.
    v_player_id := r.matched_player_id;
  else
    -- No existing child: create the canonical Player now, at approval time,
    -- by a human with real authority -- never at request time.
    insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
    values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
    returning id into v_player_id;

    -- Place them on a team using the existing canonical age-grade domain,
    -- exactly as add_child_for_guardian does. Ambiguity leaves the player
    -- without a membership for the club to resolve, rather than guessing.
    v_season_id := internal.resolve_season_for_date(coalesce(r.rugby_code, 'union'), current_date);
    if v_season_id is not null then
      select * into v_grade from internal.resolve_player_age_grade(coalesce(r.rugby_code, 'union'), v_season_id, r.submitted_date_of_birth);
      if v_grade.status not in ('TOO_YOUNG', 'OUT_OF_YOUTH_RANGE') then
        select count(*) into v_team_count
        from public.teams t
        where t.club_id = r.club_id and t.active = true
          and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
        if v_team_count = 1 then
          select t.id into v_team_id
          from public.teams t
          where t.club_id = r.club_id and t.active = true
            and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
          insert into public.player_team_memberships (player_id, team_id, status, created_by)
          values (v_player_id, v_team_id, 'active', auth.uid());
        end if;
      end if;
    end if;
  end if;

  -- The relationship itself -- created ONLY here, only on approval.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, created_by)
  values (v_subject, v_player_id, 'guardian', 'active', auth.uid())
  on conflict do nothing;

  update public.guardian_link_requests
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), resolved_player_id = v_player_id
  where id = p_request_id;

  return query select 'approved'::text, v_player_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.resolve_player_duplicate_review_as_new(p_review_id uuid)
 RETURNS TABLE(player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.player_duplicate_reviews;
  v_club_id uuid;
  v_submitter uuid;
  v_player_id uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = r.team_id;
  if v_club_id is null or not (internal.has_capability('team.guardians.invite', 'team', v_club_id, r.team_id) or internal.has_capability('team.guardians.invite', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to resolve this review.' using errcode = '42501';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (v_submitter, v_player_id, 'guardian', auth.uid());

  insert into public.player_team_memberships (player_id, team_id, created_by)
  values (v_player_id, r.team_id, auth.uid());

  update public.player_duplicate_reviews set status = 'created_new', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;

  return query select v_player_id;
end;
$function$

;

-- ============================================================
-- Remove the legacy overloads, or the requirement is optional.
-- ============================================================
--
-- Adding the parameter with a DEFAULT created a SECOND function rather than
-- replacing the first. Postgres resolves a five-argument call to the exact
-- arity match -- the OLD function -- so every existing caller kept reaching the
-- version that never asks for a pathway, and the requirement was decorative.
--
-- The old signatures are dropped. A caller that has not been updated now fails
-- loudly at the boundary instead of quietly creating a player nobody can place.

drop function if exists public.add_child_for_guardian(text, text, date, uuid, text);
drop function if exists public.create_player_for_guardian(uuid, text, text, date);
drop function if exists public.request_child_link(text, text, date, uuid, text);

do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('add_child_for_guardian','create_player_for_guardian','request_child_link')
    and pg_get_function_arguments(p.oid) not like '%playing_pathway%';
  if v_n > 0 then
    raise exception '% player-creation overload(s) still accept no playing pathway.', v_n;
  end if;

  -- And every path that writes a players row either asks for the pathway or
  -- reads one a request already carried.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','internal') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~ 'insert into public\.players'
    and pg_get_functiondef(p.oid) !~ 'playing_pathway';
  if v_n > 0 then
    raise exception '% function(s) create a player without recording a playing pathway.', v_n;
  end if;
end $$;
