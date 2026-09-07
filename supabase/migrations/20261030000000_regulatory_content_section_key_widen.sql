-- Widen regulatory_content_sections.section_key to the values SP3's own
-- real Stage 3/5 content actually needed once real facts were authored
-- against it (ovalball-rugby-knowledge/supabase/migrations/
-- 20261102020000_content_section_key_widen.sql,
-- 20261104020000_welfare_section_key_widen.sql, audited, not copied).
-- Main's own Phase 2 migration only ported the Stage 2 baseline list;
-- porting real content in this migration needs the widened set.

alter table public.regulatory_content_sections drop constraint regulatory_content_sections_section_key_check;

alter table public.regulatory_content_sections add constraint regulatory_content_sections_section_key_check check (section_key in (
  'OVERVIEW', 'KEY_RULES', 'PITCH', 'MATCH_FORMAT', 'PLAYER_COUNT', 'BALL',
  'SCRUM', 'LINEOUT', 'KICKING', 'RESTART', 'SAFETY', 'SAFEGUARDING',
  'CONCUSSION', 'REPORTING', 'SOURCES',
  'EMERGENCY', 'MEDICAL_ASSESSMENT', 'RETURN_TO_PLAY',
  'OTHER'
));
