-- Handovers decided under the old model have already happened.
--
-- THE RISK THIS CLOSES
--
-- Before the staged commit model, recording a decision WAS carrying it out:
-- Confirm updated the team, Fold deactivated it, Graduate archived it. Those
-- rows are still in age_grade_rollover_team_proposals, marked confirmed /
-- folded / graduated, and the new applied_at column is null on every one of
-- them because it did not exist when they were written.
--
-- Apply reads exactly that: "decided, not yet applied". Left alone, the first
-- Apply after this deploy would progress a cohort that progressed last season
-- -- U17 to U18 for a team already at U18 -- or try to fold a team that is
-- already inactive. A club's season structure would quietly advance twice.
--
-- WHAT THIS DOES
--
-- Nothing is deleted, nothing is reversed and no team is touched. Every
-- decision that pre-dates the staged model is stamped with the moment it was
-- decided, which under that model is also the moment it took effect. Apply
-- then correctly sees it as done.
--
-- The stamp is deliberately anchored to THIS migration: only rows that already
-- existed can qualify, because from here on applied_at is written by Apply and
-- by nothing else. A decision recorded a second after this runs is staged, has
-- not happened, and must not be stamped.
--
-- Player proposals are left exactly as they are. Under the old model a
-- placement was applied by its own per-player call, which set
-- placement_applied_at -- so a row without one genuinely never moved anybody,
-- and Apply should move them. Their memberships are the source of truth for
-- that, and it already says so.

do $$
declare v_teams integer; v_rollovers integer;
begin
  update public.age_grade_rollover_team_proposals
  set applied_at = coalesce(decided_at, created_at)
  where decision <> 'pending' and applied_at is null;
  get diagnostics v_teams = row_count;

  -- A season transition the automatic processor drove to 'completed' applied
  -- its whole handover under the old model, so the handover itself is done.
  update public.age_grade_rollovers r
  set applied_at = coalesce(st.applied_at, st.updated_at, now())
  from public.season_transitions st
  where st.rollover_id = r.id and st.status = 'completed' and r.applied_at is null;
  get diagnostics v_rollovers = row_count;

  raise notice 'Pre-staged handover reconciliation: % team decision(s) marked as already carried out, % handover(s) marked complete.',
    v_teams, v_rollovers;
end $$;

-- Belt and braces for anything that slips past the stamp: Apply already
-- re-reads live state before every mutation (it skips a destination that is
-- occupied, and only folds or graduates a team that is still active), so a
-- stale decision cannot double-progress a cohort even if it were missed here.
-- This comment records that the safety is in the operation, not only in the
-- data fix.

do $$
begin
  if exists (
    select 1 from public.age_grade_rollover_team_proposals
    where decision <> 'pending' and applied_at is null
      and decided_at < now() - interval '1 second'
  ) then
    raise exception 'A decision predating this migration was left unstamped and could be applied twice.';
  end if;
end $$;
