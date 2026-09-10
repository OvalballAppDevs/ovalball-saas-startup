-- The delivery ledger stops calling a request id a message id.
--
-- WHAT WAS WRONG
--
-- email_deliveries.provider_message_id, and the adapter that filled it, were
-- written against a response shape ZeptoMail does not return. The code read
-- `data[0].message_id` first and fell back to `request_id`. Zoho's current
-- Email Sending API documents the success body as:
--
--   { data: [{ code, additional_info, message }], message, request_id, object }
--
-- There is no per-message identifier anywhere in it. So the first branch never
-- matched, every row was in fact holding `request_id`, and the column name said
-- something about that value that was not true.
--
-- WHY THE NAME MATTERS
--
-- This column is what an operator reads when a club says "I never got it". A
-- "provider message id" invites them to go and look the message up; a request
-- reference is what they actually have -- it identifies the API CALL Ovalball
-- made, and it is the thing Zoho support can trace. Naming it accurately is the
-- difference between a useful triage trail and a fifteen-minute detour.
--
-- It also keeps the ledger's central honesty intact: `sent` has always meant
-- "the provider accepted this", never "it arrived", and a reference to a
-- request rather than a message says the same thing in the schema.
--
-- Renamed rather than added: two columns where one is populated would leave the
-- next person to guess which is real.

alter table public.email_deliveries rename column provider_message_id to provider_reference;

comment on column public.email_deliveries.provider_reference is
  'The provider''s own reference for the API call that accepted this message -- ZeptoMail''s request_id. It identifies the REQUEST, not a delivered message: this endpoint returns no per-message id, and acceptance is not proof of inbox delivery.';

-- Dropped before recreating, not replaced. The argument TYPES are unchanged, so
-- `create or replace` would refuse to rename the input parameter, and a second
-- overload would make every existing seven-argument call ambiguous.
drop function if exists public.record_email_delivery_result(uuid, text, text, text, text, text, text);

create function public.record_email_delivery_result(
  p_delivery_id uuid,
  p_status text,
  p_provider text default null,
  p_provider_reference text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_suppression_reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Email delivery results may only be recorded by an authenticated session.' using errcode = '42501';
  end if;

  update public.email_deliveries
  set status = p_status,
      provider = coalesce(p_provider, provider),
      provider_reference = coalesce(p_provider_reference, provider_reference),
      error_code = p_error_code,
      error_message = p_error_message,
      suppression_reason = p_suppression_reason,
      attempts = attempts + case when p_status in ('sent', 'failed') then 1 else 0 end,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = p_delivery_id;
end;
$$;

comment on function public.record_email_delivery_result(uuid, text, text, text, text, text, text) is
  'Records what actually happened to one delivery. p_provider_reference is the provider''s reference for the ACCEPTED REQUEST, not a message id -- ZeptoMail''s send endpoint returns none.';

revoke execute on function public.record_email_delivery_result(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_email_delivery_result(uuid, text, text, text, text, text, text) to authenticated;

do $$
declare v_overloads int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_deliveries' and column_name = 'provider_message_id'
  ) then
    raise exception 'provider_message_id still exists; the rename did not take.';
  end if;

  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_email_delivery_result';
  if v_overloads <> 1 then
    raise exception 'Expected exactly one record_email_delivery_result, found %.', v_overloads;
  end if;

  raise notice 'email_deliveries.provider_reference now names what it holds.';
end $$;
