import { handleDisplayHost } from "./rules";

/**
 * Every state the handle field and the availability endpoint can be in. "available", "reserved"
 * and "taken" need the server; the other three come from the pure rules.
 */
export type HandleStatus = "available" | "reserved" | "taken" | "short" | "too_long" | "invalid";

export const HANDLE_STATUSES: readonly HandleStatus[] = [
  "available",
  "reserved",
  "taken",
  "short",
  "too_long",
  "invalid",
];

export function isHandleStatus(value: unknown): value is HandleStatus {
  return typeof value === "string" && (HANDLE_STATUSES as readonly string[]).includes(value);
}

export type StatusTone = "neutral" | "good" | "bad";

/** Copy and tone for a status line (M1-11, mockup Signup.dc.html). */
export function describeHandleStatus(
  status: HandleStatus,
  handle: string,
): { tone: StatusTone; message: string } {
  switch (status) {
    case "available":
      return { tone: "good", message: `${handleDisplayHost(handle)} is available` };
    case "taken":
      return { tone: "bad", message: "That one’s taken. Try another." };
    case "reserved":
      return { tone: "bad", message: "That name is reserved. Try another." };
    case "invalid":
      return { tone: "bad", message: "Handles can’t start or end with a dash or start with xn--." };
    case "too_long":
      return { tone: "bad", message: "Handles can be up to 30 characters." };
    case "short":
      return { tone: "neutral", message: "At least 3 characters — letters, numbers and dashes." };
  }
}

export const CHECKING_MESSAGE = "Checking…";
export const CHECK_FAILED_MESSAGE = "Couldn’t check that handle. Try again.";
