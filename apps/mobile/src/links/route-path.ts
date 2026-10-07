/**
 * WHICH PATH A STACK ENTRY IS SHOWING, from what the navigator holds (a route name such as `planner/club-day/[groupId]`
 * and its params). Pure, so it can be tested without a navigator.
 *
 * `useOriginBack` needs it to tell whether the screen beneath IS the place an opener asked to return to. When it is,
 * Back simply pops -- re-navigating there would build a fresh copy of that screen and lose where IT came from (the
 * Season Planner opened from the Admin Centre would forget the Admin Centre).
 */

type Params = Record<string, unknown> | undefined

/** `planner/club-day/[groupId]` + { groupId: "g1" } → `planner/club-day/g1`; an index or a (group) adds nothing. */
export function filledRouteName(name: string, params: Params): string | null {
  const out: string[] = []
  for (const segment of name.split("/")) {
    if (segment === "index" || segment === "" || (segment.startsWith("(") && segment.endsWith(")"))) continue
    if (segment.startsWith("[") && segment.endsWith("]")) {
      const key = segment.slice(1, -1).replace(/^\.\.\./, "")
      const value = params?.[key]
      if (value === undefined || value === null || value === "") return null
      out.push(Array.isArray(value) ? value.map(String).join("/") : String(value))
      continue
    }
    out.push(segment)
  }
  return out.join("/")
}

/**
 * The path of the screen beneath, worked out from the current screen's own path: the current path minus the current
 * route's filled name is the stack's base, and the screen beneath sits on that same base. Null when it cannot be told.
 */
export function pathBeneath(currentPath: string, current: { name: string; params?: Params }, beneath: { name: string; params?: Params }): string | null {
  const own = filledRouteName(current.name, current.params)
  const below = filledRouteName(beneath.name, beneath.params)
  if (own === null || below === null) return null
  const trimmed = currentPath.replace(/\/+$/, "") || "/"
  let base: string
  if (own === "") base = trimmed
  else if (trimmed === `/${own}` || trimmed.endsWith(`/${own}`)) base = trimmed.slice(0, trimmed.length - own.length - 1)
  else return null
  const joined = below === "" ? base : `${base}/${below}`
  return joined === "" ? "/" : joined
}
