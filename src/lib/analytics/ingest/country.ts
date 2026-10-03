/**
 * The visitor's country, from the platform header only (M4-21): `x-vercel-ip-country`, two letters
 * (ISO 3166-1 alpha-2), upper-cased. Anything else, or no header (local development), is null. Nothing
 * the visitor controls (the beacon body, other headers) is ever used for it.
 */
export function countryFromHeaders(headers: Headers): string | null {
  const value = headers.get("x-vercel-ip-country")?.trim() ?? "";
  return /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}
