import {
  HANDLE_DISPLAY_DOMAIN,
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  normalizeHandle,
  validateHandle,
} from "@/lib/handles/rules";

/**
 * The one line under the claim field. It runs on the shared handle rules only (pure, no network):
 * whether a name is taken or reserved is decided on the sign-up page, because the availability
 * check lives on the app host and the landing page makes no database calls. So this line never
 * says a name is available. It says what the visitor typed will become, and that sign-up checks it.
 * Kept free of `@/lib/env/client` so it can be unit tested without the public env.
 */

export type ClaimHintKind = "idle" | "ok" | "changed" | "short" | "too_long" | "invalid";

export interface ClaimHint {
  kind: ClaimHintKind;
  message: string;
  /** True for the states sign-up would refuse (too long, or a dash or xn-- in the wrong place). */
  invalid: boolean;
}

/** Shown while the field is empty. Callers can swap in their own reassurance. */
export const DEFAULT_IDLE_HINT = "Free forever. No card required.";

export function claimHint(raw: string, idle: string = DEFAULT_IDLE_HINT): ClaimHint {
  const typed = raw.trim();
  if (typed === "") return { kind: "idle", message: idle, invalid: false };

  const handle = normalizeHandle(typed);
  const rule = validateHandle(handle);

  if (rule === "short") {
    return {
      kind: "short",
      message: `Use at least ${HANDLE_MIN_LENGTH} letters, numbers or dashes.`,
      invalid: false,
    };
  }
  if (rule === "too_long") {
    return {
      kind: "too_long",
      message: `Handles can be up to ${HANDLE_MAX_LENGTH} characters.`,
      invalid: true,
    };
  }
  if (rule === "invalid") {
    return {
      kind: "invalid",
      message: handle.startsWith("xn--")
        ? "Handles can’t start with xn--."
        : "Handles can’t start or end with a dash.",
      invalid: true,
    };
  }

  // Case alone is not worth a remark; dropped spaces, underscores and symbols are.
  const changed = typed.toLowerCase() !== handle;
  return {
    kind: changed ? "changed" : "ok",
    message: changed
      ? `We’ll use ${handle}.${HANDLE_DISPLAY_DOMAIN}.`
      : "Next, we check that it’s available.",
    invalid: false,
  };
}
