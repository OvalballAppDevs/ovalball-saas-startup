/**
 * HOW TALL THE BOTTOM NAVIGATION IS -- stated once, for the bar and for everything underneath it.
 *
 * The bar is drawn over the screen, so a scrolling screen's last row lands UNDER it unless the screen
 * reserves the space. Every screen that got this wrong got it wrong the same way: it padded by the
 * safe-area inset alone, which is the home indicator and not the bar, and came up about 58pt short --
 * enough to swallow a summary row, and on Tournaments enough to hide "Create New Tournament"
 * completely, leaving the screen's primary action unreachable.
 *
 * So the number lives here rather than in the layout that happens to draw the bar, and both read it.
 * A screen asking "how much room does the navigation take?" must never have to know how the bar is
 * built, and must never arrive at the answer by adding constants until it looks right.
 *
 * DELIBERATELY FREE OF ANY REACT NATIVE IMPORT, so the arithmetic can be asserted by a plain test.
 * The hook that reads the device's own inset is next door, in `use-tab-bar-height.ts`.
 */

/** The bar's own content height, above the home indicator. */
export const TAB_BAR_CONTENT_HEIGHT = 58

/** The whole bar, including the home indicator it sits above. */
export function tabBarHeight(bottomInset: number): number {
  return TAB_BAR_CONTENT_HEIGHT + bottomInset
}
