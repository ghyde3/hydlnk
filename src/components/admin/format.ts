/** "2026-10-02 14:05 UTC": a fixed, locale-free time, so the server and the browser agree. */
export function formatWhen(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const REASON_LABELS: Record<string, string> = {
  phishing: "Phishing",
  malware: "Malware",
  impersonation: "Impersonation",
  spam: "Spam",
  illegal: "Illegal content",
  other: "Other",
};

export const reasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason;
