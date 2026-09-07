-- Per-Player validation inside the real season handover.
--
-- WHY THIS EXISTS
--
-- A stable operational team progressing U16 -> U17 does not prove that every
-- player attached to it belongs at U17 next season. Some are playing up, some
-- hold a dispensation that may not survive the season boundary, some have no
-- recorded date of birth at all. Rolling a team forward and dragging every
-- membership with it is how a child ends up in the wrong age grade.
--
-- So each player is now validated independently, against the SAME authorities
-- the rest of the system uses:
--
--   public.resolve_player_regulatory_age          -- DOB + code + season
--   public.resolve_normal_operational_identity    -- age -> canonical identity
--   internal.resolve_player_movement_eligibility  -- source/target decision
--
-- No new age logic is introduced here. This is orchestration.
--
-- DOB NEVER LANDS IN THE PROPOSAL
--
-- The register needs the RESULT of the calculation, not the sensitive input.
-- date_of_birth is read inside the generator and never persisted, returned or
-- exposed; what is stored is the resolved age label and a status. A constraint
-- below refuses any future column that looks like a date of birth.
--
-- EXTENDS THE ROLLOVER DOMAIN, NOT A PARALLEL SUBSYSTEM
--
-- This is a sibling of age_grade_rollover_team_proposals under the same
-- age_grade_rollovers parent, so one rollover carries both its team decisions
-- and its player decisions. The dispensation domain is untouched and simply
-- consulted: player_team_dispensation is already season-scoped, so a decision
-- made for one season does not silently apply to the next.

create table public.age_grade_rollover_player_proposals (
  id uuid primary key default gen_random_uuid(),
  rollover_id uuid not null references public.age_grade_rollovers(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,

  -- Stable authority. The team the player is in now, and the team proposed.
  current_team_id uuid not null references public.teams(id) on delete cascade,
  current_membership_id uuid references public.player_team_memberships(id) on delete set null,
  proposed_team_id uuid references public.teams(id) on delete set null,
  proposed_canonical_team_type_id uuid references public.canonical_team_types(id),

  -- The RESULT of the age calculation. Never the input.
  regulatory_age_label text,
  regulatory_status text not null,
  normal_canonical_team_type_id uuid references public.canonical_team_types(id),
  allocation_status text not null,

  -- The movement decision, in the existing canonical vocabulary.
  movement_requirement text,
  dispensation_id uuid references public.player_team_dispensation(id) on delete set null,
  dispensation_outcome text,

  review_state text not null,
  reason text,
  created_at timestamptz not null default now(),

  constraint rollover_player_proposal_unique unique (rollover_id, player_id, current_team_id),

  constraint rollover_player_proposal_regulatory_status_check check (
    regulatory_status in ('RESOLVED','DOB_REQUIRED','TOO_YOUNG','ADULT','INVALID_DOB','SEASON_NOT_FOUND')
  ),
  constraint rollover_player_proposal_allocation_status_check check (
    allocation_status in ('NORMAL_PLACEMENT','NEEDS_ATTENTION','DOB_REQUIRED')
  ),
  constraint rollover_player_proposal_movement_check check (
    movement_requirement is null or movement_requirement in
      ('permitted','team_approval_only','external_approval_required','not_permitted')
  ),
  constraint rollover_player_proposal_dispensation_outcome_check check (
    dispensation_outcome is null or dispensation_outcome in
      ('CONTINUES','EXPIRES_AT_SEASON_BOUNDARY','NO_LONGER_REQUIRED','REQUIRES_REVIEW',
       'REQUIRES_EXTERNAL_REAPPROVAL','DOES_NOT_APPLY_TO_TARGET')
  ),
  constraint rollover_player_proposal_review_state_check check (
    review_state in ('READY','NEEDS_ATTENTION','BLOCKED')
  ),
  -- Anything that is not a clean normal placement must say why.
  constraint rollover_player_proposal_reason_required check (
    review_state = 'READY' or reason is not null
  )
);

comment on table public.age_grade_rollover_player_proposals is
  'Per-Player handover decisions, a sibling of age_grade_rollover_team_proposals under the same rollover. Holds the RESULT of the regulatory-age calculation and never the date of birth that produced it -- the register needs the outcome, not the sensitive input. Consumes the canonical resolvers rather than reimplementing any age logic.';

comment on column public.age_grade_rollover_player_proposals.regulatory_age_label is
  'The resolved age grade for the TARGET season, e.g. "U17". Derived from DOB inside the generator; the DOB itself is never stored here.';
comment on column public.age_grade_rollover_player_proposals.dispensation_outcome is
  'What happens to an existing dispensation at the season boundary. player_team_dispensation is season-scoped, so the default is that a decision made for one season does NOT carry -- EXPIRES_AT_SEASON_BOUNDARY is the honest answer, not an inconvenience to work around.';

create index rollover_player_proposals_rollover_idx on public.age_grade_rollover_player_proposals (rollover_id);
create index rollover_player_proposals_player_idx on public.age_grade_rollover_player_proposals (player_id);
create index rollover_player_proposals_review_idx on public.age_grade_rollover_player_proposals (review_state);

alter table public.age_grade_rollover_player_proposals enable row level security;

-- Scoped exactly like the team proposals: this club's staff, or a Site Admin.
create policy rollover_player_proposals_select on public.age_grade_rollover_player_proposals
  for select to authenticated
  using (
    exists (
      select 1 from public.age_grade_rollovers r
      where r.id = rollover_id
        and (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin())
    )
  );

-- ============================================================
-- The generator. Orchestration only -- every decision is delegated.
-- ============================================================

create or replace function public.generate_rollover_player_proposals(p_rollover_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
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
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to generate player proposals for this club.' using errcode = '42501';
  end if;

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

    -- 1. Regulatory age for the TARGET season. DOB is read here and nowhere
    --    else; it is not carried into the row that gets written.
    select * into v_reg from public.resolve_player_regulatory_age(r.rugby_code, r.to_season_id, m.date_of_birth);

    -- 2. The normal operational identity for that age.
    select * into v_norm from public.resolve_normal_operational_identity(
      r.rugby_code, r.to_season_id, m.date_of_birth, m.gender);

    -- 3. Does the club already run the team that identity points at?
    if v_norm.canonical_team_type_id is not null then
      select t2.id into v_proposed_team
      from public.teams t2
      where t2.club_id = r.club_id and t2.rugby_code = r.rugby_code
        and t2.canonical_team_type_id = v_norm.canonical_team_type_id and t2.active
      order by t2.squad_designation nulls first
      limit 1;
    end if;

    -- 4. An existing dispensation is consulted, never renewed. The table is
    --    season-scoped, so one written for this season does not carry.
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

    -- 5. Movement decision, where both ends are known.
    if v_proposed_team is not null and v_proposed_team is distinct from m.team_id then
      select * into v_move from internal.resolve_player_movement_eligibility(
        r.rugby_code, current_date, m.date_of_birth, m.team_id, v_proposed_team);
      v_move_req := v_move.requirement;
    end if;

    -- 6. Classify.
    if v_norm.allocation_status = 'DOB_REQUIRED' then
      v_review := 'NEEDS_ATTENTION';
      v_reason := 'This player has no recorded date of birth, so their age grade for the target season cannot be established. It must never be inferred from the team they currently play for. Obtain the date of birth through the normal protected profile process.';
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

comment on function public.generate_rollover_player_proposals(uuid) is
  'Validates every active youth membership in a rollover independently, rather than assuming a progressing team carries its whole squad. Delegates entirely: regulatory age to resolve_player_regulatory_age, identity to resolve_normal_operational_identity, movement to resolve_player_movement_eligibility. Reads date_of_birth and never stores it. Idempotent through the (rollover, player, team) unique constraint, so preparing twice creates no duplicates.';

revoke execute on function public.generate_rollover_player_proposals(uuid) from public;
grant execute on function public.generate_rollover_player_proposals(uuid) to authenticated;

-- ============================================================
-- Guards.
-- ============================================================

do $$
begin
  -- No date of birth may ever be persisted on a proposal.
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='age_grade_rollover_player_proposals'
      and (column_name ~* 'birth' or column_name ~* '\mdob\M')
  ) then
    raise exception 'The player proposal table has a date-of-birth column; it must store the RESULT of the age calculation, never the input.';
  end if;

  -- A call-up must not be reachable from a handover proposal.
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='age_grade_rollover_player_proposals'
      and column_name ~* 'call_up'
  ) then
    raise exception 'A handover proposal references a fixture call-up; call-ups are fixture-scoped and must never become season membership.';
  end if;
end $$;
