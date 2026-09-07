-- Graduation placement: an over-age player cannot be dropped into a youth
-- team, and leaving a cohort actually ends the membership.
--
-- TWO GAPS, FOUND BY RUNNING THE PLACEMENT PATH
--
-- 1. ADULT ONTO A YOUTH TEAM. place_graduating_player guarded one direction
--    only. Placing an under-18 onto a SENIOR team correctly demands an
--    approved governing-body dispensation for that exact player and team. The
--    opposite direction had no check at all:
--
--      PROBE A -- adult onto U14 ACCEPTED. Player is now on U14
--
--    An 18-year-old graduating from U18 was placed into an Under-14 squad by
--    the ordinary placement control, silently. That is the safeguarding-
--    relevant direction -- an adult training and playing with children -- and
--    it is reachable by any Club Admin working through the graduation list,
--    with no warning and nothing in the audit trail marking it as unusual.
--
-- 2. THE OLD MEMBERSHIP NEVER CLOSED. After placement the player held TWO
--    active memberships:
--
--      PROBE B -- active memberships after placement: 2
--      PROBE B -- teams held: U14, U18 (Rugby Union 26/27) Archive [ARCHIVED]
--
--    An archived cohort kept live members, so squad counts, team lists and
--    anything counting active memberships double-counted every graduate.
--    mark_graduating_player_left had the same gap and was worse: a player
--    recorded as having LEFT THE CLUB still held an active membership.
--
-- HOW THE AGE CHECK IS DECIDED
--
-- Through the ONE canonical resolver, public.resolve_player_regulatory_age --
-- not a second age engine written for placement. The resolver returns the
-- player's regulatory age number for the target team's code and current
-- season; the target's own age band supplies the other number.
--
-- Playing UP is ordinary rugby and stays permitted: a U13 player placed into a
-- U14 side is a normal club decision. Playing DOWN is the risk, so an over-age
-- placement is refused unless an approved governing-body dispensation is on
-- file for that exact player and team -- the same table and the same standard
-- of evidence the senior branch already requires. No second dispensation
-- system is introduced.
--
-- A missing date of birth refuses the placement rather than assuming an age,
-- exactly as the senior branch already does. Ovalball cannot place a player
-- into an age-banded team without knowing their age band.

create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  q public.player_graduation_queue;
  v_target public.teams;
  v_dob date;
  v_is_adult boolean;
  v_has_approved_dispensation boolean;
  v_season_id uuid;
  v_player_age integer;
  v_target_age integer;
  v_label text;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select * into v_target from public.teams where id = p_target_team_id;
  if v_target.club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.has_capability('place_graduating_players', 'team', q.club_id, p_target_team_id)
          or internal.has_capability('place_graduating_players', 'club', q.club_id)) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  select date_of_birth into v_dob from public.players where id = q.player_id;

  if v_target.category = 'senior' then
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby. Record their date of birth before placing them on a senior team.' using errcode = '23514';
    end if;

    v_is_adult := v_dob <= (current_date - interval '18 years')::date;

    if not v_is_adult then
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = q.player_id
          and d.target_team_id = p_target_team_id
          and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_approved_dispensation;

      if not v_has_approved_dispensation then
        raise exception 'This player is under 18 and cannot be placed on a senior team without an approved governing-body dispensation on file for this exact player and team. Request a dispensation first (Season Handover -> Dispensations) and have the club record the governing body''s approval reference once granted -- Ovalball records that approval, it does not grant it on the governing body''s behalf.' using errcode = '23514';
      end if;
    end if;

  elsif v_target.category = 'youth' and v_target.age_group is not null then
    -- The direction that was unguarded. An adult must not land in a youth
    -- squad because the graduation list happened to offer one.
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot check they are the right age for %. Record their date of birth before placing them on an age-banded team.',
        v_target.display_name using errcode = '23514';
    end if;

    v_season_id := internal.resolve_season_for_date(v_target.rugby_code, current_date);
    if v_season_id is null then
      raise exception 'No % season covers today, so Ovalball cannot work out this player''s age grade. Set up the current season before placing graduating players.',
        v_target.rugby_code using errcode = '23514';
    end if;

    select regulatory_age_number, regulatory_age_label into v_player_age, v_label
    from public.resolve_player_regulatory_age(v_target.rugby_code, v_season_id, v_dob);

    v_target_age := nullif(regexp_replace(v_target.age_group, '\D', '', 'g'), '')::integer;

    if v_player_age is not null and v_target_age is not null and v_player_age > v_target_age then
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = q.player_id
          and d.target_team_id = p_target_team_id
          and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_approved_dispensation;

      if not v_has_approved_dispensation then
        raise exception 'This player is % this season and would be over-age for %. Placing an older player into a younger age band needs an approved governing-body dispensation on file for this exact player and team. Playing up an age group does not -- only playing down.',
          v_label, v_target.display_name using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (q.player_id, p_target_team_id, 'active', auth.uid());

  -- The cohort they graduated from is archived; leaving the membership active
  -- left an archived team holding live members and double-counted the player.
  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = auth.uid()
  where player_id = q.player_id and team_id = q.source_team_id and status = 'active';

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$function$;

create or replace function public.mark_graduating_player_left(p_queue_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  q public.player_graduation_queue;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  if not (internal.can_manage_club_fixtures(q.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to update this player''s graduation status.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  -- Recording that a player has left the club has to actually end their
  -- membership. It previously updated the queue only, so someone marked as
  -- gone stayed an active member of the archived cohort.
  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = auth.uid()
  where player_id = q.player_id and team_id = q.source_team_id and status = 'active';

  update public.player_graduation_queue set status = 'left_club', updated_at = now() where id = p_queue_id;
end;
$function$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_graduating_player';

  if v_def !~ 'resolve_player_regulatory_age' then
    raise exception 'Placement does not consult the canonical age resolver.';
  end if;
  -- The over-age check must reuse the existing dispensation record, not a new one.
  if v_def !~ 'player_team_dispensation' then
    raise exception 'The over-age guard does not reuse the existing dispensation record.';
  end if;
end $$;
