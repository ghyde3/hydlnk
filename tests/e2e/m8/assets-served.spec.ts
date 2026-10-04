import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FONT_MANIFEST } from "@/lib/tenant-assets/fonts";
import { TENANT_SCRIPT_SRC } from "@/lib/tenant-assets/generated";
import { rawBuffer, SERVER_PORT } from "../m2/publish-helpers";

/**
 * M8-01 step 5 and M8-05 step 1: the tenant script and the theme font files are static files at
 * hashed paths under /_t/, answered the same on every host (the root, the app host, a handle host
 * and a custom host), never through the proxy: 200 with the right Content-Type, a one-year immutable
 * cache, nosniff and no cookie in either direction. The cache header is declared in next.config.ts
 * (the platform serves public/ files as they are), so this spec is the gate that it is.
 */

const HOSTS = [
  `localhost:${SERVER_PORT}`,
  `app.localhost:${SERVER_PORT}`,
  `mara.localhost:${SERVER_PORT}`,
  // A custom host is just a Host header: the file is served before any host decision.
  "links.example.test",
];

const IMMUTABLE = "public, max-age=31536000, immutable";

for (const host of HOSTS) {
  test(`M8-05 the script on ${host}: 200, text/javascript, immutable, nosniff, no cookie`, async () => {
    const response = await rawBuffer(host, TENANT_SCRIPT_SRC, {
      cookie: "sb-localhost-auth-token=abc; other=1",
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(response.headers["cache-control"]).toBe(IMMUTABLE);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.text).toBe(
      readFileSync(join(process.cwd(), "public", TENANT_SCRIPT_SRC), "utf8"),
    );
    const head = await rawBuffer(host, TENANT_SCRIPT_SRC, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers["cache-control"]).toBe(IMMUTABLE);
  });
}

test("M8-05 an old or unknown hashed script is a 404, never another file", async () => {
  const response = await rawBuffer(`mara.localhost:${SERVER_PORT}`, "/_t/p.000000000000.js");
  expect(response.status).toBe(404);
  expect(response.headers["cache-control"] ?? "").not.toContain("immutable");
});

const files = Object.values(FONT_MANIFEST.families)
  .flatMap((family) => family?.faces ?? [])
  .map((face) => face.file);
const unique = [...new Set(files)];

test.describe("M8-01 the font files", () => {
  test.skip(unique.length === 0, "the fonts are not vendored yet: run `pnpm tenant-fonts`");

  test("every vendored file is served on the root host: 200, font/woff2, immutable, nosniff, no cookie", async () => {
    for (const file of unique) {
      const response = await rawBuffer(`localhost:${SERVER_PORT}`, `/_t/f/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers["content-type"], file).toBe("font/woff2");
      expect(response.headers["cache-control"], file).toBe(IMMUTABLE);
      expect(response.headers["x-content-type-options"], file).toBe("nosniff");
      expect(response.headers["set-cookie"], file).toBeUndefined();
      expect(response.body.length, file).toBe(
        readFileSync(join(process.cwd(), "public/_t/f", file)).length,
      );
    }
  });

  for (const host of HOSTS.slice(1)) {
    test(`a font file on ${host} is the same bytes with the same headers`, async () => {
      const file = unique.find((name) => name.includes("-latin."))!;
      const response = await rawBuffer(host, `/_t/f/${file}`, { cookie: "sb-x=1" });
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("font/woff2");
      expect(response.headers["cache-control"]).toBe(IMMUTABLE);
      expect(response.headers["set-cookie"]).toBeUndefined();
    });
  }

  test("the notices file ships beside the fonts", async () => {
    const response = await rawBuffer(`localhost:${SERVER_PORT}`, "/_t/f/NOTICE.txt");
    expect(response.status).toBe(200);
    expect(response.text).toContain("SIL Open Font License");
    expect(readdirSync(join(process.cwd(), "public/_t/f"))).toContain("NOTICE.txt");
  });
});
