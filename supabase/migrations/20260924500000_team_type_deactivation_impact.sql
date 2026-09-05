-- Impact preview before globally deactivating a canonical team type --
-- Overnight Master Pass Section 49. Read-only, callable by anyone with
-- can_manage_team_catalogue() (the same authority the deactivation itself
-- requires), so the Site Admin sees real numbers before confirming, not a
-- generic reassurance sentence.
create or replace function public.get_canonical_team_type_impact(p_id uuid)
returns table (
  clubs_affected integer,
  active_teams integer,
  players integer,
  guardians integer,
  future_fixtures integer,
  historical_fixtures integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not internal.can_manage_team_catalogue() then
    raise exception 'Only a Site Admin with Team Directory management access may preview this.' using errcode = '42501';
  end if;

  return query
  select
    (select count(distinct t.club_id)::integer from teams t where t.canonical_team_type_id = p_id and t.active),
    (select count(*)::integer from teams t where t.canonical_team_type_id = p_id and t.active),
    (select count(distinct ptm.player_id)::integer
       from player_team_memberships ptm join teams t on t.id = ptm.team_id
       where t.canonical_team_type_id = p_id and ptm.status = 'active'),
    (select count(distinct g.id)::integer
       from guardians g
       join player_team_memberships ptm on ptm.player_id = g.player_id and ptm.status = 'active'
       join teams t on t.id = ptm.team_id
       where t.canonical_team_type_id = p_id and g.status = 'active'),
    (select count(*)::integer from fixtures f join teams t on t.id = f.owning_team_id
       where t.canonical_team_type_id = p_id and f.kickoff_date >= current_date),
    (select count(*)::integer from fixtures f join teams t on t.id = f.owning_team_id
       where t.canonical_team_type_id = p_id and f.kickoff_date < current_date);
end;
$$;
