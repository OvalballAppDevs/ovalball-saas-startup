-- A TEAM READS ITS SQUAD'S SUBSCRIPTION STATE (CA-M7 Team Operations).
--
-- THE PROBLEM THIS SOLVES. Migration 20270531 gave `finance.subscription.view` a TEAM scope and put it
-- in the Team Manager's bundle, with the sentence: "held at TEAM -> operational subscription STATE for
-- players of that one team, and nothing else". The website's team page honours the capability at its
-- door and then reads `membership_obligations` and `player_subscription_payers` directly -- and those
-- tables' row policies still admit the capability at CLUB scope only. So a Team Manager who holds
-- exactly the authority the migration described walks through the door and is shown an empty room:
-- "No players in this team yet". Nothing errors. The answer is simply wrong.
--
-- WHAT THIS DOES, AND WHAT IT DOES NOT. It adds ONE read operation that enforces the sentence 20270531
-- already wrote. It does not widen any row policy: the tables stay readable at club scope only, so no
-- team holder gains the club's ledger, exports or payment actions by any route. It does not add a
-- capability, a scope or a bundle row. It returns operational state -- who is set up, who is due, who
-- failed, who owes nothing -- and NOTHING from the provider: no mandate, no customer, no payment id, no
-- payer identity, no sibling arithmetic. The columns below are the whole of what a team may know.
--
-- AUTHORITY. `finance.subscription.view` at this team (inherits from the club), or at the club. A person
-- with neither is refused with 42501 -- never handed an empty list, which would be indistinguishable
-- from a squad that owes nothing. A team from another club, or a sibling team the person does not hold
-- the capability for, is refused the same way; the suite proves both.

create or replace function public.team_subscription_status(p_team_id uuid)
returns table (
  player_id uuid,
  first_name text,
  surname text,
  billing_period date,
  obligation_status text,
  amount_due_minor integer,
  currency text,
  has_payer boolean,
  programme_exists boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_period date := date_trunc('month', current_date)::date;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;

  if not (internal.can('finance.subscription.view', 'team', v_club, p_team_id, null)
          or internal.can('finance.subscription.view', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to see this team''s subscription state.' using errcode = '42501';
  end if;

  return query
  select
    ptm.player_id,
    pl.first_name,
    pl.surname,
    v_period,
    mo.status,
    mo.amount_due_minor,
    mo.currency,
    exists (
      select 1 from public.player_subscription_payers psp
      where psp.player_id = ptm.player_id and psp.status = 'active'
    ),
    exists (
      select 1 from public.club_subscription_programmes p
      where p.club_id = v_club and p.enabled
    )
  from public.player_team_memberships ptm
  join public.players pl on pl.id = ptm.player_id
  left join public.membership_obligations mo
    on mo.player_id = ptm.player_id
   and mo.club_id = v_club
   and mo.billing_period = v_period
  where ptm.team_id = p_team_id
    and ptm.status = 'active'
  order by pl.surname, pl.first_name;
end;
$$;

revoke all on function public.team_subscription_status(uuid) from public;
grant execute on function public.team_subscription_status(uuid) to authenticated;

comment on function public.team_subscription_status(uuid) is
  'Operational subscription state for the active players of one team: obligation status this period, amount due, whether a payer exists. Requires finance.subscription.view at the team or its club. Never returns provider, mandate, payment or payer identity.';

do $$
declare v_src text;
begin
  select pg_get_functiondef('public.team_subscription_status(uuid)'::regprocedure) into v_src;
  if v_src !~ 'finance\.subscription\.view' then
    raise exception 'team_subscription_status must ask finance.subscription.view';
  end if;
  if v_src ~ 'gocardless_' or v_src ~ 'payer_user_id' or v_src ~ 'gc_' then
    raise exception 'team_subscription_status must not reach a provider table or a payer identity';
  end if;
  if exists (
    select 1 from public.capabilities
    where key like 'finance.%' and key <> 'finance.subscription.view' and key <> 'finance.payer.self'
      and 'team' = any(valid_scopes)
  ) then
    raise exception 'no finance capability other than subscription.view may hold team scope';
  end if;
  raise notice 'Team Operations: a team reads its squad''s subscription state through one operation.';
end $$;
