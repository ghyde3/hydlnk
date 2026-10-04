/**
 * Whether the end-to-end test hooks are on: `GET /hl-query-count` and `GET /hl-fail-next-read` on a
 * tenant host, the one-shot read failure behind them, the public query counter and the
 * `x-hl-domain-cache` header of the proxy. They exist for the production-build specs (CI starts
 * `next start` with HYDLNK_QUERY_COUNTER=1 and no VERCEL_ENV) and for a preview deployment's smoke
 * run (VERCEL_ENV=preview).
 *
 * They are never on in production: with the flag set on a Vercel production deployment this stays
 * false, so a mistake in the project's environment cannot let any visitor arm a 500 on any page. This
 * is the one place the flag is read; the release smoke still checks that it is not set (PROGRESS.md).
 * No `server-only` here: the proxy reads it too.
 */
export function testHooksEnabled(): boolean {
  return process.env.HYDLNK_QUERY_COUNTER === "1" && process.env.VERCEL_ENV !== "production";
}
