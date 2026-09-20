-- =====================================================================
-- VOLUNTEER PRESETS — V-3, and AC.Presets.
--
-- A club does not think "grant venue.pitch_allocation.view and
-- venue.pitch_allocation.manage to Nadia". It thinks "Nadia is doing the pitch
-- allocation this season". The capability engine has always been able to
-- express the second as the first; nothing has ever let a club SAY it.
--
-- Three presets are named by the design: Pitch Allocation, Calendar, and Team
-- Fixtures. AC.Presets requires that applying one happens "in one transaction
-- with one event per override".
--
-- THE CRITICAL DESIGN DECISION, and the reason this migration is short:
-- applying a preset CALLS public.set_capability_override once per capability.
-- It does not reimplement one line of it. That function is a hundred and fifty
-- lines of accumulated judgement -- the delegation ceiling ("nobody delegates
-- what they do not have"), the minor prohibition, the age-eligibility hint,
-- the refusal to let a club give a Volunteer people or finance authority, P37's
-- refusal to record an allow a broader withhold would defeat, the club-people
-- lock that stops a decision racing a suspension, and the event pair that makes
-- a replacement legible. A preset that bypassed any of it would be a second
-- authority path wearing a convenience label, which is exactly the thing the
-- capability engine exists to prevent.
--
-- A preset is therefore DATA plus a loop. It can grant nothing that the person
-- applying it could not have granted one at a time, and it produces exactly the
-- same audit trail as if they had.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The presets themselves.
-- ---------------------------------------------------------------------
create table if not exists public.capability_presets (
  key            text primary key,
  label          text not null,
  description    text not null,
  -- The scope a preset is applied at. Every capability it names must be valid
  -- there, which the guard at the bottom of this file proves.
  scope_type     text not null check (scope_type in ('club', 'team')),
  -- The role the preset is written for. Presentation and ordering only: the
  -- authority to apply it comes from the capability engine, never from this.
  role_key       text not null references public.role_definitions(role_key),
  sort_order     integer not null default 0,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_at     timestamptz not null default now()
);

comment on table public.capability_presets is
  'Named bundles of delegable capabilities a club can apply in one action (V-3 / AC.Presets). '
  'Presentation and grouping only -- applying one calls set_capability_override per capability, '
  'so a preset can never grant what the person applying it could not grant individually.';

create table if not exists public.capability_preset_capabilities (
  preset_key     text not null references public.capability_presets(key) on delete cascade,
  capability_key text not null references public.capabilities(key),
  sort_order     integer not null default 0,
  primary key (preset_key, capability_key)
);

alter table public.capability_presets enable row level security;
alter table public.capability_preset_capabilities enable row level security;

-- A preset catalogue is not secret: it describes jobs a club can hand out, not
-- anybody's actual permissions. Read to any signed-in person; writable by
-- nobody through the API -- the catalogue changes by migration, like the
-- capability catalogue it names.
drop policy if exists capability_presets_read on public.capability_presets;
create policy capability_presets_read on public.capability_presets
  for select to authenticated using (status = 'ACTIVE');

drop policy if exists capability_preset_capabilities_read on public.capability_preset_capabilities;
create policy capability_preset_capabilities_read on public.capability_preset_capabilities
  for select to authenticated using (true);

revoke all on public.capability_presets from anon, authenticated;
revoke all on public.capability_preset_capabilities from anon, authenticated;
grant select on public.capability_presets to authenticated;
grant select on public.capability_preset_capabilities to authenticated;

-- ---------------------------------------------------------------------
-- The three the design names.
--
-- Each one is the capabilities a person actually needs to do that job and
-- nothing beside them. A preset that quietly carried an extra key would be the
-- worst version of this feature: authority granted by a label.
-- ---------------------------------------------------------------------
insert into public.capability_presets (key, label, description, scope_type, role_key, sort_order) values
  ('volunteer_pitch_allocation', 'Volunteer — Pitch Allocation',
   'Arrange which team plays on which pitch, and when.',
   'club', 'VOLUNTEER', 1),
  ('volunteer_calendar', 'Volunteer — Calendar',
   'Keep the club calendar up to date.',
   'club', 'VOLUNTEER', 2),
  ('volunteer_team_fixtures', 'Volunteer — Team Fixtures',
   'Arrange and maintain the club''s matches, without the mass tools.',
   'club', 'VOLUNTEER', 3)
on conflict (key) do update
  set label = excluded.label, description = excluded.description,
      scope_type = excluded.scope_type, role_key = excluded.role_key, sort_order = excluded.sort_order;

insert into public.capability_preset_capabilities (preset_key, capability_key, sort_order) values
  ('volunteer_pitch_allocation', 'venue.pitch_allocation.view', 1),
  ('volunteer_pitch_allocation', 'venue.pitch_allocation.manage', 2),
  ('volunteer_calendar', 'calendar.event.view', 1),
  ('volunteer_calendar', 'calendar.event.manage', 2),
  -- DELIBERATELY NOT fixture.import.run, fixture.fixture.bulk_edit or
  -- fixture.planner.use. Those are the club's MASS fixture authority and the
  -- programme has ruled repeatedly that they are club-administrative only. A
  -- preset called "Team Fixtures" that carried them would be the quiet
  -- widening this whole design exists to make impossible.
  ('volunteer_team_fixtures', 'fixture.fixture.view', 1),
  ('volunteer_team_fixtures', 'fixture.fixture.create', 2),
  ('volunteer_team_fixtures', 'fixture.fixture.edit', 3),
  ('volunteer_team_fixtures', 'fixture.request.respond', 4)
on conflict (preset_key, capability_key) do update set sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- THE EVENT TYPE.
--
-- public.security_event_types is a CLOSED catalogue: internal.emit_security_event
-- refuses an unregistered type outright. That is deliberate and it is a good
-- rule -- an audit stream whose vocabulary anybody can extend at write time is
-- a stream nobody can query. So the preset's own event is registered here,
-- beside the thing that emits it.
--
-- It carries the same settings as override.granted, which it accompanies: a
-- MEMBERSHIP-category WARNING, visible to the club (it is the club's own
-- decision), not shown to the subject on their own account page, and requiring
-- a reason -- the preset's label is that reason when the person gives none.
-- ---------------------------------------------------------------------
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('override.preset_applied', 'MEMBERSHIP', 'WARNING', true, false, true)
on conflict (event_type) do update
  set category = excluded.category, severity = excluded.severity,
      club_visible = excluded.club_visible, subject_visible = excluded.subject_visible,
      requires_reason = excluded.requires_reason;

-- ---------------------------------------------------------------------
-- APPLYING ONE.
--
-- One transaction, one event per override, and every decision taken by the
-- function that already knows how to take it.
-- ---------------------------------------------------------------------
create or replace function public.apply_capability_preset(
  p_user_id uuid,
  p_preset_key text,
  p_club_id uuid,
  p_reason text default null
) returns TABLE(capability_key text, override_id uuid, outcome text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_preset public.capability_presets;
  v_item record;
  v_id uuid;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_not_impersonating();

  select * into v_preset from public.capability_presets where key = p_preset_key and status = 'ACTIVE';
  if v_preset.key is null then
    raise exception 'Unknown preset.' using errcode = '22023';
  end if;
  if p_club_id is null then
    raise exception 'A preset is applied at a club.' using errcode = '22023';
  end if;

  -- No authority check of its own. Every capability below goes through
  -- set_capability_override, which refuses with 42501 if this actor may not
  -- grant it -- and refusing on the FIRST one aborts the whole statement,
  -- because a plpgsql function is one transaction. A preset is therefore all
  -- or nothing: a club never ends up with half a job handed out.
  for v_item in
    select c.capability_key
    from public.capability_preset_capabilities c
    where c.preset_key = v_preset.key
    order by c.sort_order, c.capability_key
  loop
    v_id := public.set_capability_override(
      p_user_id, v_item.capability_key, v_preset.scope_type, p_club_id, null, 'grant',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), v_preset.label), null);
    capability_key := v_item.capability_key;
    override_id := v_id;
    outcome := 'granted';
    return next;
  end loop;

  -- One event for the preset itself, ON TOP of the per-override events
  -- set_capability_override has already emitted. It records the INTENT -- "she
  -- is doing the pitch allocation" -- which the individual grants cannot carry
  -- and which is the thing a reader of the audit trail is actually looking for.
  perform internal.emit_security_event('override.preset_applied', p_user_id, 'SUCCESS',
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), v_preset.label),
    jsonb_build_object('preset_key', v_preset.key, 'preset_label', v_preset.label,
                       'scope_type', v_preset.scope_type),
    p_club_id, null, null);
end;
$$;

revoke all on function public.apply_capability_preset(uuid, text, uuid, text) from public;
grant execute on function public.apply_capability_preset(uuid, text, uuid, text) to authenticated;

comment on function public.apply_capability_preset(uuid, text, uuid, text) is
  'Applies a named capability preset to one person at one club, in one transaction, calling '
  'set_capability_override once per capability so that every ceiling, prohibition and event is the '
  'same as granting them one at a time. Refusing any one capability aborts all of them.';

-- ---------------------------------------------------------------------
-- WHAT A PRESET MAY NEVER CONTAIN.
--
-- Checked at migration time so that a future preset cannot be added with a key
-- that the club could not have granted by hand. Each condition is a rule that
-- already exists elsewhere; stating it here stops a preset being the way round
-- it.
-- ---------------------------------------------------------------------
do $guard$
declare
  v_bad text;
begin
  select string_agg(distinct pc.capability_key, ', ')
    into v_bad
  from public.capability_preset_capabilities pc
  left join public.capabilities c on c.key = pc.capability_key
  join public.capability_presets p on p.key = pc.preset_key
  where c.key is null
     or c.status <> 'ACTIVE'
     or not c.delegable
     or c.safeguarding_sensitive
     -- NOT minor_prohibited. Almost every operational capability carries it --
     -- pitch allocation, calendar management and fixture editing are all
     -- adult-only -- and excluding them would leave a preset able to carry
     -- nothing. The rule is enforced where it belongs, at the moment of the
     -- grant: set_capability_override refuses with AGE_ELIGIBILITY_REQUIRED if
     -- the person has no date of birth showing they are an adult, and refuses
     -- outright for someone under 18. Because a preset is one transaction,
     -- that refusal aborts the whole preset rather than handing out half a job.
     or c.domain in ('people', 'finance')
     or c.key like 'site.%'
     or not (p.scope_type = any (c.valid_scopes));
  if v_bad is not null then
    raise exception 'A preset names capabilities it must not: %. A preset may only carry ACTIVE, delegable, non-safeguarding, non-people, non-finance capabilities valid at the preset''s own scope.', v_bad;
  end if;

  -- The mass fixture tools are club-administrative and are never in a preset.
  if exists (
    select 1 from public.capability_preset_capabilities
    where capability_key in ('fixture.import.run', 'fixture.planner.use',
                             'fixture.fixture.bulk_edit', 'competition.creator.use')) then
    raise exception 'A preset names a mass fixture tool. Those are club-administrative only.';
  end if;

  if (select count(*) from public.capability_presets where status = 'ACTIVE') < 3 then
    raise exception 'The three presets the design names are not all present.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- READING THE CATALOGUE, AND WHETHER THIS PERSON MAY USE IT.
--
-- The screen must not offer a button that will refuse. `may_apply` asks the
-- SAME question set_capability_override will ask -- internal.override_authority_level
-- for every capability in the preset -- so the offer and the outcome cannot
-- disagree. This is the UI reading the authority, never the UI deciding it.
-- ---------------------------------------------------------------------
create or replace function public.club_capability_presets(p_club_id uuid)
returns TABLE(
  preset_key text,
  label text,
  description text,
  scope_type text,
  role_key text,
  capability_keys text[],
  capability_labels text[],
  may_apply boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- The same gate the permissions screen itself is behind. Without it this
  -- would tell an outsider which jobs a club hands out.
  if not internal.can('people.capability.manage', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select p.key,
         p.label,
         p.description,
         p.scope_type,
         p.role_key,
         array_agg(pc.capability_key order by pc.sort_order),
         array_agg(c.label order by pc.sort_order),
         bool_and(internal.override_authority_level(pc.capability_key, p.scope_type, p_club_id, null) is not null)
  from public.capability_presets p
  join public.capability_preset_capabilities pc on pc.preset_key = p.key
  join public.capabilities c on c.key = pc.capability_key
  where p.status = 'ACTIVE'
  group by p.key, p.label, p.description, p.scope_type, p.role_key, p.sort_order
  order by p.sort_order;
end;
$$;

revoke all on function public.club_capability_presets(uuid) from public;
grant execute on function public.club_capability_presets(uuid) to authenticated;

comment on function public.club_capability_presets(uuid) is
  'The preset catalogue as one club sees it, including whether the person asking may apply each one. '
  'may_apply asks internal.override_authority_level for every capability in the preset, which is the '
  'same question apply_capability_preset will ask, so the screen cannot offer a button that refuses.';
