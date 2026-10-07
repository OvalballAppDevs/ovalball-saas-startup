-- A TOURNAMENT SAYS WHETHER ANY OF ITS COMPETITIONS KEEPS A TABLE (Tournament Planning parity programme,
-- phase 6).
--
-- The organiser's Tables tab followed the FORMAT on the device (formatHasStandings: round robin and
-- tri-fixture), while the server's own rule (internal.tournament_plan_has_standings, 20270666) is that a
-- Tri-Fixture keeps a table only when the organiser asks for one. A Tri-Fixture nobody made a competition
-- therefore showed a Tables tab that could only ever be empty -- and a tournament running a knockout
-- under a round robin's format, or the other way round, followed the wrong one. This reads the one rule,
-- per competition, and answers for the tournament: a table is shown when any of its competitions keeps
-- one.

create or replace function public.tournament_keeps_standings(p_tournament_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select internal.tournament_visible_row(p_tournament_id)
     and (
       exists (select 1 from public.tournament_plans p
               where p.tournament_id = p_tournament_id and p.publication_state <> 'SUPERSEDED'
                 and internal.tournament_plan_has_standings(p.id))
       or exists (
         -- A competition with no plan yet keeps a table if its format does by default: a round robin.
         select 1 from public.tournament_age_groups g join public.tournaments t on t.id = g.tournament_id
         where g.tournament_id = p_tournament_id and t.format = 'round_robin'
           and not exists (select 1 from public.tournament_plans p
                           where p.tournament_id = g.tournament_id and p.age_group = g.age_group and p.publication_state <> 'SUPERSEDED'))
     );
$function$;
revoke all on function public.tournament_keeps_standings(uuid) from public, anon;
grant execute on function public.tournament_keeps_standings(uuid) to authenticated;
