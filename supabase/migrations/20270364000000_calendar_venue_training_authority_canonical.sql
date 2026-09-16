-- Slice 4E (calendar, venues, pitches, pitch allocation, training) -- part 1: move the domain's
-- authority gates onto the canonical capability decision (Phase 2 AA.3 row 4e, design J.9
-- lines 496-507).
--
-- AA.3 row 4e retires two things: "role-string RPC checks" and "public training plans". Both are
-- addressed. The role-string checks are the U section's "venues RLS/RPC mismatch", found exactly:
-- the venue RPCs gated on internal.is_club_admin(club) -- a raw membership-role helper -- while the
-- venues RLS gated on club.venues.manage, which CA *and* FS hold. So a Fixtures Secretary could
-- change a venue row through RLS and was refused by the RPC for the same act. J.9 line 500 settles
-- it: venue.venue.manage is CA and FS, one authority for one resource.
--
-- "Public training plans" is the M-2 residue, and it is already closed at the privilege layer by
-- Slice 1's perimeter migration: anon holds no grant on training_plans, training_sessions,
-- training_schedule_rules, club_events or club_pitches. This slice does not redo that; it asserts
-- it permanently in the matrix and closes what Slice 1 left: those tables' policies still say
-- `true`, so every SIGNED-IN person could read every club's training and venues.
--
-- EXPAND STEP. Every function below is replaced in place and every caller already calls it, so this
-- changes answers without changing shapes. No privilege is withdrawn and no application dependency
-- is added, so it is safe to apply while the current build is serving.

-- 1. Calendar events -------------------------------------------------------------------------
-- The bare internal.is_site_admin() bypass goes; a site answer now arrives through the explicit
-- site master J.9 names.
create or replace function internal.can_manage_club_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.club_events e
    where e.id = p_event_id
      and (
        internal.has_site_capability('site.support.act_in_club')
        or internal.can('calendar.event.manage', 'club', e.club_id, null, null)
        or (
          -- A club-wide event reaches every team, so it is never one team's to manage.
          not e.is_club_wide
          -- At least one team, and EVERY team, within this caller's authority.
          and exists (select 1 from public.club_event_teams cet where cet.event_id = e.id)
          and not exists (
            select 1 from public.club_event_teams cet
            where cet.event_id = e.id
              and not internal.can('calendar.event.manage', 'team', e.club_id, cet.team_id, null)
          )
        )
      )
  );
$$;

comment on function internal.can_manage_club_event(uuid) is
  'Slice 4E: calendar.event.manage at the club, or at EVERY team a scoped event names, or the '
  'explicit site master site.support.act_in_club (J.9 line 497).';

-- Reading a club event. The membership read becomes the canonical capability; the FAMILY branch is
-- left exactly as it is, because "a player on an involved team, or the adult responsible for one"
-- is Slice 4A's question and 4A owns its meaning. Guardians and linked players routinely hold no
-- club_memberships row at all, which is why that branch exists.
create or replace function internal.club_event_visible_row(p_event_id uuid, p_club_id uuid, p_is_club_wide boolean)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    internal.has_site_capability('site.clubs.view')
    or internal.can('calendar.event.view', 'club', p_club_id, null, null)
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.status = 'active'
        and t.club_id = p_club_id
        and (
          p_is_club_wide
          or exists (
            select 1 from public.club_event_teams cet
            where cet.event_id = p_event_id and cet.team_id = ptm.team_id
          )
        )
        and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
    );
$$;

comment on function internal.club_event_visible_row(uuid, uuid, boolean) is
  'Slice 4E: calendar.event.view at the club, the site master site.clubs.view, or the Slice 4A '
  'family branch -- a player on an involved team, or their active guardian (J.9 line 496).';

-- 2. Training ---------------------------------------------------------------------------------
-- club.training.manage and team.training.manage MERGE into one key at two scopes (J.9 line 505).
create or replace function internal.can_manage_training(p_club_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.support.act_in_club')
    or internal.can('training.plan.manage', 'club', p_club_id, null, null)
    or (p_team_id is not null
        and internal.can('training.plan.manage', 'team', p_club_id, p_team_id, null));
$$;

comment on function internal.can_manage_training(uuid, uuid) is
  'Slice 4E: training.plan.manage at the club or the team -- the MERGE of club.training.manage and '
  'team.training.manage (J.9 line 505).';

-- The club-scope half, so the ten training RPCs can ask one canonical question instead of naming
-- the deprecated key ten times.
create or replace function internal.can_manage_club_training(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.support.act_in_club')
    or internal.can('training.plan.manage', 'club', p_club_id, null, null);
$$;

comment on function internal.can_manage_club_training(uuid) is
  'Slice 4E: club-scope training.plan.manage, or the explicit site master. Replaces ten separate '
  'internal.has_capability(''club.training.manage'', ...) call sites.';

-- Reading a training session. J.9 line 504 gives training.session.view to CA and FS at the club and
-- CO, TM, PL at the team -- NOT to an ordinary club Member, and the key is safeguarding-sensitive
-- because a training session is a list of when children are somewhere. The legacy helper let any
-- active member of the club read it. The family branch is Slice 4A's and is kept.
create or replace function internal.training_session_visible_row(p_club_id uuid, p_team_id uuid, p_scheduling_group_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    internal.has_site_capability('site.support.view_club')
    or internal.can('training.session.view', 'club', p_club_id, null, null)
    or (p_team_id is not null
        and internal.can('training.session.view', 'team', p_club_id, p_team_id, null))
    or exists (
      select 1
      from public.player_team_memberships ptm
      where ptm.status = 'active'
        and (
          (p_team_id is not null and ptm.team_id = p_team_id)
          or (p_scheduling_group_id is not null and exists (
                select 1 from public.scheduling_group_members sgm
                where sgm.group_id = p_scheduling_group_id and sgm.team_id = ptm.team_id))
        )
        and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
    );
$$;

comment on function internal.training_session_visible_row(uuid, uuid, uuid) is
  'Slice 4E: training.session.view at the club or team, the site master site.support.view_club, or '
  'the Slice 4A family branch. An ordinary club Member is deliberately NOT included (J.9 line 504).';

-- 3. Venues and pitches ------------------------------------------------------------------------
-- One authority for one resource, which is what the U section's "venues RLS/RPC mismatch" means.
create or replace function internal.can_manage_venue(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.clubs.profile.manage')
    or internal.can_manage_global_lookups()
    or (p_club_id is not null and internal.can('venue.venue.manage', 'club', p_club_id, null, null));
$$;

comment on function internal.can_manage_venue(uuid) is
  'Slice 4E: venue.venue.manage at the club (CA and FS), the site lookups authority for global '
  'venues, or site.clubs.profile.manage. One gate for the RPCs and the RLS alike (J.9 line 500).';

create or replace function internal.can_manage_pitch(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.clubs.profile.manage')
    or internal.can_manage_global_lookups()
    or (p_club_id is not null and internal.can('venue.pitch.manage', 'club', p_club_id, null, null));
$$;

comment on function internal.can_manage_pitch(uuid) is
  'Slice 4E: venue.pitch.manage at the club (CA and FS), the site lookups authority, or '
  'site.clubs.profile.manage. Replaces the borrow of 4C''s can_manage_club_fixtures (J.9 line 501).';

create or replace function internal.can_view_venue(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.has_site_capability('site.clubs.view')
    or p_club_id is null   -- a global lookup venue belongs to no club and is nobody's secret
    or internal.can('venue.venue.view', 'club', p_club_id, null, null);
$$;

comment on function internal.can_view_venue(uuid) is
  'Slice 4E: venue.venue.view at the owning club (every club-member bundle), or site.clubs.view. '
  'Closes the M-2 residue that let every signed-in person read every club''s venues (J.9 line 499).';

-- 4. The call sites -----------------------------------------------------------------------------
-- Nineteen RPCs, rewritten mechanically so that each keeps its own body and changes only the one
-- expression that decided authority:
--
--   4 venue RPCs     internal.is_club_admin(club) or can_manage_global_lookups()
--                      -> internal.can_manage_venue(club)          <- closes the U mismatch
--   5 pitch RPCs     internal.can_manage_club_fixtures(club) or can_manage_global_lookups()
--                      -> internal.can_manage_pitch(club)          <- stops borrowing 4C's gate
--  10 training RPCs  internal.has_capability('club.training.manage', 'club', X, null)
--                      -> internal.can_manage_club_training(X)     <- the deprecated key, ten times
--
-- The pitch RPCs borrowing internal.can_manage_club_fixtures is the same species of mistake 4D
-- found in can_organise_competition: a real gate, but answering a different question. Laying out a
-- club's pitches is ground management, not fixture planning, and J.9 line 501 gives it to CA and FS
-- under venue.pitch.manage.
CREATE OR REPLACE FUNCTION public.create_venue(p_club_id uuid, p_name text, p_address text, p_postcode text, p_directions text, p_set_default boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := trim(p_name);
  v_id uuid;
begin
  if not (internal.can_manage_venue(p_club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A venue name is required.';
  end if;
  if exists (select 1 from public.venues where club_id = p_club_id and lower(name) = lower(v_name)) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  if p_set_default then
    update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = p_club_id and is_default_home;
  end if;

  insert into public.venues (name, slug, club_id, address, postcode, directions, is_default_home, active, created_by, updated_by)
  values (
    v_name,
    trim(both '-' from regexp_replace(lower(v_name || '-' || substr(p_club_id::text, 1, 8)), '[^a-z0-9]+', '-', 'g')),
    p_club_id, nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_postcode, '')), ''), nullif(trim(coalesce(p_directions, '')), ''),
    coalesce(p_set_default, false), true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_venue(p_id uuid, p_name text, p_address text, p_postcode text, p_directions text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue public.venues;
  v_name text := trim(p_name);
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_venue(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'A venue name is required.'; end if;
  if exists (select 1 from public.venues where club_id = v_venue.club_id and lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  update public.venues
  set name = v_name,
      address = nullif(trim(coalesce(p_address, '')), ''),
      postcode = nullif(trim(coalesce(p_postcode, '')), ''),
      directions = nullif(trim(coalesce(p_directions, '')), ''),
      updated_by = auth.uid()
  where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_venue_active(p_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_venue(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  update public.venues set active = p_active, updated_by = auth.uid() where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_default_venue(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_venue(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if not v_venue.active then raise exception 'An inactive venue cannot be the default -- reactivate it first.'; end if;

  update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = v_venue.club_id and is_default_home and id <> p_id;
  update public.venues set is_default_home = true, updated_by = auth.uid() where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_club_pitch(p_club_id uuid, p_display_name text, p_description text DEFAULT NULL::text, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_next_sort integer;
begin
  if not (internal.can_manage_pitch(p_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'A pitch name is required.';
  end if;

  -- A pitch belongs to a venue of ITS OWN club. Without this a caller could
  -- attach one club's pitch to another club's ground, which would then pass
  -- the training validation that reads this column.
  if p_venue_id is not null and not exists (
    select 1 from public.venues v
    where v.id = p_venue_id and v.club_id = p_club_id and v.active
  ) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.club_pitches where club_id = p_club_id;

  insert into public.club_pitches (club_id, display_name, description, venue_id, sort_order, created_by, updated_by)
  values (p_club_id, trim(p_display_name), nullif(trim(p_description), ''), p_venue_id, v_next_sort, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_club_pitch(p_pitch_id uuid, p_new_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_pitch(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;
  if coalesce(trim(p_new_name), '') = '' then
    raise exception 'A pitch name is required.';
  end if;

  update public.club_pitches set display_name = trim(p_new_name), updated_by = auth.uid() where id = p_pitch_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_club_pitches(p_club_id uuid, p_pitch_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_idx integer := 0;
begin
  if not (internal.can_manage_pitch(p_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  foreach v_id in array p_pitch_ids loop
    update public.club_pitches set sort_order = v_idx, updated_by = auth.uid()
    where id = v_id and club_id = p_club_id;
    v_idx := v_idx + 1;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_club_pitch_active(p_pitch_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_pitch(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  update public.club_pitches set active = p_active, updated_by = auth.uid() where id = p_pitch_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_club_pitch_venue(p_pitch_id uuid, p_venue_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_pitch(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  -- Null clears the attachment. That is a legitimate correction, not a
  -- deletion: the pitch keeps every fixture and session that referenced it.
  if p_venue_id is not null and not exists (
    select 1 from public.venues v
    where v.id = p_venue_id and v.club_id = v_club_id and v.active
  ) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;

  update public.club_pitches
  set venue_id = p_venue_id, updated_by = auth.uid()
  where id = p_pitch_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_training_session(p_session_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_reason text := trim(coalesce(p_reason, ''));
  v_team_label text;
begin
  if v_reason = '' then
    raise exception 'A reason is required to cancel a training session.';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Cancellation reason is too long.';
  end if;

  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.can_manage_club_training(s.club_id) then
    raise exception 'Not authorized to cancel this training session.' using errcode = '42501';
  end if;
  if s.status = 'CANCELLED' then
    raise exception 'This training session has already been cancelled.';
  end if;
  -- Section 83: cancelling a genuinely completed (past) session is blocked
  -- for ordinary cancellation authority -- history is not silently rewritten.
  if s.occurrence_date is not null and s.occurrence_date < current_date then
    raise exception 'A completed training session cannot be cancelled.' using errcode = '42501';
  end if;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_by = auth.uid(), updated_by = auth.uid(),
      is_overridden = (source = 'AUTOMATIC_PLAN')
  where id = p_session_id;

  select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = s.team_id;
  perform internal.notify_training_participants(
    p_session_id, 'training_session_cancelled', 'Training cancelled',
    format('%s training on %s at %s has been cancelled.', v_team_label, to_char(s.session_date, 'DD Mon'), coalesce(to_char(s.start_time, 'HH24:MI'), 'the scheduled time'))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_training_plan(p_plan_id uuid, p_club_id uuid, p_team_id uuid, p_schedule_mode text, p_season_id uuid, p_preferred_venue_id uuid, p_preferred_pitch_id uuid, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan_id uuid;
  v_rule jsonb;
  v_needs_attention_reason text := null;
  v_status text := 'ACTIVE';
  v_season public.seasons;
  v_removed_count integer;
begin
  if not internal.can_manage_club_training(p_club_id) then
    raise exception 'You are not authorized to manage Training Plans for this club.' using errcode = '42501';
  end if;

  -- Section 48: every required field, enforced server-side regardless of
  -- what the browser sent.
  if p_team_id is null then raise exception 'A team is required.'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id and active) then
    raise exception 'That is not an active team at this club.';
  end if;
  if p_schedule_mode not in ('SEASON', 'SEASON_PRE_SEASON', 'CUSTOM') then
    raise exception 'Invalid schedule mode.';
  end if;
  if p_schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') and p_season_id is null then
    raise exception 'A season is required for this schedule mode.';
  end if;
  if p_preferred_venue_id is null then raise exception 'A preferred training venue is required.'; end if;
  if p_preferred_pitch_id is null then raise exception 'A preferred training pitch is required.'; end if;
  if not exists (select 1 from public.venues where id = p_preferred_venue_id and (club_id = p_club_id or club_id is null) and active) then
    raise exception 'That venue is not available to this club.';
  end if;
  -- Section 10: the preferred pitch must belong to the selected venue.
  if not exists (select 1 from public.club_pitches where id = p_preferred_pitch_id and club_id = p_club_id and active and venue_id = p_preferred_venue_id) then
    raise exception 'The preferred pitch must belong to the selected venue.';
  end if;
  if p_rules is null or jsonb_array_length(p_rules) = 0 then
    raise exception 'At least one schedule rule is required.';
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    if v_rule->>'weekday' is null or (v_rule->>'weekday')::integer not between 0 and 6 then
      raise exception 'Each schedule rule requires a valid weekday.';
    end if;
    if v_rule->>'start_time' is null then
      raise exception 'Each schedule rule requires a start time.';
    end if;
    if v_rule->>'duration_minutes' is null or (v_rule->>'duration_minutes')::integer < 15 or (v_rule->>'duration_minutes')::integer > 240 then
      raise exception 'Each schedule rule requires a valid duration.';
    end if;
    if p_schedule_mode = 'CUSTOM' then
      if v_rule->>'starts_on' is null or v_rule->>'ends_on' is null then
        raise exception 'Each custom schedule row requires a from and to date.';
      end if;
      if (v_rule->>'starts_on')::date > (v_rule->>'ends_on')::date then
        raise exception 'A schedule row''s from date cannot be after its to date.';
      end if;
      -- Section 49: reject a range where the selected weekday never occurs.
      if not exists (
        select 1 from generate_series((v_rule->>'starts_on')::date, (v_rule->>'ends_on')::date, interval '1 day') d
        where extract(dow from d) = (v_rule->>'weekday')::integer
      ) then
        raise exception 'This schedule row''s date range never includes the selected weekday.';
      end if;
    end if;
  end loop;

  if p_schedule_mode = 'SEASON_PRE_SEASON' then
    select * into v_season from public.seasons where id = p_season_id;
    if not found or v_season.pre_season_starts_on is null then
      v_status := 'NEEDS_ATTENTION';
      v_needs_attention_reason := 'This season has no canonical pre-season start date configured -- ask a Site Admin to set one, or switch this plan to Season only.';
    end if;
  end if;

  if p_plan_id is null then
    insert into public.training_plans (
      club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id,
      status, needs_attention_reason, created_by, updated_by
    ) values (
      p_club_id, p_team_id, p_season_id, p_schedule_mode, p_preferred_venue_id, p_preferred_pitch_id,
      v_status, v_needs_attention_reason, auth.uid(), auth.uid()
    ) returning id into v_plan_id;
  else
    v_plan_id := p_plan_id;
    if not exists (select 1 from public.training_plans where id = v_plan_id and club_id = p_club_id) then
      raise exception 'Training plan not found for this club.';
    end if;
    update public.training_plans set
      team_id = p_team_id, season_id = p_season_id, schedule_mode = p_schedule_mode,
      preferred_venue_id = p_preferred_venue_id, preferred_pitch_id = p_preferred_pitch_id,
      status = v_status, needs_attention_reason = v_needs_attention_reason,
      updated_by = auth.uid()
    where id = v_plan_id;

    -- Section 23: reconcile, never silently rewrite history. Any FUTURE,
    -- non-overridden AUTOMATIC_PLAN session belonging to this plan is
    -- cancelled (not deleted -- Section 85) before rules are replaced and
    -- regenerated; the unique occurrence index then lets the fresh
    -- generation call below recreate whatever's still valid without ever
    -- touching the past or a manually-overridden row.
    update public.training_sessions
    set status = 'CANCELLED', cancellation_reason = 'Training Plan schedule was edited.'
    where training_plan_id = v_plan_id
      and occurrence_date >= current_date
      and is_overridden = false
      and status <> 'CANCELLED';
    get diagnostics v_removed_count = row_count;

    delete from public.training_plan_schedule_rules where training_plan_id = v_plan_id;
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    insert into public.training_plan_schedule_rules (training_plan_id, weekday, starts_on, ends_on, start_time, duration_minutes)
    values (
      v_plan_id, (v_rule->>'weekday')::integer,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'starts_on')::date else null end,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'ends_on')::date else null end,
      (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
    );
  end loop;

  if v_status = 'ACTIVE' then
    perform public.generate_training_plan_sessions(v_plan_id);
  end if;

  return v_plan_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_training_plan(p_plan_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan public.training_plans;
  v_reason text := trim(coalesce(p_reason, ''));
  v_cancelled_count integer;
  v_team_label text;
  v_nearest_date date;
begin
  if v_reason = '' then
    raise exception 'A reason is required to delete a Training Plan.';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Reason is too long.';
  end if;

  select * into v_plan from public.training_plans where id = p_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.can_manage_club_training(v_plan.club_id) then
    raise exception 'You are not authorized to delete this Training Plan.' using errcode = '42501';
  end if;

  update public.training_plans
  set status = 'INACTIVE', deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = v_reason
  where id = p_plan_id;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_by = auth.uid()
  where training_plan_id = p_plan_id
    and occurrence_date >= current_date
    and is_overridden = false
    and status <> 'CANCELLED';
  get diagnostics v_cancelled_count = row_count;

  if v_cancelled_count > 0 then
    select min(occurrence_date) into v_nearest_date from public.training_sessions
      where training_plan_id = p_plan_id and status = 'CANCELLED' and cancelled_by = auth.uid() and occurrence_date >= current_date;
    select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = v_plan.team_id;
    perform internal.notify_training_participants(
      -- Any one affected session is a valid anchor for the shared
      -- training_plan_id in the notification payload -- the deep-link
      -- target for a plan-level notification is the Training Management
      -- plan view, not one specific occurrence.
      (select id from public.training_sessions where training_plan_id = p_plan_id and status = 'CANCELLED' and cancelled_by = auth.uid() order by occurrence_date limit 1),
      'training_plan_cancelled', 'Training schedule changed',
      format('%s''s recurring training plan has been cancelled from %s onward. %s future session(s) will no longer take place.', v_team_label, to_char(v_nearest_date, 'DD Mon'), v_cancelled_count)
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_training_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan public.training_plans;
begin
  select * into v_plan from public.training_plans where id = p_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.can_manage_club_training(v_plan.club_id) then
    raise exception 'You are not authorized to reactivate this Training Plan.' using errcode = '42501';
  end if;

  update public.training_plans set status = 'ACTIVE', deactivated_at = null, deactivated_by = null, deactivation_reason = null where id = p_plan_id;

  with valid_dates as (
    select distinct occurrence_date from internal.resolve_training_plan_occurrence_dates(p_plan_id)
  ),
  latest_cancelled as (
    select distinct on (ts.occurrence_date) ts.id
    from public.training_sessions ts
    join valid_dates vd on vd.occurrence_date = ts.occurrence_date
    where ts.training_plan_id = p_plan_id
      and ts.occurrence_date >= current_date
      and ts.is_overridden = false
      and ts.status = 'CANCELLED'
    order by ts.occurrence_date, ts.updated_at desc
  )
  update public.training_sessions
  set status = 'PLANNED', cancellation_reason = null
  where id in (select id from latest_cancelled);

  perform public.generate_training_plan_sessions(p_plan_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_training_plan_sessions(p_training_plan_id uuid)
 RETURNS TABLE(created_count integer, skipped_existing_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan public.training_plans;
  v_created integer;
  v_total integer;
begin
  select * into v_plan from public.training_plans where id = p_training_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.can_manage_club_training(v_plan.club_id) then
    raise exception 'You are not authorized to generate sessions for this plan.' using errcode = '42501';
  end if;
  if v_plan.status <> 'ACTIVE' then
    return query select 0, 0;
    return;
  end if;

  select count(*) into v_total from internal.resolve_training_plan_occurrence_dates(p_training_plan_id);

  with resolved as (
    select * from internal.resolve_training_plan_occurrence_dates(p_training_plan_id)
  ),
  ins as (
    insert into public.training_sessions (
      club_id, team_id, training_plan_id, schedule_rule_id, season_id,
      session_date, occurrence_date, start_time, end_time, duration_minutes,
      venue_id, pitch_id, source, status, created_by, updated_by
    )
    select
      v_plan.club_id, v_plan.team_id, v_plan.id, r.schedule_rule_id, v_plan.season_id,
      r.occurrence_date, r.occurrence_date, r.start_time, (r.start_time + make_interval(mins => r.duration_minutes))::time, r.duration_minutes,
      v_plan.preferred_venue_id, v_plan.preferred_pitch_id, 'AUTOMATIC_PLAN', 'PLANNED', auth.uid(), auth.uid()
    from resolved r
    on conflict (training_plan_id, occurrence_date) where training_plan_id is not null and occurrence_date is not null and status <> 'CANCELLED' do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return query select v_created, (v_total - v_created);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_management_overview(p_club_id uuid)
 RETURNS TABLE(active_plan_count integer, teams_without_plan_count integer, upcoming_session_count integer, needs_attention_plan_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.can_manage_club_training(p_club_id) or internal.has_capability('fixture.view', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to view Training Management for this club.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'ACTIVE'),
    (select count(*)::integer from public.teams t where t.club_id = p_club_id and t.active
       and not exists (select 1 from public.training_plans tp where tp.team_id = t.id and tp.status <> 'INACTIVE')),
    (select count(*)::integer from public.training_sessions where club_id = p_club_id and occurrence_date >= current_date and status <> 'CANCELLED'),
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'NEEDS_ATTENTION');
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_plan_deletion_impact(p_plan_id uuid)
 RETURNS TABLE(team_label text, schedule_mode text, venue_name text, pitch_name text, future_session_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan public.training_plans;
begin
  select * into v_plan from public.training_plans where id = p_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.can_manage_club_training(v_plan.club_id) then
    raise exception 'You are not authorized to view this Training Plan.' using errcode = '42501';
  end if;

  return query
  select
    coalesce(t.display_name, 'Team'), v_plan.schedule_mode, v.name, cp.display_name,
    (select count(*)::integer from public.training_sessions ts
       where ts.training_plan_id = p_plan_id and ts.occurrence_date >= current_date and ts.is_overridden = false and ts.status <> 'CANCELLED')
  from public.teams t
  left join public.venues v on v.id = v_plan.preferred_venue_id
  left join public.club_pitches cp on cp.id = v_plan.preferred_pitch_id
  where t.id = v_plan.team_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_session_card(p_training_session_id uuid)
 RETURNS TABLE(id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid, season_id uuid, training_plan_id uuid, session_date date, start_time time without time zone, end_time time without time zone, duration_minutes integer, venue_id uuid, venue_name text, pitch_id uuid, pitch_name text, status text, source text, agenda text, further_notes text, notes text, cancelled_at timestamp with time zone, cancellation_reason text, cancelled_by_name text, my_attendance_status text, can_manage boolean, can_view_register boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_can_manage boolean;
  v_can_view_register boolean;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  -- THE GATE. Without it this SECURITY DEFINER function handed any session to
  -- anyone holding its id, whatever the table's policy said.
  if not internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id) then
    raise exception 'You are not authorized to view this training session.' using errcode = '42501';
  end if;

  v_can_manage := internal.can_manage_training(s.club_id, s.team_id) or internal.can_manage_club_training(s.club_id);
  v_can_view_register := v_can_manage
    or internal.has_capability('team.attendance.view', 'team', s.club_id, s.team_id)
    or internal.has_capability('team.attendance.view', 'club', s.club_id, null);

  return query
  select
    sess.id, sess.club_id, sess.team_id,
    coalesce(t.display_name, sg.display_tag, 'Team'),
    sess.scheduling_group_id, sess.season_id, sess.training_plan_id,
    sess.session_date, sess.start_time, sess.end_time, sess.duration_minutes,
    sess.venue_id, v.name, sess.pitch_id, cp.display_name,
    sess.status, sess.source, sess.agenda, sess.further_notes, sess.notes,
    sess.cancelled_at, sess.cancellation_reason,
    case when sess.cancelled_by is not null then trim(coalesce(prof.first_name, '') || ' ' || coalesce(prof.surname, '')) else null end,
    (
      select a.status from public.player_fixture_attendance a
      join public.players p on p.id = a.player_id
      where a.training_session_id = sess.id
        and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
      order by a.updated_at desc limit 1
    ),
    v_can_manage, v_can_view_register
  from public.training_sessions sess
  left join public.teams t on t.id = sess.team_id
  left join public.scheduling_groups sg on sg.id = sess.scheduling_group_id
  left join public.venues v on v.id = sess.venue_id
  left join public.club_pitches cp on cp.id = sess.pitch_id
  left join public.profiles prof on prof.id = sess.cancelled_by
  where sess.id = p_training_session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.override_training_session(p_session_id uuid, p_session_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_duration_minutes integer DEFAULT NULL::integer, p_venue_id uuid DEFAULT NULL::uuid, p_pitch_id uuid DEFAULT NULL::uuid, p_cancel boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_agenda text DEFAULT NULL::text, p_further_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_further_notes text;
  v_changed boolean := false;
  v_team_label text;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.can_manage_club_training(s.club_id) then
    raise exception 'You are not authorized to change this Training Session.' using errcode = '42501';
  end if;
  if p_cancel then
    -- Section 33-34: cancellation is its own dedicated, reason-required
    -- flow (cancel_training_session) -- this legacy parameter is kept
    -- only so the existing occurrence-override smoke test/regression call
    -- keeps compiling; routed straight through rather than duplicated.
    perform public.cancel_training_session(p_session_id, p_reason);
    return;
  end if;

  if p_venue_id is not null and p_pitch_id is not null and not exists (
    select 1 from public.club_pitches where id = p_pitch_id and club_id = s.club_id and venue_id = p_venue_id
  ) then
    raise exception 'The selected pitch does not belong to the selected venue.';
  end if;
  if p_agenda is not null and char_length(trim(p_agenda)) = 0 then
    raise exception 'Agenda cannot be blank.';
  end if;
  if p_agenda is not null and char_length(p_agenda) > 4000 then
    raise exception 'Agenda is too long.';
  end if;
  v_further_notes := case when p_further_notes is not null then nullif(trim(p_further_notes), '') else null end;
  if p_further_notes is not null and char_length(p_further_notes) > 2000 then
    raise exception 'Further notes are too long.';
  end if;

  v_changed := (p_session_date is not null and p_session_date is distinct from s.session_date)
    or (p_start_time is not null and p_start_time is distinct from s.start_time)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from s.duration_minutes)
    or (p_venue_id is not null and p_venue_id is distinct from s.venue_id)
    or (p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id)
    or (p_agenda is not null and trim(p_agenda) is distinct from s.agenda)
    or (p_further_notes is not null and v_further_notes is distinct from s.further_notes);

  update public.training_sessions set
    session_date = coalesce(p_session_date, session_date),
    occurrence_date = coalesce(p_session_date, occurrence_date),
    start_time = coalesce(p_start_time, start_time),
    duration_minutes = coalesce(p_duration_minutes, duration_minutes),
    end_time = case when p_start_time is not null or p_duration_minutes is not null
      then (coalesce(p_start_time, start_time) + make_interval(mins => coalesce(p_duration_minutes, duration_minutes)))::time
      else end_time end,
    venue_id = coalesce(p_venue_id, venue_id),
    pitch_id = coalesce(p_pitch_id, pitch_id),
    agenda = coalesce(nullif(trim(p_agenda), ''), agenda),
    further_notes = case when p_further_notes is not null then v_further_notes else further_notes end,
    is_overridden = true,
    updated_by = auth.uid()
  where id = p_session_id;

  if v_changed then
    select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = s.team_id;
    perform internal.notify_training_participants(
      p_session_id, 'training_session_updated', 'Training updated',
      format('%s training on %s has been updated.', v_team_label, to_char(coalesce(p_session_date, s.session_date), 'DD Mon'))
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_training_plan_occurrences(p_club_id uuid, p_schedule_mode text, p_season_id uuid, p_rules jsonb)
 RETURNS TABLE(schedule_rule_index integer, occurrence_date date, start_time time without time zone, duration_minutes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_season public.seasons;
  v_rule jsonb;
  v_idx integer := 0;
begin
  if not internal.can_manage_club_training(p_club_id) then
    raise exception 'You are not authorized to preview Training Plans for this club.' using errcode = '42501';
  end if;

  if p_schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') then
    select * into v_season from public.seasons where id = p_season_id;
    if not found then
      raise exception 'Season not found.' using errcode = '22023';
    end if;
    if p_schedule_mode = 'SEASON_PRE_SEASON' and v_season.pre_season_starts_on is null then
      return;
    end if;
    for v_rule in select * from jsonb_array_elements(p_rules)
    loop
      return query
        select v_idx, d::date, (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
        from generate_series(
          case when p_schedule_mode = 'SEASON_PRE_SEASON' then v_season.pre_season_starts_on else v_season.starts_on end,
          v_season.ends_on, interval '1 day'
        ) as d
        where extract(dow from d) = (v_rule->>'weekday')::integer;
      v_idx := v_idx + 1;
    end loop;
  else
    for v_rule in select * from jsonb_array_elements(p_rules)
    loop
      return query
        select v_idx, d::date, (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
        from generate_series((v_rule->>'starts_on')::date, (v_rule->>'ends_on')::date, interval '1 day') as d
        where extract(dow from d) = (v_rule->>'weekday')::integer;
      v_idx := v_idx + 1;
    end loop;
  end if;
end;
$function$;

-- 5. Three stragglers ---------------------------------------------------------------------------
-- set_venue_address was the odd one out among the venue RPCs: it asked the deprecated
-- club.venues.manage key *and* carried a bare is_site_admin() bypass, while its four siblings asked
-- is_club_admin. Three different answers to "may you change this venue". It now asks the same gate
-- as the rest.
--
-- The other two are borrowings, and they are corrected rather than re-owned. A training surface may
-- legitimately ask a fixture question or an attendance question -- what it may not do is ask them
-- through the deprecated adapter:
--
--   get_training_management_overview  'fixture.view'  (DEPRECATED, J.15)
--                                       -> internal.can('fixture.fixture.view', ...)   4C's key, 4C's meaning
--   get_training_session_card         'team.attendance.view' via internal.has_capability
--                                       -> internal.can('team.attendance.view', ...)   4B's key, 4B's meaning
--
-- Neither changes what those slices decided; both stop routing a canonical question through the
-- legacy adapter. get_training_session_card's bare is_site_admin() is replaced by the same explicit
-- site master the rest of this slice uses.

-- 5. Three stragglers ---------------------------------------------------------------------------
-- set_venue_address was the odd one out among the venue RPCs: it asked the deprecated
-- club.venues.manage key *and* carried a bare is_site_admin() bypass, while its four siblings asked
-- is_club_admin. Three different answers to "may you change this venue". It now asks the same gate.
--
-- The other two are borrowings, corrected rather than re-owned. A training surface may legitimately
-- ask a fixture question or an attendance question; what it may not do is ask them through the
-- legacy adapter:
--
--   get_training_management_overview  'fixture.view' (DEPRECATED, J.15)
--                                       -> internal.can('fixture.fixture.view', ...)   4C's key, 4C's meaning
--   get_training_session_card         'team.attendance.view' via internal.has_capability, twice
--                                       -> internal.can('team.attendance.view', ...)   4B's key, 4B's meaning
--
-- Neither changes what those slices decided. internal.has_capability passes a non-legacy key
-- straight through to the canonical decision, so for an ACTIVE key the two forms are the same
-- answer -- which is exactly why the adapter should not be the one asking.
CREATE OR REPLACE FUNCTION public.set_venue_address(p_venue_id uuid, p_line1 text, p_line2 text, p_town text, p_county text, p_postcode text, p_country text DEFAULT 'United Kingdom'::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_provider_ref text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid;
begin
  select club_id into v_club from public.venues where id = p_venue_id;
  if v_club is null then
    raise exception 'No such venue.';
  end if;

  if not (internal.can_manage_venue(v_club)) then
    raise exception 'Not authorized to change this venue.' using errcode = '42501';
  end if;

  update public.venues
  set address_line_1 = nullif(btrim(p_line1), ''),
      address_line_2 = nullif(btrim(p_line2), ''),
      town = nullif(btrim(p_town), ''),
      county = nullif(btrim(p_county), ''),
      postcode = nullif(btrim(p_postcode), ''),
      country = coalesce(nullif(btrim(p_country), ''), 'United Kingdom'),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      address_provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), address_provider_ref),
      -- The display line is regenerated from the structured parts, so the
      -- legacy column stays truthful rather than becoming stale.
      address = nullif(concat_ws(', ',
        nullif(btrim(p_line1), ''), nullif(btrim(p_line2), ''),
        nullif(btrim(p_town), ''), nullif(btrim(p_county), '')), ''),
      updated_by = auth.uid()
  where id = p_venue_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_management_overview(p_club_id uuid)
 RETURNS TABLE(active_plan_count integer, teams_without_plan_count integer, upcoming_session_count integer, needs_attention_plan_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.can_manage_club_training(p_club_id) or internal.can('fixture.fixture.view', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorized to view Training Management for this club.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'ACTIVE'),
    (select count(*)::integer from public.teams t where t.club_id = p_club_id and t.active
       and not exists (select 1 from public.training_plans tp where tp.team_id = t.id and tp.status <> 'INACTIVE')),
    (select count(*)::integer from public.training_sessions where club_id = p_club_id and occurrence_date >= current_date and status <> 'CANCELLED'),
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'NEEDS_ATTENTION');
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_training_session_card(p_training_session_id uuid)
 RETURNS TABLE(id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid, season_id uuid, training_plan_id uuid, session_date date, start_time time without time zone, end_time time without time zone, duration_minutes integer, venue_id uuid, venue_name text, pitch_id uuid, pitch_name text, status text, source text, agenda text, further_notes text, notes text, cancelled_at timestamp with time zone, cancellation_reason text, cancelled_by_name text, my_attendance_status text, can_manage boolean, can_view_register boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.training_sessions;
  v_can_manage boolean;
  v_can_view_register boolean;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  -- THE GATE. Without it this SECURITY DEFINER function handed any session to
  -- anyone holding its id, whatever the table's policy said.
  if not internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id) then
    raise exception 'You are not authorized to view this training session.' using errcode = '42501';
  end if;

  v_can_manage := internal.can_manage_training(s.club_id, s.team_id) or internal.can_manage_club_training(s.club_id);
  v_can_view_register := v_can_manage
    or internal.can('team.attendance.view', 'team', s.club_id, s.team_id, null)
    or internal.can('team.attendance.view', 'club', s.club_id, null, null);

  return query
  select
    sess.id, sess.club_id, sess.team_id,
    coalesce(t.display_name, sg.display_tag, 'Team'),
    sess.scheduling_group_id, sess.season_id, sess.training_plan_id,
    sess.session_date, sess.start_time, sess.end_time, sess.duration_minutes,
    sess.venue_id, v.name, sess.pitch_id, cp.display_name,
    sess.status, sess.source, sess.agenda, sess.further_notes, sess.notes,
    sess.cancelled_at, sess.cancellation_reason,
    case when sess.cancelled_by is not null then trim(coalesce(prof.first_name, '') || ' ' || coalesce(prof.surname, '')) else null end,
    (
      select a.status from public.player_fixture_attendance a
      join public.players p on p.id = a.player_id
      where a.training_session_id = sess.id
        and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
      order by a.updated_at desc limit 1
    ),
    v_can_manage, v_can_view_register
  from public.training_sessions sess
  left join public.teams t on t.id = sess.team_id
  left join public.scheduling_groups sg on sg.id = sess.scheduling_group_id
  left join public.venues v on v.id = sess.venue_id
  left join public.club_pitches cp on cp.id = sess.pitch_id
  left join public.profiles prof on prof.id = sess.cancelled_by
  where sess.id = p_training_session_id;
end;
$function$;

-- 6. EXECUTE for the policy helpers --------------------------------------------------------------
-- An RLS policy expression is evaluated with the privileges of the role running the query, not the
-- definer's, so every helper a policy calls needs EXECUTE for the roles that read or write that
-- table. Slice 4D learned this twice: once by forgetting the grant and once by removing it.
--
-- `authenticated` only, and that is deliberate rather than an oversight. Anonymous visitors do not
-- evaluate any of these policies: after 20270365000000 anon holds no grant on venues, club_pitches,
-- training_plans, training_sessions, training_plan_schedule_rules or club_events, and reads the
-- public venue name through the definer-rights view public.public_venues instead. The assertion
-- below states both halves, so a future grant that quietly widens either one fails here.
grant execute on function internal.can_manage_venue(uuid) to authenticated;
grant execute on function internal.can_manage_pitch(uuid) to authenticated;
grant execute on function internal.can_view_venue(uuid) to authenticated;
grant execute on function internal.can_manage_training(uuid, uuid) to authenticated;
grant execute on function internal.can_manage_club_training(uuid) to authenticated;
grant execute on function internal.training_session_visible_row(uuid, uuid, uuid) to authenticated;
grant execute on function internal.club_event_visible_row(uuid, uuid, boolean) to authenticated;

do $$
declare r record;
begin
  for r in select unnest(array[
    'internal.can_manage_venue(uuid)', 'internal.can_manage_pitch(uuid)', 'internal.can_view_venue(uuid)',
    'internal.can_manage_training(uuid, uuid)', 'internal.can_manage_club_training(uuid)',
    'internal.training_session_visible_row(uuid, uuid, uuid)', 'internal.club_event_visible_row(uuid, uuid, boolean)'
  ]) as sig loop
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'authenticated cannot execute %, so the policy that calls it would refuse every signed-in reader.', r.sig;
    end if;
    if has_function_privilege('anon', r.sig, 'EXECUTE') then
      raise exception 'anon can execute %, which widens the API perimeter beyond what any policy needs.', r.sig;
    end if;
  end loop;
end $$;

-- 7. Hoistable sets for the training read policies ----------------------------------------------
-- Measured, not assumed. internal.training_session_visible_row is SECURITY DEFINER, which Postgres
-- cannot inline, so a policy calling it per row makes one canonical decision per candidate row.
-- Reading one club's 800 training sessions as its Club Admin:
--
--   pre-4E (raw membership read inside the helper)   46.7 ms
--   4E gate, still called per row                   106.9 ms      <- a real 2.3x regression
--
-- The club and team sets depend only on WHO is asking, not on the row, so they belong in the policy
-- as uncorrelated subqueries the planner evaluates once per statement as InitPlans. This is the
-- same fix Slice 4C applied to fixtures_select_related and Slice 4D to the competition reads.
--
-- Both sets are bounded by the caller's OWN active memberships, so neither can widen what the
-- policy already allowed: a club the caller has no membership at never enters the set.
create or replace function internal.training_visible_clubs()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct cm.club_id), '{}'::uuid[])
  from public.club_memberships cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'
    and internal.can('training.session.view', 'club', cm.club_id, null, null);
$$;

create or replace function internal.training_visible_teams()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct tp.team_id), '{}'::uuid[])
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id
  join public.teams t on t.id = tp.team_id
  where cm.user_id = auth.uid()
    and cm.status = 'active'
    and internal.can('training.session.view', 'team', t.club_id, tp.team_id, null);
$$;

-- The row-dependent half: a player on the team training, or the adult responsible for one. This is
-- Slice 4A's question and keeps 4A's helpers, so it stays a function rather than a set.
-- COST 10000 is deliberate. Left at the default of 100 the planner treats this as comparable to the
-- hoisted set tests and may evaluate it FIRST, which puts a per-row family lookup in front of a
-- cheap InitPlan membership test. Measured on training_plans that way: 6.6 ms for 50 rows and
-- 53.8 ms for 400 -- linear, so it was running per row. Telling the planner what it actually costs
-- makes it the last disjunct tried, which is what short-circuiting the cheap branches requires.
create or replace function internal.training_family_visible_row(p_team_id uuid, p_scheduling_group_id uuid)
returns boolean
language sql stable security definer set search_path = public cost 10000 as $$
  select exists (
    select 1
    from public.player_team_memberships ptm
    where ptm.status = 'active'
      and (
        (p_team_id is not null and ptm.team_id = p_team_id)
        or (p_scheduling_group_id is not null and exists (
              select 1 from public.scheduling_group_members sgm
              where sgm.group_id = p_scheduling_group_id and sgm.team_id = ptm.team_id))
      )
      and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
  );
$$;

comment on function internal.training_visible_clubs() is
  'Slice 4E: the caller''s own clubs where they hold training.session.view, computed once per '
  'statement as a policy InitPlan. Bounded by the caller''s active memberships.';
comment on function internal.training_family_visible_row(uuid, uuid) is
  'Slice 4E: the row-dependent family branch of training visibility -- Slice 4A''s question, kept '
  'with 4A''s helpers.';

grant execute on function internal.training_visible_clubs() to authenticated;
grant execute on function internal.training_visible_teams() to authenticated;
grant execute on function internal.training_family_visible_row(uuid, uuid) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'internal.training_visible_clubs()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'internal.training_visible_teams()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'internal.training_family_visible_row(uuid, uuid)', 'EXECUTE') then
    raise exception 'a training policy helper is not executable by authenticated; every signed-in reader would be refused.';
  end if;
  if has_function_privilege('anon', 'internal.training_visible_clubs()', 'EXECUTE') then
    raise exception 'anon can execute internal.training_visible_clubs(); anon reads no training table.';
  end if;
end $$;

-- 8. The manage sets, for the same reason ---------------------------------------------------------
-- training_plans_write_scoped is a FOR ALL policy, so its USING clause is OR'd into every SELECT as
-- well. That is why reading training plans stayed linear after the read policy was hoisted: the
-- plan showed internal.can_manage_training(club_id, team_id) as the FIRST filter term, evaluated
-- per row, with both hoisted SubPlans "never executed".
--
-- It did not show up before this slice only because training_plans_select was `true`, which let the
-- planner satisfy every row from the trivial policy and never call the write gate at all. Enforcing
-- a read that was previously unenforced is what exposed it.
create or replace function internal.training_manageable_clubs()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct cm.club_id), '{}'::uuid[])
  from public.club_memberships cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'
    and internal.can('training.plan.manage', 'club', cm.club_id, null, null);
$$;

create or replace function internal.training_manageable_teams()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct tp.team_id), '{}'::uuid[])
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id
  join public.teams t on t.id = tp.team_id
  where cm.user_id = auth.uid()
    and cm.status = 'active'
    and internal.can('training.plan.manage', 'team', t.club_id, tp.team_id, null);
$$;

comment on function internal.training_manageable_clubs() is
  'Slice 4E: the caller''s own clubs where they hold training.plan.manage, as a policy InitPlan. '
  'internal.can_manage_training remains the gate the RPCs ask -- this is the same question in set form.';

grant execute on function internal.training_manageable_clubs() to authenticated;
grant execute on function internal.training_manageable_teams() to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'internal.training_manageable_clubs()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'internal.training_manageable_teams()', 'EXECUTE') then
    raise exception 'a training manage-set helper is not executable by authenticated.';
  end if;
end $$;

-- 9. Remove the duplicated family branch ---------------------------------------------------------
-- internal.training_session_visible_row still carried its own copy of the Slice 4A family branch
-- after internal.training_family_visible_row was introduced to carry it for the policies. Both
-- bodies then referenced is_own_linked_player and is_active_player_guardian, so 4A's retirement
-- counters saw each call site twice and read one over their ceilings.
--
-- This is exactly what Slice 4C hit when internal.fixture_visible_row outlived its replacement, and
-- the lesson is the same: an expand step that copies a branch must leave only one copy behind. The
-- helper keeps its two remaining callers -- internal.can_view_training_session and
-- public.get_training_session_card -- and now delegates the family question instead of repeating it.
create or replace function internal.training_session_visible_row(p_club_id uuid, p_team_id uuid, p_scheduling_group_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    internal.has_site_capability('site.support.view_club')
    or internal.can('training.session.view', 'club', p_club_id, null, null)
    or (p_team_id is not null
        and internal.can('training.session.view', 'team', p_club_id, p_team_id, null))
    or internal.training_family_visible_row(p_team_id, p_scheduling_group_id);
$$;
