-- Judging a next-season placement by next-season identities.
--
-- WHAT THE TEST EXPOSED
--
-- Once normal placement followed the squad, a handover override stopped making
-- sense. A U15 B player whose normal next season is U16 B, moved to "the U15
-- team", was judged PERMITTED as an ordinary same-age request -- because
-- internal.resolve_player_movement_eligibility compared the two teams' age
-- groups AS THEY ARE TODAY, and today both are U15.
--
-- The verdict was not wrong about today. It was answering the wrong question.
-- At a season handover every one of those teams is moving: today's U15 becomes
-- U16, today's U14 becomes U15. So "put this player in the U15 team" does not
-- mean "put them in U15" -- it means "put them in the team that will be U16",
-- which is the same age grade they were going to anyway, differing only by
-- squad letter.
--
-- Genuinely placing a player DOWN an age grade next season means choosing the
-- team that will be U15 next season -- today's U14 side. Compared by today's
-- labels, that reads as a two-grade drop; compared by next season's, it is the
-- one-grade drop it actually is. Both the classification and the governing
-- verdict were being computed against labels that expire at the boundary the
-- decision is about.
--
-- THE FIX, WITHOUT A SECOND RESOLVER
--
-- resolve_player_movement_eligibility takes an optional season. Given one, it
-- resolves each side's identity through public.get_team_identity_for_season --
-- the same canonical projection the Calendar, Agenda, Match Centre and fixture
-- views already use -- so the comparison is between the identities that will
-- exist when the fixture is played. Given nothing, it behaves exactly as
-- before, so every existing caller asking a question about today is unaffected.
--
-- One resolver, one movement vocabulary, one team-identity projection. The
-- season is an input, not a fork.

drop function if exists internal.resolve_player_movement_eligibility(text, date, date, uuid, uuid);

create or replace function internal.resolve_player_movement_eligibility(
  p_rugby_code text,
  p_reference_date date,
  p_player_dob date,
  p_source_team_id uuid,
  p_target_team_id uuid,
  p_season_id uuid default null
)
returns table (requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
language plpgsql stable
as $function$
declare
  v_source public.teams;
  v_target public.teams;
  v_age integer;
  v_code text;
  v_next text;
  -- Identities as they will stand in the season being decided. Without a
  -- season these stay the teams' current values and nothing changes.
  v_src_age text; v_src_gender text; v_src_cat text;
  v_tgt_age text; v_tgt_gender text; v_tgt_cat text;
begin
  select * into v_source from public.teams where id = p_source_team_id;
  select * into v_target from public.teams where id = p_target_team_id;

  if v_source.id is null or v_target.id is null then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'Source or target team could not be found.';
    return;
  end if;

  if not v_source.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The source team has folded and can no longer lend a player.';
    return;
  end if;
  if not v_target.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The target team has folded and cannot receive a player.';
    return;
  end if;

  if v_source.club_id <> v_target.club_id then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams belong to different clubs. This needs an inter-club arrangement, which Ovalball does not model as a call-up or dispensation.';
    return;
  end if;

  -- Codes must match. Union and League do not share an age-grade framework,
  -- so a cross-code move is not a dispensation question -- it is meaningless.
  if v_source.rugby_code is distinct from v_target.rugby_code then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams are in different rugby codes. Union and League age grades are separate frameworks and a player cannot move between them as an age-grade progression.';
    return;
  end if;

  -- Trust the teams' own code over the caller's argument.
  v_code := coalesce(v_source.rugby_code, p_rugby_code);

  v_src_age := v_source.age_group; v_src_gender := v_source.gender; v_src_cat := v_source.category;
  v_tgt_age := v_target.age_group; v_tgt_gender := v_target.gender; v_tgt_cat := v_target.category;

  if p_season_id is not null then
    select i.age_group, i.gender, i.category into v_src_age, v_src_gender, v_src_cat
    from public.get_team_identity_for_season(p_source_team_id, p_season_id) i;
    select i.age_group, i.gender, i.category into v_tgt_age, v_tgt_gender, v_tgt_cat
    from public.get_team_identity_for_season(p_target_team_id, p_season_id) i;
    v_src_age := coalesce(v_src_age, v_source.age_group);
    v_tgt_age := coalesce(v_tgt_age, v_target.age_group);
    v_src_gender := coalesce(v_src_gender, v_source.gender);
    v_tgt_gender := coalesce(v_tgt_gender, v_target.gender);
    v_src_cat := coalesce(v_src_cat, v_source.category);
    v_tgt_cat := coalesce(v_tgt_cat, v_target.category);
  end if;

  if v_src_cat = 'youth' and v_tgt_cat = 'youth'
     and v_src_age = v_tgt_age and coalesce(v_src_gender, '') = coalesce(v_tgt_gender, '') then
    return query select 'permitted', null::text, null::text, null::text, null::text, 'Same canonical age group -- an ordinary team-to-team request.';
    return;
  end if;

  if v_tgt_cat = 'senior' then
    if p_player_dob is null then
      return query select 'not_permitted', null::text, null::text, null::text, null::text,
        'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby.';
      return;
    end if;
    v_age := extract(year from age(p_reference_date, p_player_dob))::integer;

    if v_age >= 18 then
      return query select 'permitted', null::text, null::text, null::text, null::text, 'This player is 18 or over -- an ordinary adult player.';
      return;
    end if;

    if v_code = 'union' then
      if v_age >= 17 then
        return query select
          'external_approval_required', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)',
          'Club approval for a 17-year-old to play adult rugby, individual player assessment, Club Safeguarding Officer approval, Constituent Body approval, and individual adult registration.',
          'No contested-scrum front row before age 18.',
          'This player is 17 and the destination is an adult Rugby Union team. RFU approval is required before they can participate in adult rugby.';
        return;
      else
        return query select 'not_permitted', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)', null::text, null::text,
          'Under RFU Regulation 15.7 a player must have reached their 17th birthday before playing any adult rugby.';
        return;
      end if;
    else
      -- RFL Operational Rules 2026 C2:5:1 -- Open Age from the 17th birthday,
      -- or as a true-age Under 17 from the March in a Season.
      if v_age >= 17 then
        return query select
          'external_approval_required', 'RFL', 'RFL Operational Rules 2026 C2:5:1 and C2:5:2',
          'Adult registration, plus a parent or guardian signature acknowledging that some sections of the RFL Safeguarding Policy do not apply to Adult Rugby League.',
          'A player may only play for the Adult team if their own age group can fulfil its fixtures that week.',
          'This player has reached 17 and the destination is an adult Rugby League team. Adult registration and the under-18 guardian acknowledgement are required.';
        return;
      end if;
      return query select
        'external_approval_required', 'RFL', 'RFL Player Dispensation Policy (Operational Rules 2026, Section F14)',
        'A dispensation decided by the RFL Dispensation Panel.',
        null::text,
        'This player is under 17 and the destination is an adult Rugby League team. RFL Operational Rules C2:5:1 set the Open Age threshold at the 17th birthday, so this needs a dispensation rather than an ordinary registration.';
      return;
    end if;
  end if;

  -- Ordinary progression, resolved against the ONE canonical graph. This is
  -- what makes a union Girls U12 -> U14 band move read as ordinary rather
  -- than as something needing a dispensation.
  if v_src_cat = 'youth' and v_tgt_cat = 'youth'
     and coalesce(v_src_gender, '') = coalesce(v_tgt_gender, '') then
    v_next := internal.next_age_grade_for(v_src_age, v_src_gender, v_code);
    if v_next is not null and v_next = v_tgt_age then
      return query select 'team_approval_only', null::text, null::text, null::text, null::text,
        format('Ordinary age-grade progression (%s -> %s) -- the source team''s own approval is sufficient.', v_src_age, v_tgt_age);
      return;
    end if;
  end if;

  return query select 'external_approval_required', null::text, null::text, null::text, null::text,
    format('Moving from %s to %s does not match an ordinary age-grade progression -- a recorded age-grade dispensation is required.',
      coalesce(v_src_age, v_src_cat), coalesce(v_tgt_age, v_tgt_cat));
end;
$function$;

-- ============================================================
-- The handover asks its questions about the target season.
-- ============================================================

create or replace function public.rollover_placement_options(p_proposal_id uuid)
returns table (team_id uuid, display_name text, age_group text, squad_designation text, is_normal boolean, is_selected boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare p public.age_grade_rollover_player_proposals; r public.age_grade_rollovers;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id;
  if not found then return; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to view placement options for this club.' using errcode = '42501';
  end if;

  -- Labelled by what each team will BE in the season being decided, not by
  -- what it is called today. Choosing "U15 B" for next season when that side
  -- is about to become U16 B would be choosing something that will not exist.
  return query
  select t.id,
         coalesce(i.display_name, t.display_name),
         coalesce(i.age_group, t.age_group),
         t.squad_designation,
         t.canonical_team_type_id is not distinct from p.normal_canonical_team_type_id,
         t.id is not distinct from coalesce(p.selected_team_id, p.proposed_team_id)
  from public.teams t
  left join lateral public.get_team_identity_for_season(t.id, r.to_season_id) i on true
  where t.club_id = r.club_id
    and t.rugby_code = r.rugby_code
    and t.active
    and t.category = 'youth'
  order by coalesce(i.age_group, t.age_group), coalesce(t.squad_designation, '');
end;
$function$;

create or replace function public.set_rollover_player_placement(p_proposal_id uuid, p_target_team_id uuid)
returns table (override_kind text, movement_requirement text, review_state text, reason text, dispensation_required boolean)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  v_target public.teams;
  v_dob date;
  v_normal_age text;
  v_target_next_age text;
  v_target_label text;
  v_move record;
  v_kind text;
  v_req text;
  v_review text;
  v_reason text;
  v_disp boolean := false;
  v_has_disp boolean;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide placements for this club.' using errcode = '42501';
  end if;
  if p.placement_applied_at is not null then
    raise exception 'This placement has already been applied and cannot be changed here.' using errcode = 'P0001';
  end if;

  select * into v_target from public.teams where id = p_target_team_id;
  if v_target.id is null or not v_target.active then
    raise exception 'That team is not an active team.' using errcode = '23514';
  end if;
  if v_target.club_id is distinct from r.club_id then
    raise exception 'A player can only be placed on a team at their own club.' using errcode = '23514';
  end if;
  if v_target.rugby_code is distinct from r.rugby_code then
    raise exception 'Union and League age grades are separate frameworks -- a player cannot be placed across codes here.' using errcode = '23514';
  end if;

  select date_of_birth into v_dob from public.players where id = p.player_id;
  select age_group into v_normal_age from public.canonical_team_types where id = p.normal_canonical_team_type_id;

  -- What the chosen team will BE next season, which is the season this
  -- decision is about.
  select coalesce(i.age_group, v_target.age_group), coalesce(i.display_name, v_target.display_name)
  into v_target_next_age, v_target_label
  from public.get_team_identity_for_season(p_target_team_id, r.to_season_id) i;
  v_target_next_age := coalesce(v_target_next_age, v_target.age_group);
  v_target_label := coalesce(v_target_label, v_target.display_name);

  if v_normal_age is not null and v_target_next_age is not distinct from v_normal_age then
    -- SAME AGE GRADE next season, different squad. An ordinary club decision:
    -- the squad letter is an operational slot within one canonical identity,
    -- not a separate age grade, so no governing approval is implied.
    v_kind := 'SAME_AGE_SQUAD';
    v_req := null;
    v_review := 'READY';
    v_reason := format('Squad placement chosen by the club: %s. Same age grade as the normal placement, so this is an operational squad decision.', v_target_label);
  else
    -- DIFFERENT AGE GRADE. The canonical resolver decides, not the board, and
    -- it is asked about the target season rather than about today.
    v_kind := 'AGE_GRADE_CHANGE';
    select * into v_move from internal.resolve_player_movement_eligibility(
      r.rugby_code, current_date, v_dob,
      coalesce(p.proposed_team_id, p.current_team_id), p_target_team_id, r.to_season_id);
    v_req := v_move.requirement;

    if v_req = 'permitted' then
      v_review := 'READY';
      v_reason := coalesce(v_move.reason, 'This placement is permitted.');
    elsif v_req = 'team_approval_only' then
      v_review := 'READY';
      v_reason := coalesce(v_move.reason, 'This placement requires the appropriate team approval.');
    elsif v_req = 'external_approval_required' then
      v_disp := true;
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = p.player_id and d.target_team_id = p_target_team_id
          and d.season_id = r.to_season_id and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_disp;
      if v_has_disp then
        v_review := 'READY';
        v_reason := 'Governing-body approval for this placement is recorded for the target season.';
      else
        v_review := 'NEEDS_ATTENTION';
        v_reason := coalesce(v_move.reason, 'This placement requires governing-body approval.');
      end if;
    else
      v_review := 'BLOCKED';
      v_reason := coalesce(v_move.reason, 'This placement is not permitted under the current rules.');
    end if;
  end if;

  update public.age_grade_rollover_player_proposals
  set selected_team_id = p_target_team_id,
      selected_canonical_team_type_id = v_target.canonical_team_type_id,
      selected_by = auth.uid(),
      selected_at = now(),
      override_kind = case when p_target_team_id is not distinct from p.proposed_team_id then null else v_kind end,
      movement_requirement = v_req,
      review_state = v_review,
      reason = v_reason
  where id = p_proposal_id;

  -- Stable identifiers only. Never a team display string as authority.
  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('age_grade_rollover_player_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('selected_team_id', p.selected_team_id, 'proposed_team_id', p.proposed_team_id,
                       'review_state', p.review_state, 'movement_requirement', p.movement_requirement),
    jsonb_build_object('event', 'HANDOVER_PLACEMENT_DECIDED', 'rollover_id', r.id, 'player_id', p.player_id,
                       'target_season_id', r.to_season_id, 'selected_team_id', p_target_team_id,
                       'selected_canonical_team_type_id', v_target.canonical_team_type_id,
                       'normal_canonical_team_type_id', p.normal_canonical_team_type_id,
                       'override_kind', v_kind, 'movement_requirement', v_req,
                       'review_state', v_review, 'dispensation_required', v_disp));

  return query select v_kind, v_req, v_review, v_reason, v_disp;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'resolve_player_movement_eligibility';
  if v_def !~ 'get_team_identity_for_season' then
    raise exception 'The movement resolver still judges a move by today''s labels only.';
  end if;

  -- Exactly one movement resolver, not a handover-specific fork.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','internal') and p.proname = 'resolve_player_movement_eligibility') <> 1 then
    raise exception 'There is more than one movement eligibility resolver.';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_rollover_player_placement';
  if v_def !~ 'r\.to_season_id\)' then
    raise exception 'The handover does not ask the resolver about the target season.';
  end if;
end $$;
