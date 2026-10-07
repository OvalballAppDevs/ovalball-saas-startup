-- =====================================================================================================
-- A GENERATED DRAFT IS SOMETHING YOU CAN READ.
--
-- Generation already created the games. What it did not do was let anybody SEE them: the organiser was
-- told a number and put back where they started, and the one thing they had asked for -- the fixtures --
-- stayed invisible. A count is not a plan.
--
-- SO THIS IS THE READ BEHIND THE GENERATED DRAFT PLAN, and it is the games themselves: the real rows in
-- `tournament_games`, grouped the way a round robin is actually organised --
--
--     COMPETITION (age group)  ->  TABLE  ->  ROUND  ->  GAMES
--
-- with each table's membership alongside its rounds, because "Round 2: Burnley v Wigan" means nothing
-- to somebody who cannot see which table those two are in.
--
-- IT TELLS THE TRUTH ABOUT WHAT IS NOT DECIDED. A game with no pitch reservation behind it has no time
-- and no pitch, and this returns those as null rather than inventing a kick-off. The screen says "Time
-- not assigned", which is a fact about the plan; "09:00" would be a lie about it.
--
-- PREVIEW IS THE SAME SHAPE, COMPUTED NOT STORED. `p_preview` returns what generation WOULD produce,
-- from the same `internal.tournament_round_robin_pairs` the generator uses, and creates nothing. One
-- payload shape means the preview and the draft cannot drift into looking like different products.
--
-- ORGANISER ONLY, like every other planning read: a draft is the organising club's workings.
-- =====================================================================================================

create or replace function public.get_tournament_plan_draft(
  p_tournament_id uuid,
  p_age_group text,
  p_preview boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_tables jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  if v_plan.id is null then
    return jsonb_build_object(
      'tournamentId', v_t.id, 'tournamentName', v_t.name, 'ageGroup', p_age_group,
      'preview', p_preview, 'plan', null, 'tables', '[]'::jsonb);
  end if;

  -- ONE TABLE AT A TIME: who is in it, then its rounds, then the games in each round. The ordering is
  -- the competition's own -- table order, round number, then the pair's place in the round -- so two
  -- organisers reading the same draft read it in the same order.
  select coalesce(jsonb_agg(x.table_json order by x.sort_order, x.table_name), '[]'::jsonb)
  into v_tables
  from (
    select
      t.sort_order,
      t.name as table_name,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        -- THE TABLE'S MEMBERSHIP, so a round's pairings can be read against who is in the table.
        'sides', coalesce((
          select jsonb_agg(jsonb_build_object(
            'participantId', tp.id,
            'clubName', cd.name,
            'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
            'label', coalesce(tm.display_name,
                              case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
            'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id)
          ) order by s.position)
          from public.tournament_plan_table_sides s
          join public.tournament_participants tp on tp.id = s.participant_id
          join public.club_directory cd on cd.id = tp.club_directory_id
          left join public.teams tm on tm.id = tp.team_id
          where s.table_id = t.id), '[]'::jsonb),
        'rounds', coalesce((
          select jsonb_agg(r.round_json order by r.round_number)
          from (
            select
              g.round_number,
              jsonb_build_object(
                'round', g.round_number,
                'games', jsonb_agg(g.game_json order by g.sort_order)
              ) as round_json
            from (
              -- THE REAL ROWS, or the pairs a generation would make. Same columns either way.
              select
                coalesce(gm.round_number, 1) as round_number,
                gm.sort_order,
                jsonb_build_object(
                  'id', gm.id,
                  'round', gm.round_number,
                  'date', gm.game_date,
                  -- NULL IS THE ANSWER WHEN NOTHING HAS BEEN DECIDED, and the screen says so in words.
                  'startTime', gm.start_time,
                  'durationMinutes', gm.duration_minutes,
                  'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = gm.pitch_id),
                  'sideA', jsonb_build_object(
                    'participantId', a.id, 'clubName', cda.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), cda.logo_storage_path),
                    'label', coalesce(ta.display_name,
                                      case when a.squad_label is not null then a.age_group || ' ' || a.squad_label else a.age_group end)),
                  'sideB', jsonb_build_object(
                    'participantId', b.id, 'clubName', cdb.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), cdb.logo_storage_path),
                    'label', coalesce(tb.display_name,
                                      case when b.squad_label is not null then b.age_group || ' ' || b.squad_label else b.age_group end))
                ) as game_json,
                gm.table_id
              from (
                select g2.id, g2.round_number, g2.sort_order, g2.game_date, g2.start_time,
                       g2.duration_minutes, g2.pitch_id, g2.side_a_id, g2.side_b_id, g2.table_id
                from public.tournament_games g2
                where not p_preview and g2.plan_id = v_plan.id
                union all
                select null::uuid, p.round_number,
                       (p.table_sort * 10000 + p.round_number * 100 + p.pair_in_round)::int,
                       null::date, null::time, null::int, null::uuid,
                       p.side_a_id, p.side_b_id, p.table_id
                from internal.tournament_round_robin_pairs(v_plan.id) p
                where p_preview
              ) gm
              join public.tournament_participants a on a.id = gm.side_a_id
              join public.tournament_participants b on b.id = gm.side_b_id
              join public.club_directory cda on cda.id = a.club_directory_id
              join public.club_directory cdb on cdb.id = b.club_directory_id
              left join public.teams ta on ta.id = a.team_id
              left join public.teams tb on tb.id = b.team_id
            ) g
            where g.table_id = t.id
            group by g.round_number
          ) r), '[]'::jsonb)
      ) as table_json
    from public.tournament_plan_tables t
    where t.plan_id = v_plan.id
  ) x;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    'preview', p_preview,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      -- WHAT ACTUALLY EXISTS, counted at the source rather than summed on the phone.
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),
      'scheduledCount', (select count(*) from public.tournament_games
                         where plan_id = v_plan.id and start_time is not null),
      'pitchedCount', (select count(*) from public.tournament_games
                       where plan_id = v_plan.id and pitch_id is not null)
    ),
    'tables', coalesce(v_tables, '[]'::jsonb)
  );
end;
$function$;

comment on function public.get_tournament_plan_draft(uuid, text, boolean) is
  'The generated draft plan for one competition, grouped table -> round -> games, with each table''s '
  'membership. Returns null times and pitches honestly rather than inventing them. p_preview returns '
  'what generation would produce without creating anything. Organiser only.';

revoke all on function public.get_tournament_plan_draft(uuid, text, boolean) from public, anon;
grant execute on function public.get_tournament_plan_draft(uuid, text, boolean) to authenticated, service_role;

-- ---- regenerating is replacing, and it is explicit ---------------------------------------------------
--
-- The generator already clears a DRAFT plan's games before it writes new ones, which is right: a draft
-- regenerated is one draft, not two overlapping ones. What was missing is any way for the screen to
-- say what regenerating would COST, so the confirmation could be about something real rather than a
-- generic "are you sure".

create or replace function public.tournament_plan_regeneration_cost(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_state text;
begin
  perform internal.require_live_session();
  select tournament_id, publication_state into v_tournament, v_state
  from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'publicationState', v_state,
    'gameCount', (select count(*) from public.tournament_games where plan_id = p_plan_id),
    -- A GAME SOMEBODY HAS MOVED BY HAND is the one that makes regeneration expensive, so it is counted
    -- separately. Losing twelve machine-made pairings is nothing; losing the four an organiser spent
    -- the morning placing is the thing they need warning about.
    'placedCount', (select count(*) from public.tournament_games
                    where plan_id = p_plan_id and (start_time is not null or pitch_id is not null)),
    'recordedResultCount', (select count(*) from public.tournament_games
                            where plan_id = p_plan_id and side_a_score is not null)
  );
end;
$function$;

comment on function public.tournament_plan_regeneration_cost(uuid) is
  'What regenerating this plan would discard -- total games, games already given a time or a pitch, '
  'and games with a recorded result -- so a confirmation can name it. Organiser only.';

revoke all on function public.tournament_plan_regeneration_cost(uuid) from public, anon;
grant execute on function public.tournament_plan_regeneration_cost(uuid) to authenticated, service_role;
