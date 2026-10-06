"use client";

import { useEffect, useState } from "react";
import { validateHandle } from "@/lib/handles/rules";
import { isHandleStatus, type HandleStatus } from "@/lib/handles/status";

/** Same pause after the last keystroke as the handle field's own live check. */
const DEBOUNCE_MS = 300;

type Check = { handle: string; status: HandleStatus | "error" };

/**
 * Whether the Google button on /signup may be pressed yet.
 *
 * Google's button is an iframe the page cannot intercept, and a press opens Google's popup
 * straight away, so the handle has to be known to be usable BEFORE the press: that is how a
 * malformed, reserved or taken name never leaves for Google (M1-13). The handle field shows the
 * same facts as text; this hook asks the same endpoint, quietly, so the button can wait for them.
 *
 *   - Malformed (short, too long, bad dashes, empty): judged locally with the shared rules.
 *   - Well-formed: blocked until GET /api/handles/check says "available" for THIS handle (an answer
 *     for an earlier value never counts). Blocked while that request is in flight.
 *   - The check itself failing (network, 500) does not block: the Server Action validates the
 *     handle again before anyone is signed in, and says so if it can't be used.
 */
export function useGoogleHandleGate(handle: string): { blocked: boolean } {
  const rule = validateHandle(handle);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    if (rule !== "ok") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/handles/check?handle=${encodeURIComponent(handle)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`check failed: ${response.status}`);
        const body: unknown = await response.json();
        const status = (body as { status?: unknown } | null)?.status;
        if (!isHandleStatus(status)) throw new Error("unexpected response");
        setCheck({ handle, status });
      } catch {
        // An aborted request belongs to a handle that has since changed.
        if (!controller.signal.aborted) setCheck({ handle, status: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle, rule]);

  if (rule !== "ok") return { blocked: true };
  if (!check || check.handle !== handle) return { blocked: true };
  return { blocked: check.status !== "available" && check.status !== "error" };
}
