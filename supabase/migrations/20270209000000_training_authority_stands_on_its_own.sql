-- =====================================================================
-- TRAINING AUTHORITY STANDS ON ITS OWN
--
-- The permissions sweep found that team-level training management had no
-- capability of its own. internal.can_manage_training resolved it through
-- `fixture.create`:
--
--   select internal.has_capability('fixture.create', 'club', p_club_id, null)
--       or internal.has_capability('fixture.create', 'team', p_club_id, p_team_id)
--
-- That was a deliberate choice at the time -- club.training.manage's own
-- description records it -- but it makes two different authorities
-- inseparable. A club could not say "this coach runs training but does not
-- arrange fixtures", and denying fixture creation silently removed somebody's
-- training management with no indication that it would.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
-- It changes the MECHANISM, not the answer. `team.training.manage` is granted
-- by default to exactly the roles that hold team-scope `fixture.create` today
-- -- CLUB_ADMIN, TEAM_MANAGER (which is both the 'team_admin' and 'manager'
-- permissions) and TEAM_STAFF (coach). So on the day this migration runs,
-- every person who could manage their team's training still can, and nobody
-- gains anything.
--
-- What becomes possible is EXPRESSING them apart: a capability_overrides deny
-- on fixture.create no longer takes training with it, and granting training
-- management no longer requires handing over fixture creation. That is the
-- whole point, and it is why the defaults are conservative rather than an
-- opportunity to re-cut the roles.
--
-- Explicit grant and deny continue to work unchanged, because the new key goes
-- through internal.has_capability like every other.
-- =====================================================================

insert into public.capabilities (key, label, description, category, applicable_scopes)
values (
  'team.training.manage',
  'Manage Team Training',
  'Schedule, edit and cancel training for one team. Held independently of fixture.create, so a club can grant training management without fixture arranging, or withdraw one without the other.',
  'team',
  array['team']
)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      applicable_scopes = excluded.applicable_scopes;

-- The roles that hold team-scope fixture.create today, and therefore already
-- manage their team's training today. Copied deliberately rather than derived,
-- so the intent is legible in the migration rather than dependent on whatever
-- fixture.create's defaults happen to be later.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values
  ('team', 'CLUB_ADMIN',   'team.training.manage'),
  ('team', 'TEAM_MANAGER', 'team.training.manage'),
  ('team', 'TEAM_STAFF',   'team.training.manage')
on conflict do nothing;

-- Parent/Guardian, Player and ordinary members appear nowhere above, so they
-- hold no training management -- as before, and now visibly so rather than as
-- a side effect of not holding fixture.create.

-- ---------------------------------------------------------------------
-- The resolver stops borrowing.
-- ---------------------------------------------------------------------
create or replace function internal.can_manage_training(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    -- Club-wide training authority, unchanged.
    internal.has_capability('club.training.manage', 'club', p_club_id, null)
    -- Team-scoped training authority, now its own capability rather than
    -- fixture.create wearing a second hat.
    or (
      p_team_id is not null
      and internal.has_capability('team.training.manage', 'team', p_club_id, p_team_id)
    );
$function$;

comment on function internal.can_manage_training(uuid, uuid) is
  'May the caller manage training for this club/team? Resolves club.training.manage at club scope or team.training.manage at team scope -- never fixture.create, which is a separate authority.';

-- club.training.manage's description documented the old coupling as a
-- deliberate design note. It is no longer true, so it stops saying it.
update public.capabilities
set description = 'Create, edit and deactivate recurring automatic Training Plans for any team at this club. Club-wide; a single team''s training is managed with team.training.manage.'
where key = 'club.training.manage';
