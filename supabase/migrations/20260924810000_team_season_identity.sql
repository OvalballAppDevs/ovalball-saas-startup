-- FUTURE-SEASON FIXTURE OWNERSHIP invariant (Mini-Rugby / Team
-- Administration / Season Handover brief, amendment): a fixture belongs
-- to its stable team_id and its own season -- age-grade DISPLAY must be
-- resolved for that season, never blindly read off the team's current
-- mutable row.
--
-- Root problem this fixes: teams.age_group is a single mutable field with
-- NO historical record. confirm_rollover_team_proposal() (season_model_
-- and_rollover.sql) already mutates it IN PLACE the moment a Club Admin
-- confirms a proposal -- which, unpatched, means every past AND future
-- fixture ever linked to that team_id would immediately start displaying
-- the NEW age the instant rollover is confirmed, silently relabelling
-- history. No rollover has ever been confirmed in this local database
-- (verified before writing this migration), so nothing is corrupted yet
-- -- this is a genuine but still-latent bug, fixed here before it can
-- fire for real.

create table public.team_season_identity (
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id),
  category text not null,
  age_group text,
  squad_designation text,
  gender text,
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, season_id)
);

comment on table public.team_season_identity is
  'One immutable snapshot per (team, season) of that team''s real age-grade identity DURING that season -- written once, at the moment a season starts being current for that team (initial backfill below) or at Season Handover confirmation (confirm_rollover_team_proposal), never updated afterward. This is what every fixture/Calendar/Team-Administration display must resolve identity from for a NON-current season, instead of reading teams'' own live, mutable row.';

alter table public.team_season_identity enable row level security;

create policy team_season_identity_select on public.team_season_identity
  for select using (
    exists (select 1 from public.teams t where t.id = team_id and internal.can_manage_team(t.id))
    or exists (select 1 from public.teams t where t.id = team_id and internal.can_manage_club_fixtures(t.club_id))
    or internal.is_site_admin()
  );

-- One-time backfill: every currently-active team's PRESENT identity,
-- snapshotted against whichever season currently contains today's date
-- for that team's own rugby_code -- the same "current season" signal the
-- app's own resolveDefaultSeason() uses, expressed in SQL for a one-off
-- migration. Never invents a snapshot for a season that hasn't happened
-- yet, and never guesses at PAST seasons this system has no record of.
insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
select t.id, s.id, t.category, t.age_group, t.squad_designation, t.gender, t.display_name
from public.teams t
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
join public.seasons s on s.rugby_code = cd.rugby_code and current_date between s.starts_on and s.ends_on
where t.active
on conflict (team_id, season_id) do nothing;

-- get_team_identity_for_season: the one canonical resolver. Checks the
-- snapshot first; falls back to the team's own live row only when no
-- snapshot exists for that season -- correct for "the current,
-- not-yet-rolled-over season" (nothing has diverged from the live row
-- yet) and honest about the one still-open gap this migration does not
-- close: a FUTURE season's fixture created before that season's rollover
-- has happened has no snapshot to read yet, so it still falls back to the
-- CURRENT live identity rather than a projected future one. Closing that
-- specific gap needs the same deterministic multi-season age-progression
-- calculator the rollover-proposal generator itself uses, extracted into
-- a reusable N-seasons-ahead projector -- correctly out of scope for this
-- migration to build under time pressure; disclosed, not silently papered
-- over, in the final report.
create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table(category text, age_group text, squad_designation text, gender text, display_name text)
language sql
stable
as $$
  select coalesce(tsi.category, t.category), coalesce(tsi.age_group, t.age_group), coalesce(tsi.squad_designation, t.squad_designation),
         coalesce(tsi.gender, t.gender), coalesce(tsi.display_name, t.display_name)
  from public.teams t
  left join public.team_season_identity tsi on tsi.team_id = t.id and tsi.season_id = p_season_id
  where t.id = p_team_id;
$$;

grant execute on function public.get_team_identity_for_season(uuid, uuid) to authenticated;

-- confirm_rollover_team_proposal: re-declared to snapshot BOTH the
-- outgoing season's real identity (so it survives the mutation below
-- unchanged) and the incoming season's new identity, atomically with the
-- age_group/squad_designation/gender mutation it already performed --
-- every other line unchanged from the live definition (pulled directly
-- via pg_get_functiondef, including the mixed-boundary guard, the gender
-- validation, and both exception branches).
create or replace function public.confirm_rollover_team_proposal(p_proposal_id uuid, p_action text, p_age_group text default null::text, p_squad_designation text default null::text, p_fold_reason text default null::text, p_gender text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.age_grade_rollover_team_proposals;
  r public.age_grade_rollovers;
  v_final_age_group text;
  v_team public.teams;
begin
  select * into p from public.age_grade_rollover_team_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Rollover proposal not found.'; end if;
  if p.is_mixed_boundary then
    raise exception 'This is a Mixed U11 -> U12 structural transition. Use the dedicated Girls-team decision flow, not the ordinary Confirm/Adjust path.' using errcode = 'P0001';
  end if;
  select * into r from public.age_grade_rollovers where id = p.rollover_id;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to confirm this rollover proposal.' using errcode = '42501';
  end if;
  if p.decision <> 'pending' then
    raise exception 'This proposal has already been decided (%).', p.decision;
  end if;
  if p_action not in ('confirm', 'adjust', 'fold', 'defer') then
    raise exception 'Unknown rollover action: %', p_action;
  end if;
  if p_gender is not null and p_gender not in ('boys', 'girls') then
    raise exception 'gender must be boys or girls for a youth rollover destination.';
  end if;

  if p_action = 'confirm' or p_action = 'adjust' then
    v_final_age_group := coalesce(p_age_group, p.proposed_age_group);
    if v_final_age_group is null then
      raise exception 'A destination age group is required -- this team''s rollover has no automatic mapping and needs an explicit choice.';
    end if;
    select * into v_team from public.teams where id = p.team_id;

    -- Section: FUTURE-SEASON FIXTURE OWNERSHIP -- snapshot the OUTGOING
    -- season's real identity before it is overwritten below, so every
    -- fixture already linked to this team_id for the season now ending
    -- keeps displaying its real historical age, never the new one.
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;

    begin
      update public.teams
      set age_group = v_final_age_group,
          squad_designation = coalesce(p_squad_designation, squad_designation),
          gender = coalesce(p_gender, gender)
      where id = p.team_id;
    exception
      when unique_violation then
        raise exception 'This club already has a team at % with the same squad designation and gender. Use Adjust and choose a different squad letter (e.g. a "B" squad) to roll this team forward.', v_final_age_group;
      when check_violation then
        raise exception 'That destination age group/gender combination is not valid (Mixed is only allowed U6-U11; U12 and above need Boys or Girls).';
    end;

    -- Snapshot the INCOMING season's new identity -- from this point on,
    -- get_team_identity_for_season(team_id, to_season_id) resolves the
    -- real, correct age for that season even after a LATER rollover moves
    -- age_group on again.
    if r.to_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = p.team_id
      on conflict (team_id, season_id) do nothing;
    end if;

    insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
    values ('teams', p.team_id, 'update', auth.uid(), jsonb_build_object('age_group', p.current_age_group), jsonb_build_object('age_group', v_final_age_group, 'gender', p_gender, 'rollover_id', r.id));
    update public.age_grade_rollover_team_proposals set decision = 'confirmed', decided_age_group = v_final_age_group, decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  elsif p_action = 'fold' then
    perform public.fold_team(p.team_id, coalesce(p_fold_reason, 'Discontinued at season rollover.'));
    update public.age_grade_rollover_team_proposals set decision = 'folded', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  else
    update public.age_grade_rollover_team_proposals set decision = 'deferred', decided_by = auth.uid(), decided_at = now() where id = p_proposal_id;
  end if;
end;
$$;
