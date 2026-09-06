-- Policy acknowledgements, kept legally distinct from Terms agreement.
--
-- Signup asks a new user for three ticks, but they are NOT the same legal
-- event and must not be recorded as though they were:
--
--   Terms of Service     -- a CONTRACTUAL AGREEMENT. Already modelled by
--                           public.terms_acceptances, whose own comment
--                           says "one row per user per accepted terms
--                           version". That table stays exactly what it is.
--
--   Privacy Notice       -- TRANSPARENCY. The reader is told how their
--                           information is handled. Acknowledging it is not
--                           consent to processing, and Ovalball does not
--                           rely on consent as its lawful basis for the
--                           processing described there.
--
--   Safeguarding Policy  -- ACKNOWLEDGEMENT that a policy central to a
--                           youth-sport product has been read. Again not a
--                           consent to processing.
--
-- Writing "privacy@1.0" into terms_acceptances would have recorded an
-- acknowledgement as a Terms agreement, and a later question about what
-- someone actually agreed to would have been answered wrongly. This table
-- exists so the provenance is honest, not to duplicate consent
-- infrastructure: it holds only the events terms_acceptances cannot
-- truthfully represent.
--
-- Append-only, like terms_acceptances: no update or delete policy, and the
-- unique constraint makes a repeat submission idempotent rather than
-- producing a second row.

create table public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable policy identity, never a mutable page title.
  policy_id text not null check (policy_id in ('privacy', 'safeguarding')),
  -- The published version acknowledged, e.g. '1.0'.
  policy_version text not null,
  -- Deliberately constrained to one value: an AGREEMENT never belongs in
  -- this table. If a future policy genuinely requires agreement rather than
  -- acknowledgement, that is a deliberate schema change, not a silent
  -- widening of what this row means.
  event_type text not null default 'acknowledgement'
    check (event_type = 'acknowledgement'),
  -- Where the acknowledgement was captured.
  source text not null default 'signup'
    check (source in ('signup', 'reconsent')),
  -- Server-generated. Never accepted from a client.
  acknowledged_at timestamptz not null default now(),
  unique (user_id, policy_id, policy_version)
);

comment on table public.policy_acknowledgements is
  'Acknowledgement (NOT agreement, NOT GDPR consent) that a published policy version was read at signup. Terms of Service agreement lives in terms_acceptances and is a different legal event. Append-only.';

comment on column public.policy_acknowledgements.event_type is
  'Always ''acknowledgement''. Contractual agreement is recorded in terms_acceptances instead.';

create index policy_acknowledgements_user_id_idx
  on public.policy_acknowledgements (user_id);

alter table public.policy_acknowledgements enable row level security;

-- Mirrors terms_acceptances exactly: a user reads and inserts their own,
-- Site Admin reads all, nobody updates or deletes.
create policy policy_acknowledgements_select_scoped
  on public.policy_acknowledgements for select
  using (user_id = (select auth.uid()) or internal.is_site_admin());

create policy policy_acknowledgements_insert_self
  on public.policy_acknowledgements for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create trigger audit_row_change
  after insert or delete or update on public.policy_acknowledgements
  for each row execute function internal.audit_row_change();
