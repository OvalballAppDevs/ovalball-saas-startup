-- Across the Mixed boundary a team has one successor and its children have two.
--
-- WHAT WAS WRONG
--
-- internal.resolve_normal_placement_team starts by asking "is the player's own
-- team heading for the identity their age calls for?" -- because usually it is,
-- and then the player is not moving at all: the team keeps its stable id and
-- changes name around them.
--
-- At the Mixed to Boys/Girls split that reasoning breaks. A Mixed U11 side has
-- a proposed_age_group of U12, and resolving ('youth', 'U12', 'mixed', null)
-- lands on the boys U12 identity, because no Mixed U12 exists. So a boy in that
-- side matched step 1 and was told his normal placement was his current team --
-- the U11 Mixed one. The girl beside him fell through to a proper lookup and
-- was correctly sent to Girls U12.
--
-- So the cohort would have been half-right: the boys silently carried along
-- with the team, the girls placed individually. The failure is quiet, and it is
-- the one place in the handover where a team's progression genuinely must not
-- decide a player's placement.
--
-- THE RULE
--
-- If the player's current team is Mixed and their own normal identity is not,
-- the cohort is splitting. The team's successor says nothing about where this
-- child goes, so the question is answered from the player's own pathway
-- instead. Everywhere else the existing behaviour is unchanged, because
-- everywhere else the team really does carry the player with it.

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

  -- 1. The player's own squad, if it is heading for the identity their age
  --    calls for -- which is not a move at all, just the team changing name
  --    around them.
  --
  --    Skipped when the cohort is SPLITTING. A Mixed side proposed for U12
  --    resolves to the boys identity simply because no Mixed U12 exists, and
  --    that would quietly carry every boy along with the team while the girls
  --    were placed properly. Where the pathways part, the team's successor
  --    says nothing about where a particular child goes.
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

  -- 2. A team already at that identity carrying the same squad letter.
  select t.id into v_team
  from public.teams t
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and t.canonical_team_type_id = p_normal_type_id
    and t.squad_designation is not distinct from v_cur.squad_designation
  limit 1;
  if v_team is not null then return v_team; end if;

  -- 3. The primary at that identity.
  select t.id into v_team
  from public.teams t
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code and t.active
    and t.canonical_team_type_id = p_normal_type_id
  order by t.squad_designation nulls first
  limit 1;
  return v_team;
end;
$function$;

comment on function internal.resolve_normal_placement_team(uuid, uuid, uuid) is
  'The operational team a player normally lands in. The player''s own team counts only where it is genuinely carrying them forward -- never across a Mixed to Boys/Girls split, where the team has one successor and its children have two.';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'resolve_normal_placement_team';
  if v_def !~ 'v_cur_gender = ''mixed''' then
    raise exception 'The Mixed split no longer bypasses team-carries-player.';
  end if;
end $$;
