-- =====================================================================================================
-- CLUB MEMBERSHIPS, PART 2 -- RUNNING THEM: ONE STANDING, EVERY VIEW, LEAST PRIVILEGE
--
-- The operational half of Club Memberships (owner's programme, Part 2): the club's board, the team's board, a
-- member's detail, reminders and their history, and changing who pays. Everything here reads the ONE standing
-- (internal.membership_standing) and adds only what a view needs; nothing re-derives paid/due/overdue.
--
--   1. THE STANDING KNOWS THE MEMBERSHIP AND WHETHER COLLECTING HAS STARTED. A Direct Debit in place whose
--      membership the payer never started (no GoCardless subscription) read "Collecting -- the Direct Debit will
--      collect this month" while nothing would ever be collected, and the family was given no task. It now reads
--      Due (or Overdue) with the reason NOT_STARTED, is remindable, and the reminder says what to do.
--   2. THE TEAM'S BOARD CARRIES NO MONEY (decision #2, DERIVED from the owner's least-privilege test): standing,
--      reason, membership name and reminder state only. A paused club's existing members still show -- pausing
--      stops new memberships, not the Direct Debits already running.
--   3. THE CLUB'S BOARD names each player's membership, lists the club's memberships with their prices and members,
--      and its money is honest: Collected counts what GoCardless has confirmed for the month's memberships, less
--      CONFIRMED refunds only (a refund still pending at GoCardless has not been given back), and says Ovalball's
--      fee earned and what reaches the club before GoCardless's own fee.
--   4. ONE MEMBER, ONE READ (club_member_membership): standing, membership, payer, guardians the club may ask,
--      Direct Debit words, payment history with Ovalball's fee per month, reminders -- for a player with or
--      without a membership.
--   5. REMINDER HISTORY (membership_reminder_history): who was reminded, when, by whom and why. A team's staff see
--      only their own team's players and never who was told.
--   6. CHANGING WHO PAYS (decision #11, DERIVED): release_responsible_payer ends a membership that has no live
--      GoCardless collection, so another guardian can take it on; one with a live collection is refused with the
--      way forward (cancel the Direct Debit membership first). Never two collections; history kept.
--   7. A FAMILY STILL SEES A PAUSED CLUB'S MEMBERSHIP -- and a reader who does not pay (a second guardian, the player)
--      learns only that it is set up and which membership, never the payer's figures or how their Direct Debit is doing.
--   8. THE REMINDER PREVIEW (membership_reminder_preview): before anybody presses Send, how many families would be
--      asked, who would be left out and why, and the exact words -- from the one composer the sending uses.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. THE ONE STANDING, WITH THE MEMBERSHIP AND WHETHER COLLECTING HAS STARTED
--    The result gains three columns, so the function is replaced, not redefined. Its callers are plpgsql bodies
--    that read it by name (select * ... into a record), so they keep working and are redefined below anyway.
-- ---------------------------------------------------------------------------------------------------------------
drop function if exists internal.membership_standing(uuid, date);
create function internal.membership_standing(p_club_id uuid, p_as_of date default current_date)
 returns table(
   player_id uuid, first_name text, surname text, player_user_id uuid,
   team_ids uuid[], has_place boolean,
   programme_id uuid, payer_subscription_id uuid, payer_user_id uuid, relationship text, enrolment_status text,
   monthly_amount_minor integer,
   billing_period date, obligation_id uuid, obligation_status text, amount_due_minor integer, due_date date,
   mandate_status text, subscription_status text, next_collection_date date,
   standing text, reason text,
   last_reminded_at timestamptz, last_reminded_by uuid,
   product_id uuid, product_name text, collection_started boolean
 )
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with prog as (
    select p.id, p.collection_day, p.enabled
      from public.club_subscription_programmes p
     where p.club_id = p_club_id and (p.enabled or p.activated_at is not null)
  ),
  period as (select date_trunc('month', coalesce(p_as_of, current_date))::date as m, coalesce(p_as_of, current_date) as today),
  placed as (
    select ptm.player_id, array_agg(distinct ptm.team_id) as team_ids
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
      join public.membership_product_teams mpt on mpt.team_id = ptm.team_id
      join public.membership_products mp on mp.id = mpt.product_id and mp.status = 'active'
     where ptm.state = 'ACTIVE'
     group by ptm.player_id
  ),
  enrolled as (
    -- The active enrolment, or (when there is none) the most recent one, so an ended membership can show.
    select distinct on (psp.player_id) psp.*
      from public.player_subscription_payers psp
      join prog on prog.id = psp.programme_id
     order by psp.player_id, (psp.status = 'active') desc, psp.created_at desc
  ),
  population as (
    select pl.player_id from placed pl where exists (select 1 from prog where prog.enabled)
    union
    select e.player_id from enrolled e
     where e.status = 'active'
        or (e.status = 'ended' and coalesce(e.ended_at, e.created_at) > coalesce(p_as_of, current_date) - interval '12 months')
  ),
  facts as (
    select pop.player_id,
           pl.first_name, pl.surname, pl.user_id as player_user_id,
           coalesce(placed.team_ids, array[]::uuid[]) as team_ids,
           placed.player_id is not null as has_place,
           prog.id as programme_id, coalesce(e.collection_day, prog.collection_day) as collection_day,
           e.id as payer_subscription_id, e.payer_user_id, e.relationship, e.status as enrolment_status,
           e.effective_from,
           coalesce(case when e.status = 'active' then e.product_id end,
                    internal.membership_product_for_player(p_club_id, pop.player_id, coalesce(p_as_of, current_date))) as product_id,
           o.id as obligation_id, o.status as obligation_status, o.amount_due_minor, o.due_date,
           greatest(o.due_date, coalesce(o.membership_effective_date, o.due_date), coalesce(e.effective_from, o.due_date)) as effective_due,
           md.status as mandate_status,
           gs.status as subscription_status,
           coalesce(gs.status, '') in ('pending', 'active') as collection_started,
           (e.relationship = 'guardian' and not exists (
              select 1 from public.guardians g
               where g.player_id = pop.player_id and g.guardian_user_id = e.payer_user_id and g.status = 'active')) as payer_not_guardian,
           e.final_amount_minor, period.m, period.today
      from population pop
      cross join prog
      cross join period
      join public.players pl on pl.id = pop.player_id
      left join placed on placed.player_id = pop.player_id
      left join enrolled e on e.player_id = pop.player_id
      -- The month's obligation is the CURRENT payer's. One obligation exists per player per month, so after a
      -- payer change (section 8) this month's may belong to the payer who left: it is history, not something the
      -- new payer owes -- their first month is the one their own set-up collects.
      left join public.membership_obligations o
        on o.player_id = pop.player_id and o.programme_id = prog.id and o.billing_period = period.m
       and (e.status is distinct from 'active' or o.payer_subscription_id = e.id)
      left join lateral (
        select m.status from public.gocardless_mandates m
          join public.gocardless_billing_requests br on br.id = m.billing_request_id
         where br.payer_subscription_id = e.id
         order by m.created_at desc limit 1
      ) md on true
      left join lateral (
        select s.status from public.gocardless_subscriptions s
         where s.payer_subscription_id = e.id
         order by s.created_at desc limit 1
      ) gs on true
  ),
  priced as (
    select f.*,
           coalesce(case when f.enrolment_status = 'active' then f.final_amount_minor end,
                    (select x.amount_minor from internal.membership_product_price(f.product_id, f.today) x)) as monthly_amount_minor,
           (select mp.name from public.membership_products mp where mp.id = f.product_id) as product_name,
           f.mandate_status in ('active', 'pending_submission', 'submitted') as usable_mandate
      from facts f
  ),
  judged as (
    select f.*,
      case
        when f.enrolment_status = 'active' and not f.has_place then 'ACTION_NEEDED'
        when f.enrolment_status = 'active' and f.payer_not_guardian then 'ACTION_NEEDED'
        when coalesce(f.enrolment_status, 'ended') <> 'active' then case when f.has_place then 'NOT_SET_UP' else 'ENDED' end
        when f.obligation_status in ('FAILED', 'CHARGEDBACK', 'CANCELLED') then 'ACTION_NEEDED'
        when f.mandate_status in ('failed', 'cancelled', 'expired', 'suspended_by_payer', 'blocked')
             and coalesce(f.obligation_status, '') not in ('PAID', 'EXEMPT', 'WAIVED', 'REFUNDED') then 'ACTION_NEEDED'
        when f.obligation_status = 'PAID' then 'UP_TO_DATE'
        when f.obligation_status in ('EXEMPT', 'WAIVED', 'REFUNDED') then 'EXEMPT'
        when f.obligation_status in ('SUBMITTED', 'RETRYING') then 'COLLECTING'
        when f.obligation_status is not null and f.today > f.effective_due + 5 then 'OVERDUE'
        -- A Direct Debit in place, but the membership never started: nothing will be collected until the payer
        -- starts it. That is the payer's to do, so it is Due -- never "Collecting".
        when f.usable_mandate and not f.collection_started then 'DUE'
        when f.usable_mandate then 'COLLECTING'
        else 'DUE'
      end as standing,
      case
        when f.enrolment_status = 'active' and not f.has_place then 'LEFT_THE_TEAM'
        when f.enrolment_status = 'active' and f.payer_not_guardian then 'PAYER_NOT_GUARDIAN'
        when coalesce(f.enrolment_status, 'ended') <> 'active' then case when f.has_place then 'NO_PAYER' else 'ENDED' end
        when f.obligation_status = 'FAILED' then 'PAYMENT_FAILED'
        when f.obligation_status = 'CHARGEDBACK' then 'CHARGED_BACK'
        when f.obligation_status = 'CANCELLED' then 'PAYMENT_CANCELLED'
        when f.mandate_status in ('failed', 'cancelled', 'expired', 'suspended_by_payer', 'blocked')
             and coalesce(f.obligation_status, '') not in ('PAID', 'EXEMPT', 'WAIVED', 'REFUNDED') then 'MANDATE_PROBLEM'
        when f.obligation_status = 'PAID' then 'PAID'
        when f.obligation_status = 'EXEMPT' and coalesce(f.amount_due_minor, 0) = 0 then 'NOTHING_TO_PAY'
        when f.obligation_status in ('EXEMPT', 'WAIVED', 'REFUNDED') then f.obligation_status
        when f.obligation_status = 'SUBMITTED' then 'WITH_THE_BANK'
        when f.obligation_status = 'RETRYING' then 'RETRYING'
        when f.obligation_status is not null and f.today > f.effective_due + 5 then
          case when f.usable_mandate and not f.collection_started then 'NOT_STARTED'
               when f.usable_mandate then 'NOT_COLLECTED'
               else 'SETUP_UNFINISHED' end
        when f.usable_mandate and not f.collection_started then 'NOT_STARTED'
        when f.usable_mandate then 'SCHEDULED'
        else 'SETUP_UNFINISHED'
      end as reason
    from priced f
  )
  select j.player_id, j.first_name, j.surname, j.player_user_id,
         j.team_ids, j.has_place,
         j.programme_id, j.payer_subscription_id, j.payer_user_id, j.relationship, j.enrolment_status,
         j.monthly_amount_minor,
         j.m, j.obligation_id, j.obligation_status, j.amount_due_minor, j.due_date,
         j.mandate_status, j.subscription_status,
         case when j.enrolment_status = 'active' and j.subscription_status = 'active' then
           case when make_date(extract(year from j.today)::int, extract(month from j.today)::int, j.collection_day) >= j.today
                then make_date(extract(year from j.today)::int, extract(month from j.today)::int, j.collection_day)
                else (make_date(extract(year from j.today)::int, extract(month from j.today)::int, j.collection_day) + interval '1 month')::date end
         end,
         j.standing, j.reason,
         r.created_at, r.actor_user_id,
         j.product_id, j.product_name, j.collection_started
    from judged j
    left join lateral (
      select fal.created_at, fal.actor_user_id from public.finance_audit_log fal
       where fal.club_id = p_club_id and fal.action = 'membership_reminder_sent'
         and fal.target_table = 'players' and fal.target_id = j.player_id
       order by fal.created_at desc limit 1
    ) r on true;
$function$;

revoke all on function internal.membership_standing(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. THE CLUB'S BOARD: each player's membership, the club's memberships, and honest money
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.club_membership_board(p_club_id uuid, p_team_id uuid default null, p_as_of date default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_today date := coalesce(p_as_of, current_date);
  v_period date := date_trunc('month', coalesce(p_as_of, current_date))::date;
  v_prog public.club_subscription_programmes;
  v_price integer;
  v_rows jsonb;
  v_counts jsonb;
  v_money jsonb;
  v_memberships jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can('finance.subscription.view', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to see this club''s memberships.' using errcode = '42501';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    raise exception 'That team is not at this club.' using errcode = '42501';
  end if;

  select * into v_prog from public.club_subscription_programmes where club_id = p_club_id;

  -- THE CLUB'S MEMBERSHIPS: each with today's price, its teams and how many members hold it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mp.id, 'name', mp.name,
           'price_minor', (select x.amount_minor from internal.membership_product_price(mp.id, v_today) x),
           'teams', (select count(*) from public.membership_product_teams mpt join public.teams t on t.id = mpt.team_id
                      where mpt.product_id = mp.id and t.archived_at is null),
           'members', (select count(*) from public.player_subscription_payers psp where psp.product_id = mp.id and psp.status = 'active'))
           order by mp.sort_order, mp.created_at), '[]'::jsonb)
    into v_memberships
    from public.membership_products mp
   where mp.programme_id = v_prog.id and mp.status = 'active';

  -- One price is the club's price only when the club has one membership; with several there is no single answer.
  if jsonb_array_length(v_memberships) = 1 then
    v_price := (v_memberships -> 0 ->> 'price_minor')::int;
  end if;

  with s as (
    select * from internal.membership_standing(p_club_id, v_today) ms
     where p_team_id is null or p_team_id = any(ms.team_ids)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', s.player_id, 'first_name', s.first_name, 'surname', s.surname,
      'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'age_group', t.age_group) order by t.age_group, t.display_name), '[]'::jsonb)
                  from public.teams t where t.id = any(s.team_ids)),
      'membership', case when s.product_id is null then null else jsonb_build_object('id', s.product_id, 'name', s.product_name) end,
      'standing', s.standing, 'reason', s.reason,
      'payer', case when s.payer_user_id is null then null else jsonb_build_object(
                 'user_id', s.payer_user_id, 'relationship', s.relationship,
                 'name', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.payer_user_id)) end,
      'payer_subscription_id', s.payer_subscription_id,
      'monthly_amount_minor', s.monthly_amount_minor,
      'amount_due_minor', s.amount_due_minor, 'obligation_status', s.obligation_status, 'obligation_id', s.obligation_id,
      'due_date', s.due_date, 'mandate_status', s.mandate_status, 'next_collection_date', s.next_collection_date,
      'collection_started', s.collection_started,
      'last_reminded_at', s.last_reminded_at,
      'last_reminded_by', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.last_reminded_by),
      'can_remind', internal.membership_reminder_applies(s.standing, s.reason)
                    and (s.last_reminded_at is null or s.last_reminded_at < now() - interval '72 hours')
    ) order by
      case s.standing when 'ACTION_NEEDED' then 1 when 'OVERDUE' then 2 when 'NOT_SET_UP' then 3 when 'DUE' then 4
                      when 'COLLECTING' then 5 when 'UP_TO_DATE' then 6 when 'EXEMPT' then 7 else 8 end,
      s.surname, s.first_name), '[]'::jsonb),
    jsonb_build_object(
      'total', count(*) filter (where s.standing <> 'ENDED'),
      'up_to_date', count(*) filter (where s.standing = 'UP_TO_DATE'),
      'collecting', count(*) filter (where s.standing = 'COLLECTING'),
      'due', count(*) filter (where s.standing = 'DUE'),
      'overdue', count(*) filter (where s.standing = 'OVERDUE'),
      'action_needed', count(*) filter (where s.standing = 'ACTION_NEEDED'),
      'not_set_up', count(*) filter (where s.standing = 'NOT_SET_UP'),
      'exempt', count(*) filter (where s.standing = 'EXEMPT'),
      'ended', count(*) filter (where s.standing = 'ENDED'),
      'active_memberships', count(*) filter (where s.enrolment_status = 'active'),
      'direct_debit_in_place', count(*) filter (where s.enrolment_status = 'active' and s.mandate_status in ('active', 'pending_submission', 'submitted')))
    into v_rows, v_counts
  from s;

  -- THE MONTH'S MONEY (domain map section 6), for the month's memberships. Collected is a membership whose payment
  -- GoCardless has CONFIRMED (or paid out), less refunds GoCardless has CONFIRMED -- a refund still pending has not
  -- been given back. Ovalball's fee is what it earned on collected payments; what reaches the club is before
  -- GoCardless's own fee, which is only known from GoCardless's payouts and is never estimated here.
  with o as (
    select mo.* from public.membership_obligations mo
     where mo.club_id = p_club_id and mo.billing_period = v_period
       and (p_team_id is null or exists (select 1 from public.player_team_memberships ptm
                                          where ptm.player_id = mo.player_id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'))
  ),
  paid as (
    select o.id, o.amount_due_minor, o.platform_fee_minor, o.payer_fee_minor,
           coalesce((select sum(r.amount_minor) from public.payment_refunds r where r.payment_id = gp.id and r.status = 'confirmed'), 0) as refunded
      from o
      join public.gocardless_payments gp on gp.id = o.gocardless_payment_id
     where gp.status in ('confirmed', 'paid_out')
  ),
  -- Ovalball's fee by where it stands (internal.membership_fee_position): EARNED on a collected payment; UNRESOLVED
  -- on a refunded one, because GoCardless's documentation does not say whether its app fee is returned when a club
  -- refunds (research A4; decision #14 is the owner's). An unresolved fee is never counted as earned, and is
  -- still taken off what the club receives -- this view never overstates the club's money.
  fees as (
    select fp.fee_position, fp.fee_minor, o.payer_fee_minor
      from o
      cross join lateral internal.membership_fee_position(o.id) fp
  ),
  earned as (
    select coalesce(sum(fee_minor) filter (where fee_position = 'EARNED'), 0) as fee,
           coalesce(sum(payer_fee_minor) filter (where fee_position = 'EARNED'), 0) as members_fee,
           coalesce(sum(fee_minor) filter (where fee_position = 'UNRESOLVED'), 0) as unresolved_fee,
           coalesce(sum(payer_fee_minor) filter (where fee_position = 'UNRESOLVED'), 0) as unresolved_members_fee
      from fees
  )
  select jsonb_build_object(
    'period', v_period,
    'currency', coalesce(v_prog.currency, 'GBP'),
    'expected_minor', coalesce((select sum(amount_due_minor) from o where status not in ('CANCELLED', 'EXEMPT', 'WAIVED', 'REFUNDED')), 0),
    'collected_minor', coalesce((select sum(greatest(amount_due_minor - refunded, 0)) from paid), 0),
    'collecting_minor', coalesce((select sum(amount_due_minor) from o where status in ('SUBMITTED', 'RETRYING')), 0),
    'outstanding_minor', coalesce((select sum(amount_due_minor) from o where status in ('SETUP_PENDING', 'READY', 'SCHEDULED', 'OVERDUE', 'SUBMITTED', 'RETRYING', 'FAILED', 'CHARGEDBACK')), 0),
    'overdue_minor', coalesce((select sum(o.amount_due_minor) from o
                                 left join public.player_subscription_payers psp on psp.id = o.payer_subscription_id
                                where o.status in ('SETUP_PENDING', 'READY', 'SCHEDULED', 'OVERDUE')
                                  and v_today > greatest(o.due_date, coalesce(o.membership_effective_date, o.due_date), coalesce(psp.effective_from, o.due_date)) + 5), 0),
    'failed_minor', coalesce((select sum(amount_due_minor) from o where status in ('FAILED', 'CHARGEDBACK')), 0),
    'refunded_minor', coalesce((select sum(refunded) from paid), 0),
    'waived_minor', coalesce((select sum(amount_due_minor) from o where status in ('EXEMPT', 'WAIVED')), 0),
    'ovalball_fee_minor', (select fee from earned),
    'members_fee_minor', (select members_fee from earned),
    'fee_on_refunds_minor', (select unresolved_fee from earned),
    'club_receives_minor', greatest(coalesce((select sum(greatest(amount_due_minor - refunded, 0)) from paid), 0)
                                    - (select (fee - members_fee) + (unresolved_fee - unresolved_members_fee) from earned), 0),
    'next_collection_minor', coalesce((
       select sum(coalesce(psp.final_amount_minor, (select x.amount_minor from internal.membership_product_price(psp.product_id, v_today) x)))
         from public.player_subscription_payers psp
        where psp.programme_id = v_prog.id and psp.status = 'active'
          and (p_team_id is null or exists (select 1 from public.player_team_memberships ptm
                                             where ptm.player_id = psp.player_id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'))
          and exists (select 1 from public.gocardless_subscriptions gs where gs.payer_subscription_id = psp.id and gs.status = 'active')), 0)
  ) into v_money;

  return jsonb_build_object(
    'club_id', p_club_id,
    'team_id', p_team_id,
    'as_of', v_today,
    'programme', case when v_prog.id is null then null else jsonb_build_object(
      'id', v_prog.id, 'enabled', v_prog.enabled, 'activated_at', v_prog.activated_at, 'collection_day', v_prog.collection_day,
      'price_minor', v_price, 'currency', v_prog.currency,
      'fee_bearer', case v_prog.platform_fee_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end,
      -- Ovalball's rate on new memberships, from the one authority (never written into a screen).
      'fee_bps', case when internal.fee_mode_is_chosen(v_prog.platform_fee_mode) then internal.ovalball_fee_bps() else 0 end) end,
    'memberships', coalesce(v_memberships, '[]'::jsonb),
    'counts', coalesce(v_counts, '{}'::jsonb),
    'money', v_money,
    'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.club_membership_board(uuid, uuid, date) from public, anon;
grant execute on function public.club_membership_board(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. A TEAM'S BOARD: the same standing for the team's own players, and no money at all
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.team_membership_board(p_team_id uuid, p_as_of date default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
  v_team_name text;
  v_today date := coalesce(p_as_of, current_date);
  v_on boolean;
  v_taking boolean;
  v_rows jsonb;
  v_counts jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select t.club_id, t.display_name into v_club, v_team_name from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('finance.subscription.view', 'team', v_club, p_team_id, null)
          or internal.can('finance.subscription.view', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to see this team''s memberships.' using errcode = '42501';
  end if;

  -- A paused club still has members paying: its board still shows them.
  select coalesce(bool_or(p.enabled or p.activated_at is not null), false), coalesce(bool_or(p.enabled), false)
    into v_on, v_taking
    from public.club_subscription_programmes p where p.club_id = v_club;

  -- The team's own players only, and NO MONEY (decision #2): standing, reason, the membership's name, reminders.
  with s as (
    select * from internal.membership_standing(v_club, v_today) ms
     where p_team_id = any(ms.team_ids)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', s.player_id, 'first_name', s.first_name, 'surname', s.surname,
      'membership', case when s.product_id is null then null else jsonb_build_object('id', s.product_id, 'name', s.product_name) end,
      'standing', s.standing, 'reason', s.reason,
      'last_reminded_at', s.last_reminded_at,
      'last_reminded_by', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.last_reminded_by),
      'can_remind', internal.membership_reminder_applies(s.standing, s.reason)
                    and (s.last_reminded_at is null or s.last_reminded_at < now() - interval '72 hours')
    ) order by
      case s.standing when 'ACTION_NEEDED' then 1 when 'OVERDUE' then 2 when 'NOT_SET_UP' then 3 when 'DUE' then 4
                      when 'COLLECTING' then 5 when 'UP_TO_DATE' then 6 when 'EXEMPT' then 7 else 8 end,
      s.surname, s.first_name), '[]'::jsonb),
    jsonb_build_object(
      'total', count(*),
      'up_to_date', count(*) filter (where s.standing = 'UP_TO_DATE'),
      'collecting', count(*) filter (where s.standing = 'COLLECTING'),
      'due', count(*) filter (where s.standing = 'DUE'),
      'overdue', count(*) filter (where s.standing = 'OVERDUE'),
      'action_needed', count(*) filter (where s.standing = 'ACTION_NEEDED'),
      'not_set_up', count(*) filter (where s.standing = 'NOT_SET_UP'),
      'exempt', count(*) filter (where s.standing = 'EXEMPT'))
    into v_rows, v_counts
  from s;

  return jsonb_build_object(
    'team_id', p_team_id,
    'team_name', v_team_name,
    'club_id', v_club,
    'as_of', v_today,
    'programme_enabled', v_on,
    'taking_new_memberships', v_taking,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.team_membership_board(uuid, date) from public, anon;
grant execute on function public.team_membership_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. REMINDERS: unchanged authority and limits; a membership never started is asked to start, not to "finish
--    setting up" a Direct Debit that is already in place. The words come from ONE composer, which the preview
--    (section 9) also uses, so what the club is shown is exactly what the family receives. They name the player, the
--    club and the month -- never an amount, a payer or anything about another family.
-- ---------------------------------------------------------------------------------------------------------------
-- Which message a family gets, by what is theirs to do: the one branching rule, read by the composer below and by
-- the preview (section 9), so a preview can say how many families get each message.
create or replace function internal.membership_reminder_variant(p_standing text, p_reason text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_standing = 'NOT_SET_UP' then 'SET_UP'
    when p_reason = 'NOT_STARTED' then 'START'
    -- The Direct Debit is running and this month simply has not arrived: there is nothing to "finish setting up".
    when p_reason = 'NOT_COLLECTED' then 'NOT_COLLECTED'
    when p_standing = 'DUE' then 'DUE'
    when p_standing = 'OVERDUE' then 'OVERDUE'
    else 'ATTENTION'
  end;
$function$;

revoke all on function internal.membership_reminder_variant(text, text) from public, anon, authenticated;

create or replace function internal.membership_reminder_body(p_standing text, p_reason text, p_first_name text, p_club_name text, p_as_of date default current_date)
 returns text
 language sql
 stable
 set search_path to ''
as $function$
  select case internal.membership_reminder_variant(p_standing, p_reason)
    when 'SET_UP' then format('%s asks you to set up %s''s membership.', p_club_name, p_first_name)
    when 'START' then format('%s''s Direct Debit is in place, but the membership has not been started. Please start it so %s can collect it.', p_first_name, p_club_name)
    when 'NOT_COLLECTED' then format('%s''s membership for %s has not been collected yet. Please check your Direct Debit, or contact %s.', p_first_name, to_char(date_trunc('month', p_as_of), 'FMMonth'), p_club_name)
    when 'DUE' then format('%s''s membership for %s is due. Please finish setting up the Direct Debit.', p_first_name, to_char(date_trunc('month', p_as_of), 'FMMonth'))
    when 'OVERDUE' then format('%s''s membership for %s is overdue. Please finish setting up the Direct Debit, or contact %s.', p_first_name, to_char(date_trunc('month', p_as_of), 'FMMonth'), p_club_name)
    else format('%s''s membership payment needs your attention. Please check the Direct Debit, or contact %s.', p_first_name, p_club_name)
  end;
$function$;

revoke all on function internal.membership_reminder_body(text, text, text, text, date) from public, anon, authenticated;

create or replace function public.send_membership_reminders(p_club_id uuid, p_player_ids uuid[], p_team_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  v_club_scope boolean;
  v_club_name text;
  v_today_count integer;
  v_sent integer := 0;
  v_recipients integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_player uuid;
  s record;
  v_to uuid[];
  v_body text;
  v_n integer;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_player_ids is null or cardinality(p_player_ids) = 0 then
    raise exception 'Choose who to remind.' using errcode = '22023';
  end if;
  if cardinality(p_player_ids) > 50 then
    raise exception 'Remind up to 50 people at a time.' using errcode = '22023';
  end if;

  -- WHO MAY SEND. The club, for anybody at the club; a team's own staff, for players in that team only.
  v_club_scope := internal.can('finance.enrolment.manage', 'club', p_club_id, null, null);
  if p_team_id is not null then
    if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
      raise exception 'That team is not at this club.' using errcode = '42501';
    end if;
    if not (v_club_scope or internal.can('finance.subscription.view', 'team', p_club_id, p_team_id, null)) then
      raise exception 'You are not authorised to send membership reminders for this team.' using errcode = '42501';
    end if;
  elsif not v_club_scope then
    raise exception 'You are not authorised to send membership reminders for this club.' using errcode = '42501';
  end if;

  -- No more than 100 a day from one person, whoever they are.
  select count(*) into v_today_count from public.finance_audit_log
   where actor_user_id = v_actor and action = 'membership_reminder_sent' and created_at > now() - interval '24 hours';
  if v_today_count + cardinality(p_player_ids) > 100 then
    raise exception 'That is more reminders than one person can send in a day. Try again tomorrow.' using errcode = '54000';
  end if;

  select cd.name into v_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_club_id;

  foreach v_player in array (select array_agg(distinct x) from unnest(p_player_ids) x) loop
    select * into s from internal.membership_standing(p_club_id, current_date) ms where ms.player_id = v_player;
    if s.player_id is null then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOT_AT_CLUB');
      continue;
    end if;
    if p_team_id is not null and not (p_team_id = any(s.team_ids)) then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOT_IN_TEAM');
      continue;
    end if;
    if not internal.membership_reminder_applies(s.standing, s.reason) then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOTHING_TO_ASK');
      continue;
    end if;
    if s.last_reminded_at is not null and s.last_reminded_at > now() - interval '72 hours' then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'RECENTLY_REMINDED');
      continue;
    end if;

    -- WHO IS ASKED. The responsible payer when there is one -- the money relationship. Where nothing is set
    -- up yet, the people the one contact rule allows for this player, and of those only an adult: the
    -- player's guardians, or the player themselves only if they are 18 or over. Never a child.
    if s.payer_user_id is not null then
      v_to := array[s.payer_user_id];
    else
      select array_agg(distinct e.user_id) into v_to
        from internal.player_contact_eligibility(array[v_player]) e
       where e.outcome = 'ELIGIBLE' and (e.relationship = 'guardian' or (e.relationship = 'self' and e.is_adult));
    end if;
    if v_to is null or cardinality(v_to) = 0 then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOBODY_TO_ASK');
      continue;
    end if;

    v_body := internal.membership_reminder_body(s.standing, s.reason, s.first_name, v_club_name, current_date);

    insert into public.notifications (user_id, type, title, body, data)
    select r, 'membership_reminder', 'Membership reminder', v_body,
           jsonb_build_object('player_id', v_player, 'club_id', p_club_id, 'standing', s.standing, 'reason', s.reason,
                              'self', r = s.player_user_id, 'team_id', p_team_id)
      from unnest(v_to) r;
    get diagnostics v_n = row_count;

    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (v_actor, p_club_id, 'membership_reminder_sent', 'players', v_player, null,
            jsonb_build_object('standing', s.standing, 'reason', s.reason, 'recipients', cardinality(v_to),
                               'scope', case when p_team_id is null then 'club' else 'team' end, 'team_id', p_team_id),
            'admin_ui');
    v_sent := v_sent + 1;
    v_recipients := v_recipients + v_n;
  end loop;

  -- Counts and reasons only: who was told is never returned, so a team's staff learn nothing about payers.
  return jsonb_build_object('sent', v_sent, 'recipients', v_recipients, 'skipped', v_skipped);
end;
$function$;

revoke all on function public.send_membership_reminders(uuid, uuid[], uuid) from public, anon;
grant execute on function public.send_membership_reminders(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. A FAMILY STILL SEES A PAUSED CLUB'S MEMBERSHIP (pausing stops new memberships, not the Direct Debits running)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.family_membership_standing(p_player_id uuid, p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  s record;
  v_on boolean;
  v_taking boolean;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- THE FAMILY'S OWN AUTHORITY, unchanged from 20270747000000: an active guardian of this child, or the linked player
  -- themselves (a child included -- they may see that their own membership is in hand). Never a staff capability: a
  -- coach who is not the child's guardian reads nothing here.
  if not (internal.is_active_player_guardian(p_player_id) or internal.is_own_linked_player(p_player_id)) then
    raise exception 'You can only see the membership of your own family.' using errcode = '42501';
  end if;

  select coalesce(bool_or(p.enabled or p.activated_at is not null), false), coalesce(bool_or(p.enabled), false)
    into v_on, v_taking
    from public.club_subscription_programmes p where p.club_id = p_club_id;
  if not v_on then
    return jsonb_build_object('programme_enabled', false, 'taking_new_memberships', false);
  end if;

  select * into s from internal.membership_standing(p_club_id, current_date) ms where ms.player_id = p_player_id;
  if s.player_id is null then
    return jsonb_build_object('programme_enabled', true, 'taking_new_memberships', v_taking, 'standing', null);
  end if;

  -- SOMEBODY ELSE PAYS (DERIVED from the owner's rule "do not expose another guardian's private financial
  -- information", Part 2 section 31). The reader -- a second guardian, or the player -- learns that the membership is
  -- set up and which one, and nothing of the payer's: not the amount (a sibling discount is about the payer's other
  -- children), not whether their bank paid. The payer is the one reminded and the only one who can act.
  if s.enrolment_status = 'active' and s.payer_user_id is distinct from v_actor then
    return jsonb_build_object(
      'programme_enabled', true,
      'taking_new_memberships', v_taking,
      'standing', null,
      'reason', null,
      'membership', case when s.product_id is null then null else jsonb_build_object('id', s.product_id, 'name', s.product_name) end,
      'has_payer', true,
      'payer_is_you', false);
  end if;

  return jsonb_build_object(
    'programme_enabled', true,
    'taking_new_memberships', v_taking,
    'standing', s.standing,
    'reason', s.reason,
    'membership', case when s.product_id is null then null else jsonb_build_object('id', s.product_id, 'name', s.product_name) end,
    'amount_due_minor', s.amount_due_minor,
    'monthly_amount_minor', s.monthly_amount_minor,
    'next_collection_date', s.next_collection_date,
    'collection_started', s.collection_started,
    -- Only a membership somebody holds now has a payer; an ended one's former payer is history.
    'has_payer', s.enrolment_status = 'active',
    'payer_is_you', s.enrolment_status = 'active' and s.payer_user_id = v_actor);
end;
$function$;

revoke all on function public.family_membership_standing(uuid, uuid) from public, anon;
grant execute on function public.family_membership_standing(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. REMINDER HISTORY: who was reminded, when, by whom and why
--    The club's finance viewers see the club's history, with how many people were told. A team's staff (team-scope
--    view) see only reminders about players now in their own team, and never how many people were told or who.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.membership_reminder_history(p_club_id uuid, p_team_id uuid default null, p_limit integer default 100)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club boolean;
  v_rows jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  v_club := internal.can('finance.subscription.view', 'club', p_club_id, null, null);
  if p_team_id is not null then
    if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
      raise exception 'That team is not at this club.' using errcode = '42501';
    end if;
    if not (v_club or internal.can('finance.subscription.view', 'team', p_club_id, p_team_id, null)) then
      raise exception 'You are not authorised to see this team''s reminders.' using errcode = '42501';
    end if;
  elsif not v_club then
    raise exception 'You are not authorised to see this club''s reminders.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.sent_at desc), '[]'::jsonb) into v_rows
    from (
      select fal.created_at as sent_at,
             fal.target_id as player_id,
             pl.first_name, pl.surname,
             (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = fal.actor_user_id) as sent_by,
             fal.new_value ->> 'standing' as standing,
             fal.new_value ->> 'reason' as reason,
             coalesce(fal.new_value ->> 'scope', 'club') as scope,
             case when v_club then (fal.new_value ->> 'recipients')::int end as recipients
        from public.finance_audit_log fal
        join public.players pl on pl.id = fal.target_id
       where fal.club_id = p_club_id and fal.action = 'membership_reminder_sent' and fal.target_table = 'players'
         and (p_team_id is null or exists (select 1 from public.player_team_memberships ptm
                                            where ptm.player_id = fal.target_id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'))
       order by fal.created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) x;

  return jsonb_build_object('club_id', p_club_id, 'team_id', p_team_id, 'reminders', v_rows);
end;
$function$;

revoke all on function public.membership_reminder_history(uuid, uuid, integer) from public, anon;
grant execute on function public.membership_reminder_history(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. ONE MEMBER, ONE READ -- for the club's finance viewers, with or without a membership
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.club_member_membership(p_club_id uuid, p_player_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  s record;
  v_psp public.player_subscription_payers;
  v_prog public.club_subscription_programmes;
  v_player public.players;
  v_contact boolean;
  v_live boolean;
  v_mode text;
  v_bps integer;
  v_fee integer;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can('finance.subscription.view', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to see this club''s memberships.' using errcode = '42501';
  end if;
  v_contact := internal.can('people.member.view_contact', 'club', p_club_id, null, null);

  select * into s from internal.membership_standing(p_club_id, current_date) ms where ms.player_id = p_player_id;
  -- Nobody this club's memberships know about: no existence signal beyond "not found".
  if s.player_id is null then
    return null;
  end if;
  select * into v_player from public.players where id = p_player_id;
  select * into v_prog from public.club_subscription_programmes where club_id = p_club_id;
  if s.payer_subscription_id is not null then
    select * into v_psp from public.player_subscription_payers where id = s.payer_subscription_id;
  end if;
  -- WHAT THE DIRECT DEBIT COLLECTS A MONTH: a live membership's own snapshot (membership_charge_plan's rules -- a
  -- later settings or rate change never reaches an existing member); otherwise what it would be today.
  v_live := s.enrolment_status = 'active';
  v_mode := case when v_live then v_psp.platform_fee_mode else v_prog.platform_fee_mode end;
  v_bps := case when not internal.fee_mode_is_chosen(v_mode) then 0
                when v_live then coalesce(v_psp.platform_fee_bps, 0)
                else internal.ovalball_fee_bps() end;
  v_fee := case when s.monthly_amount_minor is null then null else internal.ovalball_fee_minor(s.monthly_amount_minor, v_bps) end;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'id', p_player_id, 'first_name', v_player.first_name, 'surname', v_player.surname,
      'is_adult', v_player.date_of_birth <= (current_date - interval '18 years')::date,
      'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) order by t.display_name), '[]'::jsonb)
                  from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
                 where ptm.player_id = p_player_id and ptm.state = 'ACTIVE' and t.club_id = p_club_id)),
    'standing', jsonb_build_object(
      'standing', s.standing, 'reason', s.reason,
      'amount_due_minor', s.amount_due_minor, 'next_collection_date', s.next_collection_date,
      'collection_started', s.collection_started,
      'last_reminded_at', s.last_reminded_at,
      'last_reminded_by', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.last_reminded_by),
      'can_remind', internal.membership_reminder_applies(s.standing, s.reason)
                    and (s.last_reminded_at is null or s.last_reminded_at < now() - interval '72 hours')),
    'membership', case when s.product_id is null then null else jsonb_build_object(
      'id', s.product_id, 'name', s.product_name,
      'monthly_amount_minor', s.monthly_amount_minor,
      'enrolment_status', s.enrolment_status,
      'payer_subscription_id', s.payer_subscription_id,
      'effective_from', v_psp.effective_from,
      'ended_at', v_psp.ended_at, 'end_reason', v_psp.end_reason,
      'collection_day', case when v_live then coalesce(v_psp.collection_day, v_prog.collection_day) else v_prog.collection_day end,
      'first_payment_policy', case when v_live then coalesce(v_psp.first_payment_policy, v_prog.first_payment_policy) else v_prog.first_payment_policy end,
      'fee_bearer', case v_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end,
      'fee_bps', v_bps,
      'monthly_fee_minor', v_fee,
      'monthly_collect_minor', case when s.monthly_amount_minor is null then null
                                    else s.monthly_amount_minor + case when v_mode = 'PAYER_SURCHARGE' then coalesce(v_fee, 0) else 0 end end,
      'sibling_ordinal', v_psp.sibling_ordinal,
      'sibling_discount_type', v_psp.sibling_discount_type,
      'sibling_discount_value', v_psp.sibling_discount_value,
      'base_amount_minor', v_psp.base_amount_minor) end,
    -- The payer's contact details only for somebody who may see members' contact details (the People rule,
    -- club_people); seeing the club's money is not a licence to see a family's email and phone.
    'payer', case when s.payer_user_id is null then null else jsonb_build_object(
      'name', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.payer_user_id),
      'relationship', s.relationship,
      'email', case when v_contact then (select p.email from public.profiles p where p.id = s.payer_user_id) end,
      'phone', case when v_contact then (select nullif(btrim(p.phone_number), '') from public.profiles p where p.id = s.payer_user_id) end) end,
    -- WHO THE CLUB MAY ASK about this player: the contact rule's adults (guardians; the player only if an adult).
    -- Names and relationship only -- never a contact detail beyond what the club already holds for the payer.
    'askable', (select coalesce(jsonb_agg(jsonb_build_object(
                   'name', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = e.user_id),
                   'relationship', e.relationship,
                   'is_payer', e.user_id = s.payer_user_id) order by e.relationship, e.user_id), '[]'::jsonb)
                  from internal.player_contact_eligibility(array[p_player_id]) e
                 where e.outcome = 'ELIGIBLE' and (e.relationship = 'guardian' or (e.relationship = 'self' and e.is_adult))),
    'direct_debit', case when s.payer_subscription_id is null then null else jsonb_build_object(
      'mandate_status', s.mandate_status, 'subscription_status', s.subscription_status) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                  'obligation_id', o.id, 'payment_id', o.gocardless_payment_id,
                  'billing_period', o.billing_period, 'amount_minor', o.amount_due_minor,
                  'collect_minor', o.collect_amount_minor, 'fee_minor', o.platform_fee_minor,
                  'fee_position', (select fp.fee_position from internal.membership_fee_position(o.id) fp),
                  'due_date', o.due_date, 'status', o.status, 'is_prorated', o.is_prorated,
                  'payment_status', gp.status, 'charge_date', gp.charge_date) order by o.billing_period desc), '[]'::jsonb)
                  from public.membership_obligations o
                  left join public.gocardless_payments gp on gp.id = o.gocardless_payment_id
                 where o.player_id = p_player_id and o.club_id = p_club_id),
    'can', jsonb_build_object(
      'remind', internal.can('finance.enrolment.manage', 'club', p_club_id, null, null),
      'release_payer', internal.can('finance.enrolment.manage', 'club', p_club_id, null, null),
      'cancel', internal.can('finance.payment.act', 'club', p_club_id, null, null)));
end;
$function$;

revoke all on function public.club_member_membership(uuid, uuid) from public, anon;
grant execute on function public.club_member_membership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. CHANGING WHO PAYS (decision #11): end a membership that has no live GoCardless collection
--    The old payer is told; the player becomes "Not set up", so the club's reminder goes to the guardians the
--    contact rule allows and one of them takes it on through their own Direct Debit (claim_responsible_payer).
--    A membership with a live collection is refused: it is ended by cancelling it at GoCardless (the website's
--    Cancel Membership), never by quietly starting a second collection beside it.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.notification_types (type_key, topic_key)
values ('membership_payer_released', 'membership_payments')
on conflict (type_key) do nothing;

create or replace function public.release_responsible_payer(p_payer_subscription_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  v_psp public.player_subscription_payers;
  v_club uuid;
  v_club_name text;
  v_first text;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_psp from public.player_subscription_payers where id = p_payer_subscription_id for update;
  if v_psp.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  select p.club_id into v_club from public.club_subscription_programmes p where p.id = v_psp.programme_id;
  if not internal.can('finance.enrolment.manage', 'club', v_club, null, null) then
    raise exception 'You are not authorised to change who pays for this membership.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the payer is changing.' using errcode = '22023';
  end if;
  if v_psp.status <> 'active' then
    raise exception 'This membership has already ended.' using errcode = '55000';
  end if;
  select pl.first_name into v_first from public.players pl where pl.id = v_psp.player_id;
  if exists (select 1 from public.gocardless_subscriptions gs where gs.payer_subscription_id = v_psp.id and gs.status in ('pending', 'active')) then
    raise exception '%''s Direct Debit is collecting. Cancel the membership first, so the payments stop; then another guardian can set it up.', v_first
      using errcode = '55000';
  end if;
  -- A payment already on its way to the bank is still collected whatever happens here, so the payer could not
  -- truthfully be told that nothing more will be taken. Wait for it to land.
  if exists (select 1 from public.membership_obligations o
               join public.gocardless_payments gp on gp.id = o.gocardless_payment_id
              where o.payer_subscription_id = v_psp.id
                and gp.status in ('pending_customer_approval', 'pending_submission', 'submitted')) then
    raise exception 'A payment for %''s membership is on its way to the bank. Change who pays once it has been collected.', v_first
      using errcode = '55000';
  end if;

  update public.player_subscription_payers
     set status = 'ended', effective_to = current_date, ended_by = v_actor, ended_at = now(), end_reason = btrim(p_reason)
   where id = v_psp.id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (v_actor, v_club, 'payer_released', 'player_subscription_payers', v_psp.id,
          jsonb_build_object('payer_user_id', v_psp.payer_user_id, 'relationship', v_psp.relationship),
          jsonb_build_object('player_id', v_psp.player_id, 'reason', btrim(p_reason)), 'admin_ui');

  select cd.name into v_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_club;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_psp.payer_user_id, 'membership_payer_released', 'Membership payer changed',
          case when v_psp.relationship = 'self'
               then format('%s has ended your Direct Debit set-up for your membership, so that someone else can pay for it. Nothing more will be collected from you for it.', v_club_name)
               else format('%s has ended your Direct Debit set-up for %s''s membership, so that someone else can pay for it. Nothing more will be collected from you for it.', v_club_name, v_first) end,
          jsonb_build_object('player_id', v_psp.player_id, 'club_id', v_club, 'self', v_psp.relationship = 'self'));

  return jsonb_build_object('outcome', 'RELEASED', 'player_id', v_psp.player_id);
end;
$function$;

revoke all on function public.release_responsible_payer(uuid, text) from public, anon;
grant execute on function public.release_responsible_payer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. THE REMINDER PREVIEW: what a reminder would do before anybody presses Send -- how many families would be asked,
--    who would be left out and why, and the exact words (from the one composer above). The same authority as
--    sending, the same rules; it records nothing and tells nobody anything.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.membership_reminder_preview(p_club_id uuid, p_player_ids uuid[], p_team_id uuid default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club_scope boolean;
  v_club_name text;
  v_player uuid;
  s record;
  v_to integer;
  v_will integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_example jsonb;
  v_variant text;
  -- One example per message, with how many families get it: an audience mixes situations, and each family gets the
  -- words for its own.
  v_examples jsonb := '{}'::jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_player_ids is null or cardinality(p_player_ids) = 0 then
    raise exception 'Choose who to remind.' using errcode = '22023';
  end if;
  if cardinality(p_player_ids) > 500 then
    raise exception 'Preview up to 500 people at a time.' using errcode = '22023';
  end if;

  -- WHO MAY ASK: exactly the sending rule.
  v_club_scope := internal.can('finance.enrolment.manage', 'club', p_club_id, null, null);
  if p_team_id is not null then
    if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
      raise exception 'That team is not at this club.' using errcode = '42501';
    end if;
    if not (v_club_scope or internal.can('finance.subscription.view', 'team', p_club_id, p_team_id, null)) then
      raise exception 'You are not authorised to send membership reminders for this team.' using errcode = '42501';
    end if;
  elsif not v_club_scope then
    raise exception 'You are not authorised to send membership reminders for this club.' using errcode = '42501';
  end if;

  select cd.name into v_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_club_id;

  foreach v_player in array (select array_agg(distinct x) from unnest(p_player_ids) x) loop
    select * into s from internal.membership_standing(p_club_id, current_date) ms where ms.player_id = v_player;
    if s.player_id is null then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOT_AT_CLUB');
      continue;
    end if;
    if p_team_id is not null and not (p_team_id = any(s.team_ids)) then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOT_IN_TEAM');
      continue;
    end if;
    if not internal.membership_reminder_applies(s.standing, s.reason) then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOTHING_TO_ASK');
      continue;
    end if;
    if s.last_reminded_at is not null and s.last_reminded_at > now() - interval '72 hours' then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'RECENTLY_REMINDED');
      continue;
    end if;
    if s.payer_user_id is not null then
      v_to := 1;
    else
      select count(distinct e.user_id) into v_to
        from internal.player_contact_eligibility(array[v_player]) e
       where e.outcome = 'ELIGIBLE' and (e.relationship = 'guardian' or (e.relationship = 'self' and e.is_adult));
    end if;
    if coalesce(v_to, 0) = 0 then
      v_skipped := v_skipped || jsonb_build_object('player_id', v_player, 'reason', 'NOBODY_TO_ASK');
      continue;
    end if;
    v_will := v_will + 1;
    v_variant := internal.membership_reminder_variant(s.standing, s.reason);
    if v_examples ? v_variant then
      v_examples := jsonb_set(v_examples, array[v_variant, 'count'], to_jsonb((v_examples -> v_variant ->> 'count')::int + 1));
    else
      v_examples := v_examples || jsonb_build_object(v_variant, jsonb_build_object(
        'variant', v_variant, 'count', 1, 'player_id', v_player, 'first_name', s.first_name, 'title', 'Membership reminder',
        'body', internal.membership_reminder_body(s.standing, s.reason, s.first_name, v_club_name, current_date)));
    end if;
    if v_example is null then
      v_example := (v_examples -> v_variant) - 'variant' - 'count';
    end if;
  end loop;

  -- Counts, reasons and the family's own words for each message; never who would be told.
  return jsonb_build_object('will_send', v_will, 'skipped', v_skipped, 'example', v_example,
    'examples', coalesce((select jsonb_agg(ex.body order by (ex.body ->> 'count')::int desc, ex.body ->> 'variant')
                          from jsonb_each(v_examples) ex(variant_key, body)), '[]'::jsonb));
end;
$function$;

revoke all on function public.membership_reminder_preview(uuid, uuid[], uuid) from public, anon;
grant execute on function public.membership_reminder_preview(uuid, uuid[], uuid) to authenticated;
