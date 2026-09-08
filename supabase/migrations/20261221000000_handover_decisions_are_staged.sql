-- Deciding a handover is not doing it.
--
-- WHAT WAS WRONG
--
-- The product rule is "nothing changes until you apply the handover". The
-- implementation contradicted it twice over:
--
--   confirm_rollover_team_proposal  updated public.teams the instant a Club
--                                   Admin pressed Confirm.
--   confirm_mixed_boundary_rollover created the Girls team there and then.
--   provision_missing_placement_team created a live team during review.
--
-- Two consequences followed, and both showed up in browser UAT. A confirmed
-- decision could not be undone, because it was not a decision -- it had
-- already happened. And "Add the missing team" could not create next season's
-- U12 while this season's U12 was still called U12: the club's own current
-- side held the identity, and it only lets go of it when the handover runs.
--
-- Those are the same defect. The handover was never staged.
--
-- THE MODEL
--
--   PREPARE   proposals are generated
--   DECIDE    a human records what should happen -- and only records it
--   REVIEW    decisions can be changed, undone, re-chosen
--   APPLY     the operational mutation happens, once, in one transaction
--
-- This migration is the DECIDE half: every decision path stops mutating.
-- 20261222000000 builds the Apply boundary that carries them out.
--
-- WHAT A DECISION NOW NEEDS TO CARRY
--
-- Because the mutation no longer happens immediately, everything Apply will
-- need has to survive on the decision row: the squad letter and gender that
-- were chosen, the fold reason, the answer to the Girls-team question. Those
-- used to live only in the mutated team, which is precisely why the decision
-- was not a decision.
--
-- PLANNED TEAMS
--
-- "The club should run a U12 next season" is a decision like any other, so it
-- is recorded like any other -- in the handover's own tables, referencing the
-- one canonical Team Directory. It is emphatically NOT a second team
-- catalogue: a planned row has no slug, no fixtures, no memberships, no
-- identity of its own. It names a canonical_team_type_id and a squad letter,
-- and at Apply it becomes exactly one real team (or reactivates one).
--
-- COLLISIONS GET SIMPLER, NOT HARDER
--
-- The old code discovered a collision by attempting the UPDATE and catching
-- the unique violation, which is why the club had to "Confirm U15 first" before
-- U15 B would move: the primary really was still sitting in the U16 slot.
--
-- Staged, that ordering constraint disappears. Nothing is sitting anywhere
-- yet. A collision now means two teams are *planned* to hold the same
-- identity next season, which is a genuine clash a human must resolve -- and a
-- team that has not been decided yet is not a clash, it is just undecided.

-- ---------------------------------------------------------------------------
-- 1. What a decision has to remember
-- ---------------------------------------------------------------------------

alter table public.age_grade_rollover_team_proposals
  add column if not exists decided_squad_designation text,
  add column if not exists decided_gender text,
  add column if not exists fold_reason text,
  add column if not exists create_girls_team boolean,
  add column if not exists girls_squad_designation text,
  add column if not exists applied_at timestamptz;

comment on column public.age_grade_rollover_team_proposals.decided_squad_designation is
  'The squad letter chosen at decision time. Before staging this lived only in the team row that Confirm had already mutated.';
comment on column public.age_grade_rollover_team_proposals.create_girls_team is
  'The club''s answer to the Mixed-split question. The Girls team itself is created at Apply, not here.';
comment on column public.age_grade_rollover_team_proposals.applied_at is
  'When this decision was actually carried out. Null means decided but not yet applied.';

alter table public.age_grade_rollovers
  add column if not exists decisions_revision integer not null default 0,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid references auth.users(id);

comment on column public.age_grade_rollovers.decisions_revision is
  'Bumped by every human decision. Apply may be asked to reject a set of decisions that changed after the reviewer read them.';

-- ---------------------------------------------------------------------------
-- 2. Planned teams -- staged provisioning inside the handover domain
-- ---------------------------------------------------------------------------

create table if not exists public.age_grade_rollover_planned_teams (
  id uuid primary key default gen_random_uuid(),
  rollover_id uuid not null references public.age_grade_rollovers(id) on delete cascade,
  canonical_team_type_id uuid not null references public.canonical_team_types(id),
  squad_designation text,
  origin text not null check (origin in ('U6_INTAKE', 'PLAYER_PLACEMENT', 'MIXED_SPLIT')),
  source_team_id uuid references public.teams(id),
  source_proposal_id uuid references public.age_grade_rollover_team_proposals(id) on delete cascade,
  planned_by uuid references auth.users(id),
  planned_at timestamptz not null default now(),
  created_team_id uuid references public.teams(id),
  reactivated boolean not null default false,
  applied_at timestamptz
);

comment on table public.age_grade_rollover_planned_teams is
  'A team the club has decided to run next season, recorded as a decision. Becomes exactly one real team at Apply. Not a team catalogue: it holds a canonical_team_type_id from the one Team Directory and nothing else.';
comment on column public.age_grade_rollover_planned_teams.source_team_id is
  'Where this cohort''s staff come from when the team is created at Apply. A progressing team keeps its own id and needs no copy.';

create unique index if not exists rollover_planned_team_identity_idx
  on public.age_grade_rollover_planned_teams
     (rollover_id, canonical_team_type_id, coalesce(squad_designation, ''));

alter table public.age_grade_rollover_planned_teams enable row level security;

drop policy if exists rollover_planned_teams_select on public.age_grade_rollover_planned_teams;
create policy rollover_planned_teams_select on public.age_grade_rollover_planned_teams
  for select using (
    exists (
      select 1 from public.age_grade_rollovers r
      where r.id = rollover_id
        and (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin())
    )
  );

alter table public.age_grade_rollover_player_proposals
  add column if not exists planned_team_id uuid
    references public.age_grade_rollover_planned_teams(id) on delete set null;

comment on column public.age_grade_rollover_player_proposals.planned_team_id is
  'Where this player goes when the team they need does not exist yet. Resolved to a real team at Apply.';

-- ---------------------------------------------------------------------------
-- 3. One resolver for "what will this team BE after the handover"
-- ---------------------------------------------------------------------------
--
-- Every collision check, every placement lookup and Apply itself needs the
-- same answer, and it must come from the DECISIONS rather than from a display
-- label or a date projection. A team inside this rollover is going wherever it
-- was decided to go; a team outside it is not moving in this handover at all.

create or replace function internal.rollover_team_target_identity(
  p_rollover_id uuid, p_team_id uuid
) returns table(
  canonical_team_type_id uuid, squad_designation text, age_group text,
  gender text, label text, continues boolean, is_decided boolean
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  t public.teams;
  v_age text;
  v_gender text;
  v_squad text;
begin
  select * into t from public.teams where id = p_team_id;
  if not found then return; end if;

  select * into p from public.age_grade_rollover_team_proposals
  where rollover_id = p_rollover_id and team_id = p_team_id;

  -- Not part of this handover, so it keeps the identity it has -- and keeps it
  -- for certain, which is why it counts as settled. Deliberately NOT projected
  -- forward: only the teams in this rollover are moving, and pretending
  -- otherwise would invent collisions that do not exist.
  if p.id is null then
    return query select t.canonical_team_type_id, t.squad_designation, t.age_group,
                        t.gender, t.display_name, t.active, true;
    return;
  end if;

  if p.decision in ('folded', 'graduated') then
    return query select null::uuid, null::text, null::text, null::text, null::text, false, true;
    return;
  end if;

  if p.decision = 'confirmed' then
    v_age := p.decided_age_group;
    v_gender := coalesce(p.decided_gender, t.gender);
    v_squad := coalesce(p.decided_squad_designation, t.squad_designation);
  elsif p.is_mixed_boundary then
    -- A Mixed U11 heading for U12 has NO determined identity until the club
    -- answers the split question. Resolving it now would land on the boys
    -- identity purely because no Mixed U12 exists, and every girl in the
    -- cohort would be quietly told her own side was her next team.
    return query select null::uuid, t.squad_designation, p.proposed_age_group,
                        null::text, t.display_name, true, false;
    return;
  else
    -- Pending or deferred. Not decided, so it cannot clash with anything yet,
    -- but where it is HEADED is still the best available answer for placement.
    v_age := coalesce(p.proposed_age_group, t.age_group);
    v_gender := t.gender;
    v_squad := t.squad_designation;
  end if;

  if v_age is null then
    return query select null::uuid, null::text, null::text, null::text, null::text, false, p.decision <> 'pending';
    return;
  end if;

  return query select
    internal.resolve_canonical_team_type('youth', v_age, v_gender, v_squad),
    v_squad, v_age, v_gender,
    internal.compute_team_display_name('youth', v_age, v_gender, v_squad),
    true,
    p.decision = 'confirmed';
end;
$function$;

comment on function internal.rollover_team_target_identity(uuid, uuid) is
  'The identity a team will hold once this handover is applied, read from the decision rather than from a label or a date projection.';

-- Every identity that will be occupied at the club once this handover applies:
-- teams that are moving, teams that are not, and teams the club has planned.
create or replace function internal.rollover_identity_plan(p_rollover_id uuid)
returns table(
  kind text, team_id uuid, planned_id uuid,
  canonical_team_type_id uuid, squad_designation text, label text, is_decided boolean
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare r public.age_grade_rollovers;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;

  return query
  select 'team', t.id, null::uuid, i.canonical_team_type_id, i.squad_designation,
         coalesce(i.label, t.display_name), i.is_decided
  from public.teams t
  cross join lateral internal.rollover_team_target_identity(p_rollover_id, t.id) i
  where t.club_id = r.club_id and t.active and i.continues
    and i.canonical_team_type_id is not null;

  return query
  select 'planned', null::uuid, pt.id, pt.canonical_team_type_id, pt.squad_designation,
         ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end,
         true
  from public.age_grade_rollover_planned_teams pt
  join public.canonical_team_types ctt on ctt.id = pt.canonical_team_type_id
  where pt.rollover_id = p_rollover_id and pt.applied_at is null;
end;
$function$;

comment on function internal.rollover_identity_plan(uuid) is
  'Every canonical identity the club will occupy after this handover applies. Two entries sharing one identity is a real collision; an undecided team is not a collision, it is undecided.';

-- ---------------------------------------------------------------------------
-- 4. Confirm / Adjust / Fold / Defer / Graduate become decisions
-- ---------------------------------------------------------------------------

create or replace function internal.decide_rollover_team_proposal(
  p_proposal_id uuid, p_action text, p_age_group text, p_squad_designation text,
  p_fold_reason text, p_gender text, p_decided_by uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_team public.teams;
  v_final_age_group text;
  v_squad text;
  v_gender text;
  v_dest_type uuid;
  v_clash record;
  v_primary_name text;
  v_intake_type uuid;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;

  if r.applied_at is not null then
    raise exception 'This handover has already been applied. Season decisions are read-only once the handover has run -- a correction is a separate operational change.'
      using errcode = 'P0001';
  end if;
  if p.is_mixed_boundary then
    raise exception 'This is a Mixed U11 -> U12 structural transition. Use the dedicated Girls-team decision flow, not the ordinary Confirm/Adjust path.' using errcode = 'P0001';
  end if;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%). Undo that decision first if it needs to change.', p.decision;
  end if;
  if p_action not in ('confirm', 'adjust', 'fold', 'defer', 'graduate') then
    raise exception 'Unknown rollover action: %', p_action;
  end if;
  if p_gender is not null and p_gender not in ('boys', 'girls') then
    raise exception 'gender must be boys or girls for a youth rollover destination.';
  end if;

  select * into v_team from public.teams where id = p.team_id;

  if p_action in ('confirm', 'adjust') then
    v_final_age_group := coalesce(p_age_group, p.proposed_age_group);
    if v_final_age_group is null then
      raise exception 'A destination age group is required -- this team''s rollover has no automatic mapping and needs an explicit choice.';
    end if;

    v_squad := coalesce(p_squad_designation, v_team.squad_designation);
    v_gender := coalesce(p_gender, v_team.gender);
    v_dest_type := internal.resolve_canonical_team_type(v_team.category, v_final_age_group, v_gender, v_squad);
    if v_dest_type is null then
      raise exception 'Ovalball has no canonical identity for a % % team, so this destination cannot be recorded.',
        coalesce(v_gender, 'youth'), v_final_age_group using errcode = 'P0001';
    end if;

    perform internal.assert_rollover_destination_valid(v_team, v_final_age_group, v_gender, v_squad);

    -- A B or C squad cannot sit at a level on its own. Judged against the
    -- PLAN, not against today: the primary is allowed to still be sitting at
    -- U15 right now, as long as it is heading for U16 too.
    if v_team.category = 'youth' and v_squad in ('B', 'C') then
      if not exists (
        select 1 from internal.rollover_identity_plan(p.rollover_id) ip
        where ip.canonical_team_type_id = internal.resolve_canonical_team_type(
                v_team.category, v_final_age_group, v_gender, null)
          and ip.squad_designation is null
      ) then
        raise exception 'This club has no primary team heading for %. A % squad cannot sit at a level on its own -- decide the primary team''s destination first, or use Adjust to move this squad somewhere it has one.',
          v_final_age_group, v_squad using errcode = 'P0001';
      end if;
    end if;

    -- A real clash: something ELSE is already planned to be this identity.
    select ip.* into v_clash from internal.rollover_identity_plan(p.rollover_id) ip
    where ip.canonical_team_type_id = v_dest_type
      and coalesce(ip.squad_designation, '') = coalesce(v_squad, '')
      and (ip.team_id is distinct from p.team_id)
      and ip.is_decided
    limit 1;

    if v_clash.kind is not null then
      raise exception 'Something else is already going to be % next season (%). Two teams cannot hold one identity -- change that decision or choose a different squad letter for this one.',
        internal.compute_team_display_name(v_team.category, v_final_age_group, v_gender, v_squad),
        v_clash.label using errcode = 'P0001';
    end if;

    update public.age_grade_rollover_team_proposals
    set decision = 'confirmed',
        decided_age_group = v_final_age_group,
        decided_squad_designation = v_squad,
        decided_gender = v_gender,
        decided_canonical_team_type_id = v_dest_type,
        decided_by = p_decided_by,
        decided_at = now()
    where id = p_proposal_id;

    -- PRODUCT RULE: a U6 cohort that moves up leaves the intake slot empty and
    -- the incoming starters need a team. Staged like every other consequence,
    -- so undoing the progression also withdraws the intake team.
    if p.current_age_group = 'U6' and v_final_age_group <> 'U6'
       and v_team.squad_designation is null then
      v_intake_type := internal.resolve_canonical_team_type('youth', 'U6', v_team.gender, null);
      if v_intake_type is null then
        raise exception 'There is no canonical U6 identity for this code and gender, so no intake team can be planned.'
          using errcode = 'P0001';
      end if;
      insert into public.age_grade_rollover_planned_teams
        (rollover_id, canonical_team_type_id, squad_designation, origin, source_team_id, source_proposal_id, planned_by)
      values (p.rollover_id, v_intake_type, null, 'U6_INTAKE', v_team.id, p_proposal_id, p_decided_by)
      on conflict (rollover_id, canonical_team_type_id, coalesce(squad_designation, '')) do nothing;
    end if;

  elsif p_action = 'graduate' then
    -- End of the youth pathway. Archiving a cohort and emptying it is held to
    -- Club Admin wherever it is reached from, so the handover route cannot
    -- hand a Fixture Secretary an authority the direct route denies them.
    if not (internal.is_club_admin(v_team.club_id) or internal.is_full_site_admin()) then
      raise exception 'Only this club''s Club Admin or a Full Site Admin may graduate a cohort. Graduating archives the team and moves every player to the club''s holding list.'
        using errcode = '42501';
    end if;
    if internal.next_age_grade_for(v_team.age_group, v_team.gender, v_team.rugby_code) is not null then
      raise exception 'This cohort still has a next age grade (%). Use the ordinary handover decision instead of graduating it.',
        internal.next_age_grade_for(v_team.age_group, v_team.gender, v_team.rugby_code) using errcode = 'P0001';
    end if;
    if v_team.category <> 'youth' then
      raise exception 'Only a youth cohort can be graduated. Senior teams persist season to season.' using errcode = 'P0001';
    end if;

    update public.age_grade_rollover_team_proposals
    set decision = 'graduated', decided_by = p_decided_by, decided_at = now()
    where id = p_proposal_id;

  elsif p_action = 'fold' then
    if coalesce(trim(p_fold_reason), '') = '' then
      raise exception 'A reason is required to fold a team.';
    end if;
    if not (internal.is_club_admin(v_team.club_id) or internal.is_full_site_admin()) then
      raise exception 'Only this club''s Club Admin or a Full Site Admin may fold a team.' using errcode = '42501';
    end if;
    update public.age_grade_rollover_team_proposals
    set decision = 'folded', fold_reason = trim(p_fold_reason),
        decided_by = p_decided_by, decided_at = now()
    where id = p_proposal_id;

  else
    update public.age_grade_rollover_team_proposals
    set decision = 'deferred', decided_by = p_decided_by, decided_at = now()
    where id = p_proposal_id;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('age_grade_rollover_team_proposals', p_proposal_id, 'update', p_decided_by,
    jsonb_build_object('decision', p.decision),
    jsonb_build_object('event', 'HANDOVER_TEAM_DECISION_RECORDED', 'rollover_id', p.rollover_id,
                       'team_id', p.team_id, 'action', p_action,
                       'decided_age_group', v_final_age_group,
                       'decided_squad_designation', v_squad,
                       'target_season_id', r.to_season_id));

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = p.rollover_id;
end;
$function$;

comment on function internal.decide_rollover_team_proposal(uuid, text, text, text, text, text, uuid) is
  'Records what should happen to a team next season. Mutates nothing operational -- Apply does that.';

-- The destination checks that used to be discovered by catching the failed
-- UPDATE. Staged, there is no UPDATE to fail, so they are asserted directly.
create or replace function internal.assert_rollover_destination_valid(
  p_team public.teams, p_age_group text, p_gender text, p_squad text
) returns void
language plpgsql stable
as $function$
begin
  if p_age_group not in ('U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18','U19','JuniorColts','SeniorColts') then
    raise exception '% is not an age group Ovalball recognises.', p_age_group using errcode = 'P0001';
  end if;
  if p_squad is not null and (p_team.category <> 'youth' or p_squad not in ('B','C')) then
    raise exception 'A squad letter is only valid on a youth team, and only B or C.' using errcode = 'P0001';
  end if;
  if p_gender = 'mixed' and p_age_group not in ('U6','U7','U8','U9','U10','U11') then
    raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).'
      using errcode = 'P0001';
  end if;
  if p_gender = 'girls' and p_team.rugby_code = 'union'
     and p_age_group not in ('U6','U7','U8','U9','U10','U11','U12','U14','U16','U18') then
    raise exception 'Union girls'' rugby runs in two-year age bands, so % is not a Girls age grade in this code.', p_age_group
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.confirm_rollover_team_proposal(
  p_proposal_id uuid, p_action text, p_age_group text default null,
  p_squad_designation text default null, p_fold_reason text default null, p_gender text default null
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_club_id uuid;
begin
  select r.club_id into v_club_id
  from public.age_grade_rollover_team_proposals p
  join public.age_grade_rollovers r on r.id = p.rollover_id
  where p.id = p_proposal_id;
  if v_club_id is null then raise exception 'Rollover proposal not found.'; end if;
  if not (internal.can_manage_club_fixtures(v_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide this rollover proposal.' using errcode = '42501';
  end if;
  perform internal.decide_rollover_team_proposal(
    p_proposal_id, p_action, p_age_group, p_squad_designation, p_fold_reason, p_gender, auth.uid());
end;
$function$;

comment on function public.confirm_rollover_team_proposal(uuid, text, text, text, text, text) is
  'Records a team handover decision. Since the staged commit model this changes NO live team -- the club''s teams are untouched until apply_season_handover runs.';

-- ---------------------------------------------------------------------------
-- 5. Undo, until Apply
-- ---------------------------------------------------------------------------

create or replace function public.undo_rollover_team_decision(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;

  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to change decisions for this club.' using errcode = '42501';
  end if;
  if r.applied_at is not null or p.applied_at is not null then
    raise exception 'This handover has already been applied, so this decision can no longer be undone here. Correcting an applied season is a separate operational change.'
      using errcode = 'P0001';
  end if;
  if p.decision = 'pending' then
    return;
  end if;

  -- Anything staged BECAUSE of this decision goes with it. A U6 intake team
  -- exists only because the U6 cohort was moved up; withdraw one, withdraw both.
  delete from public.age_grade_rollover_planned_teams
  where rollover_id = p.rollover_id and source_proposal_id = p_proposal_id and applied_at is null;

  update public.age_grade_rollover_team_proposals
  set decision = 'pending', decided_age_group = null, decided_squad_designation = null,
      decided_gender = null, decided_canonical_team_type_id = null, fold_reason = null,
      create_girls_team = null, girls_squad_designation = null,
      decided_by = null, decided_at = null
  where id = p_proposal_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('age_grade_rollover_team_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('decision', p.decision, 'decided_age_group', p.decided_age_group),
    jsonb_build_object('event', 'HANDOVER_TEAM_DECISION_WITHDRAWN', 'rollover_id', p.rollover_id, 'team_id', p.team_id));

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = p.rollover_id;
end;
$function$;

comment on function public.undo_rollover_team_decision(uuid) is
  'Returns a team decision to undecided. Possible precisely because deciding no longer mutates anything.';

create or replace function public.clear_rollover_player_placement(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;

  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to change placements for this club.' using errcode = '42501';
  end if;
  if p.placement_applied_at is not null or r.applied_at is not null then
    raise exception 'This placement has already been applied and can no longer be changed here.' using errcode = 'P0001';
  end if;

  update public.age_grade_rollover_player_proposals
  set selected_team_id = null, selected_canonical_team_type_id = null,
      selected_by = null, selected_at = null, override_kind = null
  where id = p_proposal_id;

  -- Back to whatever the club's decisions say should happen to this player.
  perform internal.refresh_rollover_player_proposals(p.rollover_id);

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('age_grade_rollover_player_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('selected_team_id', p.selected_team_id),
    jsonb_build_object('event', 'HANDOVER_PLACEMENT_WITHDRAWN', 'rollover_id', p.rollover_id, 'player_id', p.player_id));

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = p.rollover_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The Mixed split is decided, not performed
-- ---------------------------------------------------------------------------

create or replace function public.confirm_mixed_boundary_rollover(
  p_proposal_id uuid, p_create_girls_team boolean,
  p_boys_squad_designation text default null, p_girls_squad_designation text default null
) returns table(boys_team_id uuid, girls_team_id uuid)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  t public.teams;
  v_boys_squad text;
  v_girls_squad text;
  v_girls_type uuid;
  v_planned_id uuid;
begin
  if p_create_girls_team is null then
    raise exception 'You must explicitly answer whether to create a new Girls team (Yes or No) -- it cannot be left unanswered.';
  end if;

  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if not p.is_mixed_boundary then
    raise exception 'This proposal is not a Mixed structural boundary -- use confirm_rollover_team_proposal instead.';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide this rollover proposal.' using errcode = '42501';
  end if;
  if r.applied_at is not null then
    raise exception 'This handover has already been applied.' using errcode = 'P0001';
  end if;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%). Undo that decision first if it needs to change.', p.decision;
  end if;

  select * into t from public.teams where id = p.team_id;
  v_boys_squad := coalesce(p_boys_squad_designation, t.squad_designation);
  v_girls_squad := nullif(coalesce(p_girls_squad_designation, ''), '');

  if p_create_girls_team then
    v_girls_type := internal.resolve_canonical_team_type('youth', p.proposed_age_group, 'girls', v_girls_squad);
    if v_girls_type is null then
      raise exception 'Ovalball has no canonical Girls % identity, so that team cannot be planned.', p.proposed_age_group
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from internal.rollover_identity_plan(p.rollover_id) ip
      where ip.canonical_team_type_id = v_girls_type
        and coalesce(ip.squad_designation, '') = coalesce(v_girls_squad, '')
    ) then
      raise exception 'This club is already going to run Girls % next season, so a second one cannot be planned. Review that team instead.',
        p.proposed_age_group using errcode = 'P0001';
    end if;

    insert into public.age_grade_rollover_planned_teams
      (rollover_id, canonical_team_type_id, squad_designation, origin, source_team_id, source_proposal_id, planned_by)
    values (p.rollover_id, v_girls_type, v_girls_squad, 'MIXED_SPLIT', t.id, p_proposal_id, auth.uid())
    returning id into v_planned_id;
  end if;

  update public.age_grade_rollover_team_proposals
  set decision = 'confirmed',
      decided_age_group = p.proposed_age_group,
      decided_gender = 'boys',
      decided_squad_designation = v_boys_squad,
      decided_canonical_team_type_id =
        internal.resolve_canonical_team_type('youth', p.proposed_age_group, 'boys', v_boys_squad),
      create_girls_team = p_create_girls_team,
      girls_squad_designation = v_girls_squad,
      decided_by = auth.uid(), decided_at = now()
  where id = p_proposal_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollover_team_proposals', p_proposal_id, 'update', auth.uid(),
    jsonb_build_object('event', 'HANDOVER_MIXED_SPLIT_DECIDED', 'rollover_id', p.rollover_id,
                       'team_id', p.team_id, 'create_girls_team', p_create_girls_team,
                       'planned_girls_team_id', v_planned_id));

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = p.rollover_id;

  -- The Girls team is planned, not created: no team id to hand back until Apply.
  return query select p.team_id, null::uuid;
end;
$function$;

comment on function public.confirm_mixed_boundary_rollover(uuid, boolean, text, text) is
  'Records the Mixed U11 -> U12 split decision. The continuing cohort keeps its team id and becomes Boys at Apply; a Girls team, if wanted, is planned and created at Apply.';

-- ---------------------------------------------------------------------------
-- 7. "Add the missing team" plans a team; it does not create one
-- ---------------------------------------------------------------------------
--
-- This is the case that could not work before. The club's only candidate for
-- next season's U12 is this season's U11 -- and this season's U12 is still
-- called U12 until the handover runs, so a live U12 could not be created
-- beside it. Planned, there is nothing to collide with: the identity is
-- vacated during Apply, before the planned team takes it.

drop function if exists public.provision_missing_placement_team(uuid);

create or replace function public.plan_missing_placement_team(p_proposal_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  p public.age_grade_rollover_player_proposals;
  r public.age_grade_rollovers;
  v_cur public.teams;
  v_type public.canonical_team_types;
  v_squad text;
  v_planned_id uuid;
begin
  select * into p from public.age_grade_rollover_player_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Player proposal not found.'; end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id for update;

  -- Deciding the club will run a team is a club-structural act, held to the
  -- same authority as creating one anywhere else.
  if not (internal.is_club_admin(r.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may add a team.' using errcode = '42501';
  end if;
  if r.applied_at is not null then
    raise exception 'This handover has already been applied.' using errcode = 'P0001';
  end if;
  if p.normal_canonical_team_type_id is null then
    raise exception 'This player has no normal age grade for the target season, so there is no team to add. Resolve their age grade first.'
      using errcode = 'P0001';
  end if;
  if p.proposed_team_id is not null then
    raise exception 'This player already has a normal team to go to.' using errcode = 'P0001';
  end if;

  select * into v_type from public.canonical_team_types where id = p.normal_canonical_team_type_id;
  select * into v_cur from public.teams where id = p.current_team_id;

  -- The squad letter travels with the player where it can, but a B squad
  -- cannot exist without its primary -- judged against the plan, so a primary
  -- that is itself still moving counts.
  v_squad := v_cur.squad_designation;
  if v_squad is not null and not exists (
    select 1 from internal.rollover_identity_plan(r.id) ip
    where ip.canonical_team_type_id = v_type.id and ip.squad_designation is null
  ) then
    v_squad := null;
  end if;

  insert into public.age_grade_rollover_planned_teams
    (rollover_id, canonical_team_type_id, squad_designation, origin, source_team_id, planned_by)
  values (r.id, v_type.id, v_squad, 'PLAYER_PLACEMENT', p.current_team_id, auth.uid())
  on conflict (rollover_id, canonical_team_type_id, coalesce(squad_designation, '')) do update
    set origin = public.age_grade_rollover_planned_teams.origin
  returning id into v_planned_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollover_planned_teams', v_planned_id, 'insert', auth.uid(),
    jsonb_build_object('event', 'HANDOVER_TEAM_PLANNED', 'rollover_id', r.id,
                       'canonical_team_type_id', v_type.id, 'squad_designation', v_squad,
                       'origin', 'PLAYER_PLACEMENT', 'source_team_id', p.current_team_id,
                       'target_season_id', r.to_season_id));

  -- Everyone who was waiting on this identity now has somewhere to go.
  perform internal.refresh_rollover_player_proposals(r.id);

  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = r.id;

  return v_planned_id;
end;
$function$;

comment on function public.plan_missing_placement_team(uuid) is
  'Records that the club will run a team it does not have yet. Creates nothing: the real team is created during Apply, after the progressing cohorts have vacated their identities.';

create or replace function public.unplan_handover_team(p_planned_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  pt public.age_grade_rollover_planned_teams;
  r public.age_grade_rollovers;
begin
  select * into pt from public.age_grade_rollover_planned_teams where id = p_planned_id for update;
  if not found then raise exception 'Planned team not found.'; end if;
  select * into r from public.age_grade_rollovers where id = pt.rollover_id for update;
  if not (internal.is_club_admin(r.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may withdraw a planned team.' using errcode = '42501';
  end if;
  if pt.applied_at is not null or r.applied_at is not null then
    raise exception 'This team has already been created by the handover and cannot be withdrawn here.' using errcode = 'P0001';
  end if;
  if pt.origin <> 'PLAYER_PLACEMENT' then
    raise exception 'This team is planned as part of a team decision. Undo that decision instead.' using errcode = 'P0001';
  end if;

  delete from public.age_grade_rollover_planned_teams where id = p_planned_id;
  perform internal.refresh_rollover_player_proposals(r.id);
  update public.age_grade_rollovers set decisions_revision = decisions_revision + 1 where id = r.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Player proposals understand a planned destination
-- ---------------------------------------------------------------------------

create or replace function internal.rollover_planned_team_for(
  p_rollover_id uuid, p_type_id uuid, p_squad text
) returns uuid
language sql stable security definer set search_path to 'public'
as $function$
  select pt.id from public.age_grade_rollover_planned_teams pt
  where pt.rollover_id = p_rollover_id
    and pt.canonical_team_type_id = p_type_id
    and pt.applied_at is null
  order by (coalesce(pt.squad_designation, '') = coalesce(p_squad, '')) desc,
           pt.squad_designation nulls first
  limit 1;
$function$;

grant execute on function public.undo_rollover_team_decision(uuid) to authenticated;
grant execute on function public.clear_rollover_player_placement(uuid) to authenticated;
grant execute on function public.plan_missing_placement_team(uuid) to authenticated;
grant execute on function public.unplan_handover_team(uuid) to authenticated;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal')
     ~ 'update public\.teams|fold_team|graduate_team_core|provision_intake_team' then
    raise exception 'Deciding a handover still mutates live operational state.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'provision_missing_placement_team') then
    raise exception 'The immediate-creation escape hatch is still present.';
  end if;
end $$;
