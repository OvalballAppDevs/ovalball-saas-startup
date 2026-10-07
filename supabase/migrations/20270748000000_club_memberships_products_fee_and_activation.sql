-- =====================================================================================================
-- CLUB MEMBERSHIPS: SEVERAL MEMBERSHIPS PER CLUB, OVALBALL'S 2.5%, AND AN ACTIVATION THAT CANNOT BE FAKED
-- (Club Memberships Part 1, 6 October 2026)
--
-- OWNER-LOCKED (answered directly, 6 October 2026):
--   * A club can run SEVERAL memberships, ASSIGNED BY TEAM. Each team maps to one membership and a player's
--     membership follows their team.
--   * A player whose teams map to different memberships holds ONE: the higher-priced applies automatically,
--     and a Club Admin can switch that player to the other one (recorded).
--   * Pricing stays a MONTHLY amount, collected continuously until the membership ends.
--   * Ovalball takes 2.5% of member-to-club payments, and EACH CLUB CHOOSES who bears it: the club (the fee
--     comes out of what the club receives) or its members (the fee is added to what they pay).
--
-- DERIVED HERE (open to challenge; each is stated where it is implemented):
--   * The fee is 2.5% of each payment's membership amount, rounded half up to the penny -- the same rounding
--     the proration uses. GoCardless takes a whole-pence app_fee per payment, capped at 50% of it, and leaves
--     the rate and rounding to the partner (docs.gocardless.com/docs/api-reference/oauth-reference).
--   * A settings change -- who pays the fee, the first-payment policy, the collection day -- reaches NEW
--     memberships only. Each enrolment keeps what it was set up with, as prices already did. A live GoCardless
--     subscription has a fixed amount, fee and day, so changing an existing member is a separate, deliberate
--     act, never a side effect of a settings save.
--   * Turning memberships off stops NEW memberships. Existing Direct Debits keep collecting until each
--     membership is ended, so their months keep being generated and recorded: generation used to return 0
--     for a switched-off programme, which left collections GoCardless was still making with nowhere to land.
--   * Only Activate switches memberships on, and it re-derives readiness every time: the club's agreement to
--     the terms, a connected and verified GoCardless account (GoCardless: an unverified account cannot collect),
--     a fee choice and at least one priced membership with a team. Only Pause switches new memberships off, with
--     a reason. The legacy configure door changes settings only.
--   * A part month below the £1 Direct Debit minimum cannot be collected (GoCardless Integration Guide), so it
--     is recorded as nothing to collect, with the reason, instead of failing at activation.
--   * A club that has not chosen who pays the fee (every programme set up before today) carries no fee: the
--     partner agreement requires the fee to be shown to, and agreed by, the club before it applies.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. THE FEE: one rate, one rounding, one place
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.ovalball_fee_bps()
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$ select 250 $function$;

comment on function internal.ovalball_fee_bps() is
  'Ovalball''s fee on member-to-club payments, in basis points (250 = 2.5%). Owner-locked 6 Oct 2026. Clubs must be told directly before any change (GoCardless Connected Merchant Agreement cl. 14).';

create or replace function internal.ovalball_fee_minor(p_amount_minor integer, p_bps integer)
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  -- Half up to the penny: 62.5p is 63p, 28.375p is 28p. Nothing is charged on nothing.
  select case when coalesce(p_amount_minor, 0) <= 0 or coalesce(p_bps, 0) <= 0 then 0
              else ((p_amount_minor::bigint * p_bps + 5000) / 10000)::integer end
$function$;

-- The two fee modes a club can choose. NONE and PARTNER_REVENUE_SHARE remain readable on programmes set up
-- before the fee existed, and are never offered again: GoCardless's partner revenue share is set for a whole
-- integration and cannot be combined with app fees (Integration Partner Agreement cl. 43).
create or replace function internal.fee_mode_is_chosen(p_mode text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$ select coalesce(p_mode in ('GOCARDLESS_APP_FEE', 'PAYER_SURCHARGE'), false) $function$;

revoke all on function internal.ovalball_fee_bps() from public, anon, authenticated;
revoke all on function internal.ovalball_fee_minor(integer, integer) from public, anon, authenticated;
revoke all on function internal.fee_mode_is_chosen(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 2. MEMBERSHIPS (several per club) and the teams they apply to
-- -----------------------------------------------------------------------------------------------------
alter table public.club_subscription_programmes
  add column if not exists activated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_subscription_programmes_id_club_key') then
    alter table public.club_subscription_programmes add constraint club_subscription_programmes_id_club_key unique (id, club_id);
  end if;
end $$;

-- A programme switched on before activation existed counts as activated then.
update public.club_subscription_programmes set activated_at = coalesce(updated_at, created_at)
 where enabled and activated_at is null;

create table if not exists public.membership_products (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null,
  club_id uuid not null,
  name text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint membership_products_programme_fk foreign key (programme_id, club_id)
    references public.club_subscription_programmes (id, club_id) on delete cascade,
  constraint membership_products_name_check check (char_length(name) between 1 and 60 and name = btrim(name)),
  constraint membership_products_status_check check (status in ('active', 'archived')),
  constraint membership_products_id_club_key unique (id, club_id)
);

create unique index if not exists membership_products_active_name on public.membership_products (programme_id, lower(name)) where status = 'active';
create index if not exists membership_products_club on public.membership_products (club_id);

comment on table public.membership_products is
  'A membership a club runs (e.g. Junior, Senior). Several per club; each team maps to one. Owner-locked 6 Oct 2026.';

-- ONE MEMBERSHIP PER TEAM. A team with no row needs no membership: the club decides which teams pay.
create table if not exists public.membership_product_teams (
  team_id uuid primary key references public.teams (id) on delete cascade,
  product_id uuid not null,
  club_id uuid not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  constraint membership_product_teams_product_fk foreign key (product_id, club_id)
    references public.membership_products (id, club_id) on delete cascade
);

create index if not exists membership_product_teams_product on public.membership_product_teams (product_id);

-- A Club Admin's switch for a player whose teams map to different memberships (owner-locked rule above).
create table if not exists public.membership_player_products (
  player_id uuid not null references public.players (id) on delete cascade,
  programme_id uuid not null,
  club_id uuid not null,
  product_id uuid not null,
  reason text,
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (player_id, programme_id),
  constraint membership_player_products_product_fk foreign key (product_id, club_id)
    references public.membership_products (id, club_id) on delete cascade
);

create or replace function internal.membership_product_team_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if (select t.club_id from public.teams t where t.id = new.team_id) is distinct from new.club_id then
    raise exception 'A membership can only apply to its own club''s teams.' using errcode = '23514';
  end if;
  if (select p.status from public.membership_products p where p.id = new.product_id) <> 'active' then
    raise exception 'An archived membership cannot be given teams.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists membership_product_teams_guard on public.membership_product_teams;
create trigger membership_product_teams_guard before insert or update on public.membership_product_teams
  for each row execute function internal.membership_product_team_guard();

alter table public.membership_products enable row level security;
alter table public.membership_product_teams enable row level security;
alter table public.membership_player_products enable row level security;

-- Read by the same audience that reads the club's prices: the club's finance holders, the site's commercial viewer,
-- or whoever may pay for a player placed at the club (a guardian, or the adult player) -- through the canonical
-- capability decision (internal.can / internal.can_player_as_family), never the retired legacy helpers
-- (authority_helper_retirement HR1). Written only through the doors below. (internal.may_read_membership_price asks the same
-- question inside SECURITY DEFINER functions, but it is not executable by a signed-in caller, so a row policy --
-- which runs as the caller -- cannot use it: every direct read would fail with "permission denied".)
drop policy if exists membership_products_select_scoped on public.membership_products;
create policy membership_products_select_scoped on public.membership_products for select to authenticated
  using (internal.has_site_capability('site.commercial.view')
         or internal.can('finance.subscription.configure', 'club', club_id, null, null)
         or internal.can('finance.subscription.view', 'club', club_id, null, null)
         or exists (select 1 from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
                     where t.club_id = membership_products.club_id and ptm.state = 'ACTIVE'
                       and internal.can_player_as_family('finance.payer.self', ptm.player_id)));
drop policy if exists membership_product_teams_select_scoped on public.membership_product_teams;
create policy membership_product_teams_select_scoped on public.membership_product_teams for select to authenticated
  using (internal.has_site_capability('site.commercial.view')
         or internal.can('finance.subscription.configure', 'club', club_id, null, null)
         or internal.can('finance.subscription.view', 'club', club_id, null, null)
         or exists (select 1 from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
                     where t.club_id = membership_product_teams.club_id and ptm.state = 'ACTIVE'
                       and internal.can_player_as_family('finance.payer.self', ptm.player_id)));
drop policy if exists membership_player_products_select_scoped on public.membership_player_products;
create policy membership_player_products_select_scoped on public.membership_player_products for select to authenticated
  using (internal.has_site_capability('site.commercial.view')
         or internal.has_capability('finance.subscription.view', 'club', club_id, null)
         or internal.has_capability('finance.enrolment.manage', 'club', club_id, null)
         or internal.is_active_player_guardian(player_id) or internal.is_own_linked_player(player_id));

drop policy if exists session_ok_required on public.membership_products;
create policy session_ok_required on public.membership_products as restrictive for all to authenticated using ((select internal.session_ok()));
drop policy if exists session_ok_required on public.membership_product_teams;
create policy session_ok_required on public.membership_product_teams as restrictive for all to authenticated using ((select internal.session_ok()));
drop policy if exists session_ok_required on public.membership_player_products;
create policy session_ok_required on public.membership_player_products as restrictive for all to authenticated using ((select internal.session_ok()));

revoke all on public.membership_products, public.membership_product_teams, public.membership_player_products from anon, authenticated;
grant select on public.membership_products, public.membership_product_teams, public.membership_player_products to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 3. PRICES PER MEMBERSHIP; WHAT EACH ENROLMENT AND EACH MONTH WAS SET UP WITH
-- -----------------------------------------------------------------------------------------------------
alter table public.club_subscription_pricing add column if not exists product_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_subscription_pricing_product_fk') then
    alter table public.club_subscription_pricing add constraint club_subscription_pricing_product_fk
      foreign key (product_id) references public.membership_products (id) on delete cascade;
  end if;
end $$;
create index if not exists club_subscription_pricing_product on public.club_subscription_pricing (product_id, effective_from desc, created_at desc);

alter table public.player_subscription_payers
  add column if not exists product_id uuid references public.membership_products (id),
  add column if not exists collection_day integer,
  add column if not exists first_payment_policy text,
  add column if not exists platform_fee_mode text,
  add column if not exists platform_fee_bps integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_subscription_payers_snapshot_check') then
    alter table public.player_subscription_payers add constraint player_subscription_payers_snapshot_check check (
      (collection_day is null or collection_day between 1 and 28)
      and (first_payment_policy is null or first_payment_policy in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY'))
      and (platform_fee_bps is null or platform_fee_bps between 0 and 5000));
  end if;
end $$;

comment on column public.player_subscription_payers.collection_day is
  'The collection day this membership was set up with. A later settings change reaches new memberships only (NULL: set up before snapshots existed; the programme''s value applies).';
comment on column public.player_subscription_payers.platform_fee_mode is
  'Who pays Ovalball''s fee for this membership, as chosen by the club when it was set up (GOCARDLESS_APP_FEE: the club; PAYER_SURCHARGE: the member). NULL or a legacy mode: no fee.';

alter table public.membership_obligations
  add column if not exists product_id uuid references public.membership_products (id),
  add column if not exists platform_fee_mode text,
  add column if not exists platform_fee_bps integer not null default 0,
  add column if not exists platform_fee_minor integer not null default 0,
  add column if not exists payer_fee_minor integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.membership_obligations'::regclass and attname = 'collect_amount_minor' and not attisdropped) then
    alter table public.membership_obligations
      add column collect_amount_minor integer generated always as (amount_due_minor + payer_fee_minor) stored;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'membership_obligations_fee_consistency') then
    alter table public.membership_obligations add constraint membership_obligations_fee_consistency check (
      platform_fee_minor >= 0 and payer_fee_minor >= 0
      and (payer_fee_minor = 0 or payer_fee_minor = platform_fee_minor)
      and (amount_due_minor > 0 or platform_fee_minor = 0));
  end if;
end $$;

comment on column public.membership_obligations.platform_fee_minor is
  'Ovalball''s fee on this month (2.5% of amount_due_minor, half up), requested from GoCardless as the payment''s app_fee. What GoCardless actually took is in its payout items.';
comment on column public.membership_obligations.payer_fee_minor is
  'The part of Ovalball''s fee the member pays on top (equal to platform_fee_minor when the club chose that members pay it, else 0).';
comment on column public.membership_obligations.collect_amount_minor is
  'What GoCardless collects from the payer for this month: the membership amount plus any fee the member pays on top.';

-- -----------------------------------------------------------------------------------------------------
-- 4. ONE MEMBERSHIP FOR EVERY EXISTING PROGRAMME, SO NOTHING CHANGES UNTIL A CLUB CHANGES IT
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.create_default_membership_product(p_programme_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_programme public.club_subscription_programmes;
  v_product uuid;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  if v_programme.id is null then
    return null;
  end if;
  select id into v_product from public.membership_products where programme_id = p_programme_id and status = 'active' order by sort_order, created_at limit 1;
  if v_product is not null then
    return v_product;
  end if;
  insert into public.membership_products (programme_id, club_id, name, sort_order, created_by)
  values (p_programme_id, v_programme.club_id, 'Club Membership', 0, v_programme.created_by)
  returning id into v_product;
  -- Today every team at a club with a programme needs membership; the default membership keeps it so.
  insert into public.membership_product_teams (team_id, product_id, club_id, assigned_by)
  select t.id, v_product, v_programme.club_id, v_programme.created_by
    from public.teams t
   where t.club_id = v_programme.club_id and t.archived_at is null and coalesce(t.active, true)
  on conflict (team_id) do nothing;
  return v_product;
end;
$function$;

revoke all on function internal.create_default_membership_product(uuid) from public, anon, authenticated;

do $$
declare
  r record;
  v_product uuid;
begin
  for r in select p.id from public.club_subscription_programmes p loop
    v_product := internal.create_default_membership_product(r.id);
    update public.club_subscription_pricing set product_id = v_product where programme_id = r.id and product_id is null;
    update public.player_subscription_payers set product_id = v_product where programme_id = r.id and product_id is null;
    update public.membership_obligations set product_id = v_product where programme_id = r.id and product_id is null;
  end loop;
end $$;

-- From now on every programme starts with one membership covering its teams, which the club renames, prices
-- and splits; and every price, enrolment and month knows its membership.
create or replace function internal.programme_after_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform internal.create_default_membership_product(new.id);
  return new;
end;
$function$;

drop trigger if exists club_subscription_programmes_default_product on public.club_subscription_programmes;
create trigger club_subscription_programmes_default_product after insert on public.club_subscription_programmes
  for each row execute function internal.programme_after_insert();

-- A club with exactly one active membership keeps "every team pays" for teams it creates later (including a
-- season's new intake team). With several memberships the club decides: a new team waits to be assigned.
create or replace function internal.team_after_insert_membership()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_products uuid[];
begin
  select array_agg(mp.id) into v_products
    from public.membership_products mp
    join public.club_subscription_programmes p on p.id = mp.programme_id
   where p.club_id = new.club_id and mp.status = 'active';
  if coalesce(cardinality(v_products), 0) = 1 then
    insert into public.membership_product_teams (team_id, product_id, club_id)
    values (new.id, v_products[1], new.club_id)
    on conflict (team_id) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists teams_membership_product_default on public.teams;
create trigger teams_membership_product_default after insert on public.teams
  for each row execute function internal.team_after_insert_membership();

create or replace function internal.default_product_for_programme(p_programme_id uuid)
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select mp.id from public.membership_products mp
   where mp.programme_id = p_programme_id and mp.status = 'active'
   order by mp.sort_order, mp.created_at, mp.id
   limit 1;
$function$;

-- A price row written without a membership belongs to the programme's first one (the old one-price door).
create or replace function internal.pricing_fill_product()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.product_id is null then
    new.product_id := coalesce(internal.default_product_for_programme(new.programme_id),
                               internal.create_default_membership_product(new.programme_id));
  end if;
  if (select mp.programme_id from public.membership_products mp where mp.id = new.product_id) is distinct from new.programme_id then
    raise exception 'A price belongs to a membership of the same programme.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists club_subscription_pricing_fill_product on public.club_subscription_pricing;
create trigger club_subscription_pricing_fill_product before insert or update of product_id, programme_id on public.club_subscription_pricing
  for each row execute function internal.pricing_fill_product();

alter table public.club_subscription_pricing alter column product_id set not null;

revoke all on function internal.programme_after_insert() from public, anon, authenticated;
revoke all on function internal.team_after_insert_membership() from public, anon, authenticated;
revoke all on function internal.default_product_for_programme(uuid) from public, anon, authenticated;
revoke all on function internal.pricing_fill_product() from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 5. WHICH MEMBERSHIP A PLAYER HOLDS
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.membership_product_price(p_product_id uuid, p_as_of date default current_date)
 returns table(pricing_id uuid, amount_minor integer, effective_from date)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select pr.id, pr.amount_minor, pr.effective_from
    from public.club_subscription_pricing pr
   where pr.product_id = p_product_id and pr.effective_from <= coalesce(p_as_of, current_date)
   order by pr.effective_from desc, pr.created_at desc
   limit 1;
$function$;

-- The memberships a player's ACTIVE team places map to, with each one's current price.
create or replace function internal.membership_products_for_player(p_club_id uuid, p_player_id uuid, p_as_of date default current_date)
 returns table(product_id uuid, monthly_amount_minor integer, name text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select distinct mp.id, (select x.amount_minor from internal.membership_product_price(mp.id, p_as_of) x), mp.name
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
    join public.membership_product_teams mpt on mpt.team_id = ptm.team_id
    join public.membership_products mp on mp.id = mpt.product_id and mp.status = 'active'
   where ptm.player_id = p_player_id and ptm.state = 'ACTIVE';
$function$;

-- OWNER-LOCKED RULE: one membership per player at a club. The club's switch wins while it still applies;
-- otherwise the higher-priced membership, so nobody is under-charged by accident (ties: the one listed first).
create or replace function internal.membership_product_for_player(p_club_id uuid, p_player_id uuid, p_as_of date default current_date)
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with applicable as (
    select a.product_id, a.monthly_amount_minor from internal.membership_products_for_player(p_club_id, p_player_id, p_as_of) a
  ),
  chosen as (
    select mpp.product_id from public.membership_player_products mpp
     where mpp.player_id = p_player_id and mpp.club_id = p_club_id
       and mpp.product_id in (select applicable.product_id from applicable)
  )
  select coalesce(
    (select chosen.product_id from chosen limit 1),
    (select applicable.product_id from applicable
       join public.membership_products mp on mp.id = applicable.product_id
      order by coalesce(applicable.monthly_amount_minor, 0) desc, mp.sort_order, mp.created_at, mp.id
      limit 1));
$function$;

revoke all on function internal.membership_product_price(uuid, date) from public, anon, authenticated;
revoke all on function internal.membership_products_for_player(uuid, uuid, date) from public, anon, authenticated;
revoke all on function internal.membership_product_for_player(uuid, uuid, date) from public, anon, authenticated;

-- An enrolment written without a membership (the old door, or a fixture) gets the player's own.
create or replace function internal.payer_fill_product()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_club uuid;
begin
  if new.product_id is null then
    select p.club_id into v_club from public.club_subscription_programmes p where p.id = new.programme_id;
    new.product_id := coalesce(internal.membership_product_for_player(v_club, new.player_id, coalesce(new.effective_from, current_date)),
                               internal.default_product_for_programme(new.programme_id),
                               internal.create_default_membership_product(new.programme_id));
  end if;
  return new;
end;
$function$;

drop trigger if exists player_subscription_payers_fill_product on public.player_subscription_payers;
create trigger player_subscription_payers_fill_product before insert on public.player_subscription_payers
  for each row execute function internal.payer_fill_product();

create or replace function internal.obligation_fill_product()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.product_id is null then
    new.product_id := coalesce((select psp.product_id from public.player_subscription_payers psp where psp.id = new.payer_subscription_id),
                               internal.default_product_for_programme(new.programme_id));
  end if;
  return new;
end;
$function$;

drop trigger if exists membership_obligations_fill_product on public.membership_obligations;
create trigger membership_obligations_fill_product before insert on public.membership_obligations
  for each row execute function internal.obligation_fill_product();

alter table public.player_subscription_payers alter column product_id set not null;
alter table public.membership_obligations alter column product_id set not null;

revoke all on function internal.payer_fill_product() from public, anon, authenticated;
revoke all on function internal.obligation_fill_product() from public, anon, authenticated;

-- The sibling rule is the family's, across every membership at the club; the base is the player's own.
create or replace function internal.calculate_member_price(p_programme_id uuid, p_payer_user_id uuid, p_player_id uuid, p_as_of date default current_date)
 returns table(ordinal integer, base_amount_minor integer, discount_type text, discount_value integer, discount_amount_minor integer, final_amount_minor integer, pricing_id uuid)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_existing_count integer;
  v_ordinal integer;
  v_base integer;
  v_pricing_id uuid;
  v_rule public.club_subscription_sibling_rules;
  v_discount integer := 0;
  v_final integer;
  v_club uuid;
  v_product uuid;
begin
  select club_id into v_club from public.club_subscription_programmes where id = p_programme_id;
  v_product := coalesce(internal.membership_product_for_player(v_club, p_player_id, p_as_of), internal.default_product_for_programme(p_programme_id));

  select count(distinct psp.player_id) into v_existing_count
  from public.player_subscription_payers psp
  where psp.payer_user_id = p_payer_user_id
    and psp.programme_id = p_programme_id
    and psp.status = 'active'
    and psp.player_id <> p_player_id;

  v_ordinal := v_existing_count + 1;

  select x.pricing_id, x.amount_minor into v_pricing_id, v_base from internal.membership_product_price(v_product, p_as_of) x;

  if v_base is null then
    return;
  end if;

  if v_ordinal >= 2 then
    select r.* into v_rule
    from public.club_subscription_sibling_rules r
    where r.programme_id = p_programme_id and r.ordinal = v_ordinal and r.effective_from <= p_as_of
    order by r.effective_from desc, r.created_at desc limit 1;
  end if;

  if v_rule.id is not null and v_rule.discount_type = 'PERCENTAGE' then
    v_discount := round((v_base::numeric * v_rule.discount_value) / 100.0)::integer;
  elsif v_rule.id is not null and v_rule.discount_type = 'FIXED' then
    v_discount := v_rule.discount_value;
  else
    v_discount := 0;
  end if;

  v_final := greatest(0, v_base - v_discount);

  return query select v_ordinal, v_base, coalesce(v_rule.discount_type, 'NONE'), coalesce(v_rule.discount_value, 0), v_discount, v_final, v_pricing_id;
end;
$function$;

-- The programme's price, as the old one-price screens asked it: its first membership's.
create or replace function public.current_subscription_price(p_programme_id uuid, p_as_of date default current_date)
 returns integer
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select x.amount_minor
    from internal.membership_product_price(internal.default_product_for_programme(p_programme_id), p_as_of) x
   where internal.may_read_membership_price((select p.club_id from public.club_subscription_programmes p where p.id = p_programme_id));
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 5b. THE CLUB'S AGREEMENT TO THE FEE AND TO WHAT OVALBALL DOES ON ITS GOCARDLESS ACCOUNT
--     GoCardless's Integration Partner Agreement requires the fee to be shown prominently BEFORE the club
--     agrees (cl. 21) and the Authorised Activity to have the club's EXPRESS permission (cl. 20(d)). The
--     wording is versioned; the version below is the PROPOSED wording, pending owner and legal approval
--     (no legal term is invented here: the data-protection role and the binding agreement are theirs).
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.club_membership_terms_version()
 returns text
 language sql
 immutable
 set search_path to ''
as $function$ select 'club-memberships-2026-10-06-proposed' $function$;

create table if not exists public.club_membership_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  version text not null,
  fee_bps integer not null,
  accepted_by uuid not null,
  accepted_at timestamptz not null default now()
);
create index if not exists club_membership_terms_acceptances_club on public.club_membership_terms_acceptances (club_id, version, accepted_at desc);
alter table public.club_membership_terms_acceptances enable row level security;
drop policy if exists club_membership_terms_select_scoped on public.club_membership_terms_acceptances;
create policy club_membership_terms_select_scoped on public.club_membership_terms_acceptances for select to authenticated
  using (internal.has_site_capability('site.commercial.view')
         or internal.has_capability('finance.subscription.configure', 'club', club_id, null)
         or internal.has_capability('finance.gocardless.connect', 'club', club_id, null));
drop policy if exists session_ok_required on public.club_membership_terms_acceptances;
create policy session_ok_required on public.club_membership_terms_acceptances as restrictive for all to authenticated using ((select internal.session_ok()));
revoke all on public.club_membership_terms_acceptances from anon, authenticated;
grant select on public.club_membership_terms_acceptances to authenticated;

create or replace function public.accept_club_membership_terms(p_club_id uuid, p_version text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  perform internal.require_live_session();
  if not (internal.can('finance.subscription.configure', 'club', p_club_id, null, null)
          or internal.can('finance.gocardless.connect', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorised to agree Club Memberships terms for this club.' using errcode = '42501';
  end if;
  -- Agreement is to the wording actually shown: a stale screen cannot agree to a version it never displayed.
  if p_version is distinct from internal.club_membership_terms_version() then
    raise exception 'These terms have changed. Read the current terms and agree again.' using errcode = '22023';
  end if;
  insert into public.club_membership_terms_acceptances (club_id, version, fee_bps, accepted_by)
  values (p_club_id, p_version, internal.ovalball_fee_bps(), internal.actor())
  returning id into v_id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (internal.actor(), p_club_id, 'membership_terms_accepted', 'club_membership_terms_acceptances', v_id,
          jsonb_build_object('version', p_version, 'fee_bps', internal.ovalball_fee_bps()), 'admin_ui');
  return v_id;
end;
$function$;

revoke all on function internal.club_membership_terms_version() from public, anon, authenticated;
revoke all on function public.accept_club_membership_terms(uuid, text) from public, anon;
grant execute on function public.accept_club_membership_terms(uuid, text) to authenticated;

create or replace function internal.club_membership_terms_accepted(p_club_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.club_membership_terms_acceptances a
                  where a.club_id = p_club_id and a.version = internal.club_membership_terms_version());
$function$;

revoke all on function internal.club_membership_terms_accepted(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 6. READINESS, AND THE ONE READ BOTH CLIENTS SET UP FROM
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.membership_programme_readiness(p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_programme public.club_subscription_programmes;
  v_connection public.gocardless_merchant_connections;
  v_ready_products integer := 0;
  v_missing text[] := array[]::text[];
begin
  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id;
  select * into v_connection from public.gocardless_merchant_connections where club_id = p_club_id and disconnected_at is null;

  if not internal.club_membership_terms_accepted(p_club_id) then
    v_missing := array_append(v_missing, 'TERMS');
  end if;
  if v_connection.id is null then
    v_missing := array_append(v_missing, 'CONNECT');
  elsif v_connection.verification_status <> 'successful' then
    v_missing := array_append(v_missing, 'VERIFY');
  end if;
  if v_programme.id is null or not internal.fee_mode_is_chosen(v_programme.platform_fee_mode) then
    v_missing := array_append(v_missing, 'FEE');
  end if;
  if v_programme.id is not null then
    select count(*) into v_ready_products
      from public.membership_products mp
     where mp.programme_id = v_programme.id and mp.status = 'active'
       and coalesce((select x.amount_minor from internal.membership_product_price(mp.id, current_date) x), 0) >= 100
       and exists (select 1 from public.membership_product_teams mpt where mpt.product_id = mp.id);
  end if;
  if v_ready_products = 0 then
    v_missing := array_append(v_missing, 'MEMBERSHIP');
  end if;

  return jsonb_build_object('can_activate', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing), 'ready_memberships', v_ready_products);
end;
$function$;

revoke all on function internal.membership_programme_readiness(uuid) from public, anon, authenticated;

create or replace function public.membership_setup_state(p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_can_configure boolean;
  v_can_connect boolean;
  v_can_view boolean;
  v_programme public.club_subscription_programmes;
  v_connection public.gocardless_merchant_connections;
  v_connection_state text;
  v_state text;
  v_products jsonb;
  v_teams jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  v_can_configure := internal.can('finance.subscription.configure', 'club', p_club_id, null, null);
  v_can_connect := internal.can('finance.gocardless.connect', 'club', p_club_id, null, null);
  v_can_view := v_can_configure or v_can_connect
             or internal.can('finance.subscription.view', 'club', p_club_id, null, null)
             or internal.has_site_capability('site.commercial.view');
  if not v_can_view then
    raise exception 'Club Memberships need a finance permission at this club.' using errcode = '42501';
  end if;

  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id;
  select * into v_connection from public.gocardless_merchant_connections where club_id = p_club_id;

  -- What the connection means for collecting, in GoCardless's own terms (docs: Getting Your Users Verified).
  v_connection_state := case
    when v_connection.id is null then 'NOT_CONNECTED'
    when v_connection.disconnected_at is not null then 'DISCONNECTED'
    when v_connection.verification_status = 'successful' then 'READY'
    when v_connection.verification_status = 'in_review' then 'VERIFYING'
    when v_connection.verification_status = 'action_required' then 'ACTION_REQUIRED'
    else 'CHECKING' end;

  v_state := case
    when v_programme.id is null then 'NOT_STARTED'
    when v_programme.enabled then 'ACTIVE'
    when v_programme.activated_at is not null then 'PAUSED'
    else 'SETTING_UP' end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mp.id,
           'name', mp.name,
           'sort_order', mp.sort_order,
           'monthly_amount_minor', cur.amount_minor,
           'price_effective_from', cur.effective_from,
           'next_price', (select jsonb_build_object('amount_minor', nx.amount_minor, 'effective_from', nx.effective_from)
                            from public.club_subscription_pricing nx
                           where nx.product_id = mp.id and nx.effective_from > current_date
                           order by nx.effective_from, nx.created_at desc limit 1),
           -- WHAT THIS MEMBERSHIP MEANS IN MONEY for a new member, by the club's chosen fee arrangement: what a member's
           -- Direct Debit collects each month, Ovalball's fee, and what reaches the club before GoCardless's own fees.
           -- Null until the club has a price and has chosen who pays. The same rules as the worked example.
           'money', case when cur.amount_minor is not null and internal.fee_mode_is_chosen(v_programme.platform_fee_mode) then jsonb_build_object(
                      'fee_minor', internal.ovalball_fee_minor(cur.amount_minor, internal.ovalball_fee_bps()),
                      'members_pay_minor', cur.amount_minor + case when v_programme.platform_fee_mode = 'PAYER_SURCHARGE'
                                                                   then internal.ovalball_fee_minor(cur.amount_minor, internal.ovalball_fee_bps()) else 0 end,
                      'club_receives_minor', cur.amount_minor - case when v_programme.platform_fee_mode = 'PAYER_SURCHARGE'
                                                                     then 0 else internal.ovalball_fee_minor(cur.amount_minor, internal.ovalball_fee_bps()) end) end,
           -- Teams carry their structured identity (category, age grade, gender) so both clients can group them the way
           -- the Team Directory does (packages/contracts/src/teams/directory-taxonomy.ts) -- one taxonomy, not a second.
           'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'category', t.category, 'age_group', t.age_group, 'gender', t.gender)
                                                order by ctt.sort_order nulls last, t.display_name)
                                from public.membership_product_teams mpt join public.teams t on t.id = mpt.team_id
                                left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
                               where mpt.product_id = mp.id and t.archived_at is null), '[]'::jsonb),
           'active_memberships', (select count(*) from public.player_subscription_payers psp where psp.product_id = mp.id and psp.status = 'active'))
         order by mp.sort_order, mp.created_at), '[]'::jsonb)
    into v_products
    from public.membership_products mp
    left join lateral (select x.amount_minor, x.effective_from from internal.membership_product_price(mp.id, current_date) x) cur on true
   where mp.programme_id = v_programme.id and mp.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'product_id', mpt.product_id,
                                               'category', t.category, 'age_group', t.age_group, 'gender', t.gender)
                            order by ctt.sort_order nulls last, t.display_name), '[]'::jsonb)
    into v_teams
    from public.teams t
    left join public.membership_product_teams mpt on mpt.team_id = t.id
    left join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
   where t.club_id = p_club_id and t.archived_at is null and coalesce(t.active, true);

  return jsonb_build_object(
    'club_id', p_club_id,
    'state', v_state,
    'can_configure', v_can_configure,
    'can_connect', v_can_connect,
    'connection', jsonb_build_object(
      'state', v_connection_state,
      'verification', case when v_connection.disconnected_at is null then v_connection.verification_status end,
      'environment', v_connection.environment,
      'connected_at', case when v_connection.disconnected_at is null then v_connection.connected_at end,
      'disconnected_at', v_connection.disconnected_at,
      'checked_at', v_connection.status_checked_at),
    'programme', case when v_programme.id is null then null else jsonb_build_object(
      'id', v_programme.id,
      'enabled', v_programme.enabled,
      'activated_at', v_programme.activated_at,
      'collection_day', v_programme.collection_day,
      'first_payment_policy', v_programme.first_payment_policy,
      'fee_mode', v_programme.platform_fee_mode,
      'fee_bearer', case v_programme.platform_fee_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end,
      'currency', v_programme.currency) end,
    'fee_bps', internal.ovalball_fee_bps(),
    'terms', (select jsonb_build_object(
                'version', internal.club_membership_terms_version(),
                'accepted', a.id is not null,
                'accepted_at', a.accepted_at,
                'accepted_by_name', (select nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), '') from public.profiles pr where pr.id = a.accepted_by))
              from (select 1) one
              left join lateral (select x.id, x.accepted_at, x.accepted_by from public.club_membership_terms_acceptances x
                                  where x.club_id = p_club_id and x.version = internal.club_membership_terms_version()
                                  order by x.accepted_at desc limit 1) a on true),
    'memberships', v_products,
    'teams', v_teams,
    'readiness', internal.membership_programme_readiness(p_club_id));
end;
$function$;

revoke all on function public.membership_setup_state(uuid) from public, anon;
grant execute on function public.membership_setup_state(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 7. THE DOORS: settings, memberships, prices, teams, activation, pause
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.require_membership_configure(p_club_id uuid)
 returns void
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  perform internal.require_live_session();
  if not internal.can('finance.subscription.configure', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to set up Club Memberships for this club.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function internal.require_membership_configure(uuid) from public, anon, authenticated;

-- Collection day, first-payment policy and who pays the fee. Creates the programme (switched off) on first
-- save. Reaches new memberships only: each enrolment keeps what it was set up with.
drop function if exists public.save_membership_settings(uuid, integer, text, text);
create or replace function public.save_membership_settings(p_club_id uuid, p_collection_day integer, p_first_payment_policy text, p_fee_bearer text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_old public.club_subscription_programmes;
  v_mode text;
  v_id uuid;
begin
  perform internal.require_membership_configure(p_club_id);
  if p_collection_day is null or p_collection_day < 1 or p_collection_day > 28 then
    raise exception 'Choose a collection day from the 1st to the 28th.' using errcode = '22023';
  end if;
  if p_first_payment_policy not in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY') then
    raise exception 'Choose how a member''s first month is charged.' using errcode = '22023';
  end if;
  select * into v_old from public.club_subscription_programmes where club_id = p_club_id;
  -- No answer yet keeps what is stored ('NONE' on a new programme: not chosen). An unknown answer is refused.
  v_mode := case when p_fee_bearer = 'CLUB' then 'GOCARDLESS_APP_FEE'
                 when p_fee_bearer = 'PAYER' then 'PAYER_SURCHARGE'
                 when p_fee_bearer is null then coalesce(v_old.platform_fee_mode, 'NONE') end;
  if v_mode is null then
    raise exception 'Choose who pays Ovalball''s fee: the club or its members.' using errcode = '22023';
  end if;

  insert into public.club_subscription_programmes (club_id, enabled, collection_day, platform_fee_mode, first_payment_policy, created_by)
  values (p_club_id, false, p_collection_day, v_mode, p_first_payment_policy, internal.actor())
  on conflict (club_id) do update set
    collection_day = excluded.collection_day,
    platform_fee_mode = excluded.platform_fee_mode,
    first_payment_policy = excluded.first_payment_policy,
    updated_by = internal.actor()
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (internal.actor(), p_club_id, 'programme_configured', 'club_subscription_programmes', v_id,
    case when v_old.id is null then null else jsonb_build_object('collection_day', v_old.collection_day, 'first_payment_policy', v_old.first_payment_policy, 'platform_fee_mode', v_old.platform_fee_mode) end,
    jsonb_build_object('collection_day', p_collection_day, 'first_payment_policy', p_first_payment_policy, 'platform_fee_mode', v_mode),
    'admin_ui');
  if v_old.id is not null and v_old.first_payment_policy is distinct from p_first_payment_policy then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (internal.actor(), p_club_id, 'first_payment_policy_changed', 'club_subscription_programmes', v_id,
      jsonb_build_object('programme_id', v_id, 'policy', v_old.first_payment_policy),
      jsonb_build_object('programme_id', v_id, 'policy', p_first_payment_policy), 'admin_ui');
  end if;
  return v_id;
end;
$function$;

create or replace function internal.assign_membership_teams(p_product_id uuid, p_team_ids uuid[], p_actor uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
  v_bad integer;
begin
  select * into v_product from public.membership_products where id = p_product_id;
  select count(*) into v_bad from unnest(coalesce(p_team_ids, array[]::uuid[])) tid
   where not exists (select 1 from public.teams t where t.id = tid and t.club_id = v_product.club_id and t.archived_at is null);
  if v_bad > 0 then
    raise exception 'A membership can only apply to this club''s current teams.' using errcode = '22023';
  end if;
  -- One membership per team: listed teams move here; teams no longer listed stop needing this membership.
  delete from public.membership_product_teams where product_id = p_product_id and not (team_id = any (coalesce(p_team_ids, array[]::uuid[])));
  insert into public.membership_product_teams (team_id, product_id, club_id, assigned_by)
  select tid, p_product_id, v_product.club_id, p_actor from unnest(coalesce(p_team_ids, array[]::uuid[])) tid
  on conflict (team_id) do update set product_id = excluded.product_id, assigned_by = excluded.assigned_by, assigned_at = now();
end;
$function$;

revoke all on function internal.assign_membership_teams(uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function public.create_membership_product(p_club_id uuid, p_name text, p_monthly_amount_minor integer, p_team_ids uuid[])
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_programme public.club_subscription_programmes;
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform internal.require_membership_configure(p_club_id);
  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id;
  if v_programme.id is null then
    raise exception 'Choose the collection settings before adding a membership.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the membership a name of up to 60 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.membership_products where programme_id = v_programme.id and status = 'active' and lower(name) = lower(v_name)) then
    raise exception 'This club already has a membership called %.', v_name using errcode = '23505';
  end if;
  -- Bacs will not collect less than £1 (GoCardless Integration Guide), so neither may a month's price.
  if p_monthly_amount_minor is null or p_monthly_amount_minor < 100 then
    raise exception 'A monthly price must be at least £1.00.' using errcode = '22023';
  end if;
  insert into public.membership_products (programme_id, club_id, name, sort_order, created_by)
  values (v_programme.id, p_club_id, v_name,
          coalesce((select max(sort_order) + 1 from public.membership_products where programme_id = v_programme.id), 0),
          internal.actor())
  returning id into v_id;
  insert into public.club_subscription_pricing (programme_id, product_id, amount_minor, effective_from, created_by)
  values (v_programme.id, v_id, p_monthly_amount_minor, current_date, internal.actor());
  perform internal.assign_membership_teams(v_id, p_team_ids, internal.actor());
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (internal.actor(), p_club_id, 'membership_product_created', 'membership_products', v_id,
          jsonb_build_object('name', v_name, 'monthly_amount_minor', p_monthly_amount_minor, 'team_ids', to_jsonb(coalesce(p_team_ids, array[]::uuid[]))), 'admin_ui');
  return v_id;
end;
$function$;

create or replace function public.rename_membership_product(p_product_id uuid, p_name text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into v_product from public.membership_products where id = p_product_id;
  if v_product.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.require_membership_configure(v_product.club_id);
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the membership a name of up to 60 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.membership_products where programme_id = v_product.programme_id and status = 'active' and lower(name) = lower(v_name) and id <> p_product_id) then
    raise exception 'This club already has a membership called %.', v_name using errcode = '23505';
  end if;
  update public.membership_products set name = v_name, updated_by = internal.actor(), updated_at = now() where id = p_product_id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (internal.actor(), v_product.club_id, 'membership_product_renamed', 'membership_products', p_product_id,
          jsonb_build_object('name', v_product.name), jsonb_build_object('name', v_name), 'admin_ui');
end;
$function$;

-- Effective-dated and prospective, as prices always were: existing members keep the price they joined on.
create or replace function public.set_membership_product_price(p_product_id uuid, p_amount_minor integer, p_effective_from date)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
  v_current integer;
  v_id uuid;
begin
  select * into v_product from public.membership_products where id = p_product_id and status = 'active';
  if v_product.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.require_membership_configure(v_product.club_id);
  if p_amount_minor is null or p_amount_minor < 100 then
    raise exception 'A monthly price must be at least £1.00.' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < current_date then
    raise exception 'A new price can start today or later, never in the past.' using errcode = '22023';
  end if;
  select x.amount_minor into v_current from internal.membership_product_price(p_product_id, current_date) x;
  insert into public.club_subscription_pricing (programme_id, product_id, amount_minor, effective_from, created_by)
  values (v_product.programme_id, p_product_id, p_amount_minor, p_effective_from, internal.actor())
  returning id into v_id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (internal.actor(), v_product.club_id, 'price_changed', 'club_subscription_pricing', v_id,
          jsonb_build_object('amount_minor', v_current, 'product_id', p_product_id),
          jsonb_build_object('amount_minor', p_amount_minor, 'effective_from', p_effective_from, 'product_id', p_product_id), 'admin_ui');
  return v_id;
end;
$function$;

-- The old one-price door keeps working for a club with one membership, and says what to do with several.
create or replace function public.set_subscription_price(p_programme_id uuid, p_amount_minor integer, p_effective_from date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_products uuid[];
  v_current_amount integer;
  v_id uuid;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then raise exception 'Subscription programme not found.'; end if;
  if not (internal.can('finance.subscription.configure', 'club', v_club_id, null, null)) then
    raise exception 'You are not authorised to change pricing for this club.' using errcode = '42501';
  end if;
  if p_amount_minor <= 0 then raise exception 'Amount must be a positive number of minor units (pence).'; end if;
  if p_effective_from < current_date then raise exception 'Effective date cannot be in the past.'; end if;
  select array_agg(id) into v_products from public.membership_products where programme_id = p_programme_id and status = 'active';
  if coalesce(cardinality(v_products), 0) > 1 then
    raise exception 'This club has several memberships. Set the price on the membership itself.' using errcode = '22023';
  end if;

  v_current_amount := public.current_subscription_price(p_programme_id);

  insert into public.club_subscription_pricing (programme_id, product_id, amount_minor, effective_from, created_by)
  values (p_programme_id, coalesce(v_products[1], internal.create_default_membership_product(p_programme_id)), p_amount_minor, p_effective_from, auth.uid())
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), v_club_id, 'price_changed', 'club_subscription_pricing', v_id,
    jsonb_build_object('amount_minor', v_current_amount),
    jsonb_build_object('amount_minor', p_amount_minor, 'effective_from', p_effective_from),
    'admin_ui');

  return v_id;
end;
$function$;

create or replace function public.set_membership_product_teams(p_product_id uuid, p_team_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
  v_before uuid[];
begin
  select * into v_product from public.membership_products where id = p_product_id and status = 'active';
  if v_product.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.require_membership_configure(v_product.club_id);
  select coalesce(array_agg(team_id order by team_id), array[]::uuid[]) into v_before from public.membership_product_teams where product_id = p_product_id;
  perform internal.assign_membership_teams(p_product_id, p_team_ids, internal.actor());
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (internal.actor(), v_product.club_id, 'membership_product_teams_changed', 'membership_products', p_product_id,
          jsonb_build_object('team_ids', to_jsonb(v_before)), jsonb_build_object('team_ids', to_jsonb(coalesce(p_team_ids, array[]::uuid[]))), 'admin_ui');
end;
$function$;

-- A membership somebody holds stays; an active programme always keeps at least one membership.
create or replace function public.archive_membership_product(p_product_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
  v_holders integer;
begin
  select * into v_product from public.membership_products where id = p_product_id and status = 'active';
  if v_product.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.require_membership_configure(v_product.club_id);
  select count(*) into v_holders from public.player_subscription_payers where product_id = p_product_id and status = 'active';
  if v_holders > 0 then
    raise exception '% hold this membership. End their memberships before removing it.',
      case when v_holders = 1 then '1 member' else v_holders || ' members' end using errcode = '23514';
  end if;
  if (select enabled from public.club_subscription_programmes where id = v_product.programme_id)
     and not exists (select 1 from public.membership_products where programme_id = v_product.programme_id and status = 'active' and id <> p_product_id) then
    raise exception 'Club Memberships are switched on, so the club needs at least one membership.' using errcode = '23514';
  end if;
  delete from public.membership_product_teams where product_id = p_product_id;
  update public.membership_products set status = 'archived', updated_by = internal.actor(), updated_at = now() where id = p_product_id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, source)
  values (internal.actor(), v_product.club_id, 'membership_product_archived', 'membership_products', p_product_id,
          jsonb_build_object('name', v_product.name), 'admin_ui');
end;
$function$;

-- OWNER-LOCKED: a Club Admin can switch a player whose teams map to different memberships. It decides the
-- membership the player is set up with; an existing Direct Debit keeps its amount (changing a live member's
-- price is a separate, open decision), so the switch is refused while one is in place.
create or replace function public.set_player_membership_product(p_player_id uuid, p_product_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_product public.membership_products;
begin
  select * into v_product from public.membership_products where id = p_product_id and status = 'active';
  if v_product.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.require_live_session();
  if not internal.can('finance.enrolment.manage', 'club', v_product.club_id, null, null) then
    raise exception 'You are not authorised to change which membership a player holds.' using errcode = '42501';
  end if;
  if not exists (select 1 from internal.membership_products_for_player(v_product.club_id, p_player_id, current_date) a where a.product_id = p_product_id) then
    raise exception 'This player is not in a team that this membership applies to.' using errcode = '22023';
  end if;
  if exists (select 1 from public.player_subscription_payers where player_id = p_player_id and programme_id = v_product.programme_id and status = 'active' and product_id <> p_product_id) then
    raise exception 'This player''s membership is already set up on another membership''s price. Changing a live membership is not available yet.' using errcode = '23514';
  end if;
  insert into public.membership_player_products (player_id, programme_id, club_id, product_id, reason, set_by)
  values (p_player_id, v_product.programme_id, v_product.club_id, p_product_id, nullif(btrim(coalesce(p_reason, '')), ''), internal.actor())
  on conflict (player_id, programme_id) do update set product_id = excluded.product_id, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (internal.actor(), v_product.club_id, 'player_membership_product_set', 'players', p_player_id,
          jsonb_build_object('product_id', p_product_id, 'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'admin_ui');
end;
$function$;

-- THE ACTIVATE DOOR. Readiness is re-derived here, on the server, whatever the client showed.
create or replace function public.activate_membership_programme(p_club_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_programme public.club_subscription_programmes;
  v_readiness jsonb;
begin
  perform internal.require_membership_configure(p_club_id);
  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id for update;
  if v_programme.id is not null and v_programme.enabled then
    return jsonb_build_object('outcome', 'ALREADY_ACTIVE');
  end if;
  v_readiness := internal.membership_programme_readiness(p_club_id);
  if not (v_readiness ->> 'can_activate')::boolean then
    raise exception 'Club Memberships cannot be switched on yet: %.',
      (select string_agg(case m when 'TERMS' then 'agree to the Club Memberships terms'
                                 when 'CONNECT' then 'connect GoCardless'
                                 when 'VERIFY' then 'GoCardless has not verified the club''s account'
                                 when 'FEE' then 'choose who pays Ovalball''s fee'
                                 when 'MEMBERSHIP' then 'add a membership with a price and at least one team' end, '; ')
         from jsonb_array_elements_text(v_readiness -> 'missing') m)
      using errcode = '23514';
  end if;
  update public.club_subscription_programmes
     set enabled = true, activated_at = coalesce(activated_at, now()), updated_by = internal.actor()
   where id = v_programme.id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (internal.actor(), p_club_id, case when v_programme.activated_at is null then 'programme_activated' else 'programme_resumed' end,
          'club_subscription_programmes', v_programme.id,
          jsonb_build_object('collection_day', v_programme.collection_day, 'first_payment_policy', v_programme.first_payment_policy,
                             'platform_fee_mode', v_programme.platform_fee_mode, 'fee_bps', internal.ovalball_fee_bps()), 'admin_ui');
  return jsonb_build_object('outcome', case when v_programme.activated_at is null then 'ACTIVATED' else 'RESUMED' end);
end;
$function$;

-- Turning memberships off stops NEW memberships. It never cancels a Direct Debit already running.
create or replace function public.pause_membership_programme(p_club_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_programme public.club_subscription_programmes;
begin
  perform internal.require_membership_configure(p_club_id);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why new memberships are being stopped.' using errcode = '22023';
  end if;
  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id for update;
  if v_programme.id is null or not v_programme.enabled then
    return jsonb_build_object('outcome', 'ALREADY_PAUSED');
  end if;
  update public.club_subscription_programmes set enabled = false, updated_by = internal.actor() where id = v_programme.id;
  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (internal.actor(), p_club_id, 'programme_paused', 'club_subscription_programmes', v_programme.id,
          jsonb_build_object('reason', btrim(p_reason)), 'admin_ui');
  return jsonb_build_object('outcome', 'PAUSED');
end;
$function$;

-- The old all-in-one door, kept for the settings it saves: collection day, first-payment policy and the fee
-- choice. It no longer switches memberships on or off. Only the Activate door switches them on, because only
-- it re-derives readiness on the server (terms agreed, GoCardless connected and verified, a fee choice, a
-- priced membership with a team); only the Pause door stops new memberships, and it asks why. A call that
-- would change the switch is refused before anything is written, so a malformed or manipulated client cannot
-- turn on a programme Activate would refuse, or pause one without a reason. The fee checks after it stay as a
-- second line. A programme set up before the fee keeps its mode only while it is not changed.
create or replace function public.configure_subscription_programme(p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_current public.club_subscription_programmes;
begin
  if not (internal.can('finance.subscription.configure', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorised to configure subscriptions for this club.' using errcode = '42501';
  end if;

  -- Locked, as Activate and Pause lock it, so the switch compared below cannot change before this call writes.
  select * into v_current from public.club_subscription_programmes where club_id = p_club_id for update;

  -- On or off is not this door's to change. A club with no programme yet counts as off, so this door can only
  -- ever create a programme switched off. An answer that is neither on nor off is refused the same way.
  if p_enabled is distinct from coalesce(v_current.enabled, false) then
    raise exception 'Switch Club Memberships on with Activate, and stop new memberships with Pause New Memberships.' using errcode = '22023';
  end if;

  if p_collection_day < 1 or p_collection_day > 28 then
    raise exception 'Collection day must be between 1 and 28.';
  end if;
  if p_first_payment_policy not in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY') then
    raise exception 'Invalid first payment policy.';
  end if;

  if not internal.fee_mode_is_chosen(p_platform_fee_mode) and p_platform_fee_mode is distinct from v_current.platform_fee_mode then
    raise exception 'Choose who pays Ovalball''s fee: the club (GOCARDLESS_APP_FEE) or its members (PAYER_SURCHARGE).' using errcode = '22023';
  end if;
  if p_enabled and not coalesce(v_current.enabled, false) and not internal.fee_mode_is_chosen(p_platform_fee_mode) then
    raise exception 'Club Memberships cannot be switched on until the club has chosen who pays Ovalball''s fee.' using errcode = '23514';
  end if;

  -- The switch is written only when the programme is created (off, as above). On an existing programme it is
  -- left exactly as it is.
  insert into public.club_subscription_programmes (club_id, enabled, collection_day, platform_fee_mode, first_payment_policy, created_by, activated_at)
  values (p_club_id, p_enabled, p_collection_day, p_platform_fee_mode, p_first_payment_policy, auth.uid(), case when p_enabled then now() end)
  on conflict (club_id) do update set
    collection_day = excluded.collection_day,
    platform_fee_mode = excluded.platform_fee_mode,
    first_payment_policy = excluded.first_payment_policy,
    activated_at = coalesce(club_subscription_programmes.activated_at, case when excluded.enabled then now() end),
    updated_by = auth.uid()
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), p_club_id, 'programme_configured', 'club_subscription_programmes', v_id,
    jsonb_build_object('platform_fee_mode', v_current.platform_fee_mode, 'first_payment_policy', v_current.first_payment_policy),
    jsonb_build_object('enabled', p_enabled, 'collection_day', p_collection_day, 'platform_fee_mode', p_platform_fee_mode, 'first_payment_policy', p_first_payment_policy),
    'admin_ui');

  if v_current.first_payment_policy is not null and v_current.first_payment_policy is distinct from p_first_payment_policy then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (auth.uid(), p_club_id, 'first_payment_policy_changed', 'club_subscription_programmes', v_id,
      jsonb_build_object('programme_id', v_id, 'policy', v_current.first_payment_policy),
      jsonb_build_object('programme_id', v_id, 'policy', p_first_payment_policy),
      'admin_ui');
  end if;

  return v_id;
end;
$function$;

revoke all on function public.save_membership_settings(uuid, integer, text, text) from public, anon;
revoke all on function public.create_membership_product(uuid, text, integer, uuid[]) from public, anon;
revoke all on function public.rename_membership_product(uuid, text) from public, anon;
revoke all on function public.set_membership_product_price(uuid, integer, date) from public, anon;
revoke all on function public.set_membership_product_teams(uuid, uuid[]) from public, anon;
revoke all on function public.archive_membership_product(uuid) from public, anon;
revoke all on function public.set_player_membership_product(uuid, uuid, text) from public, anon;
revoke all on function public.activate_membership_programme(uuid) from public, anon;
revoke all on function public.pause_membership_programme(uuid, text) from public, anon;
grant execute on function public.save_membership_settings(uuid, integer, text, text) to authenticated;
grant execute on function public.create_membership_product(uuid, text, integer, uuid[]) to authenticated;
grant execute on function public.rename_membership_product(uuid, text) to authenticated;
grant execute on function public.set_membership_product_price(uuid, integer, date) to authenticated;
grant execute on function public.set_membership_product_teams(uuid, uuid[]) to authenticated;
grant execute on function public.archive_membership_product(uuid) to authenticated;
grant execute on function public.set_player_membership_product(uuid, uuid, text) to authenticated;
grant execute on function public.activate_membership_programme(uuid) to authenticated;
grant execute on function public.pause_membership_programme(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 8. THE WORKED EXAMPLE, CALCULATED HERE (both clients show the server's sentence-ready numbers)
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.membership_first_payment_example(uuid, integer, date, integer, text, text);
create or replace function public.membership_first_payment_example(
  p_club_id uuid, p_monthly_amount_minor integer, p_join_date date, p_collection_day integer, p_first_payment_policy text, p_fee_bearer text default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_period date := date_trunc('month', p_join_date)::date;
  v_first_amount integer;
  v_first_period date;
  v_first_date date;
  v_prorated boolean := false;
  v_days integer;
  v_total integer;
  v_fee_bps integer := case when p_fee_bearer in ('CLUB', 'PAYER') then internal.ovalball_fee_bps() else 0 end;
  v_first_fee integer;
  v_monthly_fee integer;
  v_payer_pays boolean := p_fee_bearer = 'PAYER';
  v_then_from date;
  v_below_minimum boolean := false;
begin
  if not internal.may_read_membership_price(p_club_id) then
    raise exception 'You are not authorised to see this club''s membership prices.' using errcode = '42501';
  end if;
  if p_monthly_amount_minor is null or p_monthly_amount_minor <= 0 or p_collection_day not between 1 and 28
     or p_first_payment_policy not in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY') then
    return null;
  end if;

  -- The generator's own rules (create_membership_obligations_for_period).
  if p_first_payment_policy = 'NEXT_COLLECTION_DAY' then
    if extract(day from p_join_date)::int > p_collection_day then
      v_first_period := (v_period + interval '1 month')::date;
    else
      v_first_period := v_period;
    end if;
    v_first_amount := p_monthly_amount_minor;
  elsif extract(day from p_join_date)::int = 1 then
    v_first_period := v_period;
    v_first_amount := p_monthly_amount_minor;
  else
    select pr.prorated_amount_minor, pr.chargeable_days, pr.total_days_in_month into v_first_amount, v_days, v_total
      from internal.calculate_first_month_proration(p_join_date, p_monthly_amount_minor) pr;
    v_first_period := v_period;
    v_prorated := true;
  end if;

  v_first_date := v_first_period + (p_collection_day - 1);
  v_then_from := ((v_first_period + interval '1 month')::date) + (p_collection_day - 1);
  v_first_fee := internal.ovalball_fee_minor(v_first_amount, v_fee_bps);
  v_monthly_fee := internal.ovalball_fee_minor(p_monthly_amount_minor, v_fee_bps);
  v_below_minimum := (v_first_amount + (case when v_payer_pays then v_first_fee else 0 end)) < 100;

  return jsonb_build_object(
    'join_date', p_join_date,
    'monthly_amount_minor', p_monthly_amount_minor,
    'first_amount_minor', case when v_below_minimum then 0 else v_first_amount end,
    'first_billing_period', v_first_period,
    -- A pro-rata first month is collected as soon as the Direct Debit is ready, not on the collection day.
    'first_collection_date', case when v_prorated then null else v_first_date end,
    'is_prorated', v_prorated,
    'prorated_days', v_days,
    'days_in_month', v_total,
    'nothing_in_joining_month', v_first_period > v_period,
    'below_minimum', v_below_minimum,
    'then_monthly_from', v_then_from,
    'fee_bps', v_fee_bps,
    'fee_bearer', p_fee_bearer,
    'first_fee_minor', case when v_below_minimum then 0 else v_first_fee end,
    'monthly_fee_minor', v_monthly_fee,
    'first_collect_minor', case when v_below_minimum then 0 else v_first_amount + case when v_payer_pays then v_first_fee else 0 end end,
    'monthly_collect_minor', p_monthly_amount_minor + case when v_payer_pays then v_monthly_fee else 0 end,
    'club_receives_monthly_before_gocardless_minor', p_monthly_amount_minor - case when v_payer_pays then 0 else v_monthly_fee end);
end;
$function$;

revoke all on function public.membership_first_payment_example(uuid, integer, date, integer, text, text) from public, anon;
grant execute on function public.membership_first_payment_example(uuid, integer, date, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 9. ENROLMENT: the player's membership, and what it was set up with
-- -----------------------------------------------------------------------------------------------------
create or replace function public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_programme public.club_subscription_programmes;
  v_relationship text;
  v_id uuid;
  v_pricing record;
  v_product uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  perform internal.require_live_session();
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id and enabled = true;
  v_club_id := v_programme.club_id;
  if v_club_id is null then
    raise exception 'This subscription programme is not available.';
  end if;

  if exists (select 1 from public.players where id = p_player_id and user_id = auth.uid()) then
    if internal.person_is_minor(auth.uid()) then
      raise exception 'A player under 18 cannot be their own responsible payer. A parent or guardian sets up their membership.' using errcode = '42501';
    end if;
    v_relationship := 'self';
  elsif internal.is_active_player_guardian(p_player_id) then
    v_relationship := 'guardian';
  else
    raise exception 'You are not authorised to set up a subscription for this player.' using errcode = '42501';
  end if;

  if exists (select 1 from public.player_subscription_payers where player_id = p_player_id and programme_id = p_programme_id and status = 'active') then
    raise exception 'This player already has an active responsible payer. Ask a Club Admin to change it.';
  end if;

  if not exists (
    select 1 from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id and t.club_id = v_club_id and ptm.status = 'active'
  ) then
    raise exception 'This player does not have an active membership at this club.';
  end if;

  v_product := internal.membership_product_for_player(v_club_id, p_player_id, current_date);
  if v_product is null then
    raise exception 'This player''s team does not have a membership at this club.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_programme_id::text, 0));

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, current_date);
  if v_pricing.final_amount_minor is null then
    raise exception 'No price is configured for this programme.';
  end if;

  insert into public.player_subscription_payers (
    player_id, programme_id, product_id, payer_user_id, relationship, created_by,
    sibling_ordinal, base_amount_minor, sibling_discount_type, sibling_discount_value, sibling_discount_amount_minor, final_amount_minor, pricing_id,
    collection_day, first_payment_policy, platform_fee_mode, platform_fee_bps
  )
  values (
    p_player_id, p_programme_id, v_product, auth.uid(), v_relationship, auth.uid(),
    v_pricing.ordinal, v_pricing.base_amount_minor, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.final_amount_minor, v_pricing.pricing_id,
    v_programme.collection_day, v_programme.first_payment_policy, v_programme.platform_fee_mode,
    case when internal.fee_mode_is_chosen(v_programme.platform_fee_mode) then internal.ovalball_fee_bps() else 0 end
  )
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (
    auth.uid(), v_club_id, 'payer_self_enrolled', 'player_subscription_payers', v_id,
    jsonb_build_object('player_id', p_player_id, 'relationship', v_relationship, 'product_id', v_product, 'sibling_ordinal', v_pricing.ordinal,
                       'final_amount_minor', v_pricing.final_amount_minor, 'platform_fee_mode', v_programme.platform_fee_mode),
    'parent_ui'
  );

  return v_id;
end;
$function$;

-- The club's own payer door now prices and snapshots like the family's, so its enrolments can activate.
create or replace function public.set_responsible_payer(p_player_id uuid, p_programme_id uuid, p_payer_user_id uuid, p_relationship text, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_programme public.club_subscription_programmes;
  v_new_id uuid;
  v_pricing record;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  v_club_id := v_programme.club_id;
  if v_club_id is null then
    raise exception 'Subscription programme not found.';
  end if;
  if not (internal.can('finance.enrolment.manage', 'club', v_club_id, null, null)) then
    raise exception 'You are not authorised to change the responsible payer for this club.' using errcode = '42501';
  end if;
  if p_relationship not in ('guardian', 'self') then
    raise exception 'Invalid payer relationship.';
  end if;
  if p_relationship = 'guardian'
     and not exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = p_payer_user_id and status = 'active') then
    raise exception 'Payer is not an active guardian of this player.';
  end if;
  if p_relationship = 'self' and not exists (select 1 from public.players where id = p_player_id and user_id = p_payer_user_id) then
    raise exception 'Self-pay requires the payer to be the linked player account.';
  end if;
  if p_relationship = 'self' and internal.person_is_minor(p_payer_user_id) then
    raise exception 'A player under 18 cannot be their own responsible payer.' using errcode = '42501';
  end if;

  update public.player_subscription_payers
  set status = 'ended', effective_to = current_date, ended_by = auth.uid(), ended_at = now(), end_reason = coalesce(p_reason, 'Replaced by a new responsible payer.')
  where player_id = p_player_id and programme_id = p_programme_id and status = 'active';

  select * into v_pricing from internal.calculate_member_price(p_programme_id, p_payer_user_id, p_player_id, current_date);

  insert into public.player_subscription_payers (
    player_id, programme_id, product_id, payer_user_id, relationship, created_by,
    sibling_ordinal, base_amount_minor, sibling_discount_type, sibling_discount_value, sibling_discount_amount_minor, final_amount_minor, pricing_id,
    collection_day, first_payment_policy, platform_fee_mode, platform_fee_bps)
  values (
    p_player_id, p_programme_id, internal.membership_product_for_player(v_club_id, p_player_id, current_date), p_payer_user_id, p_relationship, auth.uid(),
    v_pricing.ordinal, v_pricing.base_amount_minor, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.final_amount_minor, v_pricing.pricing_id,
    v_programme.collection_day, v_programme.first_payment_policy, v_programme.platform_fee_mode,
    case when internal.fee_mode_is_chosen(v_programme.platform_fee_mode) then internal.ovalball_fee_bps() else 0 end)
  returning id into v_new_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), v_club_id, 'payer_changed', 'player_subscription_payers', v_new_id, jsonb_build_object('player_id', p_player_id, 'payer_user_id', p_payer_user_id, 'relationship', p_relationship), 'admin_ui');

  return v_new_id;
end;
$function$;

-- "Has a price" is now: the player's own membership has one.
create or replace function public.get_enrolment_eligibility(p_player_id uuid, p_club_id uuid)
 returns table(programme_enabled boolean, has_pricing boolean, merchant_verified boolean, player_has_active_membership boolean, existing_payer_subscription_id uuid, programme_id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select
    coalesce(p.enabled, false),
    exists (select 1 from internal.membership_product_price(internal.membership_product_for_player(p_club_id, p_player_id, current_date), current_date)),
    coalesce((select mc.verification_status = 'successful' from public.gocardless_merchant_connections mc where mc.club_id = p_club_id and mc.disconnected_at is null), false),
    exists (
      select 1 from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
      where ptm.player_id = p_player_id and t.club_id = p_club_id and ptm.status = 'active'
    ),
    (select psp.id from public.player_subscription_payers psp where psp.player_id = p_player_id and psp.programme_id = p.id and psp.status = 'active'),
    p.id
  from public.club_subscription_programmes p
  where p.club_id = p_club_id
    and (internal.is_own_linked_player(p_player_id) or internal.is_active_player_guardian(p_player_id) or internal.can('finance.enrolment.manage', 'club', p_club_id, null, null));
$function$;

-- What a membership's Direct Debit collects each month, with Ovalball's fee: the one answer activation and
-- every screen use. The payer, the club's finance holders and the service role may read it.
create or replace function public.membership_charge_plan(p_payer_subscription_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_psp public.player_subscription_payers;
  v_programme public.club_subscription_programmes;
  v_monthly integer;
  v_bps integer;
  v_fee integer;
  v_payer_pays boolean;
begin
  select * into v_psp from public.player_subscription_payers where id = p_payer_subscription_id;
  if v_psp.id is null then
    return null;
  end if;
  select * into v_programme from public.club_subscription_programmes where id = v_psp.programme_id;
  if not (coalesce(auth.role() = 'service_role', false)
          or v_psp.payer_user_id = internal.actor()
          or internal.can('finance.subscription.view', 'club', v_programme.club_id, null, null)) then
    raise exception 'You are not authorised to see this membership''s charges.' using errcode = '42501';
  end if;
  v_monthly := coalesce(v_psp.final_amount_minor, (select x.amount_minor from internal.membership_product_price(v_psp.product_id, current_date) x));
  v_bps := case when internal.fee_mode_is_chosen(v_psp.platform_fee_mode) then coalesce(v_psp.platform_fee_bps, 0) else 0 end;
  v_fee := internal.ovalball_fee_minor(v_monthly, v_bps);
  v_payer_pays := v_psp.platform_fee_mode = 'PAYER_SURCHARGE';
  return jsonb_build_object(
    'monthly_amount_minor', v_monthly,
    'fee_bps', v_bps,
    'fee_bearer', case v_psp.platform_fee_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end,
    'monthly_fee_minor', v_fee,
    'monthly_payer_fee_minor', case when v_payer_pays then v_fee else 0 end,
    'monthly_collect_minor', v_monthly + case when v_payer_pays then v_fee else 0 end,
    'collection_day', coalesce(v_psp.collection_day, v_programme.collection_day),
    'currency', v_programme.currency);
end;
$function$;

revoke all on function public.membership_charge_plan(uuid) from public, anon;
grant execute on function public.membership_charge_plan(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 10. THE MONTH: each enrolment on its own terms, the fee recorded, nothing stranded by a pause
-- -----------------------------------------------------------------------------------------------------
create or replace function public.create_membership_obligations_for_period(p_club_id uuid, p_billing_period date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_programme record;
  v_created integer := 0;
  v_payer record;
  v_price integer;
  v_pricing_id uuid;
  v_due_date date;
  v_payer_first_period date;
  v_proration record;
  v_amount integer;
  v_is_prorated boolean;
  v_prorate_days integer;
  v_prorate_total integer;
  v_price_as_of date;
  v_status text;
  v_error text;
  v_day integer;
  v_policy text;
  v_bps integer;
  v_fee integer;
  v_payer_fee integer;
  v_reason text;
begin
  if not (
    false
    or internal.can('finance.enrolment.manage', 'club', p_club_id, null, null)
    or auth.role() = 'service_role'
  ) then
    raise exception 'You are not authorised to generate obligations for this club.' using errcode = '42501';
  end if;
  if p_billing_period <> date_trunc('month', p_billing_period)::date then
    raise exception 'billing_period must be the first day of a month.';
  end if;

  -- Switched on, or switched off after it ran: a paused club stops NEW memberships, never existing ones.
  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id and (enabled or activated_at is not null);
  if v_programme is null then
    return 0;
  end if;

  for v_payer in
    select psp.id as payer_subscription_id, psp.player_id, psp.product_id, psp.effective_from, psp.final_amount_minor, psp.pricing_id as snapshot_pricing_id,
           psp.collection_day, psp.first_payment_policy, psp.platform_fee_mode, psp.platform_fee_bps
    from public.player_subscription_payers psp
    where psp.programme_id = v_programme.id and psp.status = 'active'
  loop
    -- ONE MEMBER'S PROBLEM IS THAT MEMBER'S. Each payer is generated on its own, and a failure is recorded where
    -- the club's finance history shows it (finance_audit_log) instead of rolling back the whole club's month.
    begin
      v_payer_first_period := date_trunc('month', v_payer.effective_from)::date;
      v_is_prorated := false;
      v_prorate_days := null;
      v_prorate_total := null;
      v_reason := null;
      -- The terms this membership was set up with; the programme's only for one set up before snapshots.
      v_day := coalesce(v_payer.collection_day, v_programme.collection_day);
      v_policy := coalesce(v_payer.first_payment_policy, v_programme.first_payment_policy);
      v_due_date := p_billing_period + (v_day - 1);

      if v_payer_first_period > p_billing_period then
        continue;
      end if;

      if v_payer.final_amount_minor is not null then
        v_price := v_payer.final_amount_minor;
        v_pricing_id := v_payer.snapshot_pricing_id;
      else
        v_price_as_of := case when v_payer_first_period = p_billing_period then v_payer.effective_from else p_billing_period end;
        select x.pricing_id, x.amount_minor into v_pricing_id, v_price from internal.membership_product_price(v_payer.product_id, v_price_as_of) x;
      end if;
      if v_price is null then
        raise exception 'No price is configured for this membership as of %.', p_billing_period;
      end if;

      if v_payer_first_period < p_billing_period then
        v_amount := v_price;
      else
        if v_policy = 'NEXT_COLLECTION_DAY' then
          if extract(day from v_payer.effective_from)::int > v_day then
            continue;
          else
            v_amount := v_price;
          end if;
        else
          if extract(day from v_payer.effective_from)::int = 1 then
            v_amount := v_price;
          else
            select * into v_proration from internal.calculate_first_month_proration(v_payer.effective_from, v_price);
            v_amount := v_proration.prorated_amount_minor;
            v_is_prorated := true;
            v_prorate_days := v_proration.chargeable_days;
            v_prorate_total := v_proration.total_days_in_month;
          end if;
        end if;
      end if;

      v_bps := case when internal.fee_mode_is_chosen(v_payer.platform_fee_mode) then coalesce(v_payer.platform_fee_bps, 0) else 0 end;
      v_fee := internal.ovalball_fee_minor(v_amount, v_bps);
      v_payer_fee := case when v_payer.platform_fee_mode = 'PAYER_SURCHARGE' then v_fee else 0 end;

      -- NOTHING TO COLLECT IS EXEMPT, NOT AN ERROR. A 100% sibling discount (or a free price) gives a zero
      -- amount; a pro-rata part month below the £1 Direct Debit minimum cannot be collected at all. Each is
      -- recorded as an exempt month, with the reason, and never collected.
      if v_amount = 0 then
        v_status := 'EXEMPT';
        v_reason := 'Nothing to collect: this membership''s price after discount is zero.';
      elsif v_amount + v_payer_fee < 100 then
        v_status := 'EXEMPT';
        v_reason := 'Nothing to collect: this part month is below the £1 Direct Debit minimum.';
        v_amount := 0;
      else
        v_status := 'SETUP_PENDING';
      end if;
      if v_status = 'EXEMPT' then
        v_fee := 0;
        v_payer_fee := 0;
      end if;

      insert into public.membership_obligations (
        programme_id, club_id, player_id, payer_subscription_id, pricing_id, product_id, billing_period, amount_due_minor, currency, due_date, status,
        first_payment_policy_used, is_prorated, proration_chargeable_days, proration_total_days, membership_effective_date,
        platform_fee_mode, platform_fee_bps, platform_fee_minor, payer_fee_minor,
        resolved_at, resolved_reason
      )
      values (
        v_programme.id, p_club_id, v_payer.player_id, v_payer.payer_subscription_id, v_pricing_id, v_payer.product_id, p_billing_period, v_amount, v_programme.currency, v_due_date, v_status,
        v_policy, v_is_prorated, v_prorate_days, v_prorate_total, v_payer.effective_from,
        v_payer.platform_fee_mode, v_bps, v_fee, v_payer_fee,
        case when v_status = 'EXEMPT' then now() end,
        v_reason
      )
      on conflict (player_id, programme_id, billing_period) do nothing;
      if found then
        v_created := v_created + 1;
      end if;
    exception when others then
      get stacked diagnostics v_error = message_text;
      insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
      values (auth.uid(), p_club_id, 'obligation_generation_failed', 'player_subscription_payers', v_payer.payer_subscription_id,
              jsonb_build_object('billing_period', p_billing_period, 'error', v_error), 'system');
    end;
  end loop;

  return v_created;
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 11. RECORDING WHAT WAS ASKED OF GOCARDLESS, FEE INCLUDED
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.record_gocardless_payment(uuid, text, integer, text, date, text, uuid);
create or replace function public.record_gocardless_payment(
  p_obligation_id uuid, p_gc_payment_id text, p_amount_minor integer, p_currency text, p_charge_date date, p_status text,
  p_gocardless_subscription_id uuid default null, p_app_fee_minor integer default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_id uuid;
begin
  select mo.club_id into v_club_id
  from public.membership_obligations mo
  where mo.id = p_obligation_id;

  if v_club_id is null then
    raise exception 'Obligation not found.';
  end if;
  if p_status <> 'pending_submission' then
    raise exception 'A payment may only be recorded as pending_submission at creation time -- use apply_payment_status_transition() for any later status change.';
  end if;
  if p_app_fee_minor is not null and (p_app_fee_minor < 0 or p_app_fee_minor * 2 > p_amount_minor) then
    -- GoCardless: an app fee "must be no more than 50% of the total payment amount".
    raise exception 'An app fee must be between nothing and half of the payment.';
  end if;

  insert into public.gocardless_payments (club_id, obligation_id, gocardless_subscription_id, gc_payment_id, gross_amount_minor, app_fee_minor, currency, status, charge_date)
  values (v_club_id, p_obligation_id, p_gocardless_subscription_id, p_gc_payment_id, p_amount_minor, p_app_fee_minor, p_currency, p_status, p_charge_date)
  on conflict (gc_payment_id) do update set
    charge_date = coalesce(excluded.charge_date, gocardless_payments.charge_date),
    app_fee_minor = coalesce(gocardless_payments.app_fee_minor, excluded.app_fee_minor)
  returning id into v_id;

  update public.membership_obligations
  set gocardless_payment_id = v_id, status = 'SUBMITTED'
  where id = p_obligation_id
    and status not in ('PAID', 'CANCELLED', 'CHARGEDBACK', 'REFUNDED', 'EXEMPT', 'WAIVED');

  return v_id;
end;
$function$;

drop function if exists public.record_gocardless_subscription(uuid, uuid, uuid, text, integer, text);
create or replace function public.record_gocardless_subscription(
  p_payer_subscription_id uuid, p_pricing_id uuid, p_gocardless_mandate_id uuid, p_gc_subscription_id text, p_amount_minor integer, p_status text,
  p_app_fee_minor integer default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_id uuid;
  v_existing_gc_subscription_id text;
begin
  select p.club_id into v_club_id
  from public.player_subscription_payers psp
  join public.club_subscription_programmes p on p.id = psp.programme_id
  where psp.id = p_payer_subscription_id;

  if v_club_id is null then
    raise exception 'Responsible payer not found.';
  end if;
  if p_status not in ('pending', 'active', 'finished', 'cancelled', 'paused') then
    raise exception 'Invalid subscription status.';
  end if;
  if p_app_fee_minor is not null and (p_app_fee_minor < 0 or p_app_fee_minor * 2 > p_amount_minor) then
    raise exception 'An app fee must be between nothing and half of the payment.';
  end if;

  select gc_subscription_id into v_existing_gc_subscription_id
  from public.gocardless_subscriptions
  where payer_subscription_id = p_payer_subscription_id and status in ('pending', 'active')
  limit 1;

  if v_existing_gc_subscription_id is not null and v_existing_gc_subscription_id <> p_gc_subscription_id then
    select id into v_id from public.gocardless_subscriptions where gc_subscription_id = v_existing_gc_subscription_id;
    return v_id;
  end if;

  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, app_fee_minor, status)
  values (v_club_id, p_payer_subscription_id, p_gocardless_mandate_id, p_pricing_id, p_gc_subscription_id, p_amount_minor, p_app_fee_minor, p_status)
  on conflict (gc_subscription_id) do update set status = excluded.status, amount_minor = excluded.amount_minor,
    app_fee_minor = coalesce(excluded.app_fee_minor, gocardless_subscriptions.app_fee_minor)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_gocardless_payment(uuid, text, integer, text, date, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_gocardless_subscription(uuid, uuid, uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.record_gocardless_payment(uuid, text, integer, text, date, text, uuid, integer) to service_role;
grant execute on function public.record_gocardless_subscription(uuid, uuid, uuid, text, integer, text, integer) to service_role;

-- -----------------------------------------------------------------------------------------------------
-- 12. WHERE OVALBALL'S FEE STANDS, FROM THE PAYMENT'S OWN STATE
--     Requested at creation; earned once collected (GoCardless allocates it "once a payment has been
--     successfully collected", IPA cl. 37); returned to the club on a failure or a chargeback (payout items:
--     "in the case of a payment failure or chargeback, these will appear as credits"). What GoCardless does
--     with the fee on a REFUND is not established officially, so a refunded month's fee is UNRESOLVED and never
--     counted as Ovalball's until GoCardless's payout record says so -- no phantom revenue.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.membership_fee_position(p_obligation_id uuid)
 returns table(fee_minor integer, fee_position text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(gp.app_fee_minor, o.platform_fee_minor),
         case
           when coalesce(gp.app_fee_minor, o.platform_fee_minor) = 0 then 'NONE'
           when o.status = 'REFUNDED' or exists (select 1 from public.payment_refunds r where r.payment_id = gp.id) then 'UNRESOLVED'
           when gp.status in ('failed', 'charged_back') then 'RETURNED'
           when gp.status = 'cancelled' then 'NONE'
           when gp.status in ('confirmed', 'paid_out') then 'EARNED'
           when gp.id is not null then 'PENDING'
           else 'EXPECTED'
         end
    from public.membership_obligations o
    left join public.gocardless_payments gp on gp.id = o.gocardless_payment_id
   where o.id = p_obligation_id;
$function$;

revoke all on function internal.membership_fee_position(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 13. THE ONE STANDING, WITH MEMBERSHIPS
--     Who needs membership is now: an active place in a team that maps to a membership, while the club is
--     taking memberships. A paused club's existing members still show, because their Direct Debits still run.
-- -----------------------------------------------------------------------------------------------------
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
           coalesce(case when e.status = 'active' then e.final_amount_minor end,
                    (select x.amount_minor from internal.membership_product_price(
                       coalesce(case when e.status = 'active' then e.product_id end, internal.membership_product_for_player(p_club_id, pop.player_id, coalesce(p_as_of, current_date))),
                       coalesce(p_as_of, current_date)) x)) as monthly_amount_minor,
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
