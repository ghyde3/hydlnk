import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two repository checks on the Domains screen's own files (M4-10, M4-13): its strings never promise
 * what v1 does not have, and it never carries a DNS value. The records on screen are whatever the
 * server read from the hosting API for this project; a literal address or CNAME target in the UI
 * would be a stale fallback waiting to mislead someone.
 */

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["src/components/domains", "src/app/(editor)/app/(screens)/domains"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const full = path.join(dir, name);
    if (statSync(path.join(ROOT, full)).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const sources = DIRS.flatMap(files).map((file) => ({
  file,
  text: readFileSync(path.join(ROOT, file), "utf8"),
}));

describe("the Domains screen's files", () => {
  it("there are files to check", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("contain no IPv4 literal, no vercel-dns CNAME target and no Vercel IP from a mockup", () => {
    const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    for (const { file, text } of sources) {
      expect(text, `${file} has an IPv4 literal`).not.toMatch(ipv4);
      expect(text, `${file} names a vercel-dns target`).not.toMatch(/vercel-dns/i);
      expect(text, file).not.toContain("76.76.21.21");
    }
  });

  it("never mention what v1 does not offer: editors, team, CSV, scheduled", () => {
    for (const { file, text } of sources) {
      expect(text, `${file} mentions editors`).not.toMatch(/\beditors\b/i);
      expect(text, `${file} mentions team`).not.toMatch(/\bteams?\b/i);
      expect(text, `${file} mentions CSV`).not.toMatch(/\bcsv\b/i);
      expect(text, `${file} mentions scheduled`).not.toMatch(/\bscheduled\b/i);
    }
  });

  it("use HYDLNK tokens only: no tenant theme variable, no raw hex colours", () => {
    for (const { file, text } of sources) {
      expect(text, `${file} uses a tenant token`).not.toMatch(/--t-/);
      expect(text, `${file} has a raw hex colour`).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
