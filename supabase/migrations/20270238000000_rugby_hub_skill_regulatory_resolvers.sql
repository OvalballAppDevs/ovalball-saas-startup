-- Two narrow, sanctioned read paths onto regulatory truth for Skills
-- Explorer -- neither regulatory_facts nor regulatory_fact_applicability
-- has a public-read RLS policy (both are admin-capability-gated only, by
-- design, matching regulatory_content_sets/sections), so a client-facing
-- resolver cannot select them directly. This mirrors exactly how
-- get_rugby_hub_rules/get_rugby_hub_welfare already expose VERIFIED
-- regulatory_facts columns (value_text included) to ordinary viewers via a
-- SECURITY DEFINER function rather than a public table policy -- this
-- migration adds the same shape for the two Skills Explorer needs, not a
-- second access-control mechanism.
--
-- Scope is deliberately narrow: the fact-text resolver only ever returns
-- facts already linked through hub_regulatory_fact_references (the
-- sanctioned skill/content-item reference mechanism), keyed by a real
-- hub_content_items id -- it cannot be used to enumerate arbitrary
-- regulatory facts. The applicability resolver returns one boolean for one
-- caller-supplied fact_key + identity pair, never a list. Both filter to
-- status = 'VERIFIED', the same bar get_rugby_hub_rules already applies.

create or replace function public.get_hub_skill_content_regulatory_facts(p_content_item_id uuid)
returns table (fact_key text, value_text text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.fact_key, f.value_text
  from public.hub_regulatory_fact_references r
  join public.regulatory_facts f on f.id = r.regulatory_fact_id
  where r.content_item_id = p_content_item_id
    and f.status = 'VERIFIED';
$function$;
comment on function public.get_hub_skill_content_regulatory_facts is 'Returns the VERIFIED regulatory_facts (fact_key, value_text) linked to one hub_content_items row via hub_regulatory_fact_references -- the one sanctioned way Skills Explorer content surfaces real regulatory text, since regulatory_facts itself has no public-read policy. Cannot be used to browse facts generally: the caller must already hold a real, published content_item_id.';

revoke all on function public.get_hub_skill_content_regulatory_facts(uuid) from public, anon;
grant execute on function public.get_hub_skill_content_regulatory_facts(uuid) to authenticated;

create or replace function public.get_hub_regulatory_fact_applies(p_fact_key text, p_regulatory_identity_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.regulatory_fact_applicability a
    join public.regulatory_facts f on f.id = a.fact_id
    where f.fact_key = p_fact_key
      and a.regulatory_identity_id = p_regulatory_identity_id
      and f.status = 'VERIFIED'
  );
$function$;
comment on function public.get_hub_regulatory_fact_applies is 'Whether a real, VERIFIED regulatory_facts row (by its stable fact_key) applies to a given regulatory identity, per regulatory_fact_applicability -- used to gate Skills Explorer''s tackling-technique steps on the real RFU-REG15 contact-introduction rule, never a hardcoded age threshold. Returns one boolean; cannot enumerate facts or identities.';

revoke all on function public.get_hub_regulatory_fact_applies(text, uuid) from public, anon;
grant execute on function public.get_hub_regulatory_fact_applies(text, uuid) to authenticated;
