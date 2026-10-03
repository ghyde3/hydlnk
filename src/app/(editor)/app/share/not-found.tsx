import { INACTIVE_LINK_MESSAGE } from "@/lib/previews/messages";

/**
 * What every share link that is not active answers (M6-10): an unknown token, a malformed one, an
 * expired link, one that was turned off, one of a suspended owner and one of a deleted page. The same
 * words and the same markup for all of them, so nothing says which it was, and nothing of any page.
 * No session is read here (the app 404 of the signed-in shell is not used on purpose).
 */
export default function ShareLinkNotActive() {
  return (
    <main className="mx-auto max-w-[480px] px-4 py-12">
      <h1 className="sr-only">Preview link not active</h1>
      <p className="m-0 text-base leading-normal text-ink">{INACTIVE_LINK_MESSAGE}</p>
    </main>
  );
}
