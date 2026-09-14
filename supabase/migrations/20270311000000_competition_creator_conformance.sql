-- =====================================================================
-- COMPETITION CREATOR CONFORMANCE
--
-- 1. A COMPETITION'S SEASON CAN BE CHOSEN. Quick-create still needs only a name
--    and Union or League, and still defaults to the code's current canonical
--    season. An organiser who is setting up next season's competition may now
--    name that season instead -- any registered season of the same code. A
--    season of the other code, or a regression fixture season, is refused.
--
-- 2. SEVERAL MATCH CHANGES ARE ONE CHANGE. Swapping two teams between ties,
--    swapping a team between two league matches, or filling every knockout
--    place from the group tables used to be several separate saves: a failure
--    halfway left the draw half-changed, and a 32-team competition made sixteen
--    requests. public.update_competition_matches applies a list of match patches
--    in one transaction -- all of them, or none.
--
-- 3. AN ISSUED MATCH KEEPS ITS TEAMS. A draft match's home or away participant
--    can be replaced freely. Once a match has been issued to clubs, a place
--    that already names a team is not replaced from the Creator: the clubs have
--    been asked about THAT match. An empty place (a knockout place filled from a
--    table or a previous round) can still be filled. A participant must be one
--    of this competition's entered participants.
--
-- 4. A CLUB PROPOSES ITS OWN GROUND. Request Change could already carry a
--    proposed venue and pitch; they must now be the answering club's own active
--    venue, and a pitch at that venue.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Season
-- ---------------------------------------------------------------------
create or replace function internal.competition_season_for(p_rugby_code text, p_season_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_season_id is null then
    return internal.edition_season_for_code(p_rugby_code);
  end if;
  if not exists (
    select 1 from public.seasons s
    where s.id = p_season_id and s.rugby_code = p_rugby_code and not s.is_regression_fixture
  ) then
    raise exception 'Choose a % season from the Seasons register.', initcap(p_rugby_code) using errcode = '23514';
  end if;
  return p_season_id;
end;
$$;

drop function if exists public.quick_create_competition(text, text);
create or replace function public.quick_create_competition(p_name text, p_rugby_code text, p_season_id uuid default null)
returns table (competition_id uuid, edition_id uuid, season_id uuid, season_name text, needs_attention text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_competition uuid;
  v_season uuid;
  v_edition uuid;
begin
  if p_rugby_code is null or p_rugby_code not in ('union', 'league') then
    raise exception 'Choose Union or League for this competition.';
  end if;
  -- The season is checked before anything is created, so a wrong season leaves nothing behind.
  if p_season_id is not null then
    perform internal.competition_season_for(p_rugby_code, p_season_id);
  end if;
  v_competition := public.create_competition(p_name, null, p_rugby_code, false, array[]::uuid[]);
  v_season := internal.competition_season_for(p_rugby_code, p_season_id);

  if v_season is null then
    return query select v_competition, null::uuid, null::uuid, null::text,
      format('No current or upcoming %s season is registered, so this competition has no season yet. Add the season under Site Admin, Seasons, then add it here.', initcap(p_rugby_code));
    return;
  end if;

  v_edition := public.create_competition_edition(v_competition, v_season);
  return query select v_competition, v_edition, v_season, (select s.name from public.seasons s where s.id = v_season), null::text;
end;
$function$;

revoke execute on function public.quick_create_competition(text, text, uuid) from public;
revoke execute on function public.quick_create_competition(text, text, uuid) from anon;
grant  execute on function public.quick_create_competition(text, text, uuid) to authenticated, service_role;

drop function if exists public.create_club_competition(text, text, uuid);
create or replace function public.create_club_competition(p_name text, p_rugby_code text, p_organiser_club_id uuid, p_season_id uuid default null)
returns table (competition_id uuid, edition_id uuid, season_id uuid, season_name text, needs_attention text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_competition uuid;
  v_season uuid;
  v_edition uuid;
  v_slug text;
  v_normalized text;
begin
  if not internal.can_bulk_plan_fixtures(p_organiser_club_id) then
    raise exception 'Only a club fixture administrator may create a competition for their club.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'A competition name is required.';
  end if;
  if p_rugby_code is null or p_rugby_code not in ('union', 'league') then
    raise exception 'Choose Union or League for this competition.';
  end if;
  if exists (
    select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
    where c.id = p_organiser_club_id and d.rugby_code <> p_rugby_code
  ) then
    raise exception 'A club can only organise a competition in its own rugby code.' using errcode = '23514';
  end if;
  v_season := internal.competition_season_for(p_rugby_code, p_season_id);

  v_normalized := trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || p_rugby_code;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || p_rugby_code;
  begin
    insert into public.competitions (name, slug, normalized_key, rugby_code, is_national, active, organiser_club_id, created_by, updated_by)
    values (trim(p_name), v_slug, v_normalized, p_rugby_code, false, true, p_organiser_club_id, auth.uid(), auth.uid())
    returning id into v_competition;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', initcap(p_rugby_code), trim(p_name) using errcode = 'P0001';
  end;

  if v_season is null then
    return query select v_competition, null::uuid, null::uuid, null::text,
      format('No current or upcoming %s season is registered, so this competition has no season yet.', initcap(p_rugby_code));
    return;
  end if;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_competition, v_season, p_rugby_code, true, auth.uid(), auth.uid())
  returning id into v_edition;

  return query select v_competition, v_edition, v_season, (select s.name from public.seasons s where s.id = v_season), null::text;
end;
$function$;

revoke execute on function public.create_club_competition(text, text, uuid, uuid) from public;
revoke execute on function public.create_club_competition(text, text, uuid, uuid) from anon;
grant  execute on function public.create_club_competition(text, text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. An issued match keeps its teams (and a participant belongs here)
-- ---------------------------------------------------------------------
create or replace function public.update_competition_match(p_match_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
  v_after public.competition_matches;
  v_notify boolean;
  v_label text;
  v_side text;
  v_new uuid;
begin
  select * into m from public.competition_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if m.status in ('cancelled', 'completed') and not (p_patch ? 'notes' or p_patch ? 'is_public') then
    raise exception 'This match is %; only its notes can change.', m.status using errcode = '23514';
  end if;

  foreach v_side in array array['home', 'away'] loop
    continue when not (p_patch ? (v_side || '_participant_id'));
    v_new := nullif(p_patch->>(v_side || '_participant_id'), '')::uuid;
    if v_new is not null and not exists (
      select 1 from public.competition_participants p
      where p.id = v_new and p.edition_id = m.edition_id and p.status = 'entered'
    ) then
      raise exception 'Choose a team entered in this competition.' using errcode = '23514';
    end if;
    if m.status <> 'draft'
       and (case v_side when 'home' then m.home_participant_id else m.away_participant_id end) is not null
       and v_new is distinct from (case v_side when 'home' then m.home_participant_id else m.away_participant_id end) then
      raise exception 'This match has been issued to the clubs, so its teams stay as they are. Cancel it and add a new match, or change the draw before issuing.' using errcode = '23514';
    end if;
  end loop;

  update public.competition_matches
  set match_date = case when p_patch ? 'match_date' then nullif(p_patch->>'match_date', '')::date else match_date end,
      kickoff_time = case when p_patch ? 'kickoff_time' then nullif(p_patch->>'kickoff_time', '')::time else kickoff_time end,
      venue_id = case when p_patch ? 'venue_id' then nullif(p_patch->>'venue_id', '')::uuid else venue_id end,
      venue_text = case when p_patch ? 'venue_text' then nullif(p_patch->>'venue_text', '') else venue_text end,
      pitch_id = case when p_patch ? 'pitch_id' then nullif(p_patch->>'pitch_id', '')::uuid else pitch_id end,
      home_participant_id = case when p_patch ? 'home_participant_id' then nullif(p_patch->>'home_participant_id', '')::uuid else home_participant_id end,
      away_participant_id = case when p_patch ? 'away_participant_id' then nullif(p_patch->>'away_participant_id', '')::uuid else away_participant_id end,
      round_number = case when p_patch ? 'round_number' then nullif(p_patch->>'round_number', '')::int else round_number end,
      group_id = case when p_patch ? 'group_id' then nullif(p_patch->>'group_id', '')::uuid else group_id end,
      notes = case when p_patch ? 'notes' then nullif(p_patch->>'notes', '') else notes end,
      is_public = case when p_patch ? 'is_public' then (p_patch->>'is_public')::boolean else is_public end,
      updated_by = auth.uid(),
      updated_at = now()
  where id = m.id
  returning * into v_after;

  if v_after.home_participant_id is not null and v_after.home_participant_id = v_after.away_participant_id then
    raise exception 'A team cannot play itself.' using errcode = '23514';
  end if;

  -- An issued match whose empty place was filled is issued to the new team.
  if m.status <> 'draft' and (v_after.home_participant_id is distinct from m.home_participant_id
      or v_after.away_participant_id is distinct from m.away_participant_id) then
    perform public.issue_competition_matches(m.edition_id, array[m.id]);
  end if;

  v_notify := m.status <> 'draft' and (
    v_after.match_date is distinct from m.match_date or v_after.kickoff_time is distinct from m.kickoff_time
    or v_after.venue_id is distinct from m.venue_id or v_after.venue_text is distinct from m.venue_text
    or v_after.pitch_id is distinct from m.pitch_id);

  perform internal.sync_competition_match_fixtures(m.id);
  perform internal.project_competition_match(m.id);

  if v_notify then
    v_label := internal.competition_match_label(m.id);
    insert into public.notifications (user_id, type, title, body, data)
    select distinct r.user_id, 'competition_match_changed', 'Competition match changed',
      format('%s has a new date, kick-off or venue.', v_label),
      jsonb_build_object('competition_match_id', m.id, 'edition_id', m.edition_id)
    from public.competition_participants p
    cross join lateral internal.competition_club_recipients(p.club_id, p.team_id) r
    where p.id in (v_after.home_participant_id, v_after.away_participant_id) and p.club_id is not null
      and r.user_id is distinct from auth.uid();
  end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Several changes, one transaction
-- ---------------------------------------------------------------------
create or replace function public.update_competition_matches(p_edition_id uuid, p_patches jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_count integer := 0;
  v_match uuid;
  v_home uuid;
  v_away uuid;
begin
  perform internal.require_edition_organiser(p_edition_id);
  if jsonb_typeof(coalesce(p_patches, '[]'::jsonb)) <> 'array' then
    raise exception 'Send a list of match changes.';
  end if;

  -- Every match named must belong to this edition before anything changes.
  for e in select * from jsonb_array_elements(p_patches) loop
    v_match := nullif(e->>'id', '')::uuid;
    if v_match is null or not exists (select 1 from public.competition_matches where id = v_match and edition_id = p_edition_id) then
      raise exception 'A match in this change is not part of this competition.' using errcode = '23514';
    end if;
  end loop;

  for e in select * from jsonb_array_elements(p_patches) loop
    perform public.update_competition_match((e->>'id')::uuid, coalesce(e->'patch', '{}'::jsonb));
    v_count := v_count + 1;
  end loop;

  -- The same team twice in one stage's round is a draw that cannot be played.
  select m.id, m.home_participant_id, m.away_participant_id into v_match, v_home, v_away
  from public.competition_matches m
  where m.edition_id = p_edition_id and m.status <> 'cancelled' and m.round_number is not null
    and exists (
      select 1 from public.competition_matches o
      where o.edition_id = m.edition_id and o.stage_id = m.stage_id and o.round_number = m.round_number
        and o.id <> m.id and o.status <> 'cancelled'
        and o.match_date is not distinct from m.match_date
        and (o.home_participant_id in (m.home_participant_id, m.away_participant_id) or o.away_participant_id in (m.home_participant_id, m.away_participant_id))
    )
    and m.id in (select nullif(x->>'id', '')::uuid from jsonb_array_elements(p_patches) x)
  limit 1;
  if v_match is not null then
    raise exception 'That change puts a team in two matches in the same round. Nothing was changed.' using errcode = '23514';
  end if;

  return v_count;
end;
$function$;

revoke execute on function public.update_competition_matches(uuid, jsonb) from public;
revoke execute on function public.update_competition_matches(uuid, jsonb) from anon;
grant  execute on function public.update_competition_matches(uuid, jsonb) to authenticated, service_role;

comment on function public.update_competition_matches(uuid, jsonb) is
  'Applies [{id, patch}] match changes for one competition edition in one transaction, each through update_competition_match. Used for team swaps between matches and for filling knockout places from the group tables. All or nothing.';

-- ---------------------------------------------------------------------
-- 4. A club proposes its own ground
-- ---------------------------------------------------------------------
create or replace function public.respond_competition_match(
  p_verification_id uuid,
  p_response text,
  p_message text default null,
  p_proposed_date date default null,
  p_proposed_kickoff_time time default null,
  p_proposed_venue_id uuid default null,
  p_proposed_pitch_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.competition_match_verifications;
  m public.competition_matches;
  v_label text;
begin
  select * into v from public.competition_match_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'That competition match request was not found.';
  end if;
  if not internal.can_answer_competition_match(v.club_id, v.team_id) then
    raise exception 'Only this club''s fixture administrators or the team''s own staff can answer this match.' using errcode = '42501';
  end if;
  if p_response not in ('confirmed', 'change_requested', 'declined') then
    raise exception 'Confirm, request a change or decline.';
  end if;
  -- A proposed ground is one of the answering club's own grounds, and a proposed
  -- pitch is at it: nobody proposes another club's venue on their behalf.
  if p_proposed_venue_id is not null and not exists (
    select 1 from public.venues vv where vv.id = p_proposed_venue_id and vv.club_id = v.club_id and vv.active
  ) then
    raise exception 'Propose one of your own club''s grounds.' using errcode = '23514';
  end if;
  if p_proposed_pitch_id is not null and not exists (
    select 1 from public.club_pitches cp
    where cp.id = p_proposed_pitch_id and cp.club_id = v.club_id and cp.active
      and (p_proposed_venue_id is null or cp.venue_id = p_proposed_venue_id)
  ) then
    raise exception 'Propose a pitch at the ground you chose.' using errcode = '23514';
  end if;
  if p_response = 'change_requested' and p_proposed_date is null and p_proposed_kickoff_time is null
     and p_proposed_venue_id is null and p_proposed_pitch_id is null and nullif(trim(coalesce(p_message, '')), '') is null then
    raise exception 'Say what should change -- a date, kick-off, venue, pitch or a message.';
  end if;

  update public.competition_match_verifications
  set status = p_response,
      message = nullif(trim(coalesce(p_message, '')), ''),
      proposed_date = p_proposed_date, proposed_kickoff_time = p_proposed_kickoff_time,
      proposed_venue_id = p_proposed_venue_id, proposed_pitch_id = p_proposed_pitch_id,
      responded_by = auth.uid(), responded_at = now(), updated_at = now()
  where id = v.id;

  perform internal.refresh_competition_match_verification(v.match_id);
  perform internal.project_competition_match(v.match_id);

  select * into m from public.competition_matches where id = v.match_id;
  v_label := internal.competition_match_label(m.id);
  insert into public.notifications (user_id, type, title, body, data)
  select distinct r.user_id, 'competition_match_response',
    case p_response when 'confirmed' then 'Competition match confirmed' when 'declined' then 'Competition match declined' else 'Change requested for a competition match' end,
    format('%s -- %s.', v_label, case p_response when 'confirmed' then 'confirmed' when 'declined' then 'declined' else 'a change was requested' end),
    jsonb_build_object('competition_match_id', m.id, 'verification_id', v.id, 'edition_id', m.edition_id)
  from internal.competition_organiser_recipients(m.edition_id) r
  where r.user_id is distinct from auth.uid();
end;
$function$;
