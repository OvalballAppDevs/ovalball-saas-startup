-- =====================================================================================================
-- A KNOCKOUT COMPETITION'S OWN SETTINGS.
--
-- Its own RPC rather than four more parameters on `set_tournament_plan_settings`, which already carries
-- twelve. The timing and points settings are shared by every format; these four exist only where there
-- is a bracket, and a function whose parameters are mostly irrelevant to most callers is a function
-- nobody can read.
--
-- RESULT VISIBILITY IS DELIBERATELY NOT HERE. It belongs to the TOURNAMENT, is already built, and
-- applies whatever shape the competition takes. A knockout copy of it would be a second setting
-- answering the same question.
-- =====================================================================================================

create or replace function public.set_tournament_knockout_settings(
  p_plan_id uuid,
  p_draw_method text default null,
  p_extra_time_minutes integer default null,
  p_tie_resolution text default null,
  p_third_place_playoff boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  if p_draw_method is not null and p_draw_method not in ('random', 'manual', 'seeded') then
    raise exception 'A draw is made at random, by hand, or from seeds.' using errcode = '22023';
  end if;
  if p_tie_resolution is not null and p_tie_resolution not in ('none', 'extra_time', 'organiser_decision') then
    raise exception 'That is not a way Ovalball can settle a level game.' using errcode = '22023';
  end if;
  -- EXTRA TIME IS A LENGTH, and the age-grade welfare rule that governs a game's length governs this
  -- too: a competition cannot add a period longer than the grade's own full game.
  if p_extra_time_minutes is not null then
    if p_extra_time_minutes < 1 or p_extra_time_minutes > 40 then
      raise exception 'Extra time is between 1 and 40 minutes.' using errcode = '22023';
    end if;
  end if;

  update public.tournament_plans
  set draw_method = coalesce(p_draw_method, draw_method),
      tie_resolution = coalesce(p_tie_resolution, tie_resolution),
      third_place_playoff = coalesce(p_third_place_playoff, third_place_playoff),
      -- Extra time only means anything where the competition settles ties that way, and clearing the
      -- method clears the length with it rather than leaving a number that does nothing.
      extra_time_minutes = case
        when coalesce(p_tie_resolution, tie_resolution) <> 'extra_time' then null
        else coalesce(p_extra_time_minutes, extra_time_minutes)
      end,
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;

  -- Turning the play-off on or off takes effect on the competition immediately, where its sides are
  -- already known. It never removes a play-off that has been played.
  perform internal.ensure_third_place_game(p_plan_id);
end;
$function$;

revoke all on function public.set_tournament_knockout_settings(uuid, text, integer, text, boolean) from public, anon;
grant execute on function public.set_tournament_knockout_settings(uuid, text, integer, text, boolean) to authenticated, service_role;
