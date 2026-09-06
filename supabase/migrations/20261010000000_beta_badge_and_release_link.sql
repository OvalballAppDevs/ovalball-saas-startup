-- Commercial Platform — reconciliation pass.
--
-- Two items, one migration, because they are the same fact seen from two
-- directions:
--
--   * A visitor needs to know Ovalball is in Beta, and which version they
--     are looking at. That is "what is running NOW".
--   * A Site Admin needs to answer, later, "when Beta was enabled on this
--     date, what version was running?". That is "what was running THEN".
--
-- Releases and platform mode stay separate concepts. Nothing here creates a
-- release when the mode is toggled; a transition merely records which
-- release was current at the time, if there was one.

-- ---------------------------------------------------------------------
-- 1. A mode transition remembers the release that was live
-- ---------------------------------------------------------------------

-- `platform_mode_events.release_id` has existed since Phase C but was never
-- populated: the RPC accepted it and the UI never passed one, so every row
-- carried null and the historical question could not be answered.
--
-- Rather than make the caller responsible for remembering, the default is
-- resolved here from the currently published production release. If no
-- release has been published, it stays null — which is the honest answer,
-- and is deliberately NOT a reason to fabricate one.
create or replace function public.set_platform_mode(
  p_mode text,
  p_reason text default null,
  p_release_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_id uuid;
  v_release uuid;
begin
  if not internal.has_capability('site.system.beta.manage', 'site') then
    raise exception 'Not authorized to change the platform mode.' using errcode = '42501';
  end if;

  if p_mode not in ('beta', 'live') then
    raise exception 'Unknown platform mode: %.', p_mode;
  end if;

  v_current := internal.current_platform_mode();
  if v_current is not distinct from p_mode then
    return null;
  end if;

  -- The release that was live at this moment. Never invented: null when
  -- nothing has been published.
  v_release := coalesce(
    p_release_id,
    (
      select r.id
      from public.platform_releases r
      where r.status = 'published' and r.channel = 'production'
      -- Total ordering, not just `released_at desc`: two releases published
      -- on the same day (or in the same transaction) would otherwise leave
      -- "the current version" to chance. Same lesson as platform_mode_events.
      order by r.released_at desc, r.created_at desc, r.id desc
      limit 1
    )
  );

  insert into public.platform_mode_events (new_mode, release_id, reason, changed_by)
  values (p_mode, v_release, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;

  -- Entering Beta stops every running trial clock; leaving Beta restarts
  -- exactly the ones Beta stopped. Beta is paused time, never accrued debt.
  perform internal.apply_platform_mode_to_trials(p_mode);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. What every surface reads to render the Beta badge
-- ---------------------------------------------------------------------

-- One resolver for the whole product: the public homepage, the
-- authenticated shell, and the admin console all call this and nothing
-- else. There is deliberately no client-owned Beta flag anywhere.
--
-- `release_version` is the currently PUBLISHED release — what a visitor is
-- looking at now — not the release linked to the mode transition, which
-- answers the different, historical question. Null when nothing has been
-- published, and the badge then reads "BETA" with no version rather than
-- inventing one.
create or replace function public.platform_public_state()
returns table (mode text, release_version text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(internal.current_platform_mode(), 'beta'),
    (
      select r.version
      from public.platform_releases r
      where r.status = 'published' and r.channel = 'production'
      -- Total ordering, not just `released_at desc`: two releases published
      -- on the same day (or in the same transaction) would otherwise leave
      -- "the current version" to chance. Same lesson as platform_mode_events.
      order by r.released_at desc, r.created_at desc, r.id desc
      limit 1
    );
$$;

comment on function public.platform_public_state is
  'The canonical Beta badge source for every surface, signed in or not. Returns the current platform mode and the currently published production release version (null if none). Safe for anon: it exposes no club data and no unpublished release.';

grant execute on function public.platform_public_state() to anon, authenticated;
