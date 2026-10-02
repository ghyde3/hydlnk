/** What the Checkout and portal helpers return; the route handlers turn it into an HTTP answer. */
export type BillingResult =
  | { ok: true; url: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 502;
      error: string;
      message?: string;
    };

export const failure = (
  status: 400 | 403 | 404 | 409 | 502,
  error: string,
  message?: string,
): BillingResult => ({ ok: false, status, error, ...(message ? { message } : {}) });
