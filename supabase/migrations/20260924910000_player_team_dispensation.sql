-- LONGER-TERM PLAYER DISPENSATION (Mini-Rugby / Team Administration /
-- Season Handover brief, amendment): unlike fixture_player_call_up
-- (one match, never touching canonical membership), a dispensation is
-- a season-long, case-by-case exception to normal age-grade placement
-- (e.g. a genuine RFU/RFL age dispensation) that a club must actually
-- track through its real internal + external sign-off chain -- source
-- team consent, the club's own formal approval, then external
-- governing-body approval -- before it is safe to rely on. Unlike a
-- call-up, direction is NOT constrained to "up only": a dispensation
-- can legitimately run either direction (this is exactly the
-- mechanism for the cases a simple call-up's hard up-only rule
-- correctly refuses to allow).
--
-- governing_body_reference is free text the CLUB records (e.g. a real
-- dispensation certificate number they hold) -- Ovalball does not
-- verify it against any external RFU/RFL system, and no specific
-- governing-body rule (which age gaps are ever permitted, how long a
-- dispensation may run) is hardcoded here, since none has been
-- verified for this brief (see the project's GOVERNING-BODY
-- CONFIRMATION REQUIRED items).

create table public.player_team_dispensation (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id),
  source_team_id uuid not null references public.teams(id),
  target_team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  eligibility_rule_reference text not null,
  status text not null default 'requested' check (status in (
    'requested', 'source_team_approved', 'club_approved', 'governing_body_approved',
    'approved', 'rejected', 'expired', 'revoked'
  )),
  requested_by uuid references auth.users(id),
  source_team_decided_by uuid references auth.users(id),
  source_team_decided_at timestamptz,
  club_decided_by uuid references auth.users(id),
  club_decided_at timestamptz,
  governing_body_reference text,
  governing_body_decided_by uuid references auth.users(id),
  governing_body_decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, target_team_id, season_id)
);

comment on table public.player_team_dispensation is
  'A season-long dispensation moving a player between two teams at the SAME club, tracked through its real approval chain (source team -> club -> governing body) before it reaches "approved". Never mutates player_team_memberships itself -- a UI/RPC layer consuming an approved dispensation to actually add the player to the target team is a separate, later step, exactly like a call-up never mutating membership either.';

alter table public.player_team_dispensation enable row level security;

create policy player_team_dispensation_select on public.player_team_dispensation
  for select using (
    internal.can_manage_team(source_team_id)
    or internal.can_manage_team(target_team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = source_team_id))
    or internal.is_site_admin()
  );

create or replace function public.request_player_dispensation(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_source_club uuid;
  v_target_club uuid;
begin
  select club_id into v_source_club from public.teams where id = p_source_team_id;
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if v_source_club is distinct from v_target_club then
    raise exception 'A dispensation can only move a player between two teams of the SAME club.' using errcode = '23514';
  end if;
  if not (internal.can_manage_team(p_target_team_id) or internal.can_manage_club_fixtures(v_target_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to request a dispensation onto this team.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.player_team_memberships
    where player_id = p_player_id and team_id = p_source_team_id and status = 'active' and ended_at is null
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A dispensation requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, requested_by)
  values (p_player_id, p_source_team_id, p_target_team_id, p_season_id, p_eligibility_rule_reference, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.request_player_dispensation(uuid, uuid, uuid, uuid, text) to authenticated;

-- decide_player_dispensation: advances or rejects exactly the NEXT
-- stage in the chain -- a stage can never be skipped, and 'reject' at
-- any stage is terminal (a rejected dispensation must be re-requested
-- from scratch, never silently resurrected).
create or replace function public.decide_player_dispensation(p_id uuid, p_stage text, p_approve boolean, p_governing_body_reference text default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;

  if p_stage = 'source_team' then
    if d.status <> 'requested' then
      raise exception 'This dispensation is not awaiting source-team approval (current status: %).', d.status;
    end if;
    if not (internal.can_manage_team(d.source_team_id) or internal.can_manage_club_fixtures(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to give source-team approval -- only the source team (the one lending the player) or that club''s fixture secretary/admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'source_team_approved' else 'rejected' end,
        source_team_decided_by = auth.uid(), source_team_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'club' then
    if d.status <> 'source_team_approved' then
      raise exception 'This dispensation is not awaiting club approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to give club approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'club_approved' else 'rejected' end,
        club_decided_by = auth.uid(), club_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'governing_body' then
    if d.status <> 'club_approved' then
      raise exception 'This dispensation is not awaiting governing-body approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to record governing-body approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    if p_approve and coalesce(trim(p_governing_body_reference), '') = '' then
      raise exception 'Recording governing-body approval requires a reference (e.g. the dispensation certificate/case number the club holds).';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'approved' else 'rejected' end,
        governing_body_reference = p_governing_body_reference,
        governing_body_decided_by = auth.uid(), governing_body_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  else
    raise exception 'Unknown dispensation stage: %', p_stage;
  end if;
end;
$$;

grant execute on function public.decide_player_dispensation(uuid, text, boolean, text, text) to authenticated;

create or replace function public.revoke_player_dispensation(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  if d.status <> 'approved' then
    raise exception 'Only an approved dispensation can be revoked (current status: %).', d.status;
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;
  if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to revoke this dispensation -- only this club''s Club Admin may revoke.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to revoke a dispensation.';
  end if;

  update public.player_team_dispensation
  set status = 'revoked', decision_reason = p_reason, updated_at = now()
  where id = p_id;
end;
$$;

grant execute on function public.revoke_player_dispensation(uuid, text) to authenticated;

-- internal.expire_due_dispensations: a dispensation still short of full
-- approval once its own season has ended is stale, not silently valid
-- forever -- swept on the SAME schedule as the season transition
-- engine (registered separately below) rather than a second cron job.
create or replace function internal.expire_due_dispensations()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.player_team_dispensation d
  set status = 'expired', updated_at = now()
  from public.seasons s
  where d.season_id = s.id
    and d.status in ('requested', 'source_team_approved', 'club_approved')
    and s.ends_on < current_date;
$$;

select cron.schedule('expire-due-dispensations', '0 3 * * *', $$select internal.expire_due_dispensations()$$);
