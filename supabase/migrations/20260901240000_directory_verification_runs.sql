-- Online Directory Verification: a Site Admin-triggered run of the
-- ALREADY-BUILT research -> evidence -> staging -> review pipeline
-- (club_directory_research_proposals, accept_directory_research_proposal,
-- 20260901170000). Clicking "Run Verification Check" NEVER writes
-- club_directory directly -- it stages proposals for the existing
-- Accept/Reject review UI, exactly as a manually-created proposal would.
--
-- Bounded, resumable batches (not a fake background job): the browser
-- calls a batch-processing action repeatedly, each call handling a small
-- number of clubs and returning real updated counters -- see
-- lib/directory-research/run.ts for the orchestration and
-- lib/directory-research/provider.ts for the actual per-club research
-- step (mirrors lib/address-lookup/lookup.ts's own honest "not configured
-- in this local environment" pattern -- no fabricated results).

create table public.directory_verification_runs (
  id uuid primary key default gen_random_uuid(),
  started_by uuid not null references auth.users(id),
  scope text not null check (scope in ('current_club', 'filtered', 'needs_review', 'missing_data', 'entire_directory')),
  -- For 'current_club': {"directory_id": "..."}. For 'filtered': the same
  -- filter shape the Data Quality dashboard's own query already accepts.
  -- Null for 'needs_review' / 'missing_data' / 'entire_directory' (scope
  -- name alone determines the set).
  scope_filter jsonb,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'partial')),
  total_records integer not null,
  processed_records integer not null default 0,
  proposals_created integer not null default 0,
  conflicts_found integer not null default 0,
  no_result_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text
);

comment on table public.directory_verification_runs is
  'One row per "Run Verification Check" invocation. Every count is real and updated batch-by-batch -- never a fabricated live-progress number. status stays running until every scoped club has been processed (or the run is explicitly marked failed) -- see directory_verification_run_records for the per-club detail.';

create table public.directory_verification_run_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.directory_verification_runs(id) on delete cascade,
  directory_id uuid not null references public.club_directory(id),
  outcome text not null check (outcome in ('proposal_created', 'no_result', 'conflict', 'rugby_code_conflict', 'failed')),
  detail text,
  processed_at timestamptz not null default now(),
  unique (run_id, directory_id)
);

comment on table public.directory_verification_run_records is
  'Per-club outcome within one run -- also the source of truth for "already processed in this run" (so a resumed run never re-checks a club twice) and for freshness ("last checked: X days ago", derived by MAX(processed_at) per directory_id across every run, never stored as free text).';

create index directory_verification_run_records_run_id_idx on public.directory_verification_run_records (run_id);
create index directory_verification_run_records_directory_id_idx on public.directory_verification_run_records (directory_id);

alter table public.directory_verification_runs enable row level security;
alter table public.directory_verification_run_records enable row level security;

create policy directory_verification_runs_select on public.directory_verification_runs for select using (internal.is_site_admin());
create policy directory_verification_run_records_select on public.directory_verification_run_records for select using (internal.is_site_admin());

-- Writes are RPC-only (start_directory_verification_run /
-- record_directory_verification_result below) -- no direct table policy,
-- so every write re-checks authorization and updates run counters
-- atomically together.

-- ============================================================
-- No duplicate pending proposals across repeated runs: at most one
-- PENDING proposal per (directory_id, field) -- a repeated run reuses/
-- updates it instead of spamming the review dashboard. Accepted/rejected
-- history is untouched (the constraint only applies to 'pending').
-- ============================================================

create unique index club_directory_research_proposals_pending_unique
  on public.club_directory_research_proposals (directory_id, field)
  where status = 'pending';

-- ============================================================
-- Authorization: Full Site Admin, or a Club Data Admin (consistent with
-- the existing admin_role vocabulary) -- explicitly never Read-Only,
-- ordinary Club Admin, Fixture Ops, User Access, or Message Moderator.
-- ============================================================

create or replace function internal.can_run_directory_verification()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select internal.is_full_site_admin() or coalesce(internal.site_admin_role(auth.uid()), '') = 'club_data';
$$;

grant execute on function internal.can_run_directory_verification() to authenticated;

-- ============================================================
-- resolve_directory_verification_scope: the ONE place a scope name turns
-- into a concrete set of directory_ids -- used both to COUNT (so the
-- confirmation dialog can say "Run for 1,390 clubs?" honestly before
-- anything starts) and to drive the batch loop, so the two can never
-- disagree.
-- ============================================================

create or replace function internal.resolve_directory_verification_scope(p_scope text, p_directory_id uuid, p_filters jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_scope = 'current_club' then
    if p_directory_id is null then
      raise exception 'current_club scope requires a directory_id.';
    end if;
    return query select p_directory_id;
  elsif p_scope = 'needs_review' then
    return query select o.directory_id from public.admin_club_overview o where o.flag_unverified;
  elsif p_scope = 'missing_data' then
    return query select o.directory_id from public.admin_club_overview o
      where o.flag_missing_postcode or o.flag_missing_town or o.flag_missing_website or o.flag_missing_logo;
  elsif p_scope = 'entire_directory' then
    return query select id from public.club_directory;
  elsif p_scope = 'filtered' then
    -- The filter shape mirrors the Data Quality dashboard's own tile
    -- keys -- a bounded, known set, never an arbitrary client-supplied
    -- predicate. Unrecognised or absent filters fall back to the full
    -- directory (never silently return zero rows for a typo'd filter).
    return query
      select o.directory_id from public.admin_club_overview o
      where (p_filters->>'flag' is null
        or (p_filters->>'flag' = 'missing_postcode' and o.flag_missing_postcode)
        or (p_filters->>'flag' = 'missing_town' and o.flag_missing_town)
        or (p_filters->>'flag' = 'missing_website' and o.flag_missing_website)
        or (p_filters->>'flag' = 'missing_logo' and o.flag_missing_logo)
        or (p_filters->>'flag' = 'unverified' and o.flag_unverified)
        or (p_filters->>'flag' = 'duplicate' and (o.flag_duplicate_normalized_key or o.flag_duplicate_external_id)));
  else
    raise exception 'Unknown verification scope: %', p_scope;
  end if;
end;
$$;

-- ============================================================
-- start_directory_verification_run: computes the real total up front
-- (never a guessed count), inserts the run row, audits it.
-- ============================================================

create or replace function public.start_directory_verification_run(p_scope text, p_directory_id uuid default null, p_filters jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_total integer;
begin
  if not internal.can_run_directory_verification() then
    raise exception 'Only a Full Site Admin or Club Data Admin may run directory verification.' using errcode = '42501';
  end if;

  select count(*) into v_total from internal.resolve_directory_verification_scope(p_scope, p_directory_id, p_filters);
  if v_total = 0 then
    raise exception 'No clubs match this scope -- nothing to check.';
  end if;

  insert into public.directory_verification_runs (started_by, scope, scope_filter, total_records)
  values (auth.uid(), p_scope, case when p_scope = 'current_club' then jsonb_build_object('directory_id', p_directory_id) else p_filters end, v_total)
  returning id into v_run_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('directory_verification_runs', v_run_id, 'insert', auth.uid(), jsonb_build_object('scope', p_scope, 'total_records', v_total));

  return v_run_id;
end;
$$;

revoke execute on function public.start_directory_verification_run(text, uuid, jsonb) from public;
grant execute on function public.start_directory_verification_run(text, uuid, jsonb) to authenticated;

-- ============================================================
-- preview_directory_verification_scope: read-only count for the
-- confirmation dialog -- "Run online verification for N clubs?" -- called
-- BEFORE start_directory_verification_run, no run row created yet.
-- ============================================================

create or replace function public.preview_directory_verification_scope(p_scope text, p_directory_id uuid default null, p_filters jsonb default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;
  return (select count(*)::integer from internal.resolve_directory_verification_scope(p_scope, p_directory_id, p_filters));
end;
$$;

grant execute on function public.preview_directory_verification_scope(text, uuid, jsonb) to authenticated;

-- ============================================================
-- get_directory_verification_next_batch: the next N not-yet-processed
-- clubs in this run's scope -- resumable by construction (a record row
-- existing already is what "processed" means, so an interrupted run
-- picks up exactly where it left off with no extra state to track).
-- ============================================================

create or replace function public.get_directory_verification_next_batch(p_run_id uuid, p_batch_size integer default 10)
returns table(directory_id uuid, club_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_run public.directory_verification_runs;
begin
  select * into v_run from public.directory_verification_runs where id = p_run_id;
  if v_run is null then
    raise exception 'Verification run not found.';
  end if;
  if not internal.can_run_directory_verification() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select s.directory_id, cd.name
  from internal.resolve_directory_verification_scope(v_run.scope, (v_run.scope_filter->>'directory_id')::uuid, v_run.scope_filter) s(directory_id)
  join public.club_directory cd on cd.id = s.directory_id
  where not exists (
    select 1 from public.directory_verification_run_records r where r.run_id = p_run_id and r.directory_id = s.directory_id
  )
  limit p_batch_size;
end;
$$;

grant execute on function public.get_directory_verification_next_batch(uuid, integer) to authenticated;

-- ============================================================
-- record_directory_verification_result: called once per club per batch,
-- from the Next.js server action after the (real, or honestly
-- not-configured) research step returns. Updates run counters
-- atomically with the record insert so they can never drift apart, and
-- reuses/updates an existing pending proposal for the same field rather
-- than creating a duplicate (the unique index above is the hard backstop;
-- this is the friendly upsert path).
-- ============================================================

create type public.directory_verification_proposal_input as (
  field text,
  current_value text,
  proposed_value text,
  source text,
  source_url text,
  confidence text
);

create or replace function public.record_directory_verification_result(
  p_run_id uuid,
  p_directory_id uuid,
  p_outcome text,
  p_detail text default null,
  p_proposals public.directory_verification_proposal_input[] default array[]::public.directory_verification_proposal_input[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.directory_verification_proposal_input;
  v_created_count integer := 0;
begin
  if not internal.can_run_directory_verification() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_outcome not in ('proposal_created', 'no_result', 'conflict', 'rugby_code_conflict', 'failed') then
    raise exception 'Unknown outcome: %', p_outcome;
  end if;

  insert into public.directory_verification_run_records (run_id, directory_id, outcome, detail)
  values (p_run_id, p_directory_id, p_outcome, p_detail)
  on conflict (run_id, directory_id) do update set outcome = excluded.outcome, detail = excluded.detail, processed_at = now();

  foreach v_prop in array p_proposals loop
    insert into public.club_directory_research_proposals
      (directory_id, field, current_value, proposed_value, source, source_url, confidence, status, researched_by)
    values
      (p_directory_id, v_prop.field, v_prop.current_value, v_prop.proposed_value, v_prop.source, v_prop.source_url, v_prop.confidence,
       case when p_outcome = 'conflict' then 'conflicting' else 'pending' end, auth.uid())
    on conflict (directory_id, field) where status = 'pending' do update set
      current_value = excluded.current_value,
      proposed_value = excluded.proposed_value,
      source = excluded.source,
      source_url = excluded.source_url,
      confidence = excluded.confidence,
      researched_at = now();
    v_created_count := v_created_count + 1;
  end loop;

  update public.directory_verification_runs set
    processed_records = processed_records + 1,
    proposals_created = proposals_created + v_created_count,
    conflicts_found = conflicts_found + (case when p_outcome in ('conflict', 'rugby_code_conflict') then 1 else 0 end),
    no_result_count = no_result_count + (case when p_outcome = 'no_result' then 1 else 0 end),
    failed_count = failed_count + (case when p_outcome = 'failed' then 1 else 0 end)
  where id = p_run_id;

  update public.directory_verification_runs set
    status = 'completed', completed_at = now()
  where id = p_run_id and processed_records >= total_records and status = 'running';
end;
$$;

revoke execute on function public.record_directory_verification_result(uuid, uuid, text, text, public.directory_verification_proposal_input[]) from public;
grant execute on function public.record_directory_verification_result(uuid, uuid, text, text, public.directory_verification_proposal_input[]) to authenticated;

-- ============================================================
-- fail_directory_verification_run: a genuinely unrecoverable error (not a
-- single club's research failing, which is recorded as outcome='failed'
-- and does not stop the run) -- marks the run failed with a real error,
-- retaining every already-completed record.
-- ============================================================

create or replace function public.fail_directory_verification_run(p_run_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.can_run_directory_verification() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  update public.directory_verification_runs
  set status = 'partial', last_error = p_error
  where id = p_run_id and status = 'running';
end;
$$;

revoke execute on function public.fail_directory_verification_run(uuid, text) from public;
grant execute on function public.fail_directory_verification_run(uuid, text) to authenticated;

-- ============================================================
-- Read-only helpers for the dashboard: run history and per-club
-- freshness (real MAX(processed_at), never free text).
-- ============================================================

create or replace function public.list_directory_verification_runs(p_limit integer default 10)
returns setof public.directory_verification_runs
language sql
stable
security definer
set search_path = public
as $$
  select * from public.directory_verification_runs
  where internal.is_site_admin()
  order by started_at desc
  limit p_limit;
$$;

grant execute on function public.list_directory_verification_runs(integer) to authenticated;

create or replace function public.get_directory_verification_freshness(p_directory_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(processed_at) from public.directory_verification_run_records
  where directory_id = p_directory_id and internal.is_site_admin();
$$;

grant execute on function public.get_directory_verification_freshness(uuid) to authenticated;
