/** Number formatting for the usage meters (M4-32). Pure; safe in server and client code. */

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * A byte count the way the meters show it: under 1 MiB reads "<1 MB", up to 999 MiB it is whole MB
 * (rounded), beyond that GB with one decimal ("1.2 GB"). Binary units, labelled MB and GB like the
 * plan names the caps ("10 MB", "100 MB", "1 GB").
 */
export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < MIB) return "<1 MB";
  const mib = safe / MIB;
  if (Math.round(mib) <= 999) return `${Math.round(mib)} MB`;
  return `${(safe / GIB).toFixed(1)} GB`;
}

/**
 * A cap the way plan copy shows it: whole MB up to 999 MiB, whole GB beyond ("10 MB", "100 MB",
 * "1 GB"); a cap that is not a whole number of either keeps one decimal.
 */
export function formatLimitBytes(bytes: number): string {
  if (bytes >= GIB) {
    const gib = bytes / GIB;
    return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GB`;
  }
  const mib = bytes / MIB;
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB`;
}

/** "18 / 100 MB": the used part drops its unit when it is the cap's unit. */
export function formatUploadUsage(usedBytes: number, limitBytes: number): string {
  const used = formatBytes(usedBytes);
  const limit = formatLimitBytes(limitBytes);
  const usedUnit = used.split(" ")[1];
  const limitUnit = limit.split(" ")[1];
  if (usedUnit === limitUnit) return `${used.split(" ")[0]} / ${limit}`;
  return `${used} / ${limit}`;
}
