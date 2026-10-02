/**
 * The words of the failure pages (M5-20), in one place: the route error boundaries, the root
 * `global-error` and the tenant boundary all say the same thing. Plain data, no imports.
 */
export const ERROR_MESSAGE = "Something went wrong. Try again.";

/** Where a person who is stuck on an error can still go. */
export const NOT_FOUND_TITLE = "That page doesn’t exist.";
export const NOT_FOUND_COPY =
  "The link may be old or mistyped. Check the address, or head back to your page.";

export const ADDRESS_RESERVED_MESSAGE = "That address is reserved.";
export const ADDRESS_INVALID_MESSAGE = "That address isn’t valid.";

/**
 * The small reference id under an error: Next's `digest` (the hash of the error, which matches the
 * server log line) when the error came from the server, else a short random one made on the spot for
 * an error that happened in the browser. Never the message, never a stack.
 */
export function errorReference(
  error: { digest?: string | undefined } | null | undefined,
  random: () => number = Math.random,
): string {
  const digest = error?.digest;
  if (typeof digest === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(digest)) return digest;
  let id = "";
  while (id.length < 8) id += Math.floor(random() * 36).toString(36);
  return id;
}
