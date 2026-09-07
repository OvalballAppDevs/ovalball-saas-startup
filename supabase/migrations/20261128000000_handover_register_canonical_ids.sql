-- The Handover Register records canonical identities, not age-group strings.
--
-- AUDIT FINDING
--
-- age_grade_rollover_team_proposals stored current_age_group, proposed_age_group
-- and decided_age_group as bare text. Those are structural values rather than
-- editable display labels, so the register was not storing mutable NAMES -- but
-- it was storing only HALF an identity. "U14" does not say whether the target
-- is U14 or Girls U14; that had to be inferred by joining back to the team's
-- gender, in every consumer, every time.
--
-- That inference is exactly where a code- or gender-specific pathway goes
-- wrong quietly. So the register now also carries the canonical team type it
-- means, and the age-group text is kept as the human-readable projection
-- beside it rather than as the authority.
--
-- Display labels remain projections: nothing here stores canonical_team_types.
-- label, so a Site Admin renaming "U17" to "Under 17" changes what the
-- register DISPLAYS and never what it MEANS.

alter table public.age_grade_rollover_team_proposals
  add column if not exists from_canonical_team_type_id uuid references public.canonical_team_types(id),
  add column if not exists proposed_to_canonical_team_type_id uuid references public.canonical_team_types(id),
  add column if not exists decided_canonical_team_type_id uuid references public.canonical_team_types(id);

comment on column public.age_grade_rollover_team_proposals.from_canonical_team_type_id is
  'The canonical identity the team held when the proposal was generated. The authority for what this transition is FROM; current_age_group beside it is the readable projection, not the source of truth.';
comment on column public.age_grade_rollover_team_proposals.proposed_to_canonical_team_type_id is
  'The canonical identity proposed for the target season, or NULL where there is no automatic successor -- union U18, league U19, league girls U16 -- which is what requires_manual_choice reflects. NULL here means "needs a human", never "the team is invalid".';

-- Backfill from the team plus the recorded age groups. A proposal's gender and
-- code come from its team, which is the same join every consumer was doing by
-- hand; doing it once here is the point.
update public.age_grade_rollover_team_proposals p
set from_canonical_team_type_id = coalesce(
      p.from_canonical_team_type_id,
      internal.resolve_canonical_team_type('youth', p.current_age_group, t.gender, null)
    ),
    proposed_to_canonical_team_type_id = coalesce(
      p.proposed_to_canonical_team_type_id,
      case when p.proposed_age_group is null then null
           else internal.resolve_canonical_team_type('youth', p.proposed_age_group, t.gender, null) end
    ),
    decided_canonical_team_type_id = coalesce(
      p.decided_canonical_team_type_id,
      case when p.decided_age_group is null then null
           else internal.resolve_canonical_team_type('youth', p.decided_age_group, t.gender, null) end
    )
from public.teams t
where t.id = p.team_id;

-- ============================================================
-- Populate on write, in BOTH generators.
-- ============================================================

create or replace function internal.set_rollover_proposal_canonical_ids()
returns trigger
language plpgsql
as $$
declare
  v_gender text;
begin
  select gender into v_gender from public.teams where id = new.team_id;

  if new.from_canonical_team_type_id is null and new.current_age_group is not null then
    new.from_canonical_team_type_id := internal.resolve_canonical_team_type('youth', new.current_age_group, v_gender, null);
  end if;
  if new.proposed_to_canonical_team_type_id is null and new.proposed_age_group is not null then
    new.proposed_to_canonical_team_type_id := internal.resolve_canonical_team_type('youth', new.proposed_age_group, v_gender, null);
  end if;
  if new.decided_canonical_team_type_id is null and new.decided_age_group is not null then
    new.decided_canonical_team_type_id := internal.resolve_canonical_team_type('youth', new.decided_age_group, v_gender, null);
  end if;
  return new;
end;
$$;

comment on function internal.set_rollover_proposal_canonical_ids() is
  'Derives the canonical identity columns on a rollover proposal from its team and the age groups written. A trigger rather than edits in each generator, so the manual path, the automatic path and the confirm path cannot drift -- there were already two generators, and only one of them was code-aware.';

drop trigger if exists rollover_proposal_canonical_ids on public.age_grade_rollover_team_proposals;
create trigger rollover_proposal_canonical_ids
  before insert or update on public.age_grade_rollover_team_proposals
  for each row execute function internal.set_rollover_proposal_canonical_ids();

-- ============================================================
-- The register as its consumers should read it: stable IDs, with the CURRENT
-- display label projected fresh on every read.
-- ============================================================

create or replace view public.handover_register
with (security_invoker = true)
as
select
  p.id                                as proposal_id,
  r.id                                as rollover_id,
  r.club_id,
  r.rugby_code,
  r.from_season_id,
  r.to_season_id,
  p.team_id,
  p.from_canonical_team_type_id,
  p.proposed_to_canonical_team_type_id,
  p.decided_canonical_team_type_id,
  -- Display labels are read live from the canonical directory, never stored.
  fr.label                            as from_label,
  tgt.label                           as proposed_to_label,
  dec.label                           as decided_label,
  p.current_age_group,
  p.proposed_age_group,
  p.decided_age_group,
  p.requires_manual_choice,
  p.is_mixed_boundary,
  p.decision,
  -- One honest state, so no consumer has to re-derive it. A proposal with no
  -- successor is NEEDS_ATTENTION, which means "a human must choose" -- it does
  -- NOT mean the team is invalid or discontinued.
  case
    when p.decision = 'confirmed' then 'COMPLETED'
    when p.decision = 'folded'    then 'COMPLETED'
    when p.decision = 'deferred'  then 'DEFERRED'
    when p.requires_manual_choice or p.proposed_to_canonical_team_type_id is null then 'NEEDS_ATTENTION'
    else 'READY'
  end                                 as transition_state,
  case
    when p.proposed_to_canonical_team_type_id is not null then null
    when p.is_mixed_boundary then 'A mixed cohort splits when it reaches U12; the Boys continuation is automatic but the Girls team is a separate decision.'
    else 'This team has NO AUTOMATIC SUCCESSOR for the target season and needs a review decision. The team itself remains valid -- union U18 and league U19 sit at the end of their youth pathway, and league girls U16 has no U17 division in the 2026 Girls League.'
  end                                 as needs_attention_reason,
  p.decided_by,
  p.decided_at,
  p.created_at
from public.age_grade_rollover_team_proposals p
join public.age_grade_rollovers r on r.id = p.rollover_id
left join public.canonical_team_types fr  on fr.id  = p.from_canonical_team_type_id
left join public.canonical_team_types tgt on tgt.id = p.proposed_to_canonical_team_type_id
left join public.canonical_team_types dec on dec.id = p.decided_canonical_team_type_id;

comment on view public.handover_register is
  'The Handover Register as consumers should read it. Authority is stable IDs -- team_id, season ids, canonical team type ids -- and every display label is joined LIVE from the canonical directory, so renaming an identity changes what the register shows and never what it means. transition_state collapses the decision and successor columns into one honest value; NEEDS_ATTENTION means a human must choose, never that the team is invalid.';

grant select on public.handover_register to authenticated;

-- ============================================================
-- Guards.
-- ============================================================

do $$
declare v_n int;
begin
  -- No proposal may lose its FROM identity in the backfill.
  select count(*) into v_n from public.age_grade_rollover_team_proposals
  where current_age_group is not null and from_canonical_team_type_id is null;
  if v_n > 0 then
    raise exception '% proposal(s) could not resolve a canonical FROM identity.', v_n;
  end if;

  -- Where an automatic successor exists, it must have resolved.
  select count(*) into v_n from public.age_grade_rollover_team_proposals
  where proposed_age_group is not null and proposed_to_canonical_team_type_id is null;
  if v_n > 0 then
    raise exception '% proposal(s) have a proposed age group that resolves to no canonical identity.', v_n;
  end if;

  -- The register must not store any display label.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'age_grade_rollover_team_proposals'
      and column_name in ('display_name', 'label', 'team_name')
  ) then
    raise exception 'The rollover proposal table stores a display label; labels must be projections.';
  end if;
end $$;
