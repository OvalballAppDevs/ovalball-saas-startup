-- =====================================================================================================
-- WHO HEARS ABOUT A RESPONSE IS A CANONICAL QUESTION.
--
-- `internal.availability_notification_recipients` already DECIDES canonically: every candidate is put
-- through `internal.capability_decision` and only an allowed one is returned. What it did legacily was
-- ENUMERATE the candidates -- from `club_memberships.role` matched against `role_capability_defaults`,
-- and from the `team_permissions` compatibility view. Three of the targets Slice 10 retires, in one
-- function, and the only reason they were there is to produce a list of people to ask about.
--
-- `role_assignments` IS that list, canonically. `team_permissions` is a view over it; a club-scoped
-- role is a row in it with a null `team_id`; and `role_capability_defaults` was being used to guess
-- which club roles might hold the capability -- a guess that `capability_decision` then re-answered
-- properly for each one. Asking the decision about everybody with a role at this team or its club
-- produces the same answer without the guess, because the guess only ever narrowed the candidate set
-- that the decision was about to filter anyway.
--
-- THE DECISION IS UNCHANGED -- same capability, same scope, same function, same `allowed` filter. What
-- changes is where the names come from. A person the old enumeration would have found and the decision
-- would have allowed is still found: `role_assignments` is a superset of both legacy sources, since the
-- compatibility view selects from it and the club-role path is a role assignment at club scope.
--
-- `step9_family_and_availability`, `recipient_audience_engine`, `notification_catalogue` and
-- `fixture_availability_summary` are the suites that would notice if the audience moved.
-- =====================================================================================================

create or replace function internal.availability_notification_recipients(p_team_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path to ''
as $function$
  with candidates as (
    -- EVERYBODY WITH A LIVE ROLE AT THIS TEAM, or at the club that owns it. A club-scoped assignment
    -- carries a null team_id and reaches every team in the club, which is what a club role means.
    select ra.user_id
    from public.role_assignments ra
    join public.teams t on t.id = p_team_id
    where ra.state = 'ACTIVE'
      and ra.club_id = t.club_id
      and (ra.team_id = p_team_id or ra.team_id is null)
    union
    -- Anybody granted the capability explicitly, at this team or its club.
    select o.user_id
    from public.capability_overrides o
    join public.teams t on t.id = p_team_id
    where o.capability_key = 'team.attendance.view'
      and o.status = 'active'
      and o.effect = 'grant'
      and (o.team_id = p_team_id or (o.team_id is null and o.club_id = t.club_id))
  )
  -- AND THE DECISION IS STILL THE DECISION. Being a candidate is not permission; this is.
  select distinct c.user_id
  from candidates c
  cross join lateral internal.capability_decision(
    c.user_id, 'team.attendance.view', 'team', null, p_team_id, null, false, false
  ) d
  where d.allowed;
$function$;

comment on function internal.availability_notification_recipients(uuid) is
  'Who is told when a player responds: everybody with a live role assignment at the team or its club, '
  'plus explicit grant holders, each filtered through internal.capability_decision. Enumerates from '
  'role_assignments rather than the Slice 10 compatibility estate.';

-- ---- it does not reach the retiring estate again -----------------------------------------------------

do $$
begin
  if (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'availability_notification_recipients')
     ~ '\yrole_capability_defaults\y|\yteam_permissions\y|\ycm\.role\y' then
    raise exception 'the availability recipient resolver is reading the Slice 10 compatibility estate again.';
  end if;
end $$;
