-- A player's next team is the side that will BE their age grade next season.
--
-- WHAT THE BOARD SHOWED
--
-- A Mixed U11 cohort with one boy and one girl, both U12 next season:
--
--   Harry Mixed   U11  ->  U13
--   Isla  Mixed   U11  ->  Girls U14
--
-- Their allocations were right -- Harry to the U12 identity, Isla to Girls U12.
-- The TEAMS chosen were wrong. resolve_normal_placement_team matched
-- candidates on t.canonical_team_type_id, which is what a team is called
-- TODAY. The club's "U12" side is a cohort that is itself moving up: next
-- season it is U13. So a child who will be U12 was pointed at a team that will
-- be U13, and the board displayed exactly that contradiction.
--
-- At a season handover every team moves. "The club's U12 team" is only U12
-- until the handover applies. The team that will BE U12 next season is a
-- different one -- usually this season's U11.
--
-- THE FIX
--
-- Candidate teams are compared by the identity they will hold in the TARGET
-- season, resolved through public.get_team_identity_for_season -- the same
-- canonical projection the fixture views, Calendar, Agenda and Match Centre
-- already use. No new resolver, and no date arithmetic.
--
-- A real consequence, and the correct one: in the scenario above the club ends
-- up with NO team that will be Boys U12 or Girls U12, because its only
-- candidate is the Mixed U11 and that can become just one of them. Both
-- children therefore need a decision, and the board offers "Add the missing
-- team". That is the honest answer -- previously they were quietly pointed at
-- sides that would be the wrong age grade by the time they got there.

create or replace function internal.resolve_normal_placement_team(
  p_rollover_id uuid, p_current_team_id uuid, p_normal_type_id uuid
) returns uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r public.age_grade_rollovers;
  v_cur public.teams;
  v_cur_gender text;
  v_normal_gender text;
  v_proposed_age text;
  v_becomes uuid;
  v_team uuid;
begin
  if p_normal_type_id is null then return null; end if;
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  select * into v_cur from public.teams where id = p_current_team_id;

  select ctt.gender into v_cur_gender
  from public.canonical_team_types ctt where ctt.id = v_cur.canonical_team_type_id;
  select ctt.gender into v_normal_gender
  from public.canonical_team_types ctt where ctt.id = p_normal_type_id;

  -- 1. The player's own squad, where it is genuinely carrying them forward --
  --    not a move at all, just the team changing name around them. Skipped at
  --    a Mixed to Boys/Girls split, where the team has one successor and its
  --    children have two.
  if v_cur.id is not null
     and not (v_cur_gender = 'mixed' and v_normal_gender is distinct from 'mixed') then
    select tp.proposed_age_group into v_proposed_age
    from public.age_grade_rollover_team_proposals tp
    where tp.rollover_id = p_rollover_id and tp.team_id = p_current_team_id
      and tp.decision in ('pending', 'confirmed');
    if v_proposed_age is not null then
      v_becomes := internal.resolve_canonical_team_type(
        v_cur.category, v_proposed_age, v_cur.gender, v_cur.squad_designation);
      if v_becomes = p_normal_type_id then
        return v_cur.id;
      end if;
    end if;
  end if;

  -- 2/3. Every other candidate is judged by the identity it will hold in the
  --      season being decided, not the one it holds today. Same squad letter
  --      first, then the primary.
  select t.id into v_team
  from public.teams t
  cross join lateral public.get_team_identity_for_season(t.id, r.to_season_id) i
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and internal.resolve_canonical_team_type(i.category, i.age_group, i.gender, i.squad_designation)
        = p_normal_type_id
  order by (t.squad_designation is not distinct from v_cur.squad_designation) desc,
           t.squad_designation nulls first
  limit 1;

  return v_team;
end;
$function$;

comment on function internal.resolve_normal_placement_team(uuid, uuid, uuid) is
  'The operational team a player normally lands in, judged by what each team will BE in the target season. Matching on today''s identity pointed a child who will be U12 at a side that will be U13.';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'resolve_normal_placement_team';
  if v_def !~ 'get_team_identity_for_season' then
    raise exception 'Placement still matches candidate teams on their present identity.';
  end if;
end $$;
