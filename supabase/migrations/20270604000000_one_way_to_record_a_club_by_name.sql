-- =====================================================================================================
-- RECORDING A CLUB BY NAME HAPPENS IN ONE PLACE, AND IT IS THE SERVER.
--
-- THE DEFECT. "Add Club Manually" on the tournament management tab inserted into `club_directory`
-- FROM THE CLIENT and then called `add_tournament_participant_team` with the id it got back. RLS
-- correctly refuses that insert -- `club_directory_write_admin` is a Site Admin policy -- so the
-- feature failed for every club administrator with:
--
--   new row violates row-level security policy for table "club_directory"
--
-- Found by driving the screen in the Simulator, not by reading it: the create wizard's equivalent path
-- works, because `create_tournament_with_teams` is SECURITY DEFINER and matches-or-creates the
-- directory row itself. So the two paths had different rules for the same product decision, which is
-- exactly what must not happen -- a tournament's teams would depend on WHEN the club was added.
--
-- THE FIX IS NOT TO WIDEN RLS. A club administrator should not be able to write arbitrary rows into
-- the canonical club directory; they should be able to record, for one tournament they manage, a club
-- Ovalball does not have. Those are different permissions, and only the second one is being granted
-- here -- through a function that already checks `tournament.tournament.manage` on the hosting club.
--
-- SO `add_tournament_participant_team` GAINS `p_club_name`, and when no directory id is supplied it
-- resolves one exactly as `create_tournament_with_teams` already does:
--
--   match an existing ACTIVE club of the same rugby code by name   -> use it, status `added`
--   otherwise create a row stamped `tournament_manual_entry`        -> status `external_recorded`
--
-- MATCHING FIRST IS THE POINT. Typing "Preston Grasshoppers RFC" finds Preston and records the side
-- against Preston's real identity rather than inventing a second Preston. The manual fallback is for
-- clubs Ovalball genuinely does not have, and it stops being a way to duplicate the ones it does.
-- =====================================================================================================

create or replace function public.add_tournament_participant_team(
  p_tournament_id uuid,
  p_club_directory_id uuid default null,
  p_team_id uuid default null,
  p_canonical_team_type_id uuid default null,
  p_squad_label text default null,
  p_age_group text default null,
  p_club_name text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_id uuid;
  v_dir uuid;
  v_host_dir uuid;
  v_code text;
  v_participant_club uuid;
  v_label text;
  v_team_club uuid;
  v_team_type uuid;
  v_grade text;
  v_name text;
begin
  select t.host_club_id, t.rugby_code, c.directory_id
    into v_club, v_code, v_host_dir
  from public.tournaments t
  join public.clubs c on c.id = t.host_club_id
  where t.id = p_tournament_id;

  if v_club is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_club, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;

  v_dir := p_club_directory_id;
  v_label := nullif(btrim(coalesce(p_squad_label, '')), '');
  v_grade := nullif(btrim(coalesce(p_age_group, '')), '');
  v_name := nullif(btrim(coalesce(p_club_name, '')), '');

  -- ---- recording a club by name, server side ---------------------------------------------------
  if v_dir is null then
    if v_name is null then
      raise exception 'A club is needed to add a team.' using errcode = '22023';
    end if;

    -- MATCH BEFORE CREATE. A typed name that IS a club Ovalball has becomes that club.
    select id into v_dir from public.club_directory
    where lower(btrim(name)) = lower(v_name) and rugby_code = v_code and active
    limit 1;

    if v_dir is null then
      insert into public.club_directory (
        name, rugby_code, country, nation, active, verification_status, source, normalized_key, created_by
      ) values (
        v_name, v_code, 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry',
        'tme-' || substr(md5(lower(v_name) || v_code), 1, 16), auth.uid()
      )
      returning id into v_dir;
    end if;
  end if;

  if v_dir = v_host_dir then
    raise exception 'The host club is entered through its own teams, not as a participating club.' using errcode = '22023';
  end if;

  select c.id into v_participant_club from public.clubs c where c.directory_id = v_dir;

  if p_team_id is not null then
    select c.directory_id, t.canonical_team_type_id, t.age_group into v_team_club, v_team_type, v_grade
    from public.teams t join public.clubs c on c.id = t.club_id
    where t.id = p_team_id;
    if v_team_club is null then
      raise exception 'That team could not be found.' using errcode = 'P0002';
    end if;
    if v_team_club <> v_dir then
      raise exception 'That team does not belong to that club.' using errcode = '22023';
    end if;
    if p_age_group is not null and v_grade is distinct from btrim(p_age_group) then
      raise exception 'That team is not in that age group.' using errcode = '22023';
    end if;
    p_canonical_team_type_id := coalesce(v_team_type, p_canonical_team_type_id);
    v_label := null;
    v_grade := coalesce(v_grade, 'SENIOR');
  end if;

  if v_grade is null then
    raise exception 'An age group is required to add a team.' using errcode = '22023';
  end if;

  insert into public.tournament_participants (
    tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group,
    status, invited_by, invited_at
  )
  values (
    p_tournament_id, v_dir, v_participant_club, p_team_id, p_canonical_team_type_id, v_label, v_grade,
    internal.tournament_participant_status(v_dir),
    auth.uid(), now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.tournament_participants
    where tournament_id = p_tournament_id
      and club_directory_id = v_dir
      and age_group = v_grade
      and coalesce(team_id::text, squad_label, '') = coalesce(p_team_id::text, v_label, '');
  end if;

  return v_id;
end;
$function$;

-- The previous signature had six parameters; `create or replace` with a new trailing one ADDS an
-- overload rather than replacing, and both would then match a six-argument positional call.
drop function if exists public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text);

revoke all on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.add_tournament_participant_team(uuid, uuid, uuid, uuid, text, text, text) to service_role;
