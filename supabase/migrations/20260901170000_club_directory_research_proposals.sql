-- Support a legitimate Republic of Ireland nation value going forward --
-- none exist in the current dataset (all 1,390 rows are United Kingdom
-- today), but the canonical schema should be ABLE to represent one
-- correctly rather than forcing a future Irish club into an England/
-- Scotland/Wales/Northern Ireland box, or worse, silently mapping Northern
-- Ireland into it. No existing row is touched by this -- it only widens
-- what the CHECK constraint allows.
alter table public.club_directory drop constraint club_directory_nation_check;
alter table public.club_directory add constraint club_directory_nation_check
  check (nation = any (array['England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland']));

-- Staging/proposal layer for directory research. Nothing here ever
-- overwrites club_directory directly -- a proposal is evidence to review,
-- not a write. accept_directory_research_proposal() is the only path from
-- a proposal to an actual club_directory update, and it deliberately
-- excludes rugby_code (that has its own privileged workflow, see
-- 20260901160000) and excludes any field not on the safe allowlist below.
create table public.club_directory_research_proposals (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid not null references public.club_directory(id) on delete cascade,
  field text not null check (field = any (array[
    'name', 'country', 'nation', 'region', 'county', 'town', 'home_ground', 'address',
    'postcode', 'website', 'official_email', 'constituent_body', 'notes'
  ])),
  current_value text,
  proposed_value text not null,
  source text not null,
  source_url text,
  confidence text not null check (confidence = any (array['high', 'medium', 'low'])),
  status text not null default 'pending' check (status = any (array['pending', 'accepted', 'rejected', 'conflicting'])),
  conflict_reason text,
  researched_by uuid not null references auth.users(id),
  researched_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index club_directory_research_proposals_directory_idx on public.club_directory_research_proposals (directory_id);
create index club_directory_research_proposals_status_idx on public.club_directory_research_proposals (status);

alter table public.club_directory_research_proposals enable row level security;

create policy club_directory_research_proposals_select on public.club_directory_research_proposals
  for select using (internal.is_site_admin());
create policy club_directory_research_proposals_insert on public.club_directory_research_proposals
  for insert with check (internal.is_site_admin());
create policy club_directory_research_proposals_update on public.club_directory_research_proposals
  for update using (internal.is_site_admin());

comment on table public.club_directory_research_proposals is 'Staging layer for club directory research -- current value, proposed value, source/evidence, and confidence, reviewed by a human before anything touches the canonical club_directory row. Never field=rugby_code -- that has its own privileged correction workflow.';

-- Accept applies ONE proposal's proposed_value to the real column, using a
-- fixed allowlisted CASE (not dynamic SQL against an arbitrary column
-- name) so `field` can never resolve to something outside the CHECK
-- constraint's own list even if that constraint were ever bypassed.
create or replace function public.accept_directory_research_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.club_directory_research_proposals;
begin
  if not internal.is_site_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_prop from public.club_directory_research_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found.';
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'Proposal is not pending (current status: %).', v_prop.status;
  end if;

  update public.club_directory set
    name = case when v_prop.field = 'name' then v_prop.proposed_value else name end,
    country = case when v_prop.field = 'country' then v_prop.proposed_value else country end,
    nation = case when v_prop.field = 'nation' then v_prop.proposed_value else nation end,
    region = case when v_prop.field = 'region' then v_prop.proposed_value else region end,
    county = case when v_prop.field = 'county' then v_prop.proposed_value else county end,
    town = case when v_prop.field = 'town' then v_prop.proposed_value else town end,
    home_ground = case when v_prop.field = 'home_ground' then v_prop.proposed_value else home_ground end,
    address = case when v_prop.field = 'address' then v_prop.proposed_value else address end,
    postcode = case when v_prop.field = 'postcode' then v_prop.proposed_value else postcode end,
    website = case when v_prop.field = 'website' then v_prop.proposed_value else website end,
    official_email = case when v_prop.field = 'official_email' then v_prop.proposed_value else official_email end,
    constituent_body = case when v_prop.field = 'constituent_body' then v_prop.proposed_value else constituent_body end,
    notes = case when v_prop.field = 'notes' then v_prop.proposed_value else notes end,
    updated_by = auth.uid()
  where id = v_prop.directory_id;

  update public.club_directory_research_proposals
  set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_proposal_id;
end;
$$;

create or replace function public.reject_directory_research_proposal(p_proposal_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update public.club_directory_research_proposals
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      conflict_reason = coalesce(p_reason, conflict_reason)
  where id = p_proposal_id and status = 'pending';
  if not found then
    raise exception 'Proposal not found or not pending.';
  end if;
end;
$$;
