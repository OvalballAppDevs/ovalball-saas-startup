-- COMPETITION MATCH OPERATIONS.
--
-- Every change to a competition's participants, stages, rounds and matches goes
-- through these functions, and every one checks organiser authority first
-- (internal.can_organise_competition). A club answers a match it has been
-- issued through public.respond_competition_match, checked against that club's
-- own fixture authority. No table accepts direct writes (20270306000000).
--
-- Small corrections stay small: replacing draft matches can be scoped to one
-- round or one group, and matches already issued are never swept away by a
-- regeneration.

create or replace function internal.require_edition_organiser(p_edition_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not internal.can_organise_edition(p_edition_id) then
    raise exception 'You do not organise this competition.' using errcode = '42501';
  end if;
end;
$$;

-- The people told about an organiser-side event: the organising club's fixture
-- administrators, or the Site Admins who manage competitions.
create or replace function internal.competition_organiser_recipients(p_edition_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.user_id
  from public.competition_editions e
  join public.competitions c on c.id = e.competition_id
  join public.club_memberships cm on cm.club_id = c.organiser_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  where e.id = p_edition_id
  union
  select sa.user_id
  from public.competition_editions e
  join public.competitions c on c.id = e.competition_id
  join public.site_admins sa on sa.status = 'active' and (sa.admin_role = 'full' or sa.manage_competitions)
  where e.id = p_edition_id and c.organiser_club_id is null;
$$;

-- A club's OWN fixture administrator: an active, unsuspended Club Admin or
-- Fixture Secretary membership at that club. Deliberately NOT
-- can_bulk_plan_fixtures, which a Site Admin satisfies everywhere: issuing a
-- competition must never answer for a club on that club's behalf.
create or replace function internal.is_club_fixture_administrator(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.club_memberships cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
      and cm.authority_suspended = false and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  );
$$;

-- Who may answer a competition match for a participant: that club's own
-- fixture administrators, or the staff of the team entered.
create or replace function internal.can_answer_competition_match(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_club_fixture_administrator(p_club_id)
    or (p_team_id is not null and internal.is_account_active(auth.uid()) and exists (
      select 1 from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active'
        and cm.authority_suspended = false and tp.permission in ('team_admin', 'coach', 'manager')
    ));
$$;

-- ============================================================
-- Participants
-- ============================================================

create or replace function public.save_competition_participants(p_edition_id uuid, p_entries jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_keep uuid[] := array[]::uuid[];
  v_id uuid;
begin
  perform internal.require_edition_organiser(p_edition_id);

  -- Slots are renumbered freely (drag and reorder), so move every existing
  -- slot out of the way before writing the new order.
  update public.competition_participants set slot = slot + 100000 where edition_id = p_edition_id;

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_id := nullif(e->>'id', '')::uuid;
    begin
      if v_id is not null and exists (select 1 from public.competition_participants where id = v_id and edition_id = p_edition_id) then
        update public.competition_participants
        set slot = (e->>'slot')::int,
            club_directory_id = (e->>'club_directory_id')::uuid,
            club_id = nullif(e->>'club_id', '')::uuid,
            team_id = nullif(e->>'team_id', '')::uuid,
            canonical_team_type_id = nullif(e->>'canonical_team_type_id', '')::uuid,
            squad_label = nullif(trim(coalesce(e->>'squad_label', '')), ''),
            seed = nullif(e->>'seed', '')::int,
            status = 'entered',
            updated_by = auth.uid()
        where id = v_id;
      else
        insert into public.competition_participants (id, edition_id, slot, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, seed, created_by, updated_by)
        values (coalesce(v_id, gen_random_uuid()), p_edition_id, (e->>'slot')::int, (e->>'club_directory_id')::uuid,
          nullif(e->>'club_id', '')::uuid, nullif(e->>'team_id', '')::uuid, nullif(e->>'canonical_team_type_id', '')::uuid,
          nullif(trim(coalesce(e->>'squad_label', '')), ''), nullif(e->>'seed', '')::int, auth.uid(), auth.uid())
        returning id into v_id;
      end if;
    exception when unique_violation then
      raise exception 'That team or club is already entered in this competition (slot %).', e->>'slot' using errcode = '23505';
    end;
    v_keep := v_keep || v_id;
  end loop;

  -- Removed entries: deleted when nothing refers to them, otherwise withdrawn
  -- so a match already played keeps its participant.
  update public.competition_participants p
  set status = 'withdrawn', updated_by = auth.uid()
  where p.edition_id = p_edition_id and not (p.id = any (v_keep)) and p.status = 'entered'
    and exists (select 1 from public.competition_matches m where m.status <> 'draft' and (m.home_participant_id = p.id or m.away_participant_id = p.id));
  delete from public.competition_matches m
  where m.edition_id = p_edition_id and m.status = 'draft'
    and not exists (select 1 from public.competition_match_fixtures l where l.match_id = m.id)
    and (m.home_participant_id in (select id from public.competition_participants where edition_id = p_edition_id and not (id = any (v_keep)) and status = 'entered')
      or m.away_participant_id in (select id from public.competition_participants where edition_id = p_edition_id and not (id = any (v_keep)) and status = 'entered'));
  delete from public.competition_participants p
  where p.edition_id = p_edition_id and not (p.id = any (v_keep)) and p.status = 'entered';

  -- Withdrawn entries keep a slot out of the way of the live order.
  update public.competition_participants set slot = slot + 100000
  where edition_id = p_edition_id and status = 'withdrawn' and slot < 100000;
end;
$function$;

-- ============================================================
-- Stages, groups, rounds
-- ============================================================

create or replace function public.save_competition_stage(
  p_edition_id uuid,
  p_stage_id uuid,
  p_kind text,
  p_name text,
  p_sort_order integer,
  p_settings jsonb,
  p_groups jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stage uuid := p_stage_id;
  g jsonb;
  v_group uuid;
  v_member text;
  v_position integer;
  v_sort integer := 0;
  v_keep uuid[] := array[]::uuid[];
begin
  perform internal.require_edition_organiser(p_edition_id);

  if v_stage is null or not exists (select 1 from public.competition_stages where id = v_stage and edition_id = p_edition_id) then
    insert into public.competition_stages (id, edition_id, kind, name, sort_order, settings)
    values (coalesce(v_stage, gen_random_uuid()), p_edition_id, p_kind, coalesce(nullif(trim(p_name), ''), initcap(p_kind)), coalesce(p_sort_order, 1), coalesce(p_settings, '{}'::jsonb))
    returning id into v_stage;
  else
    update public.competition_stages
    set kind = p_kind, name = coalesce(nullif(trim(p_name), ''), name), sort_order = coalesce(p_sort_order, sort_order),
        settings = coalesce(p_settings, settings), updated_at = now()
    where id = v_stage;
  end if;

  if p_groups is not null then
    delete from public.competition_group_members where stage_id = v_stage;
    for g in select * from jsonb_array_elements(p_groups) loop
      v_sort := v_sort + 1;
      select id into v_group from public.competition_groups where stage_id = v_stage and name = g->>'name';
      if v_group is null then
        insert into public.competition_groups (stage_id, name, sort_order) values (v_stage, g->>'name', v_sort) returning id into v_group;
      else
        update public.competition_groups set sort_order = v_sort where id = v_group;
      end if;
      v_keep := v_keep || v_group;
      v_position := 0;
      for v_member in select jsonb_array_elements_text(coalesce(g->'members', '[]'::jsonb)) loop
        v_position := v_position + 1;
        if not exists (select 1 from public.competition_participants where id = v_member::uuid and edition_id = p_edition_id) then
          raise exception 'A group member is not a participant in this competition.' using errcode = '23514';
        end if;
        begin
          insert into public.competition_group_members (group_id, stage_id, participant_id, position)
          values (v_group, v_stage, v_member::uuid, v_position);
        exception when unique_violation then
          raise exception 'A participant can only be in one group.' using errcode = '23505';
        end;
      end loop;
    end loop;
    delete from public.competition_groups where stage_id = v_stage and not (id = any (v_keep));
  end if;

  return v_stage;
end;
$function$;

create or replace function public.save_competition_rounds(p_stage_id uuid, p_rounds jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_edition uuid;
  r jsonb;
begin
  select edition_id into v_edition from public.competition_stages where id = p_stage_id;
  perform internal.require_edition_organiser(v_edition);
  delete from public.competition_rounds where stage_id = p_stage_id;
  for r in select * from jsonb_array_elements(coalesce(p_rounds, '[]'::jsonb)) loop
    insert into public.competition_rounds (stage_id, round_number, name, round_date)
    values (p_stage_id, (r->>'round_number')::int, nullif(r->>'name', ''), nullif(r->>'round_date', '')::date);
  end loop;
end;
$function$;

-- ============================================================
-- Draft matches
-- ============================================================

create or replace function public.replace_competition_draft_matches(
  p_stage_id uuid,
  p_matches jsonb,
  p_group_id uuid default null,
  p_round_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_edition uuid;
  mt jsonb;
  v_removed integer;
  v_kept integer;
  v_added integer := 0;
begin
  select edition_id into v_edition from public.competition_stages where id = p_stage_id;
  perform internal.require_edition_organiser(v_edition);

  select count(*) into v_kept from public.competition_matches
  where stage_id = p_stage_id and status <> 'draft'
    and (p_group_id is null or group_id = p_group_id)
    and (p_round_number is null or round_number = p_round_number);

  with gone as (
    delete from public.competition_matches m
    where m.stage_id = p_stage_id and m.status = 'draft'
      and (p_group_id is null or m.group_id = p_group_id)
      and (p_round_number is null or m.round_number = p_round_number)
      and not exists (select 1 from public.competition_match_fixtures l where l.match_id = m.id)
    returning 1
  )
  select count(*) into v_removed from gone;

  for mt in select * from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) loop
    insert into public.competition_matches (
      id, edition_id, stage_id, group_id, round_number, bracket_slot,
      home_participant_id, away_participant_id, home_source, away_source,
      match_date, kickoff_time, venue_id, venue_text, pitch_id, notes, status, created_by, updated_by
    )
    values (
      coalesce(nullif(mt->>'id', '')::uuid, gen_random_uuid()), v_edition, p_stage_id,
      nullif(mt->>'group_id', '')::uuid, nullif(mt->>'round_number', '')::int, nullif(mt->>'bracket_slot', '')::int,
      nullif(mt->>'home_participant_id', '')::uuid, nullif(mt->>'away_participant_id', '')::uuid,
      case when jsonb_typeof(mt->'home_source') = 'object' then mt->'home_source' end,
      case when jsonb_typeof(mt->'away_source') = 'object' then mt->'away_source' end,
      nullif(mt->>'match_date', '')::date, nullif(mt->>'kickoff_time', '')::time,
      nullif(mt->>'venue_id', '')::uuid, nullif(mt->>'venue_text', ''), nullif(mt->>'pitch_id', '')::uuid,
      nullif(mt->>'notes', ''), 'draft', auth.uid(), auth.uid()
    );
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('removed', v_removed, 'added', v_added, 'kept_issued', v_kept);
end;
$function$;

create or replace function public.delete_competition_draft_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
begin
  select * into m from public.competition_matches where id = p_match_id;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if m.status <> 'draft' or exists (select 1 from public.competition_match_fixtures where match_id = m.id) then
    raise exception 'Only a draft match can be removed. Cancel an issued match instead, so its club fixtures are cancelled with it.' using errcode = '23514';
  end if;
  delete from public.competition_matches where id = m.id;
end;
$function$;

-- ============================================================
-- Editing a match
-- ============================================================

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
begin
  select * into m from public.competition_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if m.status in ('cancelled', 'completed') and not (p_patch ? 'notes' or p_patch ? 'is_public') then
    raise exception 'This match is %; only its notes can change.', m.status using errcode = '23514';
  end if;

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

  if exists (
    select 1 from public.competition_participants p
    where p.id in (v_after.home_participant_id, v_after.away_participant_id) and p.edition_id <> m.edition_id
  ) then
    raise exception 'Both teams must be participants in this competition.' using errcode = '23514';
  end if;

  -- An issued match whose teams changed is issued again to the new teams.
  if m.status <> 'draft' and (v_after.home_participant_id is distinct from m.home_participant_id
      or v_after.away_participant_id is distinct from m.away_participant_id) then
    delete from public.competition_match_verifications
    where match_id = m.id and participant_id not in (coalesce(v_after.home_participant_id, gen_random_uuid()), coalesce(v_after.away_participant_id, gen_random_uuid()));
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

-- ============================================================
-- Results
-- ============================================================

create or replace function public.record_competition_match_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_winner_participant_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
  v_kind text;
  v_winner uuid;
begin
  select * into m from public.competition_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if m.home_participant_id is null or m.away_participant_id is null then
    raise exception 'Both teams must be known before a result is recorded.' using errcode = '23514';
  end if;
  if m.status = 'cancelled' then
    raise exception 'This match was cancelled.' using errcode = '23514';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'Enter both scores.';
  end if;
  select kind into v_kind from public.competition_stages where id = m.stage_id;

  v_winner := case
    when p_home_score > p_away_score then m.home_participant_id
    when p_away_score > p_home_score then m.away_participant_id
    else p_winner_participant_id end;
  if v_kind = 'knockout' and v_winner is null then
    raise exception 'A knockout match needs a winner. Choose who went through.' using errcode = '23514';
  end if;
  if v_winner is not null and v_winner not in (m.home_participant_id, m.away_participant_id) then
    raise exception 'The winner must be one of the two teams.' using errcode = '23514';
  end if;

  update public.competition_matches
  set home_score = p_home_score, away_score = p_away_score, winner_participant_id = v_winner,
      result_source = 'organiser', status = 'completed', updated_by = auth.uid(), updated_at = now()
  where id = m.id;

  perform internal.advance_competition_knockout(m.id);
  perform internal.sync_competition_match_fixtures(m.id);
end;
$function$;

-- ============================================================
-- Issuing, answering, cancelling
-- ============================================================

create or replace function internal.refresh_competition_match_verification(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_awaiting integer;
  v_change integer;
  v_declined integer;
  v_total integer;
  v_state text;
  v_status text;
  m public.competition_matches;
begin
  select * into m from public.competition_matches where id = p_match_id;
  select count(*) filter (where status = 'awaiting'),
         count(*) filter (where status = 'change_requested'),
         count(*) filter (where status = 'declined'),
         count(*)
    into v_awaiting, v_change, v_declined, v_total
  from public.competition_match_verifications where match_id = p_match_id;

  v_state := case
    when v_total = 0 then 'not_required'
    when v_declined > 0 then 'declined'
    when v_change > 0 then 'change_requested'
    when v_awaiting > 0 then 'awaiting'
    else 'confirmed' end;
  v_status := case
    when m.status in ('draft', 'completed', 'cancelled', 'postponed') then m.status
    when v_state in ('declined', 'change_requested') then 'change_requested'
    when v_state = 'awaiting' then 'issued'
    when v_state = 'confirmed' then 'confirmed'
    else 'scheduled' end;

  update public.competition_matches set verification_state = v_state, status = v_status, updated_at = now() where id = p_match_id;
end;
$$;

create or replace function public.issue_competition_matches(p_edition_id uuid, p_match_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
  p public.competition_participants;
  v_issued integer := 0;
  v_waiting integer := 0;
  v_label text;
  v_verification uuid;
begin
  perform internal.require_edition_organiser(p_edition_id);

  for m in
    select * from public.competition_matches
    where edition_id = p_edition_id
      and (p_match_ids is null or id = any (p_match_ids))
      and status in ('draft', 'scheduled', 'issued', 'change_requested', 'confirmed')
    order by round_number nulls last, bracket_slot nulls last
    for update
  loop
    if m.status = 'draft' then
      update public.competition_matches set status = 'scheduled', updated_by = auth.uid(), updated_at = now() where id = m.id;
    end if;

    for p in select * from public.competition_participants where id in (m.home_participant_id, m.away_participant_id) loop
      continue when p.team_id is null;
      select id into v_verification from public.competition_match_verifications where match_id = m.id and participant_id = p.id;
      if v_verification is null then
        insert into public.competition_match_verifications (match_id, participant_id, club_id, team_id, status, responded_by, responded_at)
        values (m.id, p.id, p.club_id, p.team_id,
          -- An organiser who is that club's own fixture administrator has
          -- answered for it. Anybody else -- a Site Admin included -- has not.
          case when internal.is_club_fixture_administrator(p.club_id) then 'confirmed' else 'awaiting' end,
          case when internal.is_club_fixture_administrator(p.club_id) then auth.uid() end,
          case when internal.is_club_fixture_administrator(p.club_id) then now() end)
        returning id into v_verification;
      elsif m.status = 'change_requested' then
        update public.competition_match_verifications
        set status = case when internal.is_club_fixture_administrator(p.club_id) then 'confirmed' else 'awaiting' end,
            message = null, proposed_date = null, proposed_kickoff_time = null, proposed_venue_id = null, proposed_pitch_id = null,
            responded_by = null, responded_at = null, updated_at = now()
        where id = v_verification;
      else
        continue;
      end if;

      if (select status from public.competition_match_verifications where id = v_verification) = 'awaiting' then
        v_waiting := v_waiting + 1;
        v_label := internal.competition_match_label(m.id);
        insert into public.notifications (user_id, type, title, body, data)
        select distinct r.user_id, 'competition_match_verification_requested', 'Confirm a competition match',
          format('%s. Confirm it, request a change or decline.', v_label),
          jsonb_build_object('competition_match_id', m.id, 'verification_id', v_verification, 'edition_id', m.edition_id)
        from internal.competition_club_recipients(p.club_id, p.team_id) r
        where r.user_id is distinct from auth.uid();
      end if;
    end loop;

    perform internal.refresh_competition_match_verification(m.id);
    perform internal.project_competition_match(m.id);
    v_issued := v_issued + 1;
  end loop;

  return jsonb_build_object('issued', v_issued, 'awaiting_clubs', v_waiting);
end;
$function$;

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

create or replace function public.cancel_competition_match(p_match_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.competition_matches;
  v_label text;
begin
  select * into m from public.competition_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  perform internal.require_edition_organiser(m.edition_id);
  if p_status not in ('cancelled', 'postponed') then
    raise exception 'A match is cancelled or postponed.';
  end if;
  if m.status = 'draft' then
    raise exception 'A draft match is removed, not cancelled.' using errcode = '23514';
  end if;

  update public.competition_matches
  set status = p_status, notes = coalesce(nullif(trim(coalesce(p_reason, '')), ''), notes), updated_by = auth.uid(), updated_at = now()
  where id = m.id;
  perform internal.sync_competition_match_fixtures(m.id);

  v_label := internal.competition_match_label(m.id);
  insert into public.notifications (user_id, type, title, body, data)
  select distinct r.user_id, 'competition_match_cancelled',
    case p_status when 'postponed' then 'Competition match postponed' else 'Competition match cancelled' end,
    format('%s has been %s.', v_label, p_status),
    jsonb_build_object('competition_match_id', m.id, 'edition_id', m.edition_id)
  from public.competition_participants p
  cross join lateral internal.competition_club_recipients(p.club_id, p.team_id) r
  where p.id in (m.home_participant_id, m.away_participant_id) and p.club_id is not null
    and r.user_id is distinct from auth.uid();
end;
$function$;

-- Grants: authenticated callers only; each function checks its own authority.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.save_competition_participants(uuid, jsonb)',
    'public.save_competition_stage(uuid, uuid, text, text, integer, jsonb, jsonb)',
    'public.save_competition_rounds(uuid, jsonb)',
    'public.replace_competition_draft_matches(uuid, jsonb, uuid, integer)',
    'public.delete_competition_draft_match(uuid)',
    'public.update_competition_match(uuid, jsonb)',
    'public.record_competition_match_result(uuid, integer, integer, uuid)',
    'public.issue_competition_matches(uuid, uuid[])',
    'public.respond_competition_match(uuid, text, text, date, time, uuid, uuid)',
    'public.cancel_competition_match(uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
