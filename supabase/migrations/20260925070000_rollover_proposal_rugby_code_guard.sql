-- Found live: a real club (Burnley RUFC, a Union-only club) had two
-- genuine, persisted age_grade_rollovers rows with rugby_code =
-- 'league' -- an empty shell batch with zero team proposals (Burnley
-- has no league teams), but visible on its own real Season Rollover
-- page because that page's history query was never scoped to the
-- club's own rugby code (fixed separately at the app layer). The root
-- cause: public.generate_rollover_proposal() never validated that its
-- caller-supplied p_rugby_code actually matches the calling club's
-- own canonical rugby_code (club_directory.rugby_code) -- nothing
-- stopped a caller (a stray script, a tampered request, a future bug
-- elsewhere) from generating a real rollover batch for a rugby code
-- that club doesn't even play. The automatic engine itself is
-- unaffected -- it always derives rugby_code from the club's own real
-- team rows, never from caller input -- so this guard only closes the
-- gap on the manually-invoked path.
create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_rugby_code text;
begin
  if not internal.has_capability('club.season_rollover.manage', 'club', p_club_id) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select cd.rugby_code into v_club_rugby_code
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id;
  if v_club_rugby_code is distinct from p_rugby_code then
    raise exception 'This club plays %, not % -- a rollover cannot be generated for a code this club does not play.', v_club_rugby_code, p_rugby_code using errcode = '23514';
  end if;

  return internal.generate_rollover_proposal_core(p_club_id, p_rugby_code, p_to_season_id, auth.uid());
end;
$$;
