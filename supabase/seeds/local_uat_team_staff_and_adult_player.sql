-- Local UAT identities for TEAM-SCOPED STAFF and a CLEAN ADULT PLAYER.
--
-- WHY THIS FILE EXISTS
--
-- The event/permissions audit could not browser-prove three roles, and the
-- reason was data rather than code:
--
--   ADULT PLAYER   -- uat.player.self is 17 and has NO active team membership,
--                     and the only adult player with active rugby is
--                     uat.coach, who is also a Club Admin. So there was no
--                     identity that isolates "ordinary adult who plays".
--   TEAM ADMIN     -- no team_permissions row with permission 'team_admin'
--                     existed anywhere in the local database.
--   TEAM MANAGER   -- likewise none with 'manager'.
--
-- Without those, Team Admin's fixture-creation authority could only be shown
-- inside a rolled-back transaction, and the audit said so rather than claiming
-- more. These are the missing identities, created the same way every other UAT
-- identity is: committed, idempotent, additive, local-only, and built out of
-- REAL domain rows rather than shortcuts.
--
-- AUTHORITY IS NOT MANUFACTURED HERE. Each identity gets exactly the canonical
-- rows a real person in that role would have -- a club_memberships row and a
-- team_permissions row -- and the capability engine then derives what they can
-- do. Nothing grants a capability directly, nothing writes capability_overrides
-- and nothing touches site_admins.
--
-- WHAT IT PROVIDES
--
--   uat.adult.player@ovalball.test    30, Men's 1st Team, NO staff authority
--   uat.team.admin@ovalball.test      team_permissions 'team_admin', U11 Mixed
--   uat.team.manager@ovalball.test    team_permissions 'manager',   U12 Boys
--
-- The two staff identities are on DIFFERENT teams on purpose: it makes the
-- "you may act for your own team and not another" assertion provable with two
-- real people rather than one person and a hypothetical.

do $$
begin
  -- The same local-only guard the other UAT seeds use.
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The team-staff UAT seed is local-only.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e.email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
from (values
  ('uat.adult.player@ovalball.test'),
  ('uat.team.admin@ovalball.test'),
  ('uat.team.manager@ovalball.test')
) as e(email)
where not exists (select 1 from auth.users u where u.email = e.email);

insert into public.profiles (id, first_name, surname, email)
select u.id, p.first_name, p.surname, u.email
from (values
  ('uat.adult.player@ovalball.test', 'Marcus', 'Fenwick'),
  ('uat.team.admin@ovalball.test',   'Delia',  'Hartnell'),
  ('uat.team.manager@ovalball.test', 'Owen',   'Pritchard')
) as p(email, first_name, surname)
join auth.users u on u.email = p.email
where not exists (select 1 from public.profiles pr where pr.id = u.id);

-- ---------------------------------------------------------------------
-- THE ADULT PLAYER
--
-- An ordinary adult who plays: a player row linked to their own account, an
-- active membership of a senior side, and nothing else. Deliberately NO
-- club_memberships row -- a player is not club staff, and giving them one
-- would have quietly handed them CLUB_MEMBER capabilities and spoiled the
-- very isolation this identity exists to provide.
-- ---------------------------------------------------------------------
insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
select 'Marcus', 'Fenwick', (current_date - interval '30 years')::date, 'MALE', u.id
from auth.users u
where u.email = 'uat.adult.player@ovalball.test'
  and not exists (select 1 from public.players p where p.user_id = u.id);

-- THE ADULT SIDES.
--
-- Created here rather than assumed. This file joined `teams` on the display name "Men's 1st Team" and
-- never created it, so on a FRESH database the join matched nothing and the adult player silently had
-- no team -- which reads as adult messaging being broken rather than as a missing fixture. The rows
-- existed on the development machine only because somebody had made them by hand.
--
-- The display name is DERIVED from the canonical identity (senior / mens / 1st), so the identity is
-- what is written and the name follows. Passing a display_name would simply be overwritten.
insert into public.teams (club_id, rugby_code, category, gender, squad_designation, active)
select c.id, 'union', 'senior', v.gender, v.squad, true
from public.clubs c
join public.club_directory d on d.id = c.directory_id and d.normalized_key = 'ovalball-uat-rufc'
cross join (values ('mens', '1st'), ('womens', '1st')) as v(gender, squad)
where not exists (
  select 1 from public.teams t
  where t.club_id = c.id and t.category = 'senior'
    and t.gender = v.gender and t.squad_designation = v.squad
);

insert into public.player_team_memberships (player_id, team_id, status)
select p.id, t.id, 'active'
from public.players p
join auth.users u on u.id = p.user_id and u.email = 'uat.adult.player@ovalball.test'
join public.teams t on t.display_name = 'Men''s 1st Team'
join public.clubs c on c.id = t.club_id
join public.club_directory d on d.id = c.directory_id and d.normalized_key = 'ovalball-uat-rufc'
where not exists (
  select 1 from public.player_team_memberships m where m.player_id = p.id and m.team_id = t.id
);

-- ---------------------------------------------------------------------
-- THE TEAM-SCOPED STAFF
--
-- A club_memberships row at BASIC_USER -- the standing an ordinary member has
-- -- plus a team_permissions row naming what they run. That pairing is what
-- internal.has_team_role_capability reads, and it is the only thing that makes
-- these people staff. BASIC_USER matters: it proves the team authority comes
-- from the team permission, not from a club role.
-- ---------------------------------------------------------------------
insert into public.club_memberships (club_id, user_id, role, status)
select c.id, u.id, 'BASIC_USER', 'active'
from auth.users u
join public.club_directory d on d.normalized_key = 'ovalball-uat-rufc'
join public.clubs c on c.directory_id = d.id
where u.email in ('uat.team.admin@ovalball.test', 'uat.team.manager@ovalball.test')
  and not exists (select 1 from public.club_memberships m where m.user_id = u.id and m.club_id = c.id);

insert into public.team_permissions (membership_id, team_id, permission)
select m.id, t.id, s.permission
from (values
  ('uat.team.admin@ovalball.test',   'Under 11 Mixed', 'team_admin'),
  ('uat.team.manager@ovalball.test', 'Under 12 Boys',  'manager')
) as s(email, team_name, permission)
join auth.users u on u.email = s.email
join public.club_memberships m on m.user_id = u.id
join public.clubs c on c.id = m.club_id
join public.club_directory d on d.id = c.directory_id and d.normalized_key = 'ovalball-uat-rufc'
join public.teams t on t.club_id = c.id and t.display_name = s.team_name
where not exists (
  select 1 from public.team_permissions tp where tp.membership_id = m.id and tp.team_id = t.id
);

-- ---------------------------------------------------------------------
-- A SQUAD WITH A SPREAD OF ANSWERS, AND GUARDIANS TO REACH.
--
-- Who's Training and the training communication composer are both worth
-- nothing to look at with one player on a team, and the audience counts are
-- meaningless without somebody notifiable at the other end. These six players
-- give the register a real shape; the guardian links give the audiences real
-- recipients.
--
-- The guardians matter for a second reason: they make the SAFEGUARDING model
-- visible in UAT. A player with no active guardian and no eligible own account
-- is genuinely uncontactable, and the composer reports NO_ELIGIBLE_RECIPIENTS
-- rather than pretending. Two of these six are deliberately left without a
-- guardian so that state stays testable.
-- ---------------------------------------------------------------------
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
select p.first_name, p.surname, (current_date - interval '10 years')::date, p.pathway
from (values
  ('Freddie','Nolan','MALE'), ('Ivy','Sharpe','FEMALE'), ('Rafi','Osman','MALE'),
  ('Martha','Quinn','FEMALE'), ('Otis','Bramley','MALE'), ('Nell','Draycott','FEMALE')
) as p(first_name, surname, pathway)
where not exists (select 1 from public.players x where x.first_name = p.first_name and x.surname = p.surname);

insert into public.player_team_memberships (player_id, team_id, status)
select pl.id, t.id, 'active'
from public.players pl
join public.teams t on t.display_name = 'Under 11 Mixed'
join public.clubs c on c.id = t.club_id
join public.club_directory d on d.id = c.directory_id and d.normalized_key = 'ovalball-uat-rufc'
where (pl.first_name, pl.surname) in (('Freddie','Nolan'),('Ivy','Sharpe'),('Rafi','Osman'),('Martha','Quinn'),('Otis','Bramley'),('Nell','Draycott'))
  and not exists (select 1 from public.player_team_memberships m where m.player_id = pl.id and m.team_id = t.id);

-- Four of the six get an active guardian, drawn from the existing UAT parent
-- accounts. Otis and Nell deliberately get none.
insert into public.guardians (guardian_user_id, player_id, status)
select u.id, pl.id, 'active'
from (values
  ('uat.guardian.one@ovalball.test',  'Freddie','Nolan'),
  ('uat.guardian.three@ovalball.test','Ivy','Sharpe'),
  ('uat.guardian.four@ovalball.test', 'Rafi','Osman'),
  ('uat.guardian.two@ovalball.test',  'Martha','Quinn')
) as g(email, first_name, surname)
join auth.users u on u.email = g.email
join public.players pl on pl.first_name = g.first_name and pl.surname = g.surname
where not exists (select 1 from public.guardians x where x.guardian_user_id = u.id and x.player_id = pl.id);
