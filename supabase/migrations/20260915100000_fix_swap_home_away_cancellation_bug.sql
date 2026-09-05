-- CRITICAL reconciliation fix: swap_fixture_home_away swapped
-- owning_team_id <-> opponent_team_id AND flipped home_away in the same
-- write. home_team_id/away_team_id are GENERATED columns computed from
-- owning_team_id/opponent_team_id/home_away together (see
-- 20260904600000_master_fixture_consolidation.sql's own comment: "The home
-- side's team, generated from owning_team_id/opponent_team_id/home_away").
-- Swapping the team-id assignment and flipping home_away in the same
-- operation is mathematically a no-op on home_team_id/away_team_id --
-- verified directly: before = {owning:A, home_away:'Home'} -> home=A;
-- "after" = {owning:B, home_away:'Away'} -> home = (home_away<>'Home' so
-- opponent_team_id) = A again. The fixture's actual home/away identity
-- never changed. Worse, silently reassigning owning_team_id transfers
-- edit/manage authority (internal.can_manage_team(owning_team_id) and
-- every RLS policy keyed off it) to the OTHER club's staff with zero
-- visible change on screen -- a real, dangerous side effect independent of
-- the display bug.
--
-- Correct fix: a home/away swap must change ONLY home_away. owning_team_id
-- and opponent_team_id are which two teams are in this fixture -- that
-- pairing does not change when you swap which one is "home". Score
-- orientation swap is still required (home_score always belongs to
-- whichever team is currently home) and stays correct on its own once only
-- home_away flips. The prior opponent_directory_id-nulling/raw_opposition_
-- text-rewriting logic is removed entirely -- unneeded once the underlying
-- team pairing is never touched, and it was itself the source of the
-- separate "Unresolved Club Name" display bug fixed in
-- 20260915000000_fix_swap_resolution_gap.sql.

create or replace function public.swap_fixture_home_away(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_new_home_away text;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  if not (internal.is_site_admin() or internal.can_manage_team(v_fixture.owning_team_id)) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;
  if v_fixture.opponent_team_id is null then
    raise exception 'Cannot swap home/away -- the opponent side has no resolved team to become the new home/away side. Correct the opposition first.' using errcode = 'P0001';
  end if;

  v_new_home_away := case v_fixture.home_away
    when 'Home' then 'Away'
    when 'Away' then 'Home'
    else v_fixture.home_away -- TBD/Not Applicable: no determined side to swap
  end;

  update public.fixtures
  set home_away = v_new_home_away,
      home_score = v_fixture.away_score,
      away_score = v_fixture.home_score,
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('home_away', v_fixture.home_away, 'home_score', v_fixture.home_score, 'away_score', v_fixture.away_score),
    jsonb_build_object('home_away', v_new_home_away, 'home_score', v_fixture.away_score, 'away_score', v_fixture.home_score));
end;
$$;

comment on function public.swap_fixture_home_away is
  'The deliberate operation behind Home Team editing: flips ONLY home_away (never owning_team_id/opponent_team_id -- that pairing is the two teams IN the fixture, not which is home), keeping result orientation correct as one atomic write. Reconciliation fix: the prior version swapped the team-id assignment together with home_away, which is a mathematical no-op on the generated home_team_id/away_team_id columns and silently transferred edit authority to the other club -- see migration comment.';

revoke execute on function public.swap_fixture_home_away(uuid) from public;
grant execute on function public.swap_fixture_home_away(uuid) to authenticated;
