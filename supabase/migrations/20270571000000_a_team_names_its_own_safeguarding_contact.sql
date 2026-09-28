-- TEAM SAFEGUARDING LEAD -- a team-scoped, minor-prohibited staff responsibility (Team Profile Section 4
-- addendum, owner-specified). The owner asked for this to be a genuinely distinct thing from the
-- existing club-scoped `SAFEGUARDING_OFFICER`, not the same role wearing a team-facing label.
--
-- AUDIT FIRST (owner's own instruction): `role_definitions` was read before writing this migration.
-- No team-scoped safeguarding role exists under any name. `SAFEGUARDING_OFFICER` is `scope = 'CLUB'`,
-- `assignable_by = {SITE}` only, and carries club-officer authority (welfare lookups, dispensations,
-- the club's reported-messages queue, correcting the club's own safeguarding contact card) that
-- `docs/architecture/safeguarding-officer-model.md` describes as deliberately one seat per club. None
-- of that is reused here. TEAM_SAFEGUARDING_LEAD is a new, separate role_definitions row.
--
-- MINIMUM LEGITIMATE DEFAULT AUTHORITY, reusing the SAME "VO" (Volunteer) bundle FIRST_AIDER already
-- reuses (`20270568000000_first_aider_is_a_real_team_role.sql`) rather than inventing a new one or
-- borrowing anything from the "SO" bundle. That bundle holds nothing but *.view capabilities plus
-- exactly one exception, `safeguarding.conversation.start` (enforced by `guard_bundle_capability`,
-- 20270349000000) -- a Team Safeguarding Lead can see the club's own safeguarding contact and start a
-- safeguarding conversation, precisely "a team-level safeguarding CONTACT", and holds no welfare
-- lookup, no dispensation, no reported-message queue, no officer contact-edit authority: those stay
-- exactly where they already are, on the confirmed club Safeguarding Officer alone.
--
-- TEAM-SCOPED, MINOR-PROHIBITED, STANDALONE, DELEGABLE -- the same shape as Coach/Team Manager/First
-- Aider: `scope = 'TEAM'`, `minor_prohibited = true` (grant_role already refuses an unknown-DOB person
-- the same as a known minor for every role in this family), no `requires_base_role`, and
-- `assignable_by = {SITE, CLUB, TEAM_ADMIN}` so a delegated team manager can appoint one without
-- reaching Site Admin, exactly like every other team staff responsibility already does.
insert into public.role_definitions (role_key, scope, label, bundle_key, visible, requires_base_role, minor_prohibited, assignable_by, is_primary_seat)
values ('TEAM_SAFEGUARDING_LEAD', 'TEAM', 'Team Safeguarding Lead', 'VO', true, null, true, array['SITE', 'CLUB', 'TEAM_ADMIN'], false)
on conflict (role_key) do nothing;

comment on function public.team_staff(uuid) is
  'One row per person holding at least one active team role on this team, with every active role they '
  'hold on it -- never one row per role. Same team.roster.view gate team_people already uses for the '
  'same roster. Section 4. Role vocabulary now includes TEAM_SAFEGUARDING_LEAD (20270571000000), a '
  'team-scoped safeguarding CONTACT distinct from the club-scoped, Site-only SAFEGUARDING_OFFICER.';
