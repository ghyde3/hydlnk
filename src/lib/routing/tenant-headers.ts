/**
 * Security headers of a tenant response (M2-22, M8-07): the public page and everything else a tenant
 * or custom host serves. Set by the proxy on the rewrite, so they ride along with a page the cache
 * serves too.
 *
 * A live page (M8-02) is finished HTML with one known script, so its policy (`TENANT_PAGE_CSP`) is a
 * closed list, one directive per resource type: scripts only from the page's own host, no inline or
 * eval script (there is no nonce, and none is needed: a per-request nonce would make every page
 * dynamic and uncacheable), styles inline only (the theme arrives as inline `--t-*` properties and
 * one `<style>` element), fonts from the host, images from the host and the canonical media origin,
 * XHR and beacons to the host, frames only from the nine embed providers, nothing else, and nobody
 * can frame a tenant page. Tenant content is also escaped and validated before it is rendered; this
 * is the second wall.
 *
 * Decision (Waves G+H security review): `frame-src` lists exact hosts, no wildcard. Two entries are
 * the providers' whole sites, not embed-only hosts: `https://www.tiktok.com` and
 * `https://www.instagram.com`. They stay as they are, because both providers serve their players only
 * from `www` (`/embed/v2/{id}` and `/{p|reel|tv}/{code}/embed`), and a CSP source cannot be limited
 * to a path across redirects. Every iframe `src` is rebuilt from validated parts
 * (`parseEmbed(url).src`), and the tenant script checks the origin again before it mounts one, so the
 * list is only the second wall behind that. Do not widen it (no other host, no wildcard, no
 * scheme-only source) without a security review; the exact strings are pinned in
 * tests/unit/m8-render-headers.test.ts, routing-proxy-tenant.test.ts and m6-pages-share-proxy.test.ts.
 *
 * `TENANT_CONTENT_SECURITY_POLICY` is the older, looser policy (no `default-src`, no `script-src`):
 * it is no longer what a live page carries, but the private share link (previews/share-headers.ts)
 * still extends it with its own nonce script policy, and must keep doing so. It is not rebuilt from
 * `TENANT_PAGE_CSP`: a second `script-src 'self'` ahead of the nonce policy would make browsers ignore
 * the nonce and block Next's bootstrap scripts.
 */
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

/**
 * Images load only from the page's own host and from the canonical media origin (the root host,
 * where `/media/...` is served: src/lib/media/url.ts). Exact origin, no wildcard, no `data:`.
 */
export const MEDIA_IMG_SRC = `img-src 'self' ${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}`;

/**
 * The nine origins a tenant page may frame (M6-26): the providers' embed hosts and nothing else.
 * The one source of the `frame-src` directive of both policies below and the list the tenant script
 * (src/lib/tenant-assets/script/tenant.js) checks before it mounts a player; a test pins that the
 * three agree.
 */
export const FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://open.spotify.com",
  "https://player.vimeo.com",
  "https://www.tiktok.com",
  "https://www.instagram.com",
  "https://w.soundcloud.com",
  "https://embed.music.apple.com",
  "https://player.twitch.tv",
  "https://clips.twitch.tv",
] as const;

const FRAME_SRC = `frame-src ${FRAME_ORIGINS.join(" ")}`;

export const TENANT_CONTENT_SECURITY_POLICY = [
  FRAME_SRC,
  MEDIA_IMG_SRC,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The policy of every response the proxy rewrites on a tenant host or a custom host (M8-07): the
 * live page, the placeholder, every 404 panel and the 500 panel. A constant of this module: nothing
 * in it is built from a request.
 */
export const TENANT_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  MEDIA_IMG_SRC,
  "connect-src 'self'",
  FRAME_SRC,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function setTenantHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", TENANT_PAGE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
}
