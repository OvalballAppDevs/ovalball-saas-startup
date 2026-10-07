-- =====================================================================================================
-- ONE MEMBERSHIP STANDING, AND REMINDERS ON THE ONE NOTIFICATION SYSTEM (2026-10-06)
--
-- The membership audit of 5-6 October 2026 found about twenty separate derivations of "is this member paid
-- up?" in four vocabularies, which disagreed: a failed payment read as fine to the family, "Payment failed"
-- to the team and "Failed" to the club; a month not yet set up read "Due" to the team and "Not set up" to the
-- club; "Overdue" existed only on club screens; a brand-new member read Overdue on the day they joined. And
-- there was no way to chase anybody, although three screens promised it.
--
-- This is the one derivation (docs/architecture/club-management-domain.md section 5), and every new view
-- reads it:
--
--   internal.membership_standing(club, as_of)   one row per player who needs, or holds, membership at the
--                                                club, with the current month's STANDING and its REASON:
--
--     UP_TO_DATE      this month is paid
--     COLLECTING      the money is on its way: with the bank, being retried, or a Direct Debit is in place
--                     and this month's collection is scheduled
--     DUE             this month is owed and not yet arranged, and not late
--     OVERDUE         not collected, not with the bank, and more than five days past its due date (a new
--                     member's due date is never before the day they joined)
--     ACTION_NEEDED   something failed or is inconsistent and a person must act: a failed, charged-back or
--                     cancelled payment; a failed, cancelled, expired, payer-suspended or blocked Direct Debit; still enrolled after
--                     leaving every team; a guardian payer who is no longer the child's guardian
--     NOT_SET_UP      in a team at a club that runs membership, and nobody has set it up
--     EXEMPT          the club exempted or waived this month, refunded it, or it costs nothing
--     ENDED           the membership ended and the player is no longer in a team
--
--   public.club_membership_board(club, team?)   the club's view: counts, the month's money by the canonical
--                                                definitions (gross; nothing net, because no fee or payout is
--                                                recorded), and every row with amounts and payer. Needs
--                                                finance.subscription.view at the club.
--   public.team_membership_board(team)           a team's view: counts and its players' standing, with the
--                                                per-player amount the team view already showed -- never a
--                                                payer, never a money total, never another team. Needs
--                                                finance.subscription.view at the team (or the club).
--   public.send_membership_reminders(club, players, team?)
--                                                a reminder to each player's RESPONSIBLE PAYER (or, where
--                                                nothing is set up, the player's guardians through the one
--                                                contact rule -- never a child), through public.notifications,
--                                                recorded in finance_audit_log with who sent it; at most one
--                                                reminder per player in 72 hours. The club may remind anybody;
--                                                a team's own staff (finance.subscription.view at the team) may
--                                                remind for players in that team only, and learn counts, never
--                                                who was told.
--   public.send_team_membership_attention(team)  the club telling a team's staff how many of their players'
--                                                memberships need attention; at most once a day per team.
--
-- Nothing here writes money, changes an obligation or calls GoCardless.
--
-- Tests: supabase/tests/membership_standing.sql.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. The derivation
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.membership_standing(p_club_id uuid, p_as_of date default current_date)
 returns table(
   player_id uuid, first_name text, surname text, player_user_id uuid,
   team_ids uuid[], has_place boolean,
   programme_id uuid, payer_subscription_id uuid, payer_user_id uuid, relationship text, enrolment_status text,
   monthly_amount_minor integer,
   billing_period date, obligation_id uuid, obligation_status text, amount_due_minor integer, due_date date,
   mandate_status text, subscription_status text, next_collection_date date,
   standing text, reason text,
   last_reminded_at timestamptz, last_reminded_by uuid
 )
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with prog as (
    select p.id, p.collection_day,
           (select pr.amount_minor from public.club_subscription_pricing pr
             where pr.programme_id = p.id and pr.effective_from <= coalesce(p_as_of, current_date)
             order by pr.effective_from desc, pr.created_at desc limit 1) as current_price
      from public.club_subscription_programmes p
     where p.club_id = p_club_id and p.enabled
  ),
  period as (select date_trunc('month', coalesce(p_as_of, current_date))::date as m, coalesce(p_as_of, current_date) as today),
  placed as (
    select ptm.player_id, array_agg(distinct ptm.team_id) as team_ids
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
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
    select pl.player_id from placed pl where exists (select 1 from prog)
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
           prog.id as programme_id, prog.collection_day, prog.current_price,
           e.id as payer_subscription_id, e.payer_user_id, e.relationship, e.status as enrolment_status,
           e.effective_from,
           coalesce(case when e.status = 'active' then e.final_amount_minor end, prog.current_price) as monthly_amount_minor,
           o.id as obligation_id, o.status as obligation_status, o.amount_due_minor, o.due_date,
           greatest(o.due_date, coalesce(o.membership_effective_date, o.due_date), coalesce(e.effective_from, o.due_date)) as effective_due,
           md.status as mandate_status,
           gs.status as subscription_status,
           (e.relationship = 'guardian' and not exists (
              select 1 from public.guardians g
               where g.player_id = pop.player_id and g.guardian_user_id = e.payer_user_id and g.status = 'active')) as payer_not_guardian,
           period.m, period.today
      from population pop
      cross join prog
      cross join period
      join public.players pl on pl.id = pop.player_id
      left join placed on placed.player_id = pop.player_id
      left join enrolled e on e.player_id = pop.player_id
      left join public.membership_obligations o
        on o.player_id = pop.player_id and o.programme_id = prog.id and o.billing_period = period.m
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
        when f.mandate_status in ('active', 'pending_submission', 'submitted') then 'COLLECTING'
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
          case when f.mandate_status in ('active', 'pending_submission', 'submitted') then 'NOT_COLLECTED' else 'SETUP_UNFINISHED' end
        when f.mandate_status in ('active', 'pending_submission', 'submitted') then 'SCHEDULED'
        else 'SETUP_UNFINISHED'
      end as reason
    from facts f
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
         r.created_at, r.actor_user_id
    from judged j
    left join lateral (
      select fal.created_at, fal.actor_user_id from public.finance_audit_log fal
       where fal.club_id = p_club_id and fal.action = 'membership_reminder_sent'
         and fal.target_table = 'players' and fal.target_id = j.player_id
       order by fal.created_at desc limit 1
    ) r on true;
$function$;

revoke all on function internal.membership_standing(uuid, date) from public, anon, authenticated;

-- A reminder may go to the payer only for a standing the payer can act on.
create or replace function internal.membership_reminder_applies(p_standing text, p_reason text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_standing in ('NOT_SET_UP', 'DUE', 'OVERDUE')
      or (p_standing = 'ACTION_NEEDED' and p_reason in ('PAYMENT_FAILED', 'CHARGED_BACK', 'PAYMENT_CANCELLED', 'MANDATE_PROBLEM'));
$function$;

revoke all on function internal.membership_reminder_applies(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. The club's board
-- ---------------------------------------------------------------------------------------------------
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
  select pr.amount_minor into v_price from public.club_subscription_pricing pr
   where pr.programme_id = v_prog.id and pr.effective_from <= v_today
   order by pr.effective_from desc, pr.created_at desc limit 1;

  with s as (
    select * from internal.membership_standing(p_club_id, v_today) ms
     where p_team_id is null or p_team_id = any(ms.team_ids)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', s.player_id, 'first_name', s.first_name, 'surname', s.surname,
      'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'age_group', t.age_group) order by t.age_group, t.display_name), '[]'::jsonb)
                  from public.teams t where t.id = any(s.team_ids)),
      'standing', s.standing, 'reason', s.reason,
      'payer', case when s.payer_user_id is null then null else jsonb_build_object(
                 'user_id', s.payer_user_id, 'relationship', s.relationship,
                 'name', (select nullif(btrim(concat_ws(' ', p.first_name, p.surname)), '') from public.profiles p where p.id = s.payer_user_id)) end,
      'payer_subscription_id', s.payer_subscription_id,
      'monthly_amount_minor', s.monthly_amount_minor,
      'amount_due_minor', s.amount_due_minor, 'obligation_status', s.obligation_status, 'obligation_id', s.obligation_id,
      'due_date', s.due_date, 'mandate_status', s.mandate_status, 'next_collection_date', s.next_collection_date,
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
      'active_memberships', count(*) filter (where s.enrolment_status = 'active'))
    into v_rows, v_counts
  from s;

  -- THE MONTH'S MONEY, by the definitions in the domain map (section 6). Gross member payments only.
  with o as (
    select mo.* from public.membership_obligations mo
     where mo.club_id = p_club_id and mo.billing_period = v_period
       and (p_team_id is null or exists (select 1 from public.player_team_memberships ptm
                                          where ptm.player_id = mo.player_id and ptm.team_id = p_team_id and ptm.state = 'ACTIVE'))
  ),
  paid as (
    select gp.id, gp.gross_amount_minor,
           coalesce((select sum(r.amount_minor) from public.payment_refunds r where r.payment_id = gp.id), 0) as refunded
      from public.gocardless_payments gp
      join o on o.id = gp.obligation_id
     where gp.status in ('confirmed', 'paid_out')
  )
  select jsonb_build_object(
    'period', v_period,
    'currency', coalesce(v_prog.currency, 'GBP'),
    'expected_minor', coalesce((select sum(amount_due_minor) from o where status not in ('CANCELLED', 'EXEMPT', 'WAIVED', 'REFUNDED')), 0),
    'collected_minor', coalesce((select sum(greatest(gross_amount_minor - refunded, 0)) from paid), 0),
    'collecting_minor', coalesce((select sum(amount_due_minor) from o where status in ('SUBMITTED', 'RETRYING')), 0),
    'outstanding_minor', coalesce((select sum(amount_due_minor) from o where status in ('SETUP_PENDING', 'READY', 'SCHEDULED', 'OVERDUE', 'SUBMITTED', 'RETRYING', 'FAILED', 'CHARGEDBACK')), 0),
    'overdue_minor', coalesce((select sum(o.amount_due_minor) from o
                                 left join public.player_subscription_payers psp on psp.id = o.payer_subscription_id
                                where o.status in ('SETUP_PENDING', 'READY', 'SCHEDULED', 'OVERDUE')
                                  and v_today > greatest(o.due_date, coalesce(o.membership_effective_date, o.due_date), coalesce(psp.effective_from, o.due_date)) + 5), 0),
    'failed_minor', coalesce((select sum(amount_due_minor) from o where status in ('FAILED', 'CHARGEDBACK')), 0),
    'refunded_minor', coalesce((select sum(refunded) from paid), 0),
    'waived_minor', coalesce((select sum(amount_due_minor) from o where status in ('EXEMPT', 'WAIVED')), 0),
    'next_collection_minor', coalesce((
       select sum(coalesce(psp.final_amount_minor, v_price))
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
      'id', v_prog.id, 'enabled', v_prog.enabled, 'collection_day', v_prog.collection_day,
      'price_minor', v_price, 'currency', v_prog.currency) end,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'money', v_money,
    'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.club_membership_board(uuid, uuid, date) from public, anon;
grant execute on function public.club_membership_board(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. A team's board: the same standing, scoped, with nothing the team is not entitled to
-- ---------------------------------------------------------------------------------------------------
create or replace function public.team_membership_board(p_team_id uuid, p_as_of date default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
  v_today date := coalesce(p_as_of, current_date);
  v_enabled boolean;
  v_rows jsonb;
  v_counts jsonb;
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
    raise exception 'You are not authorised to see this team''s memberships.' using errcode = '42501';
  end if;

  select coalesce(bool_or(p.enabled), false) into v_enabled from public.club_subscription_programmes p where p.club_id = v_club;

  -- The team's own players only: those with an active place on THIS team.
  with s as (
    select * from internal.membership_standing(v_club, v_today) ms
     where p_team_id = any(ms.team_ids)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', s.player_id, 'first_name', s.first_name, 'surname', s.surname,
      'standing', s.standing, 'reason', s.reason,
      'amount_due_minor', s.amount_due_minor,
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
    'club_id', v_club,
    'as_of', v_today,
    'programme_enabled', v_enabled,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.team_membership_board(uuid, date) from public, anon;
grant execute on function public.team_membership_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Reminders: on the one notification system, to the responsible payer, never a child
-- ---------------------------------------------------------------------------------------------------
insert into public.notification_types (type_key, topic_key)
values ('membership_reminder', 'membership_payments'),
       ('membership_team_attention', 'membership_payments')
on conflict (type_key) do nothing;

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
  v_month text;
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

    v_month := to_char(date_trunc('month', current_date), 'FMMonth');
    v_body := case
      when s.standing = 'NOT_SET_UP' then format('%s asks you to set up %s''s membership.', v_club_name, s.first_name)
      when s.standing = 'DUE' then format('%s''s membership for %s is due. Please finish setting up the Direct Debit.', s.first_name, v_month)
      when s.standing = 'OVERDUE' then format('%s''s membership for %s is overdue. Please finish setting up the Direct Debit, or contact %s.', s.first_name, v_month, v_club_name)
      else format('%s''s membership payment needs your attention. Please check the Direct Debit, or contact %s.', s.first_name, v_club_name)
    end;

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

create or replace function public.send_team_membership_attention(p_team_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  v_club uuid;
  v_team_name text;
  v_count integer;
  v_to uuid[];
  v_n integer;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select t.club_id, t.display_name into v_club, v_team_name from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not internal.can('finance.enrolment.manage', 'club', v_club, null, null) then
    raise exception 'You are not authorised to send this to the team.' using errcode = '42501';
  end if;
  if exists (select 1 from public.finance_audit_log where club_id = v_club and action = 'membership_team_attention_sent'
              and target_table = 'teams' and target_id = p_team_id and created_at > now() - interval '24 hours') then
    raise exception 'This team was told today already.' using errcode = '54000';
  end if;

  select count(*) into v_count from internal.membership_standing(v_club, current_date) ms
   where p_team_id = any(ms.team_ids) and ms.standing in ('NOT_SET_UP', 'DUE', 'OVERDUE', 'ACTION_NEEDED');
  if v_count = 0 then
    return jsonb_build_object('sent', 0, 'players', 0, 'reason', 'NOTHING_NEEDS_ATTENTION');
  end if;

  -- The team's staff who can see its memberships (and act on them): whoever holds the capability at the team.
  select array_agg(distinct m.user_id) into v_to
    from public.role_assignments ra
    join public.club_memberships m on m.id = ra.membership_id and m.state = 'ACTIVE'
   where ra.team_id = p_team_id and ra.state = 'ACTIVE' and m.club_id = v_club
     and m.user_id <> v_actor
     and (internal.capability_decision(m.user_id, 'finance.subscription.view', 'team', v_club, p_team_id, null, false, false)).allowed;
  if v_to is null or cardinality(v_to) = 0 then
    return jsonb_build_object('sent', 0, 'players', v_count, 'reason', 'NOBODY_TO_TELL');
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select r, 'membership_team_attention', 'Memberships need attention',
         case when v_count = 1 then format('%s has 1 player whose membership needs attention.', v_team_name)
              else format('%s has %s players whose membership needs attention.', v_team_name, v_count) end,
         jsonb_build_object('team_id', p_team_id, 'club_id', v_club, 'players', v_count)
    from unnest(v_to) r;
  get diagnostics v_n = row_count;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (v_actor, v_club, 'membership_team_attention_sent', 'teams', p_team_id, null,
          jsonb_build_object('players', v_count, 'recipients', cardinality(v_to)), 'admin_ui');

  return jsonb_build_object('sent', v_n, 'players', v_count);
end;
$function$;

revoke all on function public.send_team_membership_attention(uuid) from public, anon;
grant execute on function public.send_team_membership_attention(uuid) to authenticated;
