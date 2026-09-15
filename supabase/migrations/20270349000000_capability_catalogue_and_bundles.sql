-- IDENTITY/AUTH SLICE 3 (1 of 3): THE CANONICAL CAPABILITY CATALOGUE AND ROLE BUNDLES
-- Phase 2 design J (catalogue), R (site profiles), Y.6 / Y.8 (schema), AF (backfill).
--
-- Before this migration Ovalball held two permission descriptions that disagreed:
-- role_capability_defaults (what has_capability enforced) and permission_group_capabilities
-- (a documentation list nothing enforced). This migration replaces both with ONE catalogue:
--
--   capabilities           every key, with the metadata that governs it (scopes, inheritance,
--                          grant/revoke level, delegation, AAL, safeguarding, minors, impersonation)
--   capability_bundles     the named bundles: club/team roles, relationships, Site Admin profiles
--   bundle_capabilities    which bundle holds which key at which scope
--   capability_key_map     how each legacy key (and scope) resolves to a canonical key
--
-- role_capability_defaults and permission_group_capabilities become read-only projections of the
-- bundles (their rows are archived under *_legacy). permission_groups stays a table because
-- memberships reference it, but it is no longer writable from the browser.
--
-- Nothing in this migration changes who may do what: has_capability still reads the archived
-- defaults until migration 2 of this slice re-implements it over the canonical resolver.

-- ---------------------------------------------------------------------------------------------
-- 1. capabilities: the enriched record (Y.8, J.1)
-- ---------------------------------------------------------------------------------------------

alter table public.capabilities drop constraint capabilities_applicable_scopes_valid;
alter table public.capabilities drop constraint capabilities_category_check;
alter table public.capabilities rename column applicable_scopes to valid_scopes;
alter table public.capabilities alter column valid_scopes drop default;
-- Compatibility: the pre-Slice 3 name, generated from the canonical column, read by legacy code.
alter table public.capabilities add column applicable_scopes text[] generated always as (valid_scopes) stored;

alter table public.capabilities
  add column domain text,
  add column resource text,
  add column action text,
  add column inherits_to_team boolean not null default false,
  add column grant_level text,
  add column revoke_level text,
  add column delegable boolean not null default false,
  add column aal text,
  add column safeguarding_sensitive boolean not null default false,
  add column minor_prohibited boolean not null default true,
  add column impersonation_blocked boolean not null default false,
  add column site_master_equivalent text,
  add column server_enforcement text,
  add column db_enforcement text,
  add column legacy_key text,
  add column migration_action text,
  add column status text not null default 'ACTIVE',
  add column design_section text,
  add column site_addon_allowed boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- 2. bundles and the legacy key map (Y.6)
-- ---------------------------------------------------------------------------------------------

create table public.capability_bundles (
  bundle_key text primary key,
  label text not null,
  kind text not null check (kind in ('ROLE', 'RELATIONSHIP', 'SITE_PROFILE')),
  created_at timestamptz not null default now()
);

create table public.bundle_capabilities (
  bundle_key text not null references public.capability_bundles (bundle_key),
  capability_key text not null references public.capabilities (key) on update cascade,
  scope_type text not null check (scope_type in ('self', 'child', 'team', 'club', 'site')),
  created_at timestamptz not null default now(),
  primary key (bundle_key, capability_key, scope_type)
);
create index bundle_capabilities_capability_idx on public.bundle_capabilities (capability_key, scope_type);

create table public.capability_key_map (
  legacy_key text not null references public.capabilities (key) on update cascade,
  legacy_scope text not null check (legacy_scope in ('site', 'club', 'team')),
  capability_key text not null references public.capabilities (key) on update cascade,
  evaluated_scope text not null check (evaluated_scope in ('site', 'club', 'team')),
  primary key (legacy_key, legacy_scope)
);

-- ---------------------------------------------------------------------------------------------
-- 3. seed (generated from the Phase 2 catalogue; see the Slice 3 report, section G)
-- ---------------------------------------------------------------------------------------------

insert into public.capabilities (key, domain, resource, action, label, description, category, valid_scopes, inherits_to_team, grant_level, revoke_level, delegable, aal, safeguarding_sensitive, minor_prohibited, impersonation_blocked, server_enforcement, db_enforcement, legacy_key, migration_action, status, design_section, site_addon_allowed)
values
  ('account.profile.view', 'account', 'profile', 'view', 'View Your Profile', 'See your own Ovalball profile.', 'account', array['self']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'requireSession', 'profiles_select_self', 'profiles_select_self_or_admin', 'KEEP (admin branch → site.users.view)', 'ACTIVE', 'J.2', false),
  ('account.profile.edit', 'account', 'profile', 'edit', 'Edit Your Profile', 'Change your own name and personal details.', 'account', array['self']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'requireSession', 'column UPDATE grant + profiles_update_self', 'Phase 0 policy', 'KEEP', 'ACTIVE', 'J.2', false),
  ('account.details.complete', 'account', 'details', 'complete', 'Complete Your Account', 'Finish the details Ovalball needs before your account is ready.', 'account', array['self']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'route guard', 'RPC complete_account_details', 'complete-signup inserts', 'NEW', 'ACTIVE', 'J.2', false),
  ('account.security.manage', 'account', 'security', 'manage', 'Manage Account Security', 'Change your password, authenticator and linked sign-in methods.', 'account', array['self']::text[], false, 'N', 'N', false, 'R', false, false, true, 'requireSession({recentMinutes:10})', 'GoTrue + RPC record_security_change', 'none', 'NEW', 'ACTIVE', 'J.2', false),
  ('account.sessions.manage', 'account', 'sessions', 'manage', 'Manage Your Sessions', 'See where you are signed in and sign other devices out.', 'account', array['self']::text[], false, 'N', 'N', false, 'R', false, false, true, 'server action', 'internal.revoke_session (own)', 'global signOut', 'NEW', 'ACTIVE', 'J.2', false),
  ('account.recovery_codes.manage', 'account', 'recovery_codes', 'manage', 'Manage Recovery Codes', 'Create a new set of recovery codes for your account.', 'account', array['self']::text[], false, 'N', 'N', false, 'R', false, false, true, 'server action', 'RPC regenerate_recovery_codes', 'none', 'NEW', 'ACTIVE', 'J.2', false),
  ('account.data.export', 'account', 'data', 'export', 'Export Your Data', 'Request a copy of the personal data Ovalball holds about you.', 'account', array['self']::text[], false, 'N', 'N', false, 'R', false, true, true, 'server action', 'RPC export_my_data', 'none', 'NEW', 'ACTIVE', 'J.2', false),
  ('account.deletion.request', 'account', 'deletion', 'request', 'Request Account Deletion', 'Ask Ovalball to close and delete your account.', 'account', array['self']::text[], false, 'N', 'N', false, 'R', false, true, true, 'server action', 'RPC request_account_deletion', 'none', 'NEW', 'ACTIVE', 'J.2', false),
  ('notification.self.manage', 'notification', 'self', 'manage', 'Manage Your Notifications', 'Choose which notifications you receive.', 'notification', array['self']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'requireSession', 'own-row RLS', 'own rows', 'KEEP', 'ACTIVE', 'J.2', false),
  ('people.member.view', 'people', 'member', 'view', 'View Club Members', 'See who belongs to the club and the roles they hold.', 'people', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC club_people(club) (security-definer, column-minimal)', 'people.view (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.3', false),
  ('people.member.view_contact', 'people', 'member', 'view_contact', 'View Member Contact Details', 'See members'' contact details.', 'people', array['club']::text[], false, 'S', 'S', false, 'A2', true, true, false, 'rC', 'RPC club_member_contact', 'get_team_guardian_directory', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.invitation.create', 'people', 'invitation', 'create', 'Invite People', 'Invite staff, guardians and players to the club.', 'people', array['club']::text[], false, 'C', 'C', true, 'R', false, true, false, 'rC', 'RPC issue_invitation (kind ⊆ CLUB_STAFF)', 'invitations RLS is_club_admin', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.invitation.revoke', 'people', 'invitation', 'revoke', 'Revoke Invitations', 'Withdraw an invitation that has not been used.', 'people', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC revoke_invitation', 'UPDATE invitations', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.join_request.review', 'people', 'join_request', 'review', 'Review Join Requests', 'Approve or decline requests to join the club.', 'people', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC decide_club_join_request', 'approve_club_join_request (is_club_admin)', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.membership.suspend', 'people', 'membership', 'suspend', 'Suspend Members', 'Suspend or restore a person''s membership of the club.', 'people', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC transition_club_membership', 'people/actions.ts direct UPDATE', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.membership.revoke', 'people', 'membership', 'revoke', 'Remove Members', 'End a person''s membership of the club.', 'people', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC transition_club_membership', 'people/actions.ts', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.role.assign_club', 'people', 'role', 'assign_club', 'Assign Club Roles', 'Give or remove Club Admin, Fixtures Secretary, Volunteer and Member roles.', 'people', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC assign_role (role ∈ CLUB_ADMIN, FIXTURES_SECRETARY, VOLUNTEER, MEMBER; SO nomination only)', 'UPDATE club_memberships.role', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.role.assign_team', 'people', 'role', 'assign_team', 'Assign Team Roles', 'Give or remove Coach and Team Manager roles on a team.', 'people', array['club','team']::text[], true, 'T', 'T', true, 'R', false, true, false, 'rC', 'RPC assign_role (role ∈ COACH, TEAM_MANAGER; TA only by CA)', 'team_permissions club.roster.manage', 'NEW', 'ACTIVE', 'J.3', false),
  ('people.capability.manage', 'people', 'capability', 'manage', 'Manage Permissions', 'Allow or withhold individual permissions for people at the club.', 'people', array['club','team']::text[], true, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC set_capability_override / revoke_capability_override with level provenance', 'club.capabilities.manage, permissions.club_manage', 'MERGE (retire permissions.club_manage)', 'ACTIVE', 'J.3', false),
  ('people.access.explain', 'people', 'access', 'explain', 'Explain Access', 'See why a person can or cannot do something.', 'people', array['club','team','self']::text[], true, 'N', 'N', false, 'A2', false, false, false, 'rC', 'RPC explain_access', 'none', 'NEW', 'ACTIVE', 'J.3', false),
  ('club.profile.view', 'club', 'profile', 'view', 'View Club Information', 'See the club''s profile and member information.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'rC', 'clubs_select private columns', 'club.view (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.4', false),
  ('club.profile.edit', 'club', 'profile', 'edit', 'Edit Club Profile', 'Change the club''s profile, contact details and public visibility.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'clubs_update + RPC', 'club.edit_profile', 'RENAME', 'ACTIVE', 'J.4', false),
  ('club.logo.manage', 'club', 'logo', 'manage', 'Manage Club Logo', 'Upload, replace or remove the club''s crest.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'storage policy + RPC', 'club.logo.manage', 'KEEP', 'ACTIVE', 'J.4', false),
  ('club.settings.manage', 'club', 'settings', 'manage', 'Manage Club Settings', 'Change the club''s communication and scheduling policies.', 'club', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC (communication policy, scheduling policy)', 'mixed is_club_admin', 'NEW', 'ACTIVE', 'J.4', false),
  ('club.documents.view', 'club', 'documents', 'view', 'View Club Documents', 'Read the club''s document library.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, false, false, 'rC', 'can_view_document_library → can_CL', 'helper', 'RENAME', 'ACTIVE', 'J.4', false),
  ('club.documents.manage', 'club', 'documents', 'manage', 'Manage Club Documents', 'Add, replace and remove documents in the club''s library.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'can_manage_document_library → can_CL', 'helper', 'RENAME', 'ACTIVE', 'J.4', false),
  ('club.partners.manage', 'club', 'partners', 'manage', 'Manage Partner Clubs', 'Request, approve and end partnerships with other clubs.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'partner.manage (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.4', false),
  ('club.referrals.view', 'club', 'referrals', 'view', 'View Referrals', 'See the clubs this club has referred to Ovalball and any rewards earned.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.referrals.view', 'KEEP', 'ACTIVE', 'J.4', false),
  ('club.referrals.manage', 'club', 'referrals', 'manage', 'Manage Referrals', 'Refer another rugby club to Ovalball.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.referrals.manage', 'KEEP', 'ACTIVE', 'J.4', false),
  ('club.reporting.export', 'club', 'reporting', 'export', 'Export Club Reports', 'Export club data that includes personal information.', 'club', array['club']::text[], false, 'C', 'C', true, 'R', false, true, true, 'rC', 'RPC + security_events', 'CSV exports (unaudited)', 'NEW', 'ACTIVE', 'J.4', false),
  ('club.lifecycle.deactivate', 'club', 'lifecycle', 'deactivate', 'Deactivate Club', 'Retired at club scope: deactivating a club is a Site Admin action.', 'club', array['club']::text[], false, 'S', 'S', false, 'R', false, true, false, 'rSC', 'RPC deactivate_club', 'bare is_site_admin', 'RETIRE club key → site', 'DEPRECATED', 'J.4', false),
  ('club.claim.submit', 'club', 'claim', 'submit', 'Claim a Club', 'Ask Ovalball to confirm you may run a club''s account.', 'club', array['self']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'server', 'RPC submit_club_claim', 'self-insert club_claims', 'NEW', 'ACTIVE', 'J.4', false),
  ('club.news.manage', 'club', 'news', 'manage', 'Manage Club News', 'Write, publish and archive the club''s news and announcements, including news for every team at the club.', 'club', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'internal.may_edit_club_content', 'club.news.manage', 'KEEP', 'ACTIVE', 'Club', false),
  ('team.news.manage', 'team', 'news', 'manage', 'Manage Team News', 'Write, publish and archive news and announcements for one team.', 'team', array['team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'internal.may_edit_club_content', 'team.news.manage', 'KEEP', 'ACTIVE', 'Club', false),
  ('team.team.view', 'team', 'team', 'view', 'View Teams', 'See the club''s teams and their details.', 'team', array['club','team']::text[], true, 'C', 'C', true, 'A2', false, false, false, 'rC', 'teams_select', 'team.view', 'RENAME (no roster implied; rosters are team.roster.view)', 'ACTIVE', 'J.5', false),
  ('team.team.manage', 'team', 'team', 'manage', 'Manage Teams', 'Create teams and edit their details.', 'team', array['club','team']::text[], true, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.teams.manage, team.manage', 'MERGE', 'ACTIVE', 'J.5', false),
  ('team.lifecycle.manage', 'team', 'lifecycle', 'manage', 'Fold or Reactivate Teams', 'Fold a team, cancelling its future fixtures, or bring a folded team back.', 'team', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC fold_team, graduate_team, reactivate_team', 'club.team_lifecycle.manage', 'RENAME', 'ACTIVE', 'J.5', false),
  ('team.roster.view', 'team', 'roster', 'view', 'View Team Rosters', 'See the players and people on a team.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC team_people (Phase 0 gate → can_TE)', 'team.view / Phase 0 gate', 'NEW (replaces Phase 0 composite)', 'ACTIVE', 'J.5', false),
  ('team.roster.manage', 'team', 'roster', 'manage', 'Manage Team Rosters', 'Add players to a team, move them and end their places.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC add_player_to_team, archive_player_team_membership, decide_player_team_membership', 'club.roster.manage, team.roster.manage', 'MERGE', 'ACTIVE', 'J.5', false),
  ('team.join_request.review', 'team', 'join_request', 'review', 'Review Team Join Requests', 'Approve or decline requests to join a team.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC decide_team_join_request', 'may_resolve_join_request', 'NEW', 'ACTIVE', 'J.5', false),
  ('team.join_code.manage', 'team', 'join_code', 'manage', 'Manage Team Join Codes', 'Issue and withdraw a team''s join code.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC issue_team_join_code / revoke_invitation', 'none', 'NEW', 'ACTIVE', 'J.5', false),
  ('team.attendance.view', 'team', 'attendance', 'view', 'View Team Attendance', 'View the attendance summary and per-player responses for a team.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC', 'team.attendance.view', 'KEEP', 'ACTIVE', 'J.5', false),
  ('team.handover.prepare', 'team', 'handover', 'prepare', 'Prepare Season Handover', 'Draft how teams and players move into the next season.', 'team', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC generate_rollover_proposal etc.', 'club.season_rollover.manage (unenforced) + can_manage_club_fixtures', 'SPLIT + enforce', 'ACTIVE', 'J.5', false),
  ('team.handover.apply', 'team', 'handover', 'apply', 'Apply Season Handover', 'Apply the prepared season handover.', 'team', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC apply_season_handover', 'same', 'SPLIT + enforce', 'ACTIVE', 'J.5', false),
  ('team.graduation.place', 'team', 'graduation', 'place', 'Place Graduating Players', 'Place a player from the graduation queue onto a team.', 'team', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC place_graduating_player', 'place_graduating_players', 'RENAME', 'ACTIVE', 'J.5', false),
  ('team.mini_rugby_group.manage', 'team', 'mini_rugby_group', 'manage', 'Manage Mini-Rugby Groups', 'Create and edit the club''s Mini-Rugby scheduling groups.', 'team', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'manage_mini_rugby_groups', 'RENAME', 'ACTIVE', 'J.5', false),
  ('player.profile.view', 'player', 'profile', 'view', 'View Player Profiles', 'See a player''s profile.', 'player', array['self','child','team','club']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'rC', 'players_select + view player_staff_view (no DOB for staff; age grade only)', 'players_select', 'NEW (column-limited)', 'ACTIVE', 'J.6', false),
  ('player.profile.edit', 'player', 'profile', 'edit', 'Edit Player Details', 'Change a player''s details.', 'player', array['self','child']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC update_player_details', 'may_complete_player_profile', 'NEW', 'ACTIVE', 'J.6', false),
  ('player.profile.edit_protected', 'player', 'profile', 'edit_protected', 'Record Protected Player Details', 'Record a player''s gender or correct their date of birth.', 'player', array['self','child','site']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC set_player_playing_pathway / correct_player_identity', 'may_complete_player_profile', 'KEEP rule', 'ACTIVE', 'J.6', false),
  ('player.pathway.request', 'player', 'pathway', 'request', 'Ask for a Player''s Gender', 'Ask a player''s guardian to record the player''s gender.', 'player', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC request_player_playing_pathway', 'same', 'KEEP', 'ACTIVE', 'J.6', false),
  ('player.account.invite', 'player', 'account', 'invite', 'Invite a Player to Their Own Account', 'Invite your child to sign in to Ovalball themselves.', 'player', array['child']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC issue_invitation(kind PLAYER_ACCOUNT)', 'invite_player_account', 'NEW', 'ACTIVE', 'J.6', false),
  ('player.account.link', 'player', 'account', 'link', 'Link Your Player Record', 'Connect your account to the player record you were invited to.', 'player', array['self']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'server', 'RPC redeem_invitation', 'accept_player_account_invitation (Phase 0 bound)', 'NEW', 'ACTIVE', 'J.6', false),
  ('player.self_register', 'player', 'self_register', '', 'Register as a Player', 'Create your own adult player profile.', 'player', array['self']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'server', 'RPC create_own_player_profile (+ age check)', 'same', 'KEEP + age gate', 'ACTIVE', 'J.6', false),
  ('family.child.add', 'family', 'child', 'add', 'Add a Child', 'Add a child to your family.', 'family', array['self']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC add_child → relationship PENDING_APPROVAL unless invitation-sourced', 'add_child_for_guardian', 'NEW behaviour', 'ACTIVE', 'J.6', false),
  ('family.relationship.request', 'family', 'relationship', 'request', 'Request a Family Link', 'Ask to be linked to a child as their parent or guardian.', 'family', array['self','child']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC request_child_link, request_additional_guardian', 'same', 'KEEP', 'ACTIVE', 'J.6', false),
  ('family.relationship.approve', 'family', 'relationship', 'approve', 'Approve Family Links', 'Approve or decline a request to link a guardian to a child.', 'family', array['club','team']::text[], true, 'T', 'T', true, 'R', true, true, false, 'rC', 'RPC decide_guardian_link_request (requester never decides; ADDITIONAL_GUARDIAN = CL only, Phase 0)', 'club.guardians.manage', 'RENAME', 'ACTIVE', 'J.6', false),
  ('family.relationship.remove', 'family', 'relationship', 'remove', 'Remove Family Links', 'End a guardian''s relationship with a child.', 'family', array['child','club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC end_guardian_relationship', 'remove_guardian_relationship', 'NEW', 'ACTIVE', 'J.6', false),
  ('family.invitation.create', 'family', 'invitation', 'create', 'Invite Parents and Guardians', 'Invite a parent or guardian to a team.', 'family', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC issue_invitation(kind GUARDIAN) naming team and optionally a child', 'team.guardians.invite', 'RENAME', 'ACTIVE', 'J.6', false),
  ('family.permission.manage', 'family', 'permission', 'manage', 'Manage Family Permissions', 'Decide what your child may do in Ovalball.', 'family', array['child']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC set_guardian_player_permission', 'same', 'KEEP', 'ACTIVE', 'J.6', false),
  ('family.duplicate.resolve', 'family', 'duplicate', 'resolve', 'Resolve Duplicate Players', 'Decide whether two player records are the same child.', 'family', array['club']::text[], false, 'C', 'C', true, 'R', true, true, false, 'rC', 'RPC resolve_player_duplicate', 'player_duplicate_reviews', 'NEW gate', 'ACTIVE', 'J.6', false),
  ('fixture.fixture.view', 'fixture', 'fixture', 'view', 'View Fixtures', 'See fixtures and results.', 'fixture', array['club','team','child']::text[], true, 'T', 'T', true, 'A2', false, false, false, 'rC', 'fixture_visible_row → can_TE / can_LC', 'fixture.view (unenforced), fixture_visible_row', 'RENAME + enforce', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.create', 'fixture', 'fixture', 'create', 'Create Fixtures', 'Arrange a single new match.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RLS fixtures_insert → can_TE; RPC create_fixture', 'fixture.create + can_manage_fixture_side', 'MERGE (removes the direct-insert bypass)', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.edit', 'fixture', 'fixture', 'edit', 'Edit Fixtures', 'Change a match''s date, kick-off, venue or opposition.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC update_fixture_details / update_fixture_schedule (RLS direct UPDATE removed)', 'fixture.edit + legacy', 'MERGE', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.cancel', 'fixture', 'fixture', 'cancel', 'Cancel Fixtures', 'Call a match off, with a reason.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC cancel_fixture', 'fixture.cancel (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.archive', 'fixture', 'fixture', 'archive', 'Archive Fixtures', 'Archive or restore a fixture.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC archive_fixture / restore_fixture', 'legacy', 'NEW', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.delete', 'fixture', 'fixture', 'delete', 'Delete Draft Fixtures', 'Delete a draft fixture that has no result.', 'fixture', array['club']::text[], false, 'C', 'C', true, 'R', false, true, false, 'rC', 'RPC delete_fixture', 'bare is_site_admin', 'NEW', 'ACTIVE', 'J.7', false),
  ('fixture.fixture.bulk_edit', 'fixture', 'fixture', 'bulk_edit', 'Bulk Edit Fixtures', 'Change many fixtures in one action.', 'fixture', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'fixture.bulk_edit (team defaults removed)', 'RENAME (team defaults removed)', 'ACTIVE', 'J.7', false),
  ('fixture.planner.use', 'fixture', 'planner', 'use', 'Use the Season Planner', 'Plan a season of fixtures in the Season Planner.', 'fixture', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'can_bulk_plan_fixtures → can_CL', 'can_bulk_plan_fixtures', 'NEW key (bulk authority stays club-only)', 'ACTIVE', 'J.7', false),
  ('fixture.import.run', 'fixture', 'import', 'run', 'Import Fixtures', 'Upload, stage and publish a fixture list from a file.', 'fixture', array['club']::text[], false, 'C', 'C', true, 'R', false, true, false, 'rC', 'RPCs stage_import, publish_import_row → can_CL', 'fixture.import (app-only)', 'RENAME + enforce', 'ACTIVE', 'J.7', false),
  ('fixture.request.create', 'fixture', 'request', 'create', 'Send Fixture Requests', 'Ask another club to arrange a match.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC create_fixture_request', 'can_manage_team', 'NEW', 'ACTIVE', 'J.7', false),
  ('fixture.request.respond', 'fixture', 'request', 'respond', 'Respond to Fixture Requests', 'Accept, decline or ask to change a fixture request.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC accept_fixture_request / decline… / request_change…', 'fixture.manage_requests + legacy', 'SPLIT', 'ACTIVE', 'J.7', false),
  ('fixture.result.record', 'fixture', 'result', 'record', 'Record Results', 'Submit a match result.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC submit_fixture_result', 'can_submit_fixture_result', 'NEW', 'ACTIVE', 'J.7', false),
  ('fixture.result.dispute_resolve', 'fixture', 'result', 'dispute_resolve', 'Resolve Result Disputes', 'Retired at club scope: resolving a disputed result is a Site Admin action.', 'fixture', array['site']::text[], false, 'S', 'S', false, 'R', false, true, false, 'rSC', 'RPC resolve_fixture_result_dispute', 'fixture_ops literal', 'RETIRE club key → site', 'DEPRECATED', 'J.7', false),
  ('fixture.callup.request', 'fixture', 'callup', 'request', 'Request Call-Ups', 'Ask to call a player up onto a team for a fixture.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC request_player_call_up', 'manage_fixture_callups', 'RENAME', 'ACTIVE', 'J.7', false),
  ('fixture.callup.approve', 'fixture', 'callup', 'approve', 'Approve Call-Ups', 'Approve, reject or revoke a player call-up.', 'fixture', array['club']::text[], false, 'C', 'C', true, 'R', true, true, false, 'rC', 'RPC decide_player_call_up', 'approve_fixture_callups', 'RENAME (team defaults removed)', 'ACTIVE', 'J.7', false),
  ('fixture.dispensation.request', 'fixture', 'dispensation', 'request', 'Request Dispensations', 'Ask for a player to play outside their age grade.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC request_player_dispensation', 'manage_player_dispensations', 'RENAME', 'ACTIVE', 'J.7', false),
  ('fixture.dispensation.approve_team', 'fixture', 'dispensation', 'approve_team', 'Give Team Dispensation Approval', 'Approve a dispensation as the team lending the player.', 'fixture', array['team']::text[], false, 'T', 'T', true, 'R', true, true, false, 'rC', 'RPC decide_player_dispensation(stage TEAM)', 'approve_player_dispensations', 'SPLIT', 'ACTIVE', 'J.7', false),
  ('fixture.dispensation.approve_club', 'fixture', 'dispensation', 'approve_club', 'Give Club Dispensation Approval', 'Approve a dispensation for the club.', 'fixture', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC decide_player_dispensation(stage CLUB); the approver may not be the requester (separation of duties)', 'approve_player_dispensations', 'SPLIT', 'ACTIVE', 'J.7', false),
  ('fixture.communication.send', 'fixture', 'communication', 'send', 'Send Fixture Messages', 'Message the people involved in a fixture.', 'fixture', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC send_fixture_communication', 'messages.fixture_send (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.7', false),
  ('matchcentre.fixture.view', 'matchcentre', 'fixture', 'view', 'View Match Centre', 'Open a fixture''s Match Centre.', 'matchcentre', array['club','team','child']::text[], true, 'N', 'N', false, 'A2', false, false, false, 'rC', 'RPC get_match_centre_capabilities', 'same', 'KEEP', 'ACTIVE', 'J.7', false),
  ('matchcentre.attendance.respond', 'matchcentre', 'attendance', 'respond', 'Respond to Attendance', 'Say whether you or your child can play.', 'matchcentre', array['self','child']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'rC', 'RPC respond_to_attendance', 'same', 'KEEP', 'ACTIVE', 'J.7', false),
  ('competition.public.view', 'competition', 'public', 'view', 'View Public Competitions', 'See published competitions.', 'competition', array['public']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'none', 'published-edition RLS', 'competition_edition_is_public', 'KEEP', 'ACTIVE', 'J.8', false),
  ('competition.competition.create', 'competition', 'competition', 'create', 'Create Competitions', 'Create a competition organised by the club.', 'competition', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC create_competition (club organiser) → can_CL', 'can_bulk_plan_fixtures', 'NEW key', 'ACTIVE', 'J.8', false),
  ('competition.edition.manage', 'competition', 'edition', 'manage', 'Manage Competition Editions', 'Edit a competition edition the club organises.', 'competition', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'require_edition_organiser → can_CL', 'require_edition_organiser', 'NEW', 'ACTIVE', 'J.8', false),
  ('competition.creator.use', 'competition', 'creator', 'use', 'Use the Competition Creator', 'Generate a competition''s groups, fixtures and knockout rounds.', 'competition', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'Creator RPCs → can_CL', 'can_bulk_plan_fixtures', 'NEW (bulk = club-only)', 'ACTIVE', 'J.8', false),
  ('competition.edition.issue', 'competition', 'edition', 'issue', 'Issue Competitions', 'Issue a competition edition to the participating clubs.', 'competition', array['club']::text[], false, 'C', 'C', true, 'R', false, true, false, 'rC', 'RPC issue_competition_edition', 'same', 'NEW', 'ACTIVE', 'J.8', false),
  ('competition.match.record_result', 'competition', 'match', 'record_result', 'Record Competition Results', 'Record results for a competition the club organises.', 'competition', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'require_edition_organiser', 'NEW', 'ACTIVE', 'J.8', false),
  ('competition.match.respond', 'competition', 'match', 'respond', 'Respond to Competition Matches', 'Confirm, ask to change or decline a competition match.', 'competition', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC answer_competition_match', 'can_answer_competition_match', 'RENAME', 'ACTIVE', 'J.8', false),
  ('tournament.tournament.view', 'tournament', 'tournament', 'view', 'View Tournaments', 'See tournaments the club takes part in.', 'tournament', array['club','team']::text[], true, 'N', 'N', false, 'A2', false, false, false, 'rC', 'tournament_visible_row', 'same', 'KEEP', 'ACTIVE', 'J.8', false),
  ('tournament.tournament.manage', 'tournament', 'tournament', 'manage', 'Manage Tournaments', 'Create and run tournaments.', 'tournament', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'can_manage_tournament → can_CL', 'calendar.manage', 'NEW key', 'ACTIVE', 'J.8', false),
  ('site.competitions.manage', 'site', 'competitions', 'manage', 'Manage Competitions', 'Write to the global Competition Directory.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', 'can_manage_competitions → has_site_capability', 'site.competitions.manage flag', 'KEEP', 'ACTIVE', 'J.8', true),
  ('calendar.event.view', 'calendar', 'event', 'view', 'View Calendar', 'See club, team and fixture events on the calendar.', 'calendar', array['club','team','child']::text[], true, 'C', 'C', true, 'A2', false, false, false, 'rC', 'club_event_visible_row → can', 'calendar.view (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.9', false),
  ('calendar.event.manage', 'calendar', 'event', 'manage', 'Manage Calendar', 'Create and change calendar events.', 'calendar', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'can_manage_club_event → can', 'calendar.manage', 'RENAME', 'ACTIVE', 'J.9', false),
  ('venue.venue.view', 'venue', 'venue', 'view', 'View Venues', 'See the club''s venues.', 'venue', array['club']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'rC', 'venues_select (members); public projection public_venues (explicit public fields only)', 'SELECT true (anon)', 'NEW (closes M-2)', 'ACTIVE', 'J.9', false),
  ('venue.venue.manage', 'venue', 'venue', 'manage', 'Manage Venues', 'Add, edit or deactivate the club''s venues.', 'venue', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RLS + RPCs create_venue etc. → can_CL (unified)', 'club.venues.manage vs role RPC', 'RENAME + unify', 'ACTIVE', 'J.9', false),
  ('venue.pitch.manage', 'venue', 'pitch', 'manage', 'Manage Pitches', 'Add, edit or deactivate the club''s pitches.', 'venue', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RLS + RPCs → can_CL', 'club.pitches.manage vs role RPC', 'RENAME + unify', 'ACTIVE', 'J.9', false),
  ('venue.pitch_allocation.view', 'venue', 'pitch_allocation', 'view', 'View Pitch Allocation', 'See how pitches are allocated.', 'venue', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'fixture.edit', 'NEW', 'ACTIVE', 'J.9', false),
  ('venue.pitch_allocation.manage', 'venue', 'pitch_allocation', 'manage', 'Manage Pitch Allocation', 'Allocate pitches to fixtures and training.', 'venue', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC → can_CL', 'fixture.edit', 'NEW', 'ACTIVE', 'J.9', false),
  ('training.session.view', 'training', 'session', 'view', 'View Training', 'See training sessions.', 'training', array['club','team','child']::text[], true, 'N', 'N', false, 'A2', true, false, false, 'rC', 'training_session_visible_row; plans and schedule rules no longer anon', 'public SELECT', 'NEW (closes M-2)', 'ACTIVE', 'J.9', false),
  ('training.plan.manage', 'training', 'plan', 'manage', 'Manage Training Plans', 'Create, change and end training plans.', 'training', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC → can', 'club.training.manage, team.training.manage', 'MERGE', 'ACTIVE', 'J.9', false),
  ('training.session.cancel', 'training', 'session', 'cancel', 'Cancel Training', 'Cancel a training session.', 'training', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC cancel_training_session', 'can_manage_training', 'NEW', 'ACTIVE', 'J.9', false),
  ('training.communication.send', 'training', 'communication', 'send', 'Send Training Messages', 'Message the people involved in a training session.', 'training', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'RPC', 'legacy', 'NEW', 'ACTIVE', 'J.9', false),
  ('messaging.fixture_conversation.participate', 'messaging', 'fixture_conversation', 'participate', 'Take Part in Fixture Conversations', 'Read and send messages in a fixture''s conversation.', 'messaging', array['club','team']::text[], true, 'T', 'T', true, 'A2', false, true, false, 'rC', 'can_access_fixture_conversation → can (Site Admin blanket read removed)', 'same + is_site_admin', 'NEW', 'ACTIVE', 'J.10', false),
  ('messaging.team_conversation.view', 'messaging', 'team_conversation', 'view', 'View Team Conversations', 'Read a team''s conversation.', 'messaging', array['team','child']::text[], false, 'T', 'T', true, 'A2', true, false, false, 'rC', 'can_view_team_conversation', 'same', 'KEEP logic', 'ACTIVE', 'J.10', false),
  ('messaging.team_conversation.send', 'messaging', 'team_conversation', 'send', 'Send Team Conversation Messages', 'Post in a team''s conversation.', 'messaging', array['team','child']::text[], false, 'T', 'T', true, 'A2', true, false, false, 'rC', 'can_send_team_conversation', 'same', 'KEEP', 'ACTIVE', 'J.10', false),
  ('messaging.announcement.send_club', 'messaging', 'announcement', 'send_club', 'Send Club Announcements', 'Send an announcement to the whole club.', 'messaging', array['club']::text[], false, 'C', 'C', true, 'A2', true, true, false, 'rC', 'RPC may_send_as → can_CL', 'team.community.manage (club)', 'SPLIT', 'ACTIVE', 'J.10', false),
  ('messaging.announcement.send_team', 'messaging', 'announcement', 'send_team', 'Send Team Announcements', 'Send an announcement to a team.', 'messaging', array['club','team']::text[], true, 'T', 'T', true, 'A2', true, true, false, 'rC', 'RPC may_send_as → can_TE', 'team.community.manage', 'SPLIT', 'ACTIVE', 'J.10', false),
  ('messaging.club_conversation.manage', 'messaging', 'club_conversation', 'manage', 'Manage Club Conversations', 'Start and answer conversations with other clubs.', 'messaging', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC start_or_get_club_conversation, respond_to_club_conversation', 'legacy', 'NEW', 'ACTIVE', 'J.10', false),
  ('messaging.policy.manage', 'messaging', 'policy', 'manage', 'Manage Messaging Policy', 'Change the club''s messaging rules.', 'messaging', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC update_club_message_policy', 'is_club_admin', 'NEW', 'ACTIVE', 'J.10', false),
  ('messaging.block.manage', 'messaging', 'block', 'manage', 'Manage Message Blocks', 'Stop or allow a person messaging the club.', 'messaging', array['club']::text[], false, 'C', 'C', true, 'A2', true, true, false, 'rC', 'RPC block_user_from_club_messages / lift_club_message_block', 'legacy', 'NEW', 'ACTIVE', 'J.10', false),
  ('messaging.direct.send', 'messaging', 'direct', 'send', 'Send Direct Messages', 'Message another adult who shares a club or team with you.', 'messaging', array['self']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC', 'same', 'KEEP', 'ACTIVE', 'J.10', false),
  ('messaging.report.submit', 'messaging', 'report', 'submit', 'Report Messages', 'Report a message to the club and to Ovalball.', 'messaging', array['self']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'rC', 'RPC report_message → routed to SO queue + Ovalball moderation', 'report → support', 'NEW routing', 'ACTIVE', 'J.10', false),
  ('messaging.moderation.club_review', 'messaging', 'moderation', 'club_review', 'Review Reported Messages', 'Review messages reported at the club.', 'messaging', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC club_message_reports', 'none', 'NEW', 'ACTIVE', 'J.10', false),
  ('site.messages.moderate', 'site', 'messages', 'moderate', 'Moderate Messages', 'Review reported threads and take moderation action.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', 'RPCs admin_get_message_thread_content (reason + event), moderator_delete_message', 'message_moderator literal', 'RENAME', 'ACTIVE', 'J.10', false),
  ('site.messages.policy.manage', 'site', 'messages', 'policy.manage', 'Manage Global Messaging Policy', 'Change Ovalball''s platform-wide messaging rules.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', 'RPC update_global_message_policy', 'is_full_site_admin', 'NEW', 'ACTIVE', 'J.10', false),
  ('hub.content.view_published', 'hub', 'content', 'view_published', 'View Rugby Hub', 'Read published Rugby Hub content.', 'hub', array['public']::text[], false, 'N', 'N', false, 'A2', false, false, false, 'none', 'published RLS', 'same', 'KEEP', 'ACTIVE', 'J.11', false),
  ('site.hub.view', 'site', 'hub', 'view', 'View Rugby Hub Administration', 'Read Rugby Hub content, including drafts and review state.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', 'hub_* draft RLS → has_site_capability', 'site.hub_content.view', 'RENAME', 'ACTIVE', 'J.11', true),
  ('site.hub.manage', 'site', 'hub', 'manage', 'Manage Rugby Hub Content', 'Create, edit, review, publish and archive Rugby Hub content.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', 'RPC/RLS', 'site.hub_content.manage', 'RENAME', 'ACTIVE', 'J.11', true),
  ('site.regulatory.view', 'site', 'regulatory', 'view', 'View Regulatory Content Administration', 'Read regulatory sources, facts, conflicts and draft content.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', 'RLS', 'site.regulatory.view', 'KEEP', 'ACTIVE', 'J.11', true),
  ('site.regulatory.manage', 'site', 'regulatory', 'manage', 'Manage Regulatory Content', 'Create, verify, publish and supersede regulatory content.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', 'RPC', 'site.regulatory.manage', 'KEEP', 'ACTIVE', 'J.11', true),
  ('safeguarding.contact.view', 'safeguarding', 'contact', 'view', 'View Safeguarding Contact', 'See who to contact about a safeguarding concern at the club.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'rC', 'RPC club_safeguarding_contact (name, role, contact route only)', 'club.safeguarding.view (CA only; parents hidden)', 'RENAME + widen visibility', 'ACTIVE', 'J.12', false),
  ('safeguarding.officer.nominate', 'safeguarding', 'officer', 'nominate', 'Nominate Safeguarding Officers', 'Nominate a person as the club''s Safeguarding Officer.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC nominate_safeguarding_officer → issue_invitation(kind SAFEGUARDING_OFFICER)', 'club.safeguarding.manage_contact', 'SPLIT', 'ACTIVE', 'J.12', false),
  ('safeguarding.officer.confirm', 'safeguarding', 'officer', 'confirm', 'Confirm Safeguarding Officers', 'Confirm a nominated Safeguarding Officer.', 'safeguarding', array['site']::text[], false, 'S', 'S', false, 'R', true, true, false, 'rSC', 'RPC confirm_safeguarding_officer', 'none', 'NEW (AN-6)', 'ACTIVE', 'J.12', false),
  ('safeguarding.officer.deactivate', 'safeguarding', 'officer', 'deactivate', 'Deactivate Safeguarding Officers', 'End a Safeguarding Officer''s appointment.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC transition_role_assignment', 'club.safeguarding.manage_contact', 'SPLIT', 'ACTIVE', 'J.12', false),
  ('safeguarding.officer.contact_edit', 'safeguarding', 'officer', 'contact_edit', 'Edit Your Officer Contact Details', 'Change the contact details shown for you as Safeguarding Officer.', 'safeguarding', array['self']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'rC', 'RPC', 'Club Admin edits', 'NEW', 'ACTIVE', 'J.12', false),
  ('safeguarding.conversation.start', 'safeguarding', 'conversation', 'start', 'Contact the Safeguarding Officer', 'Start a confidential conversation with the club''s Safeguarding Officer.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'A2', true, false, false, 'rC', 'RPC start_safeguarding_conversation', 'club.safeguarding.message (CA only)', 'RENAME + widen', 'ACTIVE', 'J.12', false),
  ('safeguarding.conversation.handle', 'safeguarding', 'conversation', 'handle', 'Handle Safeguarding Conversations', 'Read and answer safeguarding conversations.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'A2', true, true, true, 'rC', 'RLS safeguarding_conversation_visible → active SO or participant', 'officer_user_id', 'NEW', 'ACTIVE', 'J.12', false),
  ('safeguarding.dispensation.view', 'safeguarding', 'dispensation', 'view', 'View Dispensations', 'See the club''s player dispensation records.', 'safeguarding', array['club']::text[], false, 'S', 'S', false, 'A2', true, true, false, 'rC', 'RLS/RPC', 'club.dispensation.view (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.12', false),
  ('safeguarding.dispensation.notify', 'safeguarding', 'dispensation', 'notify', 'Receive Dispensation Notifications', 'Be told about dispensation activity at the club.', 'safeguarding', array['club']::text[], false, 'S', 'S', false, 'A2', true, true, false, '—', 'notification resolver', 'club.dispensation.notify', 'RENAME (bundle default instead of per-officer override)', 'ACTIVE', 'J.12', false),
  ('safeguarding.transfer.view', 'safeguarding', 'transfer', 'view', 'View Transfer Safeguarding Information', 'See safeguarding-relevant player movement at the club.', 'safeguarding', array['club']::text[], false, 'S', 'S', false, 'A2', true, true, false, 'rC', 'RPC', 'club.transfer.safeguarding_view (unenforced)', 'RENAME + enforce', 'ACTIVE', 'J.12', false),
  ('safeguarding.transfer.notify', 'safeguarding', 'transfer', 'notify', 'Receive Transfer Safeguarding Notifications', 'Be told about safeguarding-relevant player movement.', 'safeguarding', array['club']::text[], false, 'S', 'S', false, 'A2', true, true, false, '—', 'notification resolver', 'club.transfer.safeguarding_notify', 'RENAME', 'ACTIVE', 'J.12', false),
  ('safeguarding.welfare.view', 'safeguarding', 'welfare', 'view', 'View Member Welfare Details', 'See a member''s team, guardian contact route and consent state.', 'safeguarding', array['club']::text[], false, 'N', 'N', false, 'R', true, true, false, 'rC', 'RPC welfare_member_view (name, team, guardian contact route, consent state) + event', 'none', 'NEW', 'ACTIVE', 'J.12', false),
  ('site.safeguarding.review', 'site', 'safeguarding', 'review', 'Review Safeguarding Conversations', 'Open a club''s safeguarding conversation for review, with a reason.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', 'RPC review_safeguarding_conversation(reason) + event; replaces RLS blanket read', 'is_site_admin RLS', 'NEW', 'ACTIVE', 'J.12', true),
  ('finance.subscription.view', 'finance', 'subscription', 'view', 'View Finance Dashboard', 'See the club''s subscriptions, revenue and payment statistics.', 'finance', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.subscription.view_finance', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.subscription.configure', 'finance', 'subscription', 'configure', 'Configure Club Subscriptions', 'Turn club subscriptions on or off and set prices and collection days.', 'finance', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC', 'club.subscription.configure', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.enrolment.manage', 'finance', 'enrolment', 'manage', 'Manage Subscription Enrolment', 'Invite payers, change the responsible payer and record exemptions.', 'finance', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.subscription.manage_enrolment', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.payment.act', 'finance', 'payment', 'act', 'Manage Payment Actions', 'Retry a failed payment, cancel a subscription or apply a refund.', 'finance', array['club']::text[], false, 'N', 'N', false, 'R', false, true, true, 'rC + server-only token (Phase 0 helper)', 'service_role token functions re-check the key', 'club.subscription.manage_payment_actions', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.subscription.export', 'finance', 'subscription', 'export', 'Export Subscription Data', 'Export the club''s subscriber and payment records.', 'finance', array['club']::text[], false, 'C', 'C', true, 'R', false, true, true, 'rC', 'RPC + event', 'club.subscription.export', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.gocardless.connect', 'finance', 'gocardless', 'connect', 'Connect GoCardless', 'Connect or disconnect the club''s GoCardless account.', 'finance', array['club']::text[], false, 'N', 'N', false, 'R', false, true, true, 'rC', 'server OAuth route', 'club.gocardless.connect', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.platform_billing.view', 'finance', 'platform_billing', 'view', 'View Ovalball Billing', 'See the club''s own Ovalball trial and subscription.', 'finance', array['club']::text[], false, 'C', 'C', true, 'A2', false, true, false, 'rC', 'RPC', 'club.platform_billing.view', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.platform_billing.manage', 'finance', 'platform_billing', 'manage', 'Manage Ovalball Billing', 'Start, pause and manage the club''s Ovalball subscription.', 'finance', array['club']::text[], false, 'N', 'N', false, 'R', false, true, false, 'rC', 'RPC', 'club.platform_billing.manage', 'RENAME', 'ACTIVE', 'J.13', false),
  ('finance.payer.self', 'finance', 'payer', 'self', 'Pay Your Subscriptions', 'Take responsibility for paying subscriptions for yourself or your child.', 'finance', array['self','child']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'server (ownership)', 'RPC claim_responsible_payer + service-role token re-check', 'ownership check', 'KEEP', 'ACTIVE', 'J.13', false),
  ('site.users.view', 'site', 'users', 'view', 'View Users', 'See people''s accounts and access.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'requireSiteAdmin app-only', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.view_personal', 'site', 'users', 'view_personal', 'View Personal Details', 'See a person''s date of birth, address and phone number.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', null, 'getPersonalDetails', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.create', 'site', 'users', 'create', 'Create Users', 'Create an Ovalball identity for a person.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.security.manage', 'site', 'users', 'security.manage', 'Manage Account Security', 'Suspend or restore accounts, sign people out and reset sign-in.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'suspendUser (Phase 0 RPC)', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.identity.correct', 'site', 'users', 'identity.correct', 'Correct Identity Details', 'Correct a person''s name, date of birth or email address.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.disable', 'site', 'users', 'disable', 'Disable Accounts', 'Turn off a person''s access to Ovalball.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.merge', 'site', 'users', 'merge', 'Merge People', 'Merge two identities that belong to the same person.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.export', 'site', 'users', 'export', 'Export Personal Data', 'Export the personal data held about a person.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.users.impersonate', 'site', 'users', 'impersonate', 'View as Another Person', 'See Ovalball as another person sees it, without acting.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.diagnostic.access', 'RENAME/SPLIT', 'ACTIVE', 'J.14', false),
  ('site.users.impersonate_act', 'site', 'users', 'impersonate_act', 'Act as Another Person', 'Take allowed actions as another person.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.memberships.manage', 'site', 'memberships', 'manage', 'Manage Memberships Anywhere', 'Add, suspend, restore or remove a person''s club membership.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'club_memberships bare is_site_admin', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.club_roles.manage', 'site', 'club_roles', 'manage', 'Manage Club Roles Anywhere', 'Assign or remove club roles at any club.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', null, 'approve_club_claim / change-access-form', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.team_roles.manage', 'site', 'team_roles', 'manage', 'Manage Team Roles Anywhere', 'Assign or remove team roles and player places at any team.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.family.manage', 'site', 'family', 'manage', 'Manage Family Links', 'Link or unlink a guardian and a child.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.invitations.manage', 'site', 'invitations', 'manage', 'Manage Invitations', 'Resend or revoke any invitation.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'revoke_site_admin_invitation', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.capabilities.override', 'site', 'capabilities', 'override', 'Override Permissions', 'Allow or withhold a permission for any person at any scope.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'set_capability_override (SA)', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.admins.manage', 'site', 'admins', 'manage', 'Manage Site Admins', 'Grant, change and revoke Site Admin access.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site-admins actions', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.permissions.manage', 'site', 'permissions', 'manage', 'Manage the Permission Catalogue', 'Change capability labels and role bundle composition.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.permissions.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.claims.review', 'site', 'claims', 'review', 'Review Club Claims', 'Review, question and decide club claims.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'approve_club_claim (bare)', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.clubs.view', 'site', 'clubs', 'view', 'View Club Management', 'Read club management data across Ovalball.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'is_site_admin RLS', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.clubs.profile.manage', 'site', 'clubs', 'profile.manage', 'Manage Club Profiles', 'Edit a club''s profile, logo, venues, pitches and documents on its behalf.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'bare is_site_admin', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.clubs.lifecycle', 'site', 'clubs', 'lifecycle', 'Manage Club Lifecycle', 'Deactivate, reactivate or delete a club.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'deactivate_club, delete_canonical_club', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.directory.manage', 'site', 'directory', 'manage', 'Manage the Club Directory', 'Maintain directory entries, research proposals and verification runs.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'club_directory bare SA', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.fixtures.view', 'site', 'fixtures', 'view', 'View Fixture Management', 'Read fixtures across Ovalball.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'admin_fixture_overview', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.fixtures.support', 'site', 'fixtures', 'support', 'Support Fixtures', 'Take fixture support actions and resolve result disputes.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.fixture_support.manage', 'RENAME', 'ACTIVE', 'J.14', true),
  ('site.fixtures.delete', 'site', 'fixtures', 'delete', 'Delete Fixtures', 'Delete a fixture.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'delete_fixture bare SA', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.support.view', 'site', 'support', 'view', 'View Support Tickets', 'Read support tickets.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'site_admin_support_level', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.support.manage', 'site', 'support', 'manage', 'Manage Support Tickets', 'Reply to and resolve support tickets.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'site_admin_support_level', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.support.view_club', 'site', 'support', 'view_club', 'View a Club for Support', 'Open a declared, read-only support view of a club.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.diagnostic.access', 'RENAME', 'ACTIVE', 'J.14', true),
  ('site.support.act_in_club', 'site', 'support', 'act_in_club', 'Act in a Club for Support', 'Take an allowed support action inside a club, with a reason.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'has_capability SA bypass', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.audit.view', 'site', 'audit', 'view', 'View Audit Log', 'Read the redacted audit log.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'audit_log is_site_admin', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.audit.view_sensitive', 'site', 'audit', 'view_sensitive', 'View Sensitive Audit Details', 'Read unredacted audit records, with a reason.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', true, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.security_events.view', 'site', 'security_events', 'view', 'View Security Events', 'Read security events.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'none', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.email.manage', 'site', 'email', 'manage', 'Manage Email', 'Change email templates, branding and send tests.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'email_* is_full_site_admin', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.email.deliveries.view', 'site', 'email', 'deliveries.view', 'View Email Deliveries', 'Read the email delivery ledger.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'email_deliveries is_site_admin', 'NEW', 'ACTIVE', 'J.14', false),
  ('site.seasons.manage', 'site', 'seasons', 'manage', 'Manage Seasons', 'Maintain the season register.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.seasons.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.team_catalogue.manage', 'site', 'team_catalogue', 'manage', 'Manage the Team Directory', 'Write to the canonical Team Directory.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.team_catalogue.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.lookups.manage', 'site', 'lookups', 'manage', 'Manage Global Lookups', 'Add, edit or deactivate any club''s venues and pitches.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'site.lookups.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.system.release.manage', 'site', 'system', 'release.manage', 'Manage Releases', 'Record a release of Ovalball and publish its notes.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.system.release.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.system.beta.manage', 'site', 'system', 'beta.manage', 'Manage Platform Mode', 'Switch Ovalball between Beta and Live.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.system.beta.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.commercial.view', 'site', 'commercial', 'view', 'View Commercial Data', 'Read subscription, trial and referral data across clubs.', 'site', array['site']::text[], false, 'S', 'S', false, 'A2', false, true, true, 'rSC', null, 'site.commercial.view', 'KEEP', 'ACTIVE', 'J.14', true),
  ('site.commercial.manage', 'site', 'commercial', 'manage', 'Change Commercial Terms', 'Change plans, trials and credits.', 'site', array['site']::text[], false, 'S', 'S', false, 'R', false, true, true, 'rSC', null, 'site.commercial.manage', 'KEEP', 'ACTIVE', 'J.14', true),
  ('approve_fixture_callups', 'legacy', 'approve_fixture_callups', null, 'Approve fixture call-ups', 'Approve, reject, or revoke a call-up as the source team lending the player.', 'fixture', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'approve_fixture_callups', 'LEGACY: resolves to fixture.callup.approve', 'DEPRECATED', 'J.15', false),
  ('approve_player_dispensations', 'legacy', 'approve_player_dispensations', null, 'Give source-team dispensation approval', 'Approve or reject a dispensation as the source team lending the player.', 'team', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'approve_player_dispensations', 'LEGACY: resolves to fixture.dispensation.approve_club, fixture.dispensation.approve_team', 'DEPRECATED', 'J.15', false),
  ('calendar.manage', 'calendar', 'manage', null, 'Manage calendar sharing', 'Request, approve, or revoke calendar-sharing partnerships.', 'calendar', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'calendar.manage', 'LEGACY: resolves to calendar.event.manage', 'DEPRECATED', 'J.15', false),
  ('calendar.view', 'calendar', 'view', null, 'View shared calendars', 'See availability shared by partner clubs.', 'calendar', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'calendar.view', 'LEGACY: resolves to calendar.event.view', 'DEPRECATED', 'J.15', false),
  ('club.capabilities.manage', 'club', 'capabilities', 'manage', 'Manage Club Permissions', 'Decide which of the club''s people may run fixtures, training, tournaments and events.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.capabilities.manage', 'LEGACY: resolves to people.capability.manage', 'DEPRECATED', 'J.15', false),
  ('club.dispensation.notify', 'club', 'dispensation', 'notify', 'Receive dispensation notifications', 'Be notified of dispensation activity for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.dispensation.notify', 'LEGACY: resolves to safeguarding.dispensation.notify', 'DEPRECATED', 'J.15', false),
  ('club.dispensation.view', 'club', 'dispensation', 'view', 'View dispensations (Safeguarding Officer)', 'See this club''s player dispensation records. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.dispensation.view', 'LEGACY: resolves to safeguarding.dispensation.view', 'DEPRECATED', 'J.15', false),
  ('club.edit_profile', 'club', 'edit_profile', null, 'Edit club profile', 'Change bio, website, crest, and public-visibility settings.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.edit_profile', 'LEGACY: resolves to club.profile.edit', 'DEPRECATED', 'J.15', false),
  ('club.gocardless.connect', 'club', 'gocardless', 'connect', 'Connect GoCardless', 'Connect or disconnect this club''s GoCardless merchant account.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.gocardless.connect', 'LEGACY: resolves to finance.gocardless.connect', 'DEPRECATED', 'J.15', false),
  ('club.guardians.manage', 'club', 'guardians', 'manage', 'Manage Guardian relationships', 'Remove or replace a Guardian relationship. High safeguarding sensitivity -- Club Admin only, never Team staff.', 'people', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.guardians.manage', 'LEGACY: resolves to family.relationship.approve', 'DEPRECATED', 'J.15', false),
  ('club.pitches.manage', 'club', 'pitches', 'manage', 'Manage pitches', 'Add, edit, or deactivate this club''s pitches.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.pitches.manage', 'LEGACY: resolves to venue.pitch.manage', 'DEPRECATED', 'J.15', false),
  ('club.platform_billing.manage', 'club', 'platform_billing', 'manage', 'Manage Ovalball billing', 'Start, pause and manage this club''s own subscription to Ovalball.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.platform_billing.manage', 'LEGACY: resolves to finance.platform_billing.manage', 'DEPRECATED', 'J.15', false),
  ('club.platform_billing.view', 'club', 'platform_billing', 'view', 'View Ovalball billing', 'See this club''s Ovalball trial and subscription with Ovalball.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.platform_billing.view', 'LEGACY: resolves to finance.platform_billing.view', 'DEPRECATED', 'J.15', false),
  ('club.roster.manage', 'club', 'roster', 'manage', 'Manage team roster (club-wide)', 'Assign or remove people from any team in this club.', 'team', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.roster.manage', 'LEGACY: resolves to team.roster.manage', 'DEPRECATED', 'J.15', false),
  ('club.safeguarding.manage_contact', 'club', 'safeguarding', 'manage_contact', 'Manage Safeguarding Officer', 'Nominate, invite, edit contact details for, or deactivate the club''s Safeguarding Officer.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.safeguarding.manage_contact', 'LEGACY: resolves to safeguarding.officer.nominate', 'DEPRECATED', 'J.15', false),
  ('club.safeguarding.message', 'club', 'safeguarding', 'message', 'Message Safeguarding Officer', 'Start or continue a conversation with the club''s Safeguarding Officer, or fall back to emailing them.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.safeguarding.message', 'TRANSITIONAL: RENAME + widen in Slice 4g (safeguarding.conversation.start)', 'ACTIVE', 'J.15', false),
  ('club.safeguarding.view', 'club', 'safeguarding', 'view', 'View Safeguarding Officer', 'See the club''s designated Safeguarding Officer, their contact details, and invitation status.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', true, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.safeguarding.view', 'TRANSITIONAL: RENAME + widen in Slice 4g (safeguarding.contact.view)', 'ACTIVE', 'J.15', false),
  ('club.season_rollover.manage', 'club', 'season_rollover', 'manage', 'Run Season Rollover', 'Advance this club into a new season -- carries teams and scheduling groups forward.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.season_rollover.manage', 'LEGACY: resolves to team.handover.prepare', 'DEPRECATED', 'J.15', false),
  ('club.subscription.configure', 'club', 'subscription', 'configure', 'Configure Club Subscriptions', 'Enable/disable Club Subscriptions, set the monthly amount and collection day.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.subscription.configure', 'LEGACY: resolves to finance.subscription.configure', 'DEPRECATED', 'J.15', false),
  ('club.subscription.export', 'club', 'subscription', 'export', 'Export Subscription Data', 'Export the subscriber/payment ledger as CSV.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.subscription.export', 'LEGACY: resolves to finance.subscription.export', 'DEPRECATED', 'J.15', false),
  ('club.subscription.manage_enrolment', 'club', 'subscription', 'manage_enrolment', 'Manage Subscription Enrolment', 'Invite parents to subscribe, change the responsible payer, mark exempt/waived.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.subscription.manage_enrolment', 'LEGACY: resolves to finance.enrolment.manage', 'DEPRECATED', 'J.15', false),
  ('club.subscription.manage_payment_actions', 'club', 'subscription', 'manage_payment_actions', 'Manage Payment Actions', 'Retry a failed payment, cancel a subscription, apply a refund.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.subscription.manage_payment_actions', 'LEGACY: resolves to finance.payment.act', 'DEPRECATED', 'J.15', false),
  ('club.subscription.view_finance', 'club', 'subscription', 'view_finance', 'View Finance Dashboard', 'View the Club Subscriptions finance dashboard, revenue, and payment statistics.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.subscription.view_finance', 'LEGACY: resolves to finance.subscription.view', 'DEPRECATED', 'J.15', false),
  ('club.team_lifecycle.manage', 'club', 'team_lifecycle', 'manage', 'Fold or reactivate teams', 'Fold a team (cancelling its future fixtures) or reactivate a folded team.', 'team', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.team_lifecycle.manage', 'LEGACY: resolves to team.lifecycle.manage', 'DEPRECATED', 'J.15', false),
  ('club.teams.manage', 'club', 'teams', 'manage', 'Manage teams', 'Create teams and edit their canonical category, age group, gender, and squad designation.', 'team', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.teams.manage', 'LEGACY: resolves to team.team.manage', 'DEPRECATED', 'J.15', false),
  ('club.training.manage', 'club', 'training', 'manage', 'Manage Training Plans', 'Create, edit and deactivate recurring automatic Training Plans for any team at this club. Club-wide; a single team''s training is managed with team.training.manage.', 'team', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.training.manage', 'LEGACY: resolves to training.plan.manage', 'DEPRECATED', 'J.15', false),
  ('club.transfer.safeguarding_notify', 'club', 'transfer', 'safeguarding_notify', 'Receive transfer safeguarding notifications', 'Be notified of safeguarding-relevant player movement events for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.transfer.safeguarding_notify', 'LEGACY: resolves to safeguarding.transfer.notify', 'DEPRECATED', 'J.15', false),
  ('club.transfer.safeguarding_view', 'club', 'transfer', 'safeguarding_view', 'View transfer safeguarding information', 'See safeguarding-relevant player movement information for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.transfer.safeguarding_view', 'LEGACY: resolves to safeguarding.transfer.view', 'DEPRECATED', 'J.15', false),
  ('club.venues.manage', 'club', 'venues', 'manage', 'Manage venues', 'Add, edit, or deactivate this club''s venues.', 'club', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.venues.manage', 'LEGACY: resolves to venue.venue.manage', 'DEPRECATED', 'J.15', false),
  ('club.view', 'club', 'view', null, 'View club information', 'See club profile, directory details, and public page content.', 'club', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'club.view', 'LEGACY: resolves to club.profile.view', 'DEPRECATED', 'J.15', false),
  ('fixture.bulk_edit', 'fixture', 'bulk_edit', null, 'Bulk Edit Fixtures', 'Change many fixtures at once, rather than one at a time.', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.bulk_edit', 'LEGACY: resolves to fixture.fixture.bulk_edit', 'DEPRECATED', 'J.15', false),
  ('fixture.cancel', 'fixture', 'cancel', null, 'Cancel fixtures', 'Mark a fixture cancelled (same scope as fixture.create).', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.cancel', 'LEGACY: resolves to fixture.fixture.cancel', 'DEPRECATED', 'J.15', false),
  ('fixture.create', 'fixture', 'create', null, 'Create fixtures', 'Add a new fixture for a team (requires team-level authority, or Club Admin club-wide).', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.create', 'LEGACY: resolves to fixture.fixture.create', 'DEPRECATED', 'J.15', false),
  ('fixture.edit', 'fixture', 'edit', null, 'Edit fixtures', 'Change details of an existing fixture (same scope as fixture.create).', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.edit', 'LEGACY: resolves to fixture.fixture.edit', 'DEPRECATED', 'J.15', false),
  ('fixture.import', 'fixture', 'import', null, 'Import Fixtures', 'Upload a fixture list and publish it to the club''s fixtures after review.', 'fixture', array['site','club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.import', 'LEGACY: resolves to fixture.import.run', 'DEPRECATED', 'J.15', false),
  ('fixture.manage_requests', 'fixture', 'manage_requests', null, 'Manage fixture requests', 'Send/receive club-wide fixture requests to partner clubs.', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.manage_requests', 'LEGACY: resolves to fixture.request.respond', 'DEPRECATED', 'J.15', false),
  ('fixture.view', 'fixture', 'view', null, 'View fixtures', 'See the club''s fixtures and results.', 'fixture', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'fixture.view', 'LEGACY: resolves to fixture.fixture.view', 'DEPRECATED', 'J.15', false),
  ('manage_fixture_callups', 'legacy', 'manage_fixture_callups', null, 'Request fixture call-ups', 'Request a player call-up onto a team for a specific fixture.', 'fixture', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'manage_fixture_callups', 'LEGACY: resolves to fixture.callup.request', 'DEPRECATED', 'J.15', false),
  ('manage_mini_rugby_groups', 'legacy', 'manage_mini_rugby_groups', null, 'Manage Mini-Rugby Groups', 'Create and edit shared Mini-Rugby scheduling groups for this club.', 'team', array['club']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'manage_mini_rugby_groups', 'LEGACY: resolves to team.mini_rugby_group.manage', 'DEPRECATED', 'J.15', false),
  ('manage_player_dispensations', 'legacy', 'manage_player_dispensations', null, 'Request player dispensations', 'Request a player dispensation to move between two teams at the same club.', 'team', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'manage_player_dispensations', 'LEGACY: resolves to fixture.dispensation.request', 'DEPRECATED', 'J.15', false),
  ('messages.fixture_send', 'messages', 'fixture_send', null, 'Send fixture messages', 'Message about a specific fixture or fixture request you have a relationship with.', 'messaging', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'messages.fixture_send', 'LEGACY: resolves to fixture.communication.send', 'DEPRECATED', 'J.15', false),
  ('partner.manage', 'partner', 'manage', null, 'Manage partner clubs', 'Same authority as calendar.manage -- partnerships are the calendar-sharing relationship itself.', 'calendar', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'partner.manage', 'LEGACY: resolves to club.partners.manage', 'DEPRECATED', 'J.15', false),
  ('people.manage', 'people', 'manage', null, 'Manage people', 'Invite members, correct roles, and revoke club access.', 'people', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'people.manage', 'LEGACY: resolves to people.membership.revoke', 'DEPRECATED', 'J.15', false),
  ('people.view', 'people', 'view', null, 'View people', 'See who is connected to the club and their roles.', 'people', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'people.view', 'LEGACY: resolves to people.member.view', 'DEPRECATED', 'J.15', false),
  ('permissions.club_manage', 'permissions', 'club_manage', null, 'Manage club-wide access', 'Change other members'' Ovalball access and real-world role (Club Admin only).', 'permissions', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'permissions.club_manage', 'LEGACY: resolves to people.capability.manage', 'DEPRECATED', 'J.15', false),
  ('place_graduating_players', 'legacy', 'place_graduating_players', null, 'Place graduating players', 'Place a player from the graduation queue onto a target team.', 'team', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'place_graduating_players', 'LEGACY: resolves to team.graduation.place', 'DEPRECATED', 'J.15', false),
  ('site.diagnostic.access', 'site', 'diagnostic', 'access', 'Diagnostic club access', 'View any club as a diagnostic session.', 'site', array['site']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'site.diagnostic.access', 'LEGACY: resolves to site.support.view_club', 'DEPRECATED', 'J.15', false),
  ('site.fixture_support.manage', 'site', 'fixture_support', 'manage', 'Fixture support access', 'Read and post into any fixture''s conversation.', 'site', array['site']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'site.fixture_support.manage', 'LEGACY: resolves to site.fixtures.support', 'DEPRECATED', 'J.15', false),
  ('site.hub_content.manage', 'site', 'hub_content', 'manage', 'Manage Rugby Hub content', 'Create, edit, review, publish, supersede and archive Rugby Hub general-knowledge content (positions, skills, glossary, coaching guidance, practical guides, fun facts).', 'site', array['site']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'site.hub_content.manage', 'LEGACY: resolves to site.hub.manage', 'DEPRECATED', 'J.15', false),
  ('site.hub_content.view', 'site', 'hub_content', 'view', 'View Rugby Hub content administration', 'Read Rugby Hub general-knowledge content -- positions, skills, glossary terms, coaching guidance -- including drafts and review state.', 'site', array['site']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'site.hub_content.view', 'LEGACY: resolves to site.hub.view', 'DEPRECATED', 'J.15', false),
  ('team.community.manage', 'team', 'community', 'manage', 'Manage Team Community', 'Enable or disable the Team Community conversation for a team.', 'messaging', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'team.community.manage', 'LEGACY: resolves to messaging.announcement.send_club, messaging.announcement.send_team', 'DEPRECATED', 'J.15', false),
  ('team.guardians.invite', 'team', 'guardians', 'invite', 'Invite Parent/Guardian', 'Invite a Parent/Guardian to a specific team.', 'people', array['club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'team.guardians.invite', 'LEGACY: resolves to family.invitation.create', 'DEPRECATED', 'J.15', false),
  ('team.manage', 'team', 'manage', null, 'Manage a team', 'Edit a specific team''s details and roster (scoped to assigned teams for Team Admin).', 'team', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'team.manage', 'LEGACY: resolves to team.team.manage', 'DEPRECATED', 'J.15', false),
  ('team.training.manage', 'team', 'training', 'manage', 'Manage Team Training', 'Schedule, edit and cancel training for one team. Held independently of fixture.create, so a club can grant training management without fixture arranging, or withdraw one without the other.', 'team', array['team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'team.training.manage', 'LEGACY: resolves to training.plan.manage', 'DEPRECATED', 'J.15', false),
  ('team.view', 'team', 'view', null, 'View teams', 'See the club''s teams and who is assigned to them.', 'team', array['site','club','team']::text[], false, 'N', 'N', false, 'A2', false, true, false, 'hasCapability (legacy)', 'internal.has_capability (legacy wrapper)', 'team.view', 'LEGACY: resolves to team.team.view', 'DEPRECATED', 'J.15', false)
on conflict (key) do update set
  domain = excluded.domain,
  resource = excluded.resource,
  action = excluded.action,
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  valid_scopes = excluded.valid_scopes,
  inherits_to_team = excluded.inherits_to_team,
  grant_level = excluded.grant_level,
  revoke_level = excluded.revoke_level,
  delegable = excluded.delegable,
  aal = excluded.aal,
  safeguarding_sensitive = excluded.safeguarding_sensitive,
  minor_prohibited = excluded.minor_prohibited,
  impersonation_blocked = excluded.impersonation_blocked,
  server_enforcement = excluded.server_enforcement,
  db_enforcement = excluded.db_enforcement,
  legacy_key = excluded.legacy_key,
  migration_action = excluded.migration_action,
  status = excluded.status,
  design_section = excluded.design_section,
  site_addon_allowed = excluded.site_addon_allowed;

update public.capabilities c set site_master_equivalent = v.sme from (values
  ('account.profile.view', 'site.users.view'),
  ('account.profile.edit', 'site.users.identity.correct'),
  ('account.details.complete', 'site.users.identity.correct'),
  ('account.security.manage', 'site.users.security.manage'),
  ('account.sessions.manage', 'site.users.security.manage'),
  ('account.data.export', 'site.users.export'),
  ('account.deletion.request', 'site.users.disable'),
  ('people.member.view', 'site.users.view'),
  ('people.member.view_contact', 'site.users.view'),
  ('people.invitation.create', 'site.invitations.manage'),
  ('people.invitation.revoke', 'site.invitations.manage'),
  ('people.join_request.review', 'site.memberships.manage'),
  ('people.membership.suspend', 'site.memberships.manage'),
  ('people.membership.revoke', 'site.memberships.manage'),
  ('people.role.assign_club', 'site.club_roles.manage'),
  ('people.role.assign_team', 'site.team_roles.manage'),
  ('people.capability.manage', 'site.capabilities.override'),
  ('people.access.explain', 'site.users.view'),
  ('club.profile.view', 'site.clubs.view'),
  ('club.profile.edit', 'site.clubs.profile.manage'),
  ('club.logo.manage', 'site.clubs.profile.manage'),
  ('club.settings.manage', 'site.clubs.profile.manage'),
  ('club.documents.view', 'site.clubs.view'),
  ('club.documents.manage', 'site.clubs.profile.manage'),
  ('club.partners.manage', 'site.clubs.profile.manage'),
  ('club.referrals.view', 'site.commercial.view'),
  ('club.referrals.manage', 'site.commercial.manage'),
  ('club.reporting.export', 'site.users.export'),
  ('club.lifecycle.deactivate', 'site.clubs.lifecycle'),
  ('club.claim.submit', 'site.claims.review'),
  ('team.team.view', 'site.clubs.view'),
  ('team.team.manage', 'site.team_roles.manage'),
  ('team.lifecycle.manage', 'site.clubs.lifecycle'),
  ('team.roster.view', 'site.team_roles.manage'),
  ('team.roster.manage', 'site.team_roles.manage'),
  ('team.join_request.review', 'site.team_roles.manage'),
  ('team.join_code.manage', 'site.invitations.manage'),
  ('team.attendance.view', 'site.support.view_club'),
  ('team.handover.prepare', 'site.support.act_in_club'),
  ('team.handover.apply', 'site.support.act_in_club'),
  ('team.graduation.place', 'site.team_roles.manage'),
  ('team.mini_rugby_group.manage', 'site.support.act_in_club'),
  ('player.profile.view', 'site.users.view'),
  ('player.profile.edit', 'site.family.manage'),
  ('player.profile.edit_protected', 'site.users.identity.correct'),
  ('player.account.invite', 'site.family.manage'),
  ('player.account.link', 'site.family.manage'),
  ('family.child.add', 'site.family.manage'),
  ('family.relationship.request', 'site.family.manage'),
  ('family.relationship.approve', 'site.family.manage'),
  ('family.relationship.remove', 'site.family.manage'),
  ('family.invitation.create', 'site.invitations.manage'),
  ('family.duplicate.resolve', 'site.family.manage'),
  ('fixture.fixture.view', 'site.fixtures.view'),
  ('fixture.fixture.create', 'site.fixtures.support'),
  ('fixture.fixture.edit', 'site.fixtures.support'),
  ('fixture.fixture.cancel', 'site.fixtures.support'),
  ('fixture.fixture.archive', 'site.fixtures.support'),
  ('fixture.fixture.delete', 'site.fixtures.delete'),
  ('fixture.fixture.bulk_edit', 'site.fixtures.support'),
  ('fixture.planner.use', 'site.fixtures.support'),
  ('fixture.import.run', 'site.fixtures.support'),
  ('fixture.request.create', 'site.fixtures.support'),
  ('fixture.request.respond', 'site.fixtures.support'),
  ('fixture.result.record', 'site.fixtures.support'),
  ('fixture.result.dispute_resolve', 'site.fixtures.support'),
  ('fixture.callup.request', 'site.support.act_in_club'),
  ('fixture.callup.approve', 'site.support.act_in_club'),
  ('fixture.dispensation.request', 'site.support.act_in_club'),
  ('fixture.communication.send', 'site.support.act_in_club'),
  ('matchcentre.fixture.view', 'site.fixtures.view'),
  ('competition.competition.create', 'site.competitions.manage'),
  ('competition.edition.manage', 'site.competitions.manage'),
  ('competition.creator.use', 'site.competitions.manage'),
  ('competition.edition.issue', 'site.competitions.manage'),
  ('competition.match.record_result', 'site.competitions.manage'),
  ('competition.match.respond', 'site.support.act_in_club'),
  ('tournament.tournament.view', 'site.fixtures.view'),
  ('tournament.tournament.manage', 'site.support.act_in_club'),
  ('calendar.event.view', 'site.clubs.view'),
  ('calendar.event.manage', 'site.support.act_in_club'),
  ('venue.venue.view', 'site.clubs.view'),
  ('venue.venue.manage', 'site.clubs.profile.manage'),
  ('venue.pitch.manage', 'site.clubs.profile.manage'),
  ('venue.pitch_allocation.view', 'site.clubs.view'),
  ('venue.pitch_allocation.manage', 'site.support.act_in_club'),
  ('training.session.view', 'site.support.view_club'),
  ('training.plan.manage', 'site.support.act_in_club'),
  ('training.session.cancel', 'site.support.act_in_club'),
  ('training.communication.send', 'site.support.act_in_club'),
  ('messaging.fixture_conversation.participate', 'site.messages.moderate'),
  ('messaging.team_conversation.view', 'site.messages.moderate'),
  ('messaging.announcement.send_club', 'site.support.act_in_club'),
  ('messaging.announcement.send_team', 'site.support.act_in_club'),
  ('messaging.club_conversation.manage', 'site.support.act_in_club'),
  ('messaging.policy.manage', 'site.messages.policy.manage'),
  ('messaging.block.manage', 'site.messages.moderate'),
  ('messaging.moderation.club_review', 'site.messages.moderate'),
  ('safeguarding.contact.view', 'site.clubs.view'),
  ('safeguarding.officer.nominate', 'site.club_roles.manage'),
  ('safeguarding.officer.deactivate', 'site.club_roles.manage'),
  ('safeguarding.officer.contact_edit', 'site.club_roles.manage'),
  ('safeguarding.conversation.handle', 'site.safeguarding.review'),
  ('safeguarding.dispensation.view', 'site.safeguarding.review'),
  ('safeguarding.transfer.view', 'site.safeguarding.review'),
  ('safeguarding.welfare.view', 'site.safeguarding.review'),
  ('finance.subscription.view', 'site.commercial.view'),
  ('finance.platform_billing.view', 'site.commercial.view'),
  ('finance.platform_billing.manage', 'site.commercial.manage')
) as v(key, sme) where c.key = v.key;

insert into public.capability_bundles (bundle_key, label, kind) values
  ('CA', 'Club Admin', 'ROLE'),
  ('SO', 'Safeguarding Officer', 'ROLE'),
  ('FS', 'Fixtures Secretary', 'ROLE'),
  ('VO', 'Volunteer', 'ROLE'),
  ('MB', 'Member', 'ROLE'),
  ('CO', 'Coach', 'ROLE'),
  ('TM', 'Team Manager', 'ROLE'),
  ('TA', 'Team Administration', 'ROLE'),
  ('PL', 'Player', 'RELATIONSHIP'),
  ('PG', 'Parent/Guardian', 'RELATIONSHIP'),
  ('SELF', 'Every Person (Own Account)', 'RELATIONSHIP'),
  ('SITE_FULL', 'Full Site Admin', 'SITE_PROFILE'),
  ('SITE_OPS', 'Fixture Operations', 'SITE_PROFILE'),
  ('SITE_DATA', 'Club Data', 'SITE_PROFILE'),
  ('SITE_SUPPORT', 'User Support', 'SITE_PROFILE'),
  ('SITE_MOD', 'Message Moderator', 'SITE_PROFILE'),
  ('SITE_CONTENT', 'Content', 'SITE_PROFILE'),
  ('SITE_RO', 'Read Only', 'SITE_PROFILE');

insert into public.bundle_capabilities (bundle_key, capability_key, scope_type) values
  ('CA', 'calendar.event.manage', 'club'),
  ('CA', 'calendar.event.view', 'club'),
  ('CA', 'club.documents.manage', 'club'),
  ('CA', 'club.documents.view', 'club'),
  ('CA', 'club.logo.manage', 'club'),
  ('CA', 'club.news.manage', 'club'),
  ('CA', 'club.partners.manage', 'club'),
  ('CA', 'club.profile.edit', 'club'),
  ('CA', 'club.profile.view', 'club'),
  ('CA', 'club.referrals.manage', 'club'),
  ('CA', 'club.referrals.view', 'club'),
  ('CA', 'club.reporting.export', 'club'),
  ('CA', 'club.safeguarding.message', 'club'),
  ('CA', 'club.safeguarding.view', 'club'),
  ('CA', 'club.settings.manage', 'club'),
  ('CA', 'competition.competition.create', 'club'),
  ('CA', 'competition.creator.use', 'club'),
  ('CA', 'competition.edition.issue', 'club'),
  ('CA', 'competition.edition.manage', 'club'),
  ('CA', 'competition.match.record_result', 'club'),
  ('CA', 'competition.match.respond', 'club'),
  ('CA', 'family.duplicate.resolve', 'club'),
  ('CA', 'family.invitation.create', 'club'),
  ('CA', 'family.relationship.approve', 'club'),
  ('CA', 'family.relationship.remove', 'club'),
  ('CA', 'finance.enrolment.manage', 'club'),
  ('CA', 'finance.gocardless.connect', 'club'),
  ('CA', 'finance.payment.act', 'club'),
  ('CA', 'finance.platform_billing.manage', 'club'),
  ('CA', 'finance.platform_billing.view', 'club'),
  ('CA', 'finance.subscription.configure', 'club'),
  ('CA', 'finance.subscription.export', 'club'),
  ('CA', 'finance.subscription.view', 'club'),
  ('CA', 'fixture.callup.approve', 'club'),
  ('CA', 'fixture.callup.request', 'club'),
  ('CA', 'fixture.communication.send', 'club'),
  ('CA', 'fixture.dispensation.approve_club', 'club'),
  ('CA', 'fixture.dispensation.request', 'club'),
  ('CA', 'fixture.fixture.archive', 'club'),
  ('CA', 'fixture.fixture.bulk_edit', 'club'),
  ('CA', 'fixture.fixture.cancel', 'club'),
  ('CA', 'fixture.fixture.create', 'club'),
  ('CA', 'fixture.fixture.delete', 'club'),
  ('CA', 'fixture.fixture.edit', 'club'),
  ('CA', 'fixture.fixture.view', 'club'),
  ('CA', 'fixture.import.run', 'club'),
  ('CA', 'fixture.planner.use', 'club'),
  ('CA', 'fixture.request.create', 'club'),
  ('CA', 'fixture.request.respond', 'club'),
  ('CA', 'fixture.result.record', 'club'),
  ('CA', 'matchcentre.fixture.view', 'club'),
  ('CA', 'messaging.announcement.send_club', 'club'),
  ('CA', 'messaging.announcement.send_team', 'club'),
  ('CA', 'messaging.block.manage', 'club'),
  ('CA', 'messaging.club_conversation.manage', 'club'),
  ('CA', 'messaging.fixture_conversation.participate', 'club'),
  ('CA', 'messaging.policy.manage', 'club'),
  ('CA', 'people.access.explain', 'club'),
  ('CA', 'people.capability.manage', 'club'),
  ('CA', 'people.invitation.create', 'club'),
  ('CA', 'people.invitation.revoke', 'club'),
  ('CA', 'people.join_request.review', 'club'),
  ('CA', 'people.member.view', 'club'),
  ('CA', 'people.member.view_contact', 'club'),
  ('CA', 'people.membership.revoke', 'club'),
  ('CA', 'people.membership.suspend', 'club'),
  ('CA', 'people.role.assign_club', 'club'),
  ('CA', 'people.role.assign_team', 'club'),
  ('CA', 'player.pathway.request', 'club'),
  ('CA', 'player.profile.view', 'club'),
  ('CA', 'safeguarding.contact.view', 'club'),
  ('CA', 'safeguarding.conversation.start', 'club'),
  ('CA', 'safeguarding.officer.deactivate', 'club'),
  ('CA', 'safeguarding.officer.nominate', 'club'),
  ('CA', 'team.attendance.view', 'club'),
  ('CA', 'team.graduation.place', 'club'),
  ('CA', 'team.handover.apply', 'club'),
  ('CA', 'team.handover.prepare', 'club'),
  ('CA', 'team.join_code.manage', 'club'),
  ('CA', 'team.join_request.review', 'club'),
  ('CA', 'team.lifecycle.manage', 'club'),
  ('CA', 'team.mini_rugby_group.manage', 'club'),
  ('CA', 'team.news.manage', 'club'),
  ('CA', 'team.roster.manage', 'club'),
  ('CA', 'team.roster.view', 'club'),
  ('CA', 'team.team.manage', 'club'),
  ('CA', 'team.team.view', 'club'),
  ('CA', 'tournament.tournament.manage', 'club'),
  ('CA', 'tournament.tournament.view', 'club'),
  ('CA', 'training.communication.send', 'club'),
  ('CA', 'training.plan.manage', 'club'),
  ('CA', 'training.session.cancel', 'club'),
  ('CA', 'training.session.view', 'club'),
  ('CA', 'venue.pitch.manage', 'club'),
  ('CA', 'venue.pitch_allocation.manage', 'club'),
  ('CA', 'venue.pitch_allocation.view', 'club'),
  ('CA', 'venue.venue.manage', 'club'),
  ('CA', 'venue.venue.view', 'club'),
  ('CO', 'calendar.event.view', 'team'),
  ('CO', 'club.documents.view', 'club'),
  ('CO', 'club.profile.view', 'club'),
  ('CO', 'family.invitation.create', 'team'),
  ('CO', 'fixture.callup.request', 'team'),
  ('CO', 'fixture.communication.send', 'team'),
  ('CO', 'fixture.dispensation.request', 'team'),
  ('CO', 'fixture.fixture.cancel', 'team'),
  ('CO', 'fixture.fixture.create', 'team'),
  ('CO', 'fixture.fixture.edit', 'team'),
  ('CO', 'fixture.fixture.view', 'team'),
  ('CO', 'fixture.request.create', 'team'),
  ('CO', 'fixture.result.record', 'team'),
  ('CO', 'matchcentre.fixture.view', 'team'),
  ('CO', 'messaging.announcement.send_team', 'team'),
  ('CO', 'messaging.fixture_conversation.participate', 'team'),
  ('CO', 'messaging.team_conversation.send', 'team'),
  ('CO', 'messaging.team_conversation.view', 'team'),
  ('CO', 'player.pathway.request', 'team'),
  ('CO', 'player.profile.view', 'team'),
  ('CO', 'safeguarding.contact.view', 'club'),
  ('CO', 'safeguarding.conversation.start', 'club'),
  ('CO', 'team.attendance.view', 'team'),
  ('CO', 'team.graduation.place', 'team'),
  ('CO', 'team.news.manage', 'team'),
  ('CO', 'team.roster.view', 'team'),
  ('CO', 'team.team.view', 'team'),
  ('CO', 'tournament.tournament.view', 'team'),
  ('CO', 'training.communication.send', 'team'),
  ('CO', 'training.plan.manage', 'team'),
  ('CO', 'training.session.cancel', 'team'),
  ('CO', 'training.session.view', 'team'),
  ('CO', 'venue.pitch_allocation.view', 'club'),
  ('CO', 'venue.venue.view', 'club'),
  ('FS', 'calendar.event.manage', 'club'),
  ('FS', 'calendar.event.view', 'club'),
  ('FS', 'club.documents.manage', 'club'),
  ('FS', 'club.documents.view', 'club'),
  ('FS', 'club.partners.manage', 'club'),
  ('FS', 'club.profile.view', 'club'),
  ('FS', 'competition.competition.create', 'club'),
  ('FS', 'competition.creator.use', 'club'),
  ('FS', 'competition.edition.issue', 'club'),
  ('FS', 'competition.edition.manage', 'club'),
  ('FS', 'competition.match.record_result', 'club'),
  ('FS', 'competition.match.respond', 'club'),
  ('FS', 'fixture.callup.approve', 'club'),
  ('FS', 'fixture.callup.request', 'club'),
  ('FS', 'fixture.communication.send', 'club'),
  ('FS', 'fixture.dispensation.request', 'club'),
  ('FS', 'fixture.fixture.archive', 'club'),
  ('FS', 'fixture.fixture.bulk_edit', 'club'),
  ('FS', 'fixture.fixture.cancel', 'club'),
  ('FS', 'fixture.fixture.create', 'club'),
  ('FS', 'fixture.fixture.delete', 'club'),
  ('FS', 'fixture.fixture.edit', 'club'),
  ('FS', 'fixture.fixture.view', 'club'),
  ('FS', 'fixture.import.run', 'club'),
  ('FS', 'fixture.planner.use', 'club'),
  ('FS', 'fixture.request.create', 'club'),
  ('FS', 'fixture.request.respond', 'club'),
  ('FS', 'fixture.result.record', 'club'),
  ('FS', 'matchcentre.fixture.view', 'club'),
  ('FS', 'messaging.club_conversation.manage', 'club'),
  ('FS', 'messaging.fixture_conversation.participate', 'club'),
  ('FS', 'people.member.view', 'club'),
  ('FS', 'safeguarding.contact.view', 'club'),
  ('FS', 'safeguarding.conversation.start', 'club'),
  ('FS', 'team.graduation.place', 'club'),
  ('FS', 'team.handover.prepare', 'club'),
  ('FS', 'team.mini_rugby_group.manage', 'club'),
  ('FS', 'team.team.view', 'club'),
  ('FS', 'tournament.tournament.manage', 'club'),
  ('FS', 'tournament.tournament.view', 'club'),
  ('FS', 'training.session.view', 'club'),
  ('FS', 'venue.pitch.manage', 'club'),
  ('FS', 'venue.pitch_allocation.manage', 'club'),
  ('FS', 'venue.pitch_allocation.view', 'club'),
  ('FS', 'venue.venue.manage', 'club'),
  ('FS', 'venue.venue.view', 'club'),
  ('MB', 'calendar.event.view', 'club'),
  ('MB', 'club.documents.view', 'club'),
  ('MB', 'club.profile.view', 'club'),
  ('MB', 'fixture.fixture.view', 'club'),
  ('MB', 'matchcentre.fixture.view', 'club'),
  ('MB', 'safeguarding.contact.view', 'club'),
  ('MB', 'safeguarding.conversation.start', 'club'),
  ('MB', 'team.team.view', 'club'),
  ('MB', 'tournament.tournament.view', 'club'),
  ('MB', 'venue.venue.view', 'club'),
  ('PG', 'calendar.event.view', 'child'),
  ('PG', 'family.permission.manage', 'child'),
  ('PG', 'family.relationship.remove', 'child'),
  ('PG', 'family.relationship.request', 'child'),
  ('PG', 'finance.payer.self', 'child'),
  ('PG', 'fixture.fixture.view', 'child'),
  ('PG', 'matchcentre.attendance.respond', 'child'),
  ('PG', 'matchcentre.fixture.view', 'child'),
  ('PG', 'messaging.team_conversation.send', 'child'),
  ('PG', 'messaging.team_conversation.view', 'child'),
  ('PG', 'player.account.invite', 'child'),
  ('PG', 'player.profile.edit', 'child'),
  ('PG', 'player.profile.edit_protected', 'child'),
  ('PG', 'player.profile.view', 'child'),
  ('PG', 'safeguarding.contact.view', 'club'),
  ('PG', 'safeguarding.conversation.start', 'club'),
  ('PG', 'team.team.view', 'team'),
  ('PG', 'training.session.view', 'child'),
  ('PG', 'venue.venue.view', 'club'),
  ('PL', 'calendar.event.view', 'team'),
  ('PL', 'finance.payer.self', 'self'),
  ('PL', 'fixture.fixture.view', 'team'),
  ('PL', 'matchcentre.attendance.respond', 'self'),
  ('PL', 'matchcentre.fixture.view', 'team'),
  ('PL', 'messaging.team_conversation.send', 'team'),
  ('PL', 'messaging.team_conversation.view', 'team'),
  ('PL', 'player.profile.edit', 'self'),
  ('PL', 'player.profile.edit_protected', 'self'),
  ('PL', 'player.profile.view', 'self'),
  ('PL', 'safeguarding.contact.view', 'club'),
  ('PL', 'safeguarding.conversation.start', 'club'),
  ('PL', 'team.team.view', 'team'),
  ('PL', 'training.session.view', 'team'),
  ('PL', 'venue.venue.view', 'club'),
  ('SELF', 'account.data.export', 'self'),
  ('SELF', 'account.deletion.request', 'self'),
  ('SELF', 'account.details.complete', 'self'),
  ('SELF', 'account.profile.edit', 'self'),
  ('SELF', 'account.profile.view', 'self'),
  ('SELF', 'account.recovery_codes.manage', 'self'),
  ('SELF', 'account.security.manage', 'self'),
  ('SELF', 'account.sessions.manage', 'self'),
  ('SELF', 'club.claim.submit', 'self'),
  ('SELF', 'family.child.add', 'self'),
  ('SELF', 'family.relationship.request', 'self'),
  ('SELF', 'messaging.direct.send', 'self'),
  ('SELF', 'messaging.report.submit', 'self'),
  ('SELF', 'notification.self.manage', 'self'),
  ('SELF', 'people.access.explain', 'self'),
  ('SELF', 'player.account.link', 'self'),
  ('SELF', 'player.self_register', 'self'),
  ('SITE_CONTENT', 'site.hub.manage', 'site'),
  ('SITE_CONTENT', 'site.hub.view', 'site'),
  ('SITE_CONTENT', 'site.regulatory.manage', 'site'),
  ('SITE_CONTENT', 'site.regulatory.view', 'site'),
  ('SITE_DATA', 'site.audit.view', 'site'),
  ('SITE_DATA', 'site.claims.review', 'site'),
  ('SITE_DATA', 'site.clubs.profile.manage', 'site'),
  ('SITE_DATA', 'site.clubs.view', 'site'),
  ('SITE_DATA', 'site.directory.manage', 'site'),
  ('SITE_DATA', 'site.users.view', 'site'),
  ('SITE_FULL', 'safeguarding.officer.confirm', 'site'),
  ('SITE_FULL', 'site.admins.manage', 'site'),
  ('SITE_FULL', 'site.audit.view', 'site'),
  ('SITE_FULL', 'site.audit.view_sensitive', 'site'),
  ('SITE_FULL', 'site.capabilities.override', 'site'),
  ('SITE_FULL', 'site.claims.review', 'site'),
  ('SITE_FULL', 'site.club_roles.manage', 'site'),
  ('SITE_FULL', 'site.clubs.lifecycle', 'site'),
  ('SITE_FULL', 'site.clubs.profile.manage', 'site'),
  ('SITE_FULL', 'site.clubs.view', 'site'),
  ('SITE_FULL', 'site.commercial.manage', 'site'),
  ('SITE_FULL', 'site.commercial.view', 'site'),
  ('SITE_FULL', 'site.competitions.manage', 'site'),
  ('SITE_FULL', 'site.directory.manage', 'site'),
  ('SITE_FULL', 'site.email.deliveries.view', 'site'),
  ('SITE_FULL', 'site.email.manage', 'site'),
  ('SITE_FULL', 'site.family.manage', 'site'),
  ('SITE_FULL', 'site.fixtures.delete', 'site'),
  ('SITE_FULL', 'site.fixtures.support', 'site'),
  ('SITE_FULL', 'site.fixtures.view', 'site'),
  ('SITE_FULL', 'site.hub.manage', 'site'),
  ('SITE_FULL', 'site.hub.view', 'site'),
  ('SITE_FULL', 'site.invitations.manage', 'site'),
  ('SITE_FULL', 'site.lookups.manage', 'site'),
  ('SITE_FULL', 'site.memberships.manage', 'site'),
  ('SITE_FULL', 'site.messages.moderate', 'site'),
  ('SITE_FULL', 'site.messages.policy.manage', 'site'),
  ('SITE_FULL', 'site.permissions.manage', 'site'),
  ('SITE_FULL', 'site.regulatory.manage', 'site'),
  ('SITE_FULL', 'site.regulatory.view', 'site'),
  ('SITE_FULL', 'site.safeguarding.review', 'site'),
  ('SITE_FULL', 'site.seasons.manage', 'site'),
  ('SITE_FULL', 'site.security_events.view', 'site'),
  ('SITE_FULL', 'site.support.act_in_club', 'site'),
  ('SITE_FULL', 'site.support.manage', 'site'),
  ('SITE_FULL', 'site.support.view', 'site'),
  ('SITE_FULL', 'site.support.view_club', 'site'),
  ('SITE_FULL', 'site.system.beta.manage', 'site'),
  ('SITE_FULL', 'site.system.release.manage', 'site'),
  ('SITE_FULL', 'site.team_catalogue.manage', 'site'),
  ('SITE_FULL', 'site.team_roles.manage', 'site'),
  ('SITE_FULL', 'site.users.create', 'site'),
  ('SITE_FULL', 'site.users.disable', 'site'),
  ('SITE_FULL', 'site.users.export', 'site'),
  ('SITE_FULL', 'site.users.identity.correct', 'site'),
  ('SITE_FULL', 'site.users.impersonate', 'site'),
  ('SITE_FULL', 'site.users.impersonate_act', 'site'),
  ('SITE_FULL', 'site.users.merge', 'site'),
  ('SITE_FULL', 'site.users.security.manage', 'site'),
  ('SITE_FULL', 'site.users.view', 'site'),
  ('SITE_FULL', 'site.users.view_personal', 'site'),
  ('SITE_MOD', 'site.clubs.view', 'site'),
  ('SITE_MOD', 'site.messages.moderate', 'site'),
  ('SITE_MOD', 'site.users.view', 'site'),
  ('SITE_OPS', 'site.audit.view', 'site'),
  ('SITE_OPS', 'site.clubs.view', 'site'),
  ('SITE_OPS', 'site.competitions.manage', 'site'),
  ('SITE_OPS', 'site.fixtures.delete', 'site'),
  ('SITE_OPS', 'site.fixtures.support', 'site'),
  ('SITE_OPS', 'site.fixtures.view', 'site'),
  ('SITE_OPS', 'site.support.view_club', 'site'),
  ('SITE_OPS', 'site.users.view', 'site'),
  ('SITE_RO', 'site.audit.view', 'site'),
  ('SITE_RO', 'site.clubs.view', 'site'),
  ('SITE_RO', 'site.fixtures.view', 'site'),
  ('SITE_RO', 'site.hub.view', 'site'),
  ('SITE_RO', 'site.regulatory.view', 'site'),
  ('SITE_RO', 'site.support.view', 'site'),
  ('SITE_RO', 'site.users.view', 'site'),
  ('SITE_SUPPORT', 'safeguarding.officer.confirm', 'site'),
  ('SITE_SUPPORT', 'site.audit.view', 'site'),
  ('SITE_SUPPORT', 'site.clubs.view', 'site'),
  ('SITE_SUPPORT', 'site.email.deliveries.view', 'site'),
  ('SITE_SUPPORT', 'site.invitations.manage', 'site'),
  ('SITE_SUPPORT', 'site.security_events.view', 'site'),
  ('SITE_SUPPORT', 'site.support.manage', 'site'),
  ('SITE_SUPPORT', 'site.support.view', 'site'),
  ('SITE_SUPPORT', 'site.support.view_club', 'site'),
  ('SITE_SUPPORT', 'site.users.identity.correct', 'site'),
  ('SITE_SUPPORT', 'site.users.impersonate', 'site'),
  ('SITE_SUPPORT', 'site.users.security.manage', 'site'),
  ('SITE_SUPPORT', 'site.users.view', 'site'),
  ('SITE_SUPPORT', 'site.users.view_personal', 'site'),
  ('SO', 'calendar.event.view', 'club'),
  ('SO', 'club.documents.view', 'club'),
  ('SO', 'club.profile.view', 'club'),
  ('SO', 'fixture.fixture.view', 'club'),
  ('SO', 'matchcentre.fixture.view', 'club'),
  ('SO', 'messaging.block.manage', 'club'),
  ('SO', 'messaging.moderation.club_review', 'club'),
  ('SO', 'people.member.view', 'club'),
  ('SO', 'people.member.view_contact', 'club'),
  ('SO', 'player.profile.view', 'club'),
  ('SO', 'safeguarding.contact.view', 'club'),
  ('SO', 'safeguarding.conversation.handle', 'club'),
  ('SO', 'safeguarding.dispensation.notify', 'club'),
  ('SO', 'safeguarding.dispensation.view', 'club'),
  ('SO', 'safeguarding.officer.contact_edit', 'self'),
  ('SO', 'safeguarding.transfer.notify', 'club'),
  ('SO', 'safeguarding.transfer.view', 'club'),
  ('SO', 'safeguarding.welfare.view', 'club'),
  ('SO', 'team.roster.view', 'club'),
  ('SO', 'team.team.view', 'club'),
  ('SO', 'tournament.tournament.view', 'club'),
  ('SO', 'venue.venue.view', 'club'),
  ('TA', 'family.invitation.create', 'team'),
  ('TA', 'family.relationship.approve', 'team'),
  ('TA', 'fixture.dispensation.approve_team', 'team'),
  ('TA', 'people.access.explain', 'team'),
  ('TA', 'people.capability.manage', 'team'),
  ('TA', 'people.role.assign_team', 'team'),
  ('TA', 'team.join_code.manage', 'team'),
  ('TA', 'team.join_request.review', 'team'),
  ('TA', 'team.roster.manage', 'team'),
  ('TA', 'team.team.manage', 'team'),
  ('TM', 'calendar.event.manage', 'team'),
  ('TM', 'calendar.event.view', 'team'),
  ('TM', 'club.documents.view', 'club'),
  ('TM', 'club.profile.view', 'club'),
  ('TM', 'competition.match.respond', 'team'),
  ('TM', 'family.invitation.create', 'team'),
  ('TM', 'family.relationship.approve', 'team'),
  ('TM', 'fixture.callup.request', 'team'),
  ('TM', 'fixture.communication.send', 'team'),
  ('TM', 'fixture.dispensation.approve_team', 'team'),
  ('TM', 'fixture.dispensation.request', 'team'),
  ('TM', 'fixture.fixture.archive', 'team'),
  ('TM', 'fixture.fixture.cancel', 'team'),
  ('TM', 'fixture.fixture.create', 'team'),
  ('TM', 'fixture.fixture.edit', 'team'),
  ('TM', 'fixture.fixture.view', 'team'),
  ('TM', 'fixture.request.create', 'team'),
  ('TM', 'fixture.request.respond', 'team'),
  ('TM', 'fixture.result.record', 'team'),
  ('TM', 'matchcentre.fixture.view', 'team'),
  ('TM', 'messaging.announcement.send_team', 'team'),
  ('TM', 'messaging.fixture_conversation.participate', 'team'),
  ('TM', 'messaging.team_conversation.send', 'team'),
  ('TM', 'messaging.team_conversation.view', 'team'),
  ('TM', 'player.pathway.request', 'team'),
  ('TM', 'player.profile.view', 'team'),
  ('TM', 'safeguarding.contact.view', 'club'),
  ('TM', 'safeguarding.conversation.start', 'club'),
  ('TM', 'team.attendance.view', 'team'),
  ('TM', 'team.graduation.place', 'team'),
  ('TM', 'team.join_code.manage', 'team'),
  ('TM', 'team.join_request.review', 'team'),
  ('TM', 'team.news.manage', 'team'),
  ('TM', 'team.roster.manage', 'team'),
  ('TM', 'team.roster.view', 'team'),
  ('TM', 'team.team.view', 'team'),
  ('TM', 'tournament.tournament.view', 'team'),
  ('TM', 'training.communication.send', 'team'),
  ('TM', 'training.plan.manage', 'team'),
  ('TM', 'training.session.cancel', 'team'),
  ('TM', 'training.session.view', 'team'),
  ('TM', 'venue.pitch_allocation.view', 'club'),
  ('TM', 'venue.venue.view', 'club'),
  ('VO', 'calendar.event.view', 'club'),
  ('VO', 'club.documents.view', 'club'),
  ('VO', 'club.profile.view', 'club'),
  ('VO', 'fixture.fixture.view', 'club'),
  ('VO', 'matchcentre.fixture.view', 'club'),
  ('VO', 'safeguarding.contact.view', 'club'),
  ('VO', 'safeguarding.conversation.start', 'club'),
  ('VO', 'team.team.view', 'club'),
  ('VO', 'tournament.tournament.view', 'club'),
  ('VO', 'venue.pitch_allocation.view', 'club'),
  ('VO', 'venue.venue.view', 'club');

insert into public.capability_key_map (legacy_key, legacy_scope, capability_key, evaluated_scope) values
  ('approve_fixture_callups', 'club', 'fixture.callup.approve', 'club'),
  ('approve_fixture_callups', 'team', 'fixture.callup.approve', 'club'),
  ('approve_player_dispensations', 'club', 'fixture.dispensation.approve_club', 'club'),
  ('approve_player_dispensations', 'team', 'fixture.dispensation.approve_team', 'team'),
  ('calendar.manage', 'club', 'calendar.event.manage', 'club'),
  ('calendar.manage', 'team', 'calendar.event.manage', 'team'),
  ('calendar.view', 'club', 'calendar.event.view', 'club'),
  ('calendar.view', 'team', 'calendar.event.view', 'team'),
  ('club.capabilities.manage', 'club', 'people.capability.manage', 'club'),
  ('club.capabilities.manage', 'team', 'people.capability.manage', 'team'),
  ('club.dispensation.notify', 'club', 'safeguarding.dispensation.notify', 'club'),
  ('club.dispensation.view', 'club', 'safeguarding.dispensation.view', 'club'),
  ('club.edit_profile', 'club', 'club.profile.edit', 'club'),
  ('club.gocardless.connect', 'club', 'finance.gocardless.connect', 'club'),
  ('club.guardians.manage', 'club', 'family.relationship.approve', 'club'),
  ('club.guardians.manage', 'team', 'family.relationship.approve', 'team'),
  ('club.logo.manage', 'club', 'club.logo.manage', 'club'),
  ('club.news.manage', 'club', 'club.news.manage', 'club'),
  ('club.pitches.manage', 'club', 'venue.pitch.manage', 'club'),
  ('club.platform_billing.manage', 'club', 'finance.platform_billing.manage', 'club'),
  ('club.platform_billing.view', 'club', 'finance.platform_billing.view', 'club'),
  ('club.referrals.manage', 'club', 'club.referrals.manage', 'club'),
  ('club.referrals.view', 'club', 'club.referrals.view', 'club'),
  ('club.roster.manage', 'club', 'team.roster.manage', 'club'),
  ('club.roster.manage', 'team', 'team.roster.manage', 'team'),
  ('club.safeguarding.manage_contact', 'club', 'safeguarding.officer.nominate', 'club'),
  ('club.safeguarding.message', 'club', 'club.safeguarding.message', 'club'),
  ('club.safeguarding.view', 'club', 'club.safeguarding.view', 'club'),
  ('club.season_rollover.manage', 'club', 'team.handover.prepare', 'club'),
  ('club.subscription.configure', 'club', 'finance.subscription.configure', 'club'),
  ('club.subscription.export', 'club', 'finance.subscription.export', 'club'),
  ('club.subscription.manage_enrolment', 'club', 'finance.enrolment.manage', 'club'),
  ('club.subscription.manage_payment_actions', 'club', 'finance.payment.act', 'club'),
  ('club.subscription.view_finance', 'club', 'finance.subscription.view', 'club'),
  ('club.team_lifecycle.manage', 'club', 'team.lifecycle.manage', 'club'),
  ('club.team_lifecycle.manage', 'team', 'team.lifecycle.manage', 'club'),
  ('club.teams.manage', 'club', 'team.team.manage', 'club'),
  ('club.teams.manage', 'team', 'team.team.manage', 'team'),
  ('club.training.manage', 'club', 'training.plan.manage', 'club'),
  ('club.training.manage', 'team', 'training.plan.manage', 'team'),
  ('club.transfer.safeguarding_notify', 'club', 'safeguarding.transfer.notify', 'club'),
  ('club.transfer.safeguarding_view', 'club', 'safeguarding.transfer.view', 'club'),
  ('club.venues.manage', 'club', 'venue.venue.manage', 'club'),
  ('club.view', 'club', 'club.profile.view', 'club'),
  ('fixture.bulk_edit', 'club', 'fixture.fixture.bulk_edit', 'club'),
  ('fixture.bulk_edit', 'team', 'fixture.fixture.bulk_edit', 'club'),
  ('fixture.cancel', 'club', 'fixture.fixture.cancel', 'club'),
  ('fixture.cancel', 'team', 'fixture.fixture.cancel', 'team'),
  ('fixture.create', 'club', 'fixture.fixture.create', 'club'),
  ('fixture.create', 'team', 'fixture.fixture.create', 'team'),
  ('fixture.edit', 'club', 'fixture.fixture.edit', 'club'),
  ('fixture.edit', 'team', 'fixture.fixture.edit', 'team'),
  ('fixture.import', 'club', 'fixture.import.run', 'club'),
  ('fixture.import', 'team', 'fixture.import.run', 'club'),
  ('fixture.manage_requests', 'club', 'fixture.request.respond', 'club'),
  ('fixture.manage_requests', 'team', 'fixture.request.respond', 'team'),
  ('fixture.view', 'club', 'fixture.fixture.view', 'club'),
  ('fixture.view', 'team', 'fixture.fixture.view', 'team'),
  ('manage_fixture_callups', 'club', 'fixture.callup.request', 'club'),
  ('manage_fixture_callups', 'team', 'fixture.callup.request', 'team'),
  ('manage_mini_rugby_groups', 'club', 'team.mini_rugby_group.manage', 'club'),
  ('manage_mini_rugby_groups', 'team', 'team.mini_rugby_group.manage', 'club'),
  ('manage_player_dispensations', 'club', 'fixture.dispensation.request', 'club'),
  ('manage_player_dispensations', 'team', 'fixture.dispensation.request', 'team'),
  ('messages.fixture_send', 'club', 'fixture.communication.send', 'club'),
  ('messages.fixture_send', 'team', 'fixture.communication.send', 'team'),
  ('partner.manage', 'club', 'club.partners.manage', 'club'),
  ('partner.manage', 'team', 'club.partners.manage', 'club'),
  ('people.manage', 'club', 'people.membership.revoke', 'club'),
  ('people.manage', 'team', 'people.membership.revoke', 'club'),
  ('people.view', 'club', 'people.member.view', 'club'),
  ('people.view', 'team', 'people.member.view', 'club'),
  ('permissions.club_manage', 'club', 'people.capability.manage', 'club'),
  ('permissions.club_manage', 'team', 'people.capability.manage', 'team'),
  ('place_graduating_players', 'club', 'team.graduation.place', 'club'),
  ('place_graduating_players', 'team', 'team.graduation.place', 'team'),
  ('site.commercial.manage', 'site', 'site.commercial.manage', 'site'),
  ('site.commercial.view', 'site', 'site.commercial.view', 'site'),
  ('site.competitions.manage', 'site', 'site.competitions.manage', 'site'),
  ('site.diagnostic.access', 'site', 'site.support.view_club', 'site'),
  ('site.fixture_support.manage', 'site', 'site.fixtures.support', 'site'),
  ('site.hub_content.manage', 'site', 'site.hub.manage', 'site'),
  ('site.hub_content.view', 'site', 'site.hub.view', 'site'),
  ('site.lookups.manage', 'site', 'site.lookups.manage', 'site'),
  ('site.permissions.manage', 'site', 'site.permissions.manage', 'site'),
  ('site.regulatory.manage', 'site', 'site.regulatory.manage', 'site'),
  ('site.regulatory.view', 'site', 'site.regulatory.view', 'site'),
  ('site.seasons.manage', 'site', 'site.seasons.manage', 'site'),
  ('site.system.beta.manage', 'site', 'site.system.beta.manage', 'site'),
  ('site.system.release.manage', 'site', 'site.system.release.manage', 'site'),
  ('site.team_catalogue.manage', 'site', 'site.team_catalogue.manage', 'site'),
  ('team.attendance.view', 'club', 'team.attendance.view', 'club'),
  ('team.attendance.view', 'team', 'team.attendance.view', 'team'),
  ('team.community.manage', 'club', 'messaging.announcement.send_club', 'club'),
  ('team.community.manage', 'team', 'messaging.announcement.send_team', 'team'),
  ('team.guardians.invite', 'club', 'family.invitation.create', 'club'),
  ('team.guardians.invite', 'team', 'family.invitation.create', 'team'),
  ('team.manage', 'club', 'team.team.manage', 'club'),
  ('team.manage', 'team', 'team.team.manage', 'team'),
  ('team.news.manage', 'team', 'team.news.manage', 'team'),
  ('team.roster.manage', 'club', 'team.roster.manage', 'club'),
  ('team.roster.manage', 'team', 'team.roster.manage', 'team'),
  ('team.training.manage', 'club', 'training.plan.manage', 'club'),
  ('team.training.manage', 'team', 'training.plan.manage', 'team'),
  ('team.view', 'club', 'team.team.view', 'club'),
  ('team.view', 'team', 'team.team.view', 'team');

-- ---------------------------------------------------------------------------------------------
-- 4. catalogue invariants
-- ---------------------------------------------------------------------------------------------

alter table public.capabilities
  alter column domain set not null,
  alter column resource set not null,
  alter column grant_level set not null,
  alter column revoke_level set not null,
  alter column aal set not null,
  add constraint capabilities_category_check check (category in ('account', 'notification', 'people', 'permissions', 'club', 'team',
    'player', 'family', 'fixture', 'matchcentre', 'competition', 'tournament', 'calendar', 'venue', 'training', 'messaging', 'hub',
    'safeguarding', 'finance', 'site')),
  add constraint capabilities_status_check check (status in ('ACTIVE', 'DEPRECATED')),
  add constraint capabilities_grant_level_check check (grant_level in ('S', 'C', 'T', 'N') and revoke_level in ('S', 'C', 'T', 'N')),
  add constraint capabilities_aal_check check (aal in ('A2', 'R')),
  add constraint capabilities_valid_scopes_check check (
    cardinality(valid_scopes) > 0
    and valid_scopes <@ array['self', 'child', 'team', 'club', 'organisation', 'site', 'public']::text[]),
  -- Design Y.8 names three parts; J.14 keeps four-part site keys (site.system.release.manage) ACTIVE, and
  -- J.6 names player.self_register exactly as written, so it is the one listed exception.
  add constraint capabilities_key_shape check (status <> 'ACTIVE' or key ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+(\.[a-z_]+)?$' or key = 'player.self_register'),
  -- A key can only be delegated by override when a club or team may grant it.
  add constraint capabilities_delegable_level check (not delegable or grant_level in ('C', 'T')),
  -- Site capabilities are granted by Ovalball only, never delegated, never inherited.
  add constraint capabilities_site_keys check (status <> 'ACTIVE' or key not like 'site.%' or (grant_level = 'S' and not delegable and not inherits_to_team and valid_scopes = array['site']::text[])),
  add constraint capabilities_addon_site_only check (not site_addon_allowed or key like 'site.%'),
  add constraint capabilities_site_master_equivalent_fkey foreign key (site_master_equivalent) references public.capabilities (key);

create or replace function internal.guard_bundle_capability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cap public.capabilities;
  v_kind text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  select * into v_cap from public.capabilities where key = new.capability_key;
  select kind into v_kind from public.capability_bundles where bundle_key = new.bundle_key;
  if v_cap.status <> 'ACTIVE' then
    raise exception 'Capability % is retired and cannot be added to a bundle.', new.capability_key using errcode = '23514';
  end if;
  if not (new.scope_type = any (v_cap.valid_scopes) or (new.scope_type = 'club' and v_cap.inherits_to_team)) then
    raise exception 'Capability % is not held at % scope.', new.capability_key, new.scope_type using errcode = '23514';
  end if;
  -- Site capabilities live only in Site Admin profiles, and profiles hold nothing else (K.2 rule 7).
  if (v_kind = 'SITE_PROFILE') <> (new.scope_type = 'site') then
    raise exception 'Site Admin profiles hold site-scope capabilities only.' using errcode = '23514';
  end if;
  if new.capability_key like 'site.%' and v_kind <> 'SITE_PROFILE' then
    raise exception 'A site capability can only belong to a Site Admin profile.' using errcode = '23514';
  end if;
  -- SA-1: Read Only holds view capabilities only.
  if new.bundle_key = 'SITE_RO' and new.capability_key !~ '\.view(_[a-z_]+)?$' then
    raise exception 'The Read Only Site Admin profile can only hold view capabilities.' using errcode = '23514';
  end if;
  -- SA-5: master control belongs to Full Site Admin alone.
  if new.capability_key in ('site.memberships.manage', 'site.club_roles.manage', 'site.team_roles.manage', 'site.family.manage',
                            'site.users.create', 'site.admins.manage', 'site.capabilities.override')
     and new.bundle_key <> 'SITE_FULL' then
    raise exception 'Only the Full Site Admin profile holds master-control capabilities.' using errcode = '23514';
  end if;
  -- V: Volunteer is read-only by default.
  if new.bundle_key = 'VO' and v_cap.action !~ '^view' and new.capability_key <> 'safeguarding.conversation.start' then
    raise exception 'The Volunteer role holds read-only capabilities by default.' using errcode = '23514';
  end if;
  -- U: bulk fixture authority is club-wide only; team roles and relationships never hold it.
  if new.bundle_key in ('CO', 'TM', 'TA', 'VO', 'PL', 'PG', 'SELF', 'MB')
     and new.capability_key in ('fixture.planner.use', 'fixture.import.run', 'competition.creator.use', 'fixture.fixture.bulk_edit') then
    raise exception 'Bulk fixture tools are club-wide authority and cannot belong to %.', new.bundle_key using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_bundle_capability
  before insert or update on public.bundle_capabilities
  for each row execute function internal.guard_bundle_capability();

-- Every row seeded above must satisfy the guard.
do $$
declare v_bad int;
begin
  update public.bundle_capabilities set scope_type = scope_type;
  select count(*) into v_bad from public.capabilities c where c.status = 'ACTIVE' and c.key not like 'site.%'
    and c.grant_level <> 'S' and c.valid_scopes <> array['public']::text[]
    and not exists (select 1 from public.bundle_capabilities b where b.capability_key = c.key);
  if v_bad > 0 then
    raise exception 'Slice 3 catalogue: % active capabilities belong to no bundle.', v_bad;
  end if;
  select count(*) into v_bad from public.capabilities where domain is null or grant_level is null or aal is null;
  if v_bad > 0 then
    raise exception 'Slice 3 catalogue: % capabilities without metadata.', v_bad;
  end if;
end $$;

alter table public.role_definitions
  add constraint role_definitions_bundle_key_fkey foreign key (bundle_key) references public.capability_bundles (bundle_key);

-- ---------------------------------------------------------------------------------------------
-- 5. the legacy permission tables become projections of the bundles (Y.6)
-- ---------------------------------------------------------------------------------------------

alter table public.role_capability_defaults rename to role_capability_defaults_legacy;
alter table public.permission_group_capabilities rename to permission_group_capabilities_legacy;
revoke all on public.role_capability_defaults_legacy from anon, authenticated;
revoke all on public.permission_group_capabilities_legacy from anon, authenticated;

-- What each legacy role holds, expressed in the legacy keys, read from the bundles through the key
-- map. A club role answers a team-scope key only where the canonical key inherits to teams.
create view public.role_capability_defaults with (security_invoker = true) as
select distinct m.legacy_scope as scope_type, r.role_key, m.legacy_key as capability_key
from public.capability_key_map m
join public.capabilities c on c.key = m.capability_key and c.status = 'ACTIVE'
join (values ('CLUB_ADMIN', 'CA', 'club'), ('FIXTURE_SECRETARY', 'FS', 'club'), ('CLUB_MEMBER', 'MB', 'club'),
             ('TEAM_MANAGER', 'TM', 'team'), ('TEAM_STAFF', 'CO', 'team')) as r (role_key, bundle_key, natural_scope)
  on true
where m.legacy_scope in ('club', 'team')
  and exists (
    select 1 from public.bundle_capabilities b
    where b.bundle_key = r.bundle_key and b.capability_key = m.capability_key
      and case
        when r.natural_scope = 'club' and m.evaluated_scope = 'club' then b.scope_type = 'club'
        when r.natural_scope = 'club' and m.evaluated_scope = 'team' then b.scope_type = 'club' and c.inherits_to_team
        when r.natural_scope = 'team' and m.legacy_scope = 'team' and m.evaluated_scope = 'team' then b.scope_type = 'team'
        else false
      end);
comment on view public.role_capability_defaults is
  'Read-only compatibility projection of bundle_capabilities in legacy keys (Slice 3). Dropped in Slice 10.';
grant select on public.role_capability_defaults to service_role;

-- Each fixed access group shows what its role bundle holds, in canonical keys.
create view public.permission_group_capabilities with (security_invoker = true) as
select distinct g.id as group_id, b.capability_key
from public.permission_groups g
join lateral (
  select unnest(case
    when g.maps_to_role = 'CLUB_ADMIN' then array['CA']
    when g.maps_to_role = 'FIXTURE_SECRETARY' then array['FS']
    when g.maps_to_role = 'BASIC_USER' then array['MB']
    when g.maps_to_team_permission = 'coach' then array['CO']
    when g.maps_to_team_permission = 'manager' then array['TM']
    when g.maps_to_team_permission = 'team_admin' then array['TM', 'TA']
    else array[]::text[]
  end) as bundle_key
) gb on true
join public.bundle_capabilities b on b.bundle_key = gb.bundle_key
join public.capabilities c on c.key = b.capability_key and c.status = 'ACTIVE';
comment on view public.permission_group_capabilities is
  'Read-only compatibility projection: the canonical capabilities of the role bundle an access group maps to (Slice 3).';
grant select on public.permission_group_capabilities to authenticated, service_role;

-- Access groups are fixed descriptions of roles now; the browser no longer edits them.
drop policy if exists permission_groups_write_admin on public.permission_groups;
drop policy if exists permission_groups_update_admin on public.permission_groups;
drop policy if exists permission_groups_delete_admin on public.permission_groups;
revoke insert, update, delete on public.permission_groups from anon, authenticated;

create or replace function public.delete_permission_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Access groups follow the role bundles in the permission catalogue and cannot be deleted.' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. access to the catalogue
-- ---------------------------------------------------------------------------------------------

alter table public.capability_bundles enable row level security;
alter table public.bundle_capabilities enable row level security;
alter table public.capability_key_map enable row level security;

create policy capability_bundles_select on public.capability_bundles for select to authenticated using (true);
create policy bundle_capabilities_select on public.bundle_capabilities for select to authenticated using (true);
create policy capability_key_map_select on public.capability_key_map for select to authenticated using (true);

revoke all on public.capability_bundles, public.bundle_capabilities, public.capability_key_map from anon, authenticated;
grant select on public.capability_bundles, public.bundle_capabilities, public.capability_key_map to authenticated;
grant all on public.capability_bundles, public.bundle_capabilities, public.capability_key_map to service_role;

create trigger audit_row_change after insert or update or delete on public.capability_bundles
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.bundle_capabilities
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.capability_key_map
  for each row execute function internal.audit_row_change();
