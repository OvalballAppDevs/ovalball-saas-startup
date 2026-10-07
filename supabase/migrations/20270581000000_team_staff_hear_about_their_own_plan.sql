-- TRAINING PLAN NOTIFICATIONS FOR TEAM STAFF -- Training Planning brief, Sections 10/22/31.
--
-- Confirmed before writing this (forensics pass): internal.notify_training_participants
-- (20261011060000) notifies PARTICIPANTS (active guardians + self-managed adult players) for
-- occurrence-level events (session changed/cancelled). That is left completely untouched here --
-- it is the right audience for "your Tuesday session moved". Nothing in this codebase notifies TEAM
-- STAFF about anything, and the brief explicitly wants "Training Plan Created" / a plan's schedule
-- materially changing to reach Team Staff, not families. This is a new, small, genuinely missing
-- notifier -- not a second copy of the participant one.
--
-- ONE NOTIFICATION PER PLAN EVENT, NEVER PER OCCURRENCE (Section 31's explicit instruction). This is
-- called exactly once from save_training_plan, after every occurrence for the whole plan has already
-- been generated -- never once per generated session.
--
-- Recipient resolution mirrors public.team_staff(uuid) (20270570000000) exactly: every ACTIVE
-- role_assignments row for this team, joined through an ACTIVE club_memberships row, deduplicated.
-- team_staff() itself is a read-shaped table function (for the Team Profile staff list) and is not
-- reused directly here only because this needs a plain set of recipient user_ids, not its display
-- projection -- the underlying query is copied, not a new authority model invented.

insert into public.notification_types (type_key, topic_key) values
  ('training_plan_created', 'calendar_training_updates'),
  ('training_plan_schedule_changed', 'calendar_training_updates')
on conflict (type_key) do nothing;

create or replace function internal.notify_team_staff(p_team_id uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select distinct cm.user_id, p_type, p_title, p_body, p_data
  from public.role_assignments ra
  join public.club_memberships cm on cm.id = ra.membership_id
  where ra.team_id = p_team_id
    and ra.state = 'ACTIVE'
    and cm.state = 'ACTIVE';
end;
$function$;

comment on function internal.notify_team_staff is
  'Training Planning: notifies every person holding an active team role on p_team_id -- the same recipient set public.team_staff(uuid) reads for display, copied here as a plain insert rather than reused directly because this needs recipient ids, not team_staff''s roles-aggregated display shape. One INSERT per call; callers are responsible for calling this once per plan-level event, never once per occurrence.';

revoke execute on function internal.notify_team_staff(uuid, text, text, text, jsonb) from public, anon;
grant execute on function internal.notify_team_staff(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Wire it into save_training_plan -- same full signature and body as 20261011010000's own definition,
-- plus: capture whether this call is a create (before p_plan_id is reused for the resolved id), and
-- notify Team Staff once at the very end, after generation, with a human-readable weekly summary.
-- Every validation/authority/generation line below is unchanged from the existing function; only the
-- v_is_new declaration/capture and the trailing notification block are new.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.save_training_plan(
  p_plan_id uuid, -- null to create
  p_club_id uuid, p_team_id uuid, p_schedule_mode text, p_season_id uuid,
  p_preferred_venue_id uuid, p_preferred_pitch_id uuid, p_rules jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan_id uuid;
  v_rule jsonb;
  v_needs_attention_reason text := null;
  v_status text := 'ACTIVE';
  v_season public.seasons;
  v_removed_count integer;
  v_is_new boolean := (p_plan_id is null);
  v_team_label text;
  v_venue_label text;
  v_schedule_summary text;
begin
  if not internal.has_capability('club.training.manage', 'club', p_club_id, null) then
    raise exception 'You are not authorized to manage Training Plans for this club.' using errcode = '42501';
  end if;

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

  -- Training Planning Section 31: one notification for the whole plan event, sent to Team Staff,
  -- after generation, never one per generated occurrence.
  select display_name into v_team_label from public.teams where id = p_team_id;
  select name into v_venue_label from public.venues where id = p_preferred_venue_id;
  select string_agg(
    (case r.weekday
      when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday' when 3 then 'Wednesday'
      when 4 then 'Thursday' when 5 then 'Friday' when 6 then 'Saturday'
    end) || ' ' || to_char(r.start_time, 'FMHH24:MI'),
    ', ' order by r.weekday
  ) into v_schedule_summary
  from (
    select distinct weekday, start_time from public.training_plan_schedule_rules where training_plan_id = v_plan_id
  ) r;

  if v_is_new then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_created', 'Training plan created',
      format('%s''s training schedule is now available: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  elsif coalesce(v_removed_count, 0) > 0 then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_schedule_changed', 'Training plan updated',
      format('%s''s training schedule has changed from today: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  end if;

  return v_plan_id;
end;
$function$;

revoke all on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb) to authenticated;
