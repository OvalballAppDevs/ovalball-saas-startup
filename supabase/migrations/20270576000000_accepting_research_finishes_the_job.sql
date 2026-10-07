-- FIX: accept_directory_research_proposal() never learned about the three fields the previous
-- migration (20270575000000) added to the proposal field allowlist -- bio, primary_colour,
-- secondary_colour. A proposal for one of those fields could reach 'accepted' status via the
-- existing RPC (the field passes the CHECK constraint, the RPC's own authorization and status
-- checks all pass) while its CASE statement silently left club_directory untouched, because none
-- of those three columns appeared in it. That is a real, load-bearing gap: "accepted" must mean
-- the value actually landed on the canonical row, never a status flip with no effect. Found while
-- preparing to run acceptance on the North of England + Midlands research batch.
--
-- CORRECTION WHILE WRITING THIS: the first version of this migration copied its CASE statement
-- from 20260901170000's own source text and reintroduced `internal.is_site_admin()`, which
-- 20270419000000 (Slice 7, PG-16) had already rewritten in the live function body to
-- `internal.has_site_capability('site.directory.manage')` -- the capability this whole
-- subsystem is gated on everywhere else (`internal.can_run_directory_verification()` is
-- literally `select internal.has_site_capability('site.directory.manage')`), and 20270506000000
-- (Slice 7e) later dropped `is_site_admin()` entirely. Editing the file in place before it had
-- ever been committed, rather than banking a second fix migration on top of a mistake made
-- moments earlier in the same session. The capability check below is that current, correct
-- authority, not the one this function was originally written with.

create or replace function public.accept_directory_research_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.club_directory_research_proposals;
begin
  if not internal.has_site_capability('site.directory.manage') then
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
    bio = case when v_prop.field = 'bio' then v_prop.proposed_value else bio end,
    primary_colour = case when v_prop.field = 'primary_colour' then v_prop.proposed_value else primary_colour end,
    secondary_colour = case when v_prop.field = 'secondary_colour' then v_prop.proposed_value else secondary_colour end,
    updated_by = auth.uid()
  where id = v_prop.directory_id;

  update public.club_directory_research_proposals
  set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_proposal_id;
end;
$$;

comment on function public.accept_directory_research_proposal(uuid) is
  'Applies ONE proposal''s proposed_value to the real club_directory column via a fixed allowlisted CASE (never dynamic SQL against an arbitrary column name), then marks the proposal accepted. Covers every field in the proposals table''s own field CHECK constraint, including bio/primary_colour/secondary_colour added by 20270575000000 -- keep this CASE and that constraint in sync.';
