/**
 * One Lighthouse run, in plain node (scripts/lighthouse.ts spawns it): argv = url, preset
 * (mobile|desktop), output file. Drives the Chromium Playwright installs through a remote debugging
 * port, writes the Lighthouse JSON to the file and prints a summary as JSON on stdout.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

const [url, preset, file] = process.argv.slice(2);
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const mobile = {
  formFactor: "mobile",
  screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3, disabled: false },
  throttlingMethod: "simulate",
  // Simulated slow 4G and a 4x CPU slowdown.
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
};
const desktop = {
  formFactor: "desktop",
  screenEmulation: {
    mobile: false,
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttlingMethod: "simulate",
  throttling: {
    rttMs: 40,
    throughputKbps: 10 * 1024,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
    cpuSlowdownMultiplier: 1,
  },
};

const port = 9222 + Math.floor(Math.random() * 500);
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
try {
  const run = await lighthouse(
    url,
    {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: CATEGORIES,
      ...(preset === "desktop" ? desktop : mobile),
    },
    preset === "desktop" ? desktopConfig : undefined,
  );
  if (!run) throw new Error("Lighthouse returned no result.");
  await writeFile(file, typeof run.report === "string" ? run.report : JSON.stringify(run.report));
  const lhr = run.lhr;
  if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.message}`);
  const scores = {};
  const failedAudits = [];
  for (const id of CATEGORIES) {
    scores[id] = Math.round((lhr.categories[id]?.score ?? 0) * 100);
    for (const ref of lhr.categories[id]?.auditRefs ?? []) {
      const audit = lhr.audits[ref.id];
      if (ref.weight > 0 && audit && audit.score !== null && audit.score < 0.9) {
        failedAudits.push(`${ref.id}${audit.displayValue ? ` (${audit.displayValue})` : ""}`);
      }
    }
  }
  // Contrast must pass outright, on top of the accessibility score.
  const contrast = lhr.audits["color-contrast"];
  if (contrast && contrast.score !== null && contrast.score < 1) {
    if (!failedAudits.some((a) => a.startsWith("color-contrast")))
      failedAudits.push("color-contrast");
  }
  process.stdout.write(
    JSON.stringify({
      scores,
      lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: Number((lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
      tbtMs: Math.round(lhr.audits["total-blocking-time"]?.numericValue ?? 0),
      failedAudits,
    }),
  );
} finally {
  await browser.close();
}
