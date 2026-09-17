-- =====================================================================================================
-- SLICE 5 (12/n) -- the club claim state machine (Phase 2 P, Y.13)
--
-- Two things are wrong with the claim path today, and both are authority defects rather than
-- cosmetic ones:
--
--   1. public.approve_club_claim gates on internal.is_site_admin(), so EVERY site-admin profile can
--      approve a claim. Section P says approving needs site.claims.review AND site.club_roles.manage,
--      deliberately: a club-data admin may triage, and only a Full Site Admin may grant a role.
--
--   2. It grants CLUB_ADMIN unconditionally. The claimant picked a title from a list, and the title
--      is L9 -- it grants nothing. Today a person who claims a club as "Committee Member" becomes its
--      Club Admin because approval has exactly one outcome. Section P makes the roles the reviewer's
--      choice, with a SUGGESTION derived from the title.
--
-- Compatibility. `status` is read by the application (`.eq("status","pending")`), and `claimed_role`
-- is selected by the claims screen, so neither is renamed or dropped. `state` is added as the
-- canonical column and the two are kept consistent in both directions by a trigger, so old readers
-- keep working while new code uses the state machine. D-S5-AUTO-7 records why `claimed_title` from
-- Y.13 is not introduced as a second column: `claimed_role` already holds exactly that -- a curated
-- title that grants nothing -- and renaming it would break consumers for no security gain.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. The columns Y.13 names.
-- ---------------------------------------------------------------------------------------------------
alter table public.club_claims
  add column if not exists state text,
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists has_existing_admin boolean not null default false,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists resulting_membership_id uuid references public.club_memberships(id),
  add column if not exists superseded_by_claim_id uuid references public.club_claims(id);

-- The legacy status vocabulary gains the two states it never had, so the mapping stays one to one
-- rather than collapsing WITHDRAWN and SUPERSEDED onto "rejected" and losing why a claim ended.
alter table public.club_claims drop constraint if exists club_claims_status_check;
alter table public.club_claims add constraint club_claims_status_check
  check (status in ('pending','verified','rejected','withdrawn','superseded'));

update public.club_claims set state = case status
  when 'pending' then 'SUBMITTED' when 'verified' then 'APPROVED' when 'rejected' then 'REJECTED'
  when 'withdrawn' then 'WITHDRAWN' when 'superseded' then 'SUPERSEDED' end
 where state is null;

alter table public.club_claims
  alter column state set default 'SUBMITTED',
  alter column state set not null;
alter table public.club_claims drop constraint if exists club_claims_state_check;
alter table public.club_claims add constraint club_claims_state_check
  check (state in ('SUBMITTED','NEEDS_INFORMATION','APPROVED','REJECTED','WITHDRAWN','SUPERSEDED'));

-- Both directions, so a legacy insert that names only `status` still lands in a valid state and a new
-- write that names only `state` still satisfies a reader filtering on `status`.
create or replace function internal.club_claim_sync_state_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state is null then
      new.state := case new.status when 'pending' then 'SUBMITTED' when 'verified' then 'APPROVED'
                                   when 'rejected' then 'REJECTED' when 'withdrawn' then 'WITHDRAWN'
                                   when 'superseded' then 'SUPERSEDED' else 'SUBMITTED' end;
    end if;
  elsif new.state is distinct from old.state then
    null;  -- state is canonical; status follows it below
  elsif new.status is distinct from old.status then
    new.state := case new.status when 'pending' then 'SUBMITTED' when 'verified' then 'APPROVED'
                                 when 'rejected' then 'REJECTED' when 'withdrawn' then 'WITHDRAWN'
                                 when 'superseded' then 'SUPERSEDED' else new.state end;
  end if;
  new.status := case new.state
    when 'SUBMITTED' then 'pending' when 'NEEDS_INFORMATION' then 'pending'
    when 'APPROVED' then 'verified' when 'REJECTED' then 'rejected'
    when 'WITHDRAWN' then 'withdrawn' when 'SUPERSEDED' then 'superseded' end;
  return new;
end $$;

drop trigger if exists club_claim_sync_state_status on public.club_claims;
create trigger club_claim_sync_state_status before insert or update on public.club_claims
  for each row execute function internal.club_claim_sync_state_status();

-- One live claim per person per club, and a fast competing-claims view for the reviewer.
create unique index if not exists club_claims_one_live_per_claimant_idx
  on public.club_claims (directory_id, claimant_user_id)
  where state in ('SUBMITTED','NEEDS_INFORMATION');
create index if not exists club_claims_directory_state_idx on public.club_claims (directory_id, state);

-- ---------------------------------------------------------------------------------------------------
-- 2. club_claim_messages -- the in-app conversation for NEEDS_INFORMATION.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.club_claim_messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.club_claims(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('CLAIMANT','SITE_ADMIN')),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists club_claim_messages_claim_idx on public.club_claim_messages (claim_id, created_at);

alter table public.club_claim_messages enable row level security;
drop policy if exists club_claim_messages_select on public.club_claim_messages;
create policy club_claim_messages_select on public.club_claim_messages
  for select to authenticated using (
    (select internal.has_site_capability('site.claims.review'))
    or exists (select 1 from public.club_claims c where c.id = claim_id and c.claimant_user_id = (select auth.uid()))
  );
revoke all on public.club_claim_messages from authenticated, anon;
grant select on public.club_claim_messages to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. The title SUGGESTION. A suggestion, not a grant -- section P, and L9: the title grants nothing.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.claim_suggested_roles(p_title text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_title in ('Club Chair / Chairman / Chairperson','Club Secretary','Club Administrator')
      then array['CLUB_ADMIN']::text[]
    when p_title = 'Fixture Secretary' then array['FIXTURES_SECRETARY']::text[]
    else array[]::text[]   -- everything else suggests membership alone
  end;
$$;

comment on function internal.claim_suggested_roles(text) is
  'Phase 2 P. What a claimed title SUGGESTS to the reviewing Site Admin. It is a default offered in '
  'the review screen, never an entitlement: the title is L9 and grants nothing by itself.';

-- ---------------------------------------------------------------------------------------------------
-- 4. submit_club_claim
-- ---------------------------------------------------------------------------------------------------
create or replace function public.submit_club_claim(
  p_directory_id uuid,
  p_claimed_role text,
  p_authority_declaration text,
  p_evidence jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid(); v_id uuid; v_today int; v_has_admin boolean;
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if not internal.session_ok() then raise exception 'Your session cannot be used for this.' using errcode = '42501'; end if;
  if not exists (select 1 from public.club_directory d where d.id = p_directory_id) then
    raise exception 'That club is not in the directory.' using errcode = 'P0002';
  end if;

  -- Section P: three claims per person per day.
  select count(*) into v_today from public.club_claims c
   where c.claimant_user_id = v_actor and c.created_at > now() - interval '1 day';
  if v_today >= 3 then
    raise exception 'You have submitted too many claims today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  -- Does the club already have an active Club Admin? The reviewer needs to know, and the existing
  -- administrators are told a claim arrived -- without any of the claimant's details.
  select exists (
    select 1 from public.clubs cl
    join public.club_memberships m on m.club_id = cl.id and m.state = 'ACTIVE'
    join public.role_assignments ra on ra.membership_id = m.id and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE'
    where cl.directory_id = p_directory_id) into v_has_admin;

  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration,
                                  state, evidence, has_existing_admin)
  values (p_directory_id, v_actor, p_claimed_role, p_authority_declaration, 'SUBMITTED',
          coalesce(p_evidence, '{}'::jsonb), v_has_admin)
  returning id into v_id;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('claim.submitted', v_actor, 'club claim submitted',
          jsonb_build_object('claim_id', v_id, 'directory_id', p_directory_id, 'has_existing_admin', v_has_admin));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. reply_to_claim -- the NEEDS_INFORMATION conversation, from either side.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.reply_to_claim(p_claim_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid(); v_claim public.club_claims; v_role text; v_id uuid;
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if v_claim.state in ('APPROVED','REJECTED','WITHDRAWN','SUPERSEDED') then
    raise exception 'That claim has already been decided.' using errcode = 'P0001';
  end if;

  if internal.has_site_capability('site.claims.review') then v_role := 'SITE_ADMIN';
  elsif v_claim.claimant_user_id = v_actor then v_role := 'CLAIMANT';
  else raise exception 'You are not part of that claim.' using errcode = '42501';
  end if;

  insert into public.club_claim_messages (claim_id, author_user_id, author_role, body)
  values (p_claim_id, v_actor, v_role, p_body) returning id into v_id;

  -- A Site Admin asking a question moves it to NEEDS_INFORMATION; the claimant answering moves it
  -- back to SUBMITTED, which is what puts it in front of a reviewer again.
  update public.club_claims
     set state = case when v_role = 'SITE_ADMIN' then 'NEEDS_INFORMATION' else 'SUBMITTED' end,
         updated_at = now()
   where id = p_claim_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. decide_club_claim -- replaces approve_club_claim and reject_club_claim (P "Legacy").
-- ---------------------------------------------------------------------------------------------------
create or replace function public.decide_club_claim(
  p_claim_id uuid,
  p_decision text,
  p_reason text,
  p_roles text[] default null
) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.club_claims; v_club uuid; v_membership uuid; v_role text;
  v_roles text[]; v_superseded int := 0; v_slug text;
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'A claim is either approved or rejected.' using errcode = '22023';
  end if;
  -- Section P: triage is site.claims.review; granting a role additionally needs site.club_roles.manage.
  if not internal.has_site_capability('site.claims.review') then
    raise exception 'You are not authorised to review club claims.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;

  -- The directory row is the lock: two reviewers approving competing claims for the same club must
  -- serialise, or both could create a club and an administrator.
  perform 1 from public.club_directory where id = (select directory_id from public.club_claims where id = p_claim_id) for update;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if v_claim.state in ('APPROVED','REJECTED','WITHDRAWN','SUPERSEDED') then
    raise exception 'That claim has already been decided (%).', v_claim.state using errcode = 'P0001';
  end if;

  if p_decision = 'REJECTED' then
    update public.club_claims set state = 'REJECTED', decision_reason = p_reason,
           reviewed_by = v_actor, reviewed_at = now(), decided_by = v_actor, decided_at = now(), updated_at = now()
     where id = p_claim_id;
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('claim.rejected', v_actor, p_reason, jsonb_build_object('claim_id', p_claim_id));
    return jsonb_build_object('outcome','REJECTED','claim_id',p_claim_id);
  end if;

  -- Approving. The roles are the REVIEWER's choice; the claimed title only suggests a default. A
  -- claimant who wrote "Committee Member" does not become a Club Admin because they said so.
  v_roles := coalesce(p_roles, internal.claim_suggested_roles(v_claim.claimed_role));
  if cardinality(v_roles) > 0 and not internal.has_site_capability('site.club_roles.manage') then
    raise exception 'You may review a claim but not grant a role. A Full Site Admin must do that.'
      using errcode = '42501';
  end if;

  select id into v_club from public.clubs where directory_id = v_claim.directory_id;
  if v_club is null then
    select coalesce(nullif(regexp_replace(lower(d.name), '[^a-z0-9]+', '-', 'g'), ''), 'club-' || left(v_claim.directory_id::text, 8))
      into v_slug from public.club_directory d where d.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, v_slug || '-' || left(gen_random_uuid()::text, 4), 'active', v_actor, v_actor)
    returning id into v_club;
  end if;

  select id into v_membership from public.club_memberships
   where club_id = v_club and user_id = v_claim.claimant_user_id and state = 'ACTIVE';
  if v_membership is null then
    insert into public.club_memberships (club_id, user_id, role, status, state)
    values (v_club, v_claim.claimant_user_id, 'BASIC_USER', 'active', 'ACTIVE')
    returning id into v_membership;
  end if;

  foreach v_role in array v_roles loop
    perform internal.grant_role(v_membership, v_role, null, 'CLAIM_APPROVAL', p_reason,
                                jsonb_build_object('claim_id', p_claim_id));
  end loop;

  update public.club_claims
     set state = 'APPROVED', decision_reason = p_reason, reviewed_by = v_actor, reviewed_at = now(),
         decided_by = v_actor, decided_at = now(), resulting_membership_id = v_membership, updated_at = now()
   where id = p_claim_id;

  -- Every other live claim for this club is superseded, and says which claim superseded it.
  update public.club_claims
     set state = 'SUPERSEDED', superseded_by_claim_id = p_claim_id, updated_at = now()
   where directory_id = v_claim.directory_id and id <> p_claim_id and state in ('SUBMITTED','NEEDS_INFORMATION');
  get diagnostics v_superseded = row_count;

  begin perform internal.begin_club_platform_trial(v_club); exception when others then null; end;

  insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
  values ('claim.approved', v_actor, v_club, p_reason,
          jsonb_build_object('claim_id', p_claim_id, 'roles', to_jsonb(v_roles), 'superseded', v_superseded));

  return jsonb_build_object('outcome','APPROVED','claim_id',p_claim_id,'club_id',v_club,
                            'membership_id',v_membership,'roles',to_jsonb(v_roles),'superseded',v_superseded);
end $$;

revoke all on function public.submit_club_claim(uuid,text,text,jsonb) from public, anon;
revoke all on function public.reply_to_claim(uuid,text) from public, anon;
revoke all on function public.decide_club_claim(uuid,text,text,text[]) from public, anon;
grant execute on function public.submit_club_claim(uuid,text,text,jsonb) to authenticated;
grant execute on function public.reply_to_claim(uuid,text) to authenticated;
grant execute on function public.decide_club_claim(uuid,text,text,text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 7. The legacy RPCs become thin adapters, so the existing review screen keeps working while the
--    application moves. They now inherit the canonical authority and the suggestion rule.
-- ---------------------------------------------------------------------------------------------------
-- Returns uuid, as it always has: the review screen uses the club id it hands back.
create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v jsonb;
begin
  v := public.decide_club_claim(p_claim_id, 'APPROVED', coalesce(nullif(btrim(p_notes),''), 'approved'), null);
  return (v->>'club_id')::uuid;
end $$;

create or replace function public.reject_club_claim(p_claim_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  perform public.decide_club_claim(p_claim_id, 'REJECTED', coalesce(nullif(btrim(p_notes),''), 'rejected'), null);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Assertions.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='decide_club_claim') ~ '\minternal\.is_site_admin\(' then
    raise exception 'Slice 5: deciding a claim still uses a blanket site-admin test.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='approve_club_claim') ~ 'grant_role' then
    raise exception 'Slice 5: approve_club_claim still grants a role directly instead of delegating.';
  end if;
  if (select count(*) from public.club_claims where state is null) > 0 then
    raise exception 'Slice 5: a club claim has no state after the backfill.';
  end if;
  raise notice 'Slice 5: club claim state machine installed';
end $$;
