-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 5/6: Club Subscription + GoCardless Direct Debit domain --
-- schema, RLS, and RPCs.
--
-- This migration's table/RLS DDL was captured via live introspection of
-- Side Project 1's own local database (pg_dump --schema-only against
-- supabase_db_ovalball-parent-player-foundation, table-by-table) rather
-- than manually replaying its ~49 fork-history migrations (many of which
-- are same-day bug-fix patches on top of earlier files in the same set) --
-- this is the genuinely FINAL, currently-live shape of every object,
-- verified directly rather than hand-reconstructed from a sequential diff.
--
-- Verified before writing this file: every foreign key in this domain
-- references only Main-owned tables (clubs, players, teams,
-- player_team_memberships, auth.users) or another table within this same
-- domain -- zero dependency on scheduling_groups/seasons at the schema
-- level, confirming Phase 1's finding that this workstream is genuinely
-- isolated from Main's Mini-Rugby/fixture-scheduling work. Every
-- internal.* helper these functions/policies call
-- (has_capability, is_site_admin, is_active_player_guardian,
-- is_own_linked_player) was confirmed to already exist in Main with a
-- matching signature before this migration was written.
--
-- GoCardless remains sandbox-only. No production credential, no live
-- GoCardless action, no production provider object is created by this
-- migration or by anything it enables.

-- =====================================================================
-- PART A: CAPABILITIES (Club Admin only -- Team staff never gets
-- financial access by default, matching the existing club.guardians.manage
-- precedent from the Player/Guardian foundation migration).
-- =====================================================================
insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('club.gocardless.connect', 'Connect GoCardless', 'Connect or disconnect this club''s GoCardless merchant account.', 'club', array['club']),
  ('club.subscription.configure', 'Configure Club Subscriptions', 'Enable/disable Club Subscriptions, set the monthly amount and collection day.', 'club', array['club']),
  ('club.subscription.view_finance', 'View Finance Dashboard', 'View the Club Subscriptions finance dashboard, revenue, and payment statistics.', 'club', array['club']),
  ('club.subscription.manage_enrolment', 'Manage Subscription Enrolment', 'Invite parents to subscribe, change the responsible payer, mark exempt/waived.', 'club', array['club']),
  ('club.subscription.manage_payment_actions', 'Manage Payment Actions', 'Retry a failed payment, cancel a subscription, apply a refund.', 'club', array['club']),
  ('club.subscription.export', 'Export Subscription Data', 'Export the subscriber/payment ledger as CSV.', 'club', array['club'])
on conflict (key) do nothing;

-- Re-derived from Main's CURRENT live definition (the same pattern used in
-- the Player/Guardian foundation migration) -- Club Admin only, never
-- granted to the Team-staff tier, matching this workstream's own
-- financial-access decision.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      'team.guardians.invite', 'club.guardians.manage', 'team.community.manage', 'team.attendance.view',
      'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
      'club.subscription.manage_enrolment', 'club.subscription.manage_payment_actions', 'club.subscription.export'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$function$;

-- =====================================================================
-- PART B: SCHEMA (tables, constraints, indexes, triggers, RLS -- verbatim
-- from Side Project 1's live, final schema; see header note above).
-- =====================================================================
CREATE TABLE public.club_subscription_pricing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    amount_minor integer NOT NULL,
    effective_from date NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_subscription_pricing_amount_minor_check CHECK ((amount_minor > 0))
);


--
-- Name: TABLE club_subscription_pricing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.club_subscription_pricing IS 'Section 22-23, 63-65: effective-dated pricing. The price for a given billing_period is resolved as the row with the latest effective_from <= that period''s first day. A price change never rewrites history -- membership_obligations.pricing_id (Part F) pins each obligation to the exact row used at creation time, so a later price change can never retroactively alter an already-created obligation''s amount_due.';


--
-- Name: club_subscription_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_subscription_programmes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    currency text DEFAULT 'GBP'::text NOT NULL,
    collection_day integer DEFAULT 1 NOT NULL,
    first_payment_policy text DEFAULT 'NEXT_COLLECTION_DAY'::text NOT NULL,
    platform_fee_mode text DEFAULT 'NONE'::text NOT NULL,
    platform_fee_minor integer,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_subscription_programmes_collection_day_check CHECK (((collection_day >= 1) AND (collection_day <= 28))),
    CONSTRAINT club_subscription_programmes_currency_check CHECK ((currency = 'GBP'::text)),
    CONSTRAINT club_subscription_programmes_first_payment_policy_check CHECK ((first_payment_policy = ANY (ARRAY['PRORATE_CURRENT_MONTH'::text, 'NEXT_COLLECTION_DAY'::text]))),
    CONSTRAINT club_subscription_programmes_platform_fee_minor_check CHECK (((platform_fee_minor IS NULL) OR (platform_fee_minor >= 0))),
    CONSTRAINT club_subscription_programmes_platform_fee_mode_check CHECK ((platform_fee_mode = ANY (ARRAY['NONE'::text, 'PARTNER_REVENUE_SHARE'::text, 'GOCARDLESS_APP_FEE'::text, 'PAYER_SURCHARGE'::text, 'CLUB_SAAS_FEE'::text])))
);


--
-- Name: TABLE club_subscription_programmes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.club_subscription_programmes IS 'Section 13-14, 19: canonical club-wide subscription configuration. Deliberately NOT season-scoped (see docs/GOCARDLESS_MAIN_PROJECT_REVIEW.md''s documented decision) -- continuous club membership, not season-ticket-style. `enabled=true` does not itself mean collection is possible; server-side readiness additionally checks a verified GoCardless connection at enrolment time (Section 66).';


--
-- Name: COLUMN club_subscription_programmes.first_payment_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.club_subscription_programmes.first_payment_policy IS 'Section 1-3, pre-flight billing policy amendment: the Club''s own choice for how a mid-month joiner''s first payment works. PRORATE_CURRENT_MONTH = charge a calendar-day-prorated amount for the remainder of the join month, then full months from the next 1st. NEXT_COLLECTION_DAY = no charge for the partial month, first full obligation is the next 1st. Never a Parent choice. Changing this affects only NEW membership obligations generated after the change -- see membership_obligations.first_payment_policy_used for the immutable per-obligation snapshot.';


--
-- Name: club_subscription_sibling_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_subscription_sibling_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    ordinal integer NOT NULL,
    discount_type text NOT NULL,
    discount_value integer DEFAULT 0 NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT club_subscription_sibling_rules_discount_type_check CHECK ((discount_type = ANY (ARRAY['NONE'::text, 'PERCENTAGE'::text, 'FIXED'::text]))),
    CONSTRAINT club_subscription_sibling_rules_fixed_nonnegative CHECK (((discount_type <> 'FIXED'::text) OR (discount_value >= 0))),
    CONSTRAINT club_subscription_sibling_rules_ordinal_check CHECK ((ordinal >= 2)),
    CONSTRAINT club_subscription_sibling_rules_percentage_range CHECK (((discount_type <> 'PERCENTAGE'::text) OR ((discount_value >= 0) AND (discount_value <= 100))))
);


--
-- Name: finance_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    club_id uuid NOT NULL,
    action text NOT NULL,
    target_table text NOT NULL,
    target_id uuid,
    old_value jsonb,
    new_value jsonb,
    source text DEFAULT 'admin_ui'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT finance_audit_log_source_check CHECK ((source = ANY (ARRAY['admin_ui'::text, 'parent_ui'::text, 'webhook'::text, 'system'::text])))
);


--
-- Name: TABLE finance_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.finance_audit_log IS 'Section 82: high-impact finance action audit trail. old_value/new_value are deliberately narrow, hand-built jsonb (never to_jsonb(row)) so a secret column can never leak into this table by accident the way it could with the generic row-diff trigger.';


--
-- Name: gocardless_billing_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_billing_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    payer_subscription_id uuid NOT NULL,
    gc_billing_request_id text NOT NULL,
    gc_billing_request_flow_id text,
    authorisation_url text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_billing_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'authorised'::text, 'fulfilled'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: TABLE gocardless_billing_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_billing_requests IS 'Section 35: tracks the hosted mandate-authorization flow between "Parent clicked Set Up Direct Debit" and the webhook confirming a real mandate exists. authorisation_url is the GoCardless-hosted page the Parent is redirected to -- Ovalball never collects bank details itself.';


--
-- Name: gocardless_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    payer_user_id uuid NOT NULL,
    gc_customer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE gocardless_customers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_customers IS 'Section 70: a GoCardless customer is merchant-scoped. The SAME Guardian paying for children at two clubs gets TWO rows here, one per club, each with its own gc_customer_id under that club''s own merchant -- never a single shared customer record.';


--
-- Name: gocardless_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid,
    gc_event_id text NOT NULL,
    resource_type text NOT NULL,
    action text NOT NULL,
    payload jsonb NOT NULL,
    processed boolean DEFAULT false NOT NULL,
    processed_at timestamp with time zone,
    processing_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE gocardless_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_events IS 'Section 82-83: the event-inbox. Every webhook delivery is inserted here FIRST (on gc_event_id conflict, do nothing -- see record_gocardless_event() below) and only then processed; processing re-fetches current state from the GoCardless API rather than trusting the payload as final truth, per Section 83. club_id is nullable because some events (e.g. an organisation-level event before any club is resolved) may arrive before the target club is known.';


--
-- Name: gocardless_mandates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_mandates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    gocardless_customer_id uuid NOT NULL,
    billing_request_id uuid,
    gc_mandate_id text NOT NULL,
    status text DEFAULT 'pending_submission'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scheme text,
    next_possible_charge_date date,
    CONSTRAINT gocardless_mandates_status_check CHECK ((status = ANY (ARRAY['pending_submission'::text, 'submitted'::text, 'active'::text, 'failed'::text, 'cancelled'::text, 'expired'::text, 'consumed'::text])))
);


--
-- Name: TABLE gocardless_mandates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_mandates IS 'Status values mirror GoCardless''s own mandate resource states (docs/GOCARDLESS_OFFICIAL_RESEARCH.md Part 4). Never exposed directly to the UI as-is -- lib/payments/gocardless/mapper.ts translates to the domain enrolment state machine (Section 14).';


--
-- Name: COLUMN gocardless_mandates.scheme; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gocardless_mandates.scheme IS 'Real GoCardless mandate scheme (e.g. bacs) -- read from the provider, never guessed.';


--
-- Name: COLUMN gocardless_mandates.next_possible_charge_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gocardless_mandates.next_possible_charge_date IS 'Real GoCardless mandate.next_possible_charge_date -- informational only, never a promise of collection timing.';


--
-- Name: gocardless_merchant_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_merchant_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    environment text DEFAULT 'sandbox'::text NOT NULL,
    gc_organisation_id text NOT NULL,
    access_token text NOT NULL,
    scope text NOT NULL,
    verification_status text DEFAULT 'unknown'::text NOT NULL,
    connected_by uuid NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    disconnected_by uuid,
    disconnected_at timestamp with time zone,
    status_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_merchant_connections_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text]))),
    CONSTRAINT gocardless_merchant_connections_verification_status_check CHECK ((verification_status = ANY (ARRAY['action_required'::text, 'in_review'::text, 'successful'::text, 'unknown'::text])))
);


--
-- Name: TABLE gocardless_merchant_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_merchant_connections IS 'Section 16-17: ONE merchant connection per club, isolated. access_token is server-only -- this table has no SELECT policy for authenticated/anon at all; every UI read goes through get_gocardless_connection_status() (safe fields only) or a SECURITY DEFINER RPC that uses the token internally, never returns it.';


--
-- Name: gocardless_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    obligation_id uuid NOT NULL,
    gocardless_subscription_id uuid,
    gc_payment_id text NOT NULL,
    gross_amount_minor integer NOT NULL,
    provider_fee_minor integer,
    app_fee_minor integer,
    net_amount_minor integer,
    currency text DEFAULT 'GBP'::text NOT NULL,
    status text NOT NULL,
    charge_date date,
    submitted_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    failed_at timestamp with time zone,
    failure_reason_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_payments_currency_check CHECK ((currency = 'GBP'::text)),
    CONSTRAINT gocardless_payments_gross_amount_minor_check CHECK ((gross_amount_minor > 0)),
    CONSTRAINT gocardless_payments_status_check CHECK ((status = ANY (ARRAY['pending_submission'::text, 'submitted'::text, 'confirmed'::text, 'paid_out'::text, 'failed'::text, 'cancelled'::text, 'charged_back'::text])))
);


--
-- Name: TABLE gocardless_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_payments IS 'Section 44: FAILED means GoCardless reported a failure event. OVERDUE (on membership_obligations, not here) means an expected obligation passed its processing window with no settlement -- these are never conflated. failure_reason_code stores GoCardless''s own reason code only (e.g. mandate_failure, insufficient_funds) -- never free-text bank detail.';


--
-- Name: gocardless_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    gc_payout_id text NOT NULL,
    amount_minor integer NOT NULL,
    currency text DEFAULT 'GBP'::text NOT NULL,
    status text NOT NULL,
    arrival_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_payouts_currency_check CHECK ((currency = 'GBP'::text)),
    CONSTRAINT gocardless_payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'bounced'::text])))
);


--
-- Name: gocardless_reconciliation_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_reconciliation_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_id uuid NOT NULL,
    payment_id uuid,
    entry_type text NOT NULL,
    amount_minor integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_reconciliation_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['payment'::text, 'refund'::text, 'gc_fee'::text, 'app_fee'::text])))
);


--
-- Name: gocardless_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gocardless_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id uuid NOT NULL,
    payer_subscription_id uuid NOT NULL,
    gocardless_mandate_id uuid NOT NULL,
    pricing_id uuid NOT NULL,
    gc_subscription_id text,
    amount_minor integer NOT NULL,
    app_fee_minor integer,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gocardless_subscriptions_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT gocardless_subscriptions_app_fee_minor_check CHECK (((app_fee_minor IS NULL) OR (app_fee_minor >= 0))),
    CONSTRAINT gocardless_subscriptions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'finished'::text, 'cancelled'::text, 'paused'::text])))
);


--
-- Name: TABLE gocardless_subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gocardless_subscriptions IS 'Section 22: GoCardless subscriptions are fixed-amount for their whole life -- a local price change (Part C) means CANCEL this row''s gc_subscription_id and CREATE a new one at the new pricing_id, never a PATCH of amount_minor. pricing_id pins exactly which club_subscription_pricing row this provider subscription was created against.';


--
-- Name: membership_obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    club_id uuid NOT NULL,
    player_id uuid NOT NULL,
    payer_subscription_id uuid NOT NULL,
    pricing_id uuid NOT NULL,
    billing_period date NOT NULL,
    amount_due_minor integer NOT NULL,
    currency text DEFAULT 'GBP'::text NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'SETUP_PENDING'::text NOT NULL,
    gocardless_payment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_reason text,
    first_payment_policy_used text,
    is_prorated boolean DEFAULT false NOT NULL,
    proration_chargeable_days integer,
    proration_total_days integer,
    membership_effective_date date,
    CONSTRAINT membership_obligations_amount_due_minor_check CHECK ((amount_due_minor > 0)),
    CONSTRAINT membership_obligations_currency_check CHECK ((currency = 'GBP'::text)),
    CONSTRAINT membership_obligations_first_payment_policy_used_check CHECK (((first_payment_policy_used IS NULL) OR (first_payment_policy_used = ANY (ARRAY['PRORATE_CURRENT_MONTH'::text, 'NEXT_COLLECTION_DAY'::text])))),
    CONSTRAINT membership_obligations_period_is_first_of_month CHECK ((billing_period = (date_trunc('month'::text, (billing_period)::timestamp with time zone))::date)),
    CONSTRAINT membership_obligations_proration_fields_consistent CHECK ((((is_prorated = false) AND (proration_chargeable_days IS NULL) AND (proration_total_days IS NULL)) OR ((is_prorated = true) AND (proration_chargeable_days IS NOT NULL) AND (proration_total_days IS NOT NULL) AND (proration_chargeable_days > 0) AND (proration_chargeable_days <= proration_total_days)))),
    CONSTRAINT membership_obligations_status_check CHECK ((status = ANY (ARRAY['SETUP_PENDING'::text, 'READY'::text, 'SCHEDULED'::text, 'SUBMITTED'::text, 'PAID'::text, 'FAILED'::text, 'RETRYING'::text, 'OVERDUE'::text, 'CANCELLED'::text, 'EXEMPT'::text, 'WAIVED'::text, 'REFUNDED'::text, 'CHARGEDBACK'::text])))
);


--
-- Name: TABLE membership_obligations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.membership_obligations IS 'Section 28-31: the canonical business-truth table for "who owes what for which month" -- a missing/absent provider payment does NOT tell you which state applies; this table is that state, evidenced (not superseded) by gocardless_payments. billing_period is always the first calendar day of the month (Section 30: structural, never a display string). gocardless_payment_id is set once a provider payment is created for this obligation (FK added after gocardless_payments exists below) and is the idempotency anchor Section 108 requires: one obligation maps to at most one non-cancelled provider payment at a time.';


--
-- Name: COLUMN membership_obligations.first_payment_policy_used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.membership_obligations.first_payment_policy_used IS 'Snapshot of club_subscription_programmes.first_payment_policy at the moment THIS obligation was generated -- never re-derived later. A later policy change on the programme never alters this value or this obligation''s amount (Section 8-9).';


--
-- Name: COLUMN membership_obligations.membership_effective_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.membership_obligations.membership_effective_date IS 'Snapshot of player_subscription_payers.effective_from used to calculate this specific obligation -- kept independent of the payer row''s current effective_from in case that is ever reassigned later (Section 74), so this obligation''s own provenance never silently changes.';


--
-- Name: payment_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    gc_refund_id text,
    amount_minor integer NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_refunds_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT payment_refunds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text])))
);


--
-- Name: player_subscription_payers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_subscription_payers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_id uuid NOT NULL,
    programme_id uuid NOT NULL,
    payer_user_id uuid NOT NULL,
    relationship text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_by uuid,
    ended_at timestamp with time zone,
    end_reason text,
    sibling_ordinal integer,
    base_amount_minor integer,
    sibling_discount_type text,
    sibling_discount_value integer,
    sibling_discount_amount_minor integer,
    final_amount_minor integer,
    pricing_id uuid,
    CONSTRAINT player_subscription_payers_ended_requires_date CHECK (((status = 'active'::text) OR (effective_to IS NOT NULL))),
    CONSTRAINT player_subscription_payers_final_amount_nonnegative CHECK (((final_amount_minor IS NULL) OR (final_amount_minor >= 0))),
    CONSTRAINT player_subscription_payers_relationship_check CHECK ((relationship = ANY (ARRAY['guardian'::text, 'self'::text]))),
    CONSTRAINT player_subscription_payers_sibling_discount_type_check CHECK (((sibling_discount_type IS NULL) OR (sibling_discount_type = ANY (ARRAY['NONE'::text, 'PERCENTAGE'::text, 'FIXED'::text])))),
    CONSTRAINT player_subscription_payers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])))
);


--
-- Name: TABLE player_subscription_payers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.player_subscription_payers IS 'Section 25-27: the responsible payer for one Player''s subscription under one club programme. Never inferred from guardians.status -- always an explicit row. A Player may have multiple historical payer rows over time (Section 74: payer changes are a financial action, never silently overwritten) but at most ONE active row per (player_id, programme_id) at once, enforced below.';


--
-- Name: club_subscription_pricing club_subscription_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_pricing
    ADD CONSTRAINT club_subscription_pricing_pkey PRIMARY KEY (id);


--
-- Name: club_subscription_programmes club_subscription_programmes_club_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_programmes
    ADD CONSTRAINT club_subscription_programmes_club_id_key UNIQUE (club_id);


--
-- Name: club_subscription_programmes club_subscription_programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_programmes
    ADD CONSTRAINT club_subscription_programmes_pkey PRIMARY KEY (id);


--
-- Name: club_subscription_sibling_rules club_subscription_sibling_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_sibling_rules
    ADD CONSTRAINT club_subscription_sibling_rules_pkey PRIMARY KEY (id);


--
-- Name: finance_audit_log finance_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_audit_log
    ADD CONSTRAINT finance_audit_log_pkey PRIMARY KEY (id);


--
-- Name: gocardless_billing_requests gocardless_billing_requests_gc_billing_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_billing_requests
    ADD CONSTRAINT gocardless_billing_requests_gc_billing_request_id_key UNIQUE (gc_billing_request_id);


--
-- Name: gocardless_billing_requests gocardless_billing_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_billing_requests
    ADD CONSTRAINT gocardless_billing_requests_pkey PRIMARY KEY (id);


--
-- Name: gocardless_customers gocardless_customers_club_id_gc_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_customers
    ADD CONSTRAINT gocardless_customers_club_id_gc_customer_id_key UNIQUE (club_id, gc_customer_id);


--
-- Name: gocardless_customers gocardless_customers_club_id_payer_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_customers
    ADD CONSTRAINT gocardless_customers_club_id_payer_user_id_key UNIQUE (club_id, payer_user_id);


--
-- Name: gocardless_customers gocardless_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_customers
    ADD CONSTRAINT gocardless_customers_pkey PRIMARY KEY (id);


--
-- Name: gocardless_events gocardless_events_gc_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_events
    ADD CONSTRAINT gocardless_events_gc_event_id_key UNIQUE (gc_event_id);


--
-- Name: gocardless_events gocardless_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_events
    ADD CONSTRAINT gocardless_events_pkey PRIMARY KEY (id);


--
-- Name: gocardless_mandates gocardless_mandates_gc_mandate_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_mandates
    ADD CONSTRAINT gocardless_mandates_gc_mandate_id_key UNIQUE (gc_mandate_id);


--
-- Name: gocardless_mandates gocardless_mandates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_mandates
    ADD CONSTRAINT gocardless_mandates_pkey PRIMARY KEY (id);


--
-- Name: gocardless_merchant_connections gocardless_merchant_connections_club_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_merchant_connections
    ADD CONSTRAINT gocardless_merchant_connections_club_id_key UNIQUE (club_id);


--
-- Name: gocardless_merchant_connections gocardless_merchant_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_merchant_connections
    ADD CONSTRAINT gocardless_merchant_connections_pkey PRIMARY KEY (id);


--
-- Name: gocardless_payments gocardless_payments_gc_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payments
    ADD CONSTRAINT gocardless_payments_gc_payment_id_key UNIQUE (gc_payment_id);


--
-- Name: gocardless_payments gocardless_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payments
    ADD CONSTRAINT gocardless_payments_pkey PRIMARY KEY (id);


--
-- Name: gocardless_payouts gocardless_payouts_gc_payout_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payouts
    ADD CONSTRAINT gocardless_payouts_gc_payout_id_key UNIQUE (gc_payout_id);


--
-- Name: gocardless_payouts gocardless_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payouts
    ADD CONSTRAINT gocardless_payouts_pkey PRIMARY KEY (id);


--
-- Name: gocardless_reconciliation_entries gocardless_reconciliation_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_reconciliation_entries
    ADD CONSTRAINT gocardless_reconciliation_entries_pkey PRIMARY KEY (id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_gc_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_gc_subscription_id_key UNIQUE (gc_subscription_id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: membership_obligations membership_obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_pkey PRIMARY KEY (id);


--
-- Name: membership_obligations membership_obligations_unique_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_unique_period UNIQUE (player_id, programme_id, billing_period);


--
-- Name: payment_refunds payment_refunds_gc_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_gc_refund_id_key UNIQUE (gc_refund_id);


--
-- Name: payment_refunds payment_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_pkey PRIMARY KEY (id);


--
-- Name: player_subscription_payers player_subscription_payers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_pkey PRIMARY KEY (id);


--
-- Name: club_subscription_pricing_programme_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX club_subscription_pricing_programme_effective_idx ON public.club_subscription_pricing USING btree (programme_id, effective_from DESC);


--
-- Name: club_subscription_sibling_rules_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX club_subscription_sibling_rules_lookup_idx ON public.club_subscription_sibling_rules USING btree (programme_id, ordinal, effective_from DESC);


--
-- Name: finance_audit_log_club_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_audit_log_club_idx ON public.finance_audit_log USING btree (club_id, created_at DESC);


--
-- Name: gocardless_events_unprocessed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gocardless_events_unprocessed_idx ON public.gocardless_events USING btree (created_at) WHERE (processed = false);


--
-- Name: gocardless_payments_club_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gocardless_payments_club_status_idx ON public.gocardless_payments USING btree (club_id, status);


--
-- Name: gocardless_payments_obligation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gocardless_payments_obligation_idx ON public.gocardless_payments USING btree (obligation_id);


--
-- Name: gocardless_subscriptions_payer_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gocardless_subscriptions_payer_sub_idx ON public.gocardless_subscriptions USING btree (payer_subscription_id) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text]));


--
-- Name: membership_obligations_club_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_obligations_club_period_idx ON public.membership_obligations USING btree (club_id, billing_period);


--
-- Name: membership_obligations_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_obligations_player_idx ON public.membership_obligations USING btree (player_id);


--
-- Name: membership_obligations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_obligations_status_idx ON public.membership_obligations USING btree (club_id, status) WHERE (status = ANY (ARRAY['FAILED'::text, 'OVERDUE'::text, 'RETRYING'::text]));


--
-- Name: player_subscription_payers_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX player_subscription_payers_one_active_idx ON public.player_subscription_payers USING btree (player_id, programme_id) WHERE (status = 'active'::text);


--
-- Name: player_subscription_payers_payer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_subscription_payers_payer_idx ON public.player_subscription_payers USING btree (payer_user_id) WHERE (status = 'active'::text);


--
-- Name: club_subscription_programmes audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE ON public.club_subscription_programmes FOR EACH ROW EXECUTE FUNCTION internal.audit_row_change();


--
-- Name: club_subscription_programmes set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.club_subscription_programmes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_billing_requests set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_billing_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_customers set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_mandates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_mandates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_merchant_connections set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_merchant_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_payments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_payouts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_payouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: gocardless_subscriptions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gocardless_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: club_subscription_pricing club_subscription_pricing_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_pricing
    ADD CONSTRAINT club_subscription_pricing_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: club_subscription_pricing club_subscription_pricing_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_pricing
    ADD CONSTRAINT club_subscription_pricing_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.club_subscription_programmes(id);


--
-- Name: club_subscription_programmes club_subscription_programmes_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_programmes
    ADD CONSTRAINT club_subscription_programmes_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: club_subscription_programmes club_subscription_programmes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_programmes
    ADD CONSTRAINT club_subscription_programmes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: club_subscription_programmes club_subscription_programmes_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_programmes
    ADD CONSTRAINT club_subscription_programmes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: club_subscription_sibling_rules club_subscription_sibling_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_sibling_rules
    ADD CONSTRAINT club_subscription_sibling_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: club_subscription_sibling_rules club_subscription_sibling_rules_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_subscription_sibling_rules
    ADD CONSTRAINT club_subscription_sibling_rules_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.club_subscription_programmes(id);


--
-- Name: finance_audit_log finance_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_audit_log
    ADD CONSTRAINT finance_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: finance_audit_log finance_audit_log_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_audit_log
    ADD CONSTRAINT finance_audit_log_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_billing_requests gocardless_billing_requests_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_billing_requests
    ADD CONSTRAINT gocardless_billing_requests_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_billing_requests gocardless_billing_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_billing_requests
    ADD CONSTRAINT gocardless_billing_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: gocardless_billing_requests gocardless_billing_requests_payer_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_billing_requests
    ADD CONSTRAINT gocardless_billing_requests_payer_subscription_id_fkey FOREIGN KEY (payer_subscription_id) REFERENCES public.player_subscription_payers(id);


--
-- Name: gocardless_customers gocardless_customers_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_customers
    ADD CONSTRAINT gocardless_customers_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_customers gocardless_customers_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_customers
    ADD CONSTRAINT gocardless_customers_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES auth.users(id);


--
-- Name: gocardless_events gocardless_events_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_events
    ADD CONSTRAINT gocardless_events_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_mandates gocardless_mandates_billing_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_mandates
    ADD CONSTRAINT gocardless_mandates_billing_request_id_fkey FOREIGN KEY (billing_request_id) REFERENCES public.gocardless_billing_requests(id);


--
-- Name: gocardless_mandates gocardless_mandates_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_mandates
    ADD CONSTRAINT gocardless_mandates_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_mandates gocardless_mandates_gocardless_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_mandates
    ADD CONSTRAINT gocardless_mandates_gocardless_customer_id_fkey FOREIGN KEY (gocardless_customer_id) REFERENCES public.gocardless_customers(id);


--
-- Name: gocardless_merchant_connections gocardless_merchant_connections_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_merchant_connections
    ADD CONSTRAINT gocardless_merchant_connections_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_merchant_connections gocardless_merchant_connections_connected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_merchant_connections
    ADD CONSTRAINT gocardless_merchant_connections_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES auth.users(id);


--
-- Name: gocardless_merchant_connections gocardless_merchant_connections_disconnected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_merchant_connections
    ADD CONSTRAINT gocardless_merchant_connections_disconnected_by_fkey FOREIGN KEY (disconnected_by) REFERENCES auth.users(id);


--
-- Name: gocardless_payments gocardless_payments_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payments
    ADD CONSTRAINT gocardless_payments_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_payments gocardless_payments_gocardless_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payments
    ADD CONSTRAINT gocardless_payments_gocardless_subscription_id_fkey FOREIGN KEY (gocardless_subscription_id) REFERENCES public.gocardless_subscriptions(id);


--
-- Name: gocardless_payments gocardless_payments_obligation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payments
    ADD CONSTRAINT gocardless_payments_obligation_id_fkey FOREIGN KEY (obligation_id) REFERENCES public.membership_obligations(id);


--
-- Name: gocardless_payouts gocardless_payouts_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_payouts
    ADD CONSTRAINT gocardless_payouts_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_reconciliation_entries gocardless_reconciliation_entries_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_reconciliation_entries
    ADD CONSTRAINT gocardless_reconciliation_entries_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.gocardless_payments(id);


--
-- Name: gocardless_reconciliation_entries gocardless_reconciliation_entries_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_reconciliation_entries
    ADD CONSTRAINT gocardless_reconciliation_entries_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.gocardless_payouts(id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_gocardless_mandate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_gocardless_mandate_id_fkey FOREIGN KEY (gocardless_mandate_id) REFERENCES public.gocardless_mandates(id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_payer_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_payer_subscription_id_fkey FOREIGN KEY (payer_subscription_id) REFERENCES public.player_subscription_payers(id);


--
-- Name: gocardless_subscriptions gocardless_subscriptions_pricing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gocardless_subscriptions
    ADD CONSTRAINT gocardless_subscriptions_pricing_id_fkey FOREIGN KEY (pricing_id) REFERENCES public.club_subscription_pricing(id);


--
-- Name: membership_obligations membership_obligations_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id);


--
-- Name: membership_obligations membership_obligations_payer_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_payer_subscription_id_fkey FOREIGN KEY (payer_subscription_id) REFERENCES public.player_subscription_payers(id);


--
-- Name: membership_obligations membership_obligations_payment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_payment_fk FOREIGN KEY (gocardless_payment_id) REFERENCES public.gocardless_payments(id);


--
-- Name: membership_obligations membership_obligations_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: membership_obligations membership_obligations_pricing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_pricing_id_fkey FOREIGN KEY (pricing_id) REFERENCES public.club_subscription_pricing(id);


--
-- Name: membership_obligations membership_obligations_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_obligations
    ADD CONSTRAINT membership_obligations_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.club_subscription_programmes(id);


--
-- Name: payment_refunds payment_refunds_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: payment_refunds payment_refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.gocardless_payments(id);


--
-- Name: player_subscription_payers player_subscription_payers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: player_subscription_payers player_subscription_payers_ended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES auth.users(id);


--
-- Name: player_subscription_payers player_subscription_payers_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES auth.users(id);


--
-- Name: player_subscription_payers player_subscription_payers_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: player_subscription_payers player_subscription_payers_pricing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_pricing_id_fkey FOREIGN KEY (pricing_id) REFERENCES public.club_subscription_pricing(id);


--
-- Name: player_subscription_payers player_subscription_payers_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_subscription_payers
    ADD CONSTRAINT player_subscription_payers_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.club_subscription_programmes(id);


--
-- Name: club_subscription_pricing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_subscription_pricing ENABLE ROW LEVEL SECURITY;

--
-- Name: club_subscription_pricing club_subscription_pricing_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_subscription_pricing_select_scoped ON public.club_subscription_pricing FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.club_subscription_programmes p
  WHERE ((p.id = club_subscription_pricing.programme_id) AND (internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, p.club_id, NULL::uuid) OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, p.club_id, NULL::uuid) OR (EXISTS ( SELECT 1
           FROM (public.player_team_memberships ptm
             JOIN public.teams t ON ((t.id = ptm.team_id)))
          WHERE ((t.club_id = p.club_id) AND (ptm.status = 'active'::text) AND (internal.is_active_player_guardian(ptm.player_id) OR internal.is_own_linked_player(ptm.player_id))))))))));


--
-- Name: club_subscription_pricing club_subscription_pricing_write_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_subscription_pricing_write_scoped ON public.club_subscription_pricing FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.club_subscription_programmes p
  WHERE ((p.id = club_subscription_pricing.programme_id) AND (internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, p.club_id, NULL::uuid))))));


--
-- Name: club_subscription_programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_subscription_programmes ENABLE ROW LEVEL SECURITY;

--
-- Name: club_subscription_programmes club_subscription_programmes_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_subscription_programmes_select_scoped ON public.club_subscription_programmes FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, club_id, NULL::uuid) OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR internal.has_capability('club.subscription.manage_enrolment'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM (public.player_team_memberships ptm
     JOIN public.teams t ON ((t.id = ptm.team_id)))
  WHERE ((t.club_id = club_subscription_programmes.club_id) AND (ptm.status = 'active'::text) AND (internal.is_active_player_guardian(ptm.player_id) OR internal.is_own_linked_player(ptm.player_id)))))));


--
-- Name: club_subscription_programmes club_subscription_programmes_write_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_subscription_programmes_write_scoped ON public.club_subscription_programmes USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, club_id, NULL::uuid))) WITH CHECK ((internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, club_id, NULL::uuid)));


--
-- Name: club_subscription_sibling_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_subscription_sibling_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: club_subscription_sibling_rules club_subscription_sibling_rules_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY club_subscription_sibling_rules_select_scoped ON public.club_subscription_sibling_rules FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.configure'::text, 'club'::text, ( SELECT p.club_id
   FROM public.club_subscription_programmes p
  WHERE (p.id = club_subscription_sibling_rules.programme_id)), NULL::uuid) OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, ( SELECT p.club_id
   FROM public.club_subscription_programmes p
  WHERE (p.id = club_subscription_sibling_rules.programme_id)), NULL::uuid)));


--
-- Name: finance_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: finance_audit_log finance_audit_log_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY finance_audit_log_select_scoped ON public.finance_audit_log FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid)));


--
-- Name: gocardless_billing_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_billing_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_billing_requests gocardless_billing_requests_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_billing_requests_select_scoped ON public.gocardless_billing_requests FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM public.player_subscription_payers psp
  WHERE ((psp.id = gocardless_billing_requests.payer_subscription_id) AND (psp.payer_user_id = auth.uid()))))));


--
-- Name: gocardless_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_customers gocardless_customers_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_customers_select_scoped ON public.gocardless_customers FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR (payer_user_id = auth.uid())));


--
-- Name: gocardless_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_events ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_events gocardless_events_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_events_select_scoped ON public.gocardless_events FOR SELECT USING ((internal.is_site_admin() OR ((club_id IS NOT NULL) AND internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid))));


--
-- Name: gocardless_mandates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_mandates ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_mandates gocardless_mandates_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_mandates_select_scoped ON public.gocardless_mandates FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM public.gocardless_customers gc
  WHERE ((gc.id = gocardless_mandates.gocardless_customer_id) AND (gc.payer_user_id = auth.uid()))))));


--
-- Name: gocardless_merchant_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_merchant_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_payments gocardless_payments_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_payments_select_scoped ON public.gocardless_payments FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR internal.has_capability('club.subscription.manage_payment_actions'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM (public.membership_obligations mo
     JOIN public.player_subscription_payers psp ON ((psp.id = mo.payer_subscription_id)))
  WHERE ((mo.id = gocardless_payments.obligation_id) AND (psp.payer_user_id = auth.uid()))))));


--
-- Name: gocardless_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_payouts gocardless_payouts_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_payouts_select_scoped ON public.gocardless_payouts FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid)));


--
-- Name: gocardless_reconciliation_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_reconciliation_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_reconciliation_entries gocardless_reconciliation_entries_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_reconciliation_entries_select_scoped ON public.gocardless_reconciliation_entries FOR SELECT USING ((internal.is_site_admin() OR (EXISTS ( SELECT 1
   FROM public.gocardless_payouts po
  WHERE ((po.id = gocardless_reconciliation_entries.payout_id) AND internal.has_capability('club.subscription.view_finance'::text, 'club'::text, po.club_id, NULL::uuid))))));


--
-- Name: gocardless_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gocardless_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: gocardless_subscriptions gocardless_subscriptions_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gocardless_subscriptions_select_scoped ON public.gocardless_subscriptions FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM public.player_subscription_payers psp
  WHERE ((psp.id = gocardless_subscriptions.payer_subscription_id) AND (psp.payer_user_id = auth.uid()))))));


--
-- Name: membership_obligations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_obligations ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_obligations membership_obligations_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_obligations_select_scoped ON public.membership_obligations FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, club_id, NULL::uuid) OR internal.has_capability('club.subscription.manage_enrolment'::text, 'club'::text, club_id, NULL::uuid) OR internal.has_capability('club.subscription.manage_payment_actions'::text, 'club'::text, club_id, NULL::uuid) OR (EXISTS ( SELECT 1
   FROM public.player_subscription_payers psp
  WHERE ((psp.id = membership_obligations.payer_subscription_id) AND (psp.payer_user_id = auth.uid())))) OR internal.is_own_linked_player(player_id)));


--
-- Name: payment_refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_refunds payment_refunds_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_refunds_select_scoped ON public.payment_refunds FOR SELECT USING ((internal.is_site_admin() OR (EXISTS ( SELECT 1
   FROM public.gocardless_payments p
  WHERE ((p.id = payment_refunds.payment_id) AND internal.has_capability('club.subscription.view_finance'::text, 'club'::text, p.club_id, NULL::uuid))))));


--
-- Name: player_subscription_payers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_subscription_payers ENABLE ROW LEVEL SECURITY;

--
-- Name: player_subscription_payers player_subscription_payers_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY player_subscription_payers_select_scoped ON public.player_subscription_payers FOR SELECT USING ((internal.is_site_admin() OR internal.has_capability('club.subscription.view_finance'::text, 'club'::text, ( SELECT p.club_id
   FROM public.club_subscription_programmes p
  WHERE (p.id = player_subscription_payers.programme_id)), NULL::uuid) OR internal.has_capability('club.subscription.manage_enrolment'::text, 'club'::text, ( SELECT p.club_id
   FROM public.club_subscription_programmes p
  WHERE (p.id = player_subscription_payers.programme_id)), NULL::uuid) OR (payer_user_id = auth.uid()) OR internal.is_own_linked_player(player_id)));


--
-- PostgreSQL database dump complete
--


-- =====================================================================
-- PART C: RPCs (verbatim from Side Project 1's live, final function
-- bodies -- every internal.*/has_capability dependency confirmed to
-- already exist in Main before this migration was written).
-- =====================================================================
CREATE OR REPLACE FUNCTION internal.calculate_member_price(p_programme_id uuid, p_payer_user_id uuid, p_player_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(ordinal integer, base_amount_minor integer, discount_type text, discount_value integer, discount_amount_minor integer, final_amount_minor integer, pricing_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing_count integer;
  v_ordinal integer;
  v_base integer;
  v_pricing_id uuid;
  v_rule public.club_subscription_sibling_rules;
  v_discount integer := 0;
  v_final integer;
begin
  select count(distinct psp.player_id) into v_existing_count
  from public.player_subscription_payers psp
  where psp.payer_user_id = p_payer_user_id
    and psp.programme_id = p_programme_id
    and psp.status = 'active'
    and psp.player_id <> p_player_id;

  v_ordinal := v_existing_count + 1;

  select cp.id, cp.amount_minor into v_pricing_id, v_base
  from public.club_subscription_pricing cp
  where cp.programme_id = p_programme_id and cp.effective_from <= p_as_of
  order by cp.effective_from desc, cp.created_at desc limit 1;

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
$function$
;

CREATE OR REPLACE FUNCTION public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_relationship text;
  v_id uuid;
  v_pricing record;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id and enabled = true;
  if v_club_id is null then
    raise exception 'This subscription programme is not available.';
  end if;

  if exists (select 1 from public.players where id = p_player_id and user_id = auth.uid()) then
    v_relationship := 'self';
  elsif internal.is_active_player_guardian(p_player_id) then
    v_relationship := 'guardian';
  else
    raise exception 'You are not authorized to set up a subscription for this player.' using errcode = '42501';
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

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_programme_id::text, 0));

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, current_date);
  if v_pricing.final_amount_minor is null then
    raise exception 'No price is configured for this programme.';
  end if;

  insert into public.player_subscription_payers (
    player_id, programme_id, payer_user_id, relationship, created_by,
    sibling_ordinal, base_amount_minor, sibling_discount_type, sibling_discount_value, sibling_discount_amount_minor, final_amount_minor, pricing_id
  )
  values (
    p_player_id, p_programme_id, auth.uid(), v_relationship, auth.uid(),
    v_pricing.ordinal, v_pricing.base_amount_minor, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.final_amount_minor, v_pricing.pricing_id
  )
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (
    auth.uid(), v_club_id, 'payer_self_enrolled', 'player_subscription_payers', v_id,
    jsonb_build_object('player_id', p_player_id, 'relationship', v_relationship, 'sibling_ordinal', v_pricing.ordinal, 'final_amount_minor', v_pricing.final_amount_minor),
    'parent_ui'
  );

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.configure_sibling_discount_rule(p_programme_id uuid, p_ordinal integer, p_discount_type text, p_discount_value integer, p_effective_from date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_id uuid;
  v_previous record;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then
    raise exception 'Subscription programme not found.';
  end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.configure', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to configure sibling discounts for this club.' using errcode = '42501';
  end if;

  if p_ordinal < 2 then
    raise exception 'Sibling discount rules apply from the 2nd child onward.';
  end if;
  if p_discount_type not in ('NONE', 'PERCENTAGE', 'FIXED') then
    raise exception 'Invalid discount type.';
  end if;
  if p_discount_type = 'PERCENTAGE' and (p_discount_value < 0 or p_discount_value > 100) then
    raise exception 'Percentage discount must be between 0 and 100.';
  end if;
  if p_discount_type = 'FIXED' and p_discount_value < 0 then
    raise exception 'Fixed discount amount cannot be negative.';
  end if;
  if p_effective_from < current_date then
    raise exception 'Effective date cannot be in the past.';
  end if;

  select * into v_previous
  from public.club_subscription_sibling_rules
  where programme_id = p_programme_id and ordinal = p_ordinal and effective_from <= current_date
  order by effective_from desc limit 1;

  insert into public.club_subscription_sibling_rules (programme_id, ordinal, discount_type, discount_value, effective_from, created_by)
  values (p_programme_id, p_ordinal, p_discount_type, p_discount_value, p_effective_from, auth.uid())
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (
    auth.uid(), v_club_id, 'sibling_discount_rule_changed', 'club_subscription_sibling_rules', v_id,
    case when v_previous.id is not null then jsonb_build_object('ordinal', v_previous.ordinal, 'discount_type', v_previous.discount_type, 'discount_value', v_previous.discount_value) else null end,
    jsonb_build_object('ordinal', p_ordinal, 'discount_type', p_discount_type, 'discount_value', p_discount_value, 'effective_from', p_effective_from),
    'admin_ui'
  );

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.configure_subscription_programme(p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_current_fee_mode text;
  v_current_policy text;
begin
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.configure', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to configure subscriptions for this club.' using errcode = '42501';
  end if;
  if p_collection_day < 1 or p_collection_day > 28 then
    raise exception 'Collection day must be between 1 and 28.';
  end if;
  if p_platform_fee_mode not in ('NONE', 'PARTNER_REVENUE_SHARE') then
    raise exception 'This platform fee mode is not yet approved for use. Only NONE and PARTNER_REVENUE_SHARE are currently enabled -- see the GoCardless Club Subscriptions final report''s Section L100 decision.';
  end if;
  if p_first_payment_policy not in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY') then
    raise exception 'Invalid first payment policy.';
  end if;

  select platform_fee_mode, first_payment_policy into v_current_fee_mode, v_current_policy from public.club_subscription_programmes where club_id = p_club_id;

  insert into public.club_subscription_programmes (club_id, enabled, collection_day, platform_fee_mode, first_payment_policy, created_by)
  values (p_club_id, p_enabled, p_collection_day, p_platform_fee_mode, p_first_payment_policy, auth.uid())
  on conflict (club_id) do update set
    enabled = excluded.enabled,
    collection_day = excluded.collection_day,
    platform_fee_mode = excluded.platform_fee_mode,
    first_payment_policy = excluded.first_payment_policy,
    updated_by = auth.uid()
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), p_club_id, 'programme_configured', 'club_subscription_programmes', v_id,
    jsonb_build_object('platform_fee_mode', v_current_fee_mode, 'first_payment_policy', v_current_policy),
    jsonb_build_object('enabled', p_enabled, 'collection_day', p_collection_day, 'platform_fee_mode', p_platform_fee_mode, 'first_payment_policy', p_first_payment_policy),
    'admin_ui');

  if v_current_policy is not null and v_current_policy is distinct from p_first_payment_policy then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (auth.uid(), p_club_id, 'first_payment_policy_changed', 'club_subscription_programmes', v_id,
      jsonb_build_object('programme_id', v_id, 'policy', v_current_policy),
      jsonb_build_object('programme_id', v_id, 'policy', p_first_payment_policy),
      'admin_ui');
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_gocardless_refund(p_payment_gc_id text, p_gc_refund_id text, p_amount_minor integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment_id uuid;
begin
  select id into v_payment_id from public.gocardless_payments where gc_payment_id = p_payment_gc_id;
  if v_payment_id is null then return; end if;

  update public.payment_refunds
  set gc_refund_id = p_gc_refund_id, status = 'confirmed'
  where payment_id = v_payment_id and status = 'pending' and amount_minor = p_amount_minor and gc_refund_id is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_membership_obligations_for_period(p_club_id uuid, p_billing_period date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
begin
  if not (
    internal.is_site_admin()
    or internal.has_capability('club.subscription.manage_enrolment', 'club', p_club_id, null)
    or auth.role() = 'service_role'
  ) then
    raise exception 'You are not authorized to generate obligations for this club.' using errcode = '42501';
  end if;
  if p_billing_period <> date_trunc('month', p_billing_period)::date then
    raise exception 'billing_period must be the first day of a month.';
  end if;

  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id and enabled = true;
  if v_programme is null then
    return 0;
  end if;

  v_due_date := p_billing_period + (v_programme.collection_day - 1);

  for v_payer in
    select psp.id as payer_subscription_id, psp.player_id, psp.effective_from, psp.final_amount_minor, psp.pricing_id as snapshot_pricing_id
    from public.player_subscription_payers psp
    where psp.programme_id = v_programme.id and psp.status = 'active'
  loop
    v_payer_first_period := date_trunc('month', v_payer.effective_from)::date;
    v_is_prorated := false;
    v_prorate_days := null;
    v_prorate_total := null;

    if v_payer_first_period > p_billing_period then
      continue;
    end if;

    if v_payer.final_amount_minor is not null then
      v_price := v_payer.final_amount_minor;
      v_pricing_id := v_payer.snapshot_pricing_id;
    else
      v_price_as_of := case when v_payer_first_period = p_billing_period then v_payer.effective_from else p_billing_period end;
      v_pricing_id := (select id from public.club_subscription_pricing where programme_id = v_programme.id and effective_from <= v_price_as_of order by effective_from desc limit 1);
      v_price := public.current_subscription_price(v_programme.id, v_price_as_of);
    end if;
    if v_price is null then
      raise exception 'No price is configured for this programme as of %.', p_billing_period;
    end if;

    if v_payer_first_period < p_billing_period then
      v_amount := v_price;
    else
      if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
        if extract(day from v_payer.effective_from)::int > v_programme.collection_day then
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

    insert into public.membership_obligations (
      programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, currency, due_date, status,
      first_payment_policy_used, is_prorated, proration_chargeable_days, proration_total_days, membership_effective_date
    )
    values (
      v_programme.id, p_club_id, v_payer.player_id, v_payer.payer_subscription_id, v_pricing_id, p_billing_period, v_amount, v_programme.currency, v_due_date, 'SETUP_PENDING',
      v_programme.first_payment_policy, v_is_prorated, v_prorate_days, v_prorate_total, v_payer.effective_from
    )
    on conflict (player_id, programme_id, billing_period) do nothing;
    if found then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_subscription_price(p_programme_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select amount_minor from public.club_subscription_pricing
  where programme_id = p_programme_id and effective_from <= p_as_of
  order by effective_from desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.disconnect_gocardless(p_club_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.is_site_admin() or internal.has_capability('club.gocardless.connect', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to disconnect GoCardless for this club.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to disconnect GoCardless.';
  end if;

  update public.gocardless_merchant_connections
  set disconnected_at = now(), disconnected_by = auth.uid()
  where club_id = p_club_id and disconnected_at is null;

  if not found then
    raise exception 'No active GoCardless connection found for this club.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.end_membership_subscription(p_payer_subscription_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_payer_row record;
  v_actor uuid;
  v_source text;
begin
  select psp.*, p.club_id into v_payer_row
  from public.player_subscription_payers psp
  join public.club_subscription_programmes p on p.id = psp.programme_id
  where psp.id = p_payer_subscription_id;

  if v_payer_row.id is null then
    raise exception 'Responsible payer relationship not found.';
  end if;
  v_club_id := v_payer_row.club_id;

  if auth.role() = 'service_role' then
    if p_actor_user_id is null then
      raise exception 'An explicit actor is required when calling as service_role.';
    end if;
    v_actor := p_actor_user_id;
  elsif internal.is_site_admin() or internal.has_capability('club.subscription.manage_payment_actions', 'club', v_club_id, null) then
    v_actor := auth.uid();
  else
    raise exception 'You are not authorized to cancel memberships for this club.' using errcode = '42501';
  end if;

  v_source := case when v_actor = v_payer_row.payer_user_id then 'parent_ui' else 'admin_ui' end;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a membership.';
  end if;

  if v_payer_row.status <> 'active' then
    return p_payer_subscription_id;
  end if;

  update public.player_subscription_payers
  set status = 'ended', effective_to = current_date, ended_by = v_actor, ended_at = now(), end_reason = p_reason
  where id = p_payer_subscription_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (
    v_actor,
    v_club_id,
    'membership_cancelled',
    'player_subscription_payers',
    p_payer_subscription_id,
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'ended', 'reason', p_reason, 'effective_to', current_date),
    v_source
  );

  return p_payer_subscription_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.export_finance_rows(p_club_id uuid, p_billing_period date)
 RETURNS TABLE(player_first_name text, player_surname text, payer_first_name text, payer_surname text, payer_email text, billing_period date, amount_due_minor integer, obligation_status text, due_date date, payment_status text, subscription_status text, base_amount_minor integer, sibling_ordinal integer, sibling_discount_type text, sibling_discount_amount_minor integer, final_amount_minor integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.export', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to export finance data for this club.' using errcode = '42501';
  end if;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), p_club_id, 'finance_export_generated', 'membership_obligations', null, jsonb_build_object('billing_period', p_billing_period), 'admin_ui');

  return query
  select
    pl.first_name, pl.surname,
    pr.first_name, pr.surname, u.email::text,
    mo.billing_period, mo.amount_due_minor, mo.status, mo.due_date,
    gp.status,
    gs.status,
    psp.base_amount_minor, psp.sibling_ordinal, psp.sibling_discount_type, psp.sibling_discount_amount_minor, psp.final_amount_minor
  from public.membership_obligations mo
  join public.players pl on pl.id = mo.player_id
  join public.player_subscription_payers psp on psp.id = mo.payer_subscription_id
  left join public.profiles pr on pr.id = psp.payer_user_id
  left join auth.users u on u.id = psp.payer_user_id
  left join public.gocardless_payments gp on gp.id = mo.gocardless_payment_id
  left join public.gocardless_subscriptions gs on gs.payer_subscription_id = psp.id and gs.status in ('pending', 'active')
  where mo.club_id = p_club_id and mo.billing_period = p_billing_period
  order by pl.surname, pl.first_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_subscription_impact(p_club_id uuid)
 RETURNS TABLE(active_gocardless_subscriptions bigint, active_payers bigint, pending_obligations bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    (select count(*) from public.gocardless_subscriptions where club_id = p_club_id and status = 'active'),
    (select count(*) from public.player_subscription_payers psp join public.club_subscription_programmes p on p.id = psp.programme_id where p.club_id = p_club_id and psp.status = 'active'),
    (select count(*) from public.membership_obligations where club_id = p_club_id and status in ('SETUP_PENDING', 'READY', 'SCHEDULED', 'SUBMITTED'))
  where internal.is_site_admin() or internal.has_capability('club.subscription.configure', 'club', p_club_id, null);
$function$
;

CREATE OR REPLACE FUNCTION public.get_finance_action_required(p_club_id uuid)
 RETURNS TABLE(payer_subscription_id uuid, player_id uuid, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    auth.role() = 'service_role'
    or internal.is_site_admin()
    or internal.has_capability('club.subscription.view_finance', 'club', p_club_id, null)
    or internal.has_capability('club.subscription.manage_payment_actions', 'club', p_club_id, null)
    or internal.has_capability('club.subscription.manage_enrolment', 'club', p_club_id, null)
  ) then
    raise exception 'You are not authorized to view finance action-required state for this club.' using errcode = '42501';
  end if;

  return query
  select mo.payer_subscription_id, mo.player_id, 'PAYMENT_FAILED'::text
  from public.membership_obligations mo
  join public.player_subscription_payers psp on psp.id = mo.payer_subscription_id
  where mo.club_id = p_club_id and mo.status = 'FAILED' and psp.status = 'active'

  union all
  select mo.payer_subscription_id, mo.player_id, 'PAYMENT_RETRY_REQUIRES_ATTENTION'::text
  from public.membership_obligations mo
  join public.player_subscription_payers psp on psp.id = mo.payer_subscription_id
  where mo.club_id = p_club_id and mo.status = 'RETRYING' and psp.status = 'active'

  union all
  select psp.id, psp.player_id, 'MANDATE_PROBLEM'::text
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  join public.gocardless_subscriptions gs on gs.payer_subscription_id = psp.id and gs.status in ('pending', 'active')
  join public.gocardless_mandates gm on gm.id = gs.gocardless_mandate_id
  where prog.club_id = p_club_id and psp.status = 'active' and gm.status in ('failed', 'expired', 'cancelled', 'consumed')

  union all
  select psp.id, psp.player_id, 'SUBSCRIPTION_PROBLEM'::text
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  join public.gocardless_subscriptions gs on gs.payer_subscription_id = psp.id
  where prog.club_id = p_club_id and psp.status = 'active' and gs.status in ('cancelled', 'finished', 'paused')

  union all
  select psp.id, psp.player_id, 'PROGRAMME_ELIGIBILITY_ENDED'::text
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  where prog.club_id = p_club_id and psp.status = 'active'
    and not exists (
      select 1 from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.player_id = psp.player_id and t.club_id = p_club_id and ptm.status = 'active'
    )

  union all
  select psp.id, psp.player_id, 'PAYER_RELATIONSHIP_REQUIRES_REVIEW'::text
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  where prog.club_id = p_club_id and psp.status = 'active' and psp.relationship = 'guardian'
    and not exists (
      select 1 from public.guardians g
      where g.player_id = psp.player_id and g.guardian_user_id = psp.payer_user_id and g.status = 'active'
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_gocardless_connection_status(p_club_id uuid)
 RETURNS TABLE(connected boolean, verification_status text, environment text, connected_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    true,
    mc.verification_status,
    mc.environment,
    mc.connected_at
  from public.gocardless_merchant_connections mc
  where mc.club_id = p_club_id
    and mc.disconnected_at is null
    and (internal.is_site_admin() or internal.has_capability('club.gocardless.connect', 'club', p_club_id, null));
$function$
;

CREATE OR REPLACE FUNCTION public.get_gocardless_token_for_club_admin_action(p_club_id uuid)
 RETURNS TABLE(access_token text, environment text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select mc.access_token, mc.environment
  from public.gocardless_merchant_connections mc
  where mc.club_id = p_club_id and mc.disconnected_at is null
    and (internal.is_site_admin() or internal.has_capability('club.subscription.manage_payment_actions', 'club', p_club_id, null));
$function$
;

CREATE OR REPLACE FUNCTION public.get_gocardless_token_for_payer_subscription(p_payer_subscription_id uuid)
 RETURNS TABLE(access_token text, environment text, club_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select mc.access_token, mc.environment, mc.club_id
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  join public.gocardless_merchant_connections mc on mc.club_id = prog.club_id and mc.disconnected_at is null
  where psp.id = p_payer_subscription_id and psp.payer_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_sibling_discount_rules(p_programme_id uuid)
 RETURNS TABLE(ordinal integer, discount_type text, discount_value integer, effective_from date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then
    raise exception 'Subscription programme not found.';
  end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.configure', 'club', v_club_id, null) or internal.has_capability('club.subscription.view_finance', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to view sibling discount rules for this club.' using errcode = '42501';
  end if;

  return query
  select distinct on (r.ordinal) r.ordinal, r.discount_type, r.discount_value, r.effective_from
  from public.club_subscription_sibling_rules r
  where r.programme_id = p_programme_id and r.effective_from <= current_date
  order by r.ordinal, r.effective_from desc, r.created_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_gocardless_event_processed(p_event_id uuid, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.gocardless_events set processed = (p_error is null), processed_at = now(), processing_error = p_error where id = p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_first_payment(p_programme_id uuid, p_player_id uuid, p_membership_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(policy text, monthly_amount_minor integer, first_charge_amount_minor integer, first_charge_billing_period date, covers_from date, covers_to date, is_prorated boolean, sibling_ordinal integer, sibling_discount_type text, sibling_discount_value integer, sibling_discount_amount_minor integer, base_amount_minor integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_programme record;
  v_pricing record;
  v_first_period date;
  v_proration record;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  if v_programme is null then
    return;
  end if;

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, p_membership_start_date);
  if v_pricing.final_amount_minor is null then
    return;
  end if;

  v_first_period := date_trunc('month', p_membership_start_date)::date;

  if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
    if extract(day from p_membership_start_date)::int > v_programme.collection_day then
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor,
        (v_first_period + interval '1 month')::date,
        (v_first_period + interval '1 month')::date, (v_first_period + interval '1 month')::date,
        false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    else
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor, v_first_period, v_first_period, v_first_period, false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    end if;
  else -- PRORATE_CURRENT_MONTH
    if extract(day from p_membership_start_date)::int = 1 then
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor, v_first_period, v_first_period, v_first_period, false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    else
      -- Section 9: proration is based on the DISCOUNTED recurring
      -- amount, never the undiscounted base.
      select * into v_proration from internal.calculate_first_month_proration(p_membership_start_date, v_pricing.final_amount_minor);
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_proration.prorated_amount_minor, v_first_period,
        p_membership_start_date, (v_first_period + interval '1 month' - interval '1 day')::date,
        true,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_first_payment_illustrative(p_programme_id uuid, p_membership_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(policy text, monthly_amount_minor integer, first_charge_amount_minor integer, first_charge_billing_period date, covers_from date, covers_to date, is_prorated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_programme record;
  v_price integer;
  v_first_period date;
  v_proration record;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  if v_programme is null then
    return;
  end if;
  v_price := public.current_subscription_price(p_programme_id, p_membership_start_date);
  if v_price is null then
    return;
  end if;
  v_first_period := date_trunc('month', p_membership_start_date)::date;

  if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
    if extract(day from p_membership_start_date)::int > v_programme.collection_day then
      return query select
        v_programme.first_payment_policy, v_price, v_price,
        (v_first_period + interval '1 month')::date,
        (v_first_period + interval '1 month')::date, (v_first_period + interval '1 month')::date,
        false;
    else
      return query select v_programme.first_payment_policy, v_price, v_price, v_first_period, v_first_period, v_first_period, false;
    end if;
  else
    if extract(day from p_membership_start_date)::int = 1 then
      return query select v_programme.first_payment_policy, v_price, v_price, v_first_period, v_first_period, v_first_period, false;
    else
      select * into v_proration from internal.calculate_first_month_proration(p_membership_start_date, v_price);
      return query select
        v_programme.first_payment_policy, v_price, v_proration.prorated_amount_minor, v_first_period,
        p_membership_start_date, (v_first_period + interval '1 month' - interval '1 day')::date,
        true;
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_gocardless_billing_request(p_billing_request_local_id uuid, p_gc_billing_request_status text, p_gc_customer_id text, p_gc_mandate_id text, p_mandate_status text, p_mandate_scheme text, p_next_possible_charge_date date)
 RETURNS TABLE(customer_id uuid, mandate_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_payer_subscription_id uuid;
  v_payer_user_id uuid;
  v_customer_id uuid;
  v_mandate_id uuid;
begin
  select club_id, payer_subscription_id into v_club_id, v_payer_subscription_id
  from public.gocardless_billing_requests
  where id = p_billing_request_local_id;

  if v_club_id is null then
    raise exception 'Billing request not found.';
  end if;

  select payer_user_id into v_payer_user_id
  from public.player_subscription_payers
  where id = v_payer_subscription_id;

  if v_payer_user_id is null then
    raise exception 'Responsible payer not found for this billing request.';
  end if;

  update public.gocardless_billing_requests
  set status = p_gc_billing_request_status
  where id = p_billing_request_local_id;

  if p_gc_customer_id is not null then
    insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id)
    values (v_club_id, v_payer_user_id, p_gc_customer_id)
    on conflict (club_id, payer_user_id) do update set gc_customer_id = excluded.gc_customer_id
    returning id into v_customer_id;
  end if;

  if p_gc_mandate_id is not null then
    insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, scheme, next_possible_charge_date)
    values (v_club_id, v_customer_id, p_billing_request_local_id, p_gc_mandate_id, coalesce(p_mandate_status, 'pending_submission'), p_mandate_scheme, p_next_possible_charge_date)
    on conflict (gc_mandate_id) do update set
      status = coalesce(p_mandate_status, gocardless_mandates.status),
      scheme = coalesce(p_mandate_scheme, gocardless_mandates.scheme),
      next_possible_charge_date = coalesce(p_next_possible_charge_date, gocardless_mandates.next_possible_charge_date),
      gocardless_customer_id = coalesce(v_customer_id, gocardless_mandates.gocardless_customer_id),
      updated_at = now()
    returning id into v_mandate_id;
  end if;

  return query select v_customer_id, v_mandate_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_gocardless_subscription(p_local_subscription_id uuid, p_gc_status text, p_gc_event_id text DEFAULT NULL::text, p_source text DEFAULT 'webhook'::text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_before record;
begin
  if p_local_subscription_id is null then
    raise exception 'Local subscription id required.';
  end if;
  if p_source not in ('webhook', 'admin_ui', 'parent_ui', 'system') then
    raise exception 'Invalid audit source.';
  end if;

  select id, club_id, status into v_before from public.gocardless_subscriptions where id = p_local_subscription_id;
  if v_before.id is null then
    raise exception 'Subscription not found.';
  end if;

  update public.gocardless_subscriptions
  set status = coalesce(p_gc_status, status)
  where id = p_local_subscription_id
  returning id into v_id;

  if p_gc_status is not null and p_gc_status is distinct from v_before.status then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (
      p_actor_user_id,
      v_before.club_id,
      'subscription_status_transition',
      'gocardless_subscriptions',
      v_id,
      jsonb_build_object('status', v_before.status),
      jsonb_build_object('status', p_gc_status, 'gc_event_id', p_gc_event_id),
      p_source
    );
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_gocardless_event(p_gc_event_id text, p_resource_type text, p_action text, p_payload jsonb, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  insert into public.gocardless_events (club_id, gc_event_id, resource_type, action, payload)
  values (p_club_id, p_gc_event_id, p_resource_type, p_action, p_payload)
  on conflict (gc_event_id) do nothing
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_gocardless_payment(p_obligation_id uuid, p_gc_payment_id text, p_amount_minor integer, p_currency text, p_charge_date date, p_status text, p_gocardless_subscription_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.gocardless_payments (club_id, obligation_id, gocardless_subscription_id, gc_payment_id, gross_amount_minor, currency, status, charge_date)
  values (v_club_id, p_obligation_id, p_gocardless_subscription_id, p_gc_payment_id, p_amount_minor, p_currency, p_status, p_charge_date)
  on conflict (gc_payment_id) do update set charge_date = coalesce(excluded.charge_date, gocardless_payments.charge_date)
  returning id into v_id;

  update public.membership_obligations
  set gocardless_payment_id = v_id, status = 'SUBMITTED'
  where id = p_obligation_id
    and status not in ('PAID', 'CANCELLED', 'CHARGEDBACK', 'REFUNDED', 'EXEMPT', 'WAIVED');

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_gocardless_subscription(p_payer_subscription_id uuid, p_pricing_id uuid, p_gocardless_mandate_id uuid, p_gc_subscription_id text, p_amount_minor integer, p_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select gc_subscription_id into v_existing_gc_subscription_id
  from public.gocardless_subscriptions
  where payer_subscription_id = p_payer_subscription_id and status in ('pending', 'active')
  limit 1;

  if v_existing_gc_subscription_id is not null and v_existing_gc_subscription_id <> p_gc_subscription_id then
    select id into v_id from public.gocardless_subscriptions where gc_subscription_id = v_existing_gc_subscription_id;
    return v_id;
  end if;

  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
  values (v_club_id, p_payer_subscription_id, p_gocardless_mandate_id, p_pricing_id, p_gc_subscription_id, p_amount_minor, p_status)
  on conflict (gc_subscription_id) do update set status = excluded.status, amount_minor = excluded.amount_minor
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_payment_refund(p_payment_id uuid, p_amount_minor integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_obligation_id uuid;
  v_refund_id uuid;
begin
  select club_id, obligation_id into v_club_id, v_obligation_id from public.gocardless_payments where id = p_payment_id;
  if v_club_id is null then raise exception 'Payment not found.'; end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.manage_payment_actions', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to record refunds for this club.' using errcode = '42501';
  end if;
  if p_amount_minor <= 0 then raise exception 'Refund amount must be positive.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to record a refund.'; end if;

  insert into public.payment_refunds (payment_id, amount_minor, reason, created_by)
  values (p_payment_id, p_amount_minor, p_reason, auth.uid())
  returning id into v_refund_id;

  update public.membership_obligations set status = 'REFUNDED', resolved_at = now(), resolved_reason = p_reason where id = v_obligation_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), v_club_id, 'refund_recorded', 'payment_refunds', v_refund_id, jsonb_build_object('amount_minor', p_amount_minor, 'reason', p_reason), 'admin_ui');

  return v_refund_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_obligation_exemption(p_obligation_id uuid, p_status text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  if p_status not in ('EXEMPT', 'WAIVED') then
    raise exception 'Invalid exemption status -- must be EXEMPT or WAIVED.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to mark an obligation exempt or waived.';
  end if;

  select club_id into v_club_id from public.membership_obligations where id = p_obligation_id;
  if v_club_id is null then raise exception 'Obligation not found.'; end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.manage_enrolment', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to exempt or waive payments for this club.' using errcode = '42501';
  end if;

  update public.membership_obligations set status = p_status, resolved_at = now(), resolved_reason = p_reason where id = p_obligation_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), v_club_id, lower(p_status) || '_applied', 'membership_obligations', p_obligation_id, jsonb_build_object('reason', p_reason), 'admin_ui');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_responsible_payer(p_player_id uuid, p_programme_id uuid, p_payer_user_id uuid, p_relationship text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_new_id uuid;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then
    raise exception 'Subscription programme not found.';
  end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.manage_enrolment', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to change the responsible payer for this club.' using errcode = '42501';
  end if;
  if p_relationship not in ('guardian', 'self') then
    raise exception 'Invalid payer relationship.';
  end if;
  if p_relationship = 'guardian' and not internal.is_active_player_guardian(p_player_id) then
    -- The relationship claim must be backed by a real, active Guardian row
    -- for THIS payer -- never trust the caller's label alone.
    if not exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = p_payer_user_id and status = 'active') then
      raise exception 'Payer is not an active guardian of this player.';
    end if;
  end if;
  if p_relationship = 'self' and not exists (select 1 from public.players where id = p_player_id and user_id = p_payer_user_id) then
    raise exception 'Self-pay requires the payer to be the linked player account.';
  end if;

  update public.player_subscription_payers
  set status = 'ended', effective_to = current_date, ended_by = auth.uid(), ended_at = now(), end_reason = coalesce(p_reason, 'Replaced by a new responsible payer.')
  where player_id = p_player_id and programme_id = p_programme_id and status = 'active';

  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, created_by)
  values (p_player_id, p_programme_id, p_payer_user_id, p_relationship, auth.uid())
  returning id into v_new_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), v_club_id, 'payer_changed', 'player_subscription_payers', v_new_id, jsonb_build_object('player_id', p_player_id, 'payer_user_id', p_payer_user_id, 'relationship', p_relationship), 'admin_ui');

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_subscription_price(p_programme_id uuid, p_amount_minor integer, p_effective_from date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_current_amount integer;
  v_id uuid;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then raise exception 'Subscription programme not found.'; end if;
  if not (internal.is_site_admin() or internal.has_capability('club.subscription.configure', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to change pricing for this club.' using errcode = '42501';
  end if;
  if p_amount_minor <= 0 then raise exception 'Amount must be a positive number of minor units (pence).'; end if;
  if p_effective_from < current_date then raise exception 'Effective date cannot be in the past.'; end if;

  v_current_amount := public.current_subscription_price(p_programme_id);

  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by)
  values (p_programme_id, p_amount_minor, p_effective_from, auth.uid())
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), v_club_id, 'price_changed', 'club_subscription_pricing', v_id,
    jsonb_build_object('amount_minor', v_current_amount),
    jsonb_build_object('amount_minor', p_amount_minor, 'effective_from', p_effective_from),
    'admin_ui');

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.store_gocardless_connection(p_club_id uuid, p_environment text, p_gc_organisation_id text, p_access_token text, p_scope text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not (internal.is_site_admin() or internal.has_capability('club.gocardless.connect', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to connect GoCardless for this club.' using errcode = '42501';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Invalid environment.';
  end if;

  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
  values (p_club_id, p_environment, p_gc_organisation_id, p_access_token, p_scope, auth.uid())
  on conflict (club_id) do update set
    environment = excluded.environment,
    gc_organisation_id = excluded.gc_organisation_id,
    access_token = excluded.access_token,
    scope = excluded.scope,
    connected_by = excluded.connected_by,
    connected_at = now(),
    disconnected_at = null,
    disconnected_by = null,
    verification_status = 'unknown',
    status_checked_at = null
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_gocardless_verification_status(p_club_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_status not in ('action_required', 'in_review', 'successful', 'unknown') then
    raise exception 'Invalid verification status.';
  end if;
  update public.gocardless_merchant_connections
  set verification_status = p_status, status_checked_at = now()
  where club_id = p_club_id and disconnected_at is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION internal.calculate_first_month_proration(p_membership_start_date date, p_monthly_amount_minor integer)
 RETURNS TABLE(chargeable_days integer, total_days_in_month integer, prorated_amount_minor integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select
    ((date_trunc('month', p_membership_start_date) + interval '1 month')::date - p_membership_start_date)::integer as chargeable_days,
    ((date_trunc('month', p_membership_start_date) + interval '1 month')::date - date_trunc('month', p_membership_start_date)::date)::integer as total_days_in_month,
    round(
      p_monthly_amount_minor::numeric
      * ((date_trunc('month', p_membership_start_date) + interval '1 month')::date - p_membership_start_date)::numeric
      / ((date_trunc('month', p_membership_start_date) + interval '1 month')::date - date_trunc('month', p_membership_start_date)::date)::numeric
    )::integer as prorated_amount_minor;
$function$
;

-- =====================================================================
-- PART D: GRANTS (function execute grants -- the real authorization
-- boundary is each function's own internal check plus RLS on every
-- table it touches; these grants only control WHO may even attempt to
-- call each RPC. service_role already has blanket grants in this
-- Supabase project's default privileges and is intentionally omitted
-- here to avoid a redundant explicit grant).
-- =====================================================================
grant execute on function public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid) to authenticated;
grant execute on function public.configure_sibling_discount_rule(p_programme_id uuid, p_ordinal integer, p_discount_type text, p_discount_value integer, p_effective_from date) to authenticated;
grant execute on function public.configure_subscription_programme(p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text) to authenticated;
grant execute on function public.create_membership_obligations_for_period(p_club_id uuid, p_billing_period date) to authenticated;
grant execute on function public.current_subscription_price(p_programme_id uuid, p_as_of date) to authenticated;
grant execute on function public.disconnect_gocardless(p_club_id uuid, p_reason text) to authenticated;
grant execute on function public.end_membership_subscription(p_payer_subscription_id uuid, p_reason text, p_actor_user_id uuid) to authenticated;
grant execute on function public.export_finance_rows(p_club_id uuid, p_billing_period date) to authenticated;
grant execute on function public.get_active_subscription_impact(p_club_id uuid) to authenticated;
grant execute on function public.get_finance_action_required(p_club_id uuid) to authenticated;
grant execute on function public.get_gocardless_connection_status(p_club_id uuid) to authenticated;
grant execute on function public.get_gocardless_token_for_club_admin_action(p_club_id uuid) to authenticated;
grant execute on function public.get_gocardless_token_for_payer_subscription(p_payer_subscription_id uuid) to authenticated;
grant execute on function public.get_sibling_discount_rules(p_programme_id uuid) to authenticated;
grant execute on function public.preview_first_payment(p_programme_id uuid, p_player_id uuid, p_membership_start_date date) to authenticated;
grant execute on function public.preview_first_payment_illustrative(p_programme_id uuid, p_membership_start_date date) to authenticated;
-- Defense-in-depth: the live source database this migration was captured
-- from had a stray `anon` grant on this staff-only refund RPC (matching
-- the exact class of gap the Player/Guardian domain's own
-- duplicate_review_anon_lockdown migration fixed elsewhere in this
-- workstream). The function's own is_site_admin()/has_capability check
-- already denies an anon caller, but this migration does not carry the
-- stray grant forward regardless.
grant execute on function public.record_payment_refund(p_payment_id uuid, p_amount_minor integer, p_reason text) to authenticated;
revoke all on function public.record_payment_refund(uuid, integer, text) from anon;
grant execute on function public.set_obligation_exemption(p_obligation_id uuid, p_status text, p_reason text) to authenticated;
grant execute on function public.set_responsible_payer(p_player_id uuid, p_programme_id uuid, p_payer_user_id uuid, p_relationship text, p_reason text) to authenticated;
grant execute on function public.set_subscription_price(p_programme_id uuid, p_amount_minor integer, p_effective_from date) to authenticated;
grant execute on function public.store_gocardless_connection(p_club_id uuid, p_environment text, p_gc_organisation_id text, p_access_token text, p_scope text) to authenticated;

-- Defense-in-depth: table-level grants already exist via this Supabase
-- project's default anon/authenticated privileges (RLS above is the real
-- boundary); no additional table grant is required here.
