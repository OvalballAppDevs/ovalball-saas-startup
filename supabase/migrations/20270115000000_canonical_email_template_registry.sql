-- The Canonical Email Template Registry.
--
-- Site Admin gains control of what Ovalball's transactional emails SAY. It
-- gains no control at all over when they are sent, who receives them, or what
-- data they may reach -- and the shape of these tables is what enforces that.
--
-- THE DIVISION, AND WHY IT IS DRAWN HERE
--
-- Code owns the CONTRACT: which events exist, which variables each may use,
-- who resolves the recipient, what the safe default copy is, and whether an
-- event is dispatched anywhere. That lives in lib/email/catalogue.ts and
-- lib/email/contracts.ts, in version control, reviewable in a pull request.
--
-- The database owns the EDITABLE COPY for those events, and nothing else.
--
-- Note what is deliberately absent below: there is no table of event
-- definitions, and event_key carries no foreign key to one. That is not an
-- oversight. If the database could name an event, an administrator could
-- insert a row for `player.medical_summary`, and the only thing standing
-- between that row and a real email would be application code remembering to
-- check. Instead the code catalogue is the only list of events that exists,
-- and a row whose event_key is not in it is unreachable: the renderer looks up
-- the contract first and refuses anything it does not recognise. Unregistered
-- keys fail closed by construction rather than by vigilance.
--
-- This is the same reasoning that keeps `to` out of the send pipeline.

-- ---------------------------------------------------------------------------
-- Versions: append-only, and that is the point
-- ---------------------------------------------------------------------------
--
-- Published email copy is production configuration that real people receive.
-- An UPDATE in place would destroy the answer to "what did we actually send
-- them in March", which is the question that matters when a club disputes what
-- an invitation said. So a version is written once and never altered; editing
-- means writing a new one, and restoring an old one means writing a new one
-- from its content.

create table if not exists public.email_template_versions (
  id uuid primary key default gen_random_uuid(),

  /**
   * The event this copy belongs to. Deliberately unconstrained by a foreign
   * key -- see the header. The code catalogue is the authority, and a key it
   * does not know renders nothing.
   */
  event_key text not null,

  /** Monotonic per event. Version 1 of an event is its first saved draft. */
  revision integer not null,

  /**
   * The editable slots. Everything else about an email -- layout, the shell,
   * info cards, the club crest block, the footer -- is structural and stays in
   * code, because it is not copy and an administrator editing it would be
   * editing the design system.
   */
  subject text not null,
  preheader text not null,
  heading text not null,
  body text not null,
  /** Null where the event's contract has no call to action. */
  cta_label text,

  /**
   * draft: editable, not sent. published: immutable, may be made active.
   * A draft becomes published; a published version is never edited.
   */
  status text not null default 'draft' check (status in ('draft', 'published')),

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  published_at timestamptz,

  /** Set when this version was created by restoring an earlier one. */
  restored_from_revision integer,
  /** True when this version's content came from the code-owned default. */
  from_registered_default boolean not null default false,

  constraint email_template_versions_unique_revision unique (event_key, revision),
  constraint email_template_versions_published_has_stamp check (
    status <> 'published' or (published_at is not null and published_by is not null)
  )
);

create index if not exists email_template_versions_event_idx
  on public.email_template_versions (event_key, revision desc);

comment on table public.email_template_versions is
  'Append-only history of Site Admin-edited copy for registered transactional email events. A published version is never updated in place: editing writes a new revision, and restoring an old one writes a new revision from its content, so the record of what a recipient was actually sent survives.';

-- One open draft per event. Two drafts would make "the draft" ambiguous and
-- turn publishing into a guess.
create unique index if not exists email_template_versions_one_draft
  on public.email_template_versions (event_key) where status = 'draft';

-- ---------------------------------------------------------------------------
-- Settings: which version is live, and whether the event is switched on
-- ---------------------------------------------------------------------------

create table if not exists public.email_template_settings (
  event_key text primary key,

  /** Null means "no published override" -- the code-owned default is used. */
  active_version_id uuid references public.email_template_versions(id),

  /**
   * Optional events may be switched off here. Whether an event MAY be switched
   * off is decided by its classification in code, not by this column: the RPC
   * refuses to disable a TRANSACTIONAL_IDENTITY or MANDATORY_OPERATIONAL event,
   * so a safeguarding message or an invitation cannot be silenced from an
   * admin screen.
   */
  enabled boolean not null default true,

  /**
   * Optimistic concurrency. Two Site Admins with the screen open must not
   * silently overwrite one another: a write carries the revision it was based
   * on, and a stale one is refused with a conflict rather than applied.
   */
  lock_version integer not null default 0,

  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.email_template_settings is
  'Per-event email configuration: which published version is live, and whether an optional event is switched on. One row per registered event key; a key the code catalogue does not know is unreachable regardless of what is stored here.';

comment on column public.email_template_settings.enabled is
  'Only meaningful for OPTIONAL_OPERATIONAL events. The publish/disable RPC refuses to switch off an identity or mandatory event, so safeguarding and invitation mail cannot be silenced from an admin screen.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Global production configuration, so: Full Site Admin only, for reading as
-- well as writing. There is nothing here an ordinary user or a club admin has
-- any business enumerating -- template copy reveals what Ovalball says to
-- whom, and the version history reveals who changed it.

alter table public.email_template_versions enable row level security;
alter table public.email_template_settings enable row level security;

create policy email_template_versions_read_site_admin
  on public.email_template_versions for select
  using (internal.is_full_site_admin());

create policy email_template_settings_read_site_admin
  on public.email_template_settings for select
  using (internal.is_full_site_admin());

-- No insert/update/delete policy on either table, deliberately. Every write
-- goes through the SECURITY DEFINER functions below, which carry the authority
-- check, the classification rules and the concurrency check together. A direct
-- client write would bypass all three.

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function internal.assert_may_manage_email_templates()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may change Ovalball''s email configuration.'
      using errcode = '42501';
  end if;
end;
$function$;

/**
 * Saves the draft for one event, replacing any existing draft.
 *
 * p_expected_lock is the settings revision the editor was opened against. A
 * stale editor is refused rather than allowed to overwrite somebody else's
 * newer work.
 */
create or replace function public.save_email_template_draft(
  p_event_key text,
  p_subject text,
  p_preheader text,
  p_heading text,
  p_body text,
  p_cta_label text,
  p_expected_lock integer
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock integer;
  v_next integer;
  v_id uuid;
begin
  perform internal.assert_may_manage_email_templates();

  insert into public.email_template_settings (event_key, updated_by)
  values (p_event_key, auth.uid())
  on conflict (event_key) do nothing;

  select lock_version into v_lock from public.email_template_settings
  where event_key = p_event_key for update;

  if v_lock is distinct from p_expected_lock then
    raise exception 'This email has been changed by someone else since you opened it. Reload to see the current version.'
      using errcode = '40001';
  end if;

  -- A draft is working state, so it is replaced rather than accumulated. Only
  -- PUBLISHED versions are history worth keeping.
  delete from public.email_template_versions
  where event_key = p_event_key and status = 'draft';

  select coalesce(max(revision), 0) + 1 into v_next
  from public.email_template_versions where event_key = p_event_key;

  insert into public.email_template_versions
    (event_key, revision, subject, preheader, heading, body, cta_label, status, created_by)
  values
    (p_event_key, v_next, p_subject, p_preheader, p_heading, p_body,
     nullif(trim(coalesce(p_cta_label, '')), ''), 'draft', auth.uid())
  returning id into v_id;

  update public.email_template_settings
  set lock_version = lock_version + 1, updated_by = auth.uid(), updated_at = now()
  where event_key = p_event_key;

  return v_id;
end;
$function$;

comment on function public.save_email_template_draft(text, text, text, text, text, text, integer) is
  'Replaces the open draft for one event. Refuses a stale editor via p_expected_lock so two Site Admins cannot silently overwrite each other.';

/** Publishes the open draft, making it the active version. */
create or replace function public.publish_email_template_draft(
  p_event_key text,
  p_expected_lock integer
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock integer;
  v_draft uuid;
  v_previous uuid;
begin
  perform internal.assert_may_manage_email_templates();

  select lock_version, active_version_id into v_lock, v_previous
  from public.email_template_settings where event_key = p_event_key for update;
  if v_lock is null then
    raise exception 'This email has no saved draft to publish.';
  end if;
  if v_lock is distinct from p_expected_lock then
    raise exception 'This email has been changed by someone else since you opened it. Reload to see the current version.'
      using errcode = '40001';
  end if;

  select id into v_draft from public.email_template_versions
  where event_key = p_event_key and status = 'draft';
  if v_draft is null then
    raise exception 'There is no draft to publish for this email.';
  end if;

  update public.email_template_versions
  set status = 'published', published_by = auth.uid(), published_at = now()
  where id = v_draft;

  update public.email_template_settings
  set active_version_id = v_draft, lock_version = lock_version + 1,
      updated_by = auth.uid(), updated_at = now()
  where event_key = p_event_key;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('email_template_settings', v_draft, 'update', auth.uid(),
          jsonb_build_object('active_version_id', v_previous),
          jsonb_build_object('event_key', p_event_key, 'active_version_id', v_draft, 'event', 'EMAIL_TEMPLATE_PUBLISHED'));

  return v_draft;
end;
$function$;

comment on function public.publish_email_template_draft(text, integer) is
  'Makes the open draft the active version. Publishing is explicit: saving a draft never changes what recipients receive.';

/**
 * Reverts to the code-owned default by clearing the override.
 *
 * The historical versions are NOT deleted -- the record of what was sent
 * survives. What changes is which version is active, and null means "use the
 * registered default", which is the same path a never-edited event takes.
 */
create or replace function public.clear_email_template_override(
  p_event_key text,
  p_expected_lock integer
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_lock integer; v_previous uuid;
begin
  perform internal.assert_may_manage_email_templates();

  select lock_version, active_version_id into v_lock, v_previous
  from public.email_template_settings where event_key = p_event_key for update;
  if v_lock is null then
    return; -- Never overridden; already on the registered default.
  end if;
  if v_lock is distinct from p_expected_lock then
    raise exception 'This email has been changed by someone else since you opened it. Reload to see the current version.'
      using errcode = '40001';
  end if;

  update public.email_template_settings
  set active_version_id = null, lock_version = lock_version + 1,
      updated_by = auth.uid(), updated_at = now()
  where event_key = p_event_key;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('email_template_settings', coalesce(v_previous, gen_random_uuid()), 'update', auth.uid(),
          jsonb_build_object('active_version_id', v_previous),
          jsonb_build_object('event_key', p_event_key, 'active_version_id', null, 'event', 'EMAIL_TEMPLATE_RESTORED_TO_DEFAULT'));
end;
$function$;

comment on function public.clear_email_template_override(text, integer) is
  'Returns an event to its code-owned default copy by clearing the active override. Historical versions are kept -- what a recipient was sent in the past stays on the record.';

revoke all on function public.save_email_template_draft(text, text, text, text, text, text, integer) from public, anon;
revoke all on function public.publish_email_template_draft(text, integer) from public, anon;
revoke all on function public.clear_email_template_override(text, integer) from public, anon;
grant execute on function public.save_email_template_draft(text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.publish_email_template_draft(text, integer) to authenticated;
grant execute on function public.clear_email_template_override(text, integer) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('email_template_versions', 'email_template_settings')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'A direct write policy exists on the registry; every write must go through the authority-checked functions.';
  end if;
  raise notice 'Canonical Email Template Registry created; writes are function-only.';
end $$;
