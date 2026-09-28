-- FIRST AIDER -- a real, canonical team staff responsibility (Team Profiles Section 1A, owner-approved
-- fix for the role/domain gap the Section 1 audit found).
--
-- THE SAME ROLE TABLE, ONE MORE ROW. `role_definitions` already models a team staff responsibility as
-- exactly this shape (`role_key`, `scope`, `label`, `bundle_key`, `assignable_by`, `minor_prohibited`) --
-- no second role table is invented, and `role_assignments` already supports any number of simultaneous
-- role rows per person per team (no unique constraint blocks it, confirmed against the live schema
-- before this migration was written). Adding First Aider here is exactly the same shape of change as
-- the Coach, Team Manager and Volunteer rows already sitting beside it.
--
-- MINIMUM LEGITIMATE DEFAULT AUTHORITY -- reusing the "VO" (Volunteer) bundle rather than inventing a
-- new one. That bundle already holds nothing but *.view capabilities (fixture, calendar, venue, pitch
-- allocation, team, tournament, club documents/profile, and a safeguarding CONTACT route) and not one
-- *.manage/*.create/*.edit capability -- exactly "does not imply fixture edit, roster manage, finance,
-- pitch allocation, or safeguarding officer authority", the owner's own explicit list, without writing
-- a new bundle whose contents would have to be independently audited. A First Aider present at a
-- session needs to see what is on and how to reach the club's safeguarding contact; nothing here grants
-- more than that.
--
-- TEAM-SCOPED, MINOR-PROHIBITED, STANDALONE -- the same three facts every other team responsibility in
-- this catalogue already carries: `scope = 'TEAM'` (a team asks for this, not a club), `minor_prohibited
-- = true` (the same rule the existing Coach/Team Manager/Volunteer rows already enforce, and `grant_role`
-- already refuses an unknown-DOB person the same as a known minor for any of them), and no
-- `requires_base_role` -- First Aider does not rest on already holding Coach or Team Manager, unlike
-- Team Administration, because the owner's brief is explicit that it must coexist with either, with
-- neither, with being a player (where age permits) or with being a guardian, not depend on one of them.
insert into public.role_definitions (role_key, scope, label, bundle_key, visible, requires_base_role, minor_prohibited, assignable_by, is_primary_seat)
values ('FIRST_AIDER', 'TEAM', 'First Aider', 'VO', true, null, true, array['SITE', 'CLUB', 'TEAM_ADMIN'], false)
on conflict (role_key) do nothing;
