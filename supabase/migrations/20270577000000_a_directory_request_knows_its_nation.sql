-- FIX: approve_directory_request's INSERT into club_directory was missing FOUR columns the
-- table requires with no default -- nation, source, verification_status, normalized_key --
-- so every call has always failed with a not-null violation. This pipeline (a user submits
-- "please add this club", a Site Admin approves it) appears to have never actually succeeded
-- once. Found while bulk-registering real Lancashire RFU clubs confirmed missing from the
-- canonical directory.
--
-- - `nation` is added to directory_requests (same CHECK shape as club_directory.nation) and
--   required before approval, surfaced as a real error rather than silently defaulted --
--   country alone can't distinguish England/Scotland/Wales/Northern Ireland.
-- - `source` is added to directory_requests too, nullable: a curated bulk-import (like this
--   Lancashire RFU batch) can set the real provenance value (matching the convention already
--   used elsewhere, e.g. 'lancashire_rfu'); an ordinary end-user submission has no way to know
--   a source string, so the function falls back to 'directory_request_approved' when null.
-- - `verification_status` is set to a fixed 'directory_request_approved' -- a human (the
--   approving Site Admin) already looked at this, but it did not come from the researched-and-
--   sourced verification pipeline, so it gets its own honest label rather than borrowing one
--   of that pipeline's.
-- - `normalized_key` is computed inline (lowercase, strip the same rugby/football/club/RFC/
--   RUFC-shaped words the rest of the dataset's keys already treat as noise) -- there is no
--   uniqueness constraint on it, only the admin dashboard's own duplicate-flag read, so an
--   imperfect match is a visibility question for a human, never a blocked insert.

alter table public.directory_requests
  add column if not exists nation text,
  add column if not exists source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'directory_requests_nation_check') then
    alter table public.directory_requests
      add constraint directory_requests_nation_check
      check (nation is null or nation = any (array['England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland']));
  end if;
end $$;

comment on column public.directory_requests.nation is
  'Required before approval -- club_directory.nation is NOT NULL, so a request with no nation set is rejected by approve_directory_request rather than silently defaulted.';
comment on column public.directory_requests.source is
  'Optional real provenance for a curated bulk import (e.g. ''lancashire_rfu''); an ordinary end-user submission leaves this null and approve_directory_request falls back to ''directory_request_approved''.';

create or replace function public.approve_directory_request(p_request_id uuid, p_rugby_code text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.directory_requests;
  v_directory_id uuid;
begin
  if not internal.has_site_capability('site.directory.manage') then
    raise exception 'Only a Site Admin may approve a directory request.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;

  select * into v_request from public.directory_requests where id = p_request_id for update;
  if not found then raise exception 'Directory request not found.'; end if;
  if v_request.status <> 'pending' then
    raise exception 'Directory request is not pending (current status: %).', v_request.status;
  end if;
  if v_request.nation is null then
    raise exception 'Directory request has no nation set -- club_directory.nation is required.';
  end if;

  insert into public.club_directory (
    name, rugby_code, town, county, country, nation, postcode, source, verification_status, normalized_key, active, created_by, updated_by
  )
  values (
    v_request.club_name, p_rugby_code, v_request.town, v_request.county, v_request.country, v_request.nation,
    v_request.postcode, coalesce(v_request.source, 'directory_request_approved'), 'directory_request_approved',
    trim(regexp_replace(regexp_replace(lower(v_request.club_name), '[.''()]', '', 'g'), '\m(rufc|rfc|r\.u\.f\.c|rugby|football|union|club)\M', '', 'g')),
    true, auth.uid(), auth.uid()
  )
  returning id into v_directory_id;

  update public.directory_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = p_notes, created_directory_id = v_directory_id
  where id = p_request_id;

  if v_request.submitted_by is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_request.submitted_by,
      'club_claim_approved',
      'Your club is now on Ovalball',
      format('%s has been added to the Ovalball directory. You can now claim it.', v_request.club_name),
      jsonb_build_object('directory_id', v_directory_id, 'directory_request_id', p_request_id)
    );
  end if;

  return v_directory_id;
end;
$$;
