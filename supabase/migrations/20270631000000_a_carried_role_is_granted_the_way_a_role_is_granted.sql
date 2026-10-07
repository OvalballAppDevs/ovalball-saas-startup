-- =====================================================================================================
-- A CARRIED ROLE IS GRANTED THE WAY A ROLE IS GRANTED.
--
-- The previous migration moved the season handover's staff carry-across off the compatibility view and
-- onto `internal.grant_role`. It carried one role per person -- the one the canonical projection
-- returns, which is the HIGHEST they hold -- and that is right for an audience and wrong for a grant.
--
-- `grant_role` refuses TEAM_ADMINISTRATION on a team where the person holds no Coach or Team Manager
-- role: *"Team Admin rests on a Coach or Team Manager role for the same team. Give one of those
-- first."* That rule is the canonical model's, and it is a good rule -- Team Administration is an
-- ELEVATION of a base role, not a role on its own. The compatibility view's INSTEAD OF trigger created
-- the pair itself, which is how the old path got away with copying a single row.
--
-- So the handover grants the base first and then the elevation, which is what carrying a Team Admin
-- across actually means. Caught by `team_documents` TD12-TD14, the suite whose whole purpose is to
-- prove `internal.apply_planned_team` -- it failed on the first run after the change, which is the
-- behaviour that permanent coverage exists for.
-- =====================================================================================================

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'apply_planned_team';
  if v_def is null then raise exception 'internal.apply_planned_team is missing.'; end if;

  v_old :=
    '      perform internal.grant_role(' || chr(10) ||
    '        v_carry.membership_id, v_carry.role_key, v_id, ''SEASON_HANDOVER'',' || chr(10) ||
    '        ''Carried across by the season handover from the previous age group'',' || chr(10) ||
    '        case when v_carry.assigned_group_id is not null' || chr(10) ||
    '             then jsonb_build_object(''assigned_group_id'', v_carry.assigned_group_id)' || chr(10) ||
    '             else ''{}''::jsonb end);';

  v_new :=
    '      -- TEAM ADMINISTRATION IS AN ELEVATION, so the base role it rests on is carried first.' || chr(10) ||
    '      if v_carry.role_key = ''TEAM_ADMINISTRATION'' then' || chr(10) ||
    '        perform internal.grant_role(' || chr(10) ||
    '          v_carry.membership_id, ''TEAM_MANAGER'', v_id, ''SEASON_HANDOVER'',' || chr(10) ||
    '          ''Carried across by the season handover from the previous age group'',' || chr(10) ||
    '          case when v_carry.assigned_group_id is not null' || chr(10) ||
    '               then jsonb_build_object(''assigned_group_id'', v_carry.assigned_group_id)' || chr(10) ||
    '               else ''{}''::jsonb end);' || chr(10) ||
    '      end if;' || chr(10) ||
    '      perform internal.grant_role(' || chr(10) ||
    '        v_carry.membership_id, v_carry.role_key, v_id, ''SEASON_HANDOVER'',' || chr(10) ||
    '        ''Carried across by the season handover from the previous age group'',' || chr(10) ||
    '        case when v_carry.assigned_group_id is not null' || chr(10) ||
    '             then jsonb_build_object(''assigned_group_id'', v_carry.assigned_group_id)' || chr(10) ||
    '             else ''{}''::jsonb end);';

  if position(v_old in v_def) = 0 then
    if position('TEAM ADMINISTRATION IS AN ELEVATION' in v_def) > 0 then return; end if;
    raise exception 'the handover carry-across is not the shape this migration expects.';
  end if;

  execute replace(v_def, v_old, v_new);
end $$;
