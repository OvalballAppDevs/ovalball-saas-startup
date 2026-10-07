-- =====================================================================================================
-- A TOURNAMENT DECIDES WHO SEES ITS RESULTS.
--
-- TWO SETTINGS, AND THEY ARE NOT THE TOURNAMENT'S OWN VISIBILITY.
--
--   results_submission_enabled   whether the participating sides may record their own scores at all,
--                                or whether the organiser records every one themselves.
--   results_visibility           who may read a CONFIRMED result and the standings it feeds.
--
-- `PUBLIC TOURNAMENT` DOES NOT MEAN `PUBLIC RESULTS`, and the two are deliberately separate columns. A
-- club may happily list a festival publicly and still want the scores kept inside it -- age-grade
-- rugby has good reasons for that -- and the opposite is just as reasonable. Defaulting results to
-- `participants` means the cautious answer is the one a club gets by doing nothing.
--
-- AND NOTHING UNSETTLED IS EVER PUBLIC. This setting governs CONFIRMED results only. A submitted score
-- awaiting the other side, a contested one, and the note somebody wrote explaining why they disagree
-- are between the two sides and the organiser, whatever this is set to. That is enforced in the read
-- models and the RLS policies, not by choosing not to draw it.
-- =====================================================================================================

alter table public.tournaments
  add column if not exists results_submission_enabled boolean not null default true,
  add column if not exists results_visibility text not null default 'participants';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_results_visibility_check') then
    alter table public.tournaments add constraint tournaments_results_visibility_check
      check (results_visibility in ('public', 'participants'));
  end if;
end $$;

comment on column public.tournaments.results_visibility is
  'Who may read CONFIRMED results and the standings they feed: public, or participants only. '
  'Deliberately independent of tournaments.visibility -- a publicly listed festival may still keep its '
  'scores inside it. Never governs unsettled or contested scores, which are never public.';

create or replace function public.set_tournament_results_settings(
  p_tournament_id uuid,
  p_submission_enabled boolean,
  p_results_visibility text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'Only the tournament organiser can change how results are managed.' using errcode = '42501';
  end if;
  if p_results_visibility not in ('public', 'participants') then
    raise exception 'Results are visible either to everybody or to participants.' using errcode = '22023';
  end if;
  update public.tournaments
  set results_submission_enabled = coalesce(p_submission_enabled, true),
      results_visibility = p_results_visibility,
      updated_by = auth.uid(), updated_at = now()
  where id = p_tournament_id;
end;
$function$;

revoke all on function public.set_tournament_results_settings(uuid, boolean, text) from public, anon;
grant execute on function public.set_tournament_results_settings(uuid, boolean, text) to authenticated, service_role;

-- ---- who is told, and about what --------------------------------------------------------------------
--
-- THREE EVENTS, AND ONLY THREE. The table is a PROJECTION, not an event: it re-resolves itself every
-- time it is read, so there is nothing to announce when it changes and nobody wants a notification
-- saying their points difference moved. What is worth telling somebody is that a human now has
-- something to do, or that a disagreement they were part of has been settled.

insert into public.notification_types (type_key, topic_key) values
  ('tournament_result_awaiting_confirmation', 'fixture_updates'),
  ('tournament_result_confirmed', 'fixture_updates'),
  ('tournament_result_contested', 'fixture_updates'),
  ('tournament_result_resolved', 'fixture_updates')
on conflict (type_key) do nothing;

/**
 * THE OTHER SIDE, AND THE ORGANISER.
 *
 * `p_exclude_side` is the side that just acted -- telling somebody about the thing they themselves
 * just did is how a notification list becomes noise. The organiser is always told, because settling a
 * disagreement is their job and they cannot do it if nobody says there is one.
 *
 * It follows `internal.fixture_result_notify`, which does the same thing for the other kind of game.
 */
create or replace function internal.notify_tournament_result(
  p_game_id uuid,
  p_exclude_side uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare g record;
begin
  select tg.id, tg.tournament_id, tg.side_a_id, tg.side_b_id, t.host_club_id
  into g
  from public.tournament_games tg
  join public.tournaments t on t.id = tg.tournament_id
  where tg.id = p_game_id;
  if g.id is null then return; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct r.user_id, p_type, p_title, p_body,
         jsonb_build_object('tournament_id', g.tournament_id, 'tournament_game_id', g.id)
  from (
    -- The staff of each participating side that is on Ovalball, bar the one that just acted.
    select ra.user_id
    from public.tournament_participants tp
    join internal.team_role_assignments ra on ra.team_id = tp.team_id
    where tp.id in (g.side_a_id, g.side_b_id)
      and (p_exclude_side is null or tp.id <> p_exclude_side)
      and tp.team_id is not null
    union
    -- And the organiser, always.
    select ra2.user_id
    from public.role_assignments ra2
    where ra2.club_id = g.host_club_id and ra2.team_id is null
      and ra2.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') and ra2.state = 'ACTIVE'
  ) r
  where r.user_id is not null and internal.is_account_active(r.user_id);
end;
$function$;

comment on function internal.notify_tournament_result(uuid, uuid, text, text, text) is
  'Tells the other side and the organiser that a tournament result needs them. Never announces a '
  'standings change: the table is a projection, not an event.';
