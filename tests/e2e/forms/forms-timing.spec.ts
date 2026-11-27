import { expect, test } from "@playwright/test";
import { desktopOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT } from "../helpers";
import { usesProductionServer } from "../../../scripts/lib/e2e-server";
import { FORM_POST_FLOOR_MS } from "@/lib/forms/contract";
import { SIGNUP_ID, formPage, waitForRows } from "./forms-helpers";

/**
 * Forms attack pass, finding 2, on a production build: a dropped submission (the honeypot) and a
 * stored one take the same time. 50 of each, interleaved, each from its own client (the per-client
 * limits) that loaded the open marker more than 3 seconds before; on Studio, so the site's hour and
 * day never refuse. Coarse on purpose: the medians differ by less than 5 ms, and every answer took
 * at least the floor. The unit test (m17f-forms-submit.test.ts, finding 2) pins every outcome to
 * the same moment exactly.
 */

const SAMPLES = 50;
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

test("a dropped and a stored submission answer in the same time (medians within 5 ms)", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  test.skip(!usesProductionServer(process.env), "timing is measured on a production build");
  test.setTimeout(180_000);
  const live = await formPage("ftm", { plan: "studio" });
  const host = `${live.handle}.localhost:3000`;
  const origin = `http://${live.handle}.localhost:${DEV_PORT}`;
  // Shared address space (100.64.0.0/10), a fresh /16 a run: no other spec's clients.
  const base = 64 + Math.floor(Math.random() * 64);
  const ip = (i: number) => `100.${base}.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  // Two clients per sample, and the last two for the warm-up.
  const clients = Array.from({ length: SAMPLES * 2 + 2 }, (_, i) => ip(i));

  // Every client opens the page's marker, then waits out the fill time once for all of them.
  for (const client of clients) {
    const marker = await rawRequest(host, `/f/${live.pageId}/o`, {
      headers: { "x-forwarded-for": client },
    });
    expect(marker.status).toBe(200);
  }
  await new Promise((resolve) => setTimeout(resolve, 3500));

  const send = async (client: string, honeypot: string) => {
    const body = new URLSearchParams({
      email: `t-${rand(8)}@example.test`,
      hl_confirm: honeypot,
      t: "",
    }).toString();
    const started = performance.now();
    const response = await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // A browser's user agent: with none the post is dropped as a bot and nothing is stored.
        "user-agent": BROWSER,
        origin,
        "x-forwarded-for": client,
      },
    });
    const elapsed = performance.now() - started;
    expect(response.status).toBe(303);
    return elapsed;
  };

  // A warm-up post of each kind (the first request of a route compiles nothing on a build, but
  // the first database calls open connections).
  await send(clients[SAMPLES * 2]!, "");
  await send(clients[SAMPLES * 2 + 1]!, "filled");

  const dropped: number[] = [];
  const stored: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    dropped.push(await send(clients[2 * i]!, "filled"));
    stored.push(await send(clients[2 * i + 1]!, ""));
  }
  await waitForRows(live.pageId, SAMPLES + 1);

  const gap = Math.abs(median(dropped) - median(stored));
  info.annotations.push({
    type: "timing",
    description: `dropped median ${median(dropped).toFixed(1)} ms, stored median ${median(stored).toFixed(1)} ms`,
  });
  expect(Math.min(...dropped, ...stored)).toBeGreaterThanOrEqual(FORM_POST_FLOOR_MS);
  expect(gap).toBeLessThan(5);
});
