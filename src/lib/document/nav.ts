import { z } from "zod";

/**
 * Site navigation (M11-07): Home's document carries the menu, `nav: {show, items}`, and a
 * `page_link` block points at Home or a sub-page. Sub-pages are named by id (the `site_pages` row id,
 * a UUID), never by path, so a rename of a path breaks no menu entry or link.
 */

export const NAV_MAX_ITEMS = 20;

/** The `page_link` target that means Home. */
export const HOME_TARGET = "home";

export const NAV_MESSAGES = {
  tooMany: `Use ${NAV_MAX_ITEMS} menu items or fewer.`,
  duplicate: "A page may appear in the menu once.",
  badId: "Choose a page of this site.",
  badTarget: "Choose Home or a page of this site.",
} as const;

/** A sub-page id (any UUID shape, like a theme ref). The one place the id format is decided. */
export const subPageIdSchema = z.guid({ error: NAV_MESSAGES.badId });

/** `nav`: `show` defaults to true, `items` to none; an item appears at most once. */
export const navSchema = z.object({
  show: z.boolean().default(true),
  items: z
    .array(subPageIdSchema)
    .max(NAV_MAX_ITEMS, { error: NAV_MESSAGES.tooMany })
    .default([])
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((id, index) => {
        if (seen.has(id))
          ctx.addIssue({ code: "custom", path: [index], message: NAV_MESSAGES.duplicate });
        seen.add(id);
      });
    }),
});
export type Nav = z.infer<typeof navSchema>;

/** The menu of a document, with the defaults for an absent `nav` (show, no items). */
export function resolveNav(nav: Partial<Nav> | undefined): Nav {
  return { show: nav?.show ?? true, items: nav?.items ? [...nav.items] : [] };
}

/**
 * The stored form of `nav`: undefined when it is the default (shown, no items), so a site that never
 * used a menu publishes byte-identically to before.
 */
export function publishNav(nav: Partial<Nav> | undefined): Nav | undefined {
  const resolved = resolveNav(nav);
  return resolved.show && resolved.items.length === 0 ? undefined : resolved;
}

/** True for the `page_link` target of Home or a UUID-shaped sub-page id. */
export function isPageLinkTarget(target: string): boolean {
  return target === HOME_TARGET || subPageIdSchema.safeParse(target).success;
}

/** A `page_link` target. A draft keeps any short string (half-chosen autosaves); Publish wants Home or an id. */
export function pageLinkTarget(mode: "draft" | "publish"): z.ZodString {
  const base = z.string().trim().max(64, { error: NAV_MESSAGES.badTarget });
  if (mode === "draft") return base;
  return base.refine(isPageLinkTarget, { error: NAV_MESSAGES.badTarget });
}
