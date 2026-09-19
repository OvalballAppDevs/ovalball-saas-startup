-- =====================================================================================================
-- SLICE 7e (2/n) -- a Site Admin could move a child between teams without being able to see where the
-- child already was.
--
-- WHAT CAME UP. Building AB.1's Team Memberships tab surfaced an asymmetry nobody had had to look at,
-- because until now there was no screen that needed both halves at once:
--
--   public.site_set_player_team_membership   -- Site Admin CAN add, end and move a player's place
--   public.player_team_memberships (RLS)     -- readable only through team.roster.view at TEAM scope,
--                                               is_own_linked_player, or is_active_player_guardian
--
-- A Full Site Admin holds none of those three for a club they are not a member of, which is the normal
-- case and is deliberate: Slice 7 established that Site Admin is a platform authority with explicit
-- site-scoped capabilities, never a blanket RLS bypass. The consequence, though, is that the one
-- operation is performable blind. "Move this player to Under 14" with no way to see they are currently
-- in Under 12 B is how somebody ends up moved twice, or moved from a team they were never in.
--
-- WHAT THIS IS NOT. It is not a widening of the RLS policy. Adding a site clause to
-- player_team_memberships_select would hand every roster on the platform to every administrator holding
-- any site read capability, including Support profiles that have no business with a child's team
-- placement. The policy is left exactly as it is.
--
-- WHAT IT IS. One narrow definer read, subject by subject, gated on site.users.view -- the same
-- capability that already governs site_membership_history, site_team_history and site_family_history,
-- and the same shape. It answers only "where is this one person's linked player placed", never "show me
-- a roster", so it cannot become a roster export by being called in a loop with a different argument
-- than the one the screen has.
-- =====================================================================================================

create or replace function public.site_player_team_memberships(p_user_id uuid)
returns table (
  membership_id uuid,
  player_id     uuid,
  player_name   text,
  team_id       uuid,
  team_name     text,
  club_name     text,
  status        text,
  joined_at     timestamptz,
  ended_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select ptm.id,
         pl.id,
         btrim(coalesce(pl.first_name,'') || ' ' || coalesce(pl.surname,'')),
         t.id,
         t.display_name,
         cd.name,
         ptm.status,
         ptm.joined_at,
         ptm.ended_at
    from public.player_team_memberships ptm
    join public.players pl on pl.id = ptm.player_id
    join public.teams   t  on t.id  = ptm.team_id
    join public.clubs   c  on c.id  = t.club_id
    join public.club_directory cd on cd.id = c.directory_id
   where internal.has_site_capability('site.users.view')
     -- The subject is the PERSON whose record is open: their own linked player,
     -- or a child they are an active guardian of. Not "every player".
     and (pl.user_id = p_user_id
          or exists (select 1 from public.guardians g
                      where g.player_id = pl.id
                        and g.guardian_user_id = p_user_id
                        and g.state = 'ACTIVE'))
   order by ptm.status, ptm.joined_at desc nulls last
   limit 200;
$$;

comment on function public.site_player_team_memberships(uuid) is
  'Phase 2 AB.1 Team Memberships tab. Read-only, one person at a time, gated on site.users.view. Exists '
  'because site_set_player_team_membership could change a placement the same administrator could not '
  'see -- and because the fix for that must not be a wider RLS policy on the roster itself.';

revoke all on function public.site_player_team_memberships(uuid) from public, anon;
grant execute on function public.site_player_team_memberships(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.site_player_team_memberships(uuid)') is null then
    raise exception 'SLICE 7e: site_player_team_memberships was not created';
  end if;
  if has_function_privilege('anon', 'public.site_player_team_memberships(uuid)', 'EXECUTE') then
    raise exception 'SLICE 7e: anon can read player team placements';
  end if;
  -- The point of the whole migration: the roster policy is UNCHANGED.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'player_team_memberships'
                and policyname = 'player_team_memberships_select'
                and coalesce(qual,'') like '%has_site_capability%') then
    raise exception 'SLICE 7e: the roster RLS policy was widened; the definer read exists so it need not be';
  end if;
  raise notice 'Slice 7e: a Site Admin can now read the one roster placement it can change';
end $$;
