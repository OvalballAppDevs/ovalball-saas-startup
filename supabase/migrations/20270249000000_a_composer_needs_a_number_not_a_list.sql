-- =====================================================================
-- A COMPOSER NEEDS A NUMBER, NOT A LIST
--
-- Before sending to four hundred families, the person sending has to be able
-- to see what they are about to do. "This will reach 43 people, and 2 players
-- have nobody who can be contacted for them" is the difference between
-- sending with confidence and sending and hoping.
--
-- The obvious way to build that is to return the resolved audience to the
-- browser and let the composer count it. That would hand the sender's client
-- a list of every recipient -- which is exactly the thing 20270242000000
-- exists to prevent, arriving through the front door instead. A club
-- secretary is entitled to know how many; they are not entitled to a
-- downloadable roster of every family in the club, and neither is anything
-- running in their browser.
--
-- So the preview returns THREE INTEGERS and nothing else. The audience is
-- resolved server-side by the one pipeline, counted, and discarded. There is
-- no shape of response here that can leak an identity, because there is no
-- identity in the response.
--
-- IT IS ALSO THE AUTHORITY CHECK. internal.resolve_audience raises if the
-- caller may not address the audience or the feature is switched off, so a
-- composer that cannot preview cannot send either -- and the person is told
-- why at the moment they choose the audience rather than after they have
-- written three paragraphs.
-- =====================================================================

create or replace function public.preview_audience(
  p_scope text,
  p_scope_id uuid default null,
  p_audience_spec jsonb default '{}'::jsonb,
  p_exclude_u18 boolean default false,
  p_sender_identity_type text default 'person',
  p_reply_mode text default 'NO_REPLY'
)
returns table (
  recipient_count integer,
  unreachable_count integer,
  guardian_route_count integer,
  direct_route_count integer
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
begin
  return query
  with resolved as (
    select * from internal.resolve_audience(
      p_scope, p_scope_id, p_audience_spec, p_exclude_u18, p_sender_identity_type, p_reply_mode)
  ),
  gaps as (
    select * from public.audience_unreachable(p_scope, p_scope_id, p_audience_spec, p_exclude_u18)
  )
  select
    (select count(*)::integer from resolved),
    (select count(*)::integer from gaps),
    -- The split is worth showing: "34 of these go to a guardian" tells a
    -- coach something true about who is actually reading it.
    (select count(*)::integer from resolved where safeguarding_route = 'guardian'),
    (select count(*)::integer from resolved where safeguarding_route = 'direct');
end;
$$;

comment on function public.preview_audience(text, uuid, jsonb, boolean, text, text) is
  'How many people an audience resolves to, and how many players have nobody contactable. Returns counts ONLY -- never identities -- so a composer can show the scale of a send without its client ever holding the audience.';

revoke all on function public.preview_audience(text, uuid, jsonb, boolean, text, text) from public, anon;
grant execute on function public.preview_audience(text, uuid, jsonb, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- WHO MAY I SPEAK AS?
-- ---------------------------------------------------------------------
-- The composer's identity picker. Built from internal.may_send_as, so the
-- list offered and the list enforced are the same list -- a picker assembled
-- from role names in TypeScript would eventually offer an option the trigger
-- then refuses, which reads as a bug rather than as a boundary.
create or replace function public.my_sender_identities()
returns table (
  identity_type text,
  identity_id uuid,
  label text,
  can_address_team boolean,
  can_address_club boolean
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select 'team'::text, t.id, t.display_name,
         internal.can_address_team_audience(t.id),
         false
  from public.teams t
  where internal.may_send_as('team', t.id)

  union all

  select 'club'::text, c.id, d.name,
         false,
         internal.can_address_club_audience(c.id)
  from public.clubs c
  join public.club_directory d on d.id = c.directory_id
  where internal.may_send_as('club', c.id)

  union all

  -- Ovalball itself, offered only to the one authority that may use it.
  select 'platform'::text, null::uuid, 'Ovalball'::text, false, false
  where internal.is_full_site_admin()

  order by 1, 3;
$$;

comment on function public.my_sender_identities() is
  'The organisational identities the caller may speak as, with whether each can address its own audience. Derived from internal.may_send_as so the composer can never offer an identity the send trigger would refuse.';

revoke all on function public.my_sender_identities() from public, anon;
grant execute on function public.my_sender_identities() to authenticated;
