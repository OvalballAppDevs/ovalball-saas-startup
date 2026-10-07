-- =====================================================================================================
-- ONE DISPENSATION WORKFLOW (owner brief 2026-10-05, answers the same day)
--
-- A child who does not fit a team's age grade is shown as not fitting, and normal placement stays
-- blocked. The ONE governed exception is a dispensation: a persisted request for PLAYER + CLUB + TEAM +
-- SEASON, decided once by the club's Safeguarding Officer or a Club Admin -- first valid decision wins --
-- and never by the team staff who asked for it. The owner's answers:
--
--   1. One workflow. The staged chain on player_team_dispensation (the lending team's staff approve, then
--      the Club Admin, then a governing-body reference) converges into a single decision. Team staff
--      request; they never approve. A governing-body reference may be recorded on an approval and is
--      still REQUIRED where it was: cross-pathway, adult and graduation placements, season handover,
--      external-approval call-ups.
--   2. Adults request: a parent or guardian for their own child, the team's Team Manager or Team Admin, a
--      Club Admin, and the people who could already ask (Coach, Fixtures Secretary). A child's own login
--      is told to ask a parent.
--   3. An under-18 onto an adult side "goes to the safeguarding office that then seeks governing body
--      approval": only a Safeguarding Officer decides it, and approving it needs the reference.
--
-- WHAT THIS CHANGES
--   * The record is the existing player_team_dispensation, extended -- never a second table. A request
--     needs no source team (a child joining has none), states its reason, and keeps a snapshot of the age
--     facts it was judged on. A decided record is history: a trigger refuses any rewrite.
--   * One age verdict (internal.placement_age_verdict) serves the team code, the database guard and the
--     age-grade pages. The adult-side rules the movement resolver already held move into one function
--     both use.
--   * THE DATABASE GUARD. A team place can only become ACTIVE on a side whose age grade the player does
--     not fit if an approved dispensation exists for that player, that team and that season (and, for an
--     under-18 on an adult side, one carrying the governing body's reference). Every writer meets it --
--     approving a request, approving a club join onto a team, moving a player, a Site Admin placement --
--     because it is a trigger, not a check each caller remembers. The season engines, which already
--     demand governing-body approval for anything outside the grade, place against the season they build.
--   * Joining: a team code used for a child who does not fit may carry a dispensation request. The place
--     waits, unseen by the team's staff, until the dispensation is approved; a declined, withdrawn or
--     expired one declines the place with it.
--   * Who is told: every Safeguarding Officer and Club Admin who may decide (actionable while pending);
--     the requester and the child's guardians (the outcome); and every other decider, informationally,
--     once it is decided -- so Safeguarding is never silently bypassed by a Club Admin acting first.
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 1. THE RECORD
-- -----------------------------------------------------------------------------------------------------
alter table public.player_team_dispensation
  alter column source_team_id drop not null,
  add column club_id uuid references public.clubs(id),
  add column reason text,
  add column player_date_of_birth date,
  add column player_age_group text,
  add column team_age_group text,
  add column age_verdict text,
  add column requires_governing_body boolean not null default false,
  add column safeguarding_only boolean not null default false,
  add column covers_pathway boolean not null default false,
  add column requested_as text,
  add column decided_by uuid references auth.users(id),
  add column decided_at timestamptz,
  add column decided_as text,
  add column decision_note text,
  add column withdrawn_by uuid references auth.users(id),
  add column withdrawn_at timestamptz,
  add column expired_at timestamptz,
  add column revoked_by uuid references auth.users(id),
  add column revoked_at timestamptz;

update public.player_team_dispensation d
   set club_id = t.club_id
  from public.teams t
 where t.id = d.target_team_id and d.club_id is null;
alter table public.player_team_dispensation alter column club_id set not null;

-- WHAT THE OLD CHAIN'S RECORDS MEANT, KEPT. Each needed a governing-body reference to be approved, and the
-- pathway guard accepted an approved one -- so they stay governing-body records that cover pathway as well
-- as age. A record decided through the retired stages says so rather than claiming a role it never had.
update public.player_team_dispensation
   set requires_governing_body = true,
       covers_pathway = true,
       reason = coalesce(reason, eligibility_rule_reference),
       requested_as = coalesce(requested_as, 'CLUB_STAFF'),
       decided_by = case when status in ('approved', 'rejected')
                         then coalesce(governing_body_decided_by, club_decided_by, source_team_decided_by) end,
       decided_at = case when status in ('approved', 'rejected')
                         then coalesce(governing_body_decided_at, club_decided_at, source_team_decided_at, updated_at) end,
       decided_as = case when status in ('approved', 'rejected') then 'LEGACY' end,
       decision_note = case when status = 'rejected' then decision_reason end,
       revoked_at = case when status = 'revoked' then updated_at end,
       expired_at = case when status = 'expired' then updated_at end;

-- A stage of the retired chain is simply still waiting for the one decision.
update public.player_team_dispensation
   set status = 'requested'
 where status in ('source_team_approved', 'club_approved', 'governing_body_approved');

alter table public.player_team_dispensation drop constraint player_team_dispensation_status_check;
alter table public.player_team_dispensation add constraint player_team_dispensation_status_check
  check (status in ('requested', 'approved', 'rejected', 'withdrawn', 'expired', 'revoked'));
alter table public.player_team_dispensation add constraint player_team_dispensation_decided_as_check
  check (decided_as is null or decided_as in ('SAFEGUARDING_OFFICER', 'CLUB_ADMIN', 'LEGACY'));
alter table public.player_team_dispensation add constraint player_team_dispensation_requested_as_check
  check (requested_as is null or requested_as in ('GUARDIAN', 'TEAM_STAFF', 'CLUB_ADMIN', 'CLUB_STAFF', 'CALL_UP'));
alter table public.player_team_dispensation add constraint player_team_dispensation_age_verdict_check
  check (age_verdict is null or age_verdict in ('TOO_YOUNG', 'TOO_OLD', 'UNDER_18', 'OUTSIDE_AGE_GRADE', 'PATHWAY'));
-- A decline is never silent about why. (The retired chain did not always record one.)
alter table public.player_team_dispensation add constraint player_team_dispensation_decline_has_reason
  check (status <> 'rejected' or decided_as = 'LEGACY' or nullif(btrim(coalesce(decision_note, '')), '') is not null);
alter table public.player_team_dispensation add constraint player_team_dispensation_decided_has_decider
  check (status not in ('approved', 'rejected') or decided_as = 'LEGACY' or (decided_by is not null and decided_at is not null and decided_as is not null));
-- An approval that needed the governing body carries its reference.
alter table public.player_team_dispensation add constraint player_team_dispensation_governing_body_when_required
  check (status <> 'approved' or not requires_governing_body or decided_as = 'LEGACY' or governing_body_reference is not null);

-- ONE LIVE REQUEST per player, team and season -- and history may hold many decided ones. The old
-- one-row-forever constraint made a second request after a decline fail on a unique violation.
alter table public.player_team_dispensation drop constraint player_team_dispensation_player_id_target_team_id_season_id_key;
create unique index player_team_dispensation_one_live
  on public.player_team_dispensation (player_id, target_team_id, season_id)
  where status in ('requested', 'approved');
create index player_team_dispensation_club_status_idx on public.player_team_dispensation (club_id, status);
create index player_team_dispensation_requested_by_idx on public.player_team_dispensation (requested_by);

comment on table public.player_team_dispensation is
  'THE dispensation record: an exception to a team''s age grade (and, for governing-body records, its pathway) for one player, one team and one season. Decided once by the club''s Safeguarding Officer or a Club Admin (an under-18 onto an adult side: the Safeguarding Officer, with the governing body''s reference). Stored states requested / approved / rejected / withdrawn / expired / revoked are presented as Pending / Approved / Declined / Withdrawn / Expired / Revoked. A decided record is never rewritten (internal.dispensation_record_is_history).';

-- The team place a dispensation unlocks, when a request to join waits on one.
alter table public.player_team_memberships add column dispensation_id uuid references public.player_team_dispensation(id);
create index player_team_memberships_dispensation_idx on public.player_team_memberships (dispensation_id) where dispensation_id is not null;


-- -----------------------------------------------------------------------------------------------------
-- 2. A DECIDED RECORD IS HISTORY
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.dispensation_record_is_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- The maintenance setting is honoured only for an operator session, exactly as the audit log honours it
    -- (20270343000000): never inside a request made through the API, even from a definer function.
    if coalesce(current_setting('ovalball.maintenance', true), '') = 'on'
       and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated', 'service_role')
       and session_user::text not in ('authenticator', 'anon', 'authenticated', 'service_role')
       and coalesce(current_setting('request.jwt.claims', true), '') = '' then
      return old;
    end if;
    raise exception 'A dispensation is a permanent record and is never deleted.' using errcode = '42501';
  end if;

  -- WHAT WAS ASKED never changes: a different team or season is a different dispensation.
  if new.player_id is distinct from old.player_id or new.target_team_id is distinct from old.target_team_id
     or new.season_id is distinct from old.season_id or new.club_id is distinct from old.club_id
     or new.source_team_id is distinct from old.source_team_id or new.requested_by is distinct from old.requested_by
     or new.reason is distinct from old.reason or new.created_at is distinct from old.created_at
     or new.eligibility_rule_reference is distinct from old.eligibility_rule_reference
     or new.player_date_of_birth is distinct from old.player_date_of_birth
     or new.player_age_group is distinct from old.player_age_group or new.team_age_group is distinct from old.team_age_group
     or new.age_verdict is distinct from old.age_verdict or new.requires_governing_body is distinct from old.requires_governing_body
     or new.safeguarding_only is distinct from old.safeguarding_only or new.covers_pathway is distinct from old.covers_pathway
     or new.requested_as is distinct from old.requested_as then
    raise exception 'What a dispensation was asked for never changes. Ask for a new one.' using errcode = '23514';
  end if;

  -- A FINISHED RECORD is history. Only an approval can still move -- to revoked -- or gain the governing
  -- body's reference once.
  if old.status in ('rejected', 'withdrawn', 'expired', 'revoked') then
    raise exception 'This dispensation is finished and is kept exactly as it was.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'requested' and new.status in ('approved', 'rejected', 'withdrawn', 'expired'))
              or (old.status = 'approved' and new.status = 'revoked')) then
    raise exception 'A dispensation cannot go from % to %.', old.status, new.status using errcode = '23514';
  end if;

  -- A DECISION, once made, is never rewritten -- not who, not when, not as what, not why.
  if old.decided_at is not null
     and (new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
          or new.decided_as is distinct from old.decided_as or new.decision_note is distinct from old.decision_note) then
    raise exception 'A dispensation decision is final and cannot be changed.' using errcode = '23514';
  end if;
  if old.governing_body_reference is not null
     and new.governing_body_reference is distinct from old.governing_body_reference then
    raise exception 'A recorded governing-body reference never changes.' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function internal.dispensation_record_is_history() from public, anon, authenticated;

create trigger player_team_dispensation_history
  before update or delete on public.player_team_dispensation
  for each row execute function internal.dispensation_record_is_history();

-- A record written straight into the table (a fixture, a maintenance repair) rather than through the
-- workflow is the old chain's kind of record: it names its club, covers pathway as the old guard read it,
-- and -- if it arrives decided -- says it was decided outside the one decision.
create or replace function internal.dispensation_record_defaults()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  new.club_id := coalesce(new.club_id, (select t.club_id from public.teams t where t.id = new.target_team_id));
  -- Only the workflow (internal.create_dispensation_request) says who asked and as what. Anything else is a
  -- record of the retired chain's kind, and is read the way that chain's records always were.
  if new.requested_as is null then
    new.requires_governing_body := true;
    new.covers_pathway := true;
    new.reason := coalesce(new.reason, new.eligibility_rule_reference);
    if new.status in ('approved', 'rejected') and new.decided_as is null then
      new.decided_as := 'LEGACY';
      new.decided_at := coalesce(new.decided_at, now());
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function internal.dispensation_record_defaults() from public, anon, authenticated;

create trigger player_team_dispensation_defaults
  before insert on public.player_team_dispensation
  for each row execute function internal.dispensation_record_defaults();

-- The old trigger told guardians "is now <raw status>" on every change; the decision functions below tell
-- them in words, once, so it would only duplicate them.
drop trigger player_team_dispensation_notify_guardians on public.player_team_dispensation;

-- Every transition attributable in the audit log as well as the security events: who, when, before, after.
-- The record snapshots the child's date of birth when it is asked for; history masks it exactly as it masks
-- players.date_of_birth, so the audit log never becomes a second copy of a child's birthday.
insert into public.audit_redaction_rules (table_name, column_name, mode)
values ('player_team_dispensation', 'player_date_of_birth', 'MASK');
create trigger audit_row_change
  after insert or update or delete on public.player_team_dispensation
  for each row execute function internal.audit_row_change();


-- -----------------------------------------------------------------------------------------------------
-- 3. ONE AGE VERDICT
-- -----------------------------------------------------------------------------------------------------

-- The adult-side rules for a minor, moved verbatim out of resolve_player_movement_eligibility so the
-- movement resolver and the dispensation request read ONE copy (RFU Regulation 15.7; RFL C2:5 and F14).
create or replace function internal.adult_side_minor_requirement(p_code text, p_reference_date date, p_player_dob date)
 returns table(requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_age integer;
begin
  if p_player_dob is null then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby.';
    return;
  end if;
  v_age := extract(year from age(p_reference_date, p_player_dob))::integer;

  if v_age >= 18 then
    return query select 'permitted', null::text, null::text, null::text, null::text, 'This player is 18 or over -- an ordinary adult player.';
    return;
  end if;

  if p_code = 'union' then
    if v_age >= 17 then
      return query select
        'external_approval_required', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)',
        'Club approval for a 17-year-old to play adult rugby, individual player assessment, Club Safeguarding Officer approval, Constituent Body approval, and individual adult registration.',
        'No contested-scrum front row before age 18.',
        'This player is 17 and the destination is an adult Rugby Union team. RFU approval is required before they can participate in adult rugby.';
      return;
    else
      return query select 'not_permitted', 'RFU', 'RFU Regulation 15.7 (Playing Adult Rugby)', null::text, null::text,
        'Under RFU Regulation 15.7 a player must have reached their 17th birthday before playing any adult rugby.';
      return;
    end if;
  end if;

  -- RFL Operational Rules 2026 C2:5:1 -- Open Age from the 17th birthday, or as a true-age Under 17 from
  -- the March in a Season.
  if v_age >= 17 then
    return query select
      'external_approval_required', 'RFL', 'RFL Operational Rules 2026 C2:5:1 and C2:5:2',
      'Adult registration, plus a parent or guardian signature acknowledging that some sections of the RFL Safeguarding Policy do not apply to Adult Rugby League.',
      'A player may only play for the Adult team if their own age group can fulfil its fixtures that week.',
      'This player has reached 17 and the destination is an adult Rugby League team. Adult registration and the under-18 guardian acknowledgement are required.';
    return;
  end if;
  return query select
    'external_approval_required', 'RFL', 'RFL Player Dispensation Policy (Operational Rules 2026, Section F14)',
    'A dispensation decided by the RFL Dispensation Panel.',
    null::text,
    'This player is under 17 and the destination is an adult Rugby League team. RFL Operational Rules C2:5:1 set the Open Age threshold at the 17th birthday, so this needs a dispensation rather than an ordinary registration.';
end;
$function$;
revoke all on function internal.adult_side_minor_requirement(text, date, date) from public, anon, authenticated;

-- THE SEASON A PLACEMENT IS FOR is one of the Seasons register's own two answers, never a third: today, the
-- register's current-or-next season (internal.edition_season_for_code) -- the season covering today,
-- pre-season included, or in the off-season a register leaves between one season's end and the next one's
-- pre-season (as League's does every winter) the season being prepared for, so a place made then is judged
-- against the season it is for; on any other date, the season covering that date
-- (internal.resolve_season_for_date). Nothing is computed from a date, and no helper offers a different
-- answer beside them.

-- THE VERDICT: does a date of birth fit this team in this season, and if not, which way. The season is the
-- register's (pre-season included) unless the caller is building a named season; the team's age grade is
-- its identity FOR that season. Answers about age only -- pathway is assert_player_team_pathway_compatible's.
create or replace function internal.placement_age_verdict(p_team_id uuid, p_dob date, p_as_of date default current_date, p_season_id uuid default null,
                                                         p_pathway text default null)
 returns table(verdict text, season_id uuid, player_age_group text, team_age_group text,
               adult_requirement text, governing_body text, rule_reference text, detail text)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_team public.teams;
  v_season uuid;
  v_team_age text;
  v_grade record;
  v_req record;
  v_mine integer;
  v_theirs integer;
  v_normal_age text;
begin
  select * into v_team from public.teams t where t.id = p_team_id;
  if v_team.id is null then
    return query select 'UNKNOWN_TEAM'::text, null::uuid, null::text, null::text, null::text, null::text, null::text,
      'That team does not exist.'::text;
    return;
  end if;
  v_season := coalesce(p_season_id,
                       case when p_as_of = current_date then internal.edition_season_for_code(v_team.rugby_code)
                            else internal.resolve_season_for_date(v_team.rugby_code, p_as_of) end);

  if internal.team_is_adult_side(p_team_id) then
    if p_dob is null then
      return query select 'NO_DATE_OF_BIRTH'::text, v_season, null::text, null::text, null::text, null::text, null::text,
        'No date of birth is recorded, so their age for adult rugby cannot be established.'::text;
      return;
    end if;
    if p_dob <= (p_as_of - interval '18 years')::date then
      return query select 'FITS'::text, v_season, null::text, null::text, null::text, null::text, null::text, 'Adult side.'::text;
      return;
    end if;
    select * into v_req from internal.adult_side_minor_requirement(v_team.rugby_code, p_as_of, p_dob);
    return query select 'UNDER_18'::text, v_season, null::text, null::text, v_req.requirement, v_req.governing_body,
      v_req.rule_reference, v_req.reason;
    return;
  end if;

  if p_dob is null then
    return query select 'NO_DATE_OF_BIRTH'::text, v_season, null::text, null::text, null::text, null::text, null::text,
      'No date of birth is recorded, so their age grade cannot be established.'::text;
    return;
  end if;
  if v_season is null then
    return query select 'SEASON_NOT_ESTABLISHED'::text, null::uuid, null::text, null::text, null::text, null::text, null::text,
      'No season in the Seasons register covers this date or follows it.'::text;
    return;
  end if;

  select i.age_group into v_team_age from public.get_team_identity_for_season(p_team_id, v_season) i;
  v_team_age := coalesce(v_team_age, v_team.age_group);

  select * into v_grade from internal.resolve_player_age_grade(v_team.rugby_code, v_season, p_dob);
  if v_grade.status = 'TOO_YOUNG' then
    return query select 'TOO_YOUNG'::text, v_season, null::text, v_team_age, null::text, null::text, null::text,
      'Too young for any age grade this season.'::text;
    return;
  end if;
  if v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    return query select 'TOO_OLD'::text, v_season, null::text, v_team_age, null::text, null::text, null::text,
      'Older than every youth age grade this season.'::text;
    return;
  end if;
  if v_grade.canonical_age_group is null or v_team_age is null then
    return query select 'AGE_GRADE_NOT_ESTABLISHED'::text, v_season, v_grade.canonical_age_group, v_team_age,
      null::text, null::text, null::text, 'The age grade could not be established for this season.'::text;
    return;
  end if;
  if v_grade.canonical_age_group = v_team_age then
    return query select 'FITS'::text, v_season, v_grade.canonical_age_group, v_team_age, null::text, null::text, null::text,
      format('Age grade %s, which is this team''s grade.', v_team_age);
    return;
  end if;

  -- THE PLAYER'S NORMAL TEAM FITS TOO, and the canonical allocation rule is the one place that knows it
  -- (public.resolve_normal_operational_identity): union girls play in dual bands under RFU Regulation 15.6,
  -- so a U13 girl's normal side is Girls U14, a U15 girl's Girls U16 and a U17 girl's Girls U18. Asked, never
  -- restated -- a second copy of that rule here is how this guard came to refuse a girl her own team while
  -- season handover placed her there freely. It needs the player's playing pathway; without one, only the
  -- exact grade above can fit, and the pathway guard asks for the pathway anyway.
  if p_pathway is not null then
    select c.age_group into v_normal_age
      from public.resolve_normal_operational_identity(v_team.rugby_code, v_season, p_dob, p_pathway) n
      join public.canonical_team_types_by_code c on c.id = n.canonical_team_type_id and c.rugby_code = v_team.rugby_code
     where n.allocation_status = 'NORMAL_PLACEMENT'
     limit 1;
    if v_normal_age is not null and v_normal_age = v_team_age then
      return query select 'FITS'::text, v_season, v_grade.canonical_age_group, v_team_age, null::text, null::text, null::text,
        format('Age grade %s, whose normal team is a %s side.', v_grade.canonical_age_group, v_team_age);
      return;
    end if;
  end if;

  v_mine := nullif(regexp_replace(v_grade.canonical_age_group, '\D', '', 'g'), '')::integer;
  v_theirs := nullif(regexp_replace(v_team_age, '\D', '', 'g'), '')::integer;
  if v_mine is null or v_theirs is null then
    return query select 'AGE_GRADE_NOT_ESTABLISHED'::text, v_season, v_grade.canonical_age_group, v_team_age,
      null::text, null::text, null::text, 'The age grades could not be compared.'::text;
    return;
  end if;
  return query select case when v_mine < v_theirs then 'TOO_YOUNG' else 'TOO_OLD' end, v_season,
    v_grade.canonical_age_group, v_team_age, null::text, null::text, null::text,
    format('Age grade %s; this team is %s.', v_grade.canonical_age_group, v_team_age);
end;
$function$;
revoke all on function internal.placement_age_verdict(uuid, date, date, uuid, text) from public, anon, authenticated;

-- The team code's question is the same verdict, then the pathway (741's rule, unchanged).
create or replace function internal.team_code_fit(p_team_id uuid, p_dob date, p_pathway text, p_as_of date default current_date)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v record;
  v_gender text;
begin
  select * into v from internal.placement_age_verdict(p_team_id, p_dob, p_as_of, null, p_pathway);
  if v.verdict <> 'FITS' then
    return v.verdict;
  end if;
  select ctt.gender into v_gender
    from public.teams t left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
   where t.id = p_team_id;
  if v_gender is null or v_gender = 'mixed' then return 'FITS'; end if;
  if p_pathway is null then return 'NO_PATHWAY'; end if;
  if (v_gender in ('boys', 'mens') and upper(p_pathway) = 'MALE')
     or (v_gender in ('girls', 'womens') and upper(p_pathway) = 'FEMALE') then
    return 'FITS';
  end if;
  return 'OTHER_PATHWAY';
end;
$function$;
revoke all on function internal.team_code_fit(uuid, date, text, date) from public, anon, authenticated;

-- A date of birth squarely inside an age grade this season: the middle of the band the canonical resolver
-- draws. For fixtures, examples and a sensible starting point in a date picker -- it decides nothing. A
-- fixture that writes "11 years ago" for an Under 12 is right for part of the year and wrong for the rest;
-- this is right all year.
create or replace function internal.date_of_birth_in_age_grade(p_rugby_code text, p_age_group text, p_as_of date default current_date)
 returns date
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  -- The verdict's season (above), so a date this gives is one the guard agrees fits.
  v_season uuid := case when p_as_of = current_date then internal.edition_season_for_code(p_rugby_code)
                        else internal.resolve_season_for_date(p_rugby_code, p_as_of) end;
  v_n integer := nullif(regexp_replace(coalesce(p_age_group, ''), '\D', '', 'g'), '')::integer;
  v_cutoff date;
  v_guess date;
  v_first date;
  v_last date;
begin
  if v_season is null or v_n is null then
    return null;
  end if;
  select r.age_grade_cutoff_date into v_cutoff
    from internal.resolve_player_age_grade(p_rugby_code, v_season, (p_as_of - make_interval(years => v_n))::date) r;
  v_guess := (coalesce(v_cutoff, p_as_of) - make_interval(years => v_n) + interval '6 months')::date;
  if (select r.canonical_age_group from internal.resolve_player_age_grade(p_rugby_code, v_season, v_guess) r) = p_age_group then
    return v_guess;
  end if;
  -- Otherwise find the band near the guess and take its middle.
  select min(d)::date, max(d)::date into v_first, v_last
    from generate_series(v_guess - interval '18 months', v_guess + interval '18 months', interval '1 day') d
   where (select r.canonical_age_group from internal.resolve_player_age_grade(p_rugby_code, v_season, d::date) r) = p_age_group;
  if v_first is null then
    return null;
  end if;
  return v_first + (v_last - v_first) / 2;
end;
$function$;
revoke all on function internal.date_of_birth_in_age_grade(text, text, date) from public, anon, authenticated;

-- The approval a placement can rely on: this player, this team, THIS season.
create or replace function internal.approved_dispensation_id(p_player_id uuid, p_team_id uuid, p_season_id uuid,
                                                            p_need_governing_body boolean default false)
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select d.id from public.player_team_dispensation d
   where d.player_id = p_player_id and d.target_team_id = p_team_id and d.season_id = p_season_id
     and d.status = 'approved'
     and (not p_need_governing_body or d.governing_body_reference is not null)
   order by d.decided_at desc nulls last, d.created_at desc
   limit 1;
$function$;
revoke all on function internal.approved_dispensation_id(uuid, uuid, uuid, boolean) from public, anon, authenticated;


-- The movement resolver reads the same adult-side rules (identical outputs; one copy).
create or replace function internal.resolve_player_movement_eligibility(p_rugby_code text, p_reference_date date, p_player_dob date, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(requirement text, governing_body text, rule_reference text, approval_type text, restrictions text, reason text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_source public.teams;
  v_target public.teams;
  v_code text;
  v_next text;
  -- Identities as they will stand in the season being decided. Without a
  -- season these stay the teams' current values and nothing changes.
  v_src_age text; v_src_gender text; v_src_cat text;
  v_tgt_age text; v_tgt_gender text; v_tgt_cat text;
begin
  select * into v_source from public.teams where id = p_source_team_id;
  select * into v_target from public.teams where id = p_target_team_id;

  if v_source.id is null or v_target.id is null then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'Source or target team could not be found.';
    return;
  end if;

  if not v_source.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The source team has folded and can no longer lend a player.';
    return;
  end if;
  if not v_target.active then
    return query select 'not_permitted', null::text, null::text, null::text, null::text, 'The target team has folded and cannot receive a player.';
    return;
  end if;

  if v_source.club_id <> v_target.club_id then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams belong to different clubs. This needs an inter-club arrangement, which Ovalball does not model as a call-up or dispensation.';
    return;
  end if;

  -- Codes must match. Union and League do not share an age-grade framework,
  -- so a cross-code move is not a dispensation question -- it is meaningless.
  if v_source.rugby_code is distinct from v_target.rugby_code then
    return query select 'not_permitted', null::text, null::text, null::text, null::text,
      'Source and target teams are in different rugby codes. Union and League age grades are separate frameworks and a player cannot move between them as an age-grade progression.';
    return;
  end if;

  -- Trust the teams' own code over the caller's argument.
  v_code := coalesce(v_source.rugby_code, p_rugby_code);

  v_src_age := v_source.age_group; v_src_gender := v_source.gender; v_src_cat := v_source.category;
  v_tgt_age := v_target.age_group; v_tgt_gender := v_target.gender; v_tgt_cat := v_target.category;

  if p_season_id is not null then
    select i.age_group, i.gender, i.category into v_src_age, v_src_gender, v_src_cat
    from public.get_team_identity_for_season(p_source_team_id, p_season_id) i;
    select i.age_group, i.gender, i.category into v_tgt_age, v_tgt_gender, v_tgt_cat
    from public.get_team_identity_for_season(p_target_team_id, p_season_id) i;
    v_src_age := coalesce(v_src_age, v_source.age_group);
    v_tgt_age := coalesce(v_tgt_age, v_target.age_group);
    v_src_gender := coalesce(v_src_gender, v_source.gender);
    v_tgt_gender := coalesce(v_tgt_gender, v_target.gender);
    v_src_cat := coalesce(v_src_cat, v_source.category);
    v_tgt_cat := coalesce(v_tgt_cat, v_target.category);
  end if;

  if v_src_cat = 'youth' and v_tgt_cat = 'youth'
     and v_src_age = v_tgt_age and coalesce(v_src_gender, '') = coalesce(v_tgt_gender, '') then
    return query select 'permitted', null::text, null::text, null::text, null::text, 'Same canonical age group -- an ordinary team-to-team request.';
    return;
  end if;

  if v_tgt_cat = 'senior' then
    -- The adult-side rules for a minor live in ONE function, which the dispensation request reads too.
    return query select * from internal.adult_side_minor_requirement(v_code, p_reference_date, p_player_dob);
    return;
  end if;

  -- Ordinary progression, resolved against the ONE canonical graph. This is
  -- what makes a union Girls U12 -> U14 band move read as ordinary rather
  -- than as something needing a dispensation.
  if v_src_cat = 'youth' and v_tgt_cat = 'youth'
     and coalesce(v_src_gender, '') = coalesce(v_tgt_gender, '') then
    v_next := internal.next_age_grade_for(v_src_age, v_src_gender, v_code);
    if v_next is not null and v_next = v_tgt_age then
      return query select 'team_approval_only', null::text, null::text, null::text, null::text,
        format('Ordinary age-grade progression (%s -> %s) -- the source team''s own approval is sufficient.', v_src_age, v_tgt_age);
      return;
    end if;
  end if;

  return query select 'external_approval_required', null::text, null::text, null::text, null::text,
    format('Moving from %s to %s does not match an ordinary age-grade progression -- a recorded age-grade dispensation is required.',
      coalesce(v_src_age, v_src_cat), coalesce(v_tgt_age, v_tgt_cat));
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 4. THE DATABASE GUARD
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.player_membership_age_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v record;
  v_first text;
  v_label text;
begin
  if new.state is distinct from 'ACTIVE' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.state = 'ACTIVE' and old.team_id = new.team_id and old.player_id = new.player_id then
    return new;
  end if;
  -- THE SEASON ENGINES judge their own placements against the season they are building, and already
  -- demand a governing-body approval for anything outside the grade (handover_apply_blockers_core,
  -- set_rollover_player_placement, place_graduating_player). Only they write these sources: no client can
  -- write a team place at all -- every writer is a security-definer function.
  if new.source in ('SEASON_HANDOVER', 'GRADUATION') then
    return new;
  end if;

  select * into v from internal.placement_age_verdict(new.team_id,
    (select p.date_of_birth from public.players p where p.id = new.player_id), current_date, null,
    (select p.playing_pathway from public.players p where p.id = new.player_id));

  if v.verdict in ('TOO_YOUNG', 'TOO_OLD') then
    if internal.approved_dispensation_id(new.player_id, new.team_id, v.season_id) is not null then
      return new;
    end if;
  elsif v.verdict = 'UNDER_18' then
    if internal.approved_dispensation_id(new.player_id, new.team_id, v.season_id, true) is not null then
      return new;
    end if;
  elsif v.verdict = 'SEASON_NOT_ESTABLISHED' then
    -- An empty register is not a way round the age grade: nothing can be checked, so nothing is placed.
    select t.display_name into v_label from public.teams t where t.id = new.team_id;
    raise exception 'No season in the Seasons register covers today or follows it, so a place on % cannot be checked against its age grade. A Site Admin needs to add the season first.',
      coalesce(v_label, 'this team')
      using errcode = '23514';
  elsif v.verdict = 'NO_DATE_OF_BIRTH' then
    -- FAIL CLOSED. Whether a child fits an age-grade side -- or whether a player is old enough for an adult
    -- one -- cannot be established without a date of birth, and an unknown answer is not a yes. Collecting it
    -- for this is the purpose the privacy map already records for a player's date of birth ("place in correct
    -- age grade"), so nothing new is collected; the column stays nullable. PROHIBIT NEW, FLAG EXISTING: a place
    -- someone already holds is untouched (the early return above), and the team's age-grade view keeps showing
    -- it as needing the date of birth. Season handover and graduation judge their own placements (above), and
    -- graduation already refuses an adult side without one.
    select p.first_name into v_first from public.players p where p.id = new.player_id;
    select t.display_name into v_label from public.teams t where t.id = new.team_id;
    raise exception '% has no date of birth recorded, so whether they can play for % this season cannot be checked. Record their date of birth first.',
      coalesce(v_first, 'This player'), coalesce(v_label, 'this team')
      using errcode = '23514';
  else
    -- Fits, or a team with no age grade to measure against (the team's age-grade view flags those).
    return new;
  end if;

  select p.first_name into v_first from public.players p where p.id = new.player_id;
  select t.display_name into v_label from public.teams t where t.id = new.team_id;
  raise exception '% is outside the age grade for % this season, so they can only be placed there with an approved dispensation for this team and season.',
    coalesce(v_first, 'This player'), coalesce(v_label, 'this team')
    using errcode = '23514';
end;
$function$;
revoke all on function internal.player_membership_age_guard() from public, anon, authenticated;

-- Named so it fires AFTER player_membership_pathway_guard (BEFORE triggers run in name order): a child who
-- fails both is told about the pathway first, because that is the rule a club cannot dispense with itself.
create trigger player_membership_season_grade_guard
  before insert or update of player_id, team_id, status, state on public.player_team_memberships
  for each row execute function internal.player_membership_age_guard();

-- The pathway guard keeps its own exception, and only a record that covers pathway satisfies it: an
-- age-only approval -- even one carrying a governing-body reference -- never waives the pathway.
create or replace function internal.assert_player_team_pathway_compatible(p_player_id uuid, p_team_id uuid)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_pathway text;
  v_first text;
  v_team_gender text;
  v_team_label text;
begin
  select p.playing_pathway, p.first_name into v_pathway, v_first
  from public.players p where p.id = p_player_id;

  select ctt.gender, t.display_name into v_team_gender, v_team_label
  from public.teams t
  left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
  where t.id = p_team_id;

  -- No canonical identity means nothing structured to check against. An
  -- active team always has one; this covers inactive or in-flight rows rather
  -- than inventing a decision from a display name.
  if v_team_gender is null then return; end if;

  -- Mixed rugby is played by everyone, so there is nothing to verify.
  if v_team_gender = 'mixed' then return; end if;

  if v_pathway is null then
    raise exception 'Ovalball does not know which playing pathway % is registered in, so they cannot be added to %. Add their playing information to their profile first -- it must never be assumed from the team.',
      coalesce(v_first, 'this player'), coalesce(v_team_label, 'this team')
      using errcode = '23514';
  end if;

  if (v_team_gender in ('boys', 'mens') and v_pathway = 'MALE')
     or (v_team_gender in ('girls', 'womens') and v_pathway = 'FEMALE') then
    return;
  end if;

  -- Cross-pathway. Permitted only with a recorded governing-body approval for this exact player and team
  -- that covers the pathway -- never an age-grade dispensation.
  if exists (
    select 1 from public.player_team_dispensation d
    where d.player_id = p_player_id and d.target_team_id = p_team_id
      and d.status = 'approved' and d.governing_body_reference is not null and d.covers_pathway
  ) then
    return;
  end if;

  raise exception '% cannot be added to %: that team is in the other playing pathway. This is a governing-body rule, not an Ovalball setting, and it needs a recorded dispensation rather than an override here.',
    coalesce(v_first, 'This player'), coalesce(v_team_label, 'that team')
    using errcode = '23514';
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 5. WHO MAY ASK, WHO MAY DECIDE
-- -----------------------------------------------------------------------------------------------------
insert into public.capabilities (key, label, description, category, valid_scopes, domain, resource, action,
  inherits_to_team, grant_level, revoke_level, delegable, aal, safeguarding_sensitive, minor_prohibited,
  impersonation_blocked, site_master_equivalent, server_enforcement, db_enforcement, legacy_key, migration_action,
  status, design_section, site_addon_allowed)
values ('safeguarding.dispensation.decide', 'Decide Dispensations',
  'Approve or decline a player dispensation as the club''s Safeguarding Officer.',
  'safeguarding', '{club}', 'safeguarding', 'dispensation', 'decide',
  false, 'S', 'S', false, 'R', true, true, false, null, 'rC',
  'RPC decide_dispensation; never the requester or the player''s guardian', 'none', 'NEW (one dispensation workflow)',
  -- Not a J.2-J.14 key: the Phase 2 design never had an officer decide. Named for the programme that added
  -- it, as Convergence Step 16 named governing.access.manage.
  'ACTIVE', 'Age Dispensation Workflow', false);

insert into public.bundle_capabilities (bundle_key, capability_key, scope_type)
values ('SO', 'safeguarding.dispensation.decide', 'club');

-- Team staff request; they never approve (owner, 2026-10-05). The Team Admin may now ask, as the brief says.
delete from public.bundle_capabilities where capability_key = 'fixture.dispensation.approve_team';
insert into public.bundle_capabilities (bundle_key, capability_key, scope_type)
values ('TA', 'fixture.dispensation.request', 'team')
on conflict do nothing;

-- The team stage is retired, not deleted: a key that has ever been granted is part of the record of what a
-- person once held (the Slice 4G precedent). Its legacy adapter goes with it, so a stale team-scope check of
-- approve_player_dispensations is refused rather than answered by a key nobody holds (the Slice 4B precedent).
update public.capabilities
   set status = 'DEPRECATED',
       migration_action = 'RETIRE team stage (one dispensation workflow: team staff request, never decide)',
       description = 'Retired: team staff request a dispensation and never approve one. Kept so historical keys resolve.',
       db_enforcement = 'none -- retired by the one dispensation workflow (20270742000000)'
 where key = 'fixture.dispensation.approve_team';
delete from public.capability_key_map
 where legacy_key = 'approve_player_dispensations' and legacy_scope = 'team';
update public.capabilities
   set migration_action = 'LEGACY: resolves to fixture.dispensation.approve_club'
 where key = 'approve_player_dispensations';

update public.capabilities
   set description = 'Approve or decline a player dispensation as a Club Admin.',
       db_enforcement = 'RPC decide_dispensation; never the requester or the player''s guardian'
 where key = 'fixture.dispensation.approve_club';

-- AS WHAT may this person decide this record -- or null. A Safeguarding Officer must be a confirmed one;
-- an under-18 onto an adult side is the Safeguarding Officer's alone. Never the person who asked, never the
-- player, never anyone who is (or is becoming) the player's guardian.
create or replace function internal.dispensation_decider_role(p_subject uuid, p_dispensation_id uuid, p_check_session boolean default true)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  if d.id is null or p_subject is null then return null; end if;
  if p_subject = d.requested_by
     or exists (select 1 from public.players p where p.id = d.player_id and p.user_id = p_subject)
     or exists (select 1 from public.guardians g
                 where g.player_id = d.player_id and g.guardian_user_id = p_subject
                   and g.state in ('ACTIVE', 'PENDING_APPROVAL')) then
    return null;
  end if;
  if internal.is_active_safeguarding_officer(p_subject, d.club_id)
     and (internal.capability_decision(p_subject, 'safeguarding.dispensation.decide', 'club', d.club_id, null, null, p_check_session, false)).allowed then
    return 'SAFEGUARDING_OFFICER';
  end if;
  if not d.safeguarding_only
     and (internal.capability_decision(p_subject, 'fixture.dispensation.approve_club', 'club', d.club_id, null, null, p_check_session, false)).allowed then
    return 'CLUB_ADMIN';
  end if;
  return null;
end;
$function$;
revoke all on function internal.dispensation_decider_role(uuid, uuid, boolean) from public, anon, authenticated;

-- Everyone who may decide a record, for notifications (session never checked: they are not the caller).
create or replace function internal.dispensation_deciders(p_dispensation_id uuid)
 returns table(user_id uuid, decides_as text)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  if d.id is null then return; end if;
  return query
  select c.uid, internal.dispensation_decider_role(c.uid, d.id, false)
    from (select unnest(internal.active_safeguarding_officer_ids(d.club_id)) as uid
          union
          select ra.user_id from public.role_assignments ra
           where ra.club_id = d.club_id and ra.state = 'ACTIVE' and ra.team_id is null
             and ra.role_key = 'CLUB_ADMIN') c
   where internal.dispensation_decider_role(c.uid, d.id, false) is not null;
end;
$function$;
revoke all on function internal.dispensation_deciders(uuid) from public, anon, authenticated;

-- AS WHAT may the caller request one for this player and team -- or null.
create or replace function internal.dispensation_requester_role(p_player_id uuid, p_team_id uuid)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
begin
  if auth.uid() is null then return null; end if;
  -- A child does not ask for their own exception; a parent does.
  if exists (select 1 from public.players p where p.id = p_player_id and p.user_id = auth.uid())
     and internal.person_is_minor(auth.uid()) then
    return null;
  end if;
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then return null; end if;
  if exists (select 1 from public.guardians g
              where g.player_id = p_player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
    return 'GUARDIAN';
  end if;
  if internal.can('fixture.dispensation.request', 'club', v_club, null, null)
     and internal.can('fixture.dispensation.approve_club', 'club', v_club, null, null) then
    return 'CLUB_ADMIN';
  end if;
  if internal.can('fixture.dispensation.request', 'club', v_club, null, null) then
    return 'CLUB_STAFF';
  end if;
  if internal.can('fixture.dispensation.request', 'team', v_club, p_team_id, null) then
    return 'TEAM_STAFF';
  end if;
  return null;
end;
$function$;
revoke all on function internal.dispensation_requester_role(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 6. ASKING: one core every route uses
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.player_display_name(p_player_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), 'A player')
    from public.players p where p.id = p_player_id;
$function$;
revoke all on function internal.player_display_name(uuid) from public, anon, authenticated;

create or replace function internal.person_display_name(p_user_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Somebody at the club')
    from public.profiles pr where pr.id = p_user_id;
$function$;
revoke all on function internal.person_display_name(uuid) from public, anon, authenticated;

-- Tells every decider a request is waiting. Actionable for them while it is pending; the client pairs it
-- with the dispensation's own attention item and drops it once it is decided.
create or replace function internal.notify_dispensation_deciders(p_dispensation_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
  v_child text;
  v_team text;
begin
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  v_child := internal.player_display_name(d.player_id);
  select t.display_name into v_team from public.teams t where t.id = d.target_team_id;
  insert into public.notifications (user_id, type, title, body, data)
  select x.user_id, 'safeguarding_dispensation_requested',
         format('Dispensation requested for %s', v_child),
         case when d.safeguarding_only
              then format('%s asked for %s to join %s. Under-18s joining an adult side need the Safeguarding Officer to seek governing-body approval.',
                          internal.person_display_name(d.requested_by), v_child, v_team)
              else format('%s asked for %s to play for %s outside their age grade. Review and decide.',
                          internal.person_display_name(d.requested_by), v_child, v_team) end,
         jsonb_build_object('dispensation_id', d.id, 'player_id', d.player_id, 'team_id', d.target_team_id, 'club_id', d.club_id)
    from internal.dispensation_deciders(d.id) x;
end;
$function$;
revoke all on function internal.notify_dispensation_deciders(uuid) from public, anon, authenticated;

-- THE CORE. Validates the case against the canonical verdict, snapshots what it was judged on, records it
-- and tells the deciders. Callers check WHO is asking; this checks WHAT is asked. Raises on refusal.
create or replace function internal.create_dispensation_request(
  p_player_id uuid, p_team_id uuid, p_reason text, p_requested_by uuid, p_requested_as text,
  p_source_team_id uuid default null, p_season_id uuid default null, p_rule_reference text default null,
  p_requires_governing_body boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_team public.teams;
  v_player public.players;
  v_source public.teams;
  v_reason text;
  v record;
  v_season uuid;
  v_season_ok boolean;
  v_pathway_mismatch boolean := false;
  v_verdict text;
  v_existing public.player_team_dispensation;
  v_id uuid;
  v_gender text;
begin
  select * into v_team from public.teams t where t.id = p_team_id;
  select * into v_player from public.players p where p.id = p_player_id;
  if v_team.id is null or v_player.id is null then
    raise exception 'That player or team could not be found.' using errcode = 'P0002';
  end if;
  if not v_team.active then
    raise exception '% is archived, so nobody can be placed there.', v_team.display_name using errcode = '23514';
  end if;
  if p_source_team_id is not null then
    select * into v_source from public.teams t where t.id = p_source_team_id;
    if v_source.id is null or v_source.club_id is distinct from v_team.club_id then
      raise exception 'A dispensation is for one club: the player''s current team and the requested team must both be at it.' using errcode = '23514';
    end if;
    if v_source.rugby_code is distinct from v_team.rugby_code then
      raise exception 'Union and League age grades are separate frameworks; a player cannot move between them by dispensation.' using errcode = '23514';
    end if;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Say why this dispensation is being requested.' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'Keep the reason to 1,000 characters.' using errcode = '22023';
  end if;

  -- THE SEASON: the register's for today, or the coming season for a placement planned ahead of it --
  -- never a past season, never one further ahead.
  if p_season_id is not null then
    select exists (
      select 1 from public.seasons s
       where s.id = p_season_id and s.rugby_code = v_team.rugby_code and s.ends_on >= current_date
         and s.starts_on <= (current_date + interval '18 months')::date) into v_season_ok;
    if not v_season_ok then
      raise exception 'A dispensation can only be requested for the current or the coming season.' using errcode = '22023';
    end if;
  end if;

  select * into v from internal.placement_age_verdict(p_team_id, v_player.date_of_birth, current_date, p_season_id, v_player.playing_pathway);
  v_season := v.season_id;
  if v_season is null then
    raise exception 'No season in the Seasons register covers today or follows it, so a dispensation cannot be requested yet.' using errcode = '23514';
  end if;

  -- A pathway the team does not play is a governing-body matter of its own.
  select ctt.gender into v_gender from public.canonical_team_types ctt where ctt.id = v_team.canonical_team_type_id;
  v_pathway_mismatch := v_gender is not null and v_gender <> 'mixed' and v_player.playing_pathway is not null
    and not ((v_gender in ('boys', 'mens') and v_player.playing_pathway = 'MALE')
             or (v_gender in ('girls', 'womens') and v_player.playing_pathway = 'FEMALE'));

  if v.verdict = 'FITS' and not v_pathway_mismatch then
    raise exception '% already fits % this season. No dispensation is needed.', v_player.first_name, v_team.display_name using errcode = '23514';
  elsif v.verdict = 'UNDER_18' and v.adult_requirement = 'not_permitted' then
    raise exception '%', v.detail using errcode = '23514';
  elsif v.verdict in ('NO_DATE_OF_BIRTH', 'AGE_GRADE_NOT_ESTABLISHED', 'UNKNOWN_TEAM') and not v_pathway_mismatch then
    raise exception '% A dispensation needs the age grade to be known first.', v.detail using errcode = '23514';
  end if;
  if v_pathway_mismatch and p_requested_as not in ('CLUB_STAFF', 'CLUB_ADMIN', 'CALL_UP') then
    raise exception '% is in the other playing pathway. That is a separate governing-body matter your club handles; a dispensation here only covers age grade.',
      v_team.display_name using errcode = '23514';
  end if;

  v_verdict := case when v.verdict in ('TOO_YOUNG', 'TOO_OLD', 'UNDER_18') then v.verdict
                    when v_pathway_mismatch then 'PATHWAY'
                    else 'OUTSIDE_AGE_GRADE' end;

  -- One live request: an open or approved one already covers this player, team and season.
  select * into v_existing from public.player_team_dispensation d
   where d.player_id = p_player_id and d.target_team_id = p_team_id and d.season_id = v_season
     and d.status in ('requested', 'approved');
  if v_existing.id is not null then
    raise exception 'A dispensation for % and % this season is already %.', v_player.first_name, v_team.display_name,
      case v_existing.status when 'approved' then 'approved' else 'waiting for a decision' end
      using errcode = '23505';
  end if;

  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, club_id,
    eligibility_rule_reference, reason, requested_by, requested_as, player_date_of_birth, player_age_group,
    team_age_group, age_verdict, requires_governing_body, safeguarding_only, covers_pathway, status)
  values (p_player_id, p_source_team_id, p_team_id, v_season, v_team.club_id,
    coalesce(nullif(btrim(coalesce(p_rule_reference, '')), ''), v.rule_reference,
             case v_verdict when 'PATHWAY' then 'Playing pathway (governing body)'
                            when 'UNDER_18' then 'Adult rugby for an under-18 (governing body)'
                            else 'Club age-grade dispensation' end),
    v_reason, p_requested_by, p_requested_as, v_player.date_of_birth, v.player_age_group, v.team_age_group, v_verdict,
    p_requires_governing_body or v.verdict = 'UNDER_18' or v_pathway_mismatch,
    v.verdict = 'UNDER_18', v_pathway_mismatch, 'requested')
  returning id into v_id;

  perform internal.emit_security_event('dispensation.requested', p_requested_by, 'SUCCESS', v_reason,
    jsonb_build_object('dispensation_id', v_id, 'verdict', v_verdict, 'requested_as', p_requested_as),
    v_team.club_id, p_team_id, p_player_id);
  perform internal.notify_dispensation_deciders(v_id);
  -- The family is told the moment somebody asks about their child, and told plainly that asking is not
  -- deciding. Whoever asked is not told what they have just done.
  perform internal.tell_dispensation_outcome(v_id,
    format('Dispensation requested for %s', internal.player_display_name(p_player_id)),
    format('%s asked for %s to play for %s this season. Nothing changes unless %s approves it.',
           internal.person_display_name(p_requested_by), internal.player_display_name(p_player_id), v_team.display_name,
           case when (select x.safeguarding_only from public.player_team_dispensation x where x.id = v_id)
                then 'the club''s Safeguarding Officer' else 'the club''s Safeguarding Officer or a Club Admin' end));
  return v_id;
end;
$function$;
revoke all on function internal.create_dispensation_request(uuid, uuid, text, uuid, text, uuid, uuid, text, boolean) from public, anon, authenticated;

-- The old entry point keeps its name for the call-up path; it now goes through the one core.
create or replace function internal.request_player_dispensation_core(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid,
                                                                     p_season_id uuid, p_eligibility_rule_reference text, p_requested_by uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not exists (
    select 1 from public.player_team_memberships
     where player_id = p_player_id and team_id = p_source_team_id and state = 'ACTIVE'
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;
  return internal.create_dispensation_request(p_player_id, p_target_team_id,
    coalesce(nullif(btrim(coalesce(p_eligibility_rule_reference, '')), ''), 'Requested with a call-up.'),
    p_requested_by, 'CALL_UP', p_source_team_id, p_season_id, p_eligibility_rule_reference, true);
end;
$function$;
revoke all on function internal.request_player_dispensation_core(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ASK. A parent for their own child, the requested team's staff, a Club Admin, or a Fixtures Secretary /
-- Coach who could already ask. p_source_team_id names the team a player is moving from, when they have one.
create or replace function public.request_dispensation(p_player_id uuid, p_team_id uuid, p_reason text,
                                                      p_source_team_id uuid default null, p_season_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text;
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  v_role := internal.dispensation_requester_role(p_player_id, p_team_id);
  if v_role is null then
    if exists (select 1 from public.players p where p.id = p_player_id and p.user_id = auth.uid()) then
      raise exception 'Ask your parent or guardian to request a dispensation for you.' using errcode = '42501';
    end if;
    raise exception 'You can''t request a dispensation for this player and team.' using errcode = '42501';
  end if;
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  -- Staff ask about a player their club can already see: one with a place at the club, or one whose
  -- request to join the club is waiting to be placed.
  if v_role <> 'GUARDIAN' and not exists (
       select 1 from public.player_team_memberships m join public.teams t on t.id = m.team_id
        where m.player_id = p_player_id and t.club_id = v_club and m.state in ('ACTIVE', 'PENDING'))
     and not exists (
       select 1 from public.player_club_join_requests r
        where r.player_id = p_player_id and r.club_id = v_club and r.status = 'pending') then
    raise exception 'You can''t request a dispensation for this player and team.' using errcode = '42501';
  end if;
  if p_source_team_id is not null and not exists (
       select 1 from public.player_team_memberships m
        where m.player_id = p_player_id and m.team_id = p_source_team_id and m.state = 'ACTIVE') then
    raise exception 'That player is not on the team they would be moving from.' using errcode = '23514';
  end if;
  return internal.create_dispensation_request(p_player_id, p_team_id, p_reason, auth.uid(), v_role,
                                              p_source_team_id, p_season_id, null, false);
end;
$function$;
revoke all on function public.request_dispensation(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.request_dispensation(uuid, uuid, text, uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 7. WHAT A DECISION (or its absence) DOES ELSEWHERE
-- -----------------------------------------------------------------------------------------------------

-- A team place that waited on this dispensation can no longer go ahead: declined, its new guardian link
-- with it, and whoever asked is told why.
create or replace function internal.close_places_waiting_on_dispensation(p_dispensation_id uuid, p_why text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m record;
  v_team text;
  v_first text;
begin
  for m in select * from public.player_team_memberships x
            where x.dispensation_id = p_dispensation_id and x.state = 'PENDING' for update loop
    select t.display_name into v_team from public.teams t where t.id = m.team_id;
    select p.first_name into v_first from public.players p where p.id = m.player_id;
    update public.guardians
       set state = 'DECLINED', status = 'declined', updated_by = auth.uid()
     where player_id = m.player_id and guardian_user_id = m.created_by and state = 'PENDING_APPROVAL' and source = 'TEAM_CODE';
    update public.player_team_memberships
       set state = 'DECLINED', ended_by = auth.uid(), end_reason = p_why, updated_by = auth.uid()
     where id = m.id;
    -- ONE DECISION, ONE NOTICE. The dispensation's own outcome (internal.tell_dispensation_outcome, which every
    -- caller of this sends) already tells whoever asked and the child's family, with the reason. Only somebody
    -- else who made this place -- and never the person acting -- hears of it here.
    insert into public.notifications (user_id, type, title, body, data)
    select m.created_by, 'add_child_declined', 'Team join can''t go ahead',
           format('%s''s request to join %s can''t go ahead: %s', coalesce(v_first, 'The'), v_team, p_why),
           jsonb_build_object('player_id', m.player_id, 'dispensation_id', p_dispensation_id)
     where m.created_by is not null
       and m.created_by is distinct from auth.uid()
       and m.created_by is distinct from (select d.requested_by from public.player_team_dispensation d where d.id = p_dispensation_id)
       and not exists (select 1 from internal.player_contact_eligibility(array[m.player_id]) e where e.user_id = m.created_by);
  end loop;
end;
$function$;
revoke all on function internal.close_places_waiting_on_dispensation(uuid, text) from public, anon, authenticated;

-- Call-ups that waited on it: blocked, and whoever asked is told.
create or replace function internal.block_call_ups_on_dispensation(p_dispensation_id uuid, p_why text, p_including_approved boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_name text;
begin
  v_name := internal.player_display_name((select d.player_id from public.player_team_dispensation d where d.id = p_dispensation_id));
  with blocked as (
    update public.fixture_player_call_up c
       set status = case when c.status = 'approved' then 'revoked' else 'rejected' end,
           decided_by = auth.uid(), decided_at = now(), decision_reason = p_why, updated_at = now()
     where c.eligibility_requirement_id = p_dispensation_id
       and (c.status in ('requested', 'awaiting_eligibility')
            or (p_including_approved and c.status = 'approved'
                and exists (select 1 from public.fixtures f where f.id = c.fixture_id and f.kickoff_date >= current_date)))
    returning c.id, c.requested_by
  )
  insert into public.notifications (user_id, type, title, body, data)
  select b.requested_by, 'fixture_call_up_decided', 'Call-up blocked',
         format('The call-up for %s can no longer go ahead: %s', v_name, p_why),
         jsonb_build_object('dispensation_id', p_dispensation_id, 'call_up_id', b.id)
    from blocked b where b.requested_by is not null;
end;
$function$;
revoke all on function internal.block_call_ups_on_dispensation(uuid, text, boolean) from public, anon, authenticated;

-- The outcome, said once, to the person who asked and to the child's guardians (and the player, if they
-- hold their own login).
create or replace function internal.tell_dispensation_outcome(p_dispensation_id uuid, p_title text, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  insert into public.notifications (user_id, type, title, body, data)
  select distinct u.user_id, 'safeguarding_guardian_dispensation', p_title, p_body,
         jsonb_build_object('dispensation_id', d.id, 'player_id', d.player_id, 'status', d.status)
    from (select d.requested_by as user_id
          union select e.user_id from internal.player_contact_eligibility(array[d.player_id]) e) u
   where u.user_id is not null and u.user_id is distinct from auth.uid();
end;
$function$;
revoke all on function internal.tell_dispensation_outcome(uuid, text, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 8. DECIDING -- once, by a Safeguarding Officer or a Club Admin
-- -----------------------------------------------------------------------------------------------------
create or replace function public.decide_dispensation(p_dispensation_id uuid, p_approve boolean, p_note text default null,
                                                     p_governing_body_reference text default null)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
  v_role text;
  v_note text;
  v_reference text;
  v_child text;
  v_team text;
  v_decider text;
  v_season_ended boolean;
  m record;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- THE ROW LOCK makes the first valid decision the only one: a second decider waits here, then finds it
  -- decided.
  select * into d from public.player_team_dispensation where id = p_dispensation_id for update;
  if d.id is null then
    raise exception 'That dispensation could not be found.' using errcode = 'P0002';
  end if;
  v_role := internal.dispensation_decider_role(auth.uid(), d.id);
  if v_role is null then
    if auth.uid() = d.requested_by then
      raise exception 'You asked for this dispensation, so another person at the club decides it.' using errcode = '42501';
    end if;
    raise exception 'You can''t decide this dispensation.' using errcode = '42501';
  end if;
  -- RECENT AUTHENTICATION. Deciding is a privileged act: fixture.dispensation.approve_club and
  -- safeguarding.dispensation.decide are catalogued R (a recent authenticator code), like suspending or
  -- removing a member, and R is enforced where the act happens -- internal.require_recent_aal2, the same call
  -- people.membership.suspend makes. Asked after authority, so somebody who may not decide is told that,
  -- not to fetch a code.
  perform internal.require_recent_aal2();
  if d.status <> 'requested' then
    raise exception 'This dispensation has already been %.', case d.status when 'approved' then 'approved'
      when 'rejected' then 'declined' when 'withdrawn' then 'withdrawn' when 'expired' then 'closed: its season ended'
      else d.status end using errcode = '23514';
  end if;
  select s.ends_on < current_date into v_season_ended from public.seasons s where s.id = d.season_id;
  if coalesce(v_season_ended, false) then
    raise exception 'This dispensation''s season has ended, so it can no longer be decided.' using errcode = '23514';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  v_reference := nullif(btrim(coalesce(p_governing_body_reference, '')), '');
  if not p_approve and v_note is null then
    raise exception 'Say why this dispensation is declined. The person who asked is told.' using errcode = '22023';
  end if;
  if coalesce(length(v_note), 0) > 1000 or coalesce(length(v_reference), 0) > 200 then
    raise exception 'Keep the note to 1,000 characters and the reference to 200.' using errcode = '22023';
  end if;
  if p_approve and d.requires_governing_body and v_reference is null then
    raise exception 'This dispensation needs the governing body''s approval. Record its reference to approve it.' using errcode = '22023';
  end if;

  update public.player_team_dispensation
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decided_as = v_role, decision_note = v_note,
         decision_reason = case when p_approve then decision_reason else v_note end,
         governing_body_reference = case when p_approve then coalesce(v_reference, governing_body_reference) else governing_body_reference end,
         governing_body_decided_by = case when p_approve and v_reference is not null then auth.uid() else governing_body_decided_by end,
         governing_body_decided_at = case when p_approve and v_reference is not null then now() else governing_body_decided_at end
   where id = d.id
   returning * into d;

  v_child := internal.player_display_name(d.player_id);
  select t.display_name into v_team from public.teams t where t.id = d.target_team_id;
  v_decider := internal.person_display_name(auth.uid());

  perform internal.emit_security_event(case when p_approve then 'dispensation.approved' else 'dispensation.declined' end,
    d.requested_by, 'SUCCESS', v_note,
    jsonb_build_object('dispensation_id', d.id, 'decided_as', v_role, 'governing_body_reference', d.governing_body_reference is not null),
    d.club_id, d.target_team_id, d.player_id);

  -- WHAT IT UNLOCKS OR ENDS.
  if p_approve then
    for m in select * from public.player_team_memberships x
              where x.dispensation_id = d.id and x.state = 'PENDING'
                and coalesce(x.guardian_confirmation, '') <> 'AWAITING' loop
      perform internal.notify_team_place_approvers(m.id);
    end loop;
    if d.governing_body_reference is not null or not d.requires_governing_body then
      with ready as (
        update public.fixture_player_call_up c set status = 'requested', updated_at = now()
         where c.eligibility_requirement_id = d.id and c.status = 'awaiting_eligibility'
        returning c.id, c.requested_by
      )
      insert into public.notifications (user_id, type, title, body, data)
      select r.requested_by, 'fixture_call_up_decided', 'Age-grade approval granted',
             format('The dispensation for %s has been approved. The call-up can now go to the lending team.', v_child),
             jsonb_build_object('dispensation_id', d.id, 'call_up_id', r.id)
        from ready r where r.requested_by is not null;
    end if;
  else
    perform internal.close_places_waiting_on_dispensation(d.id, format('the dispensation was declined (%s)', v_note));
    perform internal.block_call_ups_on_dispensation(d.id, format('the dispensation was declined (%s)', v_note), false);
  end if;

  -- WHO IS TOLD. The person who asked and the child's family hear the outcome; every OTHER person who could
  -- have decided hears who decided it -- a Safeguarding Officer is never left unaware that a Club Admin acted.
  perform internal.tell_dispensation_outcome(d.id,
    case when p_approve then format('Dispensation approved for %s', v_child) else format('Dispensation declined for %s', v_child) end,
    case when p_approve then format('%s can be placed with %s this season. The team still decides the place itself.', v_child, v_team)
         else format('%s can''t play for %s this season. Reason: %s', v_child, v_team, v_note) end);

  insert into public.notifications (user_id, type, title, body, data)
  select x.user_id, 'safeguarding_dispensation_decided',
         format('Dispensation %s for %s by %s', case when p_approve then 'approved' else 'declined' end, v_child, v_decider),
         format('%s (%s) %s the dispensation for %s to play for %s on %s.',
                v_decider, case v_role when 'SAFEGUARDING_OFFICER' then 'Safeguarding Officer' else 'Club Admin' end,
                case when p_approve then 'approved' else 'declined' end, v_child, v_team,
                to_char(now() at time zone 'Europe/London', 'FMDD FMMonth YYYY "at" HH24:MI')),
         jsonb_build_object('dispensation_id', d.id, 'player_id', d.player_id, 'team_id', d.target_team_id, 'club_id', d.club_id)
    from internal.dispensation_deciders(d.id) x
   where x.user_id is distinct from auth.uid();

  return d.status;
end;
$function$;
revoke all on function public.decide_dispensation(uuid, boolean, text, text) from public, anon;
grant execute on function public.decide_dispensation(uuid, boolean, text, text) to authenticated, service_role;

-- The retired staged decision: there is one decision now, and it is decide_dispensation.
drop function public.decide_player_dispensation(uuid, text, boolean, text, text);
-- The retired request entry point: request_dispensation replaces it (a player and team, a reason).
drop function public.request_player_dispensation(uuid, uuid, uuid, uuid, text);


-- WITHDRAW. The person who asked, or the child's parent, while it is still waiting.
create or replace function public.withdraw_dispensation(p_dispensation_id uuid, p_reason text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
  v_reason text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into d from public.player_team_dispensation where id = p_dispensation_id for update;
  if d.id is null then
    raise exception 'That dispensation could not be found.' using errcode = 'P0002';
  end if;
  if not (auth.uid() = d.requested_by
          or exists (select 1 from public.guardians g
                      where g.player_id = d.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE')) then
    raise exception 'Only the person who asked, or the child''s parent or guardian, can withdraw this.' using errcode = '42501';
  end if;
  if d.status <> 'requested' then
    raise exception 'Only a dispensation still waiting for a decision can be withdrawn.' using errcode = '23514';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  update public.player_team_dispensation
     set status = 'withdrawn', withdrawn_by = auth.uid(), withdrawn_at = now(),
         decision_reason = v_reason
   where id = d.id;
  perform internal.emit_security_event('dispensation.withdrawn', d.requested_by, 'SUCCESS', v_reason,
    jsonb_build_object('dispensation_id', d.id), d.club_id, d.target_team_id, d.player_id);
  perform internal.close_places_waiting_on_dispensation(d.id, 'the dispensation request was withdrawn');
  perform internal.block_call_ups_on_dispensation(d.id, 'the dispensation request was withdrawn', false);
  insert into public.notifications (user_id, type, title, body, data)
  select x.user_id, 'safeguarding_dispensation_decided',
         format('Dispensation withdrawn for %s', internal.player_display_name(d.player_id)),
         format('%s withdrew the dispensation request before it was decided. Nothing is waiting on you.',
                internal.person_display_name(auth.uid())),
         jsonb_build_object('dispensation_id', d.id, 'player_id', d.player_id, 'team_id', d.target_team_id, 'club_id', d.club_id)
    from internal.dispensation_deciders(d.id) x;
  perform internal.tell_dispensation_outcome(d.id,
    format('Dispensation request withdrawn for %s', internal.player_display_name(d.player_id)),
    format('%s withdrew the request for %s to play for %s. Nothing was decided.',
           internal.person_display_name(auth.uid()), internal.player_display_name(d.player_id),
           (select t.display_name from public.teams t where t.id = d.target_team_id)));
end;
$function$;
revoke all on function public.withdraw_dispensation(uuid, text) from public, anon;
grant execute on function public.withdraw_dispensation(uuid, text) to authenticated, service_role;

-- WHO MAY REVOKE. Revoking takes an exception away and can never authorise anything, so the conflict rules
-- that stop a requester or a parent DECIDING a record do not apply here: whoever could decide a record of
-- this kind may revoke it -- the club's confirmed Safeguarding Officer, or a Club Admin unless the record is
-- the officer's alone -- and site support acting in the club.
create or replace function internal.dispensation_may_revoke(p_dispensation_id uuid)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  if auth.uid() is null then return false; end if;
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  if d.id is null then return false; end if;
  return (internal.is_active_safeguarding_officer(auth.uid(), d.club_id)
          and internal.can('safeguarding.dispensation.decide', 'club', d.club_id, null, null))
      or (not d.safeguarding_only
          and internal.can('fixture.dispensation.approve_club', 'club', d.club_id, null, null))
      or internal.has_site_capability('site.support.act_in_club');
end;
$function$;
revoke all on function internal.dispensation_may_revoke(uuid) from public, anon, authenticated;

-- REVOKE. Ends an approval, with a reason. Places already made stay (the age-grade page then shows the
-- player outside the grade); anything still relying on it is blocked.
create or replace function public.revoke_player_dispensation(p_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
  v_reason text;
  v_child text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into d from public.player_team_dispensation where id = p_id for update;
  if d.id is null then
    raise exception 'That dispensation could not be found.' using errcode = 'P0002';
  end if;
  if not internal.dispensation_may_revoke(d.id) then
    raise exception 'Only the club''s Safeguarding Officer or a Club Admin can revoke a dispensation.' using errcode = '42501';
  end if;
  -- Revoking reverses a decision: the same recent-authenticator rule as deciding (decide_dispensation).
  perform internal.require_recent_aal2();
  if d.status <> 'approved' then
    raise exception 'Only an approved dispensation can be revoked.' using errcode = '23514';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required to revoke a dispensation.' using errcode = '22023';
  end if;
  update public.player_team_dispensation
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), decision_reason = v_reason
   where id = d.id;
  perform internal.emit_security_event('dispensation.revoked', d.requested_by, 'SUCCESS', v_reason,
    jsonb_build_object('dispensation_id', d.id), d.club_id, d.target_team_id, d.player_id);
  perform internal.block_call_ups_on_dispensation(d.id, format('the dispensation was revoked (%s)', v_reason), true);
  v_child := internal.player_display_name(d.player_id);
  perform internal.tell_dispensation_outcome(d.id, format('Dispensation revoked for %s', v_child),
    format('The dispensation for %s was revoked: %s', v_child, v_reason));
  insert into public.notifications (user_id, type, title, body, data)
  select x.user_id, 'safeguarding_dispensation_revoked', format('Dispensation revoked for %s', v_child),
         format('%s revoked the dispensation for %s: %s', internal.person_display_name(auth.uid()), v_child, v_reason),
         jsonb_build_object('dispensation_id', d.id, 'player_id', d.player_id, 'team_id', d.target_team_id, 'club_id', d.club_id)
    from internal.dispensation_deciders(d.id) x
   where x.user_id is distinct from auth.uid();
end;
$function$;
revoke all on function public.revoke_player_dispensation(uuid, text) from public, anon;
grant execute on function public.revoke_player_dispensation(uuid, text) to authenticated, service_role;

-- RECORD THE GOVERNING BODY'S APPROVAL on an approval that does not carry it yet -- what the retired
-- chain's last stage did, kept. Once recorded it never changes; call-ups that waited on it go ahead.
create or replace function public.record_dispensation_reference(p_dispensation_id uuid, p_reference text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
  v_reference text;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into d from public.player_team_dispensation where id = p_dispensation_id for update;
  if d.id is null then
    raise exception 'That dispensation could not be found.' using errcode = 'P0002';
  end if;
  if internal.dispensation_decider_role(auth.uid(), d.id) is null then
    raise exception 'Only the club''s Safeguarding Officer or a Club Admin can record the governing body''s approval.' using errcode = '42501';
  end if;
  -- Part of the decision record, so the same recent-authenticator rule as deciding (above).
  perform internal.require_recent_aal2();
  if d.status <> 'approved' then
    raise exception 'The governing body''s approval is recorded on an approved dispensation.' using errcode = '23514';
  end if;
  if d.governing_body_reference is not null then
    raise exception 'This dispensation already carries the governing body''s reference.' using errcode = '23514';
  end if;
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is null or length(v_reference) > 200 then
    raise exception 'Enter the governing body''s reference (up to 200 characters).' using errcode = '22023';
  end if;
  update public.player_team_dispensation
     set governing_body_reference = v_reference, governing_body_decided_by = auth.uid(), governing_body_decided_at = now()
   where id = d.id;
  perform internal.emit_security_event('dispensation.governing_body_recorded', d.requested_by, 'SUCCESS', null,
    jsonb_build_object('dispensation_id', d.id), d.club_id, d.target_team_id, d.player_id);
  update public.fixture_player_call_up c set status = 'requested', updated_at = now()
   where c.eligibility_requirement_id = d.id and c.status = 'awaiting_eligibility';
end;
$function$;
revoke all on function public.record_dispensation_reference(uuid, text) from public, anon;
grant execute on function public.record_dispensation_reference(uuid, text) to authenticated, service_role;

-- EXPIRY. A request still waiting when its season ends closes as expired, and anything waiting on it can
-- no longer go ahead. An approval simply belongs to its season: every check is season-scoped.
create or replace function internal.expire_due_dispensations()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d record;
begin
  for d in select x.id, x.player_id from public.player_team_dispensation x
             join public.seasons s on s.id = x.season_id
            where x.status = 'requested' and s.ends_on < current_date
            for update of x loop
    update public.player_team_dispensation set status = 'expired', expired_at = now() where id = d.id;
    perform internal.close_places_waiting_on_dispensation(d.id, 'the dispensation request expired when its season ended');
    perform internal.block_call_ups_on_dispensation(d.id, 'the dispensation request expired when its season ended', false);
    perform internal.tell_dispensation_outcome(d.id,
      format('Dispensation request expired for %s', internal.player_display_name(d.player_id)),
      format('The request for %s to play for %s was not decided before its season ended, so it has expired. A new season needs a new request.',
             internal.player_display_name(d.player_id),
             (select t.display_name from public.teams t join public.player_team_dispensation x on x.target_team_id = t.id where x.id = d.id)));
  end loop;
end;
$function$;
revoke all on function internal.expire_due_dispensations() from public, anon, authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 9. WHO MAY READ A RECORD
--
-- Who may read a dispensation is who may act on one (J.7 lines 471-472, the Slice 4 closure): whoever asked,
-- the people who may decide it, the club's Safeguarding Officer, anyone who may ask for one -- at club scope
-- the whole club's, at team scope both ends of a move -- and now the child's own family. One exception: a
-- parent's request for a child who is not yet anybody's player stays with the club until it is approved, so
-- the receiving team learns of the child when they join and not before. The record's private facts -- the
-- date of birth it snapshots, the requester's words and the decider's notes -- are not selectable through
-- the API at all (below); the readers hand them only to the people entitled to them.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.may_read_dispensation(p_dispensation_id uuid)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  if auth.uid() is null then return false; end if;
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  if d.id is null then return false; end if;
  return d.requested_by = auth.uid()
      or internal.can('fixture.dispensation.approve_club', 'club', d.club_id, null, null)
      or internal.can('fixture.dispensation.request', 'club', d.club_id, null, null)
      -- J.12 line 548: the Safeguarding Officer's own view (the SO bundle holds it only once confirmed).
      or internal.can('safeguarding.dispensation.view', 'club', d.club_id, null, null)
      or internal.can_player_as_family('player.profile.view', d.player_id)
      -- A decider who is also this child's parent reads it as a parent, and sees it decided by somebody else.
      or internal.dispensation_decider_role(auth.uid(), d.id) is not null
      or (d.source_team_id is not null
          and internal.can('fixture.dispensation.request', 'team', d.club_id, d.source_team_id, null))
      or ((d.requested_as is distinct from 'GUARDIAN' or d.status in ('approved', 'revoked'))
          and internal.can('fixture.dispensation.request', 'team', d.club_id, d.target_team_id, null))
      or internal.has_site_capability('site.support.view_club');
end;
$function$;
revoke all on function internal.may_read_dispensation(uuid) from public, anon;
-- Called by the read policy, which runs as the reader.
grant execute on function internal.may_read_dispensation(uuid) to authenticated, service_role;

-- The club-wide readers, hoisted so the policy computes them once per statement rather than once per row
-- (the Slice 4C/4G pattern): the clubs whose every record the caller reads -- as a Club Admin, or as anyone
-- who may ask for a dispensation at club scope. Built from the caller's ACTIVE memberships, which is sound:
-- both keys are held through a club bundle, which needs an ACTIVE membership, or an override, which rule 5
-- ignores without one.
create or replace function internal.dispensation_club_ids()
 returns uuid[]
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(array_agg(distinct cm.club_id), '{}'::uuid[])
  from public.club_memberships cm
  where cm.user_id = auth.uid() and cm.state = 'ACTIVE'
    and (internal.can('fixture.dispensation.approve_club', 'club', cm.club_id, null, null)
         or internal.can('fixture.dispensation.request', 'club', cm.club_id, null, null));
$function$;
revoke all on function internal.dispensation_club_ids() from public, anon;
grant execute on function internal.dispensation_club_ids() to authenticated, service_role;

-- One meaning, internal.may_read_dispensation; the hoisted branches only answer its club-wide cases early.
-- The officer's branch now matches on the RECEIVING team: a joining request has no source team.
drop policy player_team_dispensation_select on public.player_team_dispensation;
create policy player_team_dispensation_select on public.player_team_dispensation for select to authenticated
using (
  target_team_id in (select unnest(internal.safeguarding_dispensation_team_ids()))
  or club_id in (select unnest(internal.dispensation_club_ids()))
  or (select internal.has_site_capability('site.support.view_club'))
  or internal.may_read_dispensation(id)
);

-- Nothing reads the team-stage hoist any more: the policy above was its last reader (20270381000000), so it
-- goes only now that the policy has been replaced.
drop function if exists internal.dispensation_team_ids();

-- THE PRIVATE FACTS. The row is read by staff who are never shown a child's date of birth (player_staff_view
-- carries none, GP-E1) or a family's reasons, so those columns are simply not selectable through the API.
-- A column granted here is a column every row reader sees; a column added later is private until it is.
revoke select on public.player_team_dispensation from authenticated;
grant select (id, player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, status,
              requested_by, source_team_decided_by, source_team_decided_at, club_decided_by, club_decided_at,
              governing_body_reference, governing_body_decided_by, governing_body_decided_at, created_at, updated_at,
              club_id, player_age_group, team_age_group, age_verdict, requires_governing_body, safeguarding_only,
              covers_pathway, requested_as, decided_by, decided_at, decided_as, withdrawn_by, withdrawn_at,
              expired_at, revoked_by, revoked_at)
   on public.player_team_dispensation to authenticated;


-- -----------------------------------------------------------------------------------------------------
-- 10. READERS -- one shape for both apps
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.dispensation_json(d public.player_team_dispensation)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_role text;
  v_guardian boolean;
  v_family boolean;
  v_entitled boolean;
  v_place record;
  v_json jsonb;
begin
  v_role := internal.dispensation_decider_role(auth.uid(), d.id);
  v_guardian := exists (select 1 from public.guardians g
                         where g.player_id = d.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE');
  v_family := internal.can_player_as_family('player.profile.view', d.player_id);
  -- The private facts -- date of birth, the requester's words, the decider's notes -- are for the people
  -- judging or owning the request, never for every reader of the row.
  v_entitled := v_role is not null or v_family or d.requested_by = auth.uid()
             or internal.can('safeguarding.dispensation.view', 'club', d.club_id, null, null)
             or internal.can('fixture.dispensation.approve_club', 'club', d.club_id, null, null)
             or internal.has_site_capability('site.support.view_club');
  select x.id, x.state into v_place from public.player_team_memberships x
   where x.dispensation_id = d.id order by x.created_at desc limit 1;
  select jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'player', jsonb_build_object('id', p.id, 'first_name', p.first_name, 'surname', p.surname,
                                 'date_of_birth', case when v_entitled then d.player_date_of_birth end),
    'club', jsonb_build_object('id', d.club_id, 'name', cd.name),
    'team', jsonb_build_object('id', t.id, 'label', t.display_name, 'adult_side', internal.team_is_adult_side(t.id)),
    'source_team', case when st.id is null then null else jsonb_build_object('id', st.id, 'label', st.display_name) end,
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'ends_on', s.ends_on),
    'player_age_group', d.player_age_group,
    'team_age_group', d.team_age_group,
    'verdict', d.age_verdict,
    'reason', case when v_entitled then d.reason end,
    'rule_reference', d.eligibility_rule_reference,
    'requested_by', jsonb_build_object('id', d.requested_by, 'name', internal.person_display_name(d.requested_by)),
    'requested_as', d.requested_as,
    'requested_at', d.created_at,
    'requires_governing_body', d.requires_governing_body,
    'safeguarding_only', d.safeguarding_only,
    'governing_body_reference', d.governing_body_reference,
    'decided_by', case when d.decided_by is null then null else jsonb_build_object('id', d.decided_by, 'name', internal.person_display_name(d.decided_by)) end,
    'decided_as', d.decided_as,
    'decided_at', d.decided_at,
    'decision_note', case when v_entitled then d.decision_note end,
    'withdrawn_by', case when d.withdrawn_by is null then null else jsonb_build_object('id', d.withdrawn_by, 'name', internal.person_display_name(d.withdrawn_by)) end,
    'withdrawn_at', d.withdrawn_at,
    'expired_at', d.expired_at,
    'revoked_by', case when d.revoked_by is null then null else jsonb_build_object('id', d.revoked_by, 'name', internal.person_display_name(d.revoked_by)) end,
    'revoked_at', d.revoked_at,
    'revoke_reason', case when v_entitled and d.status = 'revoked' then d.decision_reason end,
    'place', case when v_place.id is null then null else jsonb_build_object('membership_id', v_place.id, 'state', v_place.state) end,
    'viewer', jsonb_build_object(
      'decides_as', case when d.status = 'requested' then v_role end,
      'may_withdraw', d.status = 'requested' and (d.requested_by = auth.uid() or v_guardian),
      'may_revoke', d.status = 'approved' and internal.dispensation_may_revoke(d.id),
      'may_record_governing_body', d.status = 'approved' and d.governing_body_reference is null and v_role is not null,
      'is_requester', d.requested_by = auth.uid(),
      'is_family', v_family))
    into v_json
  from public.players p, public.teams t, public.seasons s, public.clubs c
  left join public.club_directory cd on cd.id = c.directory_id
  left join public.teams st on st.id = d.source_team_id
  where p.id = d.player_id and t.id = d.target_team_id and s.id = d.season_id and c.id = d.club_id;
  return v_json;
end;
$function$;
revoke all on function internal.dispensation_json(public.player_team_dispensation) from public, anon, authenticated;

create or replace function public.dispensation_record(p_dispensation_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  d public.player_team_dispensation;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into d from public.player_team_dispensation where id = p_dispensation_id;
  -- Not found and not yours read the same: a record id is never an oracle.
  if d.id is null or not internal.may_read_dispensation(d.id) then
    return null;
  end if;
  return internal.dispensation_json(d);
end;
$function$;
revoke all on function public.dispensation_record(uuid) from public, anon;
grant execute on function public.dispensation_record(uuid) to authenticated, service_role;

-- THE CLUB'S REGISTER, for the people who decide: every record at the club, open ones first.
create or replace function public.dispensation_register(p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- The people who read every record of the club through the row policy: its Safeguarding Officer, its
  -- Club Admins, and anyone who may ask for a dispensation at club scope (the Fixtures Secretary).
  if not (internal.can('safeguarding.dispensation.view', 'club', p_club_id, null, null)
          or internal.can('fixture.dispensation.approve_club', 'club', p_club_id, null, null)
          or internal.can('fixture.dispensation.request', 'club', p_club_id, null, null)) then
    raise exception 'Only the club''s Safeguarding Officer, its Club Admins and its Fixtures Secretary can see its dispensations.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(internal.dispensation_json(d)
                     order by (d.status = 'requested') desc, coalesce(d.decided_at, d.created_at) desc)
      from public.player_team_dispensation d
     where d.club_id = p_club_id), '[]'::jsonb);
end;
$function$;
revoke all on function public.dispensation_register(uuid) from public, anon;
grant execute on function public.dispensation_register(uuid) to authenticated, service_role;

-- WHAT WAITS ON ME TO DECIDE -- the attention projection's source. Never what I asked for, never my child's.
create or replace function public.dispensation_decisions_waiting()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'club_id', d.club_id, 'team_id', d.target_team_id, 'player_id', d.player_id,
             'first_name', p.first_name, 'surname', p.surname, 'team_label', t.display_name,
             'decides_as', internal.dispensation_decider_role(auth.uid(), d.id),
             'safeguarding_only', d.safeguarding_only, 'requested_at', d.created_at)
           order by d.created_at)
      from public.player_team_dispensation d
      join public.players p on p.id = d.player_id
      join public.teams t on t.id = d.target_team_id
     where d.status = 'requested'
       and d.club_id = any (array(select cm.club_id from public.club_memberships cm
                                   where cm.user_id = auth.uid() and cm.state = 'ACTIVE'))
       and internal.dispensation_decider_role(auth.uid(), d.id) is not null), '[]'::jsonb);
end;
$function$;
revoke all on function public.dispensation_decisions_waiting() from public, anon;
grant execute on function public.dispensation_decisions_waiting() to authenticated, service_role;

-- WHAT I ASKED FOR, OR WHAT CONCERNS MY CHILD -- the requester's and the family's view of their state.
create or replace function public.my_dispensations()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(internal.dispensation_json(d) order by (d.status = 'requested') desc, d.created_at desc)
      from public.player_team_dispensation d
     where d.requested_by = auth.uid()
        or internal.can_player_as_family('player.profile.view', d.player_id)), '[]'::jsonb);
end;
$function$;
revoke all on function public.my_dispensations() from public, anon;
grant execute on function public.my_dispensations() to authenticated, service_role;

-- WHAT THE CALLER MAY DO ABOUT A PLAYER AND A TEAM: the verdict in words, whether a dispensation may be
-- requested, and any live one. Staff move pickers and the age-grade pages ask this; nothing here grants.
create or replace function public.dispensation_options(p_player_id uuid, p_team_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_player public.players;
  v record;
  v_role text;
  v_live public.player_team_dispensation;
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_player from public.players p where p.id = p_player_id;
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  v_role := internal.dispensation_requester_role(p_player_id, p_team_id);
  -- Nothing about a player the caller has no business with.
  if v_player.id is null or v_club is null
     or (v_role is null and v_player.user_id is distinct from auth.uid()
         and not internal.can('team.roster.view', 'team', v_club, p_team_id, null)) then
    return null;
  end if;
  select * into v from internal.placement_age_verdict(p_team_id, v_player.date_of_birth, current_date, null, v_player.playing_pathway);
  select * into v_live from public.player_team_dispensation d
   where d.player_id = p_player_id and d.target_team_id = p_team_id and d.season_id = v.season_id
     and d.status in ('requested', 'approved');
  return jsonb_build_object(
    'verdict', v.verdict,
    'player_age_group', v.player_age_group,
    'team_age_group', v.team_age_group,
    'season_id', v.season_id,
    'adult_requirement', v.adult_requirement,
    'detail', v.detail,
    'may_request', v_role is not null and v_live.id is null
                   and (v.verdict in ('TOO_YOUNG', 'TOO_OLD') or (v.verdict = 'UNDER_18' and v.adult_requirement = 'external_approval_required')),
    'live', case when v_live.id is null then null
                 else jsonb_build_object('id', v_live.id, 'status', v_live.status, 'decided_as', v_live.decided_as) end);
end;
$function$;
revoke all on function public.dispensation_options(uuid, uuid) from public, anon;
grant execute on function public.dispensation_options(uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 11. EVERY OTHER CHECK, SEASON-SCOPED
-- -----------------------------------------------------------------------------------------------------

-- The age-grade status reports an approval only for THIS season, and only a live request as pending.
create or replace function internal.team_age_grade_status(p_team_id uuid, p_player_id uuid, p_as_of date default current_date)
 returns table(status text, detail text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_code text; v_category text; v_age_group text; v_dob date; v_season uuid;
  v_resolved_category text; v_resolved_age_group text; v_resolve_status text;
  v_disp text; v_pathway text; v_fit text;
begin
  select t.rugby_code, t.category, t.age_group into v_code, v_category, v_age_group
    from public.teams t where t.id = p_team_id;
  if v_code is null then
    return query select 'UNKNOWN_TEAM'::text, 'That team does not exist.'::text;
    return;
  end if;

  select p.date_of_birth, p.playing_pathway into v_dob, v_pathway from public.players p where p.id = p_player_id;
  -- The season the placement guard judges by (internal.placement_age_verdict), so this list and the guard
  -- never disagree about a child: the season covering the date, or today the register's current-or-next.
  v_season := case when p_as_of = current_date then internal.edition_season_for_code(v_code)
                   else internal.resolve_season_for_date(v_code, p_as_of) end;

  -- AN APPROVED EXCEPTION FOR THIS SEASON IS AN ANSWER IN ITS OWN RIGHT, and it is checked first. One from
  -- an earlier season answers nothing: a new season needs a new dispensation.
  select d.status into v_disp
    from public.player_team_dispensation d
   where d.player_id = p_player_id and d.target_team_id = p_team_id
     and d.season_id = v_season and d.status in ('approved', 'requested')
   order by case d.status when 'approved' then 0 else 1 end, d.created_at desc
   limit 1;

  if v_disp = 'approved' then
    return query select 'DISPENSATION_APPROVED'::text,
      'An approved dispensation covers this player for this team this season.'::text;
    return;
  end if;

  -- The senior game has no age grade to be outside of; what it has is an adult/minor question, and
  -- that is answered by the canonical minor predicates rather than re-derived here.
  if internal.team_is_adult_side(p_team_id) then
    if v_dob is null then
      return query select 'AGE_EVIDENCE_REQUIRED'::text,
        'This player has no recorded date of birth, so their age for adult rugby cannot be established.'::text;
      return;
    end if;
    return query select 'ELIGIBLE'::text, 'Adult side.'::text;
    return;
  end if;

  if v_dob is null then
    return query select 'AGE_EVIDENCE_REQUIRED'::text,
      'This player has no recorded date of birth. Age grade cannot be established without one, and is never inferred from the team they play for.'::text;
    return;
  end if;

  -- THE SEASON COMES FROM THE REGISTER. No season, no answer -- and it says which thing is missing
  -- rather than guessing a year.
  if v_season is null then
    return query select 'SEASON_NOT_ESTABLISHED'::text,
      'No season in the Seasons register covers this date, so age grade cannot be established for it.'::text;
    return;
  end if;

  select r.canonical_category, r.canonical_age_group, r.status
    into v_resolved_category, v_resolved_age_group, v_resolve_status
    from internal.resolve_player_age_grade(v_code, v_season, v_dob) r;

  if v_resolve_status is distinct from 'OK' and v_resolved_age_group is null then
    return query select 'AGE_GRADE_NOT_ESTABLISHED'::text,
      format('The canonical age-grade resolver could not place this player for this season (%s).', coalesce(v_resolve_status, 'no status'))::text;
    return;
  end if;

  -- WHAT FITS IS THE PLACEMENT GUARD'S ANSWER (internal.placement_age_verdict), which asks the canonical
  -- allocation rule as well -- union girls' dual bands among it -- so this list never calls a child outside
  -- the grade whom the guard would place, or the other way round.
  select v.verdict into v_fit from internal.placement_age_verdict(p_team_id, v_dob, p_as_of, v_season, v_pathway) v;
  if v_fit = 'FITS' then
    return query select 'ELIGIBLE'::text,
      case when v_resolved_age_group = v_age_group
           then format('Age grade %s, which is this team''s grade.', v_resolved_age_group)
           else format('Age grade %s, whose normal team is a %s side.', v_resolved_age_group, v_age_group) end::text;
    return;
  end if;

  if v_disp is not null then
    return query select 'DISPENSATION_PENDING'::text,
      format('This player''s age grade is %s and this team is %s. A dispensation has been requested and is not yet decided.',
             coalesce(v_resolved_age_group, 'not established'), coalesce(v_age_group, 'not recorded'))::text;
    return;
  end if;

  return query select 'OUTSIDE_AGE_GRADE'::text,
    format('This player''s age grade is %s and this team is %s. A dispensation would be needed to play them here.',
           coalesce(v_resolved_age_group, 'not established'), coalesce(v_age_group, 'not recorded'))::text;
end;
$function$;

-- Graduation placement: a governing-body approval for THIS season.
create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  q public.player_graduation_queue;
  v_target public.teams;
  v_dob date;
  v_is_adult boolean;
  v_has_approved_dispensation boolean;
  v_season_id uuid;
  v_player_age integer;
  v_target_age integer;
  v_label text;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select * into v_target from public.teams where id = p_target_team_id;
  if v_target.club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.can('team.graduation.place', 'team', q.club_id, p_target_team_id, null)
          or internal.can('team.graduation.place', 'club', q.club_id, null)) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  select date_of_birth into v_dob from public.players where id = q.player_id;
  v_season_id := internal.edition_season_for_code(v_target.rugby_code);

  if v_target.category = 'senior' then
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby. Record their date of birth before placing them on a senior team.' using errcode = '23514';
    end if;

    v_is_adult := v_dob <= (current_date - interval '18 years')::date;

    if not v_is_adult then
      v_has_approved_dispensation := internal.approved_dispensation_id(q.player_id, p_target_team_id, v_season_id, true) is not null;
      if not v_has_approved_dispensation then
        raise exception 'This player is under 18 and cannot be placed on a senior team without an approved dispensation for this player, this team and this season, carrying the governing body''s approval reference. Request a dispensation; the club''s Safeguarding Officer decides it and records the governing body''s reference -- Ovalball records that approval, it does not grant it on the governing body''s behalf.' using errcode = '23514';
      end if;
    end if;

  elsif v_target.category = 'youth' and v_target.age_group is not null then
    -- The direction that was unguarded. An adult must not land in a youth
    -- squad because the graduation list happened to offer one.
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot check they are the right age for %. Record their date of birth before placing them on an age-banded team.',
        v_target.display_name using errcode = '23514';
    end if;

    if v_season_id is null then
      raise exception 'No % season covers today, so Ovalball cannot work out this player''s age grade. Set up the current season before placing graduating players.',
        v_target.rugby_code using errcode = '23514';
    end if;

    select regulatory_age_number, regulatory_age_label into v_player_age, v_label
    from public.resolve_player_regulatory_age(v_target.rugby_code, v_season_id, v_dob);

    v_target_age := nullif(regexp_replace(v_target.age_group, '\D', '', 'g'), '')::integer;

    if v_player_age is not null and v_target_age is not null and v_player_age > v_target_age then
      v_has_approved_dispensation := internal.approved_dispensation_id(q.player_id, p_target_team_id, v_season_id, true) is not null;
      if not v_has_approved_dispensation then
        raise exception 'This player is % this season and would be over-age for %. Placing an older player into a younger age band needs an approved governing-body dispensation for this player, this team and this season. Playing up an age group does not -- only playing down.',
          v_label, v_target.display_name using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by, source)
  values (q.player_id, p_target_team_id, 'active', auth.uid(), 'GRADUATION');

  -- The cohort they graduated from is archived; leaving the membership active
  -- left an archived team holding live members and double-counted the player.
  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = auth.uid()
  where player_id = q.player_id and team_id = q.source_team_id and status = 'active';

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$function$;


-- Call-ups read the one workflow (and its deciders are told by the one request core).
create or replace function public.request_player_call_up(p_fixture_id uuid, p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_eligibility_rule_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_target_club uuid;
  v_rugby_code text;
  v_dob date;
  v_resolved record;
  v_season_id uuid;
  v_existing_dispensation record;
  v_eligibility_id uuid;
  v_call_up_status text;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_fixture_callups', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_fixture_callups', 'club', v_target_club)) then
    raise exception 'Not authorized to request a call-up onto this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A call-up requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  select rugby_code into v_rugby_code from public.teams where id = p_source_team_id;
  select date_of_birth into v_dob from public.players where id = p_player_id;
  select * into v_resolved from internal.resolve_player_movement_eligibility(v_rugby_code, current_date, v_dob, p_source_team_id, p_target_team_id);

  if v_resolved.requirement = 'not_permitted' then
    raise exception '%', v_resolved.reason using errcode = '23514';
  end if;

  v_call_up_status := 'requested';

  if v_resolved.requirement = 'external_approval_required' then
    -- ONE DISPENSATION WORKFLOW: the call-up waits on the season's live dispensation for this player and
    -- team -- an approval carrying the governing body's reference lets it go to the lending team; anything
    -- less (pending, or approved without the reference yet) leaves it waiting; none yet asks for one.
    v_season_id := internal.edition_season_for_code(v_rugby_code);
    select * into v_existing_dispensation from public.player_team_dispensation
      where player_id = p_player_id and target_team_id = p_target_team_id and season_id = v_season_id
        and status in ('requested', 'approved');

    if found and v_existing_dispensation.status = 'approved' and v_existing_dispensation.governing_body_reference is not null then
      v_eligibility_id := v_existing_dispensation.id;
      v_call_up_status := 'requested';
    elsif found then
      v_eligibility_id := v_existing_dispensation.id;
      v_call_up_status := 'awaiting_eligibility';
    else
      v_eligibility_id := internal.request_player_dispensation_core(
        p_player_id, p_source_team_id, p_target_team_id, v_season_id,
        coalesce(v_resolved.rule_reference, 'Age-grade dispensation') || ' -- ' || v_resolved.reason,
        auth.uid()
      );
      v_call_up_status := 'awaiting_eligibility';
    end if;
  end if;

  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, eligibility_rule_reference, requested_by, status, eligibility_requirement_id)
  values (p_fixture_id, p_player_id, p_source_team_id, p_target_team_id, p_eligibility_rule_reference, auth.uid(), v_call_up_status, v_eligibility_id)
  returning id into v_id;

  if v_call_up_status = 'requested' then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_call_up_requested', 'Player call-up requested',
      format('%s have requested %s for an upcoming fixture.', (select display_name from public.teams where id = p_target_team_id), (select first_name || ' ' || surname from public.players where id = p_player_id)),
      jsonb_build_object('call_up_id', v_id)
    from internal.team_role_assignments tp join public.club_memberships cm on cm.id = tp.membership_id
    where tp.team_id = p_source_team_id and cm.status = 'active' and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
    union
    select cm.user_id, 'fixture_call_up_requested', 'Player call-up requested',
      format('%s have requested %s for an upcoming fixture.', (select display_name from public.teams where id = p_target_team_id), (select first_name || ' ' || surname from public.players where id = p_player_id)),
      jsonb_build_object('call_up_id', v_id)
    from public.club_memberships cm
    where cm.club_id = v_target_club and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return v_id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 13. JOINING: a team code may ask for a dispensation (team codes place players, 20270741000000)
--
-- A child who does not fit is still shown as not fitting. A parent may ask for a dispensation for them in
-- the same request; the place then waits -- unseen by the team's staff, counted in one quiet line -- until
-- the Safeguarding Officer or a Club Admin decides. Approved: the team is told, and decides the place.
-- Declined, withdrawn or expired: the place is declined with it.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.dispensation_is_approved(p_dispensation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.player_team_dispensation d where d.id = p_dispensation_id and d.status = 'approved');
$function$;
revoke all on function internal.dispensation_is_approved(uuid) from public, anon;
-- Called by the team-place read policy, which runs as the reader.
grant execute on function internal.dispensation_is_approved(uuid) to authenticated, service_role;

-- Whether the age is the only thing in the way: too young or too old for an age grade, or an under-18 the
-- governing body may approve for adult rugby -- and the pathway fits.
create or replace function internal.team_code_dispensable(p_team_id uuid, p_dob date, p_pathway text)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v record;
  v_gender text;
begin
  if p_dob is null then return false; end if;
  select * into v from internal.placement_age_verdict(p_team_id, p_dob, current_date, null, p_pathway);
  if not (v.verdict in ('TOO_YOUNG', 'TOO_OLD') or (v.verdict = 'UNDER_18' and v.adult_requirement = 'external_approval_required')) then
    return false;
  end if;
  select ctt.gender into v_gender
    from public.teams t left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
   where t.id = p_team_id;
  if v_gender is null or v_gender = 'mixed' then return true; end if;
  return (v_gender in ('boys', 'mens') and upper(coalesce(p_pathway, '')) = 'MALE')
      or (v_gender in ('girls', 'womens') and upper(coalesce(p_pathway, '')) = 'FEMALE');
end;
$function$;
revoke all on function internal.team_code_dispensable(uuid, date, text) from public, anon, authenticated;

create or replace function internal.player_team_membership_facts()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    -- state defaults to ACTIVE, so a legacy insert that names another status
    -- is read from that status.
    if new.state is null or (new.state = 'ACTIVE' and lower(coalesce(new.status, 'active')) <> 'active') then
      new.state := upper(coalesce(new.status, 'active'));
    end if;
    new.source := coalesce(new.source, 'LEGACY_BACKFILL');
    new.granted_by := coalesce(new.granted_by, new.created_by);
  else
    if new.state is not distinct from old.state and new.status is distinct from old.status then
      new.state := upper(new.status);
    end if;
    if new.state is distinct from old.state then
      if old.state in ('ENDED', 'DECLINED') then
        raise exception 'A finished team place cannot be switched back on. Add the player to the team again.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state not in ('ACTIVE', 'DECLINED', 'ENDED') then
        raise exception 'A team join request can only be approved or declined.' using errcode = '23514';
      end if;
      if old.state <> 'PENDING' and new.state in ('PENDING', 'DECLINED') then
        raise exception 'Only a team join request can be declined, and nothing returns to being a request.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state = 'ACTIVE' and coalesce(new.guardian_confirmation, '') = 'AWAITING' then
        raise exception 'A parent or guardian has to confirm this request before the team can approve it.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state = 'ACTIVE' and new.dispensation_id is not null
         and not internal.dispensation_is_approved(new.dispensation_id) then
        raise exception 'This request waits for a dispensation decision before the team can approve it.' using errcode = '23514';
      end if;
      if new.state in ('ENDED', 'DECLINED') then
        new.ended_at := coalesce(new.ended_at, now());
        new.ended_by := coalesce(new.ended_by, auth.uid());
      end if;
    end if;
    if new.player_id <> old.player_id then
      raise exception 'A team place''s player never changes.' using errcode = '23514';
    end if;
  end if;
  new.status := lower(new.state);
  return new;
end;
$function$;

create or replace function internal.team_code_request(p_invitation_id uuid, p_actor uuid, p_subject jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  p_invitation public.access_invitations;
  v_for text := upper(coalesce(p_subject ->> 'for', ''));
  v_team public.teams;
  v_player public.players;
  v_first text := nullif(btrim(coalesce(p_subject ->> 'first_name', '')), '');
  v_surname text := nullif(btrim(coalesce(p_subject ->> 'surname', '')), '');
  v_pathway text := upper(nullif(btrim(coalesce(p_subject ->> 'playing_pathway', '')), ''));
  v_dob date;
  v_fit text;
  v_place public.player_team_memberships;
  v_membership uuid;
  v_awaiting boolean := false;
  v_new_child boolean := false;
  v_match uuid;
  v_profile public.profiles;
  v_generic constant text := 'That invitation or code can''t be used.';
  -- A parent may ask for a child who does not fit by asking for a dispensation in the same breath.
  v_disp_reason text := nullif(btrim(coalesce(p_subject ->> 'dispensation_reason', '')), '');
  v_verdict record;
  v_dispensation uuid;
  v_waits_on_dispensation boolean := false;
begin
  -- Already found, checked and locked by redeem_invitation in this same transaction.
  select * into p_invitation from public.access_invitations where id = p_invitation_id;
  select * into v_team from public.teams where id = p_invitation.team_id;
  if v_team.id is null or v_for not in ('SELF', 'CHILD', 'NEW_CHILD') then
    return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
  end if;

  -- A date that is not a date is no date at all, never an error that would roll the attempt back.
  begin
    v_dob := nullif(p_subject ->> 'date_of_birth', '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_pathway is not null and v_pathway not in ('MALE', 'FEMALE') then v_pathway := null; end if;

  -- ---------------------------------------------------------------- the person themselves
  if v_for = 'SELF' then
    select * into v_player from public.players where user_id = p_actor;
    if internal.person_is_minor(p_actor) then
      -- A CHILD'S OWN REQUEST. Their record must already be whole -- only a parent or guardian records a
      -- child's gender -- and somebody must be there to confirm it.
      if v_player.id is null or v_player.date_of_birth is null or v_player.playing_pathway is null
         or not exists (select 1 from public.guardians g where g.player_id = v_player.id and g.state = 'ACTIVE') then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'GUARDIAN_REQUIRED',
          'message', 'Ask your parent or guardian to use this code for you.');
      end if;
      v_awaiting := true;
    elsif v_player.id is null or v_player.date_of_birth is null or v_player.playing_pathway is null then
      -- An adult -- or somebody with no date of birth on file yet -- completes their own record first, the
      -- one canonical way: create_own_player_profile, which keeps its own rules.
      if coalesce(v_player.date_of_birth, v_dob) is null or coalesce(v_player.playing_pathway, v_pathway) is null then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
          'message', 'Add your date of birth and gender first.');
      end if;
      if coalesce(v_player.date_of_birth, v_dob) > (current_date - interval '18 years')::date then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'GUARDIAN_REQUIRED',
          'message', 'Ask your parent or guardian to use this code for you.');
      end if;
      if v_player.id is null then
        if not internal.can('player.self_register', 'self') then
          return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
        end if;
        select * into v_profile from public.profiles where id = p_actor;
        if nullif(btrim(coalesce(v_profile.first_name, '')), '') is null or nullif(btrim(coalesce(v_profile.surname, '')), '') is null then
          return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
            'message', 'Add your name to your account first.');
        end if;
      end if;
      perform public.create_own_player_profile(v_profile.first_name, v_profile.surname, v_dob, v_pathway);
      select * into v_player from public.players where user_id = p_actor;
    end if;

  -- ---------------------------------------------------------------- one of their children
  elsif v_for = 'CHILD' then
    if coalesce(p_subject ->> 'player_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
    end if;
    select p.* into v_player from public.players p
     where p.id = (p_subject ->> 'player_id')::uuid
       and exists (select 1 from public.guardians g
                    where g.player_id = p.id and g.guardian_user_id = p_actor and g.state = 'ACTIVE');
    -- Somebody else's child is exactly as unknown as no child at all.
    if v_player.id is null then
      return jsonb_build_object('outcome', 'REFUSED', 'message', v_generic);
    end if;

  -- ---------------------------------------------------------------- a child not on Ovalball yet
  else
    if v_first is null or v_surname is null or v_dob is null or v_pathway is null then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
        'message', 'Add their first name, last name, date of birth and gender.');
    end if;
    if v_dob > current_date then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'DETAILS_REQUIRED',
        'message', 'That date of birth is in the future.');
    end if;
    if v_dob <= (current_date - interval '18 years')::date then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', 'ADULT_OWN_ACCOUNT',
        'message', 'Players aged 18 or over join with their own account.');
    end if;
    v_fit := internal.team_code_fit(v_team.id, v_dob, v_pathway);
    if v_fit <> 'FITS' and not (v_disp_reason is not null and internal.team_code_dispensable(v_team.id, v_dob, v_pathway)) then
      return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', v_fit,
        'dispensable', internal.team_code_dispensable(v_team.id, v_dob, v_pathway),
        'message', format('That child can''t join %s with this code.', v_team.display_name));
    end if;

    -- THEIR OWN CHILD ALREADY: the same name and date of birth under this parent is that child.
    select p.* into v_player from public.players p
      join public.guardians g on g.player_id = p.id and g.guardian_user_id = p_actor and g.state in ('ACTIVE', 'PENDING_APPROVAL')
     where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth = v_dob
     order by (g.state = 'ACTIVE') desc
     limit 1;

    if v_player.id is not null then
      v_fit := null;  -- judged below on the record they already have, not on what was typed
    else
      -- A CHILD WHO MAY ALREADY BE AT THE CLUB. Same name, same date of birth, a place at this club: the
      -- club checks it through its existing duplicate review, and the parent is told exactly what they
      -- would be told otherwise -- a code must never reveal whether a particular child plays somewhere.
      select ptm.player_id into v_match
        from public.player_team_memberships ptm
        join public.players p on p.id = ptm.player_id
        join public.teams t on t.id = ptm.team_id
       where t.club_id = v_team.club_id and ptm.state in ('PENDING', 'ACTIVE')
         and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth = v_dob
       order by (ptm.state = 'ACTIVE') desc
       limit 1;
      if v_match is not null then
        if not exists (select 1 from public.player_duplicate_reviews r
                        where r.requesting_guardian_user_id = p_actor and r.status = 'pending'
                          and lower(r.submitted_first_name) = lower(v_first) and lower(r.submitted_surname) = lower(v_surname)
                          and r.submitted_date_of_birth = v_dob) then
          insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth,
                                                      submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
          values (v_team.id, v_first, v_surname, v_dob, v_pathway, v_match, p_actor, p_actor);
        end if;
        return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'club_id', v_team.club_id, 'team_id', v_team.id,
          'new_child', true, 'under_review', true, 'awaiting_guardian', false, 'already', false);
      end if;

      insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
      values (v_first, v_surname, v_dob, v_pathway, p_actor)
      returning * into v_player;
      -- The parent's relationship waits for the same one approval as the team place.
      insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, source_invitation_id, created_by)
      values (p_actor, v_player.id, 'guardian', 'pending', 'PENDING_APPROVAL', 'TEAM_CODE', p_invitation.id, p_actor);
      v_new_child := true;
    end if;
  end if;

  -- ---------------------------------------------------------------- the place itself
  select * into v_place from public.player_team_memberships
   where player_id = v_player.id and team_id = v_team.id and state in ('PENDING', 'ACTIVE')
   order by (state = 'ACTIVE') desc
   limit 1;
  if v_place.state = 'ACTIVE' then
    return jsonb_build_object('outcome', 'REFUSED', 'reason', 'ALREADY_ON_TEAM',
      'message', format('%s is already on %s.', v_player.first_name, v_team.display_name));
  elsif v_place.state = 'PENDING' then
    return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'membership_id', v_place.id, 'player_id', v_player.id,
      'club_id', v_team.club_id, 'team_id', v_team.id, 'new_child', false, 'under_review', false,
      'awaiting_guardian', coalesce(v_place.guardian_confirmation, '') = 'AWAITING',
      'awaiting_dispensation', v_place.dispensation_id is not null and not internal.dispensation_is_approved(v_place.dispensation_id),
      'already', true);
  end if;

  -- ONE USE OF A CODE FOR EACH PLAYER. Somebody who has used this code for this player before -- the request
  -- was declined, or the place has since ended -- is told so. Asking again is a conversation with the team,
  -- not a second use; and without this answer the second use failed on the one-redemption-per-player record.
  if exists (select 1 from public.invitation_redemptions r
              where r.invitation_id = p_invitation.id and r.user_id = p_actor and r.subject_player_id = v_player.id) then
    return jsonb_build_object('outcome', 'REFUSED', 'reason', 'ALREADY_USED',
      'message', case when v_for = 'SELF' then 'You''ve already used this code. To ask again, talk to the team.'
                      else format('You''ve already used this code for %s. To ask again, talk to the team.', v_player.first_name) end);
  end if;

  if v_fit is null then
    v_fit := internal.team_code_fit(v_team.id, v_player.date_of_birth, v_player.playing_pathway);
  end if;
  if v_fit <> 'FITS' then
    -- OUTSIDE THE AGE GRADE. An approval the club already holds for this child, this team and this season
    -- answers it; one already waiting is joined, never duplicated; otherwise a parent who gave a reason asks
    -- for one now. A child's own login never does -- they ask a parent.
    select * into v_verdict from internal.placement_age_verdict(v_team.id, v_player.date_of_birth, current_date, null, v_player.playing_pathway);
    v_dispensation := internal.approved_dispensation_id(v_player.id, v_team.id, v_verdict.season_id, v_fit = 'UNDER_18');
    if v_dispensation is null then
      select d.id into v_dispensation from public.player_team_dispensation d
       where d.player_id = v_player.id and d.target_team_id = v_team.id and d.season_id = v_verdict.season_id
         and d.status = 'requested';
      v_waits_on_dispensation := v_dispensation is not null;
    end if;
    if v_dispensation is null then
      if v_for = 'SELF' or v_disp_reason is null
         or not internal.team_code_dispensable(v_team.id, v_player.date_of_birth, v_player.playing_pathway) then
        return jsonb_build_object('outcome', 'REFUSED', 'reason', 'NOT_ELIGIBLE', 'verdict', v_fit,
          'dispensable', v_for <> 'SELF' and internal.team_code_dispensable(v_team.id, v_player.date_of_birth, v_player.playing_pathway),
          'message', format('%s can''t join %s with this code.', v_player.first_name, v_team.display_name));
      end if;
      v_dispensation := internal.create_dispensation_request(v_player.id, v_team.id, v_disp_reason, p_actor, 'GUARDIAN');
      v_waits_on_dispensation := true;
    end if;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, state, created_by, source, source_invitation_id,
                                             guardian_confirmation, reason, dispensation_id)
  values (v_player.id, v_team.id, 'pending', 'PENDING', p_actor, 'TEAM_CODE', p_invitation.id,
          case when v_awaiting then 'AWAITING' end, 'asked with a team code', v_dispensation)
  returning id into v_membership;

  if v_awaiting then
    perform internal.notify_team_place_guardians(v_membership);
  elsif v_waits_on_dispensation then
    -- The Safeguarding Officer and Club Admins were told by the dispensation request; the team's staff are
    -- told once it is approved, and never before.
    null;
  else
    perform internal.notify_team_place_approvers(v_membership);
  end if;

  return jsonb_build_object('outcome', 'TEAM_PLACE_PENDING', 'membership_id', v_membership, 'player_id', v_player.id,
    'club_id', v_team.club_id, 'team_id', v_team.id, 'new_child', v_new_child, 'under_review', false,
    'awaiting_guardian', v_awaiting, 'awaiting_dispensation', v_waits_on_dispensation,
    'dispensation_id', v_dispensation, 'already', false);
end;
$function$;

create or replace function public.team_code_choices(p_token text default null, p_code text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v public.access_invitations;
  v_team public.teams;
  v_club text;
  v_me public.players;
  v_membership text;
  v_request boolean;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(p_token, p_code) is null then
    raise exception 'Give a link or a code.' using errcode = '22023';
  end if;

  select i.* into v from public.access_invitations i
   where (p_token is not null and i.token_sha256 = internal.invitation_token_hash(p_token))
      or (p_code  is not null and i.code_hmac    = internal.invitation_code_hash(p_code))
   limit 1;
  if v.id is null or v.kind <> 'TEAM_JOIN_CODE' or v.state <> 'ISSUED' or v.expires_at <= now() or v.use_count >= v.max_uses then
    return null;
  end if;
  select * into v_team from public.teams t where t.id = v.team_id and t.active;
  if v_team.id is null or not exists (select 1 from public.clubs c where c.id = v.club_id and c.status = 'active') then
    return null;
  end if;
  if not ((internal.capability_decision(v.issued_by, v.issuer_capability, 'team', v.club_id, v.team_id, null)).allowed
          or (internal.capability_decision(v.issued_by, v.issuer_capability, 'club', v.club_id, null, null)).allowed) then
    return null;
  end if;

  select d.name into v_club from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = v.club_id;
  select * into v_me from public.players where user_id = v_actor;
  select m.state into v_membership from public.club_memberships m
   where m.club_id = v.club_id and m.user_id = v_actor and m.state in ('PENDING', 'ACTIVE', 'SUSPENDED')
   limit 1;
  v_request := exists (select 1 from public.club_join_requests r
                        where r.club_id = v.club_id and r.requesting_user_id = v_actor and r.status = 'pending');

  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'label', v_team.display_name, 'club_name', v_club,
                               'adult_side', internal.team_is_adult_side(v_team.id), 'age_group', v_team.age_group,
                               'gender', (select ctt.gender from public.canonical_team_types ctt where ctt.id = v_team.canonical_team_type_id)),
    'me', jsonb_build_object(
      'player_id', v_me.id,
      'fit', case when v_me.id is null then null else internal.team_code_fit(v_team.id, v_me.date_of_birth, v_me.playing_pathway) end,
      'minor', internal.person_is_minor(v_actor),
      'established_adult', internal.person_is_established_adult(v_actor),
      'has_guardian', v_me.id is not null and exists (select 1 from public.guardians g where g.player_id = v_me.id and g.state = 'ACTIVE'),
      'needs_details', v_me.id is null or v_me.date_of_birth is null or v_me.playing_pathway is null,
      -- AWAITING is a child's own request that a parent has not confirmed yet: it is not the team's to
      -- decide, and saying "the team will decide" would tell the child the wrong next step. USED is this
      -- person's earlier use of this code for this player, with no place now: shown, not offered again.
      'place', coalesce(
                 (select case when ptm.state = 'PENDING' and ptm.guardian_confirmation = 'AWAITING' then 'AWAITING'
                              when ptm.state = 'PENDING' and ptm.dispensation_id is not null
                                   and not internal.dispensation_is_approved(ptm.dispensation_id) then 'DISPENSATION'
                              else ptm.state end
                    from public.player_team_memberships ptm
                   where ptm.player_id = v_me.id and ptm.team_id = v_team.id and ptm.state in ('PENDING', 'ACTIVE')
                   order by (ptm.state = 'ACTIVE') desc limit 1),
                 case when exists (select 1 from public.invitation_redemptions r
                                    where r.invitation_id = v.id and r.user_id = v_actor and r.subject_player_id = v_me.id) then 'USED' end)),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', p.id, 'first_name', p.first_name, 'surname', p.surname,
               'birth_year', extract(year from p.date_of_birth)::int,
               'fit', internal.team_code_fit(v_team.id, p.date_of_birth, p.playing_pathway),
               -- Outside the age grade and nothing else in the way: a parent may ask for a dispensation.
               'dispensable', internal.team_code_dispensable(v_team.id, p.date_of_birth, p.playing_pathway),
               'dispensation', (select jsonb_build_object('id', d.id, 'status', d.status)
                                  from public.player_team_dispensation d
                                 where d.player_id = p.id and d.target_team_id = v_team.id
                                   and d.season_id = (select x.season_id from internal.placement_age_verdict(v_team.id, p.date_of_birth, current_date, null, p.playing_pathway) x)
                                   and d.status in ('requested', 'approved')
                                 order by d.created_at desc limit 1),
               'place', coalesce(
                          (select case when ptm.state = 'PENDING' and ptm.guardian_confirmation = 'AWAITING' then 'AWAITING'
                                       when ptm.state = 'PENDING' and ptm.dispensation_id is not null
                                            and not internal.dispensation_is_approved(ptm.dispensation_id) then 'DISPENSATION'
                                       else ptm.state end
                             from public.player_team_memberships ptm
                            where ptm.player_id = p.id and ptm.team_id = v_team.id and ptm.state in ('PENDING', 'ACTIVE')
                            order by (ptm.state = 'ACTIVE') desc limit 1),
                          case when exists (select 1 from public.invitation_redemptions r
                                             where r.invitation_id = v.id and r.user_id = v_actor and r.subject_player_id = p.id) then 'USED' end))
             order by p.date_of_birth desc nulls last, p.first_name)
        from public.players p
       where exists (select 1 from public.guardians g
                      where g.player_id = p.id and g.guardian_user_id = v_actor and g.state = 'ACTIVE')
         and p.user_id is distinct from v_actor), '[]'::jsonb),
    'member', jsonb_build_object('membership', v_membership, 'requested', v_request));
end;
$function$;

create or replace function public.approve_pending_team_membership(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player public.players;
  v_player_first_name text;
  v_guardian public.guardians;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.state <> 'PENDING' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to approve this request.' using errcode = '42501';
  end if;

  select * into v_player from public.players where id = m.player_id;

  if m.dispensation_id is not null and not internal.dispensation_is_approved(m.dispensation_id) then
    raise exception 'This request waits for a dispensation decision before the team can approve it.' using errcode = '23514';
  end if;

  if m.source = 'TEAM_CODE' then
    if coalesce(m.guardian_confirmation, '') = 'AWAITING' then
      raise exception 'A parent or guardian has to confirm this request before the team can approve it.' using errcode = '23514';
    end if;
    if auth.uid() = v_player.user_id or auth.uid() = m.created_by
       or exists (select 1 from public.guardians g
                   where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state in ('ACTIVE', 'PENDING_APPROVAL')) then
      raise exception 'You can''t approve a request for yourself or your own child. Another approver at the club will.' using errcode = '42501';
    end if;

    perform internal.lock_club_people(v_club_id);

    -- The parent who asked for a child they added becomes that child's guardian on this approval.
    select * into v_guardian from public.guardians g
     where g.player_id = m.player_id and g.guardian_user_id = m.created_by and g.state = 'PENDING_APPROVAL' and g.source = 'TEAM_CODE'
     for update;
    if v_guardian.id is not null then
      update public.guardians
         set state = 'ACTIVE', status = 'active', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
       where id = v_guardian.id;
      perform internal.emit_security_event('guardian.link_approved', m.created_by, 'SUCCESS', null,
        jsonb_build_object('relationship_id', v_guardian.id, 'source', 'TEAM_CODE', 'team_membership_id', m.id),
        v_club_id, m.team_id, m.player_id);
    end if;

    -- An adult player, on their own account, joins the club.
    if v_player.user_id is not null and internal.person_is_established_adult(v_player.user_id) then
      perform internal.admit_club_member(v_club_id, v_player.user_id, 'TEAM_CODE',
        'team place approved ' || m.id::text, m.source_invitation_id, null);
    end if;
    -- The parent who asked joins the club too.
    if m.created_by is not null and m.created_by is distinct from v_player.user_id
       and exists (select 1 from public.guardians g
                    where g.player_id = m.player_id and g.guardian_user_id = m.created_by and g.state = 'ACTIVE') then
      perform internal.admit_club_member(v_club_id, m.created_by, 'TEAM_CODE',
        'team place approved ' || m.id::text, m.source_invitation_id, null);
    end if;
  end if;

  update public.player_team_memberships
  set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
  where id = p_membership_id;

  v_player_first_name := v_player.first_name;

  -- EVERY legitimate recipient, not the earliest-created guardian. One parent
  -- being told and the other not was never a decision anybody made -- it was
  -- an `order by created_at asc limit 1` nobody revisited.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_approved', 'Team join confirmed',
         case when e.relationship = 'self'
              then 'You have been confirmed onto the team.'
              else v_player_first_name || ' has been confirmed onto the team.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$function$;

create or replace function public.team_people(p_team_id uuid)
 returns table(kind text, row_id uuid, person_id uuid, name text, detail text, status text, requested_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_may_view boolean;
begin
  select a.may_view into v_may_view from internal.team_people_authority(p_team_id) a;
  if not coalesce(v_may_view, false) then
    raise exception 'Not authorized to view this team''s people.' using errcode = '42501';
  end if;

  return query
  -- COACHES. Everyone holding a permission on this team, described by the
  -- permission they hold. Their standing is their club membership's: someone
  -- suspended at the club is not an active coach of one of its teams.
  select
    'coach'::text,
    tp.id,
    cm.user_id,
    coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
    coalesce(internal.team_role_label(tp.role_key), 'Parent or player access'),
    case when cm.status = 'active' then 'active' else 'archived' end,
    null::timestamptz
  from internal.team_role_assignments tp
  join public.club_memberships cm on cm.id = tp.membership_id
  left join public.profiles pr on pr.id = cm.user_id
  where tp.team_id = p_team_id

  union all

  -- PLAYERS. Their place in THIS team, not their existence at the club: a
  -- player archived here may be perfectly active in another side. A request
  -- still waiting for a parent to confirm it is not the team's yet.
  select
    'player'::text,
    ptm.id,
    pl.id,
    coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'Unknown'),
    null::text,
    case ptm.status when 'active' then 'active' when 'pending' then 'requested' else 'archived' end,
    case when ptm.status = 'pending' then ptm.created_at end
  from public.player_team_memberships ptm
  join public.players pl on pl.id = ptm.player_id
  where ptm.team_id = p_team_id
    and not (ptm.state = 'PENDING' and (coalesce(ptm.guardian_confirmation, '') = 'AWAITING'
                                        or (ptm.dispensation_id is not null and not internal.dispensation_is_approved(ptm.dispensation_id))))

  union all

  -- PARENTS AND GUARDIANS. Reached through the players in this team, which is
  -- the only relationship a team has to them, and de-duplicated: one adult
  -- with two children in the same side is one person on this list.
  select * from (
    select distinct on (g.guardian_user_id)
      'guardian'::text,
      g.id,
      g.guardian_user_id,
      coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
      'Parent or guardian of ' || coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'a player'),
      case when g.status = 'active' then 'active' else 'archived' end,
      null::timestamptz
    from public.guardians g
    join public.players pl on pl.id = g.player_id
    join public.player_team_memberships ptm
      on ptm.player_id = g.player_id and ptm.team_id = p_team_id and ptm.status = 'active'
    left join public.profiles pr on pr.id = g.guardian_user_id
    -- DISTINCT ON needs its own ORDER BY, and it cannot live at the end of a
    -- UNION -- the aliases are out of scope there. An active link wins over an
    -- ended one for the same adult.
    order by g.guardian_user_id, g.status
  ) guardians;
end;
$function$;

drop policy player_team_memberships_select on public.player_team_memberships;
create policy player_team_memberships_select on public.player_team_memberships for select
using (
  (internal.can('team.roster.view'::text, 'team'::text,
                (select t.club_id from public.teams t where t.id = player_team_memberships.team_id),
                team_id, null::uuid)
   and coalesce(guardian_confirmation, '') <> 'AWAITING'
   and (dispensation_id is null or state <> 'PENDING' or internal.dispensation_is_approved(dispensation_id)))
  or internal.is_own_linked_player(player_id)
  or internal.is_active_player_guardian(player_id)
);

create or replace function public.team_place_requests(p_team_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null or not (internal.has_capability('team.roster.manage', 'team', v_club, p_team_id)
                            or internal.has_capability('club.roster.manage', 'club', v_club, null)) then
    raise exception 'Not authorized to review this team''s requests.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'team', (select jsonb_build_object('id', t.id, 'label', t.display_name, 'club_name', d.name,
                                       'adult_side', internal.team_is_adult_side(t.id), 'age_group', t.age_group,
                                       'gender', ctt.gender)
               from public.teams t
               left join public.clubs c on c.id = t.club_id
               left join public.club_directory d on d.id = c.directory_id
               left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
              where t.id = p_team_id),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'membership_id', m.id,
               'player_id', p.id,
               'first_name', p.first_name,
               'surname', p.surname,
               'date_of_birth', p.date_of_birth,
               'fit', internal.team_code_fit(m.team_id, p.date_of_birth, p.playing_pathway),
               'source', m.source,
               'requested_at', m.created_at,
               'asked_by', case when m.source <> 'TEAM_CODE' then 'CLUB'
                                when m.created_by = p.user_id then 'OWN_ACCOUNT'
                                else 'PARENT' end,
               'requester_name', nullif(btrim(concat_ws(' ', rq.first_name, rq.surname)), ''),
               'confirmed_by_name', nullif(btrim(concat_ws(' ', cf.first_name, cf.surname)), ''),
               'confirms_guardian', exists (select 1 from public.guardians g
                                             where g.player_id = p.id and g.guardian_user_id = m.created_by
                                               and g.state = 'PENDING_APPROVAL' and g.source = 'TEAM_CODE'),
               'admits_members', case when m.source <> 'TEAM_CODE' then '[]'::jsonb else coalesce((
                 select jsonb_agg(x.name order by x.ord) from (
                   select 1 as ord, nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), '') as name
                     from public.profiles pr
                    where pr.id = p.user_id and internal.person_is_established_adult(p.user_id)
                      and not exists (select 1 from public.club_memberships cm
                                       where cm.club_id = v_club and cm.user_id = p.user_id and cm.state = 'ACTIVE')
                   union all
                   select 2, nullif(btrim(concat_ws(' ', rq.first_name, rq.surname)), '')
                    where m.created_by is distinct from p.user_id
                      and not exists (select 1 from public.club_memberships cm
                                       where cm.club_id = v_club and cm.user_id = m.created_by and cm.state = 'ACTIVE')
                 ) x where x.name is not null), '[]'::jsonb) end,
               -- An exception to the age grade, already decided by the Safeguarding Officer or a Club Admin.
               'dispensation', (select jsonb_build_object('decided_by_name', internal.person_display_name(d.decided_by),
                                                          'decided_as', d.decided_as, 'decided_at', d.decided_at,
                                                          'governing_body', d.governing_body_reference is not null)
                                  from public.player_team_dispensation d where d.id = m.dispensation_id and d.status = 'approved'),
               'decided_by_others', coalesce(auth.uid() = p.user_id, false) or coalesce(auth.uid() = m.created_by, false)
                                    or exists (select 1 from public.guardians g
                                                where g.player_id = p.id and g.guardian_user_id = auth.uid()
                                                  and g.state in ('ACTIVE', 'PENDING_APPROVAL')))
             order by m.created_at)
        from public.player_team_memberships m
        join public.players p on p.id = m.player_id
        left join public.profiles rq on rq.id = m.created_by
        left join public.profiles cf on cf.id = m.guardian_confirmed_by
       where m.team_id = p_team_id and m.state = 'PENDING'
         and coalesce(m.guardian_confirmation, '') <> 'AWAITING'
         and (m.dispensation_id is null or internal.dispensation_is_approved(m.dispensation_id))), '[]'::jsonb),
    'awaiting_guardian', (select count(*) from public.player_team_memberships m
                           where m.team_id = p_team_id and m.state = 'PENDING' and m.guardian_confirmation = 'AWAITING'),
    -- Counted, never described: a request waiting on a dispensation decision is not the team's yet.
    'awaiting_dispensation', (select count(*) from public.player_team_memberships m
                               where m.team_id = p_team_id and m.state = 'PENDING'
                                 and coalesce(m.guardian_confirmation, '') <> 'AWAITING'
                                 and m.dispensation_id is not null and not internal.dispensation_is_approved(m.dispensation_id)));
end;
$function$;

create or replace function public.my_team_requests()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'membership_id', m.id,
             'first_name', p.first_name,
             'for_self', p.user_id is not distinct from auth.uid(),
             'team_label', t.display_name,
             'club_name', d.name,
             'awaiting_guardian', m.guardian_confirmation = 'AWAITING',
             'awaiting_dispensation', m.dispensation_id is not null and not internal.dispensation_is_approved(m.dispensation_id),
             'dispensation_id', m.dispensation_id,
             'requested_at', m.created_at)
           order by m.created_at)
      from public.player_team_memberships m
      join public.players p on p.id = m.player_id
      join public.teams t on t.id = m.team_id
      left join public.clubs c on c.id = t.club_id
      left join public.club_directory d on d.id = c.directory_id
     where m.state = 'PENDING' and m.source = 'TEAM_CODE' and m.created_by = auth.uid()), '[]'::jsonb);
end;
$function$;

-- A parent's confirmation never tells the team early.
create or replace function public.confirm_team_place_request(p_membership_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m public.player_team_memberships;
  v_club uuid;
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  -- The same answer for "no such request" and "not your child's", so ids cannot be probed.
  if m.id is null or not exists (select 1 from public.guardians g
                                  where g.player_id = m.player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if m.state <> 'PENDING' or coalesce(m.guardian_confirmation, '') <> 'AWAITING' then
    raise exception 'This request has already been answered.' using errcode = '23514';
  end if;

  update public.player_team_memberships
     set guardian_confirmation = 'CONFIRMED', guardian_confirmed_by = auth.uid(), guardian_confirmed_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = m.id;

  select club_id into v_club from public.teams where id = m.team_id;
  perform internal.emit_security_event('player_team.guardian_confirmed', auth.uid(), 'SUCCESS', null,
    jsonb_build_object('team_membership_id', m.id), v_club, m.team_id, m.player_id);
  -- The team is told only once nothing else is in the way: a request that also waits on a dispensation
  -- reaches the team's staff when that is approved (decide_dispensation), never before.
  if m.dispensation_id is null or internal.dispensation_is_approved(m.dispensation_id) then
    perform internal.notify_team_place_approvers(m.id);
  end if;
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 12. REGISTRIES
-- -----------------------------------------------------------------------------------------------------
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('dispensation.requested', 'MEMBERSHIP', 'INFO', true, false, true),
       ('dispensation.approved', 'MEMBERSHIP', 'INFO', true, false, false),
       ('dispensation.declined', 'MEMBERSHIP', 'INFO', true, false, true),
       ('dispensation.withdrawn', 'MEMBERSHIP', 'INFO', true, false, false),
       ('dispensation.revoked', 'MEMBERSHIP', 'INFO', true, false, true),
       ('dispensation.governing_body_recorded', 'MEMBERSHIP', 'INFO', true, false, false);
