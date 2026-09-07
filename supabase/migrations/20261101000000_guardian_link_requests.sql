-- Guardian link requests -- the safe way a brand-new Parent/Guardian starts.
--
-- WHY THIS EXISTS
--
-- add_child_for_guardian carries a deliberate invite-only guard: the caller
-- must already hold one of three trusted relationships with the club (an
-- accepted guardian invitation, an existing guardian relationship to a player
-- there, or an active club membership). That guard is correct and is NOT
-- relaxed here -- without it, any signed-in person could invent a child at
-- any club and declare themselves its guardian.
--
-- But it left a brand-new parent with nowhere to go: their FIRST child could
-- never pass, while their second always would (adding the first creates
-- exactly the relationship the guard looks for). Reported live as "Child 1
-- does not get added correctly. Child 2 proceeds through the adding flow."
--
-- The answer is not a weaker guard. Name + DOB + club + team are MATCHING
-- SIGNALS, never proof of guardianship. So this adds a controlled REQUEST
-- that grants nothing by itself:
--
--   parent submits -> server matches privately -> a human with real,
--   canonical authority approves -> only then does any relationship exist.
--
-- Two request kinds share one table and one state machine, because they are
-- the same safeguarding question ("is this adult really responsible for this
-- child?") asked from two directions:
--
--   FIRST_CHILD       -- an adult with no club relationship naming a child.
--   ADDITIONAL_GUARDIAN -- a second parent being added to a KNOWN player.
--
-- THE ENUMERATION RULE, which shapes the whole design
--
-- The applicant is unverified by definition. So the server may privately
-- resolve a probable match, but the applicant must never learn whether the
-- child exists in Ovalball, who their guardians are, or what club history
-- they have. matched_player_id is therefore written by the RPC and readable
-- ONLY by approvers -- never by the requester, whose own SELECT policy
-- deliberately cannot see it. The requester's read path is a dedicated
-- function returning a neutral projection.

-- ---------------------------------------------------------------------------
-- The request
-- ---------------------------------------------------------------------------

create table public.guardian_link_requests (
  id uuid primary key default gen_random_uuid(),

  kind text not null check (kind in ('FIRST_CHILD', 'ADDITIONAL_GUARDIAN')),

  -- Explicit, auditable states (never free text). PENDING grants nothing.
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),

  -- WHO is asking. For ADDITIONAL_GUARDIAN this may be null until the invited
  -- adult signs up and claims it by email -- the canonical auth flow, so we
  -- never mint a second person record for someone who already has an account.
  requested_by_user_id uuid references auth.users(id),
  -- The adult the relationship is FOR. Equals requested_by_user_id for
  -- FIRST_CHILD; for ADDITIONAL_GUARDIAN it is the invited adult, resolved
  -- from an existing account where one matches the invited email.
  subject_user_id uuid references auth.users(id),
  invited_email text,

  club_id uuid not null references public.clubs(id),
  -- The age/team context the parent chose, when they chose one. Advisory:
  -- approval re-resolves the canonical team rather than trusting this.
  team_id uuid references public.teams(id),
  rugby_code text,

  -- What the applicant typed. Kept verbatim for the approver to compare
  -- against the real record -- this is the evidence a human judges.
  submitted_first_name text,
  submitted_surname text,
  submitted_date_of_birth date,

  -- Server-derived, approver-only. NEVER returned to the requester: doing so
  -- would answer "does this exact child exist in Ovalball?" for anyone who
  -- can guess a name and a birthday.
  matched_player_id uuid references public.players(id),
  -- Set directly for ADDITIONAL_GUARDIAN, where the player is already known
  -- and legitimately visible to the existing guardian who initiated it.
  target_player_id uuid references public.players(id),

  -- The canonical player this request produced or attached to, written on
  -- approval. One player_id, never a duplicate.
  resolved_player_id uuid references public.players(id),

  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,

  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decided request must record who decided it and when; a PENDING one
  -- must not pretend to have been decided.
  constraint guardian_link_requests_decision_complete check (
    (status in ('PENDING', 'EXPIRED') and decided_by is null and decided_at is null)
    or (status in ('APPROVED', 'REJECTED', 'CANCELLED') and decided_at is not null)
  ),
  -- Only an approved request may name a resolved player. This is the
  -- structural form of "no access before approval": there is no state in
  -- which a pending request carries a canonical player link.
  constraint guardian_link_requests_resolution_requires_approval check (
    resolved_player_id is null or status = 'APPROVED'
  ),
  -- A first-child request describes a child by name; an additional-guardian
  -- request points at one that already exists.
  constraint guardian_link_requests_kind_shape check (
    (kind = 'FIRST_CHILD'
      and submitted_first_name is not null and submitted_surname is not null
      and submitted_date_of_birth is not null and target_player_id is null)
    or (kind = 'ADDITIONAL_GUARDIAN' and target_player_id is not null)
  ),
  -- An additional-guardian request must be able to reach somebody.
  constraint guardian_link_requests_additional_has_subject check (
    kind <> 'ADDITIONAL_GUARDIAN' or subject_user_id is not null or invited_email is not null
  )
);

comment on table public.guardian_link_requests is
  'Controlled request for a Guardian<->Player relationship. A PENDING row grants NOTHING: it is an application, judged by a human with canonical authority. matched_player_id is approver-only and must never reach the requester (child enumeration).';
comment on column public.guardian_link_requests.matched_player_id is
  'Server-derived probable match, visible ONLY to approvers. Exposing it would confirm a specific child exists in Ovalball to an unverified applicant.';

create index guardian_link_requests_requested_by_idx on public.guardian_link_requests (requested_by_user_id, status);
create index guardian_link_requests_subject_idx on public.guardian_link_requests (subject_user_id, status);
create index guardian_link_requests_club_status_idx on public.guardian_link_requests (club_id, status);
create index guardian_link_requests_matched_player_idx on public.guardian_link_requests (matched_player_id) where matched_player_id is not null;
create index guardian_link_requests_target_player_idx on public.guardian_link_requests (target_player_id) where target_player_id is not null;
create index guardian_link_requests_invited_email_idx on public.guardian_link_requests (lower(invited_email)) where invited_email is not null;

-- One live application per adult per child. Prevents an applicant from
-- flooding a club with the same request, and makes "already pending" a
-- deterministic, neutral answer rather than a race.
create unique index guardian_link_requests_one_pending_first_child
  on public.guardian_link_requests (requested_by_user_id, club_id, lower(submitted_first_name), lower(submitted_surname), submitted_date_of_birth)
  where status = 'PENDING' and kind = 'FIRST_CHILD';

create unique index guardian_link_requests_one_pending_additional
  on public.guardian_link_requests (target_player_id, coalesce(subject_user_id::text, lower(invited_email)))
  where status = 'PENDING' and kind = 'ADDITIONAL_GUARDIAN';

create trigger set_updated_at before update on public.guardian_link_requests
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.guardian_link_requests
  for each row execute function internal.audit_row_change();

alter table public.guardian_link_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Who may approve
-- ---------------------------------------------------------------------------

-- Preferred order, per the safeguarding decision:
--   1. an existing ACCEPTED guardian of the player in question, when one
--      safely exists -- the person who already holds the relationship is
--      best placed to confirm a second adult;
--   2. an authorized Club Admin, via the canonical club.guardians.manage
--      capability, whose own definition reads "High safeguarding sensitivity
--      -- Club Admin only, never Team staff".
--
-- Team staff are deliberately absent: team.guardians.invite lets a Team Admin
-- INVITE a guardian to their own team, which is not the same authority as
-- establishing a brand-new guardian relationship over a child, and the
-- capability catalogue already draws that line. Nothing here invents a new
-- role name; both routes are existing canonical authority.
--
-- Safeguarding Officers get visibility through the notification/audit path,
-- not a routine approval duty -- being the safeguarding contact is not the
-- same as being the clerk for every parent signup.
create or replace function internal.can_decide_guardian_link_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1
    from public.guardian_link_requests r
    where r.id = p_request_id
      and (
        -- Route 2: canonical Club Admin authority at the request's own club.
        internal.has_capability('club.guardians.manage', 'club', r.club_id, null)
        -- Route 1: an existing active guardian of the very player this
        -- request concerns. Scoped to THIS request's player, so a guardian
        -- at one club can never decide an unrelated club's request.
        or exists (
          select 1 from public.guardians g
          where g.guardian_user_id = auth.uid()
            and g.status = 'active'
            and g.player_id = coalesce(r.target_player_id, r.matched_player_id)
        )
      )
  );
$$;

revoke all on function internal.can_decide_guardian_link_request(uuid) from public;
grant execute on function internal.can_decide_guardian_link_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Approvers read the full row (they need the match to judge it).
create policy guardian_link_requests_select_approver on public.guardian_link_requests
  for select to authenticated
  using (internal.is_site_admin() or internal.can_decide_guardian_link_request(id));

-- The requester and the invited adult may read their OWN request rows.
--
-- This is a table-level read, so it would expose matched_player_id. Column
-- privileges close that: `authenticated` is granted SELECT only on the
-- neutral columns below, so even a direct PostgREST select cannot return the
-- match. Approvers reach the full row through
-- guardian_link_requests_for_approval(), a SECURITY DEFINER function.
create policy guardian_link_requests_select_own on public.guardian_link_requests
  for select to authenticated
  using (
    requested_by_user_id = auth.uid()
    or subject_user_id = auth.uid()
  );

-- No client INSERT/UPDATE/DELETE at all. Every write goes through a
-- SECURITY DEFINER RPC below, so the state machine and the matching logic
-- cannot be bypassed by a crafted PostgREST call.
revoke all on public.guardian_link_requests from authenticated, anon;
grant select (
  id, kind, status, requested_by_user_id, subject_user_id, invited_email,
  club_id, team_id, rugby_code,
  submitted_first_name, submitted_surname, submitted_date_of_birth,
  resolved_player_id, target_player_id,
  decided_at, decision_note, expires_at, created_at, updated_at
) on public.guardian_link_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Submit a first-child request
-- ---------------------------------------------------------------------------

-- Returns a DELIBERATELY NEUTRAL result. There is exactly one success shape,
-- whether or not a matching child was found, so timing and payload cannot be
-- used to enumerate children. The caller learns only that their request is
-- pending verification.
create or replace function public.request_child_link(
  p_first_name text,
  p_surname text,
  p_date_of_birth date,
  p_club_id uuid,
  p_rugby_code text default 'union'
)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_user uuid := auth.uid();
  v_match_player_id uuid;
  v_match_count integer;
  v_request_id uuid;
  v_recent integer;
  v_season_id uuid;
  v_grade record;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- Anti-abuse. Probable matching is a discovery oracle if it can be run
  -- repeatedly, so cap how many applications one account can have in flight.
  -- Deliberately counts the applicant's OWN rows only -- it never reveals
  -- anything about the club or the children.
  select count(*) into v_recent
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'You have submitted several requests recently. Please wait before submitting another, or contact your club directly.'
      using errcode = '42501';
  end if;

  -- Validate the date of birth against the canonical age-grade domain, so a
  -- request that could never resolve to a real youth team is refused up front
  -- rather than wasting an approver's time. Same messages as the existing
  -- add-a-child path, so the parent sees one consistent product.
  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;
  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  -- Already linked? Answer neutrally rather than confirming anything: the
  -- caller can see their own children elsewhere in the product anyway.
  if exists (
    select 1
    from public.players p
    join public.guardians g on g.player_id = p.id and g.guardian_user_id = v_user and g.status = 'active'
    where lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select null::uuid, 'ALREADY_LINKED'::text;
    return;
  end if;

  -- An existing pending request is idempotent, not an error -- resubmitting
  -- the same child must not create a second application or leak that the
  -- first one matched something.
  select glr.id into v_request_id
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.club_id = p_club_id
    and glr.status = 'PENDING'
    and glr.kind = 'FIRST_CHILD'
    and lower(glr.submitted_first_name) = lower(v_first)
    and lower(glr.submitted_surname) = lower(v_surname)
    and glr.submitted_date_of_birth is not distinct from p_date_of_birth;
  if v_request_id is not null then
    return query select v_request_id, 'PENDING'::text;
    return;
  end if;

  -- PRIVATE probable match. The result is stored for the approver and never
  -- returned. Ambiguity (more than one candidate) is recorded as no match:
  -- guessing which child was meant is exactly what must not happen, so the
  -- approver sees an unmatched application and judges it as a human.
  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id
    and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first)
    and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count = 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id
      and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  insert into public.guardian_link_requests (
    kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code,
    submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id
  )
  values (
    'FIRST_CHILD', 'PENDING', v_user, v_user, p_club_id, p_rugby_code,
    v_first, v_surname, p_date_of_birth, v_match_player_id
  )
  returning id into v_request_id;

  -- One shape, match or no match.
  return query select v_request_id, 'PENDING'::text;
end;
$$;

revoke all on function public.request_child_link(text, text, date, uuid, text) from public;
grant execute on function public.request_child_link(text, text, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ask for another guardian on a child you already hold
-- ---------------------------------------------------------------------------

create or replace function public.request_additional_guardian(
  p_player_id uuid,
  p_email text
)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_subject uuid;
  v_club_id uuid;
  v_request_id uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_email = '' or v_email not like '%_@_%._%' then
    raise exception 'A valid email address is required.';
  end if;

  -- Only someone who ALREADY holds the relationship may propose another
  -- adult for this child. Club Admins reach the same outcome through their
  -- own canonical guardian management, not through this parent-facing call.
  if not exists (
    select 1 from public.guardians g
    where g.guardian_user_id = v_user and g.player_id = p_player_id and g.status = 'active'
  ) then
    raise exception 'You are not authorized to add a guardian for this player.' using errcode = '42501';
  end if;

  select t.club_id into v_club_id
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and ptm.status in ('pending', 'active')
  order by (ptm.status = 'active') desc
  limit 1;
  if v_club_id is null then
    raise exception 'This player is not attached to a club yet.';
  end if;

  -- Reuse the existing account when there is one, so we never create a second
  -- person for somebody who already has an Ovalball login. When there isn't,
  -- the row carries the email and the canonical invitation flow picks it up.
  select u.id into v_subject from auth.users u where lower(u.email) = v_email limit 1;

  if v_subject is not null and exists (
    select 1 from public.guardians g
    where g.guardian_user_id = v_subject and g.player_id = p_player_id and g.status = 'active'
  ) then
    return query select null::uuid, 'ALREADY_LINKED'::text;
    return;
  end if;

  select glr.id into v_request_id
  from public.guardian_link_requests glr
  where glr.kind = 'ADDITIONAL_GUARDIAN'
    and glr.status = 'PENDING'
    and glr.target_player_id = p_player_id
    and coalesce(glr.subject_user_id::text, lower(glr.invited_email)) = coalesce(v_subject::text, v_email);
  if v_request_id is not null then
    return query select v_request_id, 'PENDING'::text;
    return;
  end if;

  insert into public.guardian_link_requests (
    kind, status, requested_by_user_id, subject_user_id, invited_email,
    club_id, target_player_id
  )
  values (
    'ADDITIONAL_GUARDIAN', 'PENDING', v_user, v_subject, v_email,
    v_club_id, p_player_id
  )
  returning id into v_request_id;

  return query select v_request_id, 'PENDING'::text;
end;
$$;

revoke all on function public.request_additional_guardian(uuid, text) from public;
grant execute on function public.request_additional_guardian(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What an approver sees
-- ---------------------------------------------------------------------------

create or replace function public.guardian_link_requests_for_approval(p_club_id uuid default null)
returns table (
  request_id uuid,
  kind text,
  status text,
  club_id uuid,
  club_name text,
  requester_name text,
  requester_email text,
  submitted_first_name text,
  submitted_surname text,
  submitted_date_of_birth date,
  matched_player_id uuid,
  matched_player_name text,
  matched_team_name text,
  target_player_id uuid,
  target_player_name text,
  invited_email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    r.id,
    r.kind,
    r.status,
    r.club_id,
    cd.name,
    coalesce(pr.first_name || ' ' || pr.surname, 'Unknown'),
    pr.email,
    r.submitted_first_name,
    r.submitted_surname,
    r.submitted_date_of_birth,
    r.matched_player_id,
    mp.first_name || ' ' || mp.surname,
    mt.display_name,
    r.target_player_id,
    tp.first_name || ' ' || tp.surname,
    r.invited_email,
    r.created_at
  from public.guardian_link_requests r
  join public.clubs c on c.id = r.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join public.profiles pr on pr.id = r.requested_by_user_id
  left join public.players mp on mp.id = r.matched_player_id
  left join public.players tp on tp.id = r.target_player_id
  left join lateral (
    select t.display_name
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = r.matched_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc
    limit 1
  ) mt on true
  where r.status = 'PENDING'
    and (p_club_id is null or r.club_id = p_club_id)
    and internal.can_decide_guardian_link_request(r.id)
  order by r.created_at;
$$;

revoke all on function public.guardian_link_requests_for_approval(uuid) from public;
grant execute on function public.guardian_link_requests_for_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the REQUESTER sees -- neutral by construction
-- ---------------------------------------------------------------------------

create or replace function public.my_guardian_link_requests()
returns table (
  request_id uuid,
  kind text,
  status text,
  club_id uuid,
  club_name text,
  child_label text,
  created_at timestamptz,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  -- Note what is absent: matched_player_id, the matched child's real name,
  -- their team, their other guardians, and any confirmation that the
  -- submitted details matched an existing record. A pending row looks
  -- identical whether or not the child exists in Ovalball.
  select
    r.id,
    r.kind,
    r.status,
    r.club_id,
    cd.name,
    coalesce(
      nullif(trim(coalesce(r.submitted_first_name, '') || ' ' || coalesce(r.submitted_surname, '')), ''),
      -- For an additional-guardian request the initiator legitimately
      -- already knows this child, so naming them reveals nothing new.
      tp.first_name || ' ' || tp.surname
    ),
    r.created_at,
    r.decided_at
  from public.guardian_link_requests r
  join public.clubs c on c.id = r.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join public.players tp on tp.id = r.target_player_id
  where (r.requested_by_user_id = auth.uid() or r.subject_user_id = auth.uid())
  order by r.created_at desc;
$$;

revoke all on function public.my_guardian_link_requests() from public;
grant execute on function public.my_guardian_link_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Decide
-- ---------------------------------------------------------------------------

create or replace function public.approve_guardian_link_request(p_request_id uuid)
returns table (result text, player_id uuid)
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  r public.guardian_link_requests%rowtype;
  v_player_id uuid;
  v_subject uuid;
  v_season_id uuid;
  v_grade record;
  v_team_id uuid;
  v_team_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Lock the row so two approvers cannot both act on one request and
  -- produce two guardian relationships or two players.
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null then
    -- Same message for "does not exist" and "not yours to see", so this
    -- cannot be used to probe for request ids.
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  v_subject := coalesce(r.subject_user_id, r.requested_by_user_id);
  if v_subject is null then
    -- An additional-guardian request for someone with no account yet cannot
    -- be completed here; they must accept the invitation and sign in first.
    raise exception 'This person needs to accept their invitation and sign in before the relationship can be approved.';
  end if;

  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_player_id := r.target_player_id;
  elsif r.matched_player_id is not null then
    -- Existing child: attach to the CANONICAL player. No duplicate is ever
    -- created on this branch -- that is the whole point of matching.
    v_player_id := r.matched_player_id;
  else
    -- No existing child: create the canonical Player now, at approval time,
    -- by a human with real authority -- never at request time.
    insert into public.players (first_name, surname, date_of_birth, created_by)
    values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, auth.uid())
    returning id into v_player_id;

    -- Place them on a team using the existing canonical age-grade domain,
    -- exactly as add_child_for_guardian does. Ambiguity leaves the player
    -- without a membership for the club to resolve, rather than guessing.
    v_season_id := internal.resolve_season_for_date(coalesce(r.rugby_code, 'union'), current_date);
    if v_season_id is not null then
      select * into v_grade from internal.resolve_player_age_grade(coalesce(r.rugby_code, 'union'), v_season_id, r.submitted_date_of_birth);
      if v_grade.status not in ('TOO_YOUNG', 'OUT_OF_YOUTH_RANGE') then
        select count(*) into v_team_count
        from public.teams t
        where t.club_id = r.club_id and t.active = true
          and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
        if v_team_count = 1 then
          select t.id into v_team_id
          from public.teams t
          where t.club_id = r.club_id and t.active = true
            and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
          insert into public.player_team_memberships (player_id, team_id, status, created_by)
          values (v_player_id, v_team_id, 'active', auth.uid());
        end if;
      end if;
    end if;
  end if;

  -- The relationship itself -- created ONLY here, only on approval.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, created_by)
  values (v_subject, v_player_id, 'guardian', 'active', auth.uid())
  on conflict do nothing;

  update public.guardian_link_requests
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), resolved_player_id = v_player_id
  where id = p_request_id;

  return query select 'approved'::text, v_player_id;
end;
$$;

revoke all on function public.approve_guardian_link_request(uuid) from public;
grant execute on function public.approve_guardian_link_request(uuid) to authenticated;

create or replace function public.reject_guardian_link_request(p_request_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  select glr.status into v_status from public.guardian_link_requests glr where glr.id = p_request_id for update;
  if v_status is null then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  update public.guardian_link_requests
  set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_request_id;

  return 'rejected';
end;
$$;

revoke all on function public.reject_guardian_link_request(uuid, text) from public;
grant execute on function public.reject_guardian_link_request(uuid, text) to authenticated;

-- The applicant may withdraw their own application. Deliberately separate
-- from rejection: it is not a decision about the child, and it must not
-- require approver authority.
create or replace function public.cancel_guardian_link_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  r public.guardian_link_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null or r.requested_by_user_id <> auth.uid() then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  update public.guardian_link_requests
  set status = 'CANCELLED', decided_at = now(), decision_note = 'Withdrawn by the requester.'
  where id = p_request_id;

  return 'cancelled';
end;
$$;

revoke all on function public.cancel_guardian_link_request(uuid) from public;
grant execute on function public.cancel_guardian_link_request(uuid) to authenticated;
