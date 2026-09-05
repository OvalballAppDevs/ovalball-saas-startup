/**
 * Deliberately its own plain (non-"use client") module. pagination.tsx re-
 * exported these directly, but a server module (admin/users/types.ts,
 * imported by both a server page and a "use server" actions file)
 * importing a plain value across a "use client" boundary broke under this
 * project's Turbopack build -- PAGE_SIZES.includes stopped being a real
 * array method at runtime, 500ing every request to /admin/users. Both the
 * client Pagination component and any server-side query/types module
 * should import from here instead.
 */
export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25
