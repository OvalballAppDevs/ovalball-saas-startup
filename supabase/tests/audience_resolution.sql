-- The audience resolution pipeline (20270244000000).
--
-- The property that matters is not "it returns some people". It is that
-- every stage is actually load-bearing and that the ORDER holds, because the
-- failure this prevents is a resolver that quietly returns a shorter list
-- and lets a sender believe they told everybody.
--
-- Proved here, stage by stage:
--
--   1  authority     a sender cannot address a team or club that is not theirs
--   2  feature policy  a switched-off feature refuses the send
--   4  membership    resolved live, and carrying WHY each person is included
--   5  exclude U18   removes the CHILD from the audience, and with them their
--                    guardian -- not the child from an already-routed list
--   6  safeguarding  a guardian is reached about a named player, never a
--                    child directly where the canonical rule forbids it
--   7  blocks        a personal block stops a PERSON and not an organisation
--   8  dedup         one person, one delivery, direct route winning
--
-- Plus: who this audience will NOT reach, reported rather than hidden.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/audience_resolution.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;       -- may address the team
  v_outsider uuid;    -- may not
  v_team uuid;
  v_club uuid;
  v_n integer;
  v_guardian_n integer;
  v_direct_n integer;
  v_minor uuid;
  v_minor_guardian uuid;
  v_blocker uuid;
  r record;
begin
  select id into v_admin     from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_outsider  from auth.users where email = 'uat.unrelated@ovalball.test';

  if v_admin is null or v_outsider is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select t.id, t.club_id into v_team, v_club
  from public.teams t
  where internal.can_address_team_audience(t.id)
  order by t.id limit 1;

  if v_team is null then
    raise notice 'SKIP: no team in this database that the UAT team admin may address';
    return;
  end if;

  -- =================================================================
  -- STAGE 4 + 6: WHO, AND WHY
  -- =================================================================
  select count(*),
         count(*) filter (where safeguarding_route = 'guardian'),
         count(*) filter (where safeguarding_route = 'direct')
    into v_n, v_guardian_n, v_direct_n
  from internal.resolve_audience('team', v_team);

  if v_n > 0 then
    raise notice 'PASS 1: the team audience resolves to % recipients (% guardian, % direct)',
      v_n, v_guardian_n, v_direct_n;
  else
    raise notice 'FAIL 1: the team audience resolved to nobody at all';
  end if;

  -- Every guardian row names the player it concerns; every direct row does
  -- not. "Who" without "why" is what this pipeline exists to stop losing.
  if not exists (
    select 1 from internal.resolve_audience('team', v_team)
    where (safeguarding_route = 'guardian') <> (concerning_player_id is not null)
  ) then
    raise notice 'PASS 2: every guardian recipient names the player they are being written to about';
  else
    raise notice 'FAIL 2: a recipient''s route and concerning player disagree';
  end if;

  -- =================================================================
  -- STAGE 8: ONE PERSON, ONE DELIVERY
  -- =================================================================
  select count(*) into v_n from (
    select recipient_user_id from internal.resolve_audience('team', v_team)
    group by recipient_user_id having count(*) > 1
  ) d;
  if v_n = 0 then
    raise notice 'PASS 3: no person appears twice, however many ways they qualify';
  else
    raise notice 'FAIL 3: % people would receive this more than once', v_n;
  end if;

  -- =================================================================
  -- STAGE 6: A CHILD IS NOT WRITTEN TO DIRECTLY
  -- =================================================================
  if not exists (
    select 1 from internal.resolve_audience('team', v_team) a
    join public.players p on p.user_id = a.recipient_user_id
    where a.safeguarding_route = 'direct'
      and internal.player_effective_age(p.id) < 16
  ) then
    raise notice 'PASS 4: no under-16 player is written to directly';
  else
    raise notice 'FAIL 4: an under-16 player was resolved as a direct recipient';
  end if;

  -- =================================================================
  -- STAGE 5: EXCLUDE U18 TAKES THE CHILD *AND* THEIR GUARDIAN
  -- The distinction the stage order encodes. If Exclude U18 ran after
  -- routing, the guardian would survive and be written to about a child --
  -- the opposite of what the sender asked for.
  -- =================================================================
  select p.id, g.guardian_user_id into v_minor, v_minor_guardian
  from internal.team_playing_group_player_ids(v_team) tp
  join public.players p on p.id = tp.player_id
  join public.guardians g on g.player_id = p.id and g.status = 'active'
  where internal.player_effective_age(p.id) < 18
  limit 1;

  if v_minor is null then
    raise notice 'SKIP 5: this team has no under-18 player with an active guardian';
  else
    if exists (
      select 1 from internal.resolve_audience('team', v_team, '{}'::jsonb, false)
      where recipient_user_id = v_minor_guardian and concerning_player_id = v_minor
    ) then
      raise notice 'PASS 5a: without the filter, the child''s guardian is in the audience';
    else
      raise notice 'FAIL 5a: the guardian was missing from the unfiltered audience';
    end if;

    if not exists (
      select 1 from internal.resolve_audience('team', v_team, '{}'::jsonb, true)
      where concerning_player_id = v_minor
    ) then
      raise notice 'PASS 5b: Exclude U18 removes the child from the audience, and their guardian with them';
    else
      raise notice 'FAIL 5b: Exclude U18 left the guardian being written to about a child';
    end if;
  end if;

  -- =================================================================
  -- STAGE 1: AUTHORITY
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    perform 1 from internal.resolve_audience('team', v_team);
    raise notice 'FAIL 6: somebody with no authority resolved this team''s audience';
  exception when insufficient_privilege then
    raise notice 'PASS 6: a sender cannot resolve an audience they may not address';
  end;

  begin
    perform 1 from internal.resolve_audience('platform', null);
    raise notice 'FAIL 6b: a non-admin resolved the platform-wide audience';
  exception when insufficient_privilege then
    raise notice 'PASS 6b: only a Full Site Admin resolves the platform-wide audience';
  end;

  -- 6c. And a selected audience cannot reach past that same boundary.
  begin
    perform 1 from internal.resolve_audience('selected', null,
      jsonb_build_object('player_ids', jsonb_build_array(coalesce(v_minor, gen_random_uuid()))));
    raise notice 'FAIL 6c: a selected audience reached a player the sender may not address';
  exception when insufficient_privilege then
    raise notice 'PASS 6c: a selected audience narrows reach, it never widens it';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- STAGE 7: A PERSONAL BLOCK STOPS A PERSON, NOT AN ORGANISATION
  -- =================================================================
  select recipient_user_id into v_blocker
  from internal.resolve_audience('team', v_team)
  where recipient_user_id <> v_admin
  limit 1;

  if v_blocker is null then
    raise notice 'SKIP 7: no other recipient available to block with';
  else
    -- Blocked through the real product path, as the person doing the
    -- blocking -- not by a privileged insert that would skip the RLS this
    -- domain depends on.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_blocker, 'role', 'authenticated')::text, true);
    perform public.block_user(v_admin);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    if not exists (
      select 1 from internal.resolve_audience('team', v_team, '{}'::jsonb, false, 'person')
      where recipient_user_id = v_blocker
    ) then
      raise notice 'PASS 7: a personal block removes the blocker from a PERSON''s audience';
    else
      raise notice 'FAIL 7: a personal block did not stop a person-to-person send';
    end if;

    if exists (
      select 1 from internal.resolve_audience('team', v_team, '{}'::jsonb, false, 'team')
      where recipient_user_id = v_blocker
    ) then
      raise notice 'PASS 7b: the same block does NOT silence the team speaking as itself';
    else
      raise notice 'FAIL 7b: blocking a person also silenced their club -- official communication was suppressed';
    end if;
  end if;

  -- =================================================================
  -- STAGE 2: FEATURE POLICY
  -- =================================================================
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_team_announcements = false where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform 1 from internal.resolve_audience('team', v_team);
    raise notice 'FAIL 8: a switched-off feature still resolved an audience';
  exception when insufficient_privilege then
    raise notice 'PASS 8: a switched-off feature refuses the send rather than sending quietly';
  end;

  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_team_announcements = true where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- WHO THIS WILL NOT REACH
  -- =================================================================
  select count(*) into v_n from public.audience_unreachable('team', v_team);
  raise notice 'PASS 9: the unreachable report answers for this audience (% player(s) with no route)', v_n;

  if not exists (
    select 1 from public.audience_unreachable('team', v_team)
    where outcome not in ('NO_ELIGIBLE_GUARDIAN', 'CONSENT_REQUIRED_NO_GUARDIAN')
  ) then
    raise notice 'PASS 10: every unreachable player carries a canonical reason, not a blank';
  else
    raise notice 'FAIL 10: an unreachable player was reported with an unrecognised reason';
  end if;
end $$;

rollback;
