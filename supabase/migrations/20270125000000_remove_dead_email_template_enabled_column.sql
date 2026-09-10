-- email_template_settings.enabled was never wired to anything.
--
-- THE AUDIT THAT FOUND THIS
--
-- The column shipped with a comment claiming "optional events may be
-- switched off here", but nothing in the product ever wrote it: there is no
-- RPC alongside save_email_template_draft/publish_email_template_draft/
-- clear_email_template_override that touches it, no Site Admin control reads
-- or renders it, and resolve-content.ts -- the ONE resolution path every send
-- and every preview goes through -- never selects the column at all. A Site
-- Admin could never have switched an email off through this, because nothing
-- ever asked the column a question.
--
-- That is exactly the failure mode lib/email/resolve-content.ts's own design
-- exists to prevent for template copy: a screen or a schema that disagrees
-- with what actually happens. A column that looks load-bearing but is not
-- checked by anything is worse than no column, because the next person to
-- read this schema has to rediscover that it does nothing before they can
-- trust anything else about the table.
--
-- WHY REMOVE RATHER THAN WIRE IT UP
--
-- Whether an OPTIONAL_OPERATIONAL event may be switched off from Site Admin
-- is a real product question, but nobody has answered it: no design exists
-- for what the control looks like, which events it should apply to, or what
-- "off" should mean for an in-flight draft. Wiring a UI and an RPC onto a
-- guess would be inventing product on the schema's behalf. If Site Admin ever
-- needs to disable an individual email, that is a new column added with its
-- own RPC and its own Site Admin control in the same change -- not this one,
-- resurrected.
--
-- The classification rule that actually governs whether an event MAY be
-- silenced already exists and is unaffected by this migration: MANDATORY and
-- IDENTITY emails cannot be suppressed regardless of any per-row switch,
-- because lib/email/send.ts never asks email_template_settings that question
-- for those classifications either.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_template_settings' and column_name = 'enabled'
  ) then
    alter table public.email_template_settings drop column enabled;
  end if;
end $$;

-- Verification. A migration whose whole purpose is removing a column should
-- prove the column is actually gone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_template_settings' and column_name = 'enabled'
  ) then
    raise exception 'email_template_settings.enabled still exists after the migration meant to remove it.';
  end if;
  raise notice 'email_template_settings.enabled removed: it was never read by resolve-content.ts, never written by any RPC, and never surfaced in Site Admin.';
end $$;
