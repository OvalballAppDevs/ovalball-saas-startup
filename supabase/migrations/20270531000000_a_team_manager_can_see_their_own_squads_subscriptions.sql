-- TEAM OPERATIONS -- BOUNDED TEAM-SCOPED SUBSCRIPTION VISIBILITY.
--
-- THE PROBLEM THIS SOLVES. Every finance capability in this product is club-scoped, so the team
-- subscription surface built in the previous pass was real, correct and invisible to the person it was
-- for: a Team Manager could not answer "is anybody in my squad not set up" without club finance
-- authority, which is a much larger thing to hold. The feature existed and did not do its job.
--
-- ONE CAPABILITY, TWO SCOPES -- NOT A SECOND KEY.
--
-- `finance.subscription.view` is extended to `team`, rather than a new `*.view_team` key being invented
-- beside it. That is how this engine already expresses "the same question, a smaller boundary":
-- calendar.view, club.view, competition.match.respond and a dozen others are `club,team` for exactly
-- this reason. The SCOPE is the boundary, and it is enforced by internal.capability_decision rather
-- than by anything a caller remembers to do:
--
--   held at CLUB  -> /club/finance, the whole club's ledger, exports, payment actions
--   held at TEAM  -> operational subscription STATE for players of that one team, and nothing else
--
-- /club/finance asks for it at club scope and therefore still refuses a team holder, without that page
-- being changed at all. A second key would have needed every consumer to remember which one to ask
-- for, and the first consumer to forget would have been the bug.
--
-- WHAT THE TEAM SCOPE DELIBERATELY DOES NOT CARRY. The other finance capabilities are untouched and
-- remain club-only: finance.payment.act, finance.enrolment.manage, finance.subscription.export,
-- finance.subscription.configure, finance.gocardless.connect. Seeing that a player is not set up is a
-- different act from taking money, changing what is owed, or exporting the club's ledger.

begin;

update public.capabilities
   set valid_scopes = array['club', 'team'],
       description = coalesce(description, '') ||
         case when coalesce(description, '') = '' then '' else ' ' end ||
         'At CLUB scope this is the club''s finance surface. At TEAM scope it is operational ' ||
         'subscription state for players of that team only -- no ledger, no export, no payment actions.'
 where key = 'finance.subscription.view';

-- THE TEAM MANAGER'S BUNDLE, because this is the job that role exists to do.
--
-- Not every coach: a coach is there to coach, and chasing subscriptions is not part of it. A Club
-- Admin can still grant it to anybody else through the ordinary delegation path, because the
-- capability is already `delegable` and its grant level is club.
-- Into `bundle_capabilities`, which is the table. `role_capability_defaults` is a VIEW over it that
-- maps TEAM_MANAGER to the 'TM' bundle, and a view containing DISTINCT is not insertable -- writing to
-- the projection rather than the source is how a second permission system starts.
insert into public.bundle_capabilities (bundle_key, capability_key, scope_type)
values ('TM', 'finance.subscription.view', 'team')
on conflict do nothing;

-- -----------------------------------------------------------------------------------------------------
-- SELF-CHECK.
-- -----------------------------------------------------------------------------------------------------
do $guard$
declare v_scopes text[];
begin
  select valid_scopes into v_scopes from public.capabilities where key = 'finance.subscription.view';
  if not ('team' = any(v_scopes)) then
    raise exception 'finance.subscription.view did not gain team scope';
  end if;
  if not ('club' = any(v_scopes)) then
    raise exception 'finance.subscription.view LOST club scope -- the club finance surface depends on it';
  end if;

  -- The bounded scope has to stay bounded: acting on money, changing what is owed and exporting the
  -- ledger are club jobs and must not have followed it down.
  if exists (
    select 1 from public.capabilities
     where key in ('finance.payment.act', 'finance.enrolment.manage', 'finance.subscription.export',
                   'finance.subscription.configure', 'finance.gocardless.connect')
       and 'team' = any(valid_scopes)
  ) then
    raise exception 'a finance capability other than subscription.view gained team scope';
  end if;

  -- Asserted against bundle_capabilities, which is where the grant actually lives.
  -- `role_capability_defaults` is a legacy VIEW that only lists capabilities carrying a
  -- capability_key_map row, and finance.subscription.view has never had one -- so checking there would
  -- have reported a correct grant as missing.
  if not exists (
    select 1 from public.bundle_capabilities
     where bundle_key = 'TM' and capability_key = 'finance.subscription.view' and scope_type = 'team'
  ) then
    raise exception 'the team manager bundle did not gain the capability';
  end if;

  raise notice 'Team Operations: a team manager may now see their own squad''s subscription state.';
end $guard$;

commit;
