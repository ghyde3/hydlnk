/**
 * The view beacon (M4-21): a few lines of inline script on a PUBLISHED page that, once the page has
 * loaded, calls `navigator.sendBeacon('/api/e', {pageId, referrer})` exactly once. The URL is
 * relative so the request goes to whichever host served the page (tenant subdomain or custom
 * domain). No cookie, no storage, no identifier: the server derives an anonymous, daily-rotating
 * hash from the request itself, so no consent banner is needed.
 *
 * The page document stays static and identical for every visitor: this script is part of it, and
 * the beacon is the only per-visit request. It is rendered by `TenantPage` (the live page) and by
 * nothing else, so the editor preview, which draws the same `PageRenderer`, never reports a view.
 *
 * The one value the script embeds is the page id, which the caller got from the database and which
 * is checked here to be a UUID, then written as a JSON string.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function viewBeaconScript(pageId: string): string {
  if (!UUID.test(pageId)) throw new Error("The view beacon needs a page id (UUID).");
  return (
    "(function(){var id=" +
    JSON.stringify(pageId) +
    ";function s(){try{navigator.sendBeacon('/api/e',JSON.stringify({pageId:id,referrer:document.referrer}))}catch(e){}}" +
    "if(document.readyState==='complete'){s()}else{window.addEventListener('load',s,{once:true})}})();"
  );
}

export function ViewBeacon({ pageId }: { pageId: string }) {
  return <script dangerouslySetInnerHTML={{ __html: viewBeaconScript(pageId) }} />;
}
