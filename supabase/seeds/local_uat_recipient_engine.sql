-- One additional synthetic scenario for the recipient/audience resolution
-- engine's UAT: a 16-17 year old with an ACTIVE GUARDIAN who has GRANTED
-- 'direct_coach_communication'.
--
-- WHY THIS IS NEEDED
--
-- The existing local dataset has two players in the 15-20 age range and
-- both have zero active guardians, so the canonical "16/17 with consent
-- reaches the player directly" branch of internal.guardian_permission_
-- effective has never been exercised against real local relationships --
-- only the "no guardian to ask" and "no consent recorded" branches were
-- coverable. This closes that gap with one small, clearly-purposed,
-- additive fixture rather than repurposing an existing named UAT identity
-- (uat.player.self, uat.guardian.one etc. each already carry an
-- established meaning other tests depend on -- see
-- supabase/seeds/local_uat_site_admin.sql's own reasoning for why that is
-- rejected here too).
--
-- Reuses uat.guardian.one@ovalball.test as the guardian (gains one more
-- child; does not change what that account already means to any other
-- test) and attaches the new player to Ovalball UAT RUFC's Men's 3rd Team
-- (senior/open-age, so no age-grade eligibility rule is being bent to make
-- this fixture exist).

do $$
declare
  v_guardian_user_id uuid;
  v_team_id uuid;
  v_player_id uuid;
begin
  -- The same local-only guard every other UAT seed in this project uses.
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The recipient-engine UAT seed is local-only.';
  end if;

  select u.id into v_guardian_user_id from auth.users u where u.email = 'uat.guardian.one@ovalball.test';
  if v_guardian_user_id is null then
    raise notice 'uat.guardian.one@ovalball.test not found -- skipping recipient-engine UAT seed.';
    return;
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.clubs c on c.id = t.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where cd.source = 'local_dev_seed' and t.category = 'senior'
  order by t.display_name limit 1;
  if v_team_id is null then
    raise notice 'No local senior UAT team found -- skipping recipient-engine UAT seed.';
    return;
  end if;

  select id into v_player_id from public.players where first_name = 'Reece' and surname = 'UATConsented';

  if v_player_id is null then
    insert into public.players (first_name, surname, date_of_birth, playing_pathway)
    values ('Reece', 'UATConsented', (current_date - interval '17 years')::date, 'MALE')
    returning id into v_player_id;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status)
  select v_player_id, v_team_id, 'active'
  where not exists (
    select 1 from public.player_team_memberships where player_id = v_player_id and team_id = v_team_id
  );

  insert into public.guardians (guardian_user_id, player_id, status)
  select v_guardian_user_id, v_player_id, 'active'
  where not exists (
    select 1 from public.guardians where guardian_user_id = v_guardian_user_id and player_id = v_player_id
  );

  insert into public.guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, source, actor)
  select v_player_id, 'direct_coach_communication', v_guardian_user_id, true, 'guardian_dashboard', v_guardian_user_id
  where not exists (
    select 1 from public.guardian_player_permissions
    where player_id = v_player_id and permission_key = 'direct_coach_communication' and guardian_user_id = v_guardian_user_id
  );

  raise notice 'Recipient-engine UAT ready: player % (age 17, consented), team %, guardian %', v_player_id, v_team_id, v_guardian_user_id;
end $$;
