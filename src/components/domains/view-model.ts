import { DOMAIN_MESSAGES } from "@/lib/domains/messages";
import type { DomainRecord, DomainStatus, DomainView } from "@/lib/domains/types";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/limits";

/**
 * What the Domains screen says and shows for each state, as plain data so the rules are testable
 * without rendering anything (tests/unit/domains-ui-*.test.ts). No hooks, no server-only imports:
 * the server page and the client cards both use it.
 *
 * Every sentence here is copy from docs/features.json (M4-10, M4-14, M4-15, M5-18, M5-23): sentence
 * case, curly apostrophes, an em dash where the acceptance steps have one, no exclamation marks.
 */

export type StepState = "done" | "current" | "todo";

export interface StepView {
  /** 1, 2 or 3. */
  n: 1 | 2 | 3;
  state: StepState;
  title: string;
  /** The grey line under the title. */
  text: string;
  /** The accessible name of the numbered circle, e.g. "Step 2 of 3, current". */
  label: string;
}

/** A domain still pending this long after it was added shows the "still not resolving" text (M5-18). */
export const STALE_PENDING_MS = 48 * 60 * 60 * 1000;

/** True when `createdAt` is at least 48 hours before `now`. An unreadable date is never stale. */
export function isStalePending(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return false;
  const added = Date.parse(createdAt);
  if (Number.isNaN(added)) return false;
  return now - added >= STALE_PENDING_MS;
}

export type ChipTone = "wait" | "live" | "error";

/** The status chip. It derives from `domains.status` only: DNS never makes a pending row look live. */
export function chipFor(status: DomainStatus): { text: string; tone: ChipTone } {
  if (status === "verified") return { text: "Live · SSL issued", tone: "live" };
  if (status === "error") return { text: "Needs attention", tone: "error" };
  return { text: "Waiting for DNS", tone: "wait" };
}

export const STEP3_PENDING =
  "Automatic once the record resolves — usually minutes, occasionally up to 48 hours. We’ll email you when it’s live.";
export const STEP3_STALE =
  "Still not resolving after 48 hours. Check the record at your DNS provider, or remove the domain and add it again.";

const COMPOUND_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "co.in",
  "co.za",
  "com.br",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.hk",
  "co.kr",
]);

/**
 * The domain the customer bought, for "Wherever you bought example.test": Vercel's apex name when
 * the server knows it, otherwise the last two labels (three for the common compound endings such as
 * co.uk). Display text only; nothing is ever sent to it.
 */
export function boughtDomain(hostname: string, apexName?: string | null): string {
  if (apexName) return apexName;
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  return COMPOUND_SUFFIXES.has(lastTwo) && labels.length >= 3
    ? labels.slice(-3).join(".")
    : lastTwo;
}

/** "Add this record" for one row, "Add these records" when the ownership challenge adds a second. */
export function recordsTitle(count: number): string {
  return count > 1
    ? "Add these records at your DNS provider"
    : "Add this record at your DNS provider";
}

/**
 * The three steps of a domain card. A verified row is three green checks and no records; a pending
 * or errored row has step 1 done, step 2 current and step 3 waiting (its text carries the
 * email-when-live sentence, or the 48-hour message once the domain has been pending that long).
 */
export function stepsFor(input: {
  status: DomainStatus;
  hostname: string;
  stale: boolean;
  apexName?: string | null;
  /** How many records step 2 shows: two (the ownership challenge) make its title plural. */
  recordCount?: number;
}): StepView[] {
  const { status, hostname, stale, apexName, recordCount = 1 } = input;
  const live = status === "verified";
  const state = (n: 1 | 2 | 3): StepState => {
    if (live || n === 1) return "done";
    return n === 2 ? "current" : "todo";
  };
  const label = (n: 1 | 2 | 3) => {
    const s = state(n);
    return `Step ${n} of 3, ${s === "todo" ? "to do" : s}`;
  };
  return [
    {
      n: 1,
      state: state(1),
      title: "Domain added",
      text: "Registered with our host. Nothing else to do here.",
      label: label(1),
    },
    {
      n: 2,
      state: state(2),
      title: live ? "DNS record added" : recordsTitle(recordCount),
      text: live
        ? "Your domain points to our host."
        : `Wherever you bought ${boughtDomain(hostname, apexName)} — GoDaddy, Namecheap, Cloudflare and so on.`,
      label: label(2),
    },
    {
      n: 3,
      state: state(3),
      title: "We verify and issue SSL",
      text: live
        ? `Verified. ${hostname} is serving your page over HTTPS.`
        : stale
          ? STEP3_STALE
          : STEP3_PENDING,
      label: label(3),
    },
  ];
}

/** True when the pending card has records to show (and is not a verified domain). */
export function showsRecords(status: DomainStatus, records: readonly DomainRecord[]): boolean {
  return status !== "verified" && records.length > 0;
}

/**
 * The usage line at the right of the Custom domain header: "0 of 1 used on Pro", "3 of 15 used on
 * Studio". Null for a Free account with nothing kept (the card shows the locked state instead).
 */
export function usageLine(plan: PlanId, used: number): string | null {
  const limit = PLAN_LIMITS[plan].customDomains;
  if (limit === 0 && used === 0) return null;
  return `${used} of ${limit} used on ${PLAN_LABELS[plan]}`;
}

/** The add form shows for a plan that includes domains while a slot is free. */
export function canAddDomain(plan: PlanId, used: number): boolean {
  const limit = PLAN_LIMITS[plan].customDomains;
  return limit > 0 && used < limit;
}

/** The Studio strip is for Pro accounts only: Free sees the locked state, Studio has the most. */
export function showsStudioUpsell(plan: PlanId): boolean {
  return plan === "pro";
}

/** The strip's sentence, with the Studio count read from the limits table. */
export function studioUpsellText(): string {
  return `Running pages for clients? Studio includes ${PLAN_LIMITS.studio.customDomains} custom domains.`;
}

// ---------------------------------------------------------------------------------------------
// Status line, errors
// ---------------------------------------------------------------------------------------------

export const CHECK_PENDING_LINE =
  "Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.";
export const CHECK_FAILED = "We couldn’t check right now. Try again in a minute.";
export const REMOVE_FAILED = "We couldn’t remove that domain from our host. Try again.";
export const SERVES_FAILED = "We couldn’t save that. Try again.";
export const RECORDS_UNAVAILABLE = "We couldn’t load your DNS records.";
export const UNPUBLISHED_HINT =
  "This page isn’t published yet. Visitors see a not-found page until you publish it.";
export const EMPTY_HOSTNAME = "Enter your domain, like links.example.com.";
export const ADD_FAILED = "We couldn’t add that domain. Try again.";
export const UNKNOWN_DOMAIN = "That domain isn’t on your account anymore. Reload the page.";

/**
 * The line under the buttons for what the server said about a check. The server's own sentence for
 * "Vercel could not be reached" is replaced by M5-18's ("We couldn’t check right now. Try again in a
 * minute."); every other sentence ("Checked just now. DNS isn’t pointing here yet. ...", "Checked a
 * few seconds ago.") is shown as the server wrote it. A verified domain has no line.
 */
export function statusLineFor(domain: Pick<DomainView, "status" | "message">): string | null {
  if (domain.status === "verified") return null;
  if (domain.message === null || domain.message === "") return null;
  return domain.message === DOMAIN_MESSAGES.unreachableCheck ? CHECK_FAILED : domain.message;
}

/**
 * A newer read of one domain over the one held. When the newer read could not load the records
 * (the host was unreachable for that call) but an earlier read had them, the earlier records stay:
 * they came from the hosting API, and "couldn’t load" would be a step backwards. Nothing is ever
 * invented, and a card that never had records still says it could not load them.
 */
export function mergeDomainView(previous: DomainView, next: DomainView): DomainView {
  if (next.status === "verified") return next;
  if (next.recordsUnavailable && previous.records.length > 0) {
    return { ...next, records: previous.records, apex: previous.apex, recordsUnavailable: false };
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Polling schedule (M4-15)
// ---------------------------------------------------------------------------------------------

export interface PollSchedule {
  /** Delay between checks at first. */
  fastMs: number;
  /** Delay once `slowAfterMs` has passed. */
  slowMs: number;
  slowAfterMs: number;
  /** After this long since polling began, polling stops. */
  stopAfterMs: number;
}

/** Every 10 seconds, every 30 after 5 minutes, stop after 30 minutes. */
export const POLL_SCHEDULE: PollSchedule = {
  fastMs: 10_000,
  slowMs: 30_000,
  slowAfterMs: 5 * 60_000,
  stopAfterMs: 30 * 60_000,
};

/** How long to wait before the next poll, given how long polling has been running; null = stop. */
export function nextPollDelay(
  elapsedMs: number,
  schedule: PollSchedule = POLL_SCHEDULE,
): number | null {
  if (elapsedMs >= schedule.stopAfterMs) return null;
  return elapsedMs >= schedule.slowAfterMs ? schedule.slowMs : schedule.fastMs;
}
