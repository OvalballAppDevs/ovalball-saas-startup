-- Pitch/playing-area update RPC (fixtures.pitch_allocation already
-- existed as unwired schema scaffolding -- this is the first real write
-- path for it) and the team result-statistics view.

create or replace function public.update_fixture_pitch(p_fixture_id uuid, p_pitch text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_old_pitch text;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;

  update public.fixtures set pitch_allocation = nullif(trim(p_pitch), '') where id = p_fixture_id;

  if coalesce(v_old_pitch, '') <> coalesce(trim(p_pitch), '') and f.opponent_team_id is not null then
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
      case when nullif(trim(p_pitch), '') is null then 'Pitch allocation removed.'
           else format('Pitch allocated: %s', trim(p_pitch)) end);
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when nullif(trim(p_pitch), '') is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', trim(p_pitch)) end);
    end if;
  end if;
end;
$$;

revoke execute on function public.update_fixture_pitch(uuid, text) from public;
grant execute on function public.update_fixture_pitch(uuid, text) to authenticated;

-- ============================================================
-- team_result_stats: derived, security_invoker (exactly as permissive as
-- fixtures' own public read RLS) -- only fixtures with a FINAL or
-- EXTERNAL_RECORDED result, and never a cancelled fixture, contribute.
-- One row per team per side (home/away), unioned so each team's played/
-- won/drawn/lost/points reflect fixtures it took part in on EITHER side.
-- ============================================================

create view public.team_result_stats
  with (security_invoker = true) as
with sides as (
  select owning_team_id as team_id, home_score as team_score, away_score as opponent_score
  from public.fixtures
  where result_status in ('final', 'external_recorded') and status <> 'Cancelled' and home_score is not null and away_score is not null
  union all
  select opponent_team_id as team_id, away_score as team_score, home_score as opponent_score
  from public.fixtures
  where result_status in ('final', 'external_recorded') and status <> 'Cancelled' and home_score is not null and away_score is not null
    and opponent_team_id is not null
)
select
  team_id,
  count(*) as played,
  count(*) filter (where team_score > opponent_score) as won,
  count(*) filter (where team_score = opponent_score) as drawn,
  count(*) filter (where team_score < opponent_score) as lost,
  coalesce(sum(team_score), 0) as points_for,
  coalesce(sum(opponent_score), 0) as points_against
from sides
group by team_id;

comment on view public.team_result_stats is
  'Played/won/drawn/lost/points-for/points-against, computed only from finalized eligible results (result_status final/external_recorded, fixture not cancelled). Deliberately excludes anything pending/disputed/amendment_pending -- an unconfirmed score never contributes to the official record.';

grant select on public.team_result_stats to authenticated, anon;
