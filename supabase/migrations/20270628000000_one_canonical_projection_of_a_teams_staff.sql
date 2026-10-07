-- =====================================================================================================
-- ONE CANONICAL PROJECTION OF A TEAM'S STAFF.
--
-- `public.team_permissions` is a Slice 2 COMPATIBILITY VIEW that Slice 10 drops. Twenty-eight database
-- functions read it and one writes through its INSTEAD OF trigger. This file gives that semantic a
-- canonical home so the compatibility surface can be retired without twenty-eight bespoke rewrites,
-- each free to get the rules subtly wrong.
--
-- WHAT THE COMPATIBILITY VIEW ACTUALLY GUARANTEES -- written down before anything is changed, because
-- "replace it with a query over role_assignments" is how the guarantees get lost:
--
--   SELECTION      a row of `role_assignments` with a non-null `team_id` whose `role_key` is one of
--                  TEAM_ADMINISTRATION, TEAM_MANAGER or COACH. A club-scoped assignment (team_id null)
--                  is NOT a team permission, however senior.
--   LIVENESS       `state = 'ACTIVE'`, OR `state = 'SUSPENDED'` where the suspension was applied at
--                  SITE level with `suspension_cause = 'CLUB_AUTHORITY'`. That second branch is
--                  deliberate: a club whose authority is suspended still HAS staff, and the people who
--                  must be told about a fixture are still those people. Dropping it would silently
--                  shrink audiences and disable a team's coaches the moment a club was sanctioned.
--   ONE ROW PER    `distinct on (membership_id, team_id)`. A person holding two roles on one team is
--   PERSON+TEAM    ONE row, not two -- which is why a caller counting rows counts people.
--   PRECEDENCE     and the row kept is the HIGHEST role: TEAM_ADMINISTRATION, then TEAM_MANAGER, then
--                  COACH, tie-broken by `granted_at` then `id` so the answer is deterministic and does
--                  not move when an unrelated row is inserted.
--   LEGACY STRING  `permission` is the Slice 2 wire vocabulary -- 'team_admin' / 'manager' / 'coach' --
--                  mapped from the canonical `role_key`.
--
-- NOTE WHAT IT DOES **NOT** GUARANTEE, because two callers assumed otherwise and both already join for
-- it themselves: the view says nothing about the club membership being active, and nothing about the
-- team belonging to any particular club. Every caller below keeps its own join exactly as it was.
--
-- THE REPLACEMENT IS ONE VIEW, NOT A FUNCTION, because callers join against it -- a set-returning
-- function with a team parameter cannot stand in a join over many teams. It lives in `internal`, so no
-- browser role can reach it, and it carries the CANONICAL `role_key`. The legacy string is not in it.
--
-- AND IT IS A PROJECTION, NOT AN AUTHORITY. "Who is on this team's staff" is a relationship; "may this
-- person do X" is `internal.can`. The two are kept apart deliberately, and
-- `scripts/verify-slice10-retirement.mjs` now asserts that the projection is never used to answer a
-- capability question (section 3 of the owner's brief).
-- =====================================================================================================

create or replace view internal.team_role_assignments as
select distinct on (ra.membership_id, ra.team_id)
  ra.id,
  ra.membership_id,
  ra.user_id,
  ra.club_id,
  ra.team_id,
  ra.role_key,
  ra.granted_by,
  ra.granted_at,
  nullif(ra.attributes ->> 'assigned_group_id', '')::uuid as assigned_group_id
from public.role_assignments ra
where ra.team_id is not null
  and ra.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
  and (ra.state = 'ACTIVE'
       or (ra.state = 'SUSPENDED' and ra.suspended_level = 'SITE'
           and ra.attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY'))
order by ra.membership_id, ra.team_id,
  case ra.role_key when 'TEAM_ADMINISTRATION' then 1 when 'TEAM_MANAGER' then 2 else 3 end,
  ra.granted_at, ra.id;

comment on view internal.team_role_assignments is
  'The canonical projection of a team''s staff: one row per membership and team, highest role wins, '
  'ACTIVE or club-authority-suspended, carrying the canonical role_key. The replacement for the '
  'public.team_permissions compatibility view, with identical selection semantics and no legacy '
  'string. A PROJECTION, never an authority: "may this person do X" is internal.can.';

-- No browser role reaches it. `internal` is not exposed, and this states the intent rather than
-- relying on the schema's default.
revoke all on internal.team_role_assignments from public, anon, authenticated;

-- ---- the two vocabularies the legacy string served ---------------------------------------------------

/**
 * THE HUMAN LABEL. `team_people` and the two contact-role resolvers mapped the legacy string to
 * "Team Admin" / "Manager" / "Coach"; they now map the canonical key to exactly the same words.
 */
create or replace function internal.team_role_label(p_role_key text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_role_key
    when 'TEAM_ADMINISTRATION' then 'Team Admin'
    when 'TEAM_MANAGER' then 'Manager'
    when 'COACH' then 'Coach'
  end;
$function$;

comment on function internal.team_role_label(text) is
  'The words a person reads for a team role. Replaces the legacy-string case expressions that each '
  'mapped team_admin/manager/coach to the same three labels.';

/**
 * THE CLIENT WIRE VALUE, and the one place it is produced.
 *
 * `club_people` returns `permission` to the website and the app, which type it as
 * `TeamStaffPermission` and send the same vocabulary back to `set_team_access`. That round trip is a
 * CLIENT CONTRACT rather than an authority, and changing it is a client migration with its own scope.
 *
 * So the vocabulary survives -- but it is now DERIVED FROM THE CANONICAL ROLE in one named place,
 * instead of being read out of the compatibility view. When the clients move to role keys, this
 * function is the only thing that has to go.
 */
create or replace function internal.team_role_wire_value(p_role_key text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_role_key
    when 'TEAM_ADMINISTRATION' then 'team_admin'
    when 'TEAM_MANAGER' then 'manager'
    when 'COACH' then 'coach'
  end;
$function$;

comment on function internal.team_role_wire_value(text) is
  'The Slice 2 client vocabulary (team_admin/manager/coach) for a canonical role key. The ONE place '
  'it is produced, for the club_people -> setTeamAccess round trip, pending the client migration.';

-- ---- the replacement is faithful ---------------------------------------------------------------------
--
-- Proven against the thing it replaces rather than asserted: same rows, same person-and-team pairs,
-- same winning role. If the two ever disagree the chain stops here.

do $$
declare v_only_legacy int; v_only_new int; v_mismatched int;
begin
  select count(*) into v_only_legacy
  from public.team_permissions tp
  where not exists (select 1 from internal.team_role_assignments c
                     where c.membership_id = tp.membership_id and c.team_id = tp.team_id);

  select count(*) into v_only_new
  from internal.team_role_assignments c
  where not exists (select 1 from public.team_permissions tp
                     where tp.membership_id = c.membership_id and tp.team_id = c.team_id);

  select count(*) into v_mismatched
  from public.team_permissions tp
  join internal.team_role_assignments c
    on c.membership_id = tp.membership_id and c.team_id = tp.team_id
  where c.id <> tp.id or internal.team_role_wire_value(c.role_key) <> tp.permission;

  if v_only_legacy > 0 or v_only_new > 0 or v_mismatched > 0 then
    raise exception
      'internal.team_role_assignments is not a faithful replacement for public.team_permissions: % only-legacy, % only-new, % disagreeing rows.',
      v_only_legacy, v_only_new, v_mismatched;
  end if;
end $$;
