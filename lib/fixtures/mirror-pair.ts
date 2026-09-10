/**
 * ONE REAL MATCH, TWO FIXTURE ROWS.
 *
 * WHAT A MIRROR PAIR IS
 *
 * A confirmed two-sided fixture is stored as TWO rows in `public.fixtures`,
 * one owned by each club -- `accept_fixture_request` creates them together.
 * Each club administers its own row, and every club-scoped query filters by
 * `owning_team_id in (my teams)`, so Burnley reads Burnley's row and
 * Rossendale reads Rossendale's row for the same real match.
 * `mirror_fixture_id` links them reciprocally, and every RPC that changes a
 * shared fact -- kick-off, pitch, result -- writes BOTH rows, so neither club
 * can see a stale version of something they share. The column's own comment in
 * 20260902100000_fixture_mirror_sync.sql is the authority for all of that.
 *
 * WHICH ID IS THE CANONICAL NAVIGATION IDENTITY
 *
 * The viewer's OWN side's row. There is no single global winner, and looking
 * for one is the mistake: a Burnley parent opening Match Centre should land on
 * Burnley's row, because that is the row carrying Burnley's meet time, Burnley's
 * pitch allocation and Burnley's conversation. A "canonical" rule that sent
 * them to Rossendale's row would be deterministic and wrong.
 *
 * So deduplication is only ever about NOT SHOWING THE SAME MATCH TWICE to a
 * viewer whose scope reaches both rows. It is not about choosing a global
 * primary.
 *
 * ============================================================
 * THE TWO RULES, AND WHY BOTH ARE CORRECT
 * ============================================================
 *
 * The audit found two different dedupe expressions in the codebase and I first
 * read that as drift. It is not: they answer the same question for two
 * genuinely different query shapes, and each is wrong in the other's place.
 *
 * 1. BOTH HALVES ALWAYS IN SCOPE  ->  isPrimaryMirror
 *
 *    Some queries return both rows of a pair by construction. Pitch Allocation
 *    filters on the GENERATED `home_team_id`, and for a pair where this club is
 *    at home both rows resolve that column to this club's team -- so both
 *    arrive, always. Fixture Management reads `admin_fixture_overview`, whose
 *    `is_primary_mirror` column is defined in the database as exactly
 *    `mirror_fixture_id IS NULL OR id < mirror_fixture_id`.
 *
 *    Here the lower id wins. Deterministic, needs no knowledge of the result
 *    set, and matches the database's own named column.
 *
 * 2. ONLY ONE HALF MAY BE IN SCOPE  ->  dedupeMirrorPairs
 *
 *    Agenda and the family agenda scope by the viewer's own teams, so usually
 *    only ONE row of a pair is returned -- the viewer's own. Applying rule 1
 *    there would delete the fixture outright whenever the viewer's own row
 *    happened to hold the higher id: their match would silently vanish from
 *    their diary. The extra clause -- keep it if its partner is not in this
 *    result set -- is what prevents that.
 *
 *    A viewer whose scope genuinely spans both clubs (a Site Admin, or a parent
 *    with a child at each club) still sees the pair collapse to one, by the
 *    same lower-id tiebreak.
 *
 * CHOOSING BETWEEN THEM: ask whether your query can return one half without
 * the other. If it can, use dedupeMirrorPairs. If it structurally cannot, both
 * are equivalent and isPrimaryMirror is cheaper.
 */

/** The minimum a row needs for either rule. */
export interface MirrorableFixture {
  id: string
  mirror_fixture_id: string | null
}

/**
 * Rule 1 -- the database's own `is_primary_mirror`, in TypeScript.
 *
 * Use ONLY where the query cannot return one half of a pair without the other.
 * Kept byte-for-byte equivalent to the generated column so Fixture Management,
 * Pitch Allocation and any future consumer agree on which row is primary.
 */
export function isPrimaryMirror(fixture: MirrorableFixture): boolean {
  return !fixture.mirror_fixture_id || fixture.id < fixture.mirror_fixture_id
}

/**
 * Rule 2 -- scope-aware deduplication.
 *
 * Returns a subset: one row per real match, preferring the lower id when both
 * halves are present, and keeping a lone half exactly as it is. Never reorders,
 * never invents, never returns a row that was not passed in.
 */
export function dedupeMirrorPairs<T extends MirrorableFixture>(rows: T[]): T[] {
  const present = new Set(rows.map((r) => r.id))
  return rows.filter((r) => !r.mirror_fixture_id || !present.has(r.mirror_fixture_id) || r.id < r.mirror_fixture_id)
}
