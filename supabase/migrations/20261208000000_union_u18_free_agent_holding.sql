-- Leaving the youth pathway: club holding, not an automatic adult team.
--
-- PRODUCT RULE (product owner)
--
--   Union U18 does NOT automatically become Men's 1st / Women's 1st.
--   Players leaving U18 go to a FREE AGENT / CLUB HOLDING state, available
--   for authorised assignment. Applies to both the male and female Union
--   pathways.
--
-- THE HOLDING STATE ALREADY EXISTS
--
-- No second "free agent" subsystem is introduced. player_graduation_queue with
-- status 'pending_placement' is exactly this state: the player belongs to the
-- club, holds no active team place, and waits for an authorised assignment
-- through place_graduating_player. It is reused as-is.
--
-- One thing had to change for it to genuinely mean "no active youth team
-- membership": graduate_team archived the cohort and queued its players but
-- left their memberships ACTIVE, so a graduate still sat on the roster of an
-- archived team. Graduating now ends the membership as it queues the player.
-- Nothing else about the player moves -- same player_id, same club, same
-- history, same fixtures played, same attendance, same audit trail. Only the
-- team membership changes, and the ended row stays for history.
--
-- TELLING TWO SILENCES APART
--
-- resolve_normal_operational_identity ended with a single catch-all when no
-- identity matched a player's regulatory age, and it was covering two
-- genuinely different situations:
--
--   * League Girls U17 -- the age grade exists in the pathway, but the 2026
--     Girls competition runs no U17 division. A real open question, and one
--     the product owner has said must stay open rather than be guessed.
--
--   * Union U19 -- the player has aged out. The pathway has ENDED. There is
--     nothing to decide about which youth team they join, because there is no
--     longer a youth pathway for them to be in.
--
-- Reporting both as NEEDS_ATTENTION made a routine, expected, every-season
-- event look like an unresolved problem, and buried the genuine one among
-- them. They are now separated by asking the canonical directory itself what
-- the highest youth age grade offered for this code and sex is: past it, the
-- pathway has terminated (CLUB_HOLDING); short of it, a grade is genuinely
-- missing and the question stays open (NEEDS_ATTENTION).
--
-- No adult team is ever proposed. An 18-year-old is eligible for adult rugby,
-- but eligibility is not placement, and the club decides who plays senior
-- rugby.

-- ============================================================
-- 1. Vocabulary.
-- ============================================================

alter table public.age_grade_rollover_player_proposals
  drop constraint if exists rollover_player_proposal_allocation_status_check;
alter table public.age_grade_rollover_player_proposals
  add constraint rollover_player_proposal_allocation_status_check
  check (allocation_status in ('NORMAL_PLACEMENT', 'NEEDS_ATTENTION', 'DOB_REQUIRED', 'CLUB_HOLDING'));

alter table public.age_grade_rollover_team_proposals
  drop constraint if exists age_grade_rollover_team_proposals_decision_check;
alter table public.age_grade_rollover_team_proposals
  add constraint age_grade_rollover_team_proposals_decision_check
  check (decision in ('pending', 'confirmed', 'folded', 'deferred', 'graduated'));

comment on constraint age_grade_rollover_team_proposals_decision_check
  on public.age_grade_rollover_team_proposals is
  'graduated is distinct from folded: a folded squad is one the club is discontinuing, and its future fixtures are cancelled; a graduated cohort simply reached the end of the youth pathway and its players move to club holding.';

-- ============================================================
-- 2. The end of the pathway is not the same as a missing grade.
-- ============================================================

create or replace function internal.highest_youth_age_offered(p_rugby_code text, p_gender text)
returns integer
language sql stable
as $function$
  select max(nullif(regexp_replace(v.age_group, '\D', '', 'g'), '')::integer)
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code
    and v.is_offered
    and v.category = 'youth'
    and v.age_group is not null
    and (v.gender is not distinct from coalesce(nullif(p_gender, ''), 'boys') or v.gender = 'mixed');
$function$;

comment on function internal.highest_youth_age_offered(text, text) is
  'The last age grade the youth pathway offers for this code and sex, read from the canonical directory. Past it a player has aged out; short of it, a missing grade is a genuine gap.';

create or replace function public.resolve_normal_operational_identity(
  p_rugby_code text, p_season_id uuid, p_date_of_birth date, p_gender text
) returns table (
  regulatory_age_label text, regulatory_status text, canonical_team_type_id uuid,
  canonical_key text, canonical_label text, allocation_status text, reason text
)
language plpgsql stable
as $function$
declare
  r record;
  v_gender text := coalesce(nullif(p_gender, ''), 'boys');
  v_id uuid; v_key text; v_label text; v_age_group text;
  v_top integer;
begin
  select * into r from public.resolve_player_regulatory_age(p_rugby_code, p_season_id, p_date_of_birth);

  -- An adult is not an unsolved youth-pathway problem. The age resolver stops
  -- returning a grade past U19 and reports ADULT, which is the same event as
  -- ageing out of the last offered grade: the player has left youth rugby.
  -- Both routes end in club holding.
  if r.status = 'ADULT' then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLUB_HOLDING'::text,
      format('This player is past every age grade in the %s youth pathway. They move to the club''s holding list as a free agent, keeping their place at the club, and an authorised person can assign them to an adult team through the ordinary placement workflow. Ovalball does not put a player into adult rugby automatically.',
        case p_rugby_code when 'union' then 'Union' else 'League' end);
    return;
  end if;

  if r.status <> 'RESOLVED' then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      case r.status when 'DOB_REQUIRED' then 'DOB_REQUIRED' else 'NEEDS_ATTENTION' end, r.reason;
    return;
  end if;

  -- Mixed rugby: both codes end it at U12, so below that a mixed identity is
  -- the normal one and at U12 and above the player needs a sexed identity.
  if v_gender = 'mixed' and r.regulatory_age_number >= 12 then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'NEEDS_ATTENTION'::text,
      'Mixed rugby ends at U12 in both codes, so this player needs a boys or girls identity from this age grade onward. That is a decision, not something Ovalball should pick.';
    return;
  end if;

  -- EXACT match first, in every code and for every sex.
  select v.id, v.key, v.label into v_id, v_key, v_label
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code and v.is_offered and v.category = 'youth'
    and v.age_group = r.regulatory_age_label
    and v.gender is not distinct from v_gender;

  if v_id is not null then
    return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
      format('Regulatory age %s maps directly onto the %s identity this club can run.', r.regulatory_age_label, v_label);
    return;
  end if;

  -- Union girls play in dual bands (U12/U11, U14/U13, U16/U15, U18/U17), so an
  -- odd regulatory age resolves onto the band above it. Reg 15.6.
  if p_rugby_code = 'union' and v_gender = 'girls' and r.regulatory_age_number between 11 and 17 then
    v_age_group := 'U' || (r.regulatory_age_number + (r.regulatory_age_number % 2))::text;
    select v.id, v.key, v.label into v_id, v_key, v_label
    from public.canonical_team_types_by_code v
    where v.rugby_code = p_rugby_code and v.is_offered and v.category = 'youth'
      and v.age_group = v_age_group and v.gender = 'girls';
    if v_id is not null then
      return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
        format('Union girls play in dual age bands (RFU Regulation 15.6), so a %s player is a %s player: regulatory age %s, band %s.',
          r.regulatory_age_label, v_label, r.regulatory_age_label, v_age_group);
      return;
    end if;
  end if;

  -- PATHWAY TERMINATED. The player has aged past the last youth grade this
  -- code and sex offers. This is the ordinary end of a rugby childhood, not a
  -- problem to resolve: they move to the club's holding state and an
  -- authorised person places them later. Ovalball never assigns adult rugby
  -- on its own -- being old enough is not the same as being selected.
  v_top := internal.highest_youth_age_offered(p_rugby_code, v_gender);
  if v_top is not null and r.regulatory_age_number > v_top then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'CLUB_HOLDING'::text,
      format('This player is %s and has come to the end of the %s youth pathway, which runs to U%s. They move to the club''s holding list as a free agent, keeping their place at the club, and an authorised person can assign them to an adult team through the ordinary placement workflow. Ovalball does not put a player into adult rugby automatically.',
        r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end, v_top);
    return;
  end if;

  -- A grade genuinely missing from the middle of the pathway. This is the
  -- League Girls U17 case: the regulatory age exists (RFL F13 lists Under 17s)
  -- but the 2026 Girls League has no U17 division, and eligibility to play up
  -- is NOT the same as automatic placement. Say so; do not invent a team.
  return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
    'NEEDS_ATTENTION'::text,
    format('This player''s regulatory age is %s, but %s rugby offers no operational team at that age grade for this player. A placement decision is required -- Ovalball will not manufacture an identity the competition does not run, nor silently place the player in a different age grade.',
      r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end);
end;
$function$;

-- ============================================================
-- 3. Graduating puts the player into holding for real.
-- ============================================================

create or replace function internal.graduate_team_core(p_team_id uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  t public.teams;
  v_season_name text;
  v_archive_label text;
  v_queued_count integer := 0;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if not t.active then raise exception 'This team is already inactive.'; end if;

  if internal.next_age_grade_for(t.age_group, t.gender, t.rugby_code) is not null then
    raise exception 'This cohort still has a next age grade (%). Use the ordinary Season Rollover decision (Confirm/Adjust/Fold/Defer) instead of graduating it.',
      internal.next_age_grade_for(t.age_group, t.gender, t.rugby_code)
      using errcode = 'P0001';
  end if;
  if t.category <> 'youth' then
    raise exception 'Only a youth cohort can be graduated. Senior teams persist season to season.' using errcode = 'P0001';
  end if;

  select name into v_season_name from public.seasons where id = internal.resolve_season_for_date(t.rugby_code, current_date);
  v_archive_label := trim(t.display_name) || coalesce(' (' || v_season_name || ')', '') || ' Archive';

  update public.teams
  set active = false, archived_at = now(), archived_by = p_actor, display_name = v_archive_label
  where id = p_team_id;

  insert into public.player_graduation_queue (player_id, source_team_id, club_id)
  select ptm.player_id, t.id, t.club_id
  from public.player_team_memberships ptm
  where ptm.team_id = t.id and ptm.status = 'active'
  on conflict do nothing;
  get diagnostics v_queued_count = row_count;

  -- Holding means no active team place. Leaving the membership active kept a
  -- graduate on the roster of an archived cohort. The row stays, ended and
  -- dated, so the player's history with that team is intact.
  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = p_actor
  where team_id = p_team_id and status = 'active';

  return v_queued_count;
end;
$function$;

create or replace function public.graduate_team(p_team_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare t public.teams;
begin
  select * into t from public.teams where id = p_team_id;
  if not found then raise exception 'Team not found.'; end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may graduate a cohort.' using errcode = '42501';
  end if;
  return internal.graduate_team_core(p_team_id, auth.uid());
end;
$function$;

-- ============================================================
-- 4. Graduate is a handover decision.
-- ============================================================

create or replace function internal.confirm_rollover_team_proposal_core(
  p_proposal_id uuid, p_action text, p_age_group text, p_squad_designation text,
  p_fold_reason text, p_gender text, p_decided_by uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
  v_team public.teams;
  v_squad text;
  v_dest_type uuid;
  v_primary_name text;
  v_constraint text;
  v_message text;
  v_intake_id uuid;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if p.is_mixed_boundary then
    raise exception 'This is a Mixed U11 -> U12 structural transition. Use the dedicated Girls-team decision flow, not the ordinary Confirm/Adjust path.' using errcode = 'P0001';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%).', p.decision;
  end if;
  if p_action not in ('confirm', 'adjust', 'fold', 'defer', 'graduate') then
    raise exception 'Unknown rollover action: %', p_action;
  end if;
  if p_gender is not null and p_gender not in ('boys', 'girls') then
    raise exception 'gender must be boys or girls for a youth rollover destination.';
  end if;

  if p_action = 'confirm' or p_action = 'adjust' then
    v_final_age_group := coalesce(p_age_group, p.proposed_age_group);
    if v_final_age_group is null then
      raise exception 'A destination age group is required -- this team''s rollover has no automatic mapping and needs an explicit choice.';
    end if;
    select * into v_team from public.teams where id = p.team_id;

    v_squad := coalesce(p_squad_designation, v_team.squad_designation);
    v_dest_type := internal.resolve_canonical_team_type(
      v_team.category, v_final_age_group, coalesce(p_gender, v_team.gender), v_squad);

    if v_team.category = 'youth' and v_squad in ('B', 'C') then
      if not exists (
        select 1 from public.teams pt
        where pt.club_id = v_team.club_id
          and pt.canonical_team_type_id = v_dest_type
          and pt.squad_designation is null
          and pt.active
          and pt.id <> v_team.id
      ) then
        select t.display_name into v_primary_name
        from public.age_grade_rollover_team_proposals pp
        join public.teams t on t.id = pp.team_id
        where pp.rollover_id = p.rollover_id
          and pp.decision = 'pending'
          and t.club_id = v_team.club_id
          and t.squad_designation is null
          and t.active
          and t.canonical_team_type_id = v_team.canonical_team_type_id
        limit 1;

        if v_primary_name is not null then
          raise exception 'Confirm % first. A % squad moves up with its primary team, so % has to reach % before this squad can.',
            v_primary_name, v_squad, v_primary_name, v_final_age_group
            using errcode = 'P0001';
        else
          raise exception 'This club has no primary team at %. A % squad cannot sit at a level on its own -- roll the primary team up to % first, or use Adjust to move this squad somewhere it has one.',
            v_final_age_group, v_squad, v_final_age_group
            using errcode = 'P0001';
        end if;
      end if;
    end if;

    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;

    begin
      update public.teams
      set age_group = v_final_age_group,
          squad_designation = coalesce(p_squad_designation, squad_designation),
          gender = coalesce(p_gender, gender)
      where id = p.team_id;
    exception
      when unique_violation then
        select t.display_name into v_primary_name
        from public.age_grade_rollover_team_proposals pp
        join public.teams t on t.id = pp.team_id
        where pp.rollover_id = p.rollover_id
          and pp.decision = 'pending'
          and t.club_id = v_team.club_id
          and t.active
          and t.id <> v_team.id
          and t.canonical_team_type_id = v_dest_type
          and coalesce(t.squad_designation, '') = coalesce(v_squad, '')
        limit 1;

        if v_primary_name is not null then
          raise exception 'Confirm % first. It still holds the % place and has not moved up yet -- once it does, this team can take it.',
            v_primary_name, v_final_age_group using errcode = 'P0001';
        end if;

        raise exception 'This club already has a team at % with the same squad designation and gender. Use Adjust and choose a different squad letter (e.g. a "B" squad) to roll this team forward.', v_final_age_group;
      when check_violation then
        get stacked diagnostics
          v_constraint = constraint_name,
          v_message = message_text;
        if v_constraint = 'teams_gender_category_check' then
          raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).';
        elsif v_constraint = 'teams_age_group_check' then
          raise exception '% is not an age group Ovalball recognises.', v_final_age_group;
        elsif v_constraint = 'teams_active_squad_designation_valid' then
          raise exception 'A squad letter is only valid on a youth team, and only B or C.';
        elsif v_constraint is null or v_constraint = '' then
          raise exception '%', v_message using errcode = 'P0001';
        else
          raise exception 'That destination is not valid for this team (%).', v_constraint;
        end if;
    end;

    -- PRODUCT RULE: a U6 cohort that has moved up leaves the intake slot
    -- empty, and the incoming starters need a team.
    if p.current_age_group = 'U6'
       and v_final_age_group <> 'U6'
       and v_team.squad_designation is null
       and not p.intake_team_created then
      v_intake_id := internal.provision_intake_team(
        p_proposal_id, v_team.club_id, v_team.rugby_code, v_team.gender, p_decided_by);

      update public.age_grade_rollover_team_proposals
      set intake_team_created = true, intake_team_id = v_intake_id
      where id = p_proposal_id;

      if r.to_season_id is not null then
        insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
        select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
        from public.teams where id = v_intake_id
        on conflict (team_id, season_id) do nothing;
      end if;
    end if;

    if r.to_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = p.team_id
      on conflict (team_id, season_id) do nothing;
    end if;

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', p_decided_by,
      jsonb_build_object('age_group', p.current_age_group),
      jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id,
                         'intake_team_id', v_intake_id));
    update public.age_grade_rollover_team_proposals
      set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = p_decided_by, decided_at = now()
      where id = p_proposal_id;

  elsif p_action = 'graduate' then
    -- End of the youth pathway. The cohort is archived and its players move to
    -- the club's holding list -- no adult team is assigned by Ovalball.
    --
    -- Graduating archives a team and empties it, which public.graduate_team
    -- holds to Club Admin. confirm_rollover_team_proposal admits anyone who
    -- can manage club fixtures, so without this check reaching graduation
    -- through the handover would hand a Fixture Secretary an authority the
    -- direct route denies them. The automatic transition processor never takes
    -- this branch: a cohort with no successor is requires_manual_choice and is
    -- skipped by auto-confirm.
    select * into v_team from public.teams where id = p.team_id;
    if not (internal.is_club_admin(v_team.club_id) or internal.is_full_site_admin()) then
      raise exception 'Only this club''s Club Admin or a Full Site Admin may graduate a cohort. Graduating archives the team and moves every player to the club''s holding list.'
        using errcode = '42501';
    end if;
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;

    perform internal.graduate_team_core(p.team_id, p_decided_by);

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', p_decided_by,
      jsonb_build_object('age_group', p.current_age_group),
      jsonb_build_object('event', 'GRADUATED_AT_HANDOVER', 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals
      set decision = 'graduated', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;

  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals
      set decision = 'folded', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals
      set decision = 'deferred', decided_by = p_decided_by, decided_at = now() where id = p_proposal_id;
  end if;
end;
$function$;

-- ============================================================
-- 5. The player proposal reports holding as a normal outcome.
-- ============================================================

create or replace function internal.generate_rollover_player_proposals_core(p_rollover_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  m record;
  v_reg record;
  v_norm record;
  v_move record;
  v_disp record;
  v_proposed_team uuid;
  v_proposed_type uuid;
  v_review text;
  v_reason text;
  v_disp_outcome text;
  v_move_req text;
  v_count integer := 0;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then raise exception 'Rollover not found.'; end if;

  for m in
    select ptm.id as membership_id, ptm.player_id, ptm.team_id,
           p.date_of_birth, t.gender, t.rugby_code,
           tp.proposed_age_group, tp.proposed_to_canonical_team_type_id, tp.requires_manual_choice
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    join public.players p on p.id = ptm.player_id
    left join public.age_grade_rollover_team_proposals tp
      on tp.rollover_id = r.id and tp.team_id = ptm.team_id
    where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
      and ptm.status = 'active' and t.category = 'youth'
  loop
    v_proposed_team := null; v_proposed_type := m.proposed_to_canonical_team_type_id;
    v_review := 'READY'; v_reason := null; v_disp_outcome := null; v_move_req := null;

    -- DOB is read here and nowhere else; it is not carried into the row.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.gender);

    if v_norm.canonical_team_type_id is not null then
      select t2.id into v_proposed_team
      from public.teams t2
      where t2.club_id = r.club_id and t2.rugby_code = r.rugby_code
        and t2.canonical_team_type_id = v_norm.canonical_team_type_id and t2.active
      order by t2.squad_designation nulls first
      limit 1;
    end if;

    select * into v_disp
    from public.player_team_dispensation d
    where d.player_id = m.player_id and d.status = 'approved'
      and d.season_id is distinct from r.to_season_id
    order by d.created_at desc
    limit 1;

    if v_disp.id is not null then
      if v_norm.allocation_status = 'NORMAL_PLACEMENT'
         and v_norm.canonical_team_type_id is not null
         and v_proposed_team is not null then
        v_disp_outcome := 'NO_LONGER_REQUIRED';
      else
        v_disp_outcome := 'EXPIRES_AT_SEASON_BOUNDARY';
      end if;
    end if;

    if v_proposed_team is not null and v_proposed_team is distinct from m.team_id then
      select * into v_move from internal.resolve_player_movement_eligibility(
        r.rugby_code, current_date, m.date_of_birth, m.team_id, v_proposed_team);
      v_move_req := v_move.requirement;
    end if;

    if v_norm.allocation_status = 'DOB_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'This player has no recorded date of birth, so their age grade for the target season cannot be established. It must never be inferred from the team they currently play for. Obtain the date of birth through the normal protected profile process.';
    elsif v_norm.allocation_status = 'CLUB_HOLDING' then
      -- The expected end of a rugby childhood, not an exception. Checked
      -- before the "no team" branch below, which would otherwise report the
      -- absence of a youth team as a problem to solve.
      v_review := 'READY';
      v_reason := v_norm.reason;
    elsif v_norm.allocation_status = 'NEEDS_ATTENTION' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := v_norm.reason;
    elsif v_proposed_team is null then
      v_review := 'NEEDS_ATTENTION';
      v_reason := format('The normal team for this player next season is %s, but this club does not currently run it. Activate that team, or place the player through the ordinary workflow.',
                         coalesce(v_norm.canonical_label, 'unresolved'));
    elsif v_move_req in ('not_permitted','external_approval_required') then
      v_review := 'NEEDS_ATTENTION';
      v_reason := coalesce(v_move.reason, 'This placement needs approval beyond the club.');
    elsif m.requires_manual_choice then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'The team itself has no automatic successor for the target season, so this player''s placement follows that review rather than rolling forward on its own.';
    else
      v_review := 'READY';
    end if;

    insert into public.age_grade_rollover_player_proposals (
      rollover_id, player_id, current_team_id, current_membership_id,
      proposed_team_id, proposed_canonical_team_type_id,
      regulatory_age_label, regulatory_status, normal_canonical_team_type_id,
      allocation_status, movement_requirement, dispensation_id, dispensation_outcome,
      review_state, reason
    ) values (
      r.id, m.player_id, m.team_id, m.membership_id,
      v_proposed_team, coalesce(v_proposed_type, v_norm.canonical_team_type_id),
      v_reg.regulatory_age_label, v_reg.status, v_norm.canonical_team_type_id,
      v_norm.allocation_status, v_move_req, v_disp.id, v_disp_outcome,
      v_review, v_reason
    )
    on conflict (rollover_id, player_id, current_team_id) do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$function$;

do $$
declare v_alloc text; v_reason text; v_top integer;
begin
  v_top := internal.highest_youth_age_offered('union', 'boys');
  if v_top <> 18 then raise exception 'Union boys youth pathway should end at U18, got U%', v_top; end if;
  v_top := internal.highest_youth_age_offered('union', 'girls');
  if v_top <> 18 then raise exception 'Union girls youth pathway should end at U18, got U%', v_top; end if;
  v_top := internal.highest_youth_age_offered('league', 'boys');
  if v_top <> 19 then raise exception 'League boys youth pathway should end at U19, got U%', v_top; end if;

  select allocation_status, reason into v_alloc, v_reason
  from public.resolve_normal_operational_identity(
    'union',
    (select id from public.seasons where rugby_code = 'union' and not is_regression_fixture order by starts_on desc limit 1),
    (current_date - interval '18 years 2 months')::date, 'boys');
  if v_alloc <> 'CLUB_HOLDING' then
    raise exception 'A Union player past U18 should resolve to CLUB_HOLDING, got %', v_alloc;
  end if;
  if v_reason ~* 'Men''s 1st|senior|adult team' and v_reason !~* 'does not put a player into adult rugby automatically' then
    raise exception 'The holding reason should not read as an adult team assignment.';
  end if;

  -- The other route to the same event: past U19 the age resolver reports ADULT
  -- rather than a grade, and that must also land in holding.
  select allocation_status into v_alloc
  from public.resolve_normal_operational_identity(
    'union',
    (select id from public.seasons where rugby_code = 'union' and not is_regression_fixture order by starts_on desc limit 1),
    (current_date - interval '21 years')::date, 'boys');
  if v_alloc <> 'CLUB_HOLDING' then
    raise exception 'An adult past every youth grade should resolve to CLUB_HOLDING, got %', v_alloc;
  end if;
end $$;
