-- =====================================================================================================
-- THE PEOPLE WHO CAN ANSWER ARE THE PEOPLE TOLD.
--
-- `internal.notify_tournament_result` reached a participating side through `team_role_assignments` --
-- the staff of the entered TEAM. Driving the real festival showed that misses the commonest case: a
-- CLUB ADMIN holds `fixture.result.record` at CLUB scope and may hold no team role at all, so Preston
-- Grasshoppers' admin submitted a score, was contested, and was never told. The person who had to act
-- was the one person the notification did not reach.
--
-- THE AUDIENCE IS NOW THE SAME SET THE WRITE PATH AUTHORISES. If `submit_tournament_game_result` would
-- accept you for this side, you are told about it. That is one rule rather than two, and it cannot
-- drift from who can act, because it IS who can act.
--
-- THE ORGANISER IS STILL ALWAYS TOLD, and the side that just acted is still excluded -- being notified
-- of your own submission is how a list of real work becomes noise.
-- =====================================================================================================

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
    -- ANYBODY WHO COULD RECORD A RESULT FOR THE OTHER SIDE. Resolved through the capability rather
    -- than through a role name, so a club admin, a fixtures secretary and a team's own coach are all
    -- reached by the same rule -- and that rule is the one the write path enforces.
    select cm.user_id
    from public.tournament_participants tp
    join public.club_memberships cm on cm.club_id = tp.club_id and cm.status = 'active'
    where tp.id in (g.side_a_id, g.side_b_id)
      and tp.club_id is not null
      and (p_exclude_side is null or tp.id <> p_exclude_side)
      -- `capability_decision` is the canonical resolver asked ABOUT A PERSON rather than about the
      -- caller -- which is what a notification needs, since the caller here is the side that acted.
      -- `p_check_session => false` because the recipient is not making this request; whether their
      -- session is live is a question for when they open it.
      and (coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'club',
                                                 tp.club_id, null, null, false, false)).allowed, false)
           or (tp.team_id is not null
               and coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'team',
                                                          tp.club_id, tp.team_id, null, false, false)).allowed, false)))
    union
    -- And the organiser, always: settling a disagreement is their job and they cannot do it if nobody
    -- says there is one.
    select ra2.user_id
    from public.role_assignments ra2
    where ra2.club_id = g.host_club_id and ra2.team_id is null
      and ra2.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') and ra2.state = 'ACTIVE'
  ) r
  where r.user_id is not null and internal.is_account_active(r.user_id);
end;
$function$;

comment on function internal.notify_tournament_result(uuid, uuid, text, text, text) is
  'Tells the other side and the organiser that a tournament result needs them. The audience is exactly '
  'the people the write path would authorise for that side, so who is told cannot drift from who can '
  'act. Never announces a standings change: the table is a projection, not an event.';
