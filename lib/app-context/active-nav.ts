/**
 * WHICH NAVIGATION ROW IS THE PAGE YOU ARE ON.
 *
 * One resolver, because there are four renderers -- the desktop sidebar, its grouped sections, the
 * mobile drawer and the bottom bar -- and they must agree. Each of them used to decide independently
 * with `pathname === href || pathname.startsWith(href + "/")`, evaluated per row.
 *
 * THAT PREDICATE IS NOT A MATCHER, IT IS A PREFIX TEST, and a nav whose destinations nest answers
 * `true` for more than one row at a time. On `/fixtures/management` it highlighted both Fixture
 * Control Centre and Fixture Requests; on `/club/settings/guardians` it highlighted both Guardians &
 * Players and Club Settings. Two active rows is not a highlight -- the person cannot tell from it
 * where they are, which is the only thing the state exists to say.
 *
 * SO THE LONGEST MATCH WINS, and exactly one row can be active. `/fixtures` is a real destination
 * (the negotiation register) AND the parent of `/fixtures/management`; being the parent of the page
 * does not make it the page. A deeper route that no row names still lights its nearest ancestor --
 * `/messages/<id>` activates Messages -- which is the behaviour the prefix test got right and this
 * keeps.
 *
 * Two distinct hrefs of equal length cannot both prefix-match one pathname, so there is no tie to
 * break and no ordering dependency on how the rows were assembled.
 */
export function resolveActiveHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue
    if (best === null || href.length > best.length) best = href
  }
  return best
}

/**
 * The form a renderer wants: hand it every href it is about to render, get back a predicate.
 *
 * Every row must be in `hrefs`, including rows in collapsed sections -- a candidate left out cannot
 * win, and leaving out the deep one is how the shorter ancestor wrongly lights up again.
 */
export function navActiveMatcher(pathname: string, hrefs: readonly string[]): (href: string) => boolean {
  const active = resolveActiveHref(pathname, hrefs)
  return (href: string) => active !== null && href === active
}
