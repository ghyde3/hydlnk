/**
 * The device class of a user agent: mobile, tablet or desktop (M4-21). A deliberately small set of
 * rules, not a user-agent database: iPhone and Android phones are mobile, iPad and Android without
 * the "Mobile" token are tablets, anything unmatched (or missing) is desktop.
 */
export type DeviceClass = "mobile" | "tablet" | "desktop";

export function deviceFromUserAgent(userAgent: string | null | undefined): DeviceClass {
  const ua = userAgent ?? "";
  if (ua === "") return "desktop";
  if (/iPad|Tablet|PlayBook|Kindle|Silk\//i.test(ua)) return "tablet";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "mobile" : "tablet";
  if (/iPhone|iPod|Windows Phone|IEMobile|BlackBerry|BB10|Opera Mini|Opera Mobi|\bMobi\b/i.test(ua)) {
    return "mobile";
  }
  return "desktop";
}
