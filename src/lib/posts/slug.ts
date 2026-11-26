import { entrySlugIssue } from "@/lib/content/schemas";

/**
 * Slugs the Posts screen suggests (M16-13, M16-14). Pure, shared by the editor and the route cores.
 * A suggestion is only ever a starting value: the strict rule is `entrySlugIssue` at Publish and the
 * database's own checks (HL012, the live-slug index).
 */

const POST_SLUG_MAX = 40;
const TERM_SLUG_MAX = 80;
const FALLBACK_POST = "post";
const FALLBACK_TERM = "term";

/** Lower case, accents folded, every run of anything else one hyphen, no hyphen at either end. */
function slugify(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/**
 * A post slug suggested from its title: valid under the entry slug rule (never `page`, `category`,
 * `tag`, `feed.xml` or a reserved path) and not in `taken`. An empty or unusable title gives "post".
 */
export function suggestSlug(title: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const fits = (candidate: string) => entrySlugIssue(candidate) === null && !used.has(candidate);
  let base = slugify(title, POST_SLUG_MAX);
  if (base === "" || (entrySlugIssue(base) !== null && entrySlugIssue(`${base}-2`) !== null)) {
    base = FALLBACK_POST;
  }
  if (fits(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, POST_SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (fits(candidate)) return candidate;
  }
}

/** A category's or tag's slug from its name (the writer's rule: up to 80 of a-z, 0-9 and hyphens). */
export function termSlug(name: string): string {
  return slugify(name, TERM_SLUG_MAX) || FALLBACK_TERM;
}
