import { isbot } from "isbot";

/**
 * Bot detection (M4-23): a user agent that is missing, empty or recognisably automated never counts
 * as a view or a click. Crawlers and link-preview fetchers (Googlebot, Slackbot, WhatsApp, curl,
 * HeadlessChrome and friends) still get their page and their redirect; they just leave no event.
 *
 * The `isbot` package decides what is a crawler. `isBot` is the only export anyone calls; every real
 * browser, in-app browser included (Instagram, Facebook, TikTok, Gmail), is let through.
 */

/** True for an empty or missing user agent and for one that names a bot, crawler or HTTP client. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (userAgent === null || userAgent === undefined) return true;
  const ua = userAgent.trim();
  if (ua === "") return true;
  return isbot(ua);
}
