/**
 * Security headers of a tenant response (M2-22): the public page and everything else a tenant or
 * custom host serves. Set by the proxy on the rewrite, so they ride along with a page the cache
 * serves too.
 *
 * The CSP has no `script-src` and no nonce on purpose: a per-request nonce would make every page
 * dynamic and uncacheable. What it does pin down: embeds load only from the eight providers
 * (YouTube no-cookie, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music, Twitch: M6-26),
 * no plugins, no <base> tag, and nobody can frame a tenant page. Tenant content is also
 * escaped and validated before it is rendered; this is the second wall.
 *
 * Decision (Waves G+H security review): `frame-src` lists exact hosts, no wildcard, and
 * `script-src` stays absent. Two entries are the providers' whole sites, not embed-only hosts:
 * `https://www.tiktok.com` and `https://www.instagram.com`. They stay as they are, because both
 * providers serve their players only from `www` (`/embed/v2/{id}` and `/{p|reel|tv}/{code}/embed`),
 * and a CSP source cannot be limited to a path across redirects. Every iframe `src` is rebuilt
 * from validated parts (`parseEmbed(url).src`), so the list is only the second wall behind that.
 * Do not widen it (no other host, no wildcard, no scheme-only source) without a security review;
 * the exact string is pinned in tests/unit/m6-embeds-parse.test.ts, routing-proxy-tenant.test.ts
 * and m6-pages-share-proxy.test.ts. The shared-draft policy (previews/share-headers.ts) inherits
 * this list unchanged.
 */
export const TENANT_CONTENT_SECURITY_POLICY = [
  [
    "frame-src https://www.youtube-nocookie.com",
    "https://open.spotify.com",
    "https://player.vimeo.com",
    "https://www.tiktok.com",
    "https://www.instagram.com",
    "https://w.soundcloud.com",
    "https://embed.music.apple.com",
    "https://player.twitch.tv",
    "https://clips.twitch.tv",
  ].join(" "),
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function setTenantHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", TENANT_CONTENT_SECURITY_POLICY);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
}
