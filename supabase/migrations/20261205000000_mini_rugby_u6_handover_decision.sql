-- Mini-rugby: the U6 cohort gets a decision instead of being skipped.
--
-- WHAT WAS HAPPENING
--
-- The handover's team loop excluded U6 outright:
--
--   and age_group is not null and age_group <> 'U6'
--   -- U6 has no younger feed-in to roll from within this club's own
--   -- rollover; it stays U6 or is handled as a fresh intake, out of scope
--
-- The reasoning is sound and the ambiguity is real -- some clubs progress the
-- U6 cohort to U7 and recruit a new U6, others run U6 as a permanent entry
-- group that new starters join each year. Both happen.
--
-- What is not sound is which of the two Ovalball picked. Skipping the team
-- silently chose "it stays U6", so a club that progresses its cohort finds its
-- seven-year-olds still filed as Under-6s, with nothing on the handover screen
-- having mentioned them. The canonical progression graph disagrees with that
-- choice too: internal.next_age_grade_for('U6','mixed','union') returns U7,
-- and U7 and U8 roll automatically. U6 was the only age grade where the
-- handover and the canonical graph said different things.
--
-- WHAT CHANGES
--
-- U6 now gets a proposal like every other age grade, with U7 suggested, but
-- flagged requires_manual_choice so it is never applied automatically. The
-- club decides: Confirm to move the cohort up, or Defer to keep U6 as a
-- standing intake group. Deferring mutates nothing, so a club that runs a
-- permanent U6 ends up exactly where it does today -- the difference is that
-- it is now their decision rather than Ovalball's assumption.
--
-- This needs no interface change: the rollover page already separates
-- proposals with requires_manual_choice into the group that needs attention.
--
-- Also aligns the mini-rugby scheduling-group check with the code-aware
-- successor. It still used internal.next_age_grade, the code-blind function
-- whose use in the automatic path was a defect fixed earlier. Union and League
-- agree across U6-U8 so it produced no wrong answer here, but leaving the
-- code-blind successor in a handover path is how that defect survived the
-- first time.

create or replace function internal.generate_rollover_proposal_core(
  p_club_id uuid, p_rugby_code text, p_to_season_id uuid, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rollover_id uuid;
  v_from_season_id uuid;
  t record;
  v_group record;
  v_would_be_ages text[];
  v_next_age text;
  v_requires_manual boolean;
  v_is_mixed_boundary boolean;
begin
  select id into v_from_season_id
  from public.seasons
  where rugby_code = p_rugby_code
    and ends_on < (select starts_on from public.seasons where id = p_to_season_id)
  order by ends_on desc limit 1;

  -- Reuse the club's existing handover to this season rather than opening a
  -- parallel one.
  insert into public.age_grade_rollovers (club_id, rugby_code, from_season_id, to_season_id, created_by)
  values (p_club_id, p_rugby_code, v_from_season_id, p_to_season_id, p_created_by)
  on conflict (club_id, rugby_code, to_season_id)
    do update set club_id = excluded.club_id
  returning id into v_rollover_id;

  for t in
    select id, age_group, gender from public.teams
    where club_id = p_club_id and rugby_code = p_rugby_code and category = 'youth' and active
      and age_group is not null
  loop
    -- Code-aware: union girls step by dual age band, union stops at U18,
    -- league continues to U19.
    v_next_age := internal.next_age_grade_for(t.age_group, t.gender, p_rugby_code);
    v_is_mixed_boundary := coalesce(t.gender, '') = 'mixed'
      and v_next_age is not null
      and v_next_age not in ('U6', 'U7', 'U8', 'U9', 'U10', 'U11');

    -- U6 is offered, never assumed: progressing the cohort and running U6 as a
    -- standing intake group are both legitimate, and only the club knows which
    -- it does.
    v_requires_manual := v_next_age is null or v_is_mixed_boundary or t.age_group = 'U6';

    -- A team that already has a proposal in this handover keeps it, decided or
    -- not. That is what makes a re-prepare resume rather than restart.
    insert into public.age_grade_rollover_team_proposals
      (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
    values (v_rollover_id, t.id, t.age_group, v_next_age, v_requires_manual, v_is_mixed_boundary)
    on conflict (rollover_id, team_id) do nothing;
  end loop;

  for v_group in
    select sg.id, sg.display_tag from public.scheduling_groups sg
    where sg.club_id = p_club_id and sg.active
  loop
    select array_agg(distinct internal.next_age_grade_for(mt.age_group, mt.gender, mt.rugby_code))
      into v_would_be_ages
    from public.scheduling_group_members sgm
    join public.teams mt on mt.id = sgm.team_id
    where sgm.group_id = v_group.id;

    if exists (select 1 from unnest(v_would_be_ages) a where a not in ('U6', 'U7', 'U8') or a is null) then
      insert into public.age_grade_rollover_group_flags (rollover_id, scheduling_group_id, reason)
      values (v_rollover_id, v_group.id,
        format('Rolling forward would produce an invalid combination outside the U6-U8 mini-rugby band (currently %s).', v_group.display_tag))
      on conflict (rollover_id, scheduling_group_id) do nothing;
    end if;
  end loop;

  return v_rollover_id;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'generate_rollover_proposal_core';

  if v_def ~ '<> ''U6''' then
    raise exception 'The handover still skips U6 outright.';
  end if;
  if v_def ~ 'next_age_grade\(' then
    raise exception 'A handover path still uses the code-blind successor.';
  end if;
  if v_def !~ 'age_group = ''U6''' then
    raise exception 'U6 is no longer flagged as a decision the club must make.';
  end if;
end $$;
